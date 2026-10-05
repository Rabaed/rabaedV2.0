-- MAR Workflow Version 2: Remarks with the Consultant's Code (RP-303, spec RP-299;
-- form-engine.md §4 "Remarks"; visibility.md V5).
--
-- * Version 2 is Version 1 (Steps, Transitions, their Action Forms) plus a Remarks
--   textarea in the Action Forms of approve_a (optional) and revise_c (required).
--   Version 1 is untouched: items already on it keep it, and new MARs pin the latest
--   published Version (app.create_work_item), so from now on this one.
-- * Remarks are an answer like any Action Form field: app.take_transition already
--   stores them in the Transition event's payload, a shared event (a Code closes
--   the item, so it crosses). The Internal Note written with the Code stays its own
--   internal event.
-- * app.work_item_history adds each event's Remarks, beside the Code.

do $$
  declare
    v_v1 uuid;
    v_v2 uuid;
  begin
    select v.id into v_v1
    from work_item_type t
    join workflow_version v on v.workflow_definition_id = t.workflow_definition_id and v.version_no = 1
    where t.owner_kind = 'rabaed' and t.code = 'MAR';

    insert into workflow_version (workflow_definition_id, version_no, status, layout, published_at)
    select workflow_definition_id, 2, 'published', layout, now() from workflow_version where id = v_v1
    returning id into v_v2;

    insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, is_signing, outcome_mode)
    select v_v2, key, name, stage_key, actor_rule, is_signing, outcome_mode
    from workflow_step where workflow_version_id = v_v1;

    insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form)
    select v_v2, t.key, f2.id, s2.id, t.label, t.kind, t.outcome, t.permission, t.sort,
      case t.key
        when 'approve_a' then $schema$
          { "sections": [ { "key": "remarks", "title": { "en": "Remarks", "ar": "الملاحظات" }, "fields": [
            { "key": "remarks", "type": "textarea", "required": false, "maxLength": 4000,
              "label": { "en": "Remarks", "ar": "الملاحظات" },
              "help": { "en": "Shared with everyone who sees this item.", "ar": "يراها كل من يرى هذا العنصر." } } ] } ] }
        $schema$::jsonb
        when 'revise_c' then $schema$
          { "sections": [ { "key": "remarks", "title": { "en": "Remarks", "ar": "الملاحظات" }, "fields": [
            { "key": "remarks", "type": "textarea", "required": true, "maxLength": 4000,
              "label": { "en": "Remarks", "ar": "الملاحظات" },
              "help": { "en": "Shared with everyone who sees this item.", "ar": "يراها كل من يرى هذا العنصر." } } ] } ] }
        $schema$::jsonb
        else t.action_form
      end
    from workflow_transition t
    join workflow_step f1 on f1.id = t.from_step_id
    join workflow_step s1 on s1.id = t.to_step_id
    join workflow_step f2 on f2.workflow_version_id = v_v2 and f2.key = f1.key
    join workflow_step s2 on s2.workflow_version_id = v_v2 and s2.key = s1.key
    where t.workflow_version_id = v_v1;
  end
$$;

-- History -----------------------------------------------------------------------------

-- As in the answers_history migration, with each event's Remarks.
drop function app.work_item_history(uuid);
create function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text, outcome text,
    internal_note text, changes jsonb, remarks text
  )
  language sql stable security invoker
  set search_path = pg_catalog, public
  as $$
    select (row_number() over (order by e.seq))::integer, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
      tr.label, fs.name, ts.name, e.payload ->> 'reason', e.payload ->> 'document_number', e.payload ->> 'outcome',
      e.payload ->> 'internal_note', e.payload -> 'changes', e.payload ->> 'remarks'
    from work_item_event e
    join work_item w on w.id = e.work_item_id
    left join app.work_item_companies(p_work_item_id) actor on actor.participant_id = e.actor_participant_id
    left join member m on m.id = e.actor_member_id
    left join workflow_transition tr on tr.id = e.transition_id
    left join workflow_step fs on fs.id = e.from_step_id
    left join workflow_step ts on ts.id = e.to_step_id
    where e.work_item_id = p_work_item_id
    order by e.seq
  $$;

revoke all on function app.work_item_history(uuid) from public;
grant execute on function app.work_item_history(uuid) to rabaed_app;
