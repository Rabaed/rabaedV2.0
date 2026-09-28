-- Submit to the Consultant, and a Code closes the item (workflow-engine.md §3.1,
-- §5.1 effects 5–6; visibility.md V2, V5, V14; RP-194).
--
-- * Actor resolution, Participant stage (§3.1): a Step of the raiser's own role is
--   the raiser's. Any other role's Step goes to the one active Participant in that
--   role whose Visibility covers every dimension value of the item. None is a
--   Visibility Gap ('no_participant'); more than one is a Visibility Overlap
--   ('several_participants'), refused until the Action Form lets the submitter
--   pick one. Its Step Pool must not be empty ('no_step_pool').
-- * app.take_transition now takes Transitions to another Participant (Submit) and
--   into terminal Steps. Submit gives the Consultant 'handling' access and every
--   Owner and Owner Representative Participant whose Visibility covers the item
--   'oversight' access (V2). A Transition into a terminal Step sets outcome and
--   closed_at and leaves no open assignment; from an issue_code Step its event is
--   an 'issue_code' event carrying the Code.
-- * app.work_item_history adds each event's outcome, and names the person who
--   issued a Code to everyone who sees that event: the signer of the final Code is
--   the one person of another Company anyone sees (V14).
--
-- Skeleton limits: no Action Form to pick among several Participants, no default
-- holders, no signing (member_signature), no Documental Record job, outcome hooks
-- or outbox. Oversight is granted when the item is Submitted, from the Owner's and
-- Owner Representative's Participant Visibility at that moment: widening theirs
-- later doesn't reach items already submitted.

-- Whether a Participant's own Visibility covers every dimension value of the item.
create function app.participant_covers_item(p_participant_id uuid, p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select not exists (
      select 1 from work_item_dimension_value dv
      where dv.work_item_id = p_work_item_id
        and dv.dimension_value_id not in (select app.values_covered_by_participant(p_participant_id, dv.dimension_id))
    )
  $$;

-- Who would hold the Step a Transition leads to (§3.1, §3.2). Outcome: 'terminal'
-- (it closes the item: nobody), 'ok' with the Participant, 'no_participant',
-- 'several_participants' or 'no_step_pool'.
create function app.next_step_holder(p_work_item_id uuid, p_transition_id uuid)
  returns table (outcome text, participant_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_base_role text;
      v_raiser record;
      v_candidates uuid[];
    begin
      select target.actor_rule ->> 'base_role' into v_base_role
      from work_item w
      join workflow_transition tr on tr.id = p_transition_id and tr.workflow_version_id = w.workflow_version_id
      join workflow_step target on target.id = tr.to_step_id
      where w.id = p_work_item_id;
      if v_base_role is null then
        return query select 'terminal'::text, null::uuid;
        return;
      end if;

      select p.id, r.base_role into v_raiser
      from work_item w
      join participant p on p.id = w.raised_by_participant_id
      join project_role r on r.id = p.project_role_id
      where w.id = p_work_item_id;
      if v_base_role = v_raiser.base_role then
        -- The raiser's own Steps stay with the raiser, never another Participant of its role (V3).
        v_candidates := array[v_raiser.id];
      else
        select coalesce(array_agg(p.id), '{}') into v_candidates
        from work_item w
        join participant p on p.project_id = w.project_id and p.status = 'active'
        join project_role r on r.id = p.project_role_id and r.base_role = v_base_role
        where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
      end if;

      if cardinality(v_candidates) = 0 then
        return query select 'no_participant'::text, null::uuid;
      elsif cardinality(v_candidates) > 1 then
        return query select 'several_participants'::text, null::uuid;
      elsif not exists (
        select 1 from work_item w
        join workflow_transition tr on tr.id = p_transition_id
        cross join lateral app.step_pool(w.id, tr.to_step_id, v_candidates[1])
        where w.id = p_work_item_id
      ) then
        return query select 'no_step_pool'::text, null::uuid;
      else
        return query select 'ok'::text, v_candidates[1];
      end if;
    end
  $$;

-- The Transitions the acting Member may take now (§5.1 checks 1–4, 8): the item
-- is open on an active Project, they see it and hold its claimed assignment, the
-- Transition leaves the current Step on the pinned version, they hold its
-- permission, and someone could hold the next Step (or it closes the item).
create or replace function app.takeable_transitions(p_work_item_id uuid)
  returns table (transition_id uuid, key text, label jsonb, kind text, sort integer)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select tr.id, tr.key, tr.label, tr.kind, tr.sort
    from work_item w
    join project pr on pr.id = w.project_id and pr.status = 'active'
    join work_item_type t on t.id = w.work_item_type_id
    cross join lateral app.acting_project_member(w.id) me
    join step_assignment a on a.work_item_id = w.id and a.status = 'claimed'
      and a.assignee_member_id = app.current_member_id() and a.participant_id = me.participant_id
    join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.from_step_id = w.current_step_id
    where w.id = p_work_item_id and w.closed_at is null
      and app.project_member_has_permission(me.project_member_id, t.module_key, tr.permission)
      and (select h.outcome from app.next_step_holder(w.id, tr.id) h) in ('ok', 'terminal')
  $$;

-- Takes a Transition (§5.1) by its key. Outcome: 'applied' (also for the same
-- key again: nothing more happens), 'not_found' (they can't see the item),
-- 'item_closed', 'project_closed', 'not_holder', 'transition_not_available',
-- 'forbidden' (no permission), 'reason_required', 'no_participant' (no
-- Participant in the next Step's role covers the item), 'several_participants',
-- 'no_step_pool' (nobody could hold the next Step) or 'idempotency_key_reused'.
-- Any refusal writes nothing. A key is remembered only once applied: a replay
-- answers 'applied' whatever its reason, and a refused attempt may be retried
-- under the same key.
create or replace function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_reason text, p_idempotency_key uuid, p_now timestamptz
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
      v_next record;
      v_raiser record;
      v_reason text := nullif(btrim(p_reason), '');
      v_holder uuid;
      v_number text;
      v_prefix text;
      v_seq integer;
      v_audience text;
      v_outcome text;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      select w.*, t.module_key, t.code as type_code, pr.status as project_status, pr.code as project_code
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

      select tr.*, target.stage_key as to_stage_key,
        source.outcome_mode as from_outcome_mode, app.is_draft_step(source.id) as from_draft
      into v_transition
      from workflow_transition tr
      join workflow_step target on target.id = tr.to_step_id
      join workflow_step source on source.id = tr.from_step_id
      where tr.workflow_version_id = v_item.workflow_version_id and tr.from_step_id = v_item.current_step_id
        and tr.key = p_transition_key;
      if v_transition.id is null then
        return 'transition_not_available';
      end if;
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, v_transition.permission) then
        return 'forbidden';
      end if;
      if v_transition.kind = 'return' and v_reason is null then
        return 'reason_required';
      end if;

      -- The next holder (§3): the Participant, then, coming back by Return, the
      -- person who held that Step before if still in its pool; otherwise the pool.
      select * into v_next from app.next_step_holder(p_work_item_id, v_transition.id);
      if v_next.outcome not in ('ok', 'terminal') then
        return v_next.outcome;
      end if;
      if v_transition.kind = 'return' then
        select a.assignee_member_id into v_holder from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_transition.to_step_id and a.status = 'done'
          and a.assignee_member_id in (
            select member_id from app.step_pool(p_work_item_id, v_transition.to_step_id, v_next.participant_id))
        order by a.done_at desc, a.id desc limit 1;
      end if;

      -- Effects, in order.
      if v_item.document_number is null and v_transition.from_draft then
        select p.ordinal into v_raiser from participant p where p.id = v_item.raised_by_participant_id;
        v_prefix := concat_ws('-', v_item.project_code, v_item.type_code,
          lpad(v_raiser.ordinal::text, greatest(2, length(v_raiser.ordinal::text)), '0'));
        insert into numbering_counter as c (project_id, counter_key, last_value)
        values (v_item.project_id, v_prefix, 1)
        on conflict (project_id, counter_key) do update set last_value = c.last_value + 1
        returning last_value into v_seq;
        v_number := v_prefix || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
      end if;

      if v_next.outcome = 'terminal' then
        v_outcome := coalesce(v_transition.outcome, 'closed');
      end if;
      v_audience := case
        when v_transition.kind in ('submit', 'close') or v_transition.from_outcome_mode = 'issue_code'
          or v_next.outcome = 'terminal' then 'shared'
        else 'internal' end;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, created_at
      ) values (
        v_item.project_id, p_work_item_id,
        case when v_transition.from_outcome_mode = 'issue_code' then 'issue_code' else 'transition' end,
        v_member_id, v_me.participant_id, v_transition.id,
        v_item.current_step_id, v_transition.to_step_id,
        jsonb_strip_nulls(jsonb_build_object('reason', v_reason, 'document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then v_me.participant_id end,
        sha256(convert_to(jsonb_build_object('title', v_item.title, 'data', v_item.data)::text, 'UTF8')),
        v_at
      );

      update step_assignment set status = 'done', done_at = v_at, updated_at = v_at where id = v_assignment.id;

      update work_item set
        current_step_id = v_transition.to_step_id,
        current_stage_key = v_transition.to_stage_key,
        step_entered_at = v_at,
        document_number = coalesce(document_number, v_number),
        outcome = v_outcome,
        closed_at = case when v_outcome is not null then v_at end,
        updated_at = v_at
      where id = p_work_item_id;

      if v_next.outcome = 'ok' then
        insert into step_assignment (
          project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at, updated_at
        ) values (
          v_item.project_id, p_work_item_id, v_transition.to_step_id, v_next.participant_id, v_holder,
          case when v_holder is null then 'pooled' else 'claimed' end,
          case when v_holder is null then null else v_at end, v_at, v_at
        );
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (p_work_item_id, v_item.project_id, v_next.participant_id, v_at, 'handling')
        on conflict do nothing;
      end if;

      -- Oversight (V2): Owners and Owner Representatives whose Visibility covers the Submitted item.
      if v_transition.kind = 'submit' then
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        select p_work_item_id, v_item.project_id, p.id, v_at, 'oversight'
        from participant p
        join project_role r on r.id = p.project_role_id
        where p.project_id = v_item.project_id and p.status = 'active'
          and r.base_role in ('owner', 'owner_representative')
          and app.participant_covers_item(p.id, p_work_item_id)
        on conflict do nothing;
      end if;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;

-- The person who issued a Code, for anyone who sees that shared event; null for
-- any other event. The one person of another Company anyone is shown (V14).
create function app.code_signer_name(p_event_id uuid) returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select m.full_name
    from work_item_event e
    join member m on m.id = e.actor_member_id
    where e.id = p_event_id and e.type = 'issue_code' and e.audience = 'shared'
      and app.sees_work_item(e.work_item_id)
  $$;

-- The item's history the acting Member may see: its events through RLS (internal
-- ones only for their own Participant, layer 5), with each actor's Company name
-- and, within their own Company only, the person's name; the signer of a Code is
-- named to everyone who sees it (V14).
drop function app.work_item_history(uuid);
create function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text, outcome text
  )
  language sql stable security invoker
  set search_path = pg_catalog, public
  as $$
    select e.seq, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
      tr.label, fs.name, ts.name, e.payload ->> 'reason', e.payload ->> 'document_number', e.payload ->> 'outcome'
    from work_item_event e
    join work_item w on w.id = e.work_item_id
    left join app.project_participants(w.project_id) actor on actor.participant_id = e.actor_participant_id
    left join member m on m.id = e.actor_member_id
    left join workflow_transition tr on tr.id = e.transition_id
    left join workflow_step fs on fs.id = e.from_step_id
    left join workflow_step ts on ts.id = e.to_step_id
    where e.work_item_id = p_work_item_id
    order by e.seq
  $$;

revoke all on function
  app.participant_covers_item(uuid, uuid),
  app.next_step_holder(uuid, uuid),
  app.code_signer_name(uuid),
  app.work_item_history(uuid)
  from public;
-- work_item_history runs as the caller, so the caller needs the signer lookup; it
-- answers only for a Code event of an item they see.
grant execute on function app.code_signer_name(uuid), app.work_item_history(uuid) to rabaed_app;
