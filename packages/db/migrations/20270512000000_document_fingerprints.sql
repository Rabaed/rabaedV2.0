-- RP-618 (spec RP-632; ADR 0017, ADR 0023; workflow-engine.md §7; data-model.md,
-- document): every Document's fingerprint, and the content hash over it.
--
-- * document.file_sha256: the SHA-256 of the file's bytes, which the api works out
--   from the stored file when it confirms the upload (app.confirm_document_upload
--   now takes it, and refuses a confirmation without one). Not granted to the app
--   role, like the content hash it goes into (CODING_STANDARDS, Side channels):
--   document is granted column by column (draft_row_times_floor migration), so a
--   new column is nobody's until granted. Null only on Documents confirmed before
--   this migration (dev and UAT data).
-- * Copies carry their source's: a Revision's and a Replacement's through
--   document_copy (a trigger copies it as each copy is recorded), a Duplicate's in
--   app.copy_duplicate_documents. The api copies the bytes too, so it still holds.
-- * app.work_item_content_sha256 names each Document with its fingerprint (hex,
--   or null for one confirmed before this migration). Events written before keep
--   the hash of the older formula (RP-436: without `file_sha256`); the stored hash
--   is what the event and the chain carry, so app.work_item_chain_intact is
--   unchanged and holds over the whole history.

alter table document add column file_sha256 bytea
  constraint document_file_sha256_is_sha256 check (file_sha256 is null or octet_length(file_sha256) = 32);

-- The confirmation, as the checklist migration left it, with the fingerprint.
drop function app.confirm_document_upload(uuid, uuid, bigint, text, timestamptz, timestamptz, double precision, double precision);

create function app.confirm_document_upload(
  p_work_item_id uuid, p_document_id uuid, p_size_bytes bigint, p_content_type text, p_file_sha256 bytea, p_now timestamptz,
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
      -- The api read the stored file: its size, its type and the SHA-256 of its bytes.
      if p_size_bytes is distinct from v_doc.size_bytes or p_content_type is distinct from v_doc.content_type
        or p_file_sha256 is null or octet_length(p_file_sha256) <> 32
      then
        return 'upload_mismatch';
      end if;
      if v_doc.field_key is not null then
        v_refusal := app.field_document_refusal(p_work_item_id, v_doc.field_key, v_doc.content_type, v_doc.id, v_doc.item_key);
        if v_refusal is not null then
          return v_refusal;
        end if;
      end if;
      update document set confirmed_at = v_at, file_sha256 = p_file_sha256, taken_at = p_taken_at,
        taken_latitude = case when p_taken_longitude is not null then p_taken_latitude end,
        taken_longitude = case when p_taken_latitude is not null then p_taken_longitude end
      where id = p_document_id;
      return 'confirmed';
    end
  $$;

revoke all on function
  app.confirm_document_upload(uuid, uuid, bigint, text, bytea, timestamptz, timestamptz, double precision, double precision)
  from public;
grant execute on function
  app.confirm_document_upload(uuid, uuid, bigint, text, bytea, timestamptz, timestamptz, double precision, double precision)
  to rabaed_app;

-- A Revision's or a Replacement's copy takes its source's fingerprint as it is
-- recorded. Only the owner's functions write document_copy.
create function app.document_copy_takes_fingerprint() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    begin
      update document d set file_sha256 = s.file_sha256
      from document s
      where d.id = new.document_id and s.id = new.copied_from_id;
      return new;
    end
  $$;

revoke all on function app.document_copy_takes_fingerprint() from public;

create trigger document_copy_takes_fingerprint after insert on document_copy
  for each row execute function app.document_copy_takes_fingerprint();

-- As the list_row_commands migration left it, with each copy's fingerprint its source's.
create or replace function app.copy_duplicate_documents(p_work_item_id uuid, p_source_id uuid, p_field_keys text[], p_now timestamptz)
  returns table (storage_key text, source_storage_key text, size_bytes bigint)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
    begin
      if not app.sees_work_item(p_source_id) or not app.can_change_documents(p_work_item_id)
        or not exists (
          select 1 from work_item w
          where w.id = p_work_item_id and w.duplicated_from_id = p_source_id and w.duplicate_member_id = app.current_member_id()
        )
      then
        return;
      end if;
      return query
        with source as materialized (
          select gen_random_uuid() as new_id, d.*
          from document d
          where d.work_item_id = p_source_id and d.confirmed_at is not null and d.removed_at is null
            and app.item_row_seen(d.work_item_id, d.arrival, false)
            and d.uploaded_by_participant_id in (select app.current_participant_ids())
            and (d.field_key is null or d.field_key = any (p_field_keys))
          order by d.confirmed_at, d.id
        ), copied as (
          insert into document (
            id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
            uploaded_by_member_id, uploaded_by_participant_id, created_at, confirmed_at,
            field_key, item_key, taken_at, taken_latitude, taken_longitude, file_sha256
          )
          select s.new_id, s.project_id, p_work_item_id, s.file_name, s.size_bytes, s.content_type,
            app.document_storage_key(s.project_id, p_work_item_id, s.new_id),
            app.current_member_id(), s.uploaded_by_participant_id, v_at, v_at,
            s.field_key, s.item_key, s.taken_at, s.taken_latitude, s.taken_longitude, s.file_sha256
          from source s
          returning document.id, document.storage_key
        )
        select c.storage_key, s.storage_key, s.size_bytes from copied c join source s on s.new_id = c.id order by c.id;
    end
  $$;

-- As the transition_confirmed migration left it, with each Document's fingerprint.
create or replace function app.work_item_content_sha256(p_work_item_id uuid, p_title text, p_data jsonb, p_outcome text)
  returns bytea
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return sha256(convert_to(jsonb_build_object(
        'title', p_title,
        'data', p_data,
        'outcome', p_outcome,
        'documents', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', d.id, 'field_key', d.field_key, 'item_key', d.item_key, 'file_name', d.file_name,
              'content_type', d.content_type, 'size_bytes', d.size_bytes, 'storage_key', d.storage_key,
              'file_sha256', encode(d.file_sha256, 'hex'))
            order by d.id)
          from document d
          where d.work_item_id = p_work_item_id and d.confirmed_at is not null and d.removed_at is null), '[]'::jsonb)
      )::text, 'UTF8'));
    end
  $$;
