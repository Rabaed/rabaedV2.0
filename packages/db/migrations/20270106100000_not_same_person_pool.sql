-- Review fix of spec RP-423 (RP-430, WF-7 rule 3; workflow-engine.md §3, §4;
-- visibility.md "Refusals of a Transition", scenario RP-430-1): "not the same
-- person" also keeps that Member from holding the next Step through the Transition.
--
-- The Member who took Transition T (or left Step S) is removed from the Step Pool
-- for the Transition whose rule names them: not only kept from taking it (the
-- Restrict on the actor, app.transition_restrictions_hold), but not in its next
-- Step's pool either, so never its next holder by any route:
-- * app.next_step_holder asks for someone in that pool without them, so when nobody
--   is left the Transition isn't offered, and is refused with the usual uniform
--   answer ('next_step_unavailable', or 'no_step_pool' at the raiser's own Steps);
-- * "Assign to" (app.assignees_offered) never offers them;
-- * coming back by a Return or a Send Back (app.transition_next_holder) never
--   gives the Step back to them: the item goes to the pool without them;
-- * the pooled assignment the Transition makes stays without them until it is
--   claimed (app.step_pool, read again from the event that made the assignment), so
--   they can't claim it, aren't offered the claim, and aren't told it is waiting.
-- Who is removed is read as the Restrict reads it (app.not_same_person_members):
-- the item's events shared with every Participant or internal to the acting
-- Participant, so neither the pool nor the refusal ever differs by hidden data.

-- Whom a Transition's "not the same person" rules name -------------------------------------

-- The Members Restrict rules `p_rules` name as "not the same person" on item
-- `p_work_item_id`: who took the named Transition or left the named Step, read from
-- the item's events shared with every Participant or internal to Participant
-- `p_participant_id` (the acting one; null: shared events only).
create function app.not_same_person_members(p_work_item_id uuid, p_rules jsonb, p_participant_id uuid)
  returns table (member_id uuid)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if p_rules is null or not exists (
        select 1 from jsonb_array_elements(coalesce(p_rules -> 'restrict', '[]')) r where r ->> 'type' = 'not_same_person')
      then
        return;
      end if;
      return query
        select distinct e.actor_member_id
        from work_item w
        cross join jsonb_array_elements(p_rules -> 'restrict') r
        join work_item_event e on e.work_item_id = w.id and e.type in ('transition', 'issue_code')
          and (e.audience = 'shared' or e.audience_participant_id = p_participant_id)
        where w.id = p_work_item_id and r ->> 'type' = 'not_same_person'
          and case when r ? 'step'
            then e.from_step_id = (select s.id from workflow_step s where s.workflow_version_id = w.workflow_version_id and s.key = r ->> 'step')
            else e.transition_id = (select tr.id from workflow_transition tr
                                    where tr.workflow_version_id = w.workflow_version_id and tr.key = r ->> 'transition') end;
    end
  $$;

-- The Step Pool of a Transition's next Step for Participant `p_participant_id`, when
-- the acting Participant `p_actor_participant_id` takes Transition `p_transition_id`:
-- app.step_pool without the Members its "not the same person" rules name.
create function app.transition_step_pool(
  p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_actor_participant_id uuid
) returns table (project_member_id uuid, member_id uuid)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_transition record;
    begin
      select tr.to_step_id, tr.rules into v_transition from workflow_transition tr where tr.id = p_transition_id;
      return query
        select p.project_member_id, p.member_id
        from app.step_pool(p_work_item_id, v_transition.to_step_id, p_participant_id) p
        where p.member_id not in (
          select x.member_id from app.not_same_person_members(p_work_item_id, v_transition.rules, p_actor_participant_id) x);
    end
  $$;

-- The Step Pool, without the Members a pooled assignment's Transition removed ---------------

-- As in 20261108000000_plpgsql_definer_helpers.sql; while the item waits in the pool
-- of Step `p_step_id` for that Participant, without the Members the Transition that
-- put it there named as "not the same person" (read as its actor's Participant read
-- them): they can't claim it.
create or replace function app.step_pool(p_work_item_id uuid, p_step_id uuid, p_participant_id uuid) returns table(project_member_id uuid, member_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_removed uuid[];
    begin
      select coalesce(array_agg(x.member_id), '{}') into v_removed
      from step_assignment a
      join work_item_event e on e.work_item_id = a.work_item_id and e.created_at = a.created_at and e.to_step_id = a.step_id
        and e.type in ('transition', 'issue_code')
      join workflow_transition tr on tr.id = e.transition_id and tr.rules is not null
      cross join lateral app.not_same_person_members(a.work_item_id, tr.rules, e.actor_participant_id) x
      where a.work_item_id = p_work_item_id and a.step_id = p_step_id and a.participant_id = p_participant_id
        and a.status = 'pooled';
      return query
        select pm.id, pm.member_id
        from work_item w
        join work_item_type t on t.id = w.work_item_type_id
        join workflow_step s on s.id = p_step_id and s.workflow_version_id = w.workflow_version_id
        join participant p on p.id = p_participant_id and p.project_id = w.project_id and p.status = 'active'
        join project_member pm on pm.participant_id = p.id and pm.status = 'active'
        join member m on m.id = pm.member_id and m.status = 'active' and m.company_id = p.company_id
        join company co on co.id = m.company_id and co.status = 'active'
        where w.id = p_work_item_id
          and pm.member_id <> all (v_removed)
          and app.project_member_has_permission(pm.id, t.module_key, s.actor_rule ->> 'permission')
          and not exists (
            select 1 from work_item_dimension_value dv
            where dv.work_item_id = w.id
              and dv.dimension_value_id not in (select app.values_covered_by_project_member(pm.id, dv.dimension_id))
          );
    end
  $$;

-- Who would hold the next Step ------------------------------------------------------------

-- As in 20261001000000_submit_and_codes.sql, the pool being the Transition's
-- (app.transition_step_pool, for the acting Member's Participant).
create or replace function app.next_step_holder(p_work_item_id uuid, p_transition_id uuid)
  returns table (outcome text, participant_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_target record;
      v_candidates uuid[];
      v_actor uuid := (select me.participant_id from app.acting_project_member(p_work_item_id) me);
    begin
      select tr.to_step_id as step_id, target.actor_rule ->> 'base_role' as base_role,
        w.raised_by_participant_id as raiser_id, raiser_role.base_role as raiser_base_role
      into v_target
      from work_item w
      join workflow_transition tr on tr.id = p_transition_id and tr.workflow_version_id = w.workflow_version_id
      join workflow_step target on target.id = tr.to_step_id
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      where w.id = p_work_item_id;
      if v_target.base_role is null then
        return query select 'terminal'::text, null::uuid;
        return;
      end if;

      if v_target.base_role = v_target.raiser_base_role then
        -- The raiser's own Steps stay with the raiser, never another Participant of its role (V3).
        if exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_target.raiser_id, v_actor)) then
          return query select 'ok'::text, v_target.raiser_id;
        else
          return query select 'no_step_pool'::text, null::uuid;
        end if;
        return;
      end if;

      select coalesce(array_agg(p.id), '{}') into v_candidates
      from work_item w
      join participant p on p.project_id = w.project_id and p.status = 'active'
      join project_role r on r.id = p.project_role_id and r.base_role = v_target.base_role
      where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
      if cardinality(v_candidates) = 1
        and exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_candidates[1], v_actor))
      then
        return query select 'ok'::text, v_candidates[1];
      else
        return query select 'next_step_unavailable'::text, null::uuid;
      end if;
    end
  $$;

-- As in 20270106000000_take_transition_helpers.sql, coming back only to a Member of
-- the Transition's pool (app.transition_step_pool).
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

-- As in 20261231000000_transition_actions.sql, offering the Transition's pool
-- (app.transition_step_pool).
create or replace function app.assignees_offered(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid)
  returns table(member_id uuid)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_offers boolean;
      v_next record;
    begin
      select coalesce(tr.actions, '[]') @> '[{"type": "offer_assign_to"}]' into v_offers
      from workflow_transition tr where tr.id = p_transition_id;
      if not coalesce(v_offers, false) then
        return;
      end if;
      select * into v_next from app.next_step_holder(p_work_item_id, p_transition_id);
      if v_next.outcome is distinct from 'ok' or v_next.participant_id is distinct from p_participant_id then
        return;
      end if;
      return query select p.member_id from app.transition_step_pool(p_work_item_id, p_transition_id, p_participant_id, p_participant_id) p;
    end
  $$;

-- As in 20261230000000_transition_rules.sql, "not the same person" read through
-- app.not_same_person_members.
create or replace function app.transition_restrictions_hold(
  p_work_item_id uuid, p_rules jsonb, p_project_member_id uuid, p_participant_id uuid
) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_rule jsonb;
      v_version uuid;
      v_member uuid := app.current_member_id();
    begin
      select workflow_version_id into v_version from work_item where id = p_work_item_id;
      for v_rule in select r from jsonb_array_elements(coalesce(p_rules -> 'restrict', '[]')) r loop
        case v_rule ->> 'type'
          -- Who may take it: one of these Positions.
          when 'positions' then
            if not exists (
              select 1 from project_member_position mp join position p on p.id = mp.position_id
              where mp.project_member_id = p_project_member_id
                and p.key in (select jsonb_array_elements_text(v_rule -> 'positions')))
            then
              return false;
            end if;
          -- Separation of duties: not the Member who left that Step, or took that Transition.
          when 'not_same_person' then
            if v_member in (
              select x.member_id
              from app.not_same_person_members(p_work_item_id, jsonb_build_object('restrict', jsonb_build_array(v_rule)), p_participant_id) x)
            then
              return false;
            end if;
          -- Has been through a Step (one of the acting Participant's own), or a shared fact.
          when 'been_through' then
            if v_rule ->> 'fact' = 'revision' then
              if not exists (select 1 from work_item w where w.id = p_work_item_id and w.revision_no > 0) then
                return false;
              end if;
            elsif v_rule ->> 'fact' = 'sent_back' then
              if not exists (
                select 1 from work_item_event e join workflow_transition tr on tr.id = e.transition_id
                where e.work_item_id = p_work_item_id and e.type = 'transition' and tr.kind = 'send_back'
                  and (e.audience = 'shared' or e.audience_participant_id = p_participant_id))
              then
                return false;
              end if;
            -- A Step: a move into or out of it, held by the acting Participant. Another
            -- Participant's Step never counts, even where a shared Submit left it.
            elsif not exists (
              select 1 from work_item_event e
              join workflow_step s on s.workflow_version_id = v_version and s.key = v_rule ->> 'step'
              where e.work_item_id = p_work_item_id and e.type in ('transition', 'issue_code')
                and (e.from_step_id = s.id or e.to_step_id = s.id)
                and (e.audience = 'shared' or e.audience_participant_id = p_participant_id)
                and exists (select 1 from step_assignment a
                            where a.work_item_id = p_work_item_id and a.step_id = s.id and a.participant_id = p_participant_id))
            then
              return false;
            end if;
          -- All Comments (items raised from this one) closed: those the Member sees.
          -- Subtasks don't exist yet (no work_item.parent_id): "all Subtasks closed" holds
          -- until they do, and then reads them the same way.
          when 'all_closed' then
            if v_rule ->> 'items' = 'comments' and exists (
              select 1 from work_item_link l
              join work_item c on c.id = l.from_id
              where l.to_id = p_work_item_id and l.kind = 'raised_from' and l.removed_at is null
                and c.closed_at is null and c.discarded_at is null
                and app.sees_work_item(c.id))
            then
              return false;
            end if;
          else
            null;
        end case;
      end loop;
      return true;
    end
  $$;

revoke all on function app.not_same_person_members(uuid, jsonb, uuid) from public;
revoke all on function app.transition_step_pool(uuid, uuid, uuid, uuid) from public;
