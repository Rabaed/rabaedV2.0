-- RP-1081 (story 32 of spec RP-649; visibility.md V19, scenarios RP-577-1 and RP-1081-1): a Snag's
-- "Raised from" card shows the failed check item and its photos.
--
-- The photos are the Inspection's own: the Documents the code's shared event took for that item,
-- which app.raise_checklist_snags copied as the Snag's "before" photos (document_copy names each
-- original). This names them, by id, for the api to read through the documents policy as the
-- Member, so a reader gets only the ones member_reads_documents lets them. Like
-- app.raised_from_check_item (20271030000000_snag_hardening.sql), it names none unless the reader
-- sees the Snag and the Inspection, through a `raised_from` Link of a check item not removed.
-- document_copy is never the app role's, hence security definer.

create function app.raised_from_check_item_photos(p_work_item_id uuid) returns table (document_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        select distinct s.id
        from work_item_link l
        join document d on d.work_item_id = l.from_id
        join document_copy c on c.document_id = d.id
        join document s on s.id = c.copied_from_id
        where l.from_id = p_work_item_id and l.kind = 'raised_from' and l.item_key is not null and l.removed_at is null
          and s.work_item_id = l.to_id and s.item_key = l.item_key and s.removed_at is null
          and app.sees_work_item(l.to_id);
    end
  $$;

revoke all on function app.raised_from_check_item_photos(uuid) from public;
grant execute on function app.raised_from_check_item_photos(uuid) to rabaed_app;
