-- RP-981: annotating a reply Screen's photo (INSP-12, spec RP-649; ADR 0024 and its amendment,
-- visibility.md V19, scenario RP-981-1).
--
-- RP-656's tool saves an annotated copy beside the original. For a photo of the item's Form it is a
-- Form Document, gated on app.can_change_documents. A reply Screen's photo (a Snag Resolve's After
-- photo, a WIR checklist item's photo, RP-623 and RP-86) is a reply Document: the holding
-- Participant's until the Transition that takes it. Its annotated copy is one too:
-- * `reply = true`, in the original's field and check item, so the Transition that takes the
--   original freezes it, names itself as its event and covers it in its content hash
--   (app.attach_reply_files_to_transition), and leaving the Participant any other way discards it
--   (app.discard_reply_files_on_leaving). It takes the item's current arrival, as the original did,
--   so only the holder reads it until then (V19).
-- * Annotating one is gated on the holder's right to add to that field now
--   (app.reply_documents_refusal and app.reply_field_refusal), never on app.can_change_documents:
--   that gate would make it a Form Document, shared before the code.
-- * A copy never counts toward the field's maxFiles or a check item's 10 photos
--   (app.reply_field_refusal lets it through once its field is found, as
--   app.field_document_refusal does), and is never confirmed once a Transition took its
--   original. The count both kinds of field shared is now app.reply_files_waiting.
-- * A trigger refuses any annotated copy that isn't where its original is: another `reply`,
--   field or check item. So a reply photo's copy is never a Form Document, however it is written.
-- app.confirm_document_upload, the Documents copy, app.take_transition and app.transition_effects
-- are unchanged.

-- The photos and files waiting in reply field `p_field_key` (its check item `p_item_key`'s, for a
-- checklist) that no Transition took yet, besides `p_except`: originals only, an annotated copy
-- counting toward no limit. The block app.reply_field_refusal had copied for both kinds of field
-- since the reply_checklist migration (RP-86), extracted for its next redefinition (spec RP-649).
create function app.reply_files_waiting(p_work_item_id uuid, p_field_key text, p_item_key text, p_except uuid)
  returns bigint
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select count(*) from document d
        where d.work_item_id = p_work_item_id and d.reply and d.reply_event_id is null
          and d.field_key = p_field_key and d.item_key is not distinct from p_item_key
          and d.confirmed_at is not null and d.removed_at is null
          and d.annotated_from_id is null and d.id is distinct from p_except
      );
    end
  $$;

-- As in the reply_checklist migration (its counts through app.reply_files_waiting), except for an
-- annotated copy being confirmed: it is checked for its field only, its original already counting
-- and checked for its type; and 'not_editable' once a Transition took its original (a copy goes
-- where its original is, and a taken original takes no new copy).
create or replace function app.reply_field_refusal(p_work_item_id uuid, p_field_key text, p_item_key text, p_content_type text, p_document_id uuid)
  returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_field jsonb := app.reply_file_field(p_work_item_id, p_field_key);
      v_item jsonb;
      -- For an annotated copy, whether a Transition took its original; null for any other file.
      v_original_taken boolean := (
        select o.reply_event_id is not null or o.frozen_at is not null
        from document c join document o on o.id = c.annotated_from_id
        where c.id = p_document_id);
    begin
      if v_field ->> 'type' = 'copied_checklist' then
        v_item := app.reply_checklist_item(p_work_item_id, v_field, p_item_key);
        return case
          when v_item is null or coalesce(v_item ->> 'photo', 'off') = 'off' then 'field_not_found'
          when v_original_taken then 'not_editable'
          when v_original_taken is not null then null
          when p_content_type <> all (array['image/jpeg', 'image/png', 'image/webp', 'image/heic']) then 'content_type_not_allowed'
          when 10 <= app.reply_files_waiting(p_work_item_id, p_field_key, p_item_key, p_document_id) then 'too_many_files'
        end;
      end if;
      return case
        when v_field is null or p_item_key is not null then 'field_not_found'
        when v_original_taken then 'not_editable'
        when v_original_taken is not null then null
        when v_field ->> 'type' = 'photos'
          and p_content_type <> all (array['image/jpeg', 'image/png', 'image/webp', 'image/heic']) then 'content_type_not_allowed'
        when v_field ? 'contentTypes' and not (v_field -> 'contentTypes') ? p_content_type then 'content_type_not_allowed'
        when (v_field ->> 'maxFiles')::integer <= app.reply_files_waiting(p_work_item_id, p_field_key, null, p_document_id) then 'too_many_files'
      end;
    end
  $$;

-- As in the annotated_photos migration, except that a reply Document's photo is annotated by the
-- Members who may add to its field now, and its copy is a reply Document too.
create or replace function app.start_annotated_copy_upload(
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
      v_refusal text;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::uuid, null::text;
        return;
      end if;
      -- Locked, so a Transition out of Draft, or one taking the reply files, can't pass in between.
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
      if v_original.reply then
        -- A reply Screen's photo (ADR 0024): whoever may add to its field now. The original is named
        -- as the file being checked, so it isn't counted twice against the field's limit.
        v_refusal := coalesce(
          app.reply_documents_refusal(p_work_item_id),
          app.reply_field_refusal(p_work_item_id, v_original.field_key, v_original.item_key, v_original.content_type, v_original.id));
        if v_refusal is not null then
          return query select v_refusal, null::uuid, null::text;
          return;
        end if;
      elsif not app.can_change_documents(p_work_item_id) then
        return query select app.documents_refusal(p_work_item_id), null::uuid, null::text;
        return;
      end if;
      if v_original.frozen_at is not null then
        return query select 'document_frozen'::text, null::uuid, null::text;
        return;
      end if;
      if not v_original.reply and v_original.field_key is not null and v_original.field_key = any (app.locked_field_keys(p_work_item_id)) then
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
        uploaded_by_member_id, uploaded_by_participant_id, created_at, field_key, item_key, annotated_from_id, reply
      ) values (
        v_id, v_item.project_id, v_item.id, btrim(p_file_name), p_size_bytes, p_content_type, v_key,
        app.current_member_id(), v_me.participant_id, v_at, v_original.field_key, v_original.item_key, v_original.id,
        v_original.reply
      );
      return query select 'started'::text, v_id, v_key;
    end
  $$;

-- An annotated copy goes where its original is: the same `reply`, field and check item. A reply
-- photo's copy written as a Form Document would be shared before the Transition that takes the
-- original (V19), so it is refused, whoever writes it.
create function app.annotated_copy_where_original_is() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if exists (
        select 1 from document o
        where o.id = new.annotated_from_id
          and (o.reply <> new.reply or o.field_key is distinct from new.field_key or o.item_key is distinct from new.item_key)
      ) then
        raise exception 'Annotated copy % is not where its original % is', new.id, new.annotated_from_id using errcode = '23514';
      end if;
      return new;
    end
  $$;
create trigger document_annotated_copy_where_original_is before insert or update of annotated_from_id, reply, field_key, item_key
  on document
  for each row when (new.annotated_from_id is not null)
  execute function app.annotated_copy_where_original_is();

revoke all on function app.annotated_copy_where_original_is(), app.reply_files_waiting(uuid, text, text, uuid) from public;
