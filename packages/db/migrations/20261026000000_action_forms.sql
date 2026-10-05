-- Action Forms built from Form schemas (RP-300, spec RP-299; form-engine.md §4
-- "Settled 2026-10-05 (part 3)"; workflow-engine.md §1 check 7, §5.1; visibility.md V5).
--
-- * workflow_transition.action_form: the Transition's Action Form, a Form schema
--   ({sections: [...]}) the API validates and renders with the Form engine; null
--   for none. The Internal Note is not one of its fields: it stays a fixed
--   element under every Action Form, and its own internal event (V5). The
--   publish checks (workflow-engine.md check 7, action-form.ts) can't run in SQL;
--   action-forms.test.ts runs them on every published Workflow Version.
-- * MAR Workflow Version 1's Transitions get schemas equal to today's fixed
--   fields: the Return a required `reason` textarea (at most 2000 characters, as
--   the request field took), the others none. Published Versions never change;
--   this one is changed in place ONLY because dev has no real data yet, and
--   nothing behaves differently. From now on a change is a new Workflow Version.
-- * app.take_transition takes the Action Form answers (p_answers jsonb) in place
--   of p_reason, and stores them in the Transition event's payload, beside the
--   engine's document_number and outcome, as reason was. The fixed reason check
--   ('reason_required') goes: app.action_form_fits refuses, as
--   'invalid_action_form', answers to keys the schema doesn't have or missing an
--   answer a field always requires (the API checks the rest with the validator).
-- * app.work_item_history still reads `reason` from the payload, where the
--   Return's answer is.

alter table workflow_transition add column action_form jsonb
  check (action_form is null or (jsonb_typeof(action_form) = 'object' and jsonb_typeof(action_form -> 'sections') = 'array'));

update workflow_transition tr set action_form = $schema$
  {
    "sections": [
      {
        "key": "return",
        "title": { "en": "Return", "ar": "إعادة" },
        "fields": [
          { "key": "reason", "type": "textarea", "required": true, "maxLength": 2000,
            "label": { "en": "Reason", "ar": "السبب" },
            "help": { "en": "Only your Company sees this.", "ar": "لا يراه إلا شركتك." } }
        ]
      }
    ]
  }
$schema$::jsonb
from workflow_version v
join workflow_definition d on d.id = v.workflow_definition_id
join work_item_type t on t.workflow_definition_id = d.id and t.owner_kind = 'rabaed' and t.code = 'MAR'
where tr.workflow_version_id = v.id and v.version_no = 1 and tr.key = 'return';

-- Whether Action Form answers fit the Transition's schema as far as the database
-- checks them: an object, each key one of the schema's fields, and each field the
-- schema always requires (not behind a `visible_if`) answered. No schema: no answers.
create function app.action_form_fits(p_schema jsonb, p_answers jsonb) returns boolean
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    with fields as (
      select s, f from jsonb_array_elements(coalesce(p_schema -> 'sections', '[]')) s
      cross join lateral jsonb_array_elements(s -> 'fields') f
    )
    select coalesce(jsonb_typeof(p_answers) = 'object', false)
      and not exists (
        select 1 from jsonb_object_keys(case when jsonb_typeof(p_answers) = 'object' then p_answers else '{}' end) k
        where not exists (select 1 from fields where f ->> 'key' = k))
      and not exists (
        select 1 from fields
        where f -> 'required' = 'true' and s -> 'visible_if' is null and f -> 'visible_if' is null
          and (p_answers -> (f ->> 'key') is null
            or p_answers -> (f ->> 'key') in ('null', '[]', '{}')
            or (jsonb_typeof(p_answers -> (f ->> 'key')) = 'string' and btrim(p_answers ->> (f ->> 'key')) = '')))
  $$;

-- Taking a Transition ----------------------------------------------------------------

drop function app.take_transition(uuid, text, text, text, bytea, uuid, timestamptz);

-- As in the answers_history migration, with the Action Form answers in place of the reason.
create function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_answers jsonb, p_internal_note text, p_checked_data_sha256 bytea,
  p_idempotency_key uuid, p_now timestamptz
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
      v_note text := nullif(btrim(p_internal_note), '');
      v_holder uuid;
      v_number text;
      v_prefix text;
      v_seq integer;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
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
      -- The Action Form answers, which the API checked against the Transition's
      -- schema: here only that each is one of its fields and each field it always
      -- requires is answered, so the app role can't write others (a Return without its reason).
      if not app.action_form_fits(v_transition.action_form, p_answers) then
        return 'invalid_action_form';
      end if;
      -- Moving on while the answers are open to the raiser (Draft and its internal
      -- Steps, so a Submit too): only with the answers the API found complete (the
      -- row is locked). A cancel or a Return needs no complete Form.
      if app.is_draft_step(v_item.participant_entered_step_id) and v_transition.kind not in ('cancel', 'return')
        and p_checked_data_sha256 is distinct from app.answers_sha256(p_work_item_id)
      then
        return 'form_not_checked';
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
      -- Only what crosses is shared: a move inside one Participant stays its own,
      -- even from a Step that could issue a Code (V5, V14).
      v_audience := case
        when v_crosses or v_transition.kind in ('submit', 'close') then 'shared'
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
        -- The Action Form answers, then what the engine writes (no Action Form field takes those keys).
        jsonb_strip_nulls(p_answers || jsonb_build_object('document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then v_me.participant_id end,
        sha256(convert_to(jsonb_build_object('title', v_item.title, 'data', v_item.data)::text, 'UTF8')),
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

revoke all on function
  app.action_form_fits(jsonb, jsonb),
  app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz)
  from public;
grant execute on function app.take_transition(uuid, text, jsonb, text, bytea, uuid, timestamptz) to rabaed_app;
