-- RP-1262 (follow-up to RP-952; ADR 0028; GLOSSARY › Vacancy; workflow-engine.md §9; visibility.md
-- "A Participant's withdrawal"; scenarios RP-1262-1 to RP-1262-6): a withdrawn Participant's
-- Participant-level Vacancies pass to the replacement Participant's Step Pool.
--
-- * Who the replacement is (§3.1, decided 2026-11-09 by the product owner, from lane B's proposal):
--   an active Participant of the Project holding the withdrawn Participant's Project Role (the role
--   "Waiting for a new ‹role›" names), whose Participant Visibility covers every one of the item's
--   dimension values. It is never of the withdrawn Participant's own Company: a re-invited withdrawn
--   Company (RP-1261, a new Participant row) gets none of its old Vacancies back. Each Vacancy is
--   judged by itself, whichever withdrawn Participant left it. With more than one candidate (a
--   Visibility Overlap) nobody is asked to pick, so the Vacancy stays where it is until exactly one
--   covers the item.
-- * When: whenever a Participant can start, or stop, being the one candidate (decided with Main 4 and
--   the owner, 2026-11-09): when it accepts its Invitation (app.respond_to_invitation); once a Project
--   Admin's whole change to its Visibility is saved (app.pass_vacancies_after_visibility, which the api
--   calls after every dimension, never per dimension: a half-saved change must never pass a Step, nor
--   refuse the change); and when a Participant is withdrawn (app.withdraw_participant), so a Vacancy
--   another Participant of the role already covers alone passes at once. Not app.add_participant: an
--   invited Participant isn't active and covers nothing. Narrowing one of two overlapping Participants,
--   or withdrawing one, hands the Vacancy to the other.
-- * The hand-off (app.pass_vacancies), for each Vacancy with exactly one candidate:
--   - the `vacant` row becomes `reassigned` (kept: nothing the withdrawn Company did is removed), and
--     a new `pooled` row for the replacement, made now, so "Reached your Step Pool" reads it as its
--     pool's (app.notification_pools). Its insert queues "Step reached" (app.outbox_step_reached), and
--     a pool of one holds it at once (app.hold_pool_of_one, §3.3 rule 4). With no Member in the pool
--     yet, it stays pooled and waits for one, as any pooled Step does;
--   - the replacement reads the item (`work_item_access`, `handling`), as at any Step it reaches;
--   - Step Age restarts: visibility.md says it counts "until the replacement Participant receives
--     it", so `step_entered_at`, `participant_entered_at` and `participant_entered_step_id` move to now;
--   - one shared `assigned` event, Rabaed's own (no Member, no Engineer: the actor check allows it as
--     it allows Rabaed's cancel), its acting Participant the replacement, payload `{"vacancy": true}`.
--     It holds no withdrawn Participant or Company: the history reads "Passed on by Rabaed" and the
--     replacement's name, as every other Company reads any holder (V14).
--   Nothing reaches the withdrawn Company: its Members have no Project, and no notice is sent to it.
--   The Vacancy leaves app.project_vacancies and app.work_item_vacancy, which read `vacant` rows only.
-- * A partial index on the `vacant` rows, so each of those moments reads only the Project's Vacancies.
-- Rebuilt from main's newest bodies: app.respond_to_invitation (20261004000000_participant_invitations.sql),
-- with one call added, and app.withdraw_participant (20271215000000_withdraw_participant.sql), with one call
-- and the Project's other Vacancies' items added to its first lock.

-- Rabaed's own hand-off event has no actor ---------------------------------------------------------

alter table work_item_event drop constraint work_item_event_actor_check;
alter table work_item_event add constraint work_item_event_actor_check
  check ((actor_member_id is null) <> (actor_engineer_id is null)
    or (type = 'cancelled' and actor_member_id is null and actor_engineer_id is null and payload ? 'left_participant_id')
    or (type = 'assigned' and actor_member_id is null and actor_engineer_id is null and payload ? 'vacancy'));

-- The hand-off -------------------------------------------------------------------------------------

create index step_assignment_vacant_idx on step_assignment (project_id) where status = 'vacant';

-- Passes each open Vacancy on Project `p_project_id` that has exactly one replacement Participant to
-- that Participant's Step Pool, at `p_at`; how many it passed. Nothing on a Project that isn't active.
-- Only the functions below call it, inside their own transaction; no role but the owner runs it.
create function app.pass_vacancies(p_project_id uuid, p_at timestamptz) returns integer
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_vacancy record;
      v_assignment_id uuid;
      v_passed integer := 0;
    begin
      if not exists (select 1 from project where id = p_project_id and status = 'active') then
        return 0;
      end if;
      for v_vacancy in
        select a.id, a.work_item_id, a.step_id, cand.ids[1] as to_participant_id
        from step_assignment a
        join work_item w on w.id = a.work_item_id and w.closed_at is null
        join participant gone on gone.id = a.participant_id
        cross join lateral (
          select array_agg(p.id) as ids
          from participant p
          where p.project_id = a.project_id and p.status = 'active'
            and p.project_role_id = gone.project_role_id and p.company_id <> gone.company_id
            and app.participant_covers_item(p.id, a.work_item_id)
        ) cand
        where a.project_id = p_project_id and a.status = 'vacant' and cardinality(cand.ids) = 1
        -- In item order, as app.withdraw_participant locks them, so the two never deadlock.
        order by a.work_item_id
      loop
        -- The item first, then its Step (app.take_transition's order); a Vacancy passed meanwhile is skipped.
        perform 1 from work_item where id = v_vacancy.work_item_id for update;
        update step_assignment set status = 'reassigned', done_at = p_at, updated_at = p_at
        where id = v_vacancy.id and status = 'vacant';
        if not found then
          continue;
        end if;

        insert into step_assignment (project_id, work_item_id, step_id, participant_id, status, created_at, updated_at)
        values (p_project_id, v_vacancy.work_item_id, v_vacancy.step_id, v_vacancy.to_participant_id, 'pooled', p_at, p_at)
        returning id into v_assignment_id;
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (v_vacancy.work_item_id, p_project_id, v_vacancy.to_participant_id, p_at, 'handling')
        on conflict do nothing;
        update work_item
        set step_entered_at = p_at, participant_entered_at = p_at, participant_entered_step_id = v_vacancy.step_id, updated_at = p_at
        where id = v_vacancy.work_item_id;
        insert into work_item_event (project_id, work_item_id, type, actor_participant_id, to_step_id, payload, audience, created_at)
        values (p_project_id, v_vacancy.work_item_id, 'assigned', v_vacancy.to_participant_id, v_vacancy.step_id,
          jsonb_build_object('vacancy', true), 'shared', p_at);
        -- Rule 4 (§3.3): a pool of one holds it at once, judged now, on arrival.
        perform app.hold_pool_of_one(v_assignment_id);
        v_passed := v_passed + 1;
      end loop;
      return v_passed;
    end
  $$;
revoke all on function app.pass_vacancies(uuid, timestamptz) from public;

-- When a Participant becomes active ----------------------------------------------------------------

-- As in 20261004000000_participant_invitations.sql, with the hand-off once it accepts.
create or replace function app.respond_to_invitation(p_participant_id uuid, p_accept boolean, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_at timestamptz := greatest(p_now, now());
      v_project_id uuid;
    begin
      select project_id into v_project_id from participant
      where id = p_participant_id and company_id = v_company_id and status = 'invited'
      for update;
      if v_project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      update participant
      set status = case when p_accept then 'active' else 'declined' end, responded_at = v_at, updated_at = v_at
      where id = p_participant_id;
      -- RP-1262: it may now be the one replacement for a Vacancy (an item with no dimension values).
      if p_accept then
        perform app.pass_vacancies(v_project_id, v_at);
      end if;
      return case when p_accept then 'accepted' else 'declined' end;
    end
  $$;

-- When a Participant's Visibility changes ----------------------------------------------------------

-- The hand-off after a Project Admin's change to Participant `p_participant_id`'s Visibility, once the
-- whole change is saved: the api calls it after every dimension, in the change's own transaction, before
-- the Handover check. Never per dimension: half a change (a new Trade with the old Location) may cover an
-- item the whole change doesn't, and a Step passed there would refuse the Admin's change (RP-1262-5).
-- Widened, the Participant may be a Vacancy's one replacement now; narrowed, it may leave another the only
-- one. 0 for anyone but the Project's Admins, as app.set_participant_visibility refuses them.
-- Every change to a Participant's Visibility must call it once, after the whole change is saved:
-- app.set_participant_visibility hands nothing on itself. apps/api/src/projects/visibility-handoff.test.ts
-- fails for a source file that calls the setter without it.
create function app.pass_vacancies_after_visibility(p_participant_id uuid, p_now timestamptz) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_project_id uuid;
    begin
      select project_id into v_project_id from participant
      where id = p_participant_id and status = 'active' and project_id in (select app.current_admin_project_ids());
      if v_project_id is null then
        return 0;
      end if;
      return app.pass_vacancies(v_project_id, greatest(p_now, now()));
    end
  $$;
revoke all on function app.pass_vacancies_after_visibility(uuid, timestamptz) from public;
grant execute on function app.pass_vacancies_after_visibility(uuid, timestamptz) to rabaed_app;

-- When a Participant is withdrawn ------------------------------------------------------------------

-- As in 20271215000000_withdraw_participant.sql, with the hand-off once the Participant is withdrawn: a
-- Vacancy it leaves that exactly one other Participant of its role already covers passes there at once,
-- and one it ends an Overlap for passes to the other (RP-1262-6).
create or replace function app.withdraw_participant(p_participant_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_refusal text;
      v_participant record;
      v_item record;
      v_member uuid;
      v_outbox uuid;
    begin
      -- Nobody locks a Participant they may not withdraw: checked first, then locked, then checked
      -- again under the lock, so one withdrawal runs at a time and the second reads 'not_found'.
      v_refusal := app.withdrawal_refusal(p_participant_id);
      if v_refusal is not null then
        return v_refusal;
      end if;
      select p.id, p.project_id, p.company_id into v_participant from participant p where p.id = p_participant_id for update;
      v_refusal := app.withdrawal_refusal(p_participant_id);
      if v_refusal is not null then
        return v_refusal;
      end if;
      -- Every item it changes, locked first in one order (app.take_transition locks an item before its Steps
      -- too), so two withdrawals on one Project, each touching the other's items, never deadlock.
      -- RP-1262: with the Project's other Vacancies, which the hand-off below may pass, so it takes no lock out of order.
      perform 1 from work_item w
      where w.id in (
        select x.id from work_item x where x.raised_by_participant_id = p_participant_id and x.closed_at is null
        union
        select a.work_item_id from step_assignment a where a.participant_id = p_participant_id and a.status in ('pooled', 'picked_up')
        union
        select a.work_item_id from step_assignment a where a.project_id = v_participant.project_id and a.status = 'vacant')
      order by w.id
      for update;

      -- Its items: those that left Draft Cancelled by Rabaed with a Record, its Drafts and Draft Revisions with none.
      for v_item in
        select w.id, w.current_step_id, w.document_number is null as is_draft, cancelled.id as cancelled_step_id, cancelled.stage_key
        from work_item w
        join work_item_type t on t.id = w.work_item_type_id
        -- Where an item that left Draft goes, as a Member's Cancel takes it: its Version's Step in a cancelled
        -- Stage, so every reader reads it Cancelled. A Version with none leaves it at its Step (RP-952 follow-up).
        left join lateral (
          select s.id, s.stage_key from workflow_step s
          join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = s.stage_key
          where s.workflow_version_id = w.workflow_version_id and st.category = 'cancelled' and w.document_number is not null
          order by s.id
          limit 1
        ) cancelled on true
        where w.raised_by_participant_id = p_participant_id and w.closed_at is null
        order by w.id
        for update of w
      loop
        insert into work_item_event (project_id, work_item_id, type, from_step_id, to_step_id, payload, audience, audience_participant_id, created_at)
        values (v_participant.project_id, v_item.id, 'cancelled', v_item.current_step_id, v_item.cancelled_step_id,
          jsonb_build_object('left_participant_id', p_participant_id),
          case when v_item.is_draft then 'internal' else 'shared' end,
          case when v_item.is_draft then p_participant_id end, v_at);
        update step_assignment set status = 'done', done_at = v_at, updated_at = v_at
        where work_item_id = v_item.id and status in ('pooled', 'picked_up', 'vacant');
        update work_item set outcome = 'cancelled', closed_at = v_at, updated_at = v_at,
          discarded_at = case when v_item.is_draft then v_at end,
          current_step_id = coalesce(v_item.cancelled_step_id, current_step_id),
          current_stage_key = coalesce(v_item.stage_key, current_stage_key),
          step_entered_at = case when v_item.cancelled_step_id is null then step_entered_at else v_at end,
          participant_entered_at = case when v_item.cancelled_step_id is null then participant_entered_at else v_at end,
          participant_entered_step_id = coalesce(v_item.cancelled_step_id, participant_entered_step_id)
        where id = v_item.id;
      end loop;

      -- Its Steps on other Companies' items: Participant-level Vacancies.
      update step_assignment set status = 'vacant', assignee_member_id = null, updated_at = v_at
      where id in (select app.withdrawal_vacates(p_participant_id));

      -- Its Notices, before its Members lose the Project: its Company's Authorized Person and Project Members.
      for v_member in
        select m.id from member m
        where m.status = 'active' and (
          m.id = (select co.authorized_person_id from company co where co.id = v_participant.company_id)
          or m.id in (select pm.member_id from project_member pm where pm.participant_id = p_participant_id and pm.status = 'active'))
        order by m.id
      loop
        insert into outbox (kind, project_id, payload)
        values ('participant_withdrawn', v_participant.project_id, jsonb_build_object('participantId', p_participant_id, 'memberId', v_member))
        returning id into v_outbox;
        insert into notification (member_id, project_id, outbox_id, kind, in_app, email, created_at)
        values (v_member, v_participant.project_id, v_outbox, 'participant_withdrawn', true, 'none', v_at);
      end loop;

      update participant set status = 'withdrawn', withdrawn_at = v_at, withdrawn_by_member_id = app.current_member_id(), updated_at = v_at
      where id = p_participant_id;
      -- RP-1262: every item it may pass is locked above, in item order.
      perform app.pass_vacancies(v_participant.project_id, v_at);
      return 'withdrawn';
    end
  $$;
