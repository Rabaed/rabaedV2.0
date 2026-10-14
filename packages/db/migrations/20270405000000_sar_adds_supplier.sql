-- RP-594: a Supplier Approval Request closed at Code A or B adds its supplier to the
-- Project's Approved Supplier List (spec RP-598; RP-592's list; workflow-engine.md §6;
-- visibility.md V10).
--
-- * work_item_type.adds_approved_supplier marks the Types whose A / B outcomes do it;
--   the Rabaed Default SAR is the one. Its Form keys supplier_name_en and
--   supplier_name_ar (RP-591) are the supplier's name.
-- * app.sar_adds_supplier is called by app.take_transition once the item is closed, in
--   the same transaction (and after Code B's Comments): one approved_supplier row of
--   source 'submittal', for the item's Trade, and its Scope when it has exactly one.
--   Not added twice: a supplier the Trade already lists as approved is skipped, by
--   app.approved_supplier_listed (RP-592: the English or the Arabic name, case and the
--   spaces around it ignored), under the same Trade lock as a Project Admin's add.
-- * Codes C and D add nothing. A Revision closed later at A or B adds it then.
-- * app.take_transition is rebuilt from RP-593's (20270401000000_owner_review.sql): one
--   added call, nothing else changed.

alter table work_item_type add column adds_approved_supplier boolean not null default false;
update work_item_type set adds_approved_supplier = true where owner_kind = 'rabaed' and code = 'SAR';

create function app.sar_adds_supplier(p_work_item_id uuid, p_at timestamptz)
  returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
      v_trade_id uuid;
      v_scopes uuid[];
      v_en text;
      v_ar text;
    begin
      select w.project_id, w.outcome, w.data into v_item
      from work_item w join work_item_type t on t.id = w.work_item_type_id
      where w.id = p_work_item_id and t.adds_approved_supplier;
      if v_item.project_id is null or v_item.outcome is distinct from 'A' and v_item.outcome is distinct from 'B' then
        return;
      end if;

      -- Its name, English and Arabic (RP-591); one language stands in for the other when only one is given.
      v_en := nullif(btrim(v_item.data ->> 'supplier_name_en'), '');
      v_ar := nullif(btrim(v_item.data ->> 'supplier_name_ar'), '');
      if v_en is null and v_ar is null then
        return;
      end if;

      select v.dimension_value_id into v_trade_id
      from work_item_dimension_value v join visibility_dimension d on d.id = v.dimension_id
      where v.work_item_id = p_work_item_id and d.kind = 'trade'
      limit 1;
      if v_trade_id is null then
        return;
      end if;
      -- Its Scope, when it names exactly one of the Trade's: with several, the whole Trade.
      select coalesce(array_agg(s.id), '{}') into v_scopes
      from work_item_scope ws join scope s on s.id = ws.scope_id
      where ws.work_item_id = p_work_item_id and s.trade_value_id = v_trade_id;

      perform pg_advisory_xact_lock(hashtextextended('approved_supplier/' || v_trade_id::text, 0));
      if app.approved_supplier_listed(v_trade_id, jsonb_build_object('en', coalesce(v_en, v_ar), 'ar', coalesce(v_ar, v_en))) then
        return;
      end if;
      insert into approved_supplier (project_id, name, trade_value_id, scope_id, source, source_work_item_id, added_at)
      values (
        v_item.project_id,
        jsonb_build_object('en', coalesce(v_en, v_ar), 'ar', coalesce(v_ar, v_en)),
        v_trade_id,
        case when cardinality(v_scopes) = 1 then v_scopes[1] end,
        'submittal', p_work_item_id, greatest(p_at, now())
      );
    end
  $$;

-- A helper of app.take_transition, not for the app role.
revoke all on function app.sar_adds_supplier(uuid, timestamptz) from public;

-- take_transition: as RP-593 left it, plus the call above ---------------------------------

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
