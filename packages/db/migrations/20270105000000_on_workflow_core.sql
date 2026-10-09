-- Spec RP-423's run-time behaviour on lane B's workflow core (PR #159: RP-436
-- Transition confirmed and recorded, RP-426 WF-3 ownership and bindings, RP-427
-- WF-4 authoring). Each function below is defined on main by PR #159 and changed
-- by this spec; each starts from PR #159's body and re-applies this spec's change,
-- once, in this migration that sorts after both (CODING_STANDARDS: a function
-- redefined on both sides of a merge ends with one body that has both changes).
--
-- * app.is_draft_step: PR #159's (a Stage key of category draft, in any Module:
--   a Project's own Workflow is no Type's default), read from the Stage set the
--   Workflow is published against (RP-428, WF-5): its Project's for a Project's own
--   Workflow, the Rabaed Defaults' for any other (a Rabaed Default or a Library one).
-- * app.can_create_revision: PR #159's (the Draft Step of the chain's own Workflow,
--   app.revision_draft_step), asking that the closed item's outcome offers a
--   Revision in its Type's set on the Project (RP-429, WF-6) instead of Code C.
-- * app.workflow_version_rows and app.store_workflow_draft: PR #159's, carrying a
--   Transition's rules (RP-430, WF-7), actions (RP-431, WF-8) and notifications
--   (RP-432, WF-9) columns, each only when it has them, so authoring (the api,
--   Rabaed Admin, the `workflow:publish` CLI, a copy) keeps them. The api no
--   longer refuses a draft holding them.
-- * app.take_transition: PR #159's (the event hashes the item's exact content,
--   app.work_item_content_sha256, ADR 0017), with the rules step and the routed
--   Transition (WF-7), "Assign to" (`p_assign_to`, the 8th argument) and the
--   actions step (WF-8). The 7-argument signature is dropped, so no stale
--   overload stays executable.

-- Whether a Step is a Draft ------------------------------------------------------------

create or replace function app.is_draft_step(p_step_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1 from workflow_step s
          join workflow_version v on v.id = s.workflow_version_id
          join workflow_definition d on d.id = v.workflow_definition_id
          join stage st on st.key = s.stage_key
            and case when d.owner_kind = 'project' then st.project_id = d.project_id else st.owner_kind = 'rabaed' end
          where s.id = p_step_id and st.category = 'draft'
        )
      );
    end
  $$;

-- Who may create a Revision ------------------------------------------------------------

create or replace function app.can_create_revision(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(p_work_item_id) and exists (
          select 1
          from work_item w
          join work_item_type t on t.id = w.work_item_type_id
          join project pr on pr.id = w.project_id and pr.status = 'active'
          join app.acting_project_member(w.id) me on me.participant_id = w.raised_by_participant_id
          join participant p on p.id = me.participant_id
          join project_role r on r.id = p.project_role_id
          join app.revision_draft_step(w.id) d on true
          where w.id = p_work_item_id
            and app.outcome_offers(w.project_id, w.work_item_type_id, w.outcome, 'offer_revision') and w.discarded_at is null
            and d.actor_rule ->> 'base_role' = r.base_role
            and app.project_member_has_permission(me.project_member_id, t.module_key, d.actor_rule ->> 'permission')
            -- The latest of its chain, and nothing of the chain open.
            and not exists (
              select 1 from work_item o
              where o.root_id = w.root_id and o.discarded_at is null
                and (o.revision_no > w.revision_no or o.closed_at is null))
        )
      );
    end
  $$;

-- A Version's rows, with a Transition's rules, actions and notifications ----------------------

create or replace function app.workflow_version_rows(p_version_id uuid)
  returns table (layout jsonb, steps jsonb, transitions jsonb)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select v.layout,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'key', s.key, 'name', s.name, 'stage_key', s.stage_key, 'actor_rule', s.actor_rule,
              'is_signing', s.is_signing, 'outcome_mode', s.outcome_mode) order by s.created_at, s.key)
            from workflow_step s where s.workflow_version_id = v.id), '[]'::jsonb),
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'key', t.key, 'from_step_key', f.key, 'to_step_key', s.key, 'label', t.label, 'kind', t.kind,
              'outcome', t.outcome, 'permission', t.permission, 'sort', t.sort, 'action_form', t.action_form)
              -- Each only when the Transition has it, as @rabaed/domain's rows have them.
              || case when t.rules is null then '{}'::jsonb else jsonb_build_object('rules', t.rules) end
              || case when t.actions is null then '{}'::jsonb else jsonb_build_object('actions', t.actions) end
              || case when t.notifications is null then '{}'::jsonb else jsonb_build_object('notifications', t.notifications) end
              order by t.sort, t.key)
            from workflow_transition t
            join workflow_step f on f.id = t.from_step_id
            join workflow_step s on s.id = t.to_step_id
            where t.workflow_version_id = v.id), '[]'::jsonb)
        from workflow_version v
        where v.id = p_version_id;
    end
  $$;

create or replace function app.store_workflow_draft(
  p_definition_id uuid, p_name jsonb, p_layout jsonb, p_steps jsonb, p_transitions jsonb, p_at timestamptz
) returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_version record;
      v_version_id uuid;
      v_count integer;
    begin
      perform 1 from workflow_definition d where d.id = p_definition_id for update;
      if not found then
        return query select 'not_found'::text, null::uuid, null::integer;
        return;
      end if;
      if p_name is not null and not app.is_bilingual(p_name) then
        return query select 'invalid_name'::text, null::uuid, null::integer;
        return;
      end if;
      if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_typeof(p_transitions) is distinct from 'array'
        or jsonb_typeof(coalesce(p_layout, '{}')) <> 'object'
        or (select count(distinct s ->> 'key') from jsonb_array_elements(p_steps) s) <> jsonb_array_length(p_steps)
        or (select count(distinct t ->> 'key') from jsonb_array_elements(p_transitions) t) <> jsonb_array_length(p_transitions)
        or exists (
          select 1 from jsonb_array_elements(p_transitions) t
          where not exists (select 1 from jsonb_array_elements(p_steps) s where s ->> 'key' = t ->> 'from_step_key')
             or not exists (select 1 from jsonb_array_elements(p_steps) s where s ->> 'key' = t ->> 'to_step_key'))
      then
        return query select 'invalid_definition'::text, null::uuid, null::integer;
        return;
      end if;

      select v.id, v.version_no, v.status into v_version
      from workflow_version v where v.workflow_definition_id = p_definition_id
      order by v.version_no desc limit 1;
      if v_version.id is not null and v_version.status = 'draft' then
        v_version_id := v_version.id;
        delete from workflow_transition t where t.workflow_version_id = v_version_id;
        delete from workflow_step s where s.workflow_version_id = v_version_id;
        update workflow_version v
        set layout = coalesce(p_layout, '{}'), draft_name = coalesce(p_name, v.draft_name), updated_at = p_at
        where v.id = v_version_id;
      else
        insert into workflow_version (workflow_definition_id, version_no, status, layout, draft_name, created_at, updated_at)
        values (p_definition_id, coalesce(v_version.version_no, 0) + 1, 'draft', coalesce(p_layout, '{}'), p_name, p_at, p_at)
        returning id into v_version_id;
      end if;

      insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, is_signing, outcome_mode, created_at)
      select v_version_id, e.s ->> 'key', e.s -> 'name', e.s ->> 'stage_key', coalesce(e.s -> 'actor_rule', '{}'), false,
        e.s ->> 'outcome_mode',
        -- In the order given, which the draft's read keeps.
        p_at + make_interval(secs => e.ord / 1000000.0)
      from jsonb_array_elements(p_steps) with ordinality as e (s, ord);
      insert into workflow_transition (
        workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form,
        rules, actions, notifications, created_at
      )
      select v_version_id, e.t ->> 'key', f.id, s.id, e.t -> 'label', e.t ->> 'kind', e.t ->> 'outcome', e.t ->> 'permission',
        coalesce((e.t ->> 'sort')::integer, e.ord::integer), nullif(e.t -> 'action_form', 'null'::jsonb),
        nullif(e.t -> 'rules', 'null'::jsonb), nullif(e.t -> 'actions', 'null'::jsonb), nullif(e.t -> 'notifications', 'null'::jsonb),
        p_at
      from jsonb_array_elements(p_transitions) with ordinality as e (t, ord)
      join workflow_step f on f.workflow_version_id = v_version_id and f.key = e.t ->> 'from_step_key'
      join workflow_step s on s.workflow_version_id = v_version_id and s.key = e.t ->> 'to_step_key';
      get diagnostics v_count = row_count;
      if v_count <> jsonb_array_length(p_transitions) then
        raise exception 'store_workflow_draft: a Transition lost its Steps';
      end if;
      return query select 'saved'::text, v_version_id, (select v.version_no from workflow_version v where v.id = v_version_id);
    end
  $$;

-- Taking a Transition -----------------------------------------------------------------

drop function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz);

create or replace function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_answers jsonb, p_internal_note text, p_checked_data_sha256 bytea,
  p_idempotency_key uuid, p_now timestamptz, p_assign_to uuid default null
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
      v_note text := nullif(btrim(p_internal_note), '');
      v_holder uuid;
      v_number text;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
      v_discarded text[];
      v_data jsonb;
      v_times jsonb;
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
      -- Its rules (WF-7): the route among Transitions sharing its label, Restrict, Validate.
      select * into v_rules from app.transition_rules(p_work_item_id, v_transition.id, p_answers);
      if v_rules.refusal is not null then
        return v_rules.refusal;
      end if;
      if v_rules.transition_id <> v_transition.id then
        select tr.*, target.stage_key as to_stage_key,
          source.outcome_mode as from_outcome_mode, app.is_draft_step(source.id) as from_draft
        into v_transition
        from workflow_transition tr
        join workflow_step target on target.id = tr.to_step_id
        join workflow_step source on source.id = tr.from_step_id
        where tr.id = v_rules.transition_id;
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

      -- The next holder (§3): the Participant, then, coming back by a Return or a
      -- Send Back, the person who held that Step before if still in its pool;
      -- otherwise the pool.
      select * into v_next from app.next_step_holder(p_work_item_id, v_transition.id);
      if v_next.outcome not in ('ok', 'terminal') then
        return v_next.outcome;
      end if;
      -- Publish checks 4 and 8 keep a Return inside one Participant; never take one across.
      if v_transition.kind = 'return' and v_next.participant_id is distinct from v_me.participant_id then
        raise exception 'Return % crosses Participants', v_transition.key;
      end if;
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
          select 1 from app.assignees_offered(p_work_item_id, v_transition.id, v_me.participant_id) o where o.member_id = p_assign_to)
        then
          return 'assignee_not_offered';
        end if;
        v_holder := coalesce(v_holder, p_assign_to);
      end if;
      -- Its actions (WF-8): set and copy, into what the acting Participant fills at
      -- this Step only; refused as a whole, or written (and recorded) before any effect.
      select * into v_actions from app.transition_actions(p_work_item_id, v_transition.id, p_answers, v_at);
      if v_actions.refusal is not null then
        return v_actions.refusal;
      end if;
      select w.data, w.field_times, w.data_as_arrived, w.field_times_as_arrived
      into v_item.data, v_item.field_times, v_item.data_as_arrived, v_item.field_times_as_arrived
      from work_item w where w.id = p_work_item_id;

      -- Effects, in order.
      -- The Document Number, from the Numbering Pattern in effect (gap-free: in this transaction).
      if v_item.document_number is null and v_transition.from_draft then
        if v_item.revision_no > 0 then
          -- RP-316: a Revision takes its chain's base number with " Rev n", and no counter.
          v_number := (select r.document_number from work_item r where r.id = v_item.root_id) || ' Rev ' || v_item.revision_no;
        else
          v_number := app.issue_document_number(p_work_item_id, v_at);
        end if;
      end if;

      if v_next.outcome = 'terminal' then
        v_outcome := coalesce(v_transition.outcome, case when v_transition.kind = 'cancel' then 'cancelled' end);
        -- Publish-time validation requires one (workflow-engine.md §1, check 3); never guess it.
        if v_outcome is null then
          raise exception 'Transition % closes the item without an outcome', v_transition.key;
        end if;
      end if;
      -- The Internal Note stays inside the writer's Participant even when the
      -- Transition crosses to another (V5). It goes just before the Transition it
      -- is written with.
      if v_note is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'internal_note', v_member_id, v_me.participant_id, v_transition.id,
          jsonb_build_object('internal_note', v_note), 'internal', v_me.participant_id, v_at
        );
      end if;
      -- It leaves the acting Participant: handed to another, or closed (nobody holds it).
      v_crosses := v_next.participant_id is distinct from v_me.participant_id;
      -- A Send Back out of a Step of a Participant other than the raiser discards
      -- what it wrote: the sections it fills go back to how they arrived, their
      -- field times too, before the trigger clears the "as arrived" copy (V19, ADR 0013).
      v_data := v_item.data;
      v_times := v_item.field_times;
      if v_transition.kind = 'send_back' and v_crosses and v_me.participant_id <> v_item.raised_by_participant_id
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
        v_member_id, v_me.participant_id, v_transition.id,
        v_item.current_step_id, v_transition.to_step_id,
        -- The Action Form answers (with what its actions set), then what the engine
        -- writes (no Action Form field takes those keys).
        jsonb_strip_nulls(v_actions.answers || jsonb_build_object('document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then v_me.participant_id end,
        -- The item's exact content as this Transition leaves it (ADR 0017).
        app.work_item_content_sha256(p_work_item_id, v_item.title, v_data, v_outcome),
        v_at
      );

      update step_assignment set status = 'done', done_at = v_at, updated_at = v_at where id = v_assignment.id;

      update work_item set
        current_step_id = v_transition.to_step_id,
        current_stage_key = v_transition.to_stage_key,
        step_entered_at = v_at,
        participant_entered_at = case when v_crosses then v_at else participant_entered_at end,
        participant_entered_step_id = case when v_crosses then v_transition.to_step_id else participant_entered_step_id end,
        document_number = coalesce(document_number, v_number),
        -- The Creation Date: with the Document Number, at the first exit from Draft.
        numbered_at = case when v_number is not null then coalesce(numbered_at, v_at) else numbered_at end,
        -- The Submission Date: the first Submit out of the raiser's Participant; never changed.
        submitted_at = case
          when v_transition.kind = 'submit' and v_me.participant_id = v_item.raised_by_participant_id
            then coalesce(submitted_at, v_at)
          else submitted_at end,
        outcome = v_outcome,
        closed_at = case when v_outcome is not null then v_at end,
        data = v_data,
        field_times = v_times,
        updated_at = v_at
      where id = p_work_item_id;
      if v_discarded is not null then
        perform app.sync_link_answers(p_work_item_id, v_item.project_id, v_item.form_version_id, v_data, v_at);
      end if;

      -- RP-316: the item a Revision revises links to it from its first Submit, never
      -- while it is the raiser's own (V1).
      if v_transition.kind = 'submit' and v_item.revision_of_id is not null then
        insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
        values (v_item.project_id, v_item.revision_of_id, p_work_item_id, 'related', v_member_id, v_at)
        on conflict on constraint work_item_link_once do nothing;
      end if;

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

revoke all on function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz, uuid) from public;
grant execute on function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz, uuid) to rabaed_app;
