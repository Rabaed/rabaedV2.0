-- RP-982 (INSP-13; spec RP-649; ADR 0023, ADR 0024 amended 2026-10-19; form-engine.md §3.3 and
-- §6; visibility.md V19, the Documental Record row, scenario RP-982-1): the Documental Record
-- prints a reply Screen's checklist as the code took it, with its photos.
--
-- * app.documents_shared_before_close (from 20270926000000_record_appendix.sql) also gives a reply
--   Document a shared event took (`document.reply_event_id`, RP-623, RP-86): the code's event shares
--   it with everyone who sees the item, as it shares the checklist's answers. Before, the rule
--   counted arrivals only, and a reply Document is added in the arrival the close follows, so the
--   photos of a checklist the closing code took were left out. A reply Document no Transition took
--   is removed when the item leaves its holder (`work_item_discards_reply_files`), and one only an
--   internal event took (the Owner's review, workflow-engine.md §5.3a) stays out, as before. The
--   Form's photos, the Documents list, the appendix and Re-produce all read this one rule.
-- * app.documental_record_facts (rebuilt from 20270926000000_record_appendix.sql) adds
--   `checklistCopies`: the Checklist Template Versions the item copied (`work_item_checklist`,
--   RP-651), read by whoever sees the item, which a reply checklist answers. The answers come from
--   the code's shared event, as the facts' `transitions[].answers` already give them (never an
--   internal event's, an Internal Note or a Recommended Code); nothing waiting in `reply_checklist`.
-- app.take_transition, app.transition_effects and app.documental_record_reproduction_source are not
-- touched.

-- As in 20270926000000_record_appendix.sql, with the reply Documents a shared event took.
create or replace function app.documents_shared_before_close(p_work_item_id uuid) returns setof document
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select d.* from document d
        join work_item w on w.id = d.work_item_id
        where d.work_item_id = p_work_item_id and w.closed_at is not null and w.submitted_at is not null
          and d.confirmed_at is not null and d.removed_at is null
          and (
            d.arrival < w.arrivals - 1
            -- A reply Screen's file or checklist photo, taken by a Transition whose event is shared.
            or exists (
              select 1 from work_item_event e
              where e.id = d.reply_event_id and e.work_item_id = d.work_item_id and e.audience = 'shared')
          );
    end
  $$;
revoke all on function app.documents_shared_before_close(uuid) from public;

-- As in 20270926000000_record_appendix.sql, with `checklistCopies`.
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
          -- The Owner, and every Company on the item (the raiser, the Companies a Step was given to and
          -- every Company whose Member took a Transition), each with its Project Role, and its logo and
          -- Stamp in force when the item closed.
          'companies', coalesce((
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
          -- The Comments the issued Code raised, in the order its reply listed them: made by its
          -- closing (created when it closed), each with who raised it as they were then.
          'comments', coalesce((
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
          ), '[]'::jsonb),
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
          -- it held the item at the close (V19).
          'documents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'fileName', d.file_name, 'contentType', d.content_type, 'size', d.size_bytes::bigint, 'storageKey', d.storage_key,
              'fieldKey', d.field_key, 'itemKey', d.item_key, 'takenAt', app.iso_utc(d.taken_at),
              'sha256', encode(d.file_sha256, 'hex')
            ) order by d.created_at, d.id) -- hidden-sort-key: the order they were added is what app.document_times (seq) already tells every reader, never the times
            from app.documents_shared_before_close(w.id) d
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
