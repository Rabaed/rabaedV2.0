-- RP-1189: a PDF's page count, stored when its upload is confirmed, for the Submittal Panel's file cards (gap table v3 row 14).
--
-- * document.page_count: the pages the api counted in the stored file's bytes when it confirmed the
--   upload (app.confirm_document_upload now takes it); null for any file that isn't a PDF, a PDF the
--   api couldn't read, and a Document confirmed before this migration. Granted to the app role:
--   who sees the Document sees how many pages it has, as they see its size (document's own RLS).
-- * Copies carry their source's, as the fingerprint does (20270613000000_document_fingerprints): a
--   Revision's and a replacement's through document_copy (a trigger copies it as each copy is
--   recorded), a Duplicate's in app.copy_duplicate_documents.

alter table document add column page_count integer check (page_count > 0);

grant select (page_count) on document to rabaed_app;

-- From 20270827000000_reply_checklist.sql, with the page count.
drop function app.confirm_document_upload(uuid, uuid, bigint, text, bytea, timestamptz, timestamptz, double precision, double precision);

create function app.confirm_document_upload(
  p_work_item_id uuid, p_document_id uuid, p_size_bytes bigint, p_content_type text, p_file_sha256 bytea, p_now timestamptz,
  p_taken_at timestamptz default null, p_taken_latitude double precision default null,
  p_taken_longitude double precision default null, p_page_count integer default null
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
      if v_doc.reply then
        v_refusal := app.reply_documents_refusal(p_work_item_id);
        if v_refusal is null and (v_doc.reply_event_id is not null
          or v_doc.arrival is distinct from (select arrivals from work_item where id = p_work_item_id))
        then
          v_refusal := 'not_editable';
        end if;
        if v_refusal is not null then
          return v_refusal;
        end if;
      elsif not app.can_change_documents(p_work_item_id) then
        return app.documents_refusal(p_work_item_id);
      end if;
      -- The api read the stored file: its size, its type and the SHA-256 of its bytes.
      if p_size_bytes is distinct from v_doc.size_bytes or p_content_type is distinct from v_doc.content_type
        or p_file_sha256 is null or octet_length(p_file_sha256) <> 32
      then
        return 'upload_mismatch';
      end if;
      if v_doc.reply then
        v_refusal := app.reply_field_refusal(p_work_item_id, v_doc.field_key, v_doc.item_key, v_doc.content_type, v_doc.id);
      elsif v_doc.field_key is not null then
        v_refusal := app.field_document_refusal(p_work_item_id, v_doc.field_key, v_doc.content_type, v_doc.id, v_doc.item_key);
      end if;
      if v_refusal is not null then
        return v_refusal;
      end if;
      update document set confirmed_at = v_at, file_sha256 = p_file_sha256, taken_at = p_taken_at,
        taken_latitude = case when p_taken_longitude is not null then p_taken_latitude end,
        taken_longitude = case when p_taken_latitude is not null then p_taken_longitude end,
        -- A PDF's pages only: the api counts none for any other file.
        page_count = case when v_doc.content_type = 'application/pdf' and p_page_count > 0 then p_page_count end
      where id = p_document_id;
      return 'confirmed';
    end
  $$;

revoke all on function
  app.confirm_document_upload(uuid, uuid, bigint, text, bytea, timestamptz, timestamptz, double precision, double precision, integer)
  from public;
grant execute on function
  app.confirm_document_upload(uuid, uuid, bigint, text, bytea, timestamptz, timestamptz, double precision, double precision, integer)
  to rabaed_app;

-- A Revision's or a replacement's copy takes its source's page count as it is recorded, as its fingerprint.
-- Only the owner's functions write document_copy.
create function app.document_copy_takes_page_count() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    begin
      update document d set page_count = s.page_count
      from document s
      where d.id = new.document_id and s.id = new.copied_from_id;
      return new;
    end
  $$;

revoke all on function app.document_copy_takes_page_count() from public;

create trigger document_copy_takes_page_count after insert on document_copy
  for each row execute function app.document_copy_takes_page_count();

-- From 20270613000000_document_fingerprints.sql, with each copy's page count its source's.
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
          -- hidden-sort-key: gives only the upload order, which app.document_times' seq already shows the Member, never a time (as in list_row_commands).
          order by d.confirmed_at, d.id
        ), copied as (
          insert into document (
            id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
            uploaded_by_member_id, uploaded_by_participant_id, created_at, confirmed_at,
            field_key, item_key, taken_at, taken_latitude, taken_longitude, file_sha256, page_count
          )
          select s.new_id, s.project_id, p_work_item_id, s.file_name, s.size_bytes, s.content_type,
            app.document_storage_key(s.project_id, p_work_item_id, s.new_id),
            app.current_member_id(), s.uploaded_by_participant_id, v_at, v_at,
            s.field_key, s.item_key, s.taken_at, s.taken_latitude, s.taken_longitude, s.file_sha256, s.page_count
          from source s
          returning document.id, document.storage_key
        )
        select c.storage_key, s.storage_key, s.size_bytes from copied c join source s on s.new_id = c.id order by c.id;
    end
  $$;
