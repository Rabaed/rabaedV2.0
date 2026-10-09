-- Transition actions at run time: "Assign to" among the actor's own Participant's
-- Members, set a field, copy a field (RP-431, WF-8; spec RP-423; workflow-engine.md
-- §1 "Definition format", §3.3, §5.1; visibility.md "Refusals of a Transition",
-- scenarios RP-431-1 and RP-431-2).
--
-- * workflow_transition.actions: a Transition's actions as the definition format
--   has them (workflow-definition.ts `actions`), null when it has none. Published
--   Versions keep null: adding the column changes no row, so the frozen-Version
--   guard (RP-424) has nothing to refuse.
-- * "Assign to" (offer_assign_to): app.assignees_offered is the one rule. The
--   Members offered are the next Step's Step Pool (app.step_pool: Positions with
--   its permission, Visibility covering the item) when the next Step is held by
--   the actor's own Participant, else nobody: never another Company's Members.
--   app.transition_assignees gives the API that list for a Transition key.
--   take_transition takes the pick as `p_assign_to` (§3.3, rule 2: after the
--   holder coming back by a Return or a Send Back): a pick it couldn't have offered
--   (another Company's Member, a Member without the Position or the Visibility, a
--   made-up id, or a Transition that offers no Assign to) is refused
--   'assignee_not_offered', one answer for all, with nothing written.
-- * Set and copy: app.transition_actions, the actions step, kept apart from
--   app.take_transition so later redefinitions call it unchanged. It runs after
--   the rules step and every check, before any effect, in the same transaction. A
--   write goes into the Transition's Action Form answers when the Action Form has
--   that key, else into the Form, and only into the fields the acting Participant
--   fills at that Step: its Action Form's, and those of the Form Sections it may
--   change now (app.editable_section_keys; no calculated or Built-in Field). A copy
--   reads only from those same fields, as the actor reads them (app.work_item_answers),
--   so never from another Participant's answers (V19) or an Internal Note (not a
--   field). On a move inside one Participant (send, return) the Action Form
--   answers are Internal Communication (V5: internal approvals, Returns,
--   Recommended Codes): a copy from them into the Form is refused, since the Form
--   reaches every Participant once the item leaves. "Now" is the moment the
--   Transition is taken, into a date (Riyadh), time (Riyadh) or date and time
--   (UTC) field only; a Member field is never set to a value (names_person). Any
--   other write is refused 'action_not_allowed', one answer whatever the reason,
--   with nothing written. Publishing refuses each of them first (workflow-checks.ts).
-- * Form writes are recorded like any answer change (app.save_work_item_answers):
--   the answers as they arrived kept for everyone else (V19), field times, and,
--   once the item has left Draft, an answers_changed event internal to the actor's
--   Participant, just before the Transition's event, whose content hash covers them.
-- * app.take_transition: as the transition_rules migration left it (the rules step
--   and the routed Transition unchanged), with `p_assign_to` and the actions step.
--   Its old signature is dropped, so no stale overload stays executable.

alter table workflow_transition add column actions jsonb
  check (actions is null or jsonb_typeof(actions) = 'array');

-- "Assign to" --------------------------------------------------------------------------

-- The Members the acting Participant `p_participant_id` may pick as the next holder
-- when taking Transition `p_transition_id`: nobody unless it offers "Assign to" and
-- its next Step is held by that same Participant; then that Step's Step Pool.
create function app.assignees_offered(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid)
  returns table(member_id uuid)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_to_step uuid;
      v_next record;
    begin
      select tr.to_step_id into v_to_step from workflow_transition tr
      where tr.id = p_transition_id and coalesce(tr.actions, '[]') @> '[{"type": "offer_assign_to"}]';
      if v_to_step is null then
        return;
      end if;
      select * into v_next from app.next_step_holder(p_work_item_id, p_transition_id);
      if v_next.outcome is distinct from 'ok' or v_next.participant_id is distinct from p_participant_id then
        return;
      end if;
      return query select p.member_id from app.step_pool(p_work_item_id, v_to_step, p_participant_id) p;
    end
  $$;

-- For the API: the Members the acting Member, holding the item, may pick when taking
-- `p_transition_key` (the Transition its button takes before any pop-up answer),
-- with their names: only their own Participant's, so their own Company's (V14).
create function app.transition_assignees(p_work_item_id uuid, p_transition_key text)
  returns table(member_id uuid, full_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select m.id, m.full_name
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'claimed'
          and a.assignee_member_id = app.current_member_id() and a.participant_id = me.participant_id
        join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.from_step_id = w.current_step_id
          and tr.key = p_transition_key
        cross join lateral app.assignees_offered(w.id, coalesce(app.transition_routed(w.id, tr.id, '{}'), tr.id), me.participant_id) o
        join member m on m.id = o.member_id
        where w.id = p_work_item_id and w.closed_at is null and app.sees_work_item(w.id)
        order by m.full_name ->> 'en', m.id;
    end
  $$;

-- Set and copy ------------------------------------------------------------------------------

-- The answer a `date`, `time` (Riyadh) or `datetime` (UTC) field takes for the moment `p_at`.
create function app.moment_answer(p_type text, p_at timestamptz) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select to_jsonb(case p_type
      when 'date' then to_char(p_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD')
      when 'time' then to_char(p_at at time zone 'Asia/Riyadh', 'HH24:MI')
      when 'datetime' then to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end)
  $$;

-- The actions step of taking Transition `p_transition_id` with the Action Form
-- answers `p_answers`, by the acting Member holding the item: the Action Form
-- answers to record, and the refusal, if any ('action_not_allowed', nothing
-- written). Form writes are saved, and recorded, here.
create function app.transition_actions(p_work_item_id uuid, p_transition_id uuid, p_answers jsonb, p_at timestamptz)
  returns table(refusal text, answers jsonb)
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_transition record;
      v_item record;
      v_me record;
      v_answers jsonb := coalesce(p_answers, '{}');
      v_action_form_types jsonb;
      v_form_types jsonb;
      v_reads jsonb;
      v_changes jsonb := '{}';
      v_action jsonb;
      v_to text;
      v_from text;
      v_type text;
      v_value jsonb;
      v_data jsonb;
      v_before jsonb;
      v_after jsonb;
      v_recorded_before jsonb;
      v_recorded_after jsonb;
      v_changed jsonb;
    begin
      select tr.actions, tr.kind, tr.action_form into v_transition from workflow_transition tr where tr.id = p_transition_id;
      if not exists (
        select 1 from jsonb_array_elements(coalesce(v_transition.actions, '[]')) a where a.value ->> 'type' <> 'offer_assign_to')
      then
        return query select null::text, v_answers;
        return;
      end if;
      select w.id, w.project_id, w.form_version_id, w.data into v_item from work_item w where w.id = p_work_item_id;
      select * into v_me from app.acting_project_member(p_work_item_id);
      -- What may be written, by key and type: the Action Form's fields, and those of
      -- the Form Sections the acting Member may change now (none unless they may save).
      select coalesce(jsonb_object_agg(f ->> 'key', f ->> 'type'), '{}') into v_action_form_types
      from jsonb_array_elements(coalesce(v_transition.action_form -> 'sections', '[]')) s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      where f ->> 'type' <> 'calculated';
      select coalesce(jsonb_object_agg(f ->> 'key', f ->> 'type'), '{}') into v_form_types
      from form_version v
      cross join lateral jsonb_array_elements(v.schema -> 'sections') s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      where v.id = v_item.form_version_id
        and f ->> 'type' not in ('calculated', 'trade', 'location', 'scopes')
        and (s ->> 'key') in (select app.editable_section_keys(p_work_item_id));
      -- The Form as the actor reads it, for a copy: only its own fields are read.
      v_reads := app.work_item_answers(p_work_item_id);

      for v_action in select a.value from jsonb_array_elements(v_transition.actions) a loop
        continue when v_action ->> 'type' = 'offer_assign_to';
        if v_action ->> 'type' = 'set_field' then
          v_to := v_action ->> 'field';
          v_type := coalesce(v_action_form_types ->> v_to, v_form_types ->> v_to);
          if jsonb_typeof(v_action -> 'value') = 'object' then
            v_value := case when v_action -> 'value' = '{"now": true}' then app.moment_answer(v_type, p_at) end;
          elsif v_type <> 'member' then
            v_value := v_action -> 'value';
          else
            v_value := null;
          end if;
          if v_type is null or v_value is null then
            return query select 'action_not_allowed'::text, null::jsonb;
            return;
          end if;
        elsif v_action ->> 'type' = 'copy_field' then
          v_from := v_action ->> 'from';
          v_to := v_action ->> 'to';
          if v_action_form_types ? v_from then
            -- An internal move's Action Form answers stay inside its Participant (V5).
            if not v_action_form_types ? v_to and v_transition.kind in ('send', 'return') then
              return query select 'action_not_allowed'::text, null::jsonb;
              return;
            end if;
            v_value := v_answers -> v_from;
          elsif v_form_types ? v_from then
            v_value := case when v_changes ? v_from then v_changes -> v_from else v_reads -> v_from end;
          else
            return query select 'action_not_allowed'::text, null::jsonb;
            return;
          end if;
          if not (v_action_form_types ? v_to or v_form_types ? v_to) then
            return query select 'action_not_allowed'::text, null::jsonb;
            return;
          end if;
          v_value := coalesce(v_value, 'null');
        else
          return query select 'action_not_allowed'::text, null::jsonb;
          return;
        end if;
        if v_action_form_types ? v_to then
          v_answers := case when v_value = 'null' then v_answers - v_to else v_answers || jsonb_build_object(v_to, v_value) end;
        else
          v_changes := v_changes || jsonb_build_object(v_to, v_value);
        end if;
      end loop;

      if v_changes = '{}' then
        return query select null::text, v_answers;
        return;
      end if;
      -- Saved as Save draft saves: the answers as they arrived kept for everyone else
      -- (V19), field times, and the change on the record once it has left Draft.
      v_before := app.work_item_full_answers(p_work_item_id);
      v_data := (v_item.data - array(select k from jsonb_each(v_changes) c (k, v) where v = 'null'))
        || coalesce((select jsonb_object_agg(k, v) from jsonb_each(v_changes) c (k, v) where v <> 'null'), '{}');
      update work_item set
        data = v_data,
        data_as_arrived = coalesce(data_as_arrived, v_before),
        updated_at = p_at
      where id = p_work_item_id;
      perform app.sync_link_answers(p_work_item_id, v_item.project_id, v_item.form_version_id, v_data, p_at);
      perform app.record_field_times(p_work_item_id, p_at);
      if exists (
        select 1 from work_item_event e
        where e.work_item_id = p_work_item_id and e.type = 'transition' and app.is_draft_step(e.from_step_id)
      ) then
        v_after := app.work_item_full_answers(p_work_item_id);
        v_recorded_before := app.link_answers_recorded(v_item.form_version_id, v_before);
        v_recorded_after := app.link_answers_recorded(v_item.form_version_id, v_after);
        select jsonb_agg(jsonb_build_object('field', k, 'old', v_recorded_before -> k, 'new', v_recorded_after -> k) order by k)
        into v_changed
        from (select jsonb_object_keys(v_before) union select jsonb_object_keys(v_after)) as keys (k)
        where (v_recorded_before -> k) is distinct from (v_recorded_after -> k);
        if v_changed is not null then
          insert into work_item_event (
            project_id, work_item_id, type, actor_member_id, actor_participant_id, payload,
            audience, audience_participant_id, content_sha256, created_at
          ) values (
            v_item.project_id, p_work_item_id, 'answers_changed', app.current_member_id(), v_me.participant_id,
            jsonb_build_object('changes', v_changed), 'internal', v_me.participant_id,
            sha256(convert_to(v_after::text, 'UTF8')), p_at
          );
        end if;
      end if;
      return query select null::text, v_answers;
    end
  $$;

-- Taking a Transition -----------------------------------------------------------------

drop function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz);

-- As in the transition_rules migration, with "Assign to" (`p_assign_to`, a Member
-- the Transition offers) and the actions step (app.transition_actions) once every
-- check has passed, before any effect: what it writes is in the Transition's event.
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
        jsonb_strip_nulls(v_actions.answers ||jsonb_build_object('document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then v_me.participant_id end,
        sha256(convert_to(jsonb_build_object('title', v_item.title, 'data', v_data)::text, 'UTF8')),
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

revoke all on function app.assignees_offered(uuid, uuid, uuid) from public;
revoke all on function app.transition_assignees(uuid, text) from public;
revoke all on function app.moment_answer(text, timestamptz) from public;
revoke all on function app.transition_actions(uuid, uuid, jsonb, timestamptz) from public;
revoke all on function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz, uuid) from public;
grant execute on function app.transition_assignees(uuid, text) to rabaed_app;
grant execute on function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz, uuid) to rabaed_app;
