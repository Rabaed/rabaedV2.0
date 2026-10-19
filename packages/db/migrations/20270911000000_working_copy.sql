-- RP-621 (spec RP-632; ADR 0023; form-engine.md §6; visibility.md, the Working Copy row, V1,
-- V14, V19; scenario RP-23-3): an item that isn't closed is downloaded as a Working Copy, a PDF
-- in the record's one layout made from the item as shared, the same for every viewer.
--
-- * project.working_copy_watermark: the text printed across every page of the Project's
--   Working Copies, Arabic and English, never empty (default "Not Final / غير نهائي"). A
--   Project Admin sets it (app.set_project_working_copy_watermark); every Participant reads it
--   with the Project row. It applies to Working Copies made afterwards.
-- * app.working_copy_content(item): what a Working Copy prints, read without a calling Member,
--   so it is one for every viewer: the answers as they last arrived (app.shared_answers_of),
--   the Built-in Fields from them, the Documents as of the last arrival, the Stage other
--   Companies read (the Step the item reached its holder at), the shared moves by Company
--   only (no person), the Companies on the item by name. Never an Internal Note, a Recommended
--   Code, an in-progress answer, a person, a Signature, a Stamp or a Verification Code. A
--   Draft (never Submitted) is read as its own Members read it: its answers now, with the same
--   rules as the shared read, and every Document on it. Only callable by the definer
--   functions below.
-- * working_copy: one row for each content a Working Copy was made of (its SHA-256, with the
--   release that made it), with where its PDF is once made. No grant to the app role; written
--   and read through the functions below. Two viewers asking for the same content get the
--   same row, so the same PDF.
-- * app.request_working_copy(item, release): for a Member who sees the item (V1: a Draft only
--   for the Members who see the Draft), 'ready' with the PDF's storage key and file name,
--   'preparing' (the row is queued for the worker, kind 'working_copy', and asked again), or
--   'failed' (its job was dead-lettered); 'closed' for a closed item (its download is the
--   Documental Record); 'not_found' for anyone else and for a made-up id.
-- * app.working_copy_job / app.save_working_copy: the worker's. The job reads the content again;
--   if it changed since it was asked for, the row is marked stale and nothing is made (the next
--   request asks for the new content).
-- app.take_transition, app.transition_effects and the record's functions are not touched.

alter table project add column working_copy_watermark jsonb not null
  default '{"en": "Not Final", "ar": "غير نهائي"}'::jsonb
  check (app.is_bilingual(working_copy_watermark)
    and length(working_copy_watermark ->> 'en') <= 60 and length(working_copy_watermark ->> 'ar') <= 60);

-- A Project Admin sets the watermark text. Outcome: 'set'; 'not_found' for anyone who is no Project
-- Admin of the Project (whether it exists or not), or a text that is empty in either language or longer
-- than 60 characters; 'project_closed'. Setting what it already is is 'set'.
create function app.set_project_working_copy_watermark(p_project_id uuid, p_watermark jsonb) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_status text;
      v_text jsonb;
    begin
      v_text := jsonb_build_object('en', trim(p_watermark ->> 'en'), 'ar', trim(p_watermark ->> 'ar'));
      if p_watermark is null or not app.is_bilingual(v_text)
        or length(v_text ->> 'en') > 60 or length(v_text ->> 'ar') > 60
        or not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id)
      then
        return 'not_found';
      end if;
      select status into v_status from project where id = p_project_id for update;
      if v_status = 'closed' then
        return 'project_closed';
      end if;
      update project set working_copy_watermark = v_text, updated_at = now()
      where id = p_project_id and working_copy_watermark is distinct from v_text;
      return 'set';
    end
  $$;
revoke all on function app.set_project_working_copy_watermark(uuid, jsonb) from public;
grant execute on function app.set_project_working_copy_watermark(uuid, jsonb) to rabaed_app;

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check
  check (kind in ('notification', 'email', 'digest', 'step_age_report', 'documental_record', 'record_ready', 'documental_record_reproduce', 'working_copy'));

create table working_copy (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  project_id uuid not null,
  -- The SHA-256 of what it prints (app.working_copy_content), and the release (APP_VERSION) whose layout prints it.
  content_sha256 bytea not null check (length(content_sha256) = 32),
  app_version text not null check (app_version <> ''),
  -- The worker's job that makes it; a new one when a stale row is asked for again.
  outbox_id uuid references outbox (id),
  -- Where its PDF is, once made.
  storage_key text,
  made_at timestamptz,
  -- The content changed before the job ran: nothing was made.
  stale_at timestamptz,
  created_at timestamptz not null default now(),
  constraint working_copy_item_fk foreign key (work_item_id, project_id) references work_item (id, project_id),
  constraint working_copy_content_key unique (work_item_id, content_sha256, app_version),
  check ((storage_key is null) = (made_at is null)),
  check (made_at is null or stale_at is null)
);
alter table working_copy enable row level security;
revoke all on working_copy from rabaed_app;

-- The answers of a Draft as its own Members read them: app.shared_answers_of's rules (no member
-- answer, a participant answer only for a Company everyone on the item reads, a link question by
-- number and Subject only, an unshared item of the chain left out) over its answers now.
create function app.working_copy_draft_answers(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  set jit = off
  as $$
    #variable_conflict use_column
    begin
      return (
        select (a.src - array(
          select f ->> 'key'
          from form_version v
          cross join lateral jsonb_array_elements(v.schema -> 'sections') s
          cross join lateral jsonb_array_elements(s -> 'fields') f
          where v.id = w.form_version_id
            and a.src ? (f ->> 'key')
            and (f ->> 'type' = 'member'
              or (f ->> 'type' = 'participant' and not (
                jsonb_typeof(a.src -> (f ->> 'key')) = 'string'
                and app.shared_company(w.id, app.uuid_or_null(a.src -> (f ->> 'key'))))))
        ) - array(select app.link_question_keys(w.form_version_id)))
        || coalesce((
          select jsonb_object_agg(k, (
            select coalesce(jsonb_agg(jsonb_build_object('document_number', t.document_number, 'subject', t.title) order by e.n), '[]')
            from jsonb_array_elements(a.src -> k) with ordinality e (v, n)
            join work_item t on t.id = app.uuid_or_null(e.v) and t.project_id = w.project_id
            where t.document_number is not null and not app.chain_item_unshared(w.id, t.id)
          ))
          from app.link_question_keys(w.form_version_id) k
          where jsonb_typeof(a.src -> k) = 'array'
        ), '{}')
        from work_item w
        cross join lateral (select app.work_item_full_answers(w.id) as src) a
        where w.id = p_work_item_id and w.submitted_at is null
      );
    end
  $$;
revoke all on function app.working_copy_draft_answers(uuid) from public;

-- What a Working Copy of the item prints (see the header), in the record facts' shape where they
-- print the same; null for a closed or discarded item.
create function app.working_copy_content(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_answers jsonb;
      v_content jsonb;
    begin
      v_answers := coalesce(app.shared_answers_of(p_work_item_id), app.working_copy_draft_answers(p_work_item_id), '{}'::jsonb);
      select jsonb_build_object(
          'workItemId', w.id,
          'projectId', w.project_id,
          'projectName', pr.name,
          'recordLanguage', pr.record_language,
          'hijriDates', pr.record_hijri_dates,
          'watermark', pr.working_copy_watermark,
          'type', jsonb_build_object('code', t.code, 'name', t.name),
          'documentNumber', w.document_number,
          'revisionNo', w.revision_no,
          -- The item it revises, once that one closed, and only when it was shared (as the chain's links are read).
          'revisionOf', (
            select jsonb_build_object('documentNumber', o.document_number, 'closedAt', app.iso_utc(o.closed_at), 'outcome', o.outcome)
            from work_item o
            where o.id = w.revision_of_id and o.closed_at is not null and o.document_number is not null
              and not app.chain_item_unshared(w.id, o.id)
          ),
          'subject', w.title,
          'submittedAt', app.iso_utc(w.submitted_at),
          -- The Stage every Company but the holder reads: where the item reached its holder; a Draft's own.
          'stage', (
            select st.name from stage st
            where st.project_id = w.project_id and st.module_key = t.module_key
              and st.key = case when w.submitted_at is null then w.current_stage_key else (
                select s.stage_key from workflow_step s where s.id = w.participant_entered_step_id) end
          ),
          'outcomes', coalesce((
            select jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name, 'polarity', o.polarity, 'actions', o.actions) order by o.sort, o.code)
            from outcome o
            where o.project_id = w.project_id and o.work_item_type_id = w.work_item_type_id and o.closing
          ), '[]'::jsonb),
          -- The Owner, the raiser and every Company that took a shared move, each with its Project Role.
          'companies', coalesce((
            select jsonb_agg(jsonb_build_object('participantId', p.id, 'name', co.legal_name, 'roleName', r.name, 'baseRole', r.base_role)
              order by case r.base_role when 'owner' then 1 when 'owner_representative' then 2 when 'consultant' then 3 else 4 end, p.ordinal, p.id)
            from participant p
            join company co on co.id = p.company_id
            join project_role r on r.id = p.project_role_id
            where p.project_id = w.project_id
              and (
                (r.base_role = 'owner' and p.status = 'active')
                or p.id = w.raised_by_participant_id
                or p.id in (
                  select e.actor_participant_id from work_item_event e
                  where e.work_item_id = w.id and e.audience = 'shared' and e.type in ('transition', 'issue_code') and e.actor_participant_id is not null)
              )
          ), '[]'::jsonb),
          -- The Built-in Fields as the answers give them (V19: as they last arrived).
          'trades', coalesce((
            select jsonb_agg(jsonb_build_object('name', dv.name, 'selected', dv.id = app.uuid_or_null(v_answers -> 'trade')) order by dv.sort, dv.id)
            from dimension_value dv
            join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'trade' and d.project_id = w.project_id
            where dv.parent_id is null
          ), '[]'::jsonb),
          'location', (
            with recursive up (id, parent_id, name, depth) as (
              select dv.id, dv.parent_id, dv.name, dv.depth
              from dimension_value dv
              join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'location' and d.project_id = w.project_id
              where dv.id = app.uuid_or_null(v_answers -> 'location')
              union all
              select dv.id, dv.parent_id, dv.name, dv.depth from dimension_value dv join up on dv.id = up.parent_id
            )
            select jsonb_agg(up.name order by up.depth) from up
          ),
          'scopes', coalesce((
            select jsonb_agg(s.name order by s.depth, s.sort, s.id)
            from scope s
            where s.project_id = w.project_id and jsonb_typeof(v_answers -> 'scopes') = 'array'
              and s.id in (select app.uuid_or_null(x) from jsonb_array_elements(v_answers -> 'scopes') x)
          ), '[]'::jsonb),
          'form', jsonb_build_object(
            'sections', fv.schema -> 'sections',
            'answers', v_answers,
            'optionLists', coalesce((
              select jsonb_agg(jsonb_build_object('id', ol.id, 'name', ol.name) order by ol.created_at, ol.id)
              from option_list ol where position(ol.id::text in fv.schema::text) > 0
            ), '[]'::jsonb),
            'options', coalesce((
              select jsonb_agg(jsonb_build_object('id', op.id, 'optionListId', op.option_list_id, 'parentId', op.parent_id,
                'value', op.value, 'label', op.label, 'retired', op.retired) order by op.created_at, op.id) -- hidden-sort-key: an Option List's own options, Rabaed's rows, never an item's time
              from option op join option_list ol on ol.id = op.option_list_id
              where position(ol.id::text in fv.schema::text) > 0
            ), '[]'::jsonb),
            'suppliers', coalesce((
              select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name))
              from approved_supplier s
              where s.project_id = w.project_id and s.id in (
                select app.uuid_or_null(v_answers -> (f ->> 'key'))
                from jsonb_array_elements(fv.schema -> 'sections') sec
                cross join lateral jsonb_array_elements(sec -> 'fields') f
                where f ->> 'type' = 'approved_supplier')
            ), '[]'::jsonb),
            'companyNames', coalesce((
              select jsonb_object_agg(p.id, co.legal_name)
              from participant p join company co on co.id = p.company_id
              where p.project_id = w.project_id and p.id in (
                select app.uuid_or_null(v_answers -> (f ->> 'key'))
                from jsonb_array_elements(fv.schema -> 'sections') sec
                cross join lateral jsonb_array_elements(sec -> 'fields') f
                where f ->> 'type' = 'participant')
            ), '{}'::jsonb)
          ),
          -- The Documents as of the last arrival (never one the holder added since, V19); a Draft's all.
          'documents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'fileName', d.file_name, 'contentType', d.content_type, 'size', d.size_bytes::bigint, 'storageKey', d.storage_key,
              'fieldKey', d.field_key, 'itemKey', d.item_key, 'takenAt', app.iso_utc(d.taken_at)
            ) order by d.created_at, d.id) -- hidden-sort-key: the order they were added is what app.document_times (seq) already tells every reader, never the times
            from document d
            where d.work_item_id = w.id and d.confirmed_at is not null and d.removed_at is null
              and (w.submitted_at is null or d.arrival < w.arrivals)
          ), '[]'::jsonb),
          -- The shared moves, each by its Company only. The Owner's review writes one copy of a move for each side of it: one is enough.
          'moves', coalesce((
            select jsonb_agg(x.move order by x.seq)
            from (
              select distinct on (e.transition_id, e.created_at, e.actor_participant_id) e.seq,
                jsonb_build_object(
                  'kind', tr.kind,
                  'label', tr.label,
                  'at', app.iso_utc(e.created_at),
                  'participantId', e.actor_participant_id,
                  'companyName', c.legal_name,
                  'roleName', r.name
                ) as move
              from work_item_event e
              join workflow_transition tr on tr.id = e.transition_id
              join participant p on p.id = e.actor_participant_id
              join project_role r on r.id = p.project_role_id
              join company c on c.id = p.company_id
              where e.work_item_id = w.id and e.audience = 'shared' and e.type in ('transition', 'issue_code')
              order by e.transition_id, e.created_at, e.actor_participant_id, e.seq
            ) x
          ), '[]'::jsonb)
        )
      into v_content
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      join form_version fv on fv.id = w.form_version_id
      where w.id = p_work_item_id and w.closed_at is null and w.discarded_at is null;
      return v_content;
    end
  $$;
revoke all on function app.working_copy_content(uuid) from public;

-- A Member asks for the item's Working Copy (see the header). `p_app_version` is the asking api's
-- release: the worker of that release prints it with its layout.
create function app.request_working_copy(p_work_item_id uuid, p_app_version text)
  returns table (outcome text, storage_key text, file_name text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_item record;
      v_content jsonb;
      v_hash bytea;
      v_copy working_copy;
      v_outbox_id uuid;
    begin
      if app.current_member_id() is null or coalesce(p_app_version, '') = '' or not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::text, null::text;
        return;
      end if;
      select w.project_id, w.closed_at, w.document_number, t.code into v_item
      from work_item w join work_item_type t on t.id = w.work_item_type_id
      where w.id = p_work_item_id and w.discarded_at is null;
      if not found then
        return query select 'not_found'::text, null::text, null::text;
        return;
      end if;
      if v_item.closed_at is not null then
        return query select 'closed'::text, null::text, null::text;
        return;
      end if;
      v_content := app.working_copy_content(p_work_item_id);
      v_hash := sha256(convert_to(v_content::text, 'UTF8'));
      insert into working_copy (work_item_id, project_id, content_sha256, app_version)
      values (p_work_item_id, v_item.project_id, v_hash, p_app_version)
      on conflict on constraint working_copy_content_key do nothing;
      select * into v_copy from working_copy c
      where c.work_item_id = p_work_item_id and c.content_sha256 = v_hash and c.app_version = p_app_version
      for update;
      if v_copy.made_at is not null then
        return query select 'ready'::text, v_copy.storage_key,
          coalesce(v_item.document_number, v_item.code) || ' - Working Copy.pdf';
        return;
      end if;
      if v_copy.outbox_id is not null and v_copy.stale_at is null then
        if exists (select 1 from outbox o where o.id = v_copy.outbox_id and o.dead_at is not null) then
          return query select 'failed'::text, null::text, null::text;
        else
          return query select 'preparing'::text, null::text, null::text;
        end if;
        return;
      end if;
      -- New, or stale and asked for again: the worker makes it.
      insert into outbox (kind, project_id, payload)
      values ('working_copy', v_item.project_id, jsonb_build_object('working_copy_id', v_copy.id))
      returning id into v_outbox_id;
      update working_copy set outbox_id = v_outbox_id, stale_at = null where id = v_copy.id;
      return query select 'preparing'::text, null::text, null::text;
    end
  $$;
revoke all on function app.request_working_copy(uuid, text) from public;
grant execute on function app.request_working_copy(uuid, text) to rabaed_app;

-- The worker reads what Working Copy job `p_outbox_id` prints: {workingCopyId, content}; null when
-- there is nothing to make (made already, or the content changed since it was asked for: then the row
-- is marked stale).
create function app.working_copy_job(p_outbox_id uuid) returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_copy working_copy;
      v_content jsonb;
    begin
      perform app.require_worker();
      select c.* into v_copy from working_copy c
      join outbox o on o.id = p_outbox_id and o.kind = 'working_copy' and c.id = app.uuid_or_null(o.payload -> 'working_copy_id')
      where c.outbox_id = p_outbox_id
      for update of c;
      if not found or v_copy.made_at is not null or v_copy.stale_at is not null then
        return null;
      end if;
      v_content := app.working_copy_content(v_copy.work_item_id);
      if v_content is null or sha256(convert_to(v_content::text, 'UTF8')) <> v_copy.content_sha256 then
        update working_copy set stale_at = now() where id = v_copy.id;
        return null;
      end if;
      return jsonb_build_object('workingCopyId', v_copy.id, 'content', v_content);
    end
  $$;
revoke all on function app.working_copy_job(uuid) from public;
grant execute on function app.working_copy_job(uuid) to rabaed_app;

-- The worker keeps where job `p_outbox_id`'s PDF is. False when it was made already or went stale.
create function app.save_working_copy(p_outbox_id uuid, p_storage_key text) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.require_worker();
      update working_copy set storage_key = p_storage_key, made_at = now()
      where outbox_id = p_outbox_id and made_at is null and stale_at is null and coalesce(p_storage_key, '') <> '';
      return found;
    end
  $$;
revoke all on function app.save_working_copy(uuid, text) from public;
grant execute on function app.save_working_copy(uuid, text) to rabaed_app;
