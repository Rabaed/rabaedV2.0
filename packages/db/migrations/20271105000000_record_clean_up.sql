-- RP-1086 (epic review RP-681 of spec RP-632): the Documental Record's SQL, tidied. Nothing reads
-- anything it did not read before, and no one sees anything new.
--
-- 1. app.documental_record_facts was copied whole on each change (20270709, 20270720, 20270925,
--    20270926, 20271015; CODING_STANDARDS "a function redefined again … gets its copied block
--    extracted first"). Its three largest blocks are now their own functions, unchanged:
--    app.record_fact_companies, app.record_fact_comments and app.record_fact_transitions. A change to
--    one of them redefines that helper only.
--
-- 2. The record-job kinds and the payload key that names each one's item were written in several
--    places: app.record_job_item's case, the literals passed to app.record_job_pending, the kind
--    lists of app.record_jobs, app.retry_record_job and app.documental_record_alerts, and the
--    coalesce of both keys in app.save_documental_record_face. app.record_job_payload_keys is now
--    the one place: a third kind is one entry there. app.record_job_kinds and app.record_job_item
--    read it, and every function above reads those two. app.record_job_pending drops its key
--    argument, and app.retry_record_job uses it instead of its own copy of the query.

-- The record-job kinds, each with the payload key that holds the id of its item: a 'documental_record'
-- job (queued when an item closes, 20270709) and a 'documental_record_reproduce' job (a Re-produce,
-- 20270805). The one place they are written.
create function app.record_job_payload_keys() returns jsonb
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select '{"documental_record": "closed_work_item_id", "documental_record_reproduce": "work_item_id"}'::jsonb
  $$;
revoke all on function app.record_job_payload_keys() from public;

-- The record-job kinds (app.record_job_payload_keys). Immutable, so `o.kind = any (app.record_job_kinds())`
-- is a constant list to the planner.
create function app.record_job_kinds() returns text[]
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select array(select k from jsonb_object_keys(app.record_job_payload_keys()) k order by k)
  $$;
revoke all on function app.record_job_kinds() from public;

-- The item a record job (an outbox row of `p_kind` with `p_payload`) is for, by its kind's payload key
-- (app.record_job_payload_keys); null for any other kind.
create or replace function app.record_job_item(p_kind text, p_payload jsonb) returns uuid
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select (p_payload ->> (app.record_job_payload_keys() ->> p_kind))::uuid
  $$;

-- Whether a record job of `p_kind` for item `p_work_item_id` is waiting or running. The key that holds
-- the item is the kind's own (app.record_job_item), no longer an argument.
drop function app.record_job_pending(text, text, uuid);
create function app.record_job_pending(p_kind text, p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from outbox o
        where o.kind = p_kind and app.record_job_item(o.kind, o.payload) = p_work_item_id
          and o.processed_at is null and o.dead_at is null
      );
    end
  $$;
revoke all on function app.record_job_pending(text, uuid) from public;

-- The closed item a 'documental_record' job is for (20270709), by the one payload-key rule.
create or replace function app.documental_record_item(p_outbox_id uuid) returns uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select app.record_job_item(o.kind, o.payload) from outbox o
        where o.id = p_outbox_id and o.kind = 'documental_record'
      );
    end
  $$;

-- As 20270805000000_record_checks.sql, with app.record_job_pending's new arguments.
create or replace function app.documental_record_state(p_work_item_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_status text;
    begin
      if app.current_member_id() is null or not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      select r.status into v_status from documental_record r where r.work_item_id = p_work_item_id;
      if v_status is null then
        if app.record_job_pending('documental_record', p_work_item_id) then
          return 'preparing';
        end if;
        return null;
      end if;
      return case v_status when 'failed_checks' then null else v_status end;
    end
  $$;

-- As 20270805000000_record_checks.sql, with app.record_job_pending's new arguments.
create or replace function app.request_documental_record_reproduction(p_work_item_id uuid, p_admin_action_id uuid) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_record record;
    begin
      select r.id, r.project_id into v_record from documental_record r
      where r.work_item_id = p_work_item_id and r.status in ('published', 'failed_checks')
      for update;
      if v_record.id is null then
        return 'not_found';
      end if;
      if app.record_job_pending('documental_record_reproduce', p_work_item_id) then
        return 'already_queued';
      end if;
      insert into outbox (kind, project_id, payload)
      values ('documental_record_reproduce', v_record.project_id,
        jsonb_build_object('work_item_id', p_work_item_id, 'admin_action_id', p_admin_action_id));
      return 'queued';
    end
  $$;

-- As 20270910000000_documental_record_verification.sql, with the job's item by the one rule.
create or replace function app.save_documental_record_face(p_outbox_id uuid, p_face jsonb) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_record_id uuid;
    begin
      perform app.require_worker();
      select r.id into v_record_id
      from outbox o
      join documental_record r on r.work_item_id = app.record_job_item(o.kind, o.payload)
      where o.id = p_outbox_id and o.kind = any (app.record_job_kinds());
      if v_record_id is null then
        return false;
      end if;
      insert into documental_record_face (documental_record_id, language, document_number, subject, project, outcome, signers)
      values (
        v_record_id, p_face ->> 'language', p_face ->> 'documentNumber', p_face ->> 'subject',
        p_face -> 'project', p_face -> 'outcome', p_face -> 'signers'
      )
      on conflict (documental_record_id) do update set
        language = excluded.language, document_number = excluded.document_number, subject = excluded.subject,
        project = excluded.project, outcome = excluded.outcome, signers = excluded.signers, written_at = now();
      return true;
    end
  $$;

-- As 20271006000000_record_job_monitor.sql, with the kinds read from app.record_job_kinds.
create or replace function app.record_jobs()
  returns table (
    outbox_id uuid, kind text, work_item_id uuid, project_id uuid, project_name jsonb, document_number text,
    state text, error text, attempts integer, last_ran_at timestamptz, next_try_at timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select o.id, o.kind, w.id, w.project_id, pr.name, w.document_number,
          case when o.dead_at is not null then 'dead' else 'failing' end,
          o.last_error, o.attempts, coalesce(o.dead_at, o.last_failed_at),
          case when o.dead_at is null then o.available_at end
        from outbox o
        join work_item w on w.id = app.record_job_item(o.kind, o.payload)
        join project pr on pr.id = w.project_id
        where o.kind = any (app.record_job_kinds())
          and (
            (o.processed_at is null and o.dead_at is null and o.last_error is not null)
            or (o.dead_at is not null and not exists (select 1 from record_job_retry r where r.dead_outbox_id = o.id))
          )
        order by 10, 1;
    end
  $$;

-- As 20271006000000_record_job_monitor.sql (see its comment for the result and the lock order), with
-- the kinds read from app.record_job_kinds and the pending test app.record_job_pending's own.
create or replace function app.retry_record_job(p_outbox_id uuid, p_admin_action_id uuid, out result text, out item_id uuid)
  returns record
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_dead outbox%rowtype;
      v_fresh uuid;
    begin
      select * into v_dead from outbox o
      where o.id = p_outbox_id and o.kind = any (app.record_job_kinds()) and o.dead_at is not null
      for update;
      if v_dead.id is null then
        result := 'not_found';
        return;
      end if;
      item_id := app.record_job_item(v_dead.kind, v_dead.payload);
      perform 1 from work_item w where w.id = item_id for update;
      if v_dead.kind = 'documental_record_reproduce' then
        perform 1 from documental_record r where r.work_item_id = item_id for update;
      end if;
      if exists (select 1 from record_job_retry r where r.dead_outbox_id = v_dead.id)
        or (v_dead.kind = 'documental_record_reproduce' and exists (
          select 1 from documental_record_reproduction x where x.admin_action_id = (v_dead.payload ->> 'admin_action_id')::uuid
        )) then
        result := 'not_found';
        return;
      end if;
      if app.record_job_pending(v_dead.kind, item_id) then
        result := 'already_queued';
        return;
      end if;
      insert into outbox (kind, project_id, payload)
      values (v_dead.kind, v_dead.project_id, v_dead.payload)
      returning id into v_fresh;
      insert into record_job_retry (dead_outbox_id, outbox_id, admin_action_id)
      values (v_dead.id, v_fresh, p_admin_action_id);
      result := 'queued';
    end
  $$;

-- As 20271006000000_record_job_monitor.sql, with the kinds read from app.record_job_kinds.
create or replace function app.documental_record_alerts()
  returns table (
    work_item_id uuid, project_id uuid, project_name jsonb, document_number text, status text,
    problems jsonb, raised_at timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select w.id, w.project_id, pr.name, w.document_number, r.status, c.problems, c.ran_at
        from documental_record r
        join lateral (
          select x.problems, x.ran_at, x.passed from documental_record_check x
          where x.documental_record_id = r.id order by x.ran_at desc, x.id desc limit 1
        ) c on not c.passed
        join work_item w on w.id = r.work_item_id
        join project pr on pr.id = w.project_id
        union all
        select w.id, w.project_id, pr.name, w.document_number, 'job_failed', jsonb_build_array(coalesce(o.last_error, 'failed')), o.dead_at
        from outbox o
        join work_item w on w.id = app.record_job_item(o.kind, o.payload)
        join project pr on pr.id = w.project_id
        where o.kind = any (app.record_job_kinds()) and o.dead_at is not null
          and not exists (select 1 from record_job_retry t where t.dead_outbox_id = o.id)
        order by 7, 1;
    end
  $$;

-- The record's 'companies' fact (20271015): the Owner, and every Company on closed item
-- `p_work_item_id` (the raiser, the Companies a Step was given to and every Company whose Member took
-- a Transition), each with its Project Role, and its logo and Stamp in force when the item closed.
create function app.record_fact_companies(p_work_item_id uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select coalesce((
      select jsonb_agg(jsonb_build_object(
          'participantId', p.id, 'name', co.legal_name, 'roleName', r.name, 'baseRole', r.base_role,
          'logo', app.company_image_at(co.id, 'logo', w.closed_at),
          'stamp', app.company_image_at(co.id, 'stamp', w.closed_at))
        order by case r.base_role when 'owner' then 1 when 'owner_representative' then 2 when 'consultant' then 3 else 4 end, p.ordinal, p.id)
      from participant p
      join company co on co.id = p.company_id
      join project_role r on r.id = p.project_role_id
      where p.project_id = w.project_id
        and (
          (r.base_role = 'owner' and p.status = 'active')
          or p.id = w.raised_by_participant_id
          or p.id in (select a.participant_id from step_assignment a where a.work_item_id = w.id)
          or p.id in (
            select e.actor_participant_id from work_item_event e
            where e.work_item_id = w.id and e.type in ('transition', 'issue_code') and e.actor_participant_id is not null)
        )
    ), '[]'::jsonb)
    from work_item w
    where w.id = p_work_item_id
  $$;
revoke all on function app.record_fact_companies(uuid) from public;

-- The record's 'comments' fact (20271015): the Comments the issued Code of closed item
-- `p_work_item_id` raised, in the order its reply listed them: made by its closing (created when it
-- closed), each with who raised it as they were then.
create function app.record_fact_comments(p_work_item_id uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select coalesce((
      select jsonb_agg(jsonb_build_object(
          'documentNumber', c.document_number,
          'comment', coalesce(nullif(btrim(c.data ->> 'comment'), ''), c.title),
          'reference', nullif(btrim(c.data ->> 'reference'), ''),
          'at', app.iso_utc(c.created_at),
          'memberName', coalesce(s.member_name, m.full_name),
          'positions', coalesce(s.positions, '[]'::jsonb),
          'companyName', coalesce(s.company_name, co.legal_name),
          'roleName', r.name,
          'participantId', e.actor_participant_id)
        -- The reply's row order: its rows took their Document Numbers from one counter, in order.
        order by length(c.document_number), c.document_number, c.id)
      from work_item_link l
      join work_item c on c.id = l.from_id and c.discarded_at is null
      join work_item_event e on e.work_item_id = c.id and e.type = 'transition'
      join member m on m.id = e.actor_member_id
      join participant p on p.id = e.actor_participant_id
      join company co on co.id = p.company_id
      join project_role r on r.id = p.project_role_id
      left join work_item_event_signer s on s.event_id = e.id
      where l.to_id = w.id and l.kind = 'raised_from' and c.created_at = w.closed_at
        -- Its Raise: the Comment's first Transition.
        and e.seq = (select min(x.seq) from work_item_event x where x.work_item_id = c.id and x.type = 'transition')
    ), '[]'::jsonb)
    from work_item w
    where w.id = p_work_item_id
  $$;
revoke all on function app.record_fact_comments(uuid) from public;

-- The record's 'transitions' fact (20271015): every Transition and issued Code of item
-- `p_work_item_id`, in order, each with who took it as the event's signer row kept them.
create function app.record_fact_transitions(p_work_item_id uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select coalesce((
      -- The Owner's review writes one copy of a move for each side of it: one is enough.
      select jsonb_agg(x.fact order by x.seq)
      from (
        select distinct on (e.transition_id, e.created_at, e.actor_member_id) e.seq,
          jsonb_build_object(
            'fromStepId', e.from_step_id,
            'toStepId', e.to_step_id,
            'kind', tr.kind,
            'outcomeMode', fs.outcome_mode,
            'label', tr.label,
            'at', app.iso_utc(e.created_at),
            -- As the event's signer row kept them when it was written; an event written
            -- before it has none, and is read as the Member is now.
            'memberName', coalesce(s.member_name, m.full_name),
            'positions', coalesce(s.positions, (
              select jsonb_agg(po.name order by po.sort)
              from project_member pm
              join project_member_position pmp on pmp.project_member_id = pm.id
              join position po on po.id = pmp.position_id
              where pm.participant_id = e.actor_participant_id and pm.member_id = e.actor_member_id
            ), '[]'::jsonb),
            'companyName', coalesce(s.company_name, c.legal_name),
            -- The Code's Remarks, from its own shared event only: never a Recommended Code (V7). Which Transition
            -- is the issued Code is the worker's to say, from the path (recordPath).
            'remarks', case when e.type = 'issue_code' and e.audience = 'shared' then e.payload ->> 'remarks' end,
            -- What the shared Action Form holds, from a shared event only (V5): the payload keeps the
            -- shared fields' answers (internal ones are their own internal_answers event), less what
            -- the engine writes.
            'answers', case when e.audience = 'shared' then nullif(e.payload - 'document_number' - 'outcome', '{}'::jsonb) end,
            'actionForm', tr.action_form,
            -- The Signature in force when the Member acted, as the event recorded it.
            'signature', (
              select jsonb_build_object('storageKey', f.storage_key, 'contentType', f.mime)
              from member_signature ms join stored_file f on f.id = ms.file_id
              where ms.id = e.signature_id
            ),
            'participantId', e.actor_participant_id,
            'roleName', pr2.name,
            'contentSha256', encode(e.content_sha256, 'hex')
          ) as fact
        from work_item_event e
        join workflow_transition tr on tr.id = e.transition_id
        join workflow_step fs on fs.id = e.from_step_id
        join member m on m.id = e.actor_member_id
        join participant p on p.id = e.actor_participant_id
        join project_role pr2 on pr2.id = p.project_role_id
        join company c on c.id = p.company_id
        left join work_item_event_signer s on s.event_id = e.id
        where e.work_item_id = p_work_item_id and e.type in ('transition', 'issue_code')
        order by e.transition_id, e.created_at, e.actor_member_id, e.seq
      ) x
    ), '[]'::jsonb)
  $$;
revoke all on function app.record_fact_transitions(uuid) from public;

-- As 20271015000000_record_reply_checklist.sql, with its companies, comments and transitions read
-- from the helpers above.
create or replace function app.documental_record_facts(p_outbox_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item_id uuid;
      v_answers jsonb;
      v_facts jsonb;
    begin
      perform app.require_worker();
      v_item_id := app.documental_record_item(p_outbox_id);
      if v_item_id is null or exists (select 1 from documental_record r where r.work_item_id = v_item_id) then
        return null;
      end if;
      v_answers := coalesce(app.shared_answers_of(v_item_id), '{}'::jsonb);
      select jsonb_build_object(
          'workItemId', w.id,
          'projectId', w.project_id,
          'projectName', pr.name,
          'recordLanguage', pr.record_language,
          'hijriDates', pr.record_hijri_dates,
          'type', jsonb_build_object('code', t.code, 'name', t.name),
          'documentNumber', w.document_number,
          'revisionNo', w.revision_no,
          'revisionOf', (
            select jsonb_build_object('documentNumber', o.document_number, 'closedAt', app.iso_utc(o.closed_at), 'outcome', o.outcome)
            from work_item o
            where o.id = w.revision_of_id and o.closed_at is not null and o.document_number is not null
          ),
          'subject', w.title,
          'outcome', w.outcome,
          'closedAt', app.iso_utc(w.closed_at),
          'submittedAt', app.iso_utc(w.submitted_at),
          'raiserParticipantId', w.raised_by_participant_id,
          'pdf', fv.schema -> 'pdf',
          'outcomes', coalesce((
            select jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name, 'polarity', o.polarity, 'actions', o.actions) order by o.sort, o.code)
            from outcome o
            where o.project_id = w.project_id and o.work_item_type_id = w.work_item_type_id and o.closing
          ), '[]'::jsonb),
          'companies', app.record_fact_companies(w.id),
          'trades', coalesce((
            select jsonb_agg(jsonb_build_object('name', dv.name, 'selected', dv.id = it.dimension_value_id) order by dv.sort, dv.id)
            from dimension_value dv
            join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'trade' and d.project_id = w.project_id
            left join (
              select x.dimension_value_id from work_item_dimension_value x
              join visibility_dimension xd on xd.id = x.dimension_id and xd.kind = 'trade'
              where x.work_item_id = w.id
            ) it on true
            where dv.parent_id is null
          ), '[]'::jsonb),
          -- The Location as the path from its first level down.
          'location', (
            with recursive up (id, parent_id, name, depth) as (
              select dv.id, dv.parent_id, dv.name, dv.depth
              from work_item_dimension_value x
              join visibility_dimension xd on xd.id = x.dimension_id and xd.kind = 'location'
              join dimension_value dv on dv.id = x.dimension_value_id
              where x.work_item_id = w.id
              union all
              select dv.id, dv.parent_id, dv.name, dv.depth from dimension_value dv join up on dv.id = up.parent_id
            )
            select jsonb_agg(up.name order by up.depth) from up
          ),
          'scopes', coalesce((
            select jsonb_agg(s.name order by s.depth, s.sort, s.id)
            from work_item_scope ws join scope s on s.id = ws.scope_id
            where ws.work_item_id = w.id
          ), '[]'::jsonb),
          'reviewComments', (
            select count(*) from work_item_link l
            join work_item c on c.id = l.from_id and c.discarded_at is null
            where l.to_id = w.id and l.kind = 'raised_from'
          ),
          'comments', app.record_fact_comments(w.id),
          -- Rabaed's own cancel when a Company left the Project (workflow-engine.md §9): no Member took it.
          'cancelledByRabaed', (
            select jsonb_build_object('companyName', co.legal_name)
            from work_item_event e
            join participant p on p.id = app.uuid_or_null(e.payload -> 'left_participant_id')
            join company co on co.id = p.company_id
            where e.work_item_id = w.id and e.type = 'cancelled' and e.actor_member_id is null and w.outcome = 'cancelled'
            order by e.seq desc
            limit 1
          ),
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
          -- The Checklist Template Versions the item copied (RP-651), which its reply checklists answer
          -- (RP-982); whoever sees the item reads them.
          'checklistCopies', coalesce((
            select jsonb_agg(jsonb_build_object(
                'fieldKey', c.field_key, 'versionId', c.checklist_template_version_id, 'name', c.name, 'items', c.items
              ) order by c.field_key)
            from work_item_checklist c
            where c.work_item_id = w.id
          ), '[]'::jsonb),
          -- The Documents the other Participants saw, in the order they were added, each with its
          -- fingerprint (RP-618): none of an item never Submitted, none added after the arrival the
          -- close follows (the close counts one arrival itself), so never one the holder added while
          -- it held the item at the close (V19), except a reply Document a shared event took, such as
          -- the closing code's checklist photos (RP-982): that event shared it.
          'documents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'fileName', d.file_name, 'contentType', d.content_type, 'size', d.size_bytes::bigint, 'storageKey', d.storage_key,
              'fieldKey', d.field_key, 'itemKey', d.item_key, 'takenAt', app.iso_utc(d.taken_at),
              'sha256', encode(d.file_sha256, 'hex')
            ) order by d.created_at, d.id) -- hidden-sort-key: the order they were added is what app.document_times (seq) already tells every reader, never the times
            from app.documents_shared_before_close(w.id) d
          ), '[]'::jsonb),
          'transitions', app.record_fact_transitions(w.id)
        )
      into v_facts
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      join form_version fv on fv.id = w.form_version_id
      where w.id = v_item_id and w.closed_at is not null and w.discarded_at is null;
      return v_facts;
    end
  $$;
