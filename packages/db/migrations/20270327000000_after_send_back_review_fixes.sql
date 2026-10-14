-- RP-580 review fixes (ADR 0021; workflow-engine.md §1; form-engine.md §4; visibility.md V19).
--
-- * Every Version published says "After a Send Back": app.publish_workflow_draft sets
--   `comment`, before the Version is published, on each raiser's Step (the Draft Step's role)
--   a `send_back` leads to that leaves it out, as @rabaed/domain's withAfterSendBackDefault does
--   on a save. A copy published without a save (a duplicate, the Library's, a Company's
--   defaults in a new Project) kept null, which runs as `edit_form`, while the builder showed
--   "Comment only". Only Versions published before RP-580 keep null.
-- * app.after_send_back_now (security definer, re-reading the item each call) is replaced by
--   app.after_send_back_setting, which runs with its callers' rights and takes the item and
--   its raiser they already read, so a save reads the item once. The membership check
--   app.can_save_answers and app.sent_back_for_comment share is app.acts_for_participant.
--   Both helpers are internal (no grant); their definer callers check who asks.
--
-- Rebuilt from their latest bodies: app.can_save_answers and app.sent_back_for_comment
-- (20270210000000_after_send_back.sql), app.publish_workflow_draft (20270116000000_screens.sql).

-- For a Submitted item p_work_item_id that its raiser p_raiser_participant_id holds: when the
-- last Transition another Participant took was a `send_back`, the "After a Send Back" of the
-- Step it led to, `edit_form` when null; else null. The callers have read the item (and check
-- who asks); it runs with their rights.
create function app.after_send_back_setting(p_work_item_id uuid, p_raiser_participant_id uuid) returns text
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_last record;
    begin
      select tr.kind, s.after_send_back into v_last
      from work_item_event e
      join workflow_transition tr on tr.id = e.transition_id
      join workflow_step s on s.id = tr.to_step_id
      where e.work_item_id = p_work_item_id and e.type = 'transition'
        and e.actor_participant_id <> p_raiser_participant_id
      order by e.seq desc limit 1;
      if v_last.kind is distinct from 'send_back' then
        return null;
      end if;
      return coalesce(v_last.after_send_back, 'edit_form');
    end
  $$;

-- Whether the acting Member is an active Project Member, of the acting Company, on raiser
-- Participant p_participant_id of Project p_project_id (app.can_save_answers' check, shared).
create function app.acts_for_participant(p_project_id uuid, p_participant_id uuid) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from project_member pm
        join participant p on p.id = pm.participant_id
        where pm.project_id = p_project_id and pm.member_id = app.current_member_id()
          and pm.status = 'active' and p.status = 'active' and p.company_id = app.current_company_id()
          and pm.participant_id = p_participant_id
      );
    end
  $$;

-- As in 20270210000000_after_send_back.sql, through the two helpers above.
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
          and (v_item.submitted_at is null
            or app.after_send_back_setting(v_item.id, v_item.raised_by_participant_id) is not distinct from 'edit_form')
          and app.acts_for_participant(v_item.project_id, v_item.raised_by_participant_id);
      end if;
      -- Nobody else: another Participant answers in its reply Screen, never in the Form (ADR 0019).
      return false;
    end
  $$;

-- As in 20270210000000_after_send_back.sql, reading the item once and through the helpers above.
create or replace function app.sent_back_for_comment(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return false;
      end if;
      select w.id, w.project_id, w.raised_by_participant_id, w.submitted_at, a.participant_id as holder_participant_id
      into v_item
      from work_item w
      left join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
      where w.id = p_work_item_id and w.closed_at is null;
      -- Back at its raiser after the first Submit, else there is no Send Back to comment on.
      if v_item.id is null or v_item.submitted_at is null
        or v_item.holder_participant_id is distinct from v_item.raised_by_participant_id then
        return false;
      end if;
      return app.after_send_back_setting(v_item.id, v_item.raised_by_participant_id) is not distinct from 'comment'
        and app.acts_for_participant(v_item.project_id, v_item.raised_by_participant_id);
    end
  $$;

drop function app.after_send_back_now(uuid);

-- As in 20270116000000_screens.sql, setting "Comment only" where a Version leaves it out on a
-- raiser's Step a Send Back leads to, before it is published.
create or replace function app.publish_workflow_draft(p_definition_id uuid, p_at timestamptz)
  returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_version record;
      v_unpinned text;
    begin
      perform 1 from workflow_definition d where d.id = p_definition_id for update;
      if not found then
        return query select 'not_found'::text, null::uuid, null::integer;
        return;
      end if;
      select v.id, v.version_no, v.status, v.draft_name into v_version
      from workflow_version v where v.workflow_definition_id = p_definition_id
      order by v.version_no desc limit 1;
      if v_version.id is null or v_version.status <> 'draft' then
        return query select 'no_draft'::text, null::uuid, null::integer;
        return;
      end if;
      update workflow_transition t set screen_version_id = p.screen_version_id, action_form = p.schema
      from app.workflow_screens(p_definition_id) p
      where t.workflow_version_id = v_version.id and t.screen_key = p.key;
      select t.screen_key into v_unpinned from workflow_transition t
      where t.workflow_version_id = v_version.id and t.screen_key is not null and t.screen_version_id is null
      limit 1;
      if v_unpinned is not null then
        raise exception 'publish_workflow_draft: Screen % has no published Version this Workflow can use', v_unpinned;
      end if;
      update workflow_step s set after_send_back = 'comment'
      where s.workflow_version_id = v_version.id and s.after_send_back is null
        and exists (
          select 1 from workflow_transition t
          where t.workflow_version_id = v_version.id and t.kind = 'send_back' and t.to_step_id = s.id)
        and exists (
          select 1 from workflow_step d
          where d.workflow_version_id = v_version.id and app.is_draft_step(d.id)
            and d.actor_rule ->> 'base_role' = s.actor_rule ->> 'base_role');
      update workflow_version v set status = 'published', published_at = p_at, draft_name = null, updated_at = p_at
      where v.id = v_version.id;
      if v_version.draft_name is not null then
        update workflow_definition d set name = v_version.draft_name, updated_at = p_at where d.id = p_definition_id;
      end if;
      return query select 'published'::text, v_version.id, v_version.version_no;
    end
  $$;

-- Internal: app.can_save_answers and app.sent_back_for_comment check who asks.
revoke all on function app.after_send_back_setting(uuid, uuid) from public;
revoke all on function app.acts_for_participant(uuid, uuid) from public;
