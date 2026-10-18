-- RP-623: a reply Screen may hold files (ADR 0024; workflow-engine.md §5.7, form-engine.md §4).
--
-- A Screen's `photos` and `attachments` fields hold no answer: their files are Documents on
-- the item (`document.reply`), tied to the Screen's field by its key, never part of the
-- Transition event's payload.
-- * Members of the Participant holding the item add and remove them over time, at the
--   from-Steps of any Transition whose Screen holds the field (`app.reply_file_field`),
--   with the Module's `attach` permission (`app.reply_documents_refusal`).
-- * Until that Transition, only the holding Participant sees them: they take the item's
--   current arrival, as every Document does (`app.item_row_seen`, V19). A move within that
--   Participant keeps them.
-- * The Transition freezes them, names itself as theirs (`document.reply_event_id`) and
--   covers them in its content hash (ADR 0017): `work_item_event_attach_reply_files`,
--   before `work_item_event_chain`, so the event's chain hash covers that hash. Until then
--   `app.work_item_content_sha256` leaves them out.
-- * Leaving the Participant any other way (a Send Back, a Submit whose Screen lacks the field), or closing,
--   discards them (`work_item_discards_reply_files`, before
--   `work_item_freezes_documents_at_submit`).
-- * One set per Transition: the field's file limit counts the files no Transition has
--   taken yet, so the next Resolve after a Return starts empty.
-- `app.take_transition` and `app.transition_effects` are unchanged (RP-603, 14087).

alter table document add column reply boolean not null default false;
alter table document add column reply_event_id uuid;
-- Deferred: the event names the files before its own row is inserted (the trigger below).
alter table document add constraint document_reply_event_fk
  foreign key (reply_event_id) references work_item_event (id) deferrable initially deferred;
alter table document add constraint document_reply_event_is_reply check (reply_event_id is null or reply);
alter table document add constraint document_reply_has_field check (not reply or (field_key is not null and item_key is null));
create index document_pending_reply_idx on document (work_item_id)
  where reply and reply_event_id is null and removed_at is null;

grant select (reply, reply_event_id) on document to rabaed_app;

-- Which field ---------------------------------------------------------------------------

-- The file field `p_field_key` of a Screen shown by a Transition out of the item's current
-- Step (its Action Form holds the Screen's schema since its Workflow Version was published),
-- or null. A key the item's Form also uses is never a reply field: Documents are found by
-- their field's key.
create function app.reply_file_field(p_work_item_id uuid, p_field_key text) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
    select f
    from work_item w
    join workflow_transition t on t.from_step_id = w.current_step_id
    cross join lateral jsonb_array_elements(coalesce(t.action_form -> 'sections', '[]')) s
    cross join lateral jsonb_array_elements(coalesce(s -> 'fields', '[]')) f
    where w.id = p_work_item_id and w.closed_at is null and t.screen_version_id is not null
      and f ->> 'key' = p_field_key and f ->> 'type' in ('attachments', 'photos')
      and not exists (
        select 1 from form_version v
        cross join lateral jsonb_array_elements(v.schema -> 'sections') fs
        cross join lateral jsonb_array_elements(fs -> 'fields') ff
        where v.id = w.form_version_id and ff ->> 'key' = p_field_key)
    order by t.key
    limit 1
      );
    end
  $$;

-- Who may change them -------------------------------------------------------------------

-- Null when the acting Member may add or remove the item's reply files now: an active
-- Member of the Participant holding its current Step, with the Module's `attach` permission,
-- on an open item of an active Project. Otherwise 'project_closed', 'not_editable' (another
-- Participant holds it, or it is closed) or 'forbidden' (no `attach`); 'not_found' for an
-- item the Member doesn't see.
create function app.reply_documents_refusal(p_work_item_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_item record;
      v_me record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.id, w.closed_at, w.current_step_id, pr.status as project_status, t.module_key
      into v_item
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      where w.id = p_work_item_id;
      if v_item.project_status is distinct from 'active' then
        return 'project_closed';
      end if;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_me.project_member_id is null or v_item.closed_at is not null or not exists (
        select 1 from step_assignment h
        where h.work_item_id = p_work_item_id and h.step_id = v_item.current_step_id
          and h.status in ('pooled', 'picked_up', 'vacant') and h.participant_id = v_me.participant_id
      ) then
        return 'not_editable';
      end if;
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, 'attach') then
        return 'forbidden';
      end if;
      return null;
    end
  $$;

-- Null when a file of `p_content_type` may go in the reply field `p_field_key` now (besides
-- the Document `p_document_id` being confirmed): 'field_not_found', 'content_type_not_allowed'
-- or 'too_many_files'. The limit counts the files no Transition has taken yet.
create function app.reply_field_refusal(p_work_item_id uuid, p_field_key text, p_content_type text, p_document_id uuid)
  returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_field jsonb := app.reply_file_field(p_work_item_id, p_field_key);
    begin
      return case
        when v_field is null then 'field_not_found'
        when v_field ->> 'type' = 'photos'
          and p_content_type <> all (array['image/jpeg', 'image/png', 'image/webp', 'image/heic']) then 'content_type_not_allowed'
        when v_field ? 'contentTypes' and not (v_field -> 'contentTypes') ? p_content_type then 'content_type_not_allowed'
        when (v_field ->> 'maxFiles')::integer <= (
          select count(*) from document d
          where d.work_item_id = p_work_item_id and d.reply and d.reply_event_id is null
            and d.field_key = p_field_key and d.confirmed_at is not null and d.removed_at is null
            and d.annotated_from_id is null and d.id is distinct from p_document_id
        ) then 'too_many_files'
      end;
    end
  $$;

-- Uploading -----------------------------------------------------------------------------

-- As app.start_document_upload, for a reply field: outcome 'started', 'not_found', or a
-- refusal above. The file takes the item's current arrival, so only the holding
-- Participant sees it until the item leaves it.
create function app.start_reply_document_upload(
  p_work_item_id uuid, p_field_key text, p_file_name text, p_size_bytes bigint, p_content_type text, p_now timestamptz
) returns table (outcome text, document_id uuid, storage_key text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_id uuid := gen_random_uuid();
      v_key text;
      v_refusal text;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::uuid, null::text;
        return;
      end if;
      -- Locked, so the Transition taking the field's files can't pass in between.
      select w.id, w.project_id into v_item from work_item w where w.id = p_work_item_id for update;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_me.project_member_id is null then
        return query select 'not_found'::text, null::uuid, null::text;
        return;
      end if;
      v_refusal := coalesce(
        app.reply_documents_refusal(p_work_item_id),
        app.reply_field_refusal(p_work_item_id, p_field_key, p_content_type, null));
      if v_refusal is not null then
        return query select v_refusal, null::uuid, null::text;
        return;
      end if;
      v_key := app.document_storage_key(v_item.project_id, v_item.id, v_id);
      insert into document (
        id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
        uploaded_by_member_id, uploaded_by_participant_id, created_at, field_key, reply
      ) values (
        v_id, v_item.project_id, v_item.id, btrim(p_file_name), p_size_bytes, p_content_type, v_key,
        app.current_member_id(), v_me.participant_id, v_at, p_field_key, true
      );
      return query select 'started'::text, v_id, v_key;
    end
  $$;

-- As the document_fingerprints migration left it; a reply file is checked as one, and only
-- in the arrival it was started in (an upload not finished before the item left is never
-- confirmed).
create or replace function app.confirm_document_upload(
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
        v_refusal := app.reply_field_refusal(p_work_item_id, v_doc.field_key, v_doc.content_type, v_doc.id);
      elsif v_doc.field_key is not null then
        v_refusal := app.field_document_refusal(p_work_item_id, v_doc.field_key, v_doc.content_type, v_doc.id, v_doc.item_key);
      end if;
      if v_refusal is not null then
        return v_refusal;
      end if;
      update document set confirmed_at = v_at, file_sha256 = p_file_sha256, taken_at = p_taken_at,
        taken_latitude = case when p_taken_longitude is not null then p_taken_latitude end,
        taken_longitude = case when p_taken_latitude is not null then p_taken_longitude end
      where id = p_document_id;
      return 'confirmed';
    end
  $$;

-- As in the documents migration; a reply file is removed by the Members who may change the
-- reply files, until a Transition takes it.
create or replace function app.remove_document(p_work_item_id uuid, p_document_id uuid, p_now timestamptz) returns text
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
        and confirmed_at is not null and removed_at is null;
      if v_doc.id is null then
        return 'not_found';
      end if;
      if v_doc.frozen_at is not null then
        return 'document_frozen';
      end if;
      if v_doc.reply then
        v_refusal := app.reply_documents_refusal(p_work_item_id);
        if v_refusal is not null then
          return v_refusal;
        end if;
      elsif not app.can_change_documents(p_work_item_id) then
        return app.documents_refusal(p_work_item_id);
      end if;
      update document set removed_at = v_at, removed_by_member_id = app.current_member_id() where id = p_document_id;
      return 'removed';
    end
  $$;

-- The Transition takes them -------------------------------------------------------------

-- A Transition whose Screen holds file fields takes the files waiting in them: they freeze,
-- name the Transition's event, and its content hash is taken again with them in it (the
-- hash in the row was taken before they were the item's content). A required field, or one
-- with too few files, refuses the Transition (the api checks it first, with the counts).
create function app.attach_reply_files_to_transition() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_fields jsonb;
      v_item record;
      v_short text;
    begin
      select jsonb_agg(f) into v_fields
      from workflow_transition t
      cross join lateral jsonb_array_elements(coalesce(t.action_form -> 'sections', '[]')) s
      cross join lateral jsonb_array_elements(coalesce(s -> 'fields', '[]')) f
      where t.id = new.transition_id and t.screen_version_id is not null and f ->> 'type' in ('attachments', 'photos');
      if v_fields is null then
        return new;
      end if;
      update document d set reply_event_id = new.id, frozen_at = new.created_at
      where d.work_item_id = new.work_item_id and d.reply and d.reply_event_id is null
        and d.confirmed_at is not null and d.removed_at is null
        and d.field_key in (select f ->> 'key' from jsonb_array_elements(v_fields) f);
      if found and new.content_sha256 is not null then
        select w.title, w.data into v_item from work_item w where w.id = new.work_item_id;
        new.content_sha256 := app.work_item_content_sha256(new.work_item_id, v_item.title, v_item.data, new.payload ->> 'outcome');
      end if;
      select f ->> 'key' into v_short
      from jsonb_array_elements(v_fields) f
      where f -> 'visible_if' is null
        and greatest(case when f -> 'required' = 'true' then 1 else 0 end, coalesce((f ->> 'minFiles')::integer, 0)) > (
          select count(*) from document d
          where d.work_item_id = new.work_item_id and d.field_key = f ->> 'key' and d.annotated_from_id is null
            -- The Owner's review writes the Transition twice (one event for each Participant): the first took them.
            and (d.reply_event_id = new.id or d.reply_event_id in (
              select e.id from work_item_event e
              where e.work_item_id = new.work_item_id and e.transition_id = new.transition_id and e.created_at = new.created_at)))
      limit 1;
      if v_short is not null then
        raise exception 'Transition % needs files in %', new.transition_id, v_short using errcode = '23514';
      end if;
      return new;
    end
  $$;

-- Before work_item_event_chain (triggers fire in name order), so the chain covers the hash.
create trigger work_item_event_attach_reply_files before insert on work_item_event
  for each row when (new.type in ('transition', 'issue_code') and new.transition_id is not null)
  execute function app.attach_reply_files_to_transition();

-- Leaving the holding Participant any other way, or closing, discards the files no
-- Transition took, as V19 discards in-progress answers. They go before the Submit's freeze
-- (work_item_freezes_documents_at_submit fires after this, in name order), which would
-- otherwise freeze them.
create function app.discard_reply_files_on_leaving() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      -- Named as removed by its uploader: the Member who took the item away may be another Company's (V14).
      update document d set removed_at = new.updated_at, removed_by_member_id = d.uploaded_by_member_id
      where d.work_item_id = new.id and d.reply and d.reply_event_id is null
        and d.confirmed_at is not null and d.removed_at is null;
      return null;
    end
  $$;

create trigger work_item_discards_reply_files after update of participant_entered_at, participant_entered_step_id, closed_at
  on work_item
  for each row when (
    old.participant_entered_at is distinct from new.participant_entered_at
    or old.participant_entered_step_id is distinct from new.participant_entered_step_id
    or (old.closed_at is null and new.closed_at is not null)
  )
  execute function app.discard_reply_files_on_leaving();

-- The content hash ----------------------------------------------------------------------

-- As the document_fingerprints migration left it, leaving out a reply file until the
-- Transition that takes it: until then it is not the item's content (ADR 0017, ADR 0024).
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
          where d.work_item_id = p_work_item_id and d.confirmed_at is not null and d.removed_at is null
            and (not d.reply or d.reply_event_id is not null)), '[]'::jsonb)
      )::text, 'UTF8'));
    end
  $$;

-- As in the answer_permission_speed migration, without the reply files: they are no answer of
-- the Form's, and another Member of the holder adding one never makes the Form's hash stale.
create or replace function app.answers_sha256_of(p_work_item_id uuid, p_open boolean) returns bytea
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select sha256(convert_to(
      (case when p_open then app.work_item_full_answers(p_work_item_id)
        else app.work_item_answers(p_work_item_id) end)::text || coalesce((
      select string_agg(d.field_key || ':' || d.id::text, ',' order by d.field_key, d.id)
      from document d
      where d.work_item_id = p_work_item_id and d.field_key is not null and not d.reply
        and d.confirmed_at is not null and d.removed_at is null
    ), ''), 'UTF8'))
  $$;

-- An Action Form's answers --------------------------------------------------------------

-- As in the review_fixes migration, except that a file field takes no answer (its files are
-- Documents) and its `required` is checked against them, when the Transition takes them.
create or replace function app.action_form_fits(p_schema jsonb, p_answers jsonb) returns boolean
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    with fields as (
      select s, f from jsonb_array_elements(coalesce(p_schema -> 'sections', '[]')) s
      cross join lateral jsonb_array_elements(s -> 'fields') f
    )
    select coalesce(jsonb_typeof(p_answers) = 'object', false)
      and not exists (
        select 1 from jsonb_object_keys(case when jsonb_typeof(p_answers) = 'object' then p_answers else '{}' end) k
        where not exists (select 1 from fields where f ->> 'key' = k and f ->> 'type' not in ('attachments', 'photos')))
      and not exists (
        select 1 from fields
        where f -> 'required' = 'true' and s -> 'visible_if' is null and f -> 'visible_if' is null
          and f ->> 'type' not in ('attachments', 'photos')
          and (p_answers -> (f ->> 'key') is null
            or p_answers -> (f ->> 'key') in ('null', '[]')
            or (jsonb_typeof(p_answers -> (f ->> 'key')) = 'string' and btrim(p_answers ->> (f ->> 'key')) = '')))
  $$;

revoke all on function
  app.reply_file_field(uuid, text),
  app.reply_documents_refusal(uuid),
  app.reply_field_refusal(uuid, text, text, uuid),
  app.start_reply_document_upload(uuid, text, text, bigint, text, timestamptz),
  app.attach_reply_files_to_transition(),
  app.discard_reply_files_on_leaving()
  from public;
grant execute on function
  app.reply_documents_refusal(uuid),
  app.start_reply_document_upload(uuid, text, text, bigint, text, timestamptz)
  to rabaed_app;
