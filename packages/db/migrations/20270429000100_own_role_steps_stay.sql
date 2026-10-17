-- RP-90 (SNAG-1, spec RP-619): a Step of the acting Participant's own role stays with
-- that Participant (workflow-engine.md §3.1; visibility.md V3, scenario RP-90-4).
--
-- app.next_step_holder, after the raiser's own Steps: when the Step a Transition leads to
-- is of the acting Participant's role, that Participant holds it, as the raiser holds its
-- own role's Steps; with nobody of its Step Pool, `next_step_unavailable`, the one answer every
-- refusal to hand over gets outside the raiser's own Steps (visibility.md, "Refusals of a
-- Transition"). Until now such a Step
-- was resolved among every Participant of that role covering the item, so a move inside
-- the Contractor holding a Snag (Open ⇄ In Progress ⇄ On Hold) was refused once another
-- Contractor covered it too, and would have gone to it with a pick. Submittals' moves
-- inside the Consultant (Engineer → Manager) follow the same rule.
--
-- Rebuilt from its latest body (20270409000000_owner_review.sql).

create or replace function app.next_step_holder(p_work_item_id uuid, p_transition_id uuid)
  returns table (outcome text, participant_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_target record;
      v_candidates uuid[];
      v_previous uuid;
      v_actor uuid := (select me.participant_id from app.acting_project_member(p_work_item_id) me);
    begin
      select tr.to_step_id as step_id, tr.kind, target.actor_rule ->> 'base_role' as base_role,
        target.outcome_mode as target_outcome_mode,
        w.raised_by_participant_id as raiser_id, raiser_role.base_role as raiser_base_role
      into v_target
      from work_item w
      join workflow_transition tr on tr.id = p_transition_id and tr.workflow_version_id = w.workflow_version_id
      join workflow_step target on target.id = tr.to_step_id
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      where w.id = p_work_item_id;
      if v_target.base_role is null then
        return query select 'terminal'::text, null::uuid;
        return;
      end if;

      if v_target.base_role = v_target.raiser_base_role then
        -- The raiser's own Steps stay with the raiser, never another Participant of its role (V3).
        if exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_target.raiser_id, v_actor)) then
          return query select 'ok'::text, v_target.raiser_id;
        else
          return query select 'no_step_pool'::text, null::uuid;
        end if;
        return;
      end if;

      -- A Step of the acting Participant's own role stays with that Participant (RP-90): a
      -- move inside it, such as a Snag's Open ⇄ In Progress ⇄ On Hold at the Contractor,
      -- never goes to another Participant of its role covering the item too (V3).
      if exists (
        select 1 from participant p join project_role r on r.id = p.project_role_id
        where p.id = v_actor and r.base_role = v_target.base_role
      ) then
        if exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_actor, v_actor)) then
          return query select 'ok'::text, v_actor;
        else
          return query select 'next_step_unavailable'::text, null::uuid;
        end if;
        return;
      end if;

      -- A Send Back goes back to the Participant that held that Step (it Submitted the
      -- item from there), never to another of its role (V3): a Comment Returned to Open
      -- reaches the Contractor that resolved it.
      if v_target.kind = 'send_back' then
        select a.participant_id into v_previous from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_target.step_id and a.status = 'done'
        order by a.done_at desc, a.id desc limit 1;
      end if;
      if v_previous is not null then
        v_candidates := array[v_previous];
      else
        -- The Owner's review (ADR 0022): an Owner Representative covering the item holds it
        -- where the Project has one, else the Owner.
        if v_target.target_outcome_mode = 'confirm_code' and v_target.base_role = 'owner' then
          select coalesce(array_agg(p.id), '{}') into v_candidates
          from work_item w
          join participant p on p.project_id = w.project_id and p.status = 'active'
          join project_role r on r.id = p.project_role_id and r.base_role = 'owner_representative'
          where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
        end if;
        if coalesce(cardinality(v_candidates), 0) = 0 then
          select coalesce(array_agg(p.id), '{}') into v_candidates
          from work_item w
          join participant p on p.project_id = w.project_id and p.status = 'active'
          join project_role r on r.id = p.project_role_id and r.base_role = v_target.base_role
          where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
        end if;
      end if;
      if cardinality(v_candidates) = 1
        and exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_candidates[1], v_actor))
      then
        return query select 'ok'::text, v_candidates[1];
      else
        return query select 'next_step_unavailable'::text, null::uuid;
      end if;
    end
  $$;
