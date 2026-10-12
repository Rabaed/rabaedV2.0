-- app.can_save_answers, defined once more after main's 20270117100000_raisers_form_review_fixes.sql
-- (RP-437, merge of main). The body is exactly 20270118100000_retire_other_participant_sections.sql's,
-- which was already written from 20270117100000's: only the raiser's Member holding the Step saves
-- the Form, where the Workflow lets it, before the first Submit or while a Send Back has it back.
-- No behaviour changes. It exists because 20270118100000 was first committed while that review-fix
-- migration was still named 20270117000000 (renamed for a timestamp clash with main), so the drift
-- check cannot see that 20270118100000 started from it.

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
      -- Nobody else: another Participant answers in its reply Screen, never in the Form (ADR 0019).
      return false;
    end
  $$;
