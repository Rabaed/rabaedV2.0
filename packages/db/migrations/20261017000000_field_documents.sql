-- Named `attachments` fields: required documents inside the Form (RP-281, spec
-- RP-278; form-engine.md §2; ADR 0007).
--
-- * A Document may name the Form field it belongs to (document.field_key). One
--   without a field key stays in the Attachments System Field (RP-269).
-- * app.start_document_upload takes the field key. The field must be an
--   `attachments` field of the item's pinned Form Version, the file one of its
--   `contentTypes` (when it sets any), and the field below its `maxFiles`
--   confirmed files. The same holds again at confirming, under the same lock, so
--   two uploads started together can't pass `maxFiles`. Outcomes as before, and
--   'field_not_found', 'content_type_not_allowed' or 'too_many_files'.
-- * Everything else is the Attachments System Field's: the same signed URLs,
--   Project-prefixed keys, read rules (a field's Documents are seen exactly by
--   those who see the item), and freezing at the first Send or Submit.
-- * An `attachments` field holds no answer, so app.work_item_answers has nothing
--   new to strip (ADR 0012); `required` and `minFiles` are checked by the api's
--   validator against the confirmed files when the item leaves Draft.
-- * app.answers_sha256 covers the fields' confirmed Documents too, so a file
--   added or removed between that check and the Transition is refused
--   ('form_not_checked'), as changed answers are. With no field Documents it
--   is the hash it was.

alter table document add column field_key text
  constraint document_field_key_format check (field_key ~ '^[a-z][a-z0-9_]*$' and length(field_key) <= 64);
create index document_field_key_idx on document (work_item_id, field_key) where field_key is not null;

-- Why a file may not go to field p_field_key of a Work Item now, or null when it
-- may: 'field_not_found' (no `attachments` field of that key in the item's
-- pinned Form Version), 'content_type_not_allowed' (not one of the field's
-- types) or 'too_many_files' (the field has its maxFiles confirmed files, not
-- counting p_document_id). For the functions below, which have locked the item.
create function app.field_document_refusal(
  p_work_item_id uuid, p_field_key text, p_content_type text, p_document_id uuid
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
      where w.id = p_work_item_id and f ->> 'type' = 'attachments' and f ->> 'key' = p_field_key
    )
    select case
      when not exists (select 1 from field) then 'field_not_found'
      when (select f ? 'contentTypes' and not (f -> 'contentTypes') ? p_content_type from field) then 'content_type_not_allowed'
      when (select (f ->> 'maxFiles')::integer from field) <= (
        select count(*) from document d
        where d.work_item_id = p_work_item_id and d.field_key = p_field_key
          and d.confirmed_at is not null and d.removed_at is null
          and d.id is distinct from p_document_id
      ) then 'too_many_files'
    end
  $$;

-- The hash a Transition checks ------------------------------------------------------

-- As in the answers_stripping migration (the full answers, only while they are
-- open), followed by the ids of the fields' confirmed Documents, in order.
create or replace function app.answers_sha256(p_work_item_id uuid) returns bytea
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select sha256(convert_to(app.work_item_full_answers(p_work_item_id)::text || coalesce((
      select string_agg(d.field_key || ':' || d.id::text, ',' order by d.field_key, d.id)
      from document d
      where d.work_item_id = p_work_item_id and d.field_key is not null
        and d.confirmed_at is not null and d.removed_at is null
    ), ''), 'UTF8'))
    where app.answers_open(p_work_item_id)
  $$;

-- Upload ------------------------------------------------------------------------------

drop function app.start_document_upload(uuid, text, bigint, text, timestamptz);

-- As in the documents migration, with p_field_key: the `attachments` field the
-- file is for, or null for the Attachments System Field.
create function app.start_document_upload(
  p_work_item_id uuid, p_file_name text, p_size_bytes bigint, p_content_type text, p_now timestamptz,
  p_field_key text default null
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
      if p_field_key is not null then
        v_refusal := app.field_document_refusal(p_work_item_id, p_field_key, p_content_type, null);
        if v_refusal is not null then
          return query select v_refusal, null::uuid, null::text;
          return;
        end if;
      end if;
      v_key := app.document_storage_key(v_item.project_id, v_item.id, v_id);
      insert into document (
        id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
        uploaded_by_member_id, uploaded_by_participant_id, created_at, field_key
      ) values (
        v_id, v_item.project_id, v_item.id, btrim(p_file_name), p_size_bytes, p_content_type, v_key,
        app.current_member_id(), v_me.participant_id, v_at, p_field_key
      );
      return query select 'started'::text, v_id, v_key;
    end
  $$;

-- As in the documents migration, checking a field's Document against its field
-- again (another upload may have been confirmed since this one started).
create or replace function app.confirm_document_upload(
  p_work_item_id uuid, p_document_id uuid, p_size_bytes bigint, p_content_type text, p_now timestamptz
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
        v_refusal := app.field_document_refusal(p_work_item_id, v_doc.field_key, v_doc.content_type, v_doc.id);
        if v_refusal is not null then
          return v_refusal;
        end if;
      end if;
      update document set confirmed_at = v_at where id = p_document_id;
      return 'confirmed';
    end
  $$;

revoke all on function
  app.field_document_refusal(uuid, text, text, uuid),
  app.start_document_upload(uuid, text, bigint, text, timestamptz, text)
  from public;
grant execute on function
  app.start_document_upload(uuid, text, bigint, text, timestamptz, text)
  to rabaed_app;
