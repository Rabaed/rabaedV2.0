-- Review fixes of spec RP-423 (RP-449): app.take_transition and app.takeable_transitions
-- with their copied blocks extracted (CODING_STANDARDS, Database: "A function redefined
-- again by a later ticket of the same branch or spec gets its copied block extracted
-- first"). Behaviour is unchanged; later tickets (WF-11, WF-13, WF-14) redefine a short
-- body and call these helpers.
--
-- * app.cancel_allowed: "a Cancel only until the item is first Submitted" (RP-433),
--   defined once, for app.takeable_transitions (offered) and app.take_transition (taken).
-- * app.held_work_item: the item, when the acting Member holds it (open, on an active
--   Project, its claimed assignment theirs and their Participant's), with what the
--   offers read. Shared by app.takeable_transitions, app.transition_assignees and
--   app.transition_recommendable_outcomes.
-- * app.transition_next_holder: who holds the next Step (§3): the Participant, then,
--   coming back by a Return or a Send Back, the Member who held that Step before if
--   still in its pool, or the "Assign to" pick (WF-8); its refusal otherwise.
-- * app.transition_effects: everything a Transition writes once every check passed:
--   the Document Number, the Recommended Code and Internal Note events, the Send Back
--   discard, the Transition's event, the item, the next assignment, Oversight.
-- * app.take_transition: as 20270105100000_cancel_take_transition.sql left it, its
--   checks in order, then the helpers.

-- A Cancel only until the item is first Submitted (RP-433) ----------------------------------

-- Whether a Transition of kind `p_kind` may be taken on an item Submitted at
-- `p_submitted_at` (null: never Submitted): anything but a Cancel, and a Cancel
-- only before the first Submit, even back at the raiser's Steps after a Send Back.
create function app.cancel_allowed(p_kind text, p_submitted_at timestamptz) returns boolean
  language sql immutable
  as $$ select p_kind <> 'cancel' or p_submitted_at is null $$;

-- The item the acting Member holds ----------------------------------------------------------

-- Item `p_work_item_id` when the acting Member holds it: open, on an active Project,
-- its claimed assignment theirs and their Participant's; with its Workflow Version,
-- current Step, first Submit, its Type's Module and the acting Member's Project
-- membership. No row otherwise.
create function app.held_work_item(p_work_item_id uuid)
  returns table (
    work_item_id uuid, workflow_version_id uuid, current_step_id uuid, submitted_at timestamptz,
    module_key text, project_member_id uuid, participant_id uuid
  )
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select w.id, w.workflow_version_id, w.current_step_id, w.submitted_at, t.module_key, me.project_member_id, me.participant_id
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        join work_item_type t on t.id = w.work_item_type_id
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'claimed'
          and a.assignee_member_id = app.current_member_id() and a.participant_id = me.participant_id
        where w.id = p_work_item_id and w.closed_at is null;
    end
  $$;

-- What the acting Member may press ---------------------------------------------------

-- As in 20270103000000_cancel_recommended_code.sql, on app.held_work_item and app.cancel_allowed.
create or replace function app.takeable_transitions(p_work_item_id uuid) returns table(transition_id uuid, key text, label jsonb, kind text, sort integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select distinct on (tr.label) tr.id, tr.key, tr.label, tr.kind, tr.sort
        from app.held_work_item(p_work_item_id) h
        join workflow_transition tr on tr.workflow_version_id = h.workflow_version_id and tr.from_step_id = h.current_step_id
        where app.project_member_has_permission(h.project_member_id, h.module_key, tr.permission)
          and (select n.outcome from app.next_step_holder(h.work_item_id, tr.id) n) in ('ok', 'terminal')
          and app.transition_restrictions_hold(h.work_item_id, tr.rules, h.project_member_id, h.participant_id)
          and app.cancel_allowed(tr.kind, h.submitted_at)
          and (app.transition_routed(h.work_item_id, tr.id, '{}') is distinct from tr.id
            or app.transition_conditions_hold(h.work_item_id, tr.rules, '{}'))
        order by tr.label, tr.sort;
    end
  $$;

-- As in 20261231000000_transition_actions.sql, on app.held_work_item.
create or replace function app.transition_assignees(p_work_item_id uuid, p_transition_key text)
  returns table(member_id uuid, full_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select m.id, m.full_name
        from app.held_work_item(p_work_item_id) h
        join workflow_transition tr on tr.workflow_version_id = h.workflow_version_id and tr.from_step_id = h.current_step_id
          and tr.key = p_transition_key
        cross join lateral app.assignees_offered(
          h.work_item_id, coalesce(app.transition_routed(h.work_item_id, tr.id, '{}'), tr.id), h.participant_id) o
        join member m on m.id = o.member_id
        where app.sees_work_item(h.work_item_id)
        order by m.full_name ->> 'en', m.id;
    end
  $$;

-- As in 20270103000000_cancel_recommended_code.sql, on app.held_work_item.
create or replace function app.transition_recommendable_outcomes(p_work_item_id uuid, p_transition_key text)
  returns table(code text, name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select o.code, o.name
        from app.held_work_item(p_work_item_id) h
        join workflow_transition tr on tr.workflow_version_id = h.workflow_version_id and tr.from_step_id = h.current_step_id
          and tr.key = p_transition_key
        cross join lateral app.recommendable_outcomes(
          h.work_item_id, coalesce(app.transition_routed(h.work_item_id, tr.id, '{}'), tr.id), h.participant_id) o
        where app.sees_work_item(h.work_item_id);
    end
  $$;

-- Who holds the next Step ---------------------------------------------------------------

-- Who holds the next Step when the acting Participant `p_participant_id` takes
-- Transition `p_transition_id` (§3), with "Assign to" pick `p_assign_to` (null:
-- none): `outcome` 'ok' (with the Participant, and the Member when one is chosen)
-- or 'terminal'; otherwise the refusal ('no_step_pool', 'next_step_unavailable',
-- 'assignee_not_offered').
create function app.transition_next_holder(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_assign_to uuid)
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
      -- The Participant (§3).
      select * into v_next from app.next_step_holder(p_work_item_id, p_transition_id);
      if v_next.outcome not in ('ok', 'terminal') then
        return query select v_next.outcome, null::uuid, null::uuid;
        return;
      end if;
      -- Publish checks 4 and 8 keep a Return inside one Participant; never take one across.
      if v_transition.kind = 'return' and v_next.participant_id is distinct from p_participant_id then
        raise exception 'Return % crosses Participants', v_transition.key;
      end if;
      -- Coming back by a Return or a Send Back: the person who held that Step before, if
      -- still in its pool.
      if v_transition.kind in ('return', 'send_back') then
        select a.assignee_member_id into v_holder from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_transition.to_step_id and a.status = 'done'
          and a.assignee_member_id in (
            select member_id from app.step_pool(p_work_item_id, v_transition.to_step_id, v_next.participant_id))
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

-- What a Transition writes ----------------------------------------------------------------

-- Every effect of the acting Member (of Participant `p_participant_id`, holding
-- assignment `p_assignment_id`) taking Transition `p_transition_id`, once every check
-- has passed and the actions step has written: `p_next` is
-- app.transition_next_holder's outcome, Participant and Member; `p_answers` the
-- Action Form answers to record (with what its actions set).
create function app.transition_effects(
  p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_assignment_id uuid,
  p_next_outcome text, p_next_participant_id uuid, p_holder uuid,
  p_answers jsonb, p_note text, p_recommended_code text, p_at timestamptz
) returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_transition record;
      v_number text;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
      v_discarded text[];
      v_data jsonb;
      v_times jsonb;
    begin
      select w.* into v_item from work_item w where w.id = p_work_item_id;
      select tr.*, target.stage_key as to_stage_key,
        source.outcome_mode as from_outcome_mode, app.is_draft_step(source.id) as from_draft
      into v_transition
      from workflow_transition tr
      join workflow_step target on target.id = tr.to_step_id
      join workflow_step source on source.id = tr.from_step_id
      where tr.id = p_transition_id;

      -- The Document Number, from the Numbering Pattern in effect (gap-free: in this transaction).
      -- A Cancel issues none (RP-433): a Draft cancelled keeps "No number yet".
      if v_item.document_number is null and v_transition.from_draft and v_transition.kind <> 'cancel' then
        if v_item.revision_no > 0 then
          -- RP-316: a Revision takes its chain's base number with " Rev n", and no counter.
          v_number := (select r.document_number from work_item r where r.id = v_item.root_id) || ' Rev ' || v_item.revision_no;
        else
          v_number := app.issue_document_number(p_work_item_id, p_at);
        end if;
      end if;

      if p_next_outcome = 'terminal' then
        v_outcome := coalesce(v_transition.outcome, case when v_transition.kind = 'cancel' then 'cancelled' end);
        -- Publish-time validation requires one (workflow-engine.md §1, check 3); never guess it.
        if v_outcome is null then
          raise exception 'Transition % closes the item without an outcome', v_transition.key;
        end if;
      end if;
      -- The Recommended Code is Internal Communication (V5): its own event, internal to
      -- the recommender's Participant, just before the Internal Note written with it
      -- and the Transition. Never on the item, so no other read can reach it.
      if p_recommended_code is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'recommend_code', v_member_id, p_participant_id, p_transition_id,
          v_item.current_step_id, jsonb_build_object('recommended_code', p_recommended_code), 'internal', p_participant_id, p_at
        );
      end if;
      -- The Internal Note stays inside the writer's Participant even when the
      -- Transition crosses to another (V5). It goes just before the Transition it
      -- is written with.
      if p_note is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'internal_note', v_member_id, p_participant_id, p_transition_id,
          jsonb_build_object('internal_note', p_note), 'internal', p_participant_id, p_at
        );
      end if;
      -- It leaves the acting Participant: handed to another, or closed (nobody holds it).
      v_crosses := p_next_participant_id is distinct from p_participant_id;
      -- A Send Back out of a Step of a Participant other than the raiser discards
      -- what it wrote: the sections it fills go back to how they arrived, their
      -- field times too, before the trigger clears the "as arrived" copy (V19, ADR 0013).
      v_data := v_item.data;
      v_times := v_item.field_times;
      if v_transition.kind = 'send_back' and v_crosses and p_participant_id <> v_item.raised_by_participant_id
        and v_item.data_as_arrived is not null
      then
        v_discarded := array(
          select k from unnest(app.revision_dropped_keys(p_work_item_id)) k where k not in ('trade', 'location', 'scopes'));
        v_data := (v_data - v_discarded) || coalesce((
          select jsonb_object_agg(k, v_item.data_as_arrived -> k) from unnest(v_discarded) k where v_item.data_as_arrived ? k), '{}');
        v_times := (v_times - v_discarded) || coalesce((
          select jsonb_object_agg(k, a.times -> k)
          from unnest(v_discarded) k
          cross join (select coalesce(v_item.field_times_as_arrived, v_item.field_times) as times) a
          where a.times ? k), '{}');
      end if;
      -- Only what crosses is shared (a Send Back always does): a move inside one
      -- Participant stays its own, even from a Step that could issue a Code (V5, V14).
      v_audience := case
        when v_crosses or v_transition.kind in ('submit', 'send_back', 'close') then 'shared'
        else 'internal' end;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, created_at
      ) values (
        v_item.project_id, p_work_item_id,
        -- A Code is issued only where one is set; any other move from that Step is a plain Transition.
        case when v_transition.from_outcome_mode = 'issue_code' and v_outcome is not null then 'issue_code'
          else 'transition' end,
        v_member_id, p_participant_id, p_transition_id,
        v_item.current_step_id, v_transition.to_step_id,
        -- The Action Form answers (with what its actions set), then what the engine
        -- writes (no Action Form field takes those keys).
        jsonb_strip_nulls(p_answers || jsonb_build_object('document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then p_participant_id end,
        -- The item's exact content as this Transition leaves it (ADR 0017).
        app.work_item_content_sha256(p_work_item_id, v_item.title, v_data, v_outcome),
        p_at
      );

      update step_assignment set status = 'done', done_at = p_at, updated_at = p_at where id = p_assignment_id;

      update work_item set
        current_step_id = v_transition.to_step_id,
        current_stage_key = v_transition.to_stage_key,
        step_entered_at = p_at,
        participant_entered_at = case when v_crosses then p_at else participant_entered_at end,
        participant_entered_step_id = case when v_crosses then v_transition.to_step_id else participant_entered_step_id end,
        document_number = coalesce(document_number, v_number),
        -- The Creation Date: with the Document Number, at the first exit from Draft.
        numbered_at = case when v_number is not null then coalesce(numbered_at, p_at) else numbered_at end,
        -- The Submission Date: the first Submit out of the raiser's Participant; never changed.
        submitted_at = case
          when v_transition.kind = 'submit' and p_participant_id = v_item.raised_by_participant_id
            then coalesce(submitted_at, p_at)
          else submitted_at end,
        outcome = v_outcome,
        closed_at = case when v_outcome is not null then p_at end,
        data = v_data,
        field_times = v_times,
        updated_at = p_at
      where id = p_work_item_id;
      if v_discarded is not null then
        perform app.sync_link_answers(p_work_item_id, v_item.project_id, v_item.form_version_id, v_data, p_at);
      end if;

      -- RP-316: the item a Revision revises links to it from its first Submit, never
      -- while it is the raiser's own (V1).
      if v_transition.kind = 'submit' and v_item.revision_of_id is not null then
        insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
        values (v_item.project_id, v_item.revision_of_id, p_work_item_id, 'related', v_member_id, p_at)
        on conflict on constraint work_item_link_once do nothing;
      end if;

      if p_next_outcome = 'ok' then
        insert into step_assignment (
          project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at, updated_at
        ) values (
          v_item.project_id, p_work_item_id, v_transition.to_step_id, p_next_participant_id, p_holder,
          case when p_holder is null then 'pooled' else 'claimed' end,
          case when p_holder is null then null else p_at end, p_at, p_at
        );
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (p_work_item_id, v_item.project_id, p_next_participant_id, p_at, 'handling')
        on conflict do nothing;
      end if;

      -- Oversight (V2): Owners and Owner Representatives whose Visibility covers the Submitted item.
      if v_transition.kind = 'submit' then
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        select p_work_item_id, v_item.project_id, p.id, p_at, 'oversight'
        from participant p
        join project_role r on r.id = p.project_role_id
        where p.project_id = v_item.project_id and p.status = 'active'
          and r.base_role in ('owner', 'owner_representative')
          and app.participant_covers_item(p.id, p_work_item_id)
        on conflict do nothing;
      end if;
    end
  $$;

-- Taking a Transition -----------------------------------------------------------------

create or replace function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_answers jsonb, p_internal_note text, p_checked_data_sha256 bytea,
  p_idempotency_key uuid, p_now timestamptz, p_assign_to uuid default null, p_recommended_code text default null
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
      where work_item_id = p_work_item_id and status in ('pooled', 'claimed', 'vacant');
      if v_assignment.status is distinct from 'claimed' or v_assignment.assignee_member_id <> v_member_id
        or v_assignment.participant_id <> v_me.participant_id
      then
        return 'not_holder';
      end if;

      select tr.* into v_transition
      from workflow_transition tr
      where tr.workflow_version_id = v_item.workflow_version_id and tr.from_step_id = v_item.current_step_id
        and tr.key = p_transition_key;
      -- A Cancel after the first Submit isn't there either (RP-433).
      if v_transition.id is null or not app.cancel_allowed(v_transition.kind, v_item.submitted_at) then
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
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, v_transition.permission) then
        return 'forbidden';
      end if;
      -- The Action Form answers, which the API checked against the Transition's
      -- schema: here only that each is one of its fields and each field it always
      -- requires is answered, so the app role can't write others (a Return without its reason).
      if not app.action_form_fits(v_transition.action_form, p_answers) then
        return 'invalid_action_form';
      end if;
      -- Moving on by a Member who may save the answers now (the raiser while they
      -- are open, Draft and its internal Steps, so a Submit too; or the Participant
      -- holding a Step a Form Section names): only with the answers the API found
      -- complete (the row is locked). A cancel, a Return or a Send Back needs no complete Form.
      -- (app.answers_sha256_of without checking again: where it may save, app.answers_open
      -- is app.is_draft_step of the Step its Participant entered at.)
      if v_transition.kind not in ('cancel', 'return', 'send_back') and app.can_save_answers(p_work_item_id)
        and p_checked_data_sha256 is distinct from app.answers_sha256_of(
          p_work_item_id, app.is_draft_step(v_item.participant_entered_step_id))
      then
        return 'form_not_checked';
      end if;
      -- The next holder (§3), with the "Assign to" pick (WF-8).
      select * into v_next from app.transition_next_holder(p_work_item_id, v_transition.id, v_me.participant_id, p_assign_to);
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
      -- Its actions (WF-8): set and copy, into what the acting Participant fills at
      -- this Step only; refused as a whole, or written (and recorded) before any effect.
      select * into v_actions from app.transition_actions(p_work_item_id, v_transition.id, p_answers, v_at);
      if v_actions.refusal is not null then
        return v_actions.refusal;
      end if;

      perform app.transition_effects(
        p_work_item_id, v_transition.id, v_me.participant_id, v_assignment.id,
        v_next.outcome, v_next.participant_id, v_next.holder_member_id,
        v_actions.answers, nullif(btrim(p_internal_note), ''), p_recommended_code, v_at);

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;

revoke all on function app.cancel_allowed(text, timestamptz) from public;
revoke all on function app.held_work_item(uuid) from public;
revoke all on function app.transition_next_holder(uuid, uuid, uuid, uuid) from public;
revoke all on function
  app.transition_effects(uuid, uuid, uuid, uuid, text, uuid, uuid, jsonb, text, text, timestamptz)
  from public;
