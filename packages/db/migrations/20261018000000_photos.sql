-- The `photos` field: camera capture, with time and GPS kept and shown (RP-284,
-- spec RP-278; form-engine.md §2).
--
-- * A `photos` field is a named file field, as an `attachments` field
--   (field_documents migration), that takes images only: the types in
--   photoContentTypes (domain document.ts), whatever its Form says.
-- * A Document keeps when and where its photo was taken (taken_at,
--   taken_latitude, taken_longitude). The api reads them from the stored
--   file's EXIF when it confirms the upload and passes them to
--   app.confirm_document_upload; the browser's word is never taken. Null when
--   the file records none. They are read as the Document is: by exactly those
--   who see the item (visibility.md V13), and never change once confirmed.

alter table document
  add column taken_at timestamptz,
  add column taken_latitude double precision constraint document_taken_latitude check (taken_latitude between -90 and 90),
  add column taken_longitude double precision constraint document_taken_longitude check (taken_longitude between -180 and 180),
  add constraint document_taken_where check ((taken_latitude is null) = (taken_longitude is null));

-- As in the field_documents migration, for `photos` fields too: their files must
-- be one of the image types.
create or replace function app.field_document_refusal(
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
      where w.id = p_work_item_id and f ->> 'type' in ('attachments', 'photos') and f ->> 'key' = p_field_key
    )
    select case
      when not exists (select 1 from field) then 'field_not_found'
      when (select f ->> 'type' = 'photos' and p_content_type <> all (array['image/jpeg', 'image/png', 'image/webp', 'image/heic']) from field)
        then 'content_type_not_allowed'
      when (select f ? 'contentTypes' and not (f -> 'contentTypes') ? p_content_type from field) then 'content_type_not_allowed'
      when (select (f ->> 'maxFiles')::integer from field) <= (
        select count(*) from document d
        where d.work_item_id = p_work_item_id and d.field_key = p_field_key
          and d.confirmed_at is not null and d.removed_at is null
          and d.id is distinct from p_document_id
      ) then 'too_many_files'
    end
  $$;

drop function app.confirm_document_upload(uuid, uuid, bigint, text, timestamptz);

-- As in the field_documents migration, also keeping the photo's time and place
-- the api read from the stored file (null when it records none).
create function app.confirm_document_upload(
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
        v_refusal := app.field_document_refusal(p_work_item_id, v_doc.field_key, v_doc.content_type, v_doc.id);
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
  app.confirm_document_upload(uuid, uuid, bigint, text, timestamptz, timestamptz, double precision, double precision)
  from public;
grant execute on function
  app.confirm_document_upload(uuid, uuid, bigint, text, timestamptz, timestamptz, double precision, double precision)
  to rabaed_app;
