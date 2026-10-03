-- The `checklist` field: evidence on failure (RP-285, spec RP-278; form-engine.md §3).
--
-- * A checklist's answers (answer and comment, by item key) are stored with the
--   Work Item's other answers: nothing in the database changes for them.
-- * Its photos are Documents, as a `photos` field's are (field_documents and
--   photos migrations), tied to the checklist field by document.field_key and to
--   the item by document.item_key. A checklist's photos are never in the field's
--   own count: the api counts them per item.
-- * app.field_document_refusal takes the item key. With one, the field must be a
--   `checklist` field of the item's pinned Form Version, the item one of its
--   items that takes photos (`photo` is not 'off'), the file an image, and the
--   item below 10 confirmed photos (the most one item takes: maxItemPhotos in
--   domain form.ts). Without one, a `checklist` field takes no file
--   ('field_not_found'), and an `attachments` or `photos` field is as before.
--   The same holds again at confirming, under the same lock.
-- * Everything else is a field Document's: the same signed URLs, Project-prefixed
--   keys, read rules (exactly those who see the item), time and place from EXIF,
--   and freezing at the first Send or Submit (visibility.md V13).
-- * app.answers_sha256 already covers a field's confirmed Documents by id, so a
--   photo added or removed between the check and the Transition is refused
--   ('form_not_checked'), as changed answers are.

alter table document
  add column item_key text constraint document_item_key_format check (item_key ~ '^[a-z][a-z0-9_]*$' and length(item_key) <= 64),
  add constraint document_item_key_needs_field check (item_key is null or field_key is not null);
create index document_item_key_idx on document (work_item_id, field_key, item_key) where item_key is not null;

drop function app.field_document_refusal(uuid, text, text, uuid);

-- Why a file may not go to field p_field_key of a Work Item now (for a checklist
-- field, to its item p_item_key), or null when it may: 'field_not_found' (no such
-- field in the item's pinned Form Version: an `attachments` or `photos` field
-- without an item key, a `checklist` field with one; or an item that takes no
-- photos), 'content_type_not_allowed' (a `photos` field's and an item's files
-- must be images; an `attachments` field's must be one of its types) or
-- 'too_many_files' (the field has its maxFiles confirmed files, an item 10, not
-- counting p_document_id). For the functions below, which have locked the item.
create function app.field_document_refusal(
  p_work_item_id uuid, p_field_key text, p_content_type text, p_document_id uuid, p_item_key text default null
) returns text
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
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
      when (p_item_key is not null or (select f ->> 'type' from field) = 'photos')
        and p_content_type <> all (array['image/jpeg', 'image/png', 'image/webp', 'image/heic']) then 'content_type_not_allowed'
      when p_item_key is null and (select f ? 'contentTypes' and not (f -> 'contentTypes') ? p_content_type from field)
        then 'content_type_not_allowed'
      when case when p_item_key is not null then 10 else (select (f ->> 'maxFiles')::integer from field) end <= (
        select count(*) from document d
        where d.work_item_id = p_work_item_id and d.field_key = p_field_key
          and d.item_key is not distinct from p_item_key
          and d.confirmed_at is not null and d.removed_at is null
          and d.id is distinct from p_document_id
      ) then 'too_many_files'
    end
  $$;

drop function app.start_document_upload(uuid, text, bigint, text, timestamptz, text);

-- As in the field_documents migration, with p_item_key: the checklist item the
-- photo is evidence for (with its checklist field's key as p_field_key).
create function app.start_document_upload(
  p_work_item_id uuid, p_file_name text, p_size_bytes bigint, p_content_type text, p_now timestamptz,
  p_field_key text default null, p_item_key text default null
) returns table (outcome text, document_id uuid, storage_key text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_id uuid := app.uuid_v7();
      v_key text;
      v_refusal text;
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
      if not app.can_change_documents(p_work_item_id) then
        return query select app.documents_refusal(p_work_item_id), null::uuid, null::text;
        return;
      end if;
      if p_item_key is not null and p_field_key is null then
        return query select 'field_not_found'::text, null::uuid, null::text;
        return;
      end if;
      if p_field_key is not null then
        v_refusal := app.field_document_refusal(p_work_item_id, p_field_key, p_content_type, null, p_item_key);
        if v_refusal is not null then
          return query select v_refusal, null::uuid, null::text;
          return;
        end if;
      end if;
      v_key := app.document_storage_key(v_item.project_id, v_item.id, v_id);
      insert into document (
        id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
        uploaded_by_member_id, uploaded_by_participant_id, created_at, field_key, item_key
      ) values (
        v_id, v_item.project_id, v_item.id, btrim(p_file_name), p_size_bytes, p_content_type, v_key,
        app.current_member_id(), v_me.participant_id, v_at, p_field_key, p_item_key
      );
      return query select 'started'::text, v_id, v_key;
    end
  $$;

-- As in the photos migration, checking an item's photo against its checklist
-- again (another upload may have been confirmed since this one started).
create or replace function app.confirm_document_upload(
  p_work_item_id uuid, p_document_id uuid, p_size_bytes bigint, p_content_type text, p_now timestamptz,
  p_taken_at timestamptz default null, p_taken_latitude double precision default null,
  p_taken_longitude double precision default null
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_doc record;
      v_refusal text;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      perform 1 from work_item where id = p_work_item_id for update;
      select * into v_doc from document
      where id = p_document_id and work_item_id = p_work_item_id
        and uploaded_by_member_id = app.current_member_id() and removed_at is null;
      if v_doc.id is null then
        return 'not_found';
      end if;
      if v_doc.confirmed_at is not null then
        return 'confirmed';
      end if;
      if not app.can_change_documents(p_work_item_id) then
        return app.documents_refusal(p_work_item_id);
      end if;
      if p_size_bytes is distinct from v_doc.size_bytes or p_content_type is distinct from v_doc.content_type then
        return 'upload_mismatch';
      end if;
      if v_doc.field_key is not null then
        v_refusal := app.field_document_refusal(p_work_item_id, v_doc.field_key, v_doc.content_type, v_doc.id, v_doc.item_key);
        if v_refusal is not null then
          return v_refusal;
        end if;
      end if;
      update document set confirmed_at = v_at, taken_at = p_taken_at,
        taken_latitude = case when p_taken_longitude is not null then p_taken_latitude end,
        taken_longitude = case when p_taken_latitude is not null then p_taken_longitude end
      where id = p_document_id;
      return 'confirmed';
    end
  $$;

revoke all on function
  app.field_document_refusal(uuid, text, text, uuid, text),
  app.start_document_upload(uuid, text, bigint, text, timestamptz, text, text)
  from public;
grant execute on function
  app.start_document_upload(uuid, text, bigint, text, timestamptz, text, text)
  to rabaed_app;
