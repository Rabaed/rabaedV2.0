-- Form Sections filled by another Participant retire (RP-437, moved from RP-516; spec
-- RP-511 decision 5; ADR 0019; form-engine.md §4; visibility.md V19, scenarios 46-49,
-- 57, 66, RP-431-1).
--
-- * The Form belongs to the raiser: every other Participant answers in its reply Screen
--   (RP-516), never in the Form. Publishing a Form refuses a section whose `editable_at`
--   names another Participant's Step (@rabaed/domain `other_participant_section`), so
--   no published Form Version after this has one; the MAR's Form Version 5 and the
--   Comment's Version 2 (`pnpm defaults:publish`, RP-437) replace the last two.
-- * app.can_save_answers: the other Participant's branch goes. Only the raiser's Member
--   holding the Step saves the Form, where the Workflow lets it, before the first Submit
--   or while a Send Back has it back (RP-514, RP-525). A Form Version published before
--   with such a section (MAR Form Version 4, the Comment's Version 1) is read-only to
--   everyone there.
-- * app.transition_effects: a Send Back out of another Participant's Step no longer puts
--   its sections back as they arrived; there is nothing it could have written. The
--   answers as they arrived (work_item.data_as_arrived) stay for the raiser's own changes
--   after a Send Back (V19, narrowed).
--
-- Rebuilt from their latest bodies: app.can_save_answers
-- (20270117100000_raisers_form_review_fixes.sql), app.transition_effects
-- (20270111000000_pool_of_one.sql).

-- Who may save -------------------------------------------------------------------------------

-- As in the raisers_form_review_fixes migration, without the other Participant's branch:
-- only the raiser's Member holding the Step saves the Form.
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

-- A Transition's effects ----------------------------------------------------------------------

-- As in the pool_of_one migration, without a Send Back's discard of the sections another
-- Participant filled: there are none to put back.
CREATE OR REPLACE FUNCTION app.transition_effects(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_assignment_id uuid, p_next_outcome text, p_next_participant_id uuid, p_holder uuid, p_answers jsonb, p_note text, p_recommended_code text, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    declare
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_transition record;
      v_number text;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
      v_new_assignment_id uuid;
    begin
      select w.* into v_item from work_item w where w.id = p_work_item_id;
      select tr.*, target.stage_key as to_stage_key,
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
      -- The Recommended Code is Internal Communication (V5): its own event, internal to
      -- the recommender's Participant, just before the Internal Note written with it
      -- and the Transition. Never on the item, so no other read can reach it.
      if p_recommended_code is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'recommend_code', v_member_id, p_participant_id, p_transition_id,
          v_item.current_step_id, jsonb_build_object('recommended_code', p_recommended_code), 'internal', p_participant_id, p_at
        );
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
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, created_at
      ) values (
        v_item.project_id, p_work_item_id,
        -- A Code is issued only where one is set; any other move from that Step is a plain Transition.
        case when v_transition.from_outcome_mode = 'issue_code' and v_outcome is not null then 'issue_code'
          else 'transition' end,
        v_member_id, p_participant_id, p_transition_id,
        v_item.current_step_id, v_transition.to_step_id,
        -- The Action Form answers (with what its actions set), then what the engine
        -- writes (no Action Form field takes those keys).
        jsonb_strip_nulls(p_answers || jsonb_build_object('document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then p_participant_id end,
        -- The item's exact content as this Transition leaves it (ADR 0017).
        app.work_item_content_sha256(p_work_item_id, v_item.title, v_item.data, v_outcome),
        p_at
      );

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
