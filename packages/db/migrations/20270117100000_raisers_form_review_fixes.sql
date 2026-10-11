-- Review fixes for spec RP-525 (RP-514, RP-515, RP-516): a Screen's internal answers
-- never reach a follow-up item or a shared field, nobody saves the raiser's Form after
-- the first Submit but back after a Send Back, every Submit checks the Form, answer times
-- for the raiser's whole Participant, and the copied blocks of the spec made helpers
-- (ADR 0019, ADR 0020; workflow-engine.md §3.3, §5.1, §5.7; form-engine.md §4;
-- visibility.md V5, "Creation Date", scenario RP-525-1).
--
-- * app.take_transition: a Code's follow-up items read the shared answers only, never
--   its Screen's internal ones (V5); a copy of an internal answer into a shared field or
--   the Form is refused (`action_not_allowed`), as the publish checks refuse it
--   (copy_internal_answer). Every Submit, whoever takes it, moves only with the answers
--   the api found complete (`form_not_checked`), the PM's included: app.answers_sha256
--   gives the holder of the raiser's Step the hash even when they may not save.
-- * app.can_save_answers: the raiser's Form after the first Submit only while a Send
--   Back has the item back (the last Transition another Participant took is a
--   `send_back`), at run time too: Workflow Versions published before RP-514 never had
--   the publish check (form_edited_after_submit).
-- * app.work_item_field_times: every Member of the raiser's Participant reads the answer
--   times (not only the one who may save); another Company's Member saving its own Form
--   Section reads its own Company's only, as before; nobody else any.
-- * app.screen_draft_read: a Screen's draft for its authors, without the lock
--   app.screen_draft takes for a publish (a read takes none).
-- * app.step_edits_form: plpgsql, so its plans are kept for the session (RP-310); a sql
--   function reading a table is never inlined anyway.
-- * Helpers for the blocks spec RP-525 copied twice (CODING_STANDARDS, Database):
--   app.workflow_version_step_rows, app.workflow_version_transition_rows (a Version's
--   rows), app.workflow_rows_fit (a draft's rows checked), app.insert_workflow_rows (a
--   draft's rows stored); app.workflow_version_rows and app.store_workflow_draft call them.
-- * app.transition_next_holder: the holder a Return or a Send Back goes back to, in one query.
--
-- Rebuilt from their latest bodies: app.take_transition, app.workflow_version_rows,
-- app.store_workflow_draft, app.screen_draft (20270116000000_screens.sql);
-- app.can_save_answers, app.step_edits_form (20270114000000_holder_edits_form.sql);
-- app.transition_next_holder (20270115000000_return_in_internal_review.sql);
-- app.work_item_field_times (20261218000000_answer_times_floor.sql); app.answers_sha256
-- (20261103000000_answer_permission_speed.sql).

-- Whether the raiser's Form is edited at a Step -------------------------------------------

-- As in the holder_edits_form migration, in plpgsql (@rabaed/domain's stepEditsForm says
-- the same; both are tested against step-edits-form-cases.json).
create or replace function app.step_edits_form(p_step_id uuid) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select coalesce(s.edits_form, exists (
          select 1 from workflow_step d
          where d.workflow_version_id = s.workflow_version_id and app.is_draft_step(d.id)
            and d.actor_rule ->> 'base_role' = s.actor_rule ->> 'base_role'
            and d.actor_rule ->> 'permission' = s.actor_rule ->> 'permission'
        ))
        from workflow_step s
        where s.id = p_step_id
      );
    end
  $$;

-- Who may save -------------------------------------------------------------------------

-- As in the holder_edits_form migration, and once Submitted, the raiser's Form only while
-- a Send Back has it back: the last Transition another Participant took is a Send Back.
create or replace function app.can_save_answers(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return false;
      end if;
      select w.id, w.project_id, w.raised_by_participant_id, w.current_step_id, w.form_version_id,
        w.submitted_at, a.participant_id as holder_participant_id, a.status as holder_status,
        a.assignee_member_id as holder_member_id
      into v_item
      from work_item w
      join project pr on pr.id = w.project_id and pr.status = 'active'
      left join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
      where w.id = p_work_item_id and w.closed_at is null;
      if v_item.id is null then
        return false;
      end if;
      -- The raiser's Form: its Member holding the Step (never pooled), where the Workflow
      -- lets the Form be edited, before the first Submit or while a Send Back has it back.
      if v_item.holder_participant_id = v_item.raised_by_participant_id then
        return v_item.holder_status = 'picked_up' and v_item.holder_member_id = app.current_member_id()
          and app.step_edits_form(v_item.current_step_id)
          and (v_item.submitted_at is null or (
            select tr.kind from work_item_event e
            join workflow_transition tr on tr.id = e.transition_id
            where e.work_item_id = v_item.id and e.type = 'transition'
              and e.actor_participant_id <> v_item.raised_by_participant_id
            order by e.seq desc limit 1) = 'send_back')
          and exists (
            select 1 from project_member pm
            join participant p on p.id = pm.participant_id
            where pm.project_id = v_item.project_id and pm.member_id = app.current_member_id()
              and pm.status = 'active' and p.status = 'active' and p.company_id = app.current_company_id()
              and pm.participant_id = v_item.raised_by_participant_id
          );
      end if;
      -- Another Participant holding a Step a Form Section names (app.answers_held; ADR 0013,
      -- to retire with ADR 0019).
      return exists (
        select 1 from project_member pm
        join participant p on p.id = pm.participant_id
        where pm.project_id = v_item.project_id and pm.member_id = app.current_member_id()
          and pm.status = 'active' and p.status = 'active' and p.company_id = app.current_company_id()
          and pm.participant_id = v_item.holder_participant_id
          and pm.participant_id <> v_item.raised_by_participant_id
      ) and exists (
        select 1 from form_version v
        join workflow_step cur on cur.id = v_item.current_step_id
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        where v.id = v_item.form_version_id and (s -> 'editable_at') ? cur.key
      );
    end
  $$;

-- Answer times: the raiser's Participant -------------------------------------------------

-- As in the answer_times_floor migration, read by every Member of the raiser's
-- Participant, or by a Member who may save now (another Company's, its own Form
-- Section: its own Company's times only, as the join keeps).
create or replace function app.work_item_field_times(p_work_item_id uuid, p_lock boolean default false) returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_times jsonb;
      v_numbered_at timestamptz;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      if not exists (
          select 1 from work_item w
          join project_member pm on pm.project_id = w.project_id and pm.participant_id = w.raised_by_participant_id
          join participant p on p.id = pm.participant_id
          where w.id = p_work_item_id and pm.member_id = app.current_member_id() and pm.status = 'active'
            and p.status = 'active' and p.company_id = app.current_company_id())
        and not app.can_save_answers(p_work_item_id)
      then
        return null;
      end if;
      if p_lock then
        select w.field_times, w.numbered_at into v_times, v_numbered_at from work_item w where w.id = p_work_item_id for update;
      else
        select w.field_times, w.numbered_at into v_times, v_numbered_at from work_item w where w.id = p_work_item_id;
      end if;
      return coalesce((
        select jsonb_object_agg(t.key, jsonb_build_object(
          'at', to_char((greatest((t.value ->> 'at')::timestamptz, v_numbered_at)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'by', t.value ->> 'by',
          'name', m.full_name))
        from jsonb_each(v_times) t
        join member m on m.id = app.uuid_or_null(t.value -> 'by') and m.company_id = app.current_company_id()
      ), '{}'::jsonb);
    end
  $$;

-- Every Submit checks the Form ------------------------------------------------------------

-- As in the answer_permission_speed migration, the hash app.take_transition compares, also
-- for the Member holding the item's current Step of the raiser's Participant when they may
-- not save (the PM): their Submit moves only with answers the api checked. Null for anyone
-- else, so it no longer says whether the caller may save (app.can_save_answers does).
create or replace function app.answers_sha256(p_work_item_id uuid) returns bytea
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      if not exists (
          select 1 from work_item w
          join step_assignment a on a.work_item_id = w.id and a.status = 'picked_up'
          where w.id = p_work_item_id and w.closed_at is null
            and a.assignee_member_id = app.current_member_id() and a.participant_id = w.raised_by_participant_id)
        and not app.can_save_answers(p_work_item_id)
      then
        return null;
      end if;
      return app.answers_sha256_of(p_work_item_id, (
        select app.is_draft_step(w.participant_entered_step_id) from work_item w where w.id = p_work_item_id));
    end
  $$;

-- Taking a Transition ------------------------------------------------------------------------

-- As in the screens migration, and: a copy of the Screen's internal answer into a shared
-- field or the Form is refused; its follow-up items read the shared answers only; every
-- Submit needs the answers the api checked.
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

      perform app.transition_effects(
        p_work_item_id, v_transition.id, v_me.participant_id, v_assignment.id,
        v_next.outcome, v_next.participant_id, v_next.holder_member_id,
        coalesce(v_actions.answers, '{}') - v_internal, nullif(btrim(p_internal_note), ''), p_recommended_code, v_at);
      -- Its outcome's follow-up items (WF-11: Code B's Comments), once it is closed: from
      -- the shared answers only, since the items are shared with the raiser (V5).
      if v_next.outcome = 'terminal' then
        perform app.transition_follow_up_items(
          p_work_item_id, v_transition.id, v_me.participant_id, coalesce(v_actions.answers, '{}') - v_internal, v_at);
      end if;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;

-- The holder a Return or a Send Back goes back to -------------------------------------------

-- As in the return_in_internal_review migration, with the person who held the Step before,
-- else (a Return into a Step nobody has held yet) the item's author, in one query.
create or replace function app.transition_next_holder(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_assign_to uuid)
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

-- A Screen's draft, read without a lock ------------------------------------------------------

-- The draft of Screen p_screen_id, for its authors only; nothing when it has none, or for
-- anyone else. A read (the Screen's page) takes no lock.
create function app.screen_draft_read(p_screen_id uuid)
  returns table (screen_version_id uuid, version_no integer, schema jsonb, internal_fields text[])
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.can_author_screen(p_screen_id) then
        return;
      end if;
      return query
        select v.id, v.version_no, v.schema, v.internal_fields from screen_version v
        where v.screen_id = p_screen_id and v.status = 'draft';
    end
  $$;

-- As in the screens migration, reading through app.screen_draft_read once the Screen is
-- locked: a publish's checks and the publish see the draft no save changes in between.
create or replace function app.screen_draft(p_screen_id uuid)
  returns table (screen_version_id uuid, version_no integer, schema jsonb, internal_fields text[])
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.can_author_screen(p_screen_id) then
        return;
      end if;
      perform 1 from screen s where s.id = p_screen_id for update;
      return query select * from app.screen_draft_read(p_screen_id);
    end
  $$;

-- A Version's rows and a draft's, each in one place ------------------------------------------

-- The Steps of Workflow Version p_version_id as @rabaed/domain's rows have them, each
-- optional column only when it is set.
create function app.workflow_version_step_rows(p_version_id uuid) returns jsonb
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', s.key, 'name', s.name, 'stage_key', s.stage_key, 'actor_rule', s.actor_rule,
          'is_signing', s.is_signing, 'outcome_mode', s.outcome_mode)
          || case when s.edits_form is null then '{}'::jsonb else jsonb_build_object('edits_form', s.edits_form) end
          || case when s.drafts_visible_to is null then '{}'::jsonb
            else jsonb_build_object('drafts_visible_to', s.drafts_visible_to) end
          order by s.created_at, s.key)
        from workflow_step s where s.workflow_version_id = p_version_id), '[]'::jsonb);
    end
  $$;

-- Its Transitions, with a Transition's screen_key when it has one; its action_form then
-- reads null (on a published Version it is the pinned copy), so a copy of the Version pins
-- again when it is published.
create function app.workflow_version_transition_rows(p_version_id uuid) returns jsonb
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', t.key, 'from_step_key', f.key, 'to_step_key', s.key, 'label', t.label, 'kind', t.kind,
          'outcome', t.outcome, 'permission', t.permission, 'sort', t.sort,
          'action_form', case when t.screen_key is null then t.action_form end)
          -- Each only when the Transition has it, as @rabaed/domain's rows have them.
          || case when t.screen_key is null then '{}'::jsonb else jsonb_build_object('screen_key', t.screen_key) end
          || case when t.rules is null then '{}'::jsonb else jsonb_build_object('rules', t.rules) end
          || case when t.actions is null then '{}'::jsonb else jsonb_build_object('actions', t.actions) end
          || case when t.notifications is null then '{}'::jsonb else jsonb_build_object('notifications', t.notifications) end
          order by t.sort, t.key)
        from workflow_transition t
        join workflow_step f on f.id = t.from_step_id
        join workflow_step s on s.id = t.to_step_id
        where t.workflow_version_id = p_version_id), '[]'::jsonb);
    end
  $$;

-- As in the screens migration, from the two helpers above.
create or replace function app.workflow_version_rows(p_version_id uuid)
  returns table (layout jsonb, steps jsonb, transitions jsonb)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select v.layout, app.workflow_version_step_rows(v.id), app.workflow_version_transition_rows(v.id)
        from workflow_version v
        where v.id = p_version_id;
    end
  $$;

-- Whether a draft's layout, Steps and Transitions fit what the tables take: unique keys,
-- Transitions between its Steps, and each optional column's type.
create function app.workflow_rows_fit(p_layout jsonb, p_steps jsonb, p_transitions jsonb) returns boolean
  language plpgsql immutable
  set search_path = pg_catalog, public
  as $$
    begin
      return not (
        jsonb_typeof(p_steps) is distinct from 'array' or jsonb_typeof(p_transitions) is distinct from 'array'
        or jsonb_typeof(coalesce(p_layout, '{}')) <> 'object'
        or (select count(distinct s ->> 'key') from jsonb_array_elements(p_steps) s) <> jsonb_array_length(p_steps)
        or (select count(distinct t ->> 'key') from jsonb_array_elements(p_transitions) t) <> jsonb_array_length(p_transitions)
        or exists (
          select 1 from jsonb_array_elements(p_transitions) t
          where not exists (select 1 from jsonb_array_elements(p_steps) s where s ->> 'key' = t ->> 'from_step_key')
             or not exists (select 1 from jsonb_array_elements(p_steps) s where s ->> 'key' = t ->> 'to_step_key'))
        or exists (
          select 1 from jsonb_array_elements(p_steps) s
          where jsonb_typeof(s -> 'edits_form') not in ('boolean', 'null')
             or coalesce(s ->> 'drafts_visible_to', 'company') not in ('company', 'author'))
        or exists (
          select 1 from jsonb_array_elements(p_transitions) t
          where jsonb_typeof(t -> 'screen_key') not in ('string', 'null')
             or (t ->> 'screen_key' is not null and (t ->> 'screen_key' !~ '^[a-z][a-z0-9_]*$' or length(t ->> 'screen_key') > 64))
             or (t ->> 'screen_key' is not null and jsonb_typeof(t -> 'action_form') not in ('null')))
      );
    end
  $$;

-- Stores a draft's Steps and Transitions (app.workflow_rows_fit's) on Workflow Version
-- p_version_id, which has none, at p_at.
create function app.insert_workflow_rows(p_version_id uuid, p_steps jsonb, p_transitions jsonb, p_at timestamptz) returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_count integer;
    begin
      insert into workflow_step (
        workflow_version_id, key, name, stage_key, actor_rule, is_signing, outcome_mode, edits_form, drafts_visible_to, created_at
      )
      select p_version_id, e.s ->> 'key', e.s -> 'name', e.s ->> 'stage_key', coalesce(e.s -> 'actor_rule', '{}'), false,
        e.s ->> 'outcome_mode', (e.s ->> 'edits_form')::boolean, e.s ->> 'drafts_visible_to',
        -- In the order given, which the draft's read keeps.
        p_at + make_interval(secs => e.ord / 1000000.0)
      from jsonb_array_elements(p_steps) with ordinality as e (s, ord);
      insert into workflow_transition (
        workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form,
        screen_key, rules, actions, notifications, created_at
      )
      select p_version_id, e.t ->> 'key', f.id, s.id, e.t -> 'label', e.t ->> 'kind', e.t ->> 'outcome', e.t ->> 'permission',
        coalesce((e.t ->> 'sort')::integer, e.ord::integer), nullif(e.t -> 'action_form', 'null'::jsonb),
        e.t ->> 'screen_key',
        nullif(e.t -> 'rules', 'null'::jsonb), nullif(e.t -> 'actions', 'null'::jsonb), nullif(e.t -> 'notifications', 'null'::jsonb),
        p_at
      from jsonb_array_elements(p_transitions) with ordinality as e (t, ord)
      join workflow_step f on f.workflow_version_id = p_version_id and f.key = e.t ->> 'from_step_key'
      join workflow_step s on s.workflow_version_id = p_version_id and s.key = e.t ->> 'to_step_key';
      get diagnostics v_count = row_count;
      if v_count <> jsonb_array_length(p_transitions) then
        raise exception 'store_workflow_draft: a Transition lost its Steps';
      end if;
    end
  $$;

-- As in the screens migration, checking and storing the rows through the helpers above.
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
      if not app.workflow_rows_fit(p_layout, p_steps, p_transitions) then
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
      perform app.insert_workflow_rows(v_version_id, p_steps, p_transitions, p_at);
      return query select 'saved'::text, v_version_id, (select v.version_no from workflow_version v where v.id = v_version_id);
    end
  $$;

-- Grants ------------------------------------------------------------------------------------

revoke all on function app.screen_draft_read(uuid) from public;
grant execute on function app.screen_draft_read(uuid) to rabaed_app;
-- Security invoker, called by app.workflow_version_rows, which both roles run.
revoke all on function app.workflow_version_step_rows(uuid) from public;
grant execute on function app.workflow_version_step_rows(uuid) to rabaed_app, rabaed_admin;
revoke all on function app.workflow_version_transition_rows(uuid) from public;
grant execute on function app.workflow_version_transition_rows(uuid) to rabaed_app, rabaed_admin;
revoke all on function app.workflow_rows_fit(jsonb, jsonb, jsonb) from public;
revoke all on function app.insert_workflow_rows(uuid, jsonb, jsonb, timestamptz) from public;
