-- RP-85 (spec RP-632; ADR 0017, ADR 0023): the Signature. No Signature, no Transition, and every
-- Transition records the Signature in force (workflow-engine.md §5.1 check 6 and effect 2;
-- data-model.md §1 member_signature).
--
-- * member_signature: a Member's Signature images, versioned by when each was in force
--   (`active_from`, `active_to`; at most one active per Member). Profile → Add Signature draws
--   it, types it in a handwriting style or uploads it; each is stored as an image (stored_file)
--   with how it was made (`method`). Replacing it ends the active row and adds a new one, so
--   an event that pointed at the old row keeps it.
-- * Row security: a Member reads only their own rows, and the stored_file rows they point at.
--   Nobody else, not even their Company; the record job reads others' as the owner. Written
--   only by app.set_member_signature.
-- * work_item_event.signature_id: the Signature in force when the Member took the Transition,
--   on the Transition's own event (`transition`, `issue_code`). Not granted to the app role.
-- * app.take_transition: as 20270409000100_sar_adds_supplier.sql left it, plus check 6's
--   Signature: a holder with no active Signature is refused `no_signature`, with nothing
--   written. Rabaed notifies nobody.
-- * app.transition_effects: as 20270409000000_owner_review.sql left it, plus `signature_id`
--   on the Transition's event.

create table member_signature (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references member (id),
  file_id uuid not null unique references stored_file (id),
  method text not null check (method in ('drawn', 'typed', 'uploaded')),
  active_from timestamptz not null,
  active_to timestamptz,
  check (active_to is null or active_to >= active_from)
);
create unique index member_signature_one_active on member_signature (member_id) where active_to is null;
create index member_signature_member on member_signature (member_id, active_from);

alter table member_signature enable row level security;
revoke all on member_signature from rabaed_app;
grant select (id, member_id, file_id, method, active_from, active_to) on member_signature to rabaed_app;
revoke insert, update, delete, truncate on member_signature from rabaed_admin;
create policy member_reads_own_signatures on member_signature for select to rabaed_app
  using (member_id = app.current_member_id());

-- The files of the Member's own Signatures (stored_file adds no policy of its own).
create policy member_reads_own_signature_files on stored_file for select to rabaed_app
  using (exists (
    select 1 from member_signature s where s.file_id = stored_file.id and s.member_id = app.current_member_id()));

-- A Signature row changes once, when it is replaced: its `active_to` is set. Never removed.
create function app.refuse_member_signature_change() returns trigger
  language plpgsql
  as $$
    begin
      if tg_op = 'UPDATE' and old.active_to is null and new.active_to is not null
        and (new.id, new.member_id, new.file_id, new.method, new.active_from)
          = (old.id, old.member_id, old.file_id, old.method, old.active_from)
      then
        return new;
      end if;
      raise exception 'member_signature changes only when replaced' using errcode = '42501';
    end
  $$;
revoke all on function app.refuse_member_signature_change() from public;
create trigger member_signature_versioned before update or delete on member_signature
  for each row execute function app.refuse_member_signature_change();

-- The Member's Signature in force now: its row's id, or null when they have none.
create function app.active_signature_id(p_member_id uuid) returns uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (select s.id from member_signature s where s.member_id = p_member_id and s.active_to is null);
    end
  $$;
revoke all on function app.active_signature_id(uuid) from public;

-- Saves the acting Member's new Signature, the image the api stored under `p_storage_key`:
-- ends the one in force and makes this one active from now. Returns the new row's id, or null
-- with no acting Member. The api checks the image (type, size) before storing it.
create function app.set_member_signature(
  p_storage_key text, p_sha256 bytea, p_size bigint, p_mime text, p_method text, p_now timestamptz
) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member_id uuid := app.current_member_id();
      v_at timestamptz := greatest(p_now, now());
      v_file_id uuid;
      v_signature_id uuid;
    begin
      if v_member_id is null then
        return null;
      end if;
      if p_mime not in ('image/png', 'image/jpeg') then
        raise exception 'A Signature is a PNG or JPEG image' using errcode = '22023';
      end if;
      -- One save at a time per Member, so one row stays active.
      perform 1 from member where id = v_member_id for update;
      update member_signature set active_to = v_at where member_id = v_member_id and active_to is null;
      insert into stored_file (storage_key, sha256, size, mime, uploaded_by_member_id, created_at)
      values (p_storage_key, p_sha256, p_size, p_mime, v_member_id, v_at)
      returning id into v_file_id;
      insert into member_signature (member_id, file_id, method, active_from)
      values (v_member_id, v_file_id, p_method, v_at)
      returning id into v_signature_id;
      return v_signature_id;
    end
  $$;
revoke all on function app.set_member_signature(text, bytea, bigint, text, text, timestamptz) from public;
grant execute on function app.set_member_signature(text, bytea, bigint, text, text, timestamptz) to rabaed_app;

-- The Signature a Transition was taken with. Null on every other event, and on events written
-- before RP-85. Not granted to the app role (work_item_event's reads are column grants).
alter table work_item_event add column signature_id uuid references member_signature (id);

-- transition_effects --------------------------------------------------------------------------------

create or replace function app.transition_effects(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_assignment_id uuid, p_next_outcome text, p_next_participant_id uuid, p_holder uuid, p_answers jsonb, p_note text, p_recommended_code text, p_at timestamp with time zone)
 returns void
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
    declare
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_transition record;
      v_number text;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
      v_new_assignment_id uuid;
      v_review boolean;
      v_audiences uuid[];
      v_to uuid;
    begin
      select w.* into v_item from work_item w where w.id = p_work_item_id;
      select tr.*, target.stage_key as to_stage_key, target.outcome_mode as to_outcome_mode,
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

      -- The Owner's review (ADR 0022): the Recommendation to it and its Send Back are read by
      -- the two Participants of the exchange only, each event written once internal to each.
      v_review := p_next_participant_id is not null and p_next_participant_id <> p_participant_id and (
        (v_transition.to_outcome_mode = 'confirm_code' and v_transition.outcome is not null)
        or (v_transition.from_outcome_mode = 'confirm_code' and v_transition.kind = 'send_back'
          and v_transition.to_outcome_mode = 'recommend_code'));
      v_audiences := case when v_review then array[p_participant_id, p_next_participant_id] else array[p_participant_id] end;

      -- The Recommended Code is Internal Communication (V5): its own event, internal to
      -- the recommender's Participant (and to the Owner's review it goes to), just before the
      -- Internal Note written with it and the Transition. Never on the item, so no other read
      -- can reach it.
      if p_recommended_code is not null or (v_review and v_transition.to_outcome_mode = 'confirm_code') then
        foreach v_to in array v_audiences loop
          insert into work_item_event (
            project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
            from_step_id, payload, audience, audience_participant_id, created_at
          ) values (
            v_item.project_id, p_work_item_id, 'recommend_code', v_member_id, p_participant_id, p_transition_id,
            v_item.current_step_id,
            jsonb_build_object('recommended_code', coalesce(p_recommended_code, v_transition.outcome)), 'internal', v_to, p_at
          );
        end loop;
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
      -- Only what crosses is shared (a Send Back always does): a move inside one
      -- Participant stays its own, even from a Step that could issue a Code (V5, V14).
      v_audience := case
        when v_crosses or v_transition.kind in ('submit', 'send_back', 'close') then 'shared'
        else 'internal' end;
      foreach v_to in array (case when v_review then v_audiences else array[null::uuid] end) loop
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, signature_id, created_at
        ) values (
          v_item.project_id, p_work_item_id,
          -- A Code is issued only where one is set; any other move from that Step is a plain Transition.
          case when v_transition.from_outcome_mode in ('issue_code', 'confirm_code') and v_outcome is not null then 'issue_code'
            else 'transition' end,
          v_member_id, p_participant_id, p_transition_id,
          v_item.current_step_id, v_transition.to_step_id,
          -- The Action Form answers (with what its actions set), then what the engine
          -- writes (no Action Form field takes those keys).
          jsonb_strip_nulls(p_answers || jsonb_build_object('document_number', v_number, 'outcome', v_outcome)),
          case when v_review then 'internal' else v_audience end,
          case when v_review then v_to when v_audience = 'internal' then p_participant_id end,
          -- The item's exact content as this Transition leaves it (ADR 0017).
          app.work_item_content_sha256(p_work_item_id, v_item.title, v_item.data, v_outcome),
          -- The Signature in force as the Member takes it (RP-85): a later one never changes it.
          app.active_signature_id(v_member_id),
          p_at
        );
      end loop;

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
        updated_at = p_at
      where id = p_work_item_id;

      -- RP-316: the item a Revision revises links to it from its first Submit, never
      -- while it is the raiser's own (V1).
      if v_transition.kind = 'submit' and v_item.revision_of_id is not null then
        insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
        values (v_item.project_id, v_item.revision_of_id, p_work_item_id, 'related', v_member_id, p_at)
        on conflict on constraint work_item_link_once do nothing;
      end if;

      if p_next_outcome = 'ok' then
        insert into step_assignment (
          project_id, work_item_id, step_id, participant_id, assignee_member_id, status, picked_up_at, created_at, updated_at
        ) values (
          v_item.project_id, p_work_item_id, v_transition.to_step_id, p_next_participant_id, p_holder,
          case when p_holder is null then 'pooled' else 'picked_up' end,
          case when p_holder is null then null else p_at end, p_at, p_at
        ) returning id into v_new_assignment_id;
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (p_work_item_id, v_item.project_id, p_next_participant_id, p_at, 'handling')
        on conflict do nothing;
        -- Rule 4 (§3.3): a pool of one holds it at once, judged now, on arrival.
        perform app.hold_pool_of_one(v_new_assignment_id);
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
  $function$;

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
