-- RP-656: an annotated photo is kept beside its original (spec RP-649, INSP-4).
--
-- * Annotating a photo (arrows, shapes, pen, text, drawn in the browser) never
--   changes the original: its row and its stored bytes stay as they are. The
--   annotated copy is a Document of its own, with its own storage key, linked to
--   the original by document.annotated_from_id. It belongs to the same item, the
--   same field and the same checklist item, so it is read under the same
--   row-level security as the original: exactly where the original is, by
--   nobody else (visibility.md RP-656-1). A copy is newer than its original, so
--   its arrival is never earlier: it can't be seen where the original isn't.
-- * Upload is the same three steps as any Document: app.start_annotated_copy_upload
--   writes the pending row, the browser uploads the drawn image with a signed
--   URL, and app.confirm_document_upload confirms it. Who may annotate, and
--   when, is who may add the item's Documents now (app.can_change_documents);
--   a frozen original, which others may have seen, is not annotated again.
-- * One annotated copy an original: confirming a new one removes the previous
--   one (marked, the file kept, as any removal). Removing the original removes
--   its copy. A copy takes its original's time and place: the drawn image has
--   no EXIF of its own.
-- * Copies don't count toward a field's maximum of files, nor a checklist
--   item's 10 photos, and a field's file types apply to the original only
--   (app.field_document_refusal).
-- * A Revision copies an item's Documents, copies with them; the new copy is
--   linked to the new original (a trigger on document_copy, so the functions
--   that copy are not redefined).

alter table document add column annotated_from_id uuid;
alter table document add constraint document_id_work_item_key unique (id, work_item_id);
-- The original is on the same item.
alter table document add constraint document_annotated_from_fk
  foreign key (annotated_from_id, work_item_id) references document (id, work_item_id);
alter table document add constraint document_not_annotated_from_itself check (annotated_from_id <> id);
create index document_annotated_from_id_idx on document (annotated_from_id) where annotated_from_id is not null;
-- At most one live annotated copy an original.
create unique index document_one_annotated_copy on document (annotated_from_id)
  where annotated_from_id is not null and confirmed_at is not null and removed_at is null;

-- Everyone who sees the original sees which copy belongs to it.
grant select (annotated_from_id) on document to rabaed_app;

-- Step 1 of saving an annotated copy: the acting Member declares the drawn image
-- for a visible, confirmed, not removed original photo of the item. Outcome
-- 'started' with the new row and its storage key, or 'not_found' (the item or
-- the original unseen, or the original itself a copy), 'project_closed',
-- 'forbidden', 'not_editable', 'document_frozen' (the original is frozen) or
-- 'content_type_not_allowed' (the original isn't a photo, or the copy isn't an
-- image a browser draws). The api has checked the size against its limits.
create function app.start_annotated_copy_upload(
  p_work_item_id uuid, p_original_id uuid, p_file_name text, p_size_bytes bigint, p_content_type text, p_now timestamptz
) returns table (outcome text, document_id uuid, storage_key text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_original record;
      v_id uuid := gen_random_uuid();
      v_key text;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::uuid, null::text;
        return;
      end if;
      -- Locked, so a Transition out of Draft can't pass in between.
      select w.id, w.project_id into v_item from work_item w where w.id = p_work_item_id for update;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_me.project_member_id is null then
        return query select 'not_found'::text, null::uuid, null::text;
        return;
      end if;
      -- The original as the Member reads it: under the same rule as the documents' RLS.
      select d.* into v_original from document d
      where d.id = p_original_id and d.work_item_id = p_work_item_id
        and d.confirmed_at is not null and d.removed_at is null and d.annotated_from_id is null
        and app.item_row_seen(d.work_item_id, d.arrival, false);
      if v_original.id is null then
        return query select 'not_found'::text, null::uuid, null::text;
        return;
      end if;
      if not app.can_change_documents(p_work_item_id) then
        return query select app.documents_refusal(p_work_item_id), null::uuid, null::text;
        return;
      end if;
      if v_original.frozen_at is not null then
        return query select 'document_frozen'::text, null::uuid, null::text;
        return;
      end if;
      if v_original.field_key is not null and v_original.field_key = any (app.locked_field_keys(p_work_item_id)) then
        return query select 'not_editable'::text, null::uuid, null::text;
        return;
      end if;
      if v_original.content_type <> all (array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
        or p_content_type <> all (array['image/jpeg', 'image/png', 'image/webp']) then
        return query select 'content_type_not_allowed'::text, null::uuid, null::text;
        return;
      end if;
      v_key := app.document_storage_key(v_item.project_id, v_item.id, v_id);
      insert into document (
        id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
        uploaded_by_member_id, uploaded_by_participant_id, created_at, field_key, item_key, annotated_from_id
      ) values (
        v_id, v_item.project_id, v_item.id, btrim(p_file_name), p_size_bytes, p_content_type, v_key,
        app.current_member_id(), v_me.participant_id, v_at, v_original.field_key, v_original.item_key, v_original.id
      );
      return query select 'started'::text, v_id, v_key;
    end
  $$;

-- A copy being confirmed: it takes its original's time and place, and the
-- previous copy of that original is removed. Not a frozen one: a copy is never
-- frozen while its original isn't, and a frozen original takes no new copy.
create function app.confirm_annotated_copy() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_original record;
    begin
      select taken_at, taken_latitude, taken_longitude into v_original from document where id = new.annotated_from_id;
      new.taken_at := v_original.taken_at;
      new.taken_latitude := v_original.taken_latitude;
      new.taken_longitude := v_original.taken_longitude;
      update document set removed_at = new.confirmed_at, removed_by_member_id = new.uploaded_by_member_id
      where annotated_from_id = new.annotated_from_id and id <> new.id
        and confirmed_at is not null and removed_at is null and frozen_at is null;
      return new;
    end
  $$;
create trigger document_annotated_copy_confirmed before update of confirmed_at on document
  for each row when (old.confirmed_at is null and new.confirmed_at is not null and new.annotated_from_id is not null)
  execute function app.confirm_annotated_copy();

-- An original removed: its annotated copy goes with it, by the same Member at the same time.
create function app.remove_annotated_copies() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      update document set removed_at = new.removed_at, removed_by_member_id = new.removed_by_member_id
      where annotated_from_id = new.id and removed_at is null and frozen_at is null;
      return null;
    end
  $$;
create trigger document_removes_annotated_copies after update of removed_at on document
  for each row when (old.removed_at is null and new.removed_at is not null and new.annotated_from_id is null)
  execute function app.remove_annotated_copies();

-- A Revision's (or replacement's) copy of an annotated copy is linked to the
-- copy of its original on the new item. Row triggers fire once the whole copying
-- statement is done, so the original's copy is there.
create function app.link_copied_annotated_copy() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      update document d set annotated_from_id = o.document_id
      from document source, document_copy o, document copied_original
      where d.id = new.document_id and source.id = new.copied_from_id and source.annotated_from_id is not null
        and o.copied_from_id = source.annotated_from_id
        and copied_original.id = o.document_id and copied_original.work_item_id = d.work_item_id;
      return null;
    end
  $$;
create trigger document_copy_links_annotated_copy after insert on document_copy
  for each row execute function app.link_copied_annotated_copy();

-- As in the plpgsql_definer_helpers migration, except that annotated copies
-- don't count toward the field's (or the checklist item's) maximum, and a copy
-- being confirmed is checked for its field only: its original already counts,
-- and was checked for its type (a PNG-only field takes a photo's JPEG copy).
create or replace function app.field_document_refusal(p_work_item_id uuid, p_field_key text, p_content_type text, p_document_id uuid, p_item_key text default null) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        with field as (
          select f
          from work_item w
          join form_version v on v.id = w.form_version_id
          cross join lateral jsonb_array_elements(v.schema -> 'sections') s
          cross join lateral jsonb_array_elements(s -> 'fields') f
          where w.id = p_work_item_id and f ->> 'key' = p_field_key
            and ((p_item_key is null and f ->> 'type' in ('attachments', 'photos')) or (p_item_key is not null and f ->> 'type' = 'checklist'))
        ),
        item as (
          select i
          from field cross join lateral jsonb_array_elements(f -> 'items') i
          where i ->> 'key' = p_item_key and coalesce(i ->> 'photo', 'off') <> 'off'
        )
        select case
          when not exists (select 1 from field) then 'field_not_found'
          when p_item_key is not null and not exists (select 1 from item) then 'field_not_found'
          -- An annotated copy goes where its original is, whatever its own type: the original was checked.
          when exists (select 1 from document c where c.id = p_document_id and c.annotated_from_id is not null) then null
          when (p_item_key is not null or (select f ->> 'type' from field) = 'photos')
            and p_content_type <> all (array['image/jpeg', 'image/png', 'image/webp', 'image/heic']) then 'content_type_not_allowed'
          when p_item_key is null and (select f ? 'contentTypes' and not (f -> 'contentTypes') ? p_content_type from field)
            then 'content_type_not_allowed'
          when case when p_item_key is not null then 10 else (select (f ->> 'maxFiles')::integer from field) end <= (
            select count(*) from document d
            where d.work_item_id = p_work_item_id and d.field_key = p_field_key
              and d.item_key is not distinct from p_item_key
              and d.confirmed_at is not null and d.removed_at is null
              and d.annotated_from_id is null
              and d.id is distinct from p_document_id
          ) then 'too_many_files'
        end
      );
    end
  $$;

revoke all on function
  app.start_annotated_copy_upload(uuid, uuid, text, bigint, text, timestamptz),
  app.confirm_annotated_copy(),
  app.remove_annotated_copies(),
  app.link_copied_annotated_copy()
  from public;
grant execute on function
  app.start_annotated_copy_upload(uuid, uuid, text, bigint, text, timestamptz)
  to rabaed_app;
