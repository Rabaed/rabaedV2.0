-- RP-658 (SNAG-12, spec RP-619): pick one of several covering Participants at a Submit
-- (workflow-engine.md §3.1; visibility.md V3, V14 and scenario RP-658-1).
--
-- When a Submit's next Step resolves to more than one active Participant of its role covering
-- the item (a Visibility Overlap), the actor picks one in the Action Form instead of the
-- Transition being refused: the Snag's Raise on one of two Contractors covering its Trade and
-- Location, a Question's Ask and a Site Observation's Raise likewise.
--
-- * app.next_step_candidates(item, transition): the covering candidates, the Owner's review
--   included (ADR 0022), moved out of app.next_step_holder unchanged.
-- * app.next_step_choices(item, transition): those of them with someone to hold the Step (its
--   Step Pool for the Transition, §3.2), whom a pick may name.
-- * app.next_step_holder gains the pick (p_pick). Several candidates at a Submit are judged by
--   their choices only, so a covering Participant with nobody to hold the Step is never told
--   apart from one not covering the item (V16): none, 'next_step_unavailable' (a Visibility
--   Gap's answer); one, it holds the Step at once, as a single candidate does; several, without
--   a pick 'participant_pick' (offered, not yet takeable), with a pick of one of them 'ok' for
--   it, and any other pick 'participant_not_offered', whoever it names.
-- * app.transition_next_holder passes the pick and answers 'participant_not_picked' for a
--   Submit that needs one; a pick where none is offered counts only when it names the one
--   Participant the item goes to, else 'participant_not_offered'.
-- * app.take_transition gains p_participant (last, default null) for the pick.
-- * app.takeable_transitions offers a Submit that needs a pick; app.work_item_actions says so
--   (picks_participant), and app.participants_offered lists the Participants to pick from, with
--   their Company names only, to the item's holder about to take that Transition only.
--
-- Each function is rebuilt from its latest body (`pnpm db:fn`). app.transition_effects is
-- unchanged: it takes the Participant app.transition_next_holder resolved.

-- The active Participants of the next Step's role covering the item (§3.1): an Owner
-- Representative covering it, where the Project has one, for a confirming Step the Owner
-- holds (ADR 0022), else the role's. From 20270611000000_raiser_step_holder.sql's
-- app.next_step_holder.
create function app.next_step_candidates(p_work_item_id uuid, p_transition_id uuid) returns uuid[]
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_target record;
      v_candidates uuid[];
    begin
      select app.actor_role(target.actor_rule, raiser_role.base_role) as base_role, target.outcome_mode as target_outcome_mode
      into v_target
      from work_item w
      join workflow_transition tr on tr.id = p_transition_id and tr.workflow_version_id = w.workflow_version_id
      join workflow_step target on target.id = tr.to_step_id
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      where w.id = p_work_item_id;
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
      return v_candidates;
    end
  $$;

revoke all on function app.next_step_candidates(uuid, uuid) from public;

-- The candidates the acting Participant may pick among (RP-658): those with someone to hold the
-- next Step, its Step Pool for the Transition (§3.2).
create function app.next_step_choices(p_work_item_id uuid, p_transition_id uuid, p_candidates uuid[]) returns uuid[]
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_actor uuid := (select me.participant_id from app.acting_project_member(p_work_item_id) me);
    begin
      return coalesce((
        select array_agg(c.id order by c.n)
        from unnest(p_candidates) with ordinality c (id, n)
        where exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, c.id, v_actor))
      ), '{}');
    end
  $$;

revoke all on function app.next_step_choices(uuid, uuid, uuid[]) from public;

-- From 20270611000000_raiser_step_holder.sql: the pick at a Submit to several (RP-658).
drop function app.next_step_holder(uuid, uuid);

create function app.next_step_holder(p_work_item_id uuid, p_transition_id uuid, p_pick uuid default null)
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
      select tr.to_step_id as step_id, tr.kind, app.actor_role(target.actor_rule, raiser_role.base_role) as base_role,
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
        -- The raiser's own Steps stay with the raiser, never another Participant of its role (V3):
        -- a Step of its role, and a Step held by the raiser, whatever its role (RP-622), a Send
        -- Back into it included.
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
        v_candidates := app.next_step_candidates(p_work_item_id, p_transition_id);
      end if;
      -- More than one covering Participant, at a Submit (RP-658): judged by those with someone
      -- to hold the Step only (app.next_step_choices), so one with nobody there is never told
      -- apart from one not covering the item (V16). One such: it holds the Step at once. Several:
      -- the actor picks one in the Action Form (app.participants_offered); without a pick it is
      -- offered but not taken ('participant_pick'), and any other pick is refused alike,
      -- whoever it names.
      if v_previous is null and v_target.kind = 'submit' and cardinality(v_candidates) > 1 then
        v_candidates := app.next_step_choices(p_work_item_id, p_transition_id, v_candidates);
        if cardinality(v_candidates) = 0 then
          return query select 'next_step_unavailable'::text, null::uuid;
        elsif cardinality(v_candidates) = 1 then
          return query select 'ok'::text, v_candidates[1];
        elsif p_pick is null then
          return query select 'participant_pick'::text, null::uuid;
        elsif p_pick = any(v_candidates) then
          return query select 'ok'::text, p_pick;
        else
          return query select 'participant_not_offered'::text, null::uuid;
        end if;
        return;
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

revoke all on function app.next_step_holder(uuid, uuid, uuid) from public;

-- From 20270117100000_raisers_form_review_fixes.sql: passes the pick.
drop function app.transition_next_holder(uuid, uuid, uuid, uuid);

create function app.transition_next_holder(
  p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_assign_to uuid, p_pick uuid default null
)
  returns table (outcome text, participant_id uuid, holder_member_id uuid)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_transition record;
      v_next record;
      v_holder uuid;
    begin
      select tr.key, tr.kind, tr.to_step_id into v_transition from workflow_transition tr where tr.id = p_transition_id;
      -- The Participant (§3), with the actor's pick among several covering it (RP-658).
      select * into v_next from app.next_step_holder(p_work_item_id, p_transition_id, p_pick);
      if v_next.outcome = 'participant_pick' then
        return query select 'participant_not_picked'::text, null::uuid, null::uuid;
        return;
      end if;
      if v_next.outcome not in ('ok', 'terminal') then
        return query select v_next.outcome, null::uuid, null::uuid;
        return;
      end if;
      -- A pick where the Transition offers none counts only when it names the one Participant
      -- the item goes to: any other is refused alike, whoever it names (V14).
      if p_pick is not null and v_next.participant_id is distinct from p_pick then
        return query select 'participant_not_offered'::text, null::uuid, null::uuid;
        return;
      end if;
      -- Publish checks 4 and 8 keep a Return inside one Participant; never take one across.
      if v_transition.kind = 'return' and v_next.participant_id is distinct from p_participant_id then
        raise exception 'Return % crosses Participants', v_transition.key;
      end if;
      -- Coming back by a Return or a Send Back: the person who held that Step before, if
      -- still in the Transition's pool. A Return into a Step nobody has held yet (the
      -- Contractor Engineer Step, the first time; ADR 0020): the item's author, who sent
      -- it from its Draft Step, if still in the pool.
      if v_transition.kind in ('return', 'send_back') then
        select a.assignee_member_id into v_holder from step_assignment a
        where a.work_item_id = p_work_item_id and a.status = 'done'
          and (a.step_id = v_transition.to_step_id
            or (v_transition.kind = 'return' and app.is_draft_step(a.step_id)
              and not exists (select 1 from step_assignment b where b.work_item_id = p_work_item_id and b.step_id = v_transition.to_step_id)))
          and a.assignee_member_id in (
            select p.member_id from app.transition_step_pool(p_work_item_id, p_transition_id, v_next.participant_id, p_participant_id) p)
        order by a.done_at desc, a.id desc limit 1;
      end if;
      -- "Assign to" (WF-8; §3.3, rule 2): the Member the actor picked, only one the
      -- Transition offers; any other pick is refused alike, whoever it names.
      if p_assign_to is not null then
        if not exists (
          select 1 from app.assignees_offered(p_work_item_id, p_transition_id, p_participant_id) o where o.member_id = p_assign_to)
        then
          return query select 'assignee_not_offered'::text, null::uuid, null::uuid;
          return;
        end if;
        v_holder := coalesce(v_holder, p_assign_to);
      end if;
      return query select v_next.outcome, v_next.participant_id, v_holder;
    end
  $$;

revoke all on function app.transition_next_holder(uuid, uuid, uuid, uuid, uuid) from public;

-- The Participants the actor may pick for Transition p_transition_id of item p_work_item_id
-- (RP-658): app.next_step_choices, each with its Company's name only (no Member, nothing of
-- its work; V14). Only to the item's holder, for a Transition from its current Step that needs
-- the pick; nothing to anyone else, nor otherwise.
create function app.participants_offered(p_work_item_id uuid, p_transition_id uuid)
  returns table(participant_id uuid, company_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_holder uuid;
    begin
      -- Nothing about an item the caller can't see.
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      select h.participant_id into v_holder
      from app.held_work_item(p_work_item_id) h
      join workflow_transition tr on tr.id = p_transition_id
        and tr.workflow_version_id = h.workflow_version_id and tr.from_step_id = h.current_step_id;
      if v_holder is null
        or (select n.outcome from app.next_step_holder(p_work_item_id, p_transition_id) n) is distinct from 'participant_pick'
      then
        return;
      end if;
      return query
        select p.id, co.legal_name
        from unnest(app.next_step_choices(
          p_work_item_id, p_transition_id, app.next_step_candidates(p_work_item_id, p_transition_id))) c (id)
        join participant p on p.id = c.id
        join company co on co.id = p.company_id
        order by co.legal_name ->> 'en', p.id;
    end
  $$;

revoke all on function app.participants_offered(uuid, uuid) from public;
grant execute on function app.participants_offered(uuid, uuid) to rabaed_app;

-- From 20270409000000_owner_review.sql: offers a Submit that needs the pick.
create or replace function app.takeable_transitions(p_work_item_id uuid) returns table(transition_id uuid, key text, label jsonb, kind text, sort integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select distinct on (tr.label) tr.id, tr.key, tr.label, tr.kind, tr.sort
        from app.held_work_item(p_work_item_id) h
        join work_item w on w.id = h.work_item_id
        join workflow_transition tr on tr.workflow_version_id = h.workflow_version_id and tr.from_step_id = h.current_step_id
        where app.project_member_has_permission(h.project_member_id, h.module_key, tr.permission)
          -- A Submit to one of several covering Participants is offered with its pick (RP-658).
          and (select n.outcome from app.next_step_holder(h.work_item_id, tr.id) n) in ('ok', 'terminal', 'participant_pick')
          and app.transition_restrictions_hold(h.work_item_id, tr.rules, h.project_member_id, h.participant_id)
          and app.cancel_allowed(tr.kind, h.submitted_at, w.revision_no)
          -- The Owner's review: only the close of the Code it confirms (ADR 0022).
          and app.confirm_allowed(h.work_item_id, tr.id)
          and (app.transition_routed(h.work_item_id, tr.id, '{}') is distinct from tr.id
            or app.transition_conditions_hold(h.work_item_id, tr.rules, '{}'))
        order by tr.label, tr.sort;
    end
  $$;

-- From 20270111000000_pool_of_one.sql: says which Transitions offer the Participant field.
drop function app.work_item_actions(uuid);

CREATE FUNCTION app.work_item_actions(p_work_item_id uuid)
 RETURNS TABLE(action text, transition_key text, label jsonb, transition_kind text, picks_participant boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    begin
      return query
        select 'pick_up', null::text, null::jsonb, null::text, false
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'pooled' and a.participant_id = me.participant_id
        where w.id = p_work_item_id and w.closed_at is null
          and me.project_member_id in (select project_member_id from app.step_pool(w.id, a.step_id, a.participant_id))
        union all
        select 'return_to_pool', null, null, null, false
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'picked_up'
          and a.assignee_member_id = app.current_member_id()
        where w.id = p_work_item_id and w.closed_at is null and not app.is_draft_step(a.step_id)
          -- Only while there is someone to give it back to (§3.3 rule 4).
          and (select count(*) from app.assignment_pool(a.id)) > 1
        union all
        select * from (
          -- Whether its Action Form offers the Participant field (RP-658): app.participants_offered lists them.
          select 'transition', t.key, t.label, t.kind,
            (select n.outcome from app.next_step_holder(p_work_item_id, t.transition_id) n) = 'participant_pick'
          from app.takeable_transitions(p_work_item_id) t order by t.sort
        ) x;
    end
  $function$;

revoke all on function app.work_item_actions(uuid) from public;
grant execute on function app.work_item_actions(uuid) to rabaed_app;

-- From 20270729000000_company_stamp.sql: the pick, p_participant.
drop function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz, uuid, text);

create or replace function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_answers jsonb, p_internal_note text, p_checked_data_sha256 bytea,
  p_idempotency_key uuid, p_now timestamptz, p_assign_to uuid default null, p_recommended_code text default null,
  p_participant uuid default null
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_me record;
      v_used record;
      v_assignment record;
      v_transition record;
      v_rules record;
      v_actions record;
      v_next record;
      v_internal text[];
      v_internal_answers jsonb;
      v_recommendation record;
      v_recommendation_found boolean := false;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      select w.*, t.module_key, pr.status as project_status
      into v_item
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;

      select work_item_id, command into v_used from command_idempotency
      where member_id = v_member_id and key = p_idempotency_key;
      if v_used.work_item_id is not null then
        return case when v_used.work_item_id = p_work_item_id and v_used.command = 'transition:' || p_transition_key
          then 'applied' else 'idempotency_key_reused' end;
      end if;

      if v_item.closed_at is not null then
        return 'item_closed';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      select * into v_assignment from step_assignment
      where work_item_id = p_work_item_id and status in ('pooled', 'picked_up', 'vacant');
      if v_assignment.status is distinct from 'picked_up' or v_assignment.assignee_member_id <> v_member_id
        or v_assignment.participant_id <> v_me.participant_id
      then
        return 'not_holder';
      end if;
      -- Check 6 (ADR 0023, RP-85): no Signature, no Transition. The holder's own state, so it
      -- tells nothing about the item or another Company; nobody is notified.
      if app.active_signature_id(v_member_id) is null then
        return 'no_signature';
      end if;
      -- Check 6 (ADR 0023, RP-617): no Stamp, no Transition. The holder's own Company's state,
      -- so it too tells nothing about the item or another Company; nobody is notified.
      if not app.member_company_has_stamp(v_member_id) then
        return 'no_stamp';
      end if;

      select tr.* into v_transition
      from workflow_transition tr
      where tr.workflow_version_id = v_item.workflow_version_id and tr.from_step_id = v_item.current_step_id
        and tr.key = p_transition_key;
      -- A Cancel after the first Submit, or of a Revision, isn't there either (RP-433).
      if v_transition.id is null or not app.cancel_allowed(v_transition.kind, v_item.submitted_at, v_item.revision_no) then
        return 'transition_not_available';
      end if;
      -- Its rules (WF-7): the route among Transitions sharing its label, Restrict, Validate.
      select * into v_rules from app.transition_rules(p_work_item_id, v_transition.id, p_answers);
      if v_rules.refusal is not null then
        return v_rules.refusal;
      end if;
      if v_rules.transition_id <> v_transition.id then
        select tr.* into v_transition from workflow_transition tr where tr.id = v_rules.transition_id;
      end if;
      -- The Owner's review (ADR 0022): only the close of the Code it confirms.
      if not app.confirm_allowed(p_work_item_id, v_transition.id) then
        return 'transition_not_available';
      end if;
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, v_transition.permission) then
        return 'forbidden';
      end if;
      -- The Action Form answers, which the API checked against the Transition's
      -- schema: here only that each is one of its fields and each field it always
      -- requires is answered, so the app role can't write others (a Return without its reason).
      if not app.action_form_fits(v_transition.action_form, p_answers) then
        return 'invalid_action_form';
      end if;
      -- Moving on by a Member who may save the answers now (the raiser's holder at a Step
      -- that edits the Form; or the Participant holding a Step a Form Section names), and
      -- every Submit of the raiser's, whoever takes it: only with the answers the API found
      -- complete (the row is locked). A cancel, a Return or a Send Back needs no complete Form.
      -- (app.answers_sha256_of without checking again: where it may save, and at a Submit,
      -- app.answers_open is app.is_draft_step of the Step its Participant entered at.)
      if v_transition.kind not in ('cancel', 'return', 'send_back')
        and ((v_transition.kind = 'submit' and v_me.participant_id = v_item.raised_by_participant_id)
          or app.can_save_answers(p_work_item_id))
        and p_checked_data_sha256 is distinct from app.answers_sha256_of(
          p_work_item_id, app.is_draft_step(v_item.participant_entered_step_id))
      then
        return 'form_not_checked';
      end if;
      -- The next holder (§3), with the "Assign to" pick (WF-8) and the Participant picked
      -- among those covering the item (RP-658).
      select * into v_next from app.transition_next_holder(p_work_item_id, v_transition.id, v_me.participant_id, p_assign_to, p_participant);
      if v_next.outcome not in ('ok', 'terminal') then
        return v_next.outcome;
      end if;
      -- The Recommended Code (RP-433, §5.3): only one the Transition offers, so only
      -- from a Step that Recommends a Code, to the next reviewer of the same
      -- Participant, and a closing outcome of the Type's set; refused alike otherwise,
      -- before the actions step writes anything.
      if p_recommended_code is not null and not exists (
        select 1 from app.recommendable_outcomes(p_work_item_id, v_transition.id, v_me.participant_id) o
        where o.code = p_recommended_code)
      then
        return 'recommended_code_not_offered';
      end if;
      -- The reply's internal answers (its Screen's internal fields, RP-516) stay inside
      -- the acting Participant (V5): never copied into a shared field or the Form (the
      -- publish checks refuse it too, copy_internal_answer).
      v_internal := app.transition_internal_fields(v_transition.id);
      if exists (
        select 1 from jsonb_array_elements(coalesce(v_transition.actions, '[]')) a
        where a.value ->> 'type' = 'copy_field' and a.value ->> 'from' = any(v_internal)
          and not (a.value ->> 'to' = any(v_internal)))
      then
        return 'action_not_allowed';
      end if;
      -- Its actions (WF-8): set and copy, into what the acting Participant fills at
      -- this Step only; refused as a whole, or written (and recorded) before any effect.
      select * into v_actions from app.transition_actions(p_work_item_id, v_transition.id, p_answers, v_at);
      if v_actions.refusal is not null then
        return v_actions.refusal;
      end if;

      -- The internal answers: their own event, carrying the Transition's id.
      v_internal_answers := coalesce((
        select jsonb_object_agg(a.key, a.value) from jsonb_each(coalesce(v_actions.answers, '{}')) a
        where a.key = any(v_internal)), '{}');
      if v_internal_answers <> '{}' then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'internal_answers', v_member_id, v_me.participant_id, v_transition.id,
          v_item.current_step_id, jsonb_build_object('answers', v_internal_answers), 'internal', v_me.participant_id, v_at
        );
      end if;

      -- Confirming the Owner's review: the Recommendation it confirms (its latest move there),
      -- read before the item moves on.
      if v_next.outcome = 'terminal' then
        select * into v_recommendation from app.recommendation_to_confirm(p_work_item_id);
        v_recommendation_found := found;
      end if;

      perform app.transition_effects(
        p_work_item_id, v_transition.id, v_me.participant_id, v_assignment.id,
        v_next.outcome, v_next.participant_id, v_next.holder_member_id,
        coalesce(v_actions.answers, '{}') - v_internal, nullif(btrim(p_internal_note), ''), p_recommended_code, v_at);
      -- Its outcome's follow-up items (WF-11: Code B's Comments), once it is closed: from
      -- the shared answers only, since the items are shared with the raiser (V5). Confirming
      -- the Owner's review makes them from the Recommendation's shared answers, raised by the
      -- Consultant and its Member who recommended the Code, the reviewer of record (ADR 0022).
      if v_next.outcome = 'terminal' and v_recommendation_found then
        perform app.transition_follow_up_items(
          p_work_item_id, v_recommendation.transition_id, v_recommendation.actor_participant_id,
          v_recommendation.answers, v_at, v_recommendation.actor_member_id);
      elsif v_next.outcome = 'terminal' then
        perform app.transition_follow_up_items(
          p_work_item_id, v_transition.id, v_me.participant_id, coalesce(v_actions.answers, '{}') - v_internal, v_at);
      end if;

      -- RP-594: a Supplier Approval Request closed at Code A or B puts its supplier on the
      -- Project's Approved Supplier List (workflow-engine.md §6). After the effects, so the
      -- item holds its outcome; the same transaction, so the list never lags the close.
      if v_next.outcome = 'terminal' then
        perform app.sar_adds_supplier(p_work_item_id, v_at);
      end if;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;

revoke all on function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz, uuid, text, uuid) from public;
grant execute on function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz, uuid, text, uuid) to rabaed_app;
