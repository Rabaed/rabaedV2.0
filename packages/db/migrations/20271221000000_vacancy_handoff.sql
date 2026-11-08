-- RP-1262 (follow-up to RP-952; ADR 0028; GLOSSARY › Vacancy; workflow-engine.md §9; visibility.md
-- "A Participant's withdrawal"; scenarios RP-1262-1 to RP-1262-4): a withdrawn Participant's
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
-- * When: whenever a Participant can start, or stop, being the one candidate: when it accepts its
--   Invitation (app.respond_to_invitation) and after its Visibility is set
--   (app.set_participant_visibility). Not app.add_participant: an invited Participant isn't active
--   and covers nothing. Narrowing one of two overlapping Participants hands the Vacancy to the other.
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
-- Rebuilt from main's newest bodies: app.respond_to_invitation (20261004000000_participant_invitations.sql)
-- and app.set_participant_visibility (20271209000000_dimension_value_status.sql), each with one call added.

-- Rabaed's own hand-off event has no actor ---------------------------------------------------------

alter table work_item_event drop constraint work_item_event_actor_check;
alter table work_item_event add constraint work_item_event_actor_check
  check ((actor_member_id is null) <> (actor_engineer_id is null)
    or (type = 'cancelled' and actor_member_id is null and actor_engineer_id is null and payload ? 'left_participant_id')
    or (type = 'assigned' and actor_member_id is null and actor_engineer_id is null and payload ? 'vacancy'));

-- The hand-off -------------------------------------------------------------------------------------

-- Passes each open Vacancy on Project `p_project_id` that has exactly one replacement Participant to
-- that Participant's Step Pool, at `p_at`; how many it passed. Nothing on a Project that isn't active.
-- Only the functions above call it, inside their own transaction; no role but the owner runs it.
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

-- As in 20271209000000_dimension_value_status.sql, with the hand-off once the grant is set.
create or replace function app.set_participant_visibility(
  p_participant_id uuid, p_kind text, p_is_all boolean, p_value_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_values uuid[] := case when p_is_all then '{}' else coalesce(p_value_ids, '{}') end;
      v_project_id uuid;
      v_dimension_id uuid;
      v_grant_id uuid;
      v_member_grant record;
    begin
      -- Locked, so a Member's grant is never checked against a Participant grant
      -- that is changing at the same time (see app.set_member_visibility).
      select project_id into v_project_id from participant
      where id = p_participant_id and status = 'active' and project_id in (select app.current_admin_project_ids())
      for update;
      if v_project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      v_dimension_id := app.project_dimension_id(v_project_id, p_kind);
      if exists (select unnest(v_values) except select id from dimension_value where dimension_id = v_dimension_id) then
        return 'value_not_found';
      end if;
      if exists (
        select unnest(v_values)
        intersect select id from dimension_value where dimension_id = v_dimension_id and status = 'deactivated'
        except select app.values_covered_by_participant(p_participant_id, v_dimension_id)
      ) then
        return 'value_not_found';
      end if;

      insert into visibility_grant as g (project_id, subject_kind, participant_id, dimension_id, is_all)
      values (v_project_id, 'participant', p_participant_id, v_dimension_id, p_is_all)
      on conflict on constraint visibility_grant_subject_dimension_key
        do update set is_all = excluded.is_all, updated_at = v_at
      returning g.id into v_grant_id;
      perform app.replace_grant_values(v_grant_id, v_values);

      -- Each Member's grant becomes its intersection with what the Participant now covers, stored
      -- as the topmost values, so widening the Participant again doesn't widen them.
      -- A Member's "all" already means all of the Participant's.
      for v_member_grant in
        select id from visibility_grant
        where participant_id = p_participant_id and project_member_id is not null
          and dimension_id = v_dimension_id and not is_all
      loop
        perform app.replace_grant_values(v_member_grant.id, array(
          with kept as (
            select app.values_covered_by_grant(v_member_grant.id) as id
            intersect
            select app.values_covered_by_participant(p_participant_id, v_dimension_id)
          )
          select v.id from kept k join dimension_value v on v.id = k.id
          where v.parent_id is null or v.parent_id not in (select id from kept)
        ));
        update visibility_grant set updated_at = v_at where id = v_member_grant.id;
      end loop;
      -- RP-1262: widened, it may be a Vacancy's one replacement now; narrowed, it may leave another the only one.
      perform app.pass_vacancies(v_project_id, v_at);
      return 'set';
    end
  $$;
