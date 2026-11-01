-- RP-1192 (visibility.md V14; scenario RP-1192-1): no Step of the holding Participant reaches anyone
-- outside it. While K1 held C1's Submittal, app.step_as_seen and app.work_items_seen gave C1 (and the
-- Owner Representative) the Step the item reached at K1, and app.work_item_history named it on C1's own
-- Submit: the item read showed "Step: Consultant Engineer", and the Work Item page's facts card and
-- Transitions rail printed it. A Step is internal to the Participant that holds it, whichever of its Steps
-- it is, the one the item arrived at included; another Company knows only the Company and its role, as the
-- Workflow map's `position` has it (RP-438). All start from their newest bodies.
--
-- * app.step_as_seen: the Step (`step_id`) only to a Member of the holding Participant, or once the item has
--   closed (its terminal Step, which its outcome names to everyone); null to everyone else. A new column,
--   `holder_role`, gives everyone who sees the item the role holding it (app.actor_role of the Step it is
--   seen at, a Step held by the raiser being of the raiser's role), which the map reads in place of the Step.
--   The Stage and the time it reached the holder stay as they were. Its return type changes, so it is
--   dropped and created again; app.take_step_age_report is its only caller among the database's functions.
-- * app.work_items_seen (the List row, its search and the Kanban card): the same rule on `step_id`. Its own
--   join still reads the Step it is seen at, for the Owner's review label alone.
-- * app.work_item_history: an event's `to_step_name` only where the Step it reached is the reader's own
--   Participant's (the reader's Participant has an assignment at it on this item; step_assignment's policy
--   gives a reader only its own Participant's rows) or is terminal (no actor), on an event of the reader's own
--   Participant as before. So C1's Submit names Consultant review to nobody (K1 reads no Step on C1's events),
--   and K1's Send Back names C1's internal review to nobody either: K1 has no assignment there.
-- * app.take_step_age_report: reads the Step with a left join, so an item held by another Company stays in
--   the report (with no Step name, which it showed only for the reader's own Steps).
--
-- Not changed here: work_item_event.to_step_id stays granted to the app role (the List's closed card finds its
-- closer by it; RP-1140), so the id of the Step a shared move reached is still readable; the api names no Step
-- from it. That is RP-1203.

-- 1. ------------------------------------------------------------------------------------------------------
-- From 20271019000000_reads_at_scale.sql.
drop function app.step_as_seen(uuid);
create function app.step_as_seen(p_work_item_id uuid)
  returns table(step_id uuid, stage_key text, entered_at timestamp with time zone, holder_role text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_mine uuid[];
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      v_mine := array(select app.current_participant_ids());
      return query
        select
          -- The holding Participant's own Step, or a closed item's terminal Step; never another Company's (V14).
          case when w.closed_at is not null or app.holds_work_item(w.id) then seen.step_id end,
          seen.stage_key, seen.entered_at,
          app.actor_role(s.actor_rule, app.work_item_raiser_role(w.id))
        from app.step_as_seen_unchecked(p_work_item_id, v_mine) seen
        join work_item w on w.id = p_work_item_id
        join workflow_step s on s.id = seen.step_id;
    end
  $$;
revoke all on function app.step_as_seen(uuid) from public;
grant execute on function app.step_as_seen(uuid) to rabaed_app;

-- 2. ------------------------------------------------------------------------------------------------------
-- From 20271019000000_reads_at_scale.sql.
create or replace function app.work_items_seen(p_project_id uuid, p_module_keys text[], p_all_revisions boolean, p_work_item_ids uuid[] default null)
  returns table(
    id uuid, project_id uuid, work_item_type_id uuid, title text, document_number text, revision_no integer,
    outcome text, paper_ref text, submitted_at timestamptz, raised_by_participant_id uuid, closed_at timestamptz,
    step_id uuid, stage_key text, entered_at timestamptz, holder_participant_id uuid, holder_member_id uuid,
    owner_review jsonb, had_code_c boolean, creation_date timestamptz, dimension_ids uuid[], dimension_value_ids uuid[],
    holder_company_name jsonb, raiser_company_name jsonb
  )
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_mine uuid[] := array(select app.current_participant_ids());
    begin
      return query
        -- The scope's items first, then the check, so no other Module's item is checked.
        with scoped as materialized (
          select w.id, w.project_id, w.work_item_type_id, w.root_id, w.revision_no, w.outcome, w.discarded_at
          from work_item w
          join work_item_type t on t.id = w.work_item_type_id
          where w.project_id = p_project_id and t.module_key = any(p_module_keys)
            and (p_work_item_ids is null or w.root_id in (select o.root_id from work_item o where o.id = any(p_work_item_ids)))
        ), checked as materialized (
          select s.* from scoped s where app.sees_work_item(s.id)
        ), seen as materialized (
          select c.id, c.root_id from checked c
          where (p_work_item_ids is null or c.id = any(p_work_item_ids))
            and (p_all_revisions or not exists (
              select 1 from checked o
              where o.root_id = c.root_id and o.revision_no > c.revision_no and o.discarded_at is null))
        ), code_c as (
          select distinct o.root_id from checked o
          where o.discarded_at is null and o.outcome is not null
            and app.outcome_offers(o.project_id, o.work_item_type_id, o.outcome, 'offer_revision')
        ), held as (
          select distinct a.work_item_id from step_assignment a join seen on seen.id = a.work_item_id
          where a.status in ('pooled', 'picked_up', 'vacant') and a.participant_id = any(v_mine)
        ), dimensions as (
          select x.work_item_id, array_agg(x.dimension_id) as dimension_ids, array_agg(x.value_id) as value_ids
          from (
            select dv.work_item_id, dv.dimension_id, dv.dimension_value_id as value_id
            from seen
            join work_item w on w.id = seen.id
            join work_item_dimension_value dv on dv.work_item_id = w.id
            where w.built_ins_as_arrived is null or seen.id in (select held.work_item_id from held)
            union all
            select w.id, v.key::uuid, v.value::uuid
            from seen
            join work_item w on w.id = seen.id
            cross join lateral jsonb_each_text(w.built_ins_as_arrived -> 'dimensions') v
            where w.built_ins_as_arrived is not null and seen.id not in (select held.work_item_id from held)
          ) x
          group by x.work_item_id
        )
        select w.id, w.project_id, w.work_item_type_id, w.title, w.document_number, w.revision_no,
          w.outcome, w.paper_ref, w.submitted_at, w.raised_by_participant_id, w.closed_at,
          -- The holding Participant's own Step, or a closed item's terminal Step; never another Company's (V14).
          case when w.closed_at is not null or seen.id in (select held.work_item_id from held) then step.step_id end,
          step.stage_key, step.entered_at, h.participant_id, h.assignee_member_id,
          case when s.outcome_mode = 'confirm_code' then app.with_owner_review_unchecked(w.id, v_mine) end,
          seen.root_id in (select code_c.root_id from code_c),
          app.work_item_creation_date_unchecked(w.id, v_mine),
          coalesce(d.dimension_ids, '{}'), coalesce(d.value_ids, '{}'),
          holder_company.legal_name, raiser_company.legal_name
        from seen
        join work_item w on w.id = seen.id
        cross join lateral app.step_as_seen_unchecked(w.id, v_mine) step
        -- Read here only for the Owner's review label, never returned.
        join workflow_step s on s.id = step.step_id
        left join lateral (select * from app.work_item_holder_unchecked(w.id, v_mine) limit 1) h on true
        left join dimensions d on d.work_item_id = w.id
        left join participant holder on holder.id = h.participant_id
        left join company holder_company on holder_company.id = holder.company_id
        left join participant raiser on raiser.id = w.raised_by_participant_id
        left join company raiser_company on raiser_company.id = raiser.company_id;
    end
  $$;

-- 3. ------------------------------------------------------------------------------------------------------
-- From 20271123000000_event_from_step_own_participant.sql.
create or replace function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text,
    outcome text, internal_note text, changes jsonb, remarks text, recommended_code text, handover jsonb, answers jsonb,
    action_form jsonb, member_positions jsonb
  )
  language sql stable
  set search_path = pg_catalog, public
as $$
  with own as (select array(select app.current_participant_ids()) as participant_ids)
  select (row_number() over (order by e.seq))::integer, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
    tr.label,
    -- Which Step held the item is its own Participant's (V14): a Rabaed Engineer's event keeps both.
    -- The Step it left comes from app.event_transitions, which gives it for those events only.
    fs.name,
    -- The Step it reached, only where that Step is the reader's own Participant's (an assignment of theirs
    -- at it: step_assignment gives a reader its own Participant's rows only) or terminal (RP-1192).
    case when (e.actor_participant_id is null or e.actor_participant_id = any (own.participant_ids))
      and (not (ts.actor_rule ? 'base_role' or ts.actor_rule ? 'raiser')
        or exists (select 1 from step_assignment a where a.work_item_id = e.work_item_id and a.step_id = e.to_step_id))
      then ts.name end,
    -- A pool of one's `assigned` event stores why ("only_member"): its label says so.
    case when e.type <> 'assigned' then e.payload ->> 'reason' end,
    e.payload ->> 'document_number', e.payload ->> 'outcome',
    e.payload ->> 'internal_note', e.payload -> 'changes', e.payload ->> 'remarks', e.payload ->> 'recommended_code',
    -- A Handover is internal to the holding Participant (V5), so both are its own Members.
    case when e.payload ? 'handover' then jsonb_build_object(
      'from', hf.full_name, 'to', ht.full_name, 'because', e.payload -> 'handover' ->> 'because') end,
    case
      when e.type in ('transition', 'issue_code') then nullif(e.payload - 'document_number' - 'outcome', '{}'::jsonb)
      when e.type = 'internal_answers' then e.payload -> 'answers'
    end,
    -- The Action Form the answers were given in, as its Workflow Version pinned it.
    case when e.type in ('transition', 'issue_code', 'internal_answers') then tr.action_form end,
    -- A Position only for a Member of the reader's own Participant; never another Company's, the Code's signer included (V14).
    case when e.actor_member_id is not null and e.actor_participant_id = any (own.participant_ids) then coalesce(ap.positions, '[]'::jsonb) end
  from work_item_event e
  cross join own
  join work_item w on w.id = e.work_item_id
  left join app.work_item_companies(p_work_item_id) actor on actor.participant_id = e.actor_participant_id
  left join member m on m.id = e.actor_member_id
  left join app.event_transitions(array(select x.id from work_item_event x where x.work_item_id = p_work_item_id)) tr on tr.event_id = e.id
  left join workflow_step fs on fs.id = tr.from_step_id
  left join workflow_step ts on ts.id = e.to_step_id
  left join member hf on hf.id = (e.payload -> 'handover' ->> 'from_member_id')::uuid
  left join member ht on ht.id = (e.payload -> 'handover' ->> 'to_member_id')::uuid
  left join app.history_actor_positions(p_work_item_id) ap on ap.event_id = e.id
  where e.work_item_id = p_work_item_id
  order by e.seq
$$;

-- 4. ------------------------------------------------------------------------------------------------------
-- From 20270409000300_with_owner_review.sql: the Step by a left join, so another Company's item stays in.
create or replace function app.take_step_age_report(p_outbox_id uuid)
  returns table (
    to_address text, language text, project_id uuid, project_name jsonb, open_stage_keys text[],
    work_item_id uuid, document_number text, subject text, stage_name jsonb,
    held_by_own boolean, step_name jsonb, holder_name jsonb, entered_at timestamptz
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_saved text := current_setting('app.member_id', true);
      v_project uuid;
      v_member uuid;
    begin
      perform app.require_worker();
      select o.project_id, (o.payload ->> 'member_id')::uuid into v_project, v_member
      from outbox o where o.id = p_outbox_id and o.kind = 'step_age_report' and o.processed_at is null;
      if v_member is null then
        return;
      end if;
      -- A closed Project goes quiet.
      if not exists (select 1 from project p where p.id = v_project and p.status = 'active') then
        return;
      end if;
      -- Still on the Project, holding Assign.
      if not exists (
        select 1 from project_member pm
        join member m on m.id = pm.member_id and m.status = 'active'
        where pm.project_id = v_project and pm.member_id = v_member and pm.status = 'active'
          and app.project_member_holds_assign(pm.id)
      ) then
        return;
      end if;
      -- Their settings now: the group's email off, email paused, the Project muted.
      -- "Immediately" and "daily digest" both send it: the report has its own time.
      if coalesce((select r.email from app.member_notification_route(v_member, v_project, 'weekly_report', null) r), 'none') = 'none' then
        return;
      end if;

      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_member::text, true);
      return query
        select m.email, coalesce(pref.preferred_language, m.locale), pr.id, pr.name,
          array(
            select s.key from stage s
            where s.module_key = 'submittals' and s.project_id = v_project and s.category in ('draft', 'in_progress')
            order by s.sort, s.key
          ),
          i.id, i.document_number, i.title, i.stage_name, i.held_by_own, i.step_name, i.holder_name, i.entered_at
        from member m
        left join member_notification_preference pref on pref.member_id = m.id
        join project pr on pr.id = v_project
        cross join lateral (
          select w.id, w.document_number, w.title, st.name as stage_name,
            coalesce(h.participant_id in (select app.current_participant_ids()), false) as held_by_own,
            s.name as step_name, coalesce(app.with_owner_review(w.id), hc.legal_name) as holder_name, seen.entered_at
          from work_item w
          cross join lateral app.step_as_seen(w.id) seen
          -- Null for an item another Company holds: app.step_as_seen names its Step to that Company only (RP-1192).
          left join workflow_step s on s.id = seen.step_id
          join work_item_type t on t.id = w.work_item_type_id
          join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = seen.stage_key
          left join lateral (select * from app.work_item_holder(w.id) limit 1) h on true
          left join lateral (
            select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = h.participant_id
          ) hc on true
          where w.project_id = v_project and t.module_key = 'submittals'
            and st.category in ('draft', 'in_progress')
            -- An un-numbered Draft has no Step Age (scenario 76).
            and w.document_number is not null
            and app.latest_visible_revision(w.id)
        ) i
        where m.id = v_member
        order by i.entered_at, i.id;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
    end
  $$;
