-- RP-580: after a Send Back, the Step it leads to decides what the raiser may change (ADR 0021;
-- workflow-engine.md §1; form-engine.md §4; visibility.md V19, scenario RP-580-1).
--
-- * workflow_step.after_send_back: on a raiser's Step a `send_back` leads to, `comment` (the
--   raiser only replies with a comment and Submits again) or `edit_form` (its Form, Documents,
--   checklist, Links, Trade, Location and Scopes reopen until the next Submit). Null on every
--   Version published before this (they are frozen, RP-424) and on any other Step: read as
--   `edit_form`, today's behaviour. Every Version saved from now on says it where a Send Back
--   leads (@rabaed/domain's withAfterSendBackDefault: `comment` when left out), and publishing
--   refuses `edit_form` on a Step no Send Back leads to (edit_form_not_after_send_back).
-- * app.after_send_back_now: while a Send Back has the item back at its raiser, the setting of
--   the Step that Send Back led to, which holds until the next Submit wherever the raiser moves
--   the item inside its Participant; null otherwise. Internal, no grant: callers check who asks.
-- * app.can_save_answers: after a Send Back, the raiser's holder saves only where
--   app.after_send_back_now says `edit_form`. app.can_change_draft_documents (and so
--   app.can_change_documents), app.can_change_links, the checklist's answers and photos, and
--   Trade, Location and Scopes (saved with the answers) all follow it. Before the first Submit
--   nothing changes; the Transition comment and Internal Notes don't depend on it.
-- * app.sent_back_for_comment: for the item page, whether the viewer's Participant is the
--   raiser and the item is back at it after a Send Back to comment on, so the page says why
--   its Form is read-only. Nobody else learns it.
-- * app.workflow_version_step_rows, app.workflow_rows_fit and app.insert_workflow_rows carry
--   the column, only when set, so authoring, the CLI and a copy keep it.
--
-- Rebuilt from their latest bodies: app.can_save_answers
-- (20270119100000_can_save_answers_after_main.sql), app.workflow_version_step_rows,
-- app.workflow_rows_fit and app.insert_workflow_rows (20270117100000_raisers_form_review_fixes.sql).

alter table workflow_step
  add column after_send_back text check (after_send_back in ('comment', 'edit_form'));

-- What the raiser may change after a Send Back ----------------------------------------------

-- While a Send Back has the item back at its raiser (it was Submitted, its current holder is the
-- raiser's Participant, and the last Transition another Participant took was a `send_back`):
-- the "After a Send Back" of the Step that Send Back led to, `edit_form` when it is null.
-- Null when the item is not back at its raiser after a Send Back.
create function app.after_send_back_now(p_work_item_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
      v_last record;
    begin
      select w.id, w.raised_by_participant_id, w.submitted_at, a.participant_id as holder_participant_id
      into v_item
      from work_item w
      left join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
      where w.id = p_work_item_id and w.closed_at is null;
      if v_item.id is null or v_item.submitted_at is null
        or v_item.holder_participant_id is distinct from v_item.raised_by_participant_id then
        return null;
      end if;
      select tr.kind, s.after_send_back into v_last
      from work_item_event e
      join workflow_transition tr on tr.id = e.transition_id
      join workflow_step s on s.id = tr.to_step_id
      where e.work_item_id = v_item.id and e.type = 'transition'
        and e.actor_participant_id <> v_item.raised_by_participant_id
      order by e.seq desc limit 1;
      if v_last.kind is distinct from 'send_back' then
        return null;
      end if;
      return coalesce(v_last.after_send_back, 'edit_form');
    end
  $$;

-- As in 20270119100000_can_save_answers_after_main.sql, but after a Send Back only where the
-- Step it led to says "Edit the Form" (ADR 0021).
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
      -- lets the Form be edited, before the first Submit or while a Send Back to a Step that
      -- says "Edit the Form" has it back (ADR 0021).
      if v_item.holder_participant_id = v_item.raised_by_participant_id then
        return v_item.holder_status = 'picked_up' and v_item.holder_member_id = app.current_member_id()
          and app.step_edits_form(v_item.current_step_id)
          and (v_item.submitted_at is null or app.after_send_back_now(v_item.id) is not distinct from 'edit_form')
          and exists (
            select 1 from project_member pm
            join participant p on p.id = pm.participant_id
            where pm.project_id = v_item.project_id and pm.member_id = app.current_member_id()
              and pm.status = 'active' and p.status = 'active' and p.company_id = app.current_company_id()
              and pm.participant_id = v_item.raised_by_participant_id
          );
      end if;
      -- Nobody else: another Participant answers in its reply Screen, never in the Form (ADR 0019).
      return false;
    end
  $$;

-- Whether the viewer, a Member of the raiser's Participant, sees item p_work_item_id back
-- after a Send Back to a Step that says "Comment only": its Form, Documents and checklist are
-- read-only until it is Submitted again, and the item page says why.
create function app.sent_back_for_comment(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) then
        return false;
      end if;
      return app.after_send_back_now(p_work_item_id) is not distinct from 'comment'
        and exists (
          select 1 from work_item w
          join project_member pm on pm.project_id = w.project_id and pm.participant_id = w.raised_by_participant_id
          join participant p on p.id = pm.participant_id
          where w.id = p_work_item_id and pm.member_id = app.current_member_id()
            and pm.status = 'active' and p.status = 'active' and p.company_id = app.current_company_id()
        );
    end
  $$;

-- A Version's rows and a draft's carry the column ------------------------------------------

-- As in 20270117100000_raisers_form_review_fixes.sql, with after_send_back when it is set.
create or replace function app.workflow_version_step_rows(p_version_id uuid) returns jsonb
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
          || case when s.after_send_back is null then '{}'::jsonb
            else jsonb_build_object('after_send_back', s.after_send_back) end
          order by s.created_at, s.key)
        from workflow_step s where s.workflow_version_id = p_version_id), '[]'::jsonb);
    end
  $$;

-- As in 20270117100000_raisers_form_review_fixes.sql, checking after_send_back's values too.
create or replace function app.workflow_rows_fit(p_layout jsonb, p_steps jsonb, p_transitions jsonb) returns boolean
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
             or coalesce(s ->> 'drafts_visible_to', 'company') not in ('company', 'author')
             or coalesce(s ->> 'after_send_back', 'edit_form') not in ('comment', 'edit_form'))
        or exists (
          select 1 from jsonb_array_elements(p_transitions) t
          where jsonb_typeof(t -> 'screen_key') not in ('string', 'null')
             or (t ->> 'screen_key' is not null and (t ->> 'screen_key' !~ '^[a-z][a-z0-9_]*$' or length(t ->> 'screen_key') > 64))
             or (t ->> 'screen_key' is not null and jsonb_typeof(t -> 'action_form') not in ('null')))
      );
    end
  $$;

-- As in 20270117100000_raisers_form_review_fixes.sql, storing after_send_back.
create or replace function app.insert_workflow_rows(p_version_id uuid, p_steps jsonb, p_transitions jsonb, p_at timestamptz) returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_count integer;
    begin
      insert into workflow_step (
        workflow_version_id, key, name, stage_key, actor_rule, is_signing, outcome_mode, edits_form, drafts_visible_to,
        after_send_back, created_at
      )
      select p_version_id, e.s ->> 'key', e.s -> 'name', e.s ->> 'stage_key', coalesce(e.s -> 'actor_rule', '{}'), false,
        e.s ->> 'outcome_mode', (e.s ->> 'edits_form')::boolean, e.s ->> 'drafts_visible_to', e.s ->> 'after_send_back',
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

-- Grants ------------------------------------------------------------------------------------

-- Internal: app.can_save_answers and app.sent_back_for_comment check who asks.
revoke all on function app.after_send_back_now(uuid) from public;
revoke all on function app.sent_back_for_comment(uuid) from public;
grant execute on function app.sent_back_for_comment(uuid) to rabaed_app;
