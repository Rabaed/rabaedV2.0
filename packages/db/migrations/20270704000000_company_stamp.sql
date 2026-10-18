-- RP-617 (spec RP-632; ADR 0023): the Company's logo and Stamp. No Stamp, no Transition
-- (workflow-engine.md §5.1 check 6; data-model.md §1 company, §6 stored_file).
--
-- * company.logo_file_id, company.stamp_file_id → stored_file: the logo and Stamp in force.
--   Both nullable; the logo is optional (a record prints the Company's name without one), but
--   while the Stamp is null none of the Company's Members can take a Transition. A new upload
--   is a new stored_file row, so a record that kept the old one keeps it. Read like the rest of
--   the row: by the Company's own Members only (member_reads_own_company).
-- * stored_file: the Company's Members read the rows of its logo and Stamp in force; nobody
--   else. The record job reads every acting Company's as the owner.
-- * app.set_company_image: the Company's Authorized Person saves its logo or Stamp, the image the
--   api stored under the key; `set`, `forbidden` for another Member of the Company, `not_found`
--   for anyone else (another Company's Member, or no acting Member), with nothing written.
-- * app.take_transition: as 20270615000000_member_signature.sql left it, plus check 6's Stamp:
--   a holder whose Company has no Stamp is refused `no_stamp`, right after `no_signature`,
--   with nothing written. Rabaed notifies nobody.

alter table company
  add column logo_file_id uuid references stored_file (id),
  add column stamp_file_id uuid references stored_file (id);

-- The files of the Member's own Company's logo and Stamp in force (stored_file adds no policy of its own).
create policy member_reads_own_company_files on stored_file for select to rabaed_app
  using (exists (
    select 1 from company c
    where c.id = app.current_company_id() and stored_file.id in (c.logo_file_id, c.stamp_file_id)));

-- Whether the Member's Company has a Stamp in force (null Member: false).
create function app.member_company_has_stamp(p_member_id uuid) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return exists (
        select 1 from member m join company c on c.id = m.company_id
        where m.id = p_member_id and c.stamp_file_id is not null);
    end
  $$;
revoke all on function app.member_company_has_stamp(uuid) from public;

-- Saves the Company's new logo or Stamp (`p_kind`), the image the api stored under
-- `p_storage_key`, in force from now. Only the Company's Authorized Person. The api checks the
-- image (type, size) before storing it.
create function app.set_company_image(
  p_company_id uuid, p_kind text, p_storage_key text, p_sha256 bytea, p_size bigint, p_mime text, p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member_id uuid := app.current_member_id();
      v_at timestamptz := greatest(p_now, now());
      v_company record;
      v_file_id uuid;
    begin
      if p_kind not in ('logo', 'stamp') then
        raise exception 'A Company image is its logo or its Stamp' using errcode = '22023';
      end if;
      if p_mime not in ('image/png', 'image/jpeg') then
        raise exception 'A logo or Stamp is a PNG or JPEG image' using errcode = '22023';
      end if;
      -- Another Company's, or nobody's: the same answer as a Company that doesn't exist.
      if v_member_id is null or p_company_id is distinct from app.current_company_id() then
        return 'not_found';
      end if;
      -- One save at a time per Company.
      select c.id, c.authorized_person_id into v_company from company c where c.id = p_company_id for update;
      if v_company.authorized_person_id is distinct from v_member_id then
        return 'forbidden';
      end if;
      insert into stored_file (storage_key, sha256, size, mime, uploaded_by_member_id, created_at)
      values (p_storage_key, p_sha256, p_size, p_mime, v_member_id, v_at)
      returning id into v_file_id;
      update company set
        logo_file_id = case when p_kind = 'logo' then v_file_id else logo_file_id end,
        stamp_file_id = case when p_kind = 'stamp' then v_file_id else stamp_file_id end,
        updated_at = v_at
      where id = p_company_id;
      return 'set';
    end
  $$;
revoke all on function app.set_company_image(uuid, text, text, bytea, bigint, text, timestamptz) from public;
grant execute on function app.set_company_image(uuid, text, text, bytea, bigint, text, timestamptz) to rabaed_app;

-- take_transition -----------------------------------------------------------------------------------

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
