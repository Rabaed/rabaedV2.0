-- The weekly Step Age report (RP-359, spec RP-344; visibility.md the Step Age
-- reports row and scenario 21; workflow-engine.md §10).
--
-- * The worker's scheduled job (RP-358's mechanism), at 07:00 Riyadh time on
--   Sunday, writes one outbox row of kind 'step_age_report' per active Project
--   and active Member holding the `assign` Function Permission there, in any
--   Module, as app.holds_assign_permission, which shows them the "Weekly
--   report" setting (app.enqueue_step_age_reports). The outbox's retries and
--   dead letters apply to each report on its own.
-- * At send time, app.take_step_age_report checks again and returns nothing
--   when the report must not go: the Project is no longer active, the Member
--   left it or no longer holds Assign, or their settings don't email the
--   "Weekly report" group (its email off, email paused, the Project muted).
-- * Its items are read as the recipient, exactly as the List reads them
--   (apps/api work-items/query.ts): their visible open items of the Module,
--   the latest Revision of each chain they see (app.latest_visible_revision),
--   with the Step, Stage and Step Age of app.step_as_seen, so another Company's
--   item counts from when it reached that Company and its internal moves stay
--   its own (V14). For a Contractor or Consultant that is their Participant's
--   items; for an Owner or Owner Representative, the items they oversee. "With"
--   names another Company by name only. No items: no email.

-- One outbox row per recipient of the week's report. The worker only.
create function app.enqueue_step_age_reports() returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_count integer;
    begin
      perform app.require_worker();
      insert into outbox (kind, project_id, payload)
      select distinct 'step_age_report', pm.project_id, jsonb_build_object('member_id', pm.member_id)
      from project_member pm
      join project p on p.id = pm.project_id and p.status = 'active'
      join member m on m.id = pm.member_id and m.status = 'active'
      join project_member_position mp on mp.project_member_id = pm.id
      join position_permission pp on pp.position_id = mp.position_id and pp.permission = 'assign'
      where pm.status = 'active';
      get diagnostics v_count = row_count;
      return v_count;
    end
  $$;

-- The report of an outbox row of kind 'step_age_report', as its recipient may
-- see it now: one row per item, oldest at its Step first (the List's own
-- order), each with the recipient, their language, the Project and its open
-- Stages (for the link to the List). No rows when it must not be sent, or it
-- has no items. The worker only.
create function app.take_step_age_report(p_outbox_id uuid)
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
        join project_member_position mp on mp.project_member_id = pm.id
        join position_permission pp on pp.position_id = mp.position_id and pp.permission = 'assign'
        where pm.project_id = v_project and pm.member_id = v_member and pm.status = 'active'
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
            where s.module_key = 'submittals' and s.project_id is null and s.category in ('draft', 'in_progress')
            order by s.sort, s.key
          ),
          i.id, i.document_number, i.title, i.stage_name, i.held_by_own, i.step_name, i.holder_name, i.entered_at
        from member m
        left join member_notification_preference pref on pref.member_id = m.id
        join project pr on pr.id = v_project
        cross join lateral (
          select w.id, w.document_number, w.title, st.name as stage_name,
            coalesce(h.participant_id in (select app.current_participant_ids()), false) as held_by_own,
            s.name as step_name, hc.legal_name as holder_name, seen.entered_at
          from work_item w
          cross join lateral app.step_as_seen(w.id) seen
          join workflow_step s on s.id = seen.step_id
          join work_item_type t on t.id = w.work_item_type_id
          join stage st on st.module_key = t.module_key and st.key = seen.stage_key and st.project_id is null
          left join lateral (select * from app.work_item_holder(w.id) limit 1) h on true
          left join lateral (
            select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = h.participant_id
          ) hc on true
          where w.project_id = v_project and t.module_key = 'submittals'
            and st.category in ('draft', 'in_progress')
            and app.latest_visible_revision(w.id)
        ) i
        where m.id = v_member
        order by i.entered_at, i.id;
      perform set_config('app.member_id', '', true);
    end
  $$;

revoke all on function app.enqueue_step_age_reports(), app.take_step_age_report(uuid) from public;
-- The worker connects as the app role; app.require_worker refuses a Member's session.
grant execute on function app.enqueue_step_age_reports(), app.take_step_age_report(uuid) to rabaed_app;
