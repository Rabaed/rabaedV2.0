-- A Return stays in Internal Review: Documents freeze at Submit, a Draft is an item
-- never sent and shows no Step Age, the first Return goes to the author (RP-515, spec
-- RP-511 decision 9; ADR 0020; workflow-engine.md §1, §3.3, §5.1, §10; visibility.md
-- "Creation Date", scenario RP-515-1).
--
-- * Documents freeze when the item leaves the raiser's Participant by a Submit (the
--   first, or the next after a Send Back), or closes, no longer when it leaves the Draft
--   Step: nobody outside the raiser has seen them before (V1). The trigger
--   work_item_freezes_documents (app.freeze_documents_leaving_draft) is replaced by
--   work_item_freezes_documents_at_submit (app.freeze_documents_at_submit).
-- * app.can_change_draft_documents: the Member who may save the raiser's answers
--   (app.can_save_answers: the holder, at a Step that edits the Form, before the first
--   Submit or back at the raiser after a Send Back) may add, replace and remove its
--   Documents there, at any such Step of the raiser's (the Contractor Engineer Step in
--   Internal Review), not only at the Draft Step. Never another Participant's Step
--   (the ADR 0013 Form Sections RP-516 retires).
-- * app.step_as_seen gives no entered_at for a Draft (at its Draft Step, never
--   numbered): when it was started reaches nobody, its author included, through any
--   read built on it. Elsewhere it is as before, so a Returned item counts from the Return.
-- * app.transition_next_holder: a Return into a Step nobody has held yet goes to the
--   item's author, the Member who sent it from its Draft Step, while in the
--   Transition's pool (§3.3, after rule 1); else to the pool, or its only Member.
--
-- Rebuilt from their latest bodies: app.can_change_draft_documents
-- (20261108000000_plpgsql_definer_helpers.sql), app.step_as_seen
-- (20270110000000_pick_up_rename.sql), app.transition_next_holder
-- (20270106100000_not_same_person_pool.sql).

-- Documents freeze at the Submit ------------------------------------------------------------

drop trigger work_item_freezes_documents on work_item;
drop function app.freeze_documents_leaving_draft();

-- The item leaves the raiser's Participant by a Submit (submitted_at is set with the
-- first, kept after), or closes: its Documents are frozen for good. Pending uploads
-- can't be confirmed any more: nobody may change its Documents now.
create function app.freeze_documents_at_submit() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      update document set frozen_at = new.updated_at
      where work_item_id = new.id and confirmed_at is not null and removed_at is null and frozen_at is null;
      return null;
    end
  $$;
revoke all on function app.freeze_documents_at_submit() from public;

-- participant_entered_at moves whenever the item crosses to another Participant (or
-- closes); once Submitted, a crossing out of the raiser is a Submit, and one back into
-- it (a Send Back) finds nothing unfrozen.
create trigger work_item_freezes_documents_at_submit after update of participant_entered_at, closed_at on work_item
  for each row when (
    (new.submitted_at is not null and old.participant_entered_at is distinct from new.participant_entered_at)
    or (old.closed_at is null and new.closed_at is not null)
  )
  execute function app.freeze_documents_at_submit();

-- Who may change them: the holder who may save the raiser's answers, at a raiser's Step.
create or replace function app.can_change_draft_documents(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.can_save_answers(p_work_item_id)
          and exists (
            select 1 from work_item w
            join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
            where w.id = p_work_item_id and a.participant_id = w.raised_by_participant_id
          )
      );
    end
  $$;

-- No Step Age in a Draft -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.step_as_seen(p_work_item_id uuid)
 RETURNS TABLE(step_id uuid, stage_key text, entered_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    begin
      return query
        select s.id, s.stage_key,
          case
            -- A Draft (never left its Draft Step, so never numbered): its Step began when it
            -- was started, which reaches nobody (ADR 0020; visibility.md "Creation Date").
            when w.document_number is null and app.is_draft_step(w.current_step_id) then null
            when h.mine then w.step_entered_at
            else w.participant_entered_at
          end
        from work_item w
        cross join lateral (
          select exists (
            select 1 from step_assignment a
            where a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
              and a.participant_id in (select app.current_participant_ids())
          ) as mine
        ) h
        join workflow_step s on s.id = case when h.mine then w.current_step_id else w.participant_entered_step_id end
        where w.id = p_work_item_id and app.sees_work_item(w.id);
    end
  $function$;

-- The first Return goes to the author ------------------------------------------------------

-- As in 20270106100000_not_same_person_pool.sql, with the item's author after rule 1.
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
      -- still in the Transition's pool.
      if v_transition.kind in ('return', 'send_back') then
        select a.assignee_member_id into v_holder from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_transition.to_step_id and a.status = 'done'
          and a.assignee_member_id in (
            select p.member_id from app.transition_step_pool(p_work_item_id, p_transition_id, v_next.participant_id, p_participant_id) p)
        order by a.done_at desc, a.id desc limit 1;
      end if;
      -- A Return into a Step nobody has held yet (the Contractor Engineer Step, the first
      -- time; ADR 0020): the item's author, who sent it from its Draft Step, if still in
      -- the Transition's pool.
      if v_transition.kind = 'return' and v_holder is null
        and not exists (select 1 from step_assignment a where a.work_item_id = p_work_item_id and a.step_id = v_transition.to_step_id)
      then
        select a.assignee_member_id into v_holder from step_assignment a
        where a.work_item_id = p_work_item_id and a.status = 'done' and app.is_draft_step(a.step_id)
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
