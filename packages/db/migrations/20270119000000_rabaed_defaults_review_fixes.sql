-- The RP-437 review fixes (Rabaed Default Workflows; product owner, 2026-10-11).
--
-- * A Step's actor Positions narrow its Step Pool (workflow-engine.md "Definition
--   format": `actor.positions`). The definition has carried them since RP-425, but no
--   pool read them: the MAR Workflow Version 3's Consultant Engineer Step names the
--   Consultant's Engineers (`positions: ["engineer"]`, RP-511 decision 1), so its
--   Manager, who also holds `review`, is not in its pool, and a Consultant with one
--   Engineer has it held at once (ADR 0018). app.step_pool keeps only the Project
--   Members holding one of the Step's Positions, when it names any; every pool read
--   (the next holder, Pick up, Handover, a pool of one) goes through it.
-- * app.work_item_history also gives each event's Action Form (`action_form`: its
--   Transition's, the pinned Screen Version's schema for one that shows a Screen), so
--   the api labels a reply's answers from the row itself, never by pairing rows by
--   their place (V20: Workflow definitions are read by every Project Member).
--
-- Rebuilt from their latest bodies: app.step_pool
-- (20270106100000_not_same_person_pool.sql), app.work_item_history
-- (20270116000000_screens.sql).

-- The Step Pool ------------------------------------------------------------------------------

-- As in the not_same_person_pool migration, narrowed to the Step's actor Positions when it names any.
create or replace function app.step_pool(p_work_item_id uuid, p_step_id uuid, p_participant_id uuid) returns table(project_member_id uuid, member_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_removed uuid[];
    begin
      select coalesce(array_agg(x.member_id), '{}') into v_removed
      from step_assignment a
      join work_item_event e on e.work_item_id = a.work_item_id and e.created_at = a.created_at and e.to_step_id = a.step_id
        and e.type in ('transition', 'issue_code')
      join workflow_transition tr on tr.id = e.transition_id and tr.rules is not null
      cross join lateral app.not_same_person_members(a.work_item_id, tr.rules, e.actor_participant_id) x
      where a.work_item_id = p_work_item_id and a.step_id = p_step_id and a.participant_id = p_participant_id
        and a.status = 'pooled';
      return query
        select pm.id, pm.member_id
        from work_item w
        join work_item_type t on t.id = w.work_item_type_id
        join workflow_step s on s.id = p_step_id and s.workflow_version_id = w.workflow_version_id
        join participant p on p.id = p_participant_id and p.project_id = w.project_id and p.status = 'active'
        join project_member pm on pm.participant_id = p.id and pm.status = 'active'
        join member m on m.id = pm.member_id and m.status = 'active' and m.company_id = p.company_id
        join company co on co.id = m.company_id and co.status = 'active'
        where w.id = p_work_item_id
          and pm.member_id <> all (v_removed)
          and app.project_member_has_permission(pm.id, t.module_key, s.actor_rule ->> 'permission')
          -- The Step's actor Positions, when it names any: a Member holding one of them.
          and (not (s.actor_rule ? 'positions') or exists (
            select 1 from project_member_position mp join position po on po.id = mp.position_id
            where mp.project_member_id = pm.id
              and po.key in (select jsonb_array_elements_text(s.actor_rule -> 'positions'))))
          and not exists (
            select 1 from work_item_dimension_value dv
            where dv.work_item_id = w.id
              and dv.dimension_value_id not in (select app.values_covered_by_project_member(pm.id, dv.dimension_id))
          );
    end
  $$;

-- The history --------------------------------------------------------------------------------

-- As in the screens migration, with each event's Action Form (`action_form`), its Transition's.
drop function app.work_item_history(uuid);
create function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text,
    outcome text, internal_note text, changes jsonb, remarks text, recommended_code text, handover jsonb, answers jsonb,
    action_form jsonb
  )
  language sql stable
  set search_path = pg_catalog, public
as $$
  select (row_number() over (order by e.seq))::integer, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
    tr.label, fs.name, ts.name,
    -- A pool of one's `assigned` event stores why ("only_member"): its label says so.
    case when e.type <> 'assigned' then e.payload ->> 'reason' end,
    e.payload ->> 'document_number', e.payload ->> 'outcome',
    e.payload ->> 'internal_note', e.payload -> 'changes', e.payload ->> 'remarks', e.payload ->> 'recommended_code',
    -- A Handover is internal to the holding Participant (V5), so both are its own Members.
    case when e.payload ? 'handover' then jsonb_build_object(
      'from', hf.full_name, 'to', ht.full_name, 'because', e.payload -> 'handover' ->> 'because') end,
    case
      when e.type in ('transition', 'issue_code') then nullif(e.payload - 'document_number' - 'outcome', '{}'::jsonb)
      when e.type = 'internal_answers' then e.payload -> 'answers'
    end,
    -- The Action Form the answers were given in, as its Workflow Version pinned it.
    case when e.type in ('transition', 'issue_code', 'internal_answers') then tr.action_form end
  from work_item_event e
  join work_item w on w.id = e.work_item_id
  left join app.work_item_companies(p_work_item_id) actor on actor.participant_id = e.actor_participant_id
  left join member m on m.id = e.actor_member_id
  left join workflow_transition tr on tr.id = e.transition_id
  left join workflow_step fs on fs.id = e.from_step_id
  left join workflow_step ts on ts.id = e.to_step_id
  left join member hf on hf.id = (e.payload -> 'handover' ->> 'from_member_id')::uuid
  left join member ht on ht.id = (e.payload -> 'handover' ->> 'to_member_id')::uuid
  where e.work_item_id = p_work_item_id
  order by e.seq
$$;
revoke all on function app.work_item_history(uuid) from public;
grant execute on function app.work_item_history(uuid) to rabaed_app;
