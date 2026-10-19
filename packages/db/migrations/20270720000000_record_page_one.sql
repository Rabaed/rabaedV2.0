-- RP-151 (spec RP-632; ADR 0023; form-engine.md §6, elements 1 to 9): page 1 of the Documental
-- Record and the Form's content, and the Project's record language and Hijri dates.
--
-- * project.record_language ('bilingual' by default, 'ar', 'en') and project.record_hijri_dates
--   (off by default): set by a Project Admin (app.set_project_record_settings); they apply to
--   records made afterwards, because the record job reads them when it makes the record.
-- * app.shared_answers_of: the item's answers as every reader of the item reads them (no member
--   answers, a participant answer only for a Company everyone reads, a link question by number and
--   Subject only, an unshared item of the chain left out), without a calling Member. It is the body
--   app.work_item_shared_answers had, taken out so the worker's read and the Member's are one
--   definition; app.work_item_shared_answers (redefined from 20270117000400_list_row_commands.sql)
--   keeps its Member check and calls it.
-- * app.documental_record_facts (rebuilt from 20270709000000_documental_record.sql) also gives
--   the worker what page 1 and the Form print: the Submission Date, the Revision's source, the
--   Companies on the item with their Project Roles, the Project's Trades with the item's marked,
--   its Location and Scopes, the Type's closing outcomes (the chips), each Code event's Remarks,
--   the number of Review Comments, the Form's sections with the shared answers and what names
--   their ids (Option Lists, Approved Suppliers, Companies), the shared Documents, and the
--   Project's record settings. Each Transition also gives its Company's Project Role, its kind
--   and outcome mode. Still never read here: Returns' reasons, Internal Notes, Recommended
--   Codes, Chat, in-progress answers, the Draft-started time (V7). A Return stays in the Transitions
--   only so the worker can leave it and the work around it out (recordPath).
-- * The PDF template tables the data model once held (pdf_template, pdf_template_version) were
--   never built, so there is nothing to drop; the layout is one, shipped with the code (ADR 0023).
-- app.take_transition and app.transition_effects are not touched.

alter table project add column record_language text not null default 'bilingual'
  check (record_language in ('bilingual', 'ar', 'en'));
alter table project add column record_hijri_dates boolean not null default false;

-- A Project Admin sets the record language and whether Hijri dates show beside the Gregorian ones.
-- Outcome: 'set'; 'not_found' for anyone who is no Project Admin of the Project (whether it exists or
-- not), or a language that is none of the three; 'project_closed'. Setting what it already is is 'set'.
create function app.set_project_record_settings(p_project_id uuid, p_language text, p_hijri_dates boolean) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_status text;
    begin
      if p_language is null or p_language not in ('bilingual', 'ar', 'en') or p_hijri_dates is null
        or not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id)
      then
        return 'not_found';
      end if;
      select status into v_status from project where id = p_project_id for update;
      if v_status = 'closed' then
        return 'project_closed';
      end if;
      update project set record_language = p_language, record_hijri_dates = p_hijri_dates, updated_at = now()
      where id = p_project_id and (record_language, record_hijri_dates) is distinct from (p_language, p_hijri_dates);
      return 'set';
    end
  $$;
revoke all on function app.set_project_record_settings(uuid, text, boolean) from public;
grant execute on function app.set_project_record_settings(uuid, text, boolean) to rabaed_app;

-- The answers of an item as everyone who reads it reads them, nothing before its first Submit (see the header).
create function app.shared_answers_of(p_work_item_id uuid) returns jsonb
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
        cross join lateral (select coalesce(w.data_as_arrived, app.work_item_full_answers(w.id)) as src) a
        where w.id = p_work_item_id and w.submitted_at is not null
      );
    end
  $$;
revoke all on function app.shared_answers_of(uuid) from public;

-- The Member's read, as before: the answers of an item they see, null otherwise.
create or replace function app.work_item_shared_answers(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  set jit = off
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      return app.shared_answers_of(p_work_item_id);
    end
  $$;

-- What the Record Data is written from, as the worker; null when the row is not a record job, the
-- item is not closed, or it has its record already.
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
          'outcomes', coalesce((
            select jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name, 'polarity', o.polarity, 'actions', o.actions) order by o.sort, o.code)
            from outcome o
            where o.project_id = w.project_id and o.work_item_type_id = w.work_item_type_id and o.closing
          ), '[]'::jsonb),
          -- The Owner, and every Company on the item (the raiser, the Companies a Step was given to and
          -- every Company whose Member took a Transition), each with its Project Role.
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
                or p.id in (select a.participant_id from step_assignment a where a.work_item_id = w.id)
                or p.id in (
                  select e.actor_participant_id from work_item_event e
                  where e.work_item_id = w.id and e.type in ('transition', 'issue_code') and e.actor_participant_id is not null)
              )
          ), '[]'::jsonb),
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
          -- The Documents everyone who reads the closed item reads, in the order they were added.
          'documents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'fileName', d.file_name, 'contentType', d.content_type, 'size', d.size_bytes::bigint, 'storageKey', d.storage_key,
              'fieldKey', d.field_key, 'itemKey', d.item_key, 'takenAt', app.iso_utc(d.taken_at)
            ) order by d.created_at, d.id) -- hidden-sort-key: the order they were added is what app.document_times (seq) already tells every reader, never the times
            from document d
            where d.work_item_id = w.id and d.confirmed_at is not null and d.removed_at is null
          ), '[]'::jsonb),
          'transitions', coalesce((
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
              where e.work_item_id = w.id and e.type in ('transition', 'issue_code')
              order by e.transition_id, e.created_at, e.actor_member_id, e.seq
            ) x
          ), '[]'::jsonb)
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
