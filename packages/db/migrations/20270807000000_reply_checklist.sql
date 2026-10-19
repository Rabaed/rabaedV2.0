-- RP-86: a checklist in a reply Screen (ADR 0024 amended 2026-10-19, ADR 0025; INSP-4;
-- workflow-engine.md §5.7, form-engine.md §3.3, visibility.md V19 and scenario RP-86-1).
--
-- A Screen's `copied_checklist` field answers the checklist the item copied from its Checklist
-- Template (`work_item_checklist`, RP-651; `copyOf` names the item's `checklist_template` field).
-- It is RP-623's mechanism, extended to a checklist:
-- * For a checklist, the holding Participant's earlier Steps on the way to the Transition count
--   as its from-Steps, and the from-Step itself reads it: the WIR's Consultant Engineer fills it,
--   Send to Manager and Return to Engineer keep it, the Consultant Manager reads it in the code
--   pop-up (`app.reply_file_field`, the one place that rule lives).
-- * Its answers are saved over time by the Members of the Participant holding the item
--   (`app.save_reply_checklist`, the api checking them first) in `reply_checklist`, which only
--   that Participant reads until the Transition takes them (V19). Its photos are reply Documents
--   of the field and the check item (`document.item_key`), with the item's photo rule.
-- * The Transition whose Screen holds it takes them (`work_item_event_attach_reply_files`): the
--   answers go in its event's payload under the field's key, shared with the event's audience; the
--   photos freeze; its content hash is taken again with both (ADR 0017).
-- * Leaving the Participant any other way, or closing, discards them, as its files.
-- `app.take_transition` and `app.transition_effects` are unchanged (RP-603).

-- The answers a reply holds until its Transition --------------------------------------------

create table reply_checklist (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id),
  work_item_id uuid not null references work_item (id),
  -- The Screen's `copied_checklist` field.
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]*$' and length(field_key) <= 64),
  -- By check item: {"formwork": {"answer": "fail", "comment": "..."}}, as the api checked them.
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  -- The Participant that holds the item and fills it.
  participant_id uuid not null references participant (id),
  updated_by_member_id uuid not null references member (id),
  updated_at timestamptz not null,
  -- The Transition's event that took it (deferred: the event names it before its own row is in).
  reply_event_id uuid,
  constraint reply_checklist_event_fk foreign key (reply_event_id) references work_item_event (id) deferrable initially deferred
);
-- One set waiting per field; each Transition taken keeps its own.
create unique index reply_checklist_waiting_key on reply_checklist (work_item_id, field_key) where reply_event_id is null;
create index reply_checklist_work_item_idx on reply_checklist (work_item_id);
create index reply_checklist_participant_idx on reply_checklist (participant_id);
create index reply_checklist_member_idx on reply_checklist (updated_by_member_id);
create index reply_checklist_project_idx on reply_checklist (project_id);
create index reply_checklist_event_idx on reply_checklist (reply_event_id);

alter table reply_checklist enable row level security;
revoke all on reply_checklist from rabaed_app;
-- The answers, never who saved them or when. Once taken, the Transition's event shares them.
grant select (work_item_id, field_key, answers) on reply_checklist to rabaed_app;
-- The Participant holding the item, while none of its Transitions took them (V19).
create policy holder_reads_waiting_reply_checklists on reply_checklist for select to rabaed_app
  using (reply_event_id is null and app.sees_work_item(work_item_id) and app.holds_work_item(work_item_id));

-- A checklist item's photo is a reply Document of the field and the item.
alter table document drop constraint document_reply_has_field;
alter table document add constraint document_reply_has_field check (not reply or field_key is not null);

-- The Consultant photographs the checks it inspects: `attach` in the Inspections Module.
insert into position_permission (position_id, module_key, permission)
select p.id, 'inspections', 'attach'
from position p
where p.owner_kind = 'rabaed' and p.base_role = 'consultant' and p.key in ('engineer', 'manager')
on conflict do nothing;

-- Which field -------------------------------------------------------------------------------

-- As in the reply_screen_files migration, with a checklist: the field `p_field_key` of a Screen
-- shown by a Transition, filled at the item's current Step, or null. A file field is filled at
-- the Transition's from-Steps. A `copied_checklist` at the Steps of the same Participant role
-- on the way to the from-Step, through `send`s inside it (ADR 0024, amended 2026-10-19): the
-- WIR's Consultant Engineer fills the checklist of the Manager's codes, and the Manager reads it.
-- A key the item's Form also uses is never a reply field: Documents are found by their field's key.
create or replace function app.reply_file_field(p_work_item_id uuid, p_field_key text) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
    with recursive item as (
      select w.id, w.current_step_id, w.workflow_version_id, w.form_version_id, app.work_item_raiser_role(w.id) as raiser_role
      from work_item w
      where w.id = p_work_item_id and w.closed_at is null
    ), ahead (step_id) as (
      select t.to_step_id
      from item i
      join workflow_transition t on t.from_step_id = i.current_step_id and t.kind = 'send'
      join workflow_step f on f.id = t.from_step_id
      join workflow_step s on s.id = t.to_step_id
      where app.actor_role(s.actor_rule, i.raiser_role) = app.actor_role(f.actor_rule, i.raiser_role)
      union
      select t.to_step_id
      from ahead a
      cross join item i
      join workflow_transition t on t.from_step_id = a.step_id and t.kind = 'send'
      join workflow_step f on f.id = t.from_step_id
      join workflow_step s on s.id = t.to_step_id
      where app.actor_role(s.actor_rule, i.raiser_role) = app.actor_role(f.actor_rule, i.raiser_role)
    )
    select f
    from item i
    join workflow_transition t on t.workflow_version_id = i.workflow_version_id and t.screen_version_id is not null
    cross join lateral jsonb_array_elements(coalesce(t.action_form -> 'sections', '[]')) s
    cross join lateral jsonb_array_elements(coalesce(s -> 'fields', '[]')) f
    where f ->> 'key' = p_field_key
      and ((f ->> 'type' in ('attachments', 'photos') and t.from_step_id = i.current_step_id)
        or (f ->> 'type' = 'copied_checklist' and t.from_step_id <> i.current_step_id
          and t.from_step_id in (select step_id from ahead)))
      and not exists (
        select 1 from form_version v
        cross join lateral jsonb_array_elements(v.schema -> 'sections') fs
        cross join lateral jsonb_array_elements(fs -> 'fields') ff
        where v.id = i.form_version_id and ff ->> 'key' = p_field_key)
    order by t.key
    limit 1
      );
    end
  $$;

-- The check item `p_item_key` of the item's copied checklist that the reply field `p_field` answers, or null.
create function app.reply_checklist_item(p_work_item_id uuid, p_field jsonb, p_item_key text) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select i
        from work_item_checklist c
        cross join lateral jsonb_array_elements(c.items) i
        where c.work_item_id = p_work_item_id and c.field_key = p_field ->> 'copyOf' and i ->> 'key' = p_item_key
      );
    end
  $$;

-- As in the reply_screen_files migration, with a checklist item's photo (`p_item_key`): null when
-- a file of `p_content_type` may go in the reply field `p_field_key` now (besides the Document
-- `p_document_id` being confirmed): 'field_not_found' (no such field filled at this Step, or for
-- a checklist no such check item, or one taking no photos), 'content_type_not_allowed' or
-- 'too_many_files'. A file field's limit, and a check item's ten photos, count the files no
-- Transition has taken yet.
drop function app.reply_field_refusal(uuid, text, text, uuid);
create function app.reply_field_refusal(p_work_item_id uuid, p_field_key text, p_item_key text, p_content_type text, p_document_id uuid)
  returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_field jsonb := app.reply_file_field(p_work_item_id, p_field_key);
      v_item jsonb;
    begin
      if v_field ->> 'type' = 'copied_checklist' then
        v_item := app.reply_checklist_item(p_work_item_id, v_field, p_item_key);
        return case
          when v_item is null or coalesce(v_item ->> 'photo', 'off') = 'off' then 'field_not_found'
          when p_content_type <> all (array['image/jpeg', 'image/png', 'image/webp', 'image/heic']) then 'content_type_not_allowed'
          when 10 <= (
            select count(*) from document d
            where d.work_item_id = p_work_item_id and d.reply and d.reply_event_id is null
              and d.field_key = p_field_key and d.item_key = p_item_key and d.confirmed_at is not null and d.removed_at is null
              and d.annotated_from_id is null and d.id is distinct from p_document_id
          ) then 'too_many_files'
        end;
      end if;
      return case
        when v_field is null or p_item_key is not null then 'field_not_found'
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

-- Uploading -----------------------------------------------------------------------------------

-- As in the reply_screen_files migration, with a checklist item's photo (`p_item_key`, null for
-- a file field's file).
drop function app.start_reply_document_upload(uuid, text, text, bigint, text, timestamptz);
create function app.start_reply_document_upload(
  p_work_item_id uuid, p_field_key text, p_item_key text, p_file_name text, p_size_bytes bigint, p_content_type text, p_now timestamptz
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
        app.reply_field_refusal(p_work_item_id, p_field_key, p_item_key, p_content_type, null));
      if v_refusal is not null then
        return query select v_refusal, null::uuid, null::text;
        return;
      end if;
      v_key := app.document_storage_key(v_item.project_id, v_item.id, v_id);
      insert into document (
        id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
        uploaded_by_member_id, uploaded_by_participant_id, created_at, field_key, item_key, reply
      ) values (
        v_id, v_item.project_id, v_item.id, btrim(p_file_name), p_size_bytes, p_content_type, v_key,
        app.current_member_id(), v_me.participant_id, v_at, p_field_key, p_item_key, true
      );
      return query select 'started'::text, v_id, v_key;
    end
  $$;

-- As in the reply_screen_files migration; a checklist item's photo is checked against its item.
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
        v_refusal := app.reply_field_refusal(p_work_item_id, v_doc.field_key, v_doc.item_key, v_doc.content_type, v_doc.id);
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

-- Saving the answers ------------------------------------------------------------------------

-- Saves `p_answers` (checked by the api: checkReplyChecklist, draft mode) as the answers of the
-- reply checklist `p_field_key` of the item, replacing those waiting: 'saved'; 'not_found' for an
-- item the Member doesn't see; 'project_closed'; 'not_editable' (another Participant holds it, or
-- it is closed); 'forbidden' (without the permission of the Step their Participant holds);
-- 'field_not_found' (no checklist of that key is filled at this Step, or the item copied none).
create function app.save_reply_checklist(p_work_item_id uuid, p_field_key text, p_answers jsonb, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_field jsonb;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- Locked, so the Transition taking the answers can't pass in between.
      select w.id, w.project_id, w.closed_at, w.current_step_id, pr.status as project_status, t.module_key, s.actor_rule
      into v_item
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      left join workflow_step s on s.id = w.current_step_id
      where w.id = p_work_item_id
      for update of w;
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
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, v_item.actor_rule ->> 'permission') then
        return 'forbidden';
      end if;
      v_field := app.reply_file_field(p_work_item_id, p_field_key);
      if v_field ->> 'type' is distinct from 'copied_checklist' or not exists (
        select 1 from work_item_checklist c where c.work_item_id = p_work_item_id and c.field_key = v_field ->> 'copyOf')
      then
        return 'field_not_found';
      end if;
      if jsonb_typeof(p_answers) is distinct from 'object' then
        raise exception 'reply checklist answers must be an object' using errcode = '22023';
      end if;
      insert into reply_checklist (project_id, work_item_id, field_key, answers, participant_id, updated_by_member_id, updated_at)
      values (v_item.project_id, p_work_item_id, p_field_key, p_answers, v_me.participant_id, app.current_member_id(), v_at)
      on conflict (work_item_id, field_key) where reply_event_id is null do update
        set answers = excluded.answers, participant_id = excluded.participant_id,
          updated_by_member_id = excluded.updated_by_member_id, updated_at = excluded.updated_at;
      return 'saved';
    end
  $$;

-- The Transition takes them ---------------------------------------------------------------------

-- As in the reply_screen_files migration, with a checklist: a Transition whose Screen holds file
-- fields or a `copied_checklist` takes what waits in them. The files and a checklist item's
-- photos freeze and name its event; a checklist's answers go in its payload under the field's
-- key (the Owner's review, which writes the Transition twice, copies them from the first); its
-- content hash is taken again with them (the hash in the row was taken before they were the
-- item's content). A required file field, or one with too few files, refuses the Transition (the
-- api checks it first, with the counts; it checks the checklist's answers itself).
create or replace function app.attach_reply_files_to_transition() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_fields jsonb;
      v_item record;
      v_short text;
      v_files boolean;
      v_checklists jsonb;
    begin
      select jsonb_agg(f) into v_fields
      from workflow_transition t
      cross join lateral jsonb_array_elements(coalesce(t.action_form -> 'sections', '[]')) s
      cross join lateral jsonb_array_elements(coalesce(s -> 'fields', '[]')) f
      where t.id = new.transition_id and t.screen_version_id is not null
        and f ->> 'type' in ('attachments', 'photos', 'copied_checklist');
      if v_fields is null then
        return new;
      end if;
      update document d set reply_event_id = new.id, frozen_at = new.created_at
      where d.work_item_id = new.work_item_id and d.reply and d.reply_event_id is null
        and d.confirmed_at is not null and d.removed_at is null
        and d.field_key in (select f ->> 'key' from jsonb_array_elements(v_fields) f);
      v_files := found;
      with taken as (
        update reply_checklist r set reply_event_id = new.id
        where r.work_item_id = new.work_item_id and r.reply_event_id is null
          and r.field_key in (select f ->> 'key' from jsonb_array_elements(v_fields) f where f ->> 'type' = 'copied_checklist')
        returning r.field_key, r.answers
      )
      select jsonb_object_agg(field_key, answers) into v_checklists from taken;
      if v_checklists is null then
        -- The Owner's review writes the Transition twice (one event for each Participant): the first took them.
        select jsonb_object_agg(r.field_key, r.answers) into v_checklists
        from reply_checklist r
        where r.work_item_id = new.work_item_id and r.reply_event_id in (
          select e.id from work_item_event e
          where e.work_item_id = new.work_item_id and e.transition_id = new.transition_id and e.created_at = new.created_at);
      end if;
      if v_checklists is not null then
        new.payload := coalesce(new.payload, '{}'::jsonb) || v_checklists;
      end if;
      if (v_files or v_checklists is not null) and new.content_sha256 is not null then
        select w.title, w.data into v_item from work_item w where w.id = new.work_item_id;
        new.content_sha256 := app.work_item_content_sha256(new.work_item_id, v_item.title, v_item.data, new.payload ->> 'outcome');
      end if;
      select f ->> 'key' into v_short
      from jsonb_array_elements(v_fields) f
      where f ->> 'type' <> 'copied_checklist' and f -> 'visible_if' is null
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

-- As in the reply_screen_files migration: leaving the holding Participant any other way, or
-- closing, discards the files no Transition took, and now the checklist answers waiting too, as
-- V19 discards in-progress answers.
create or replace function app.discard_reply_files_on_leaving() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      -- Named as removed by its uploader: the Member who took the item away may be another Company's (V14).
      update document d set removed_at = new.updated_at, removed_by_member_id = d.uploaded_by_member_id
      where d.work_item_id = new.id and d.reply and d.reply_event_id is null
        and d.confirmed_at is not null and d.removed_at is null;
      delete from reply_checklist r where r.work_item_id = new.id and r.reply_event_id is null;
      return null;
    end
  $$;

-- The content hash ----------------------------------------------------------------------------

-- As in the reply_screen_files migration, covering the checklists a Transition took (ADR 0017):
-- their answers, by field. An item that has none hashes as before.
create or replace function app.work_item_content_sha256(p_work_item_id uuid, p_title text, p_data jsonb, p_outcome text)
  returns bytea
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return sha256(convert_to((jsonb_build_object(
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
      ) || coalesce((
          select jsonb_build_object('checklists', jsonb_agg(jsonb_build_object('field_key', r.field_key, 'answers', r.answers) order by r.field_key, r.id))
          from reply_checklist r
          where r.work_item_id = p_work_item_id and r.reply_event_id is not null
          having count(*) > 0), '{}'::jsonb)
      )::text, 'UTF8'));
    end
  $$;

-- An Action Form's answers ------------------------------------------------------------------------

-- As in the reply_screen_files migration, except that a reply checklist takes no answer either
-- (the Transition takes its saved answers).
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
        where not exists (
          select 1 from fields where f ->> 'key' = k and f ->> 'type' not in ('attachments', 'photos', 'copied_checklist')))
      and not exists (
        select 1 from fields
        where f -> 'required' = 'true' and s -> 'visible_if' is null and f -> 'visible_if' is null
          and f ->> 'type' not in ('attachments', 'photos', 'copied_checklist')
          and (p_answers -> (f ->> 'key') is null
            or p_answers -> (f ->> 'key') in ('null', '[]')
            or (jsonb_typeof(p_answers -> (f ->> 'key')) = 'string' and btrim(p_answers ->> (f ->> 'key')) = '')))
  $$;

revoke all on function
  app.reply_checklist_item(uuid, jsonb, text),
  app.reply_field_refusal(uuid, text, text, text, uuid),
  app.start_reply_document_upload(uuid, text, text, text, bigint, text, timestamptz),
  app.save_reply_checklist(uuid, text, jsonb, timestamptz)
  from public;
grant execute on function
  app.start_reply_document_upload(uuid, text, text, text, bigint, text, timestamptz),
  app.save_reply_checklist(uuid, text, jsonb, timestamptz)
  to rabaed_app;
