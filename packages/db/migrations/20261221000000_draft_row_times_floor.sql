-- Document and Link times never earlier than the Creation Date once an item is
-- numbered (RP-399; visibility.md "Creation Date" and scenarios 61, 74 and 75).
--
-- A Document or Link added while the item was a Draft kept its real time, before
-- the Creation Date, and everyone who sees the item could read it: when the Draft
-- was started. As RP-392 did for answer times:
--
-- * document.created_at and confirmed_at, and work_item_link.created_at, are no
--   longer granted to the app role. The stored times stay for audit.
-- * app.document_times gives each Document of a visible item its upload time, as
--   the documents policy shows them: once the item the file was first uploaded on
--   is numbered, a time earlier than that item's numbered_at reads as numbered_at.
--   A Revision's own Documents follow its own Creation Date; a copied Document
--   keeps the original's upload time (scenario 75, the draft_start_time
--   migration), floored by the original's Creation Date, never the Revision's.
--   `seq` is the order they were uploaded in: an order, not a time.
-- * app.work_item_links is as in the random_ids migration, except that its
--   created_at is floored to the item's numbered_at the same way. A Revision's
--   Links are its own rows, so they follow its own Creation Date.
-- * While the item is a Draft (numbered_at is null), nothing changes, so the C1
--   Members working on it see real times.

revoke select on document from rabaed_app;
grant select (
  id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key, uploaded_by_member_id,
  uploaded_by_participant_id, removed_at, removed_by_member_id, frozen_at, field_key, taken_at, taken_latitude,
  taken_longitude, item_key, arrival
) on document to rabaed_app;

revoke select (created_at) on work_item_link from rabaed_app;

create function app.document_times(p_work_item_id uuid)
  returns table (document_id uuid, uploaded_at timestamptz, seq integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        with recursive visible as (
          -- The rows the documents policy shows the acting Member.
          select d.id, d.confirmed_at, d.file_name from document d
          where d.work_item_id = p_work_item_id and d.confirmed_at is not null and d.removed_at is null
            and app.item_row_seen(d.work_item_id, d.arrival, false)
        ), origin as (
          -- Each Document back to the one first uploaded, through any copy of a copy.
          select v.id as document_id, v.id as source_id from visible v
          union all
          select o.document_id, c.copied_from_id from origin o join document_copy c on c.document_id = o.source_id
        )
        select v.id, greatest(v.confirmed_at, w.numbered_at),
          (row_number() over (order by v.confirmed_at, v.file_name, v.id))::integer
        from visible v
        join origin o on o.document_id = v.id
          and not exists (select 1 from document_copy c where c.document_id = o.source_id)
        join document s on s.id = o.source_id
        join work_item w on w.id = s.work_item_id
        order by 3;
    end
  $$;
revoke all on function app.document_times(uuid) from public;
grant execute on function app.document_times(uuid) to rabaed_app;

-- As in the random_ids migration, with created_at no earlier than the item's
-- Creation Date once it is numbered.
create or replace function app.work_item_links(p_work_item_id uuid)
  returns table(id uuid, kind text, field_key text, document_number text, subject text, work_item_id uuid, created_at timestamp with time zone)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select l.id, l.kind, l.field_key, t.document_number, t.title,
          case when app.sees_work_item(t.id) then t.id end, greatest(l.created_at, f.numbered_at)
        from work_item_link l
        join work_item f on f.id = l.from_id
        join work_item t on t.id = l.to_id
        where l.from_id = p_work_item_id and app.sees_work_item(p_work_item_id)
          and app.item_row_seen(l.from_id, l.arrival, l.removed_at is not null)
          and not app.chain_item_hidden(p_work_item_id, t.id)
        order by l.created_at, t.document_number collate "C", l.id;
    end
  $$;
