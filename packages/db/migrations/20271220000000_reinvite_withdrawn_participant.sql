-- RP-1261: a withdrawn Company invited again comes back as a fresh Participant (ADR 0028: "A withdrawn
-- Company comes back only through a new Invitation"; visibility.md "A Participant's withdrawal";
-- data-model.md "Withdrawn Participant"; scenarios RP-1261-1 to RP-1261-3).
--
-- * A fresh Participant is a new `participant` row, with a new id, beside the withdrawn one. The
--   withdrawn row is never changed again: its Cancelled items (raised_by_participant_id), its
--   Vacancies (step_assignment.participant_id) and its Members' links (project_member.participant_id)
--   all point at its id, and every read gives a Member only their active Participants
--   (app.current_participant_ids, app.current_project_ids, app.sees_work_item). So nothing of the
--   earlier participation reopens: its items stay Cancelled, its Vacancies stay Vacancies of the
--   withdrawn row (none passes to the new one, though it has the same role), and its Members read
--   only what reaches the new Participant. Re-activating the old row would have given back all of it.
-- * `participant_project_company_key`, unique (project_id, company_id), becomes a unique index over
--   the rows that are not withdrawn: a Company has at most one live row on a Project (invited,
--   declined, invitation_withdrawn or active) and any number of withdrawn ones. The two functions
--   that insert on it name the index's predicate in their `on conflict`.
-- * app.add_participant: a withdrawn row is no longer `already_participant`; the new invitation is a
--   new row (otherwise as in 20271027000000_participant_invitation_email.sql).
-- * app.convert_onboarding_leads: the same `on conflict`, and a lead converts onto the live row only
--   (otherwise as in 20261011000000_withdraw_invitation.sql).
-- * A withdrawal leaves its Members' project_member rows active (the withdrawal email reads them), so a
--   Member back through the new Participant has two. The reads that took a Member's rows on a Project
--   without asking whether their Participant is active now ask it, so the withdrawn link counts for
--   nothing, each rebuilt from its newest body: app.holds_assign_permission and app.enqueue_step_age_reports
--   (20261216100000_notification_helpers.sql), app.my_visibility (20261108000000_plpgsql_definer_helpers.sql)
--   and app.take_step_age_report (20271126000000_step_hidden_outside_holder.sql). Every other such read already asks it (app.acting_project_member,
--   app.current_project_ids, app.sees_work_item…), and the api reads project_member through its row-level
--   security, which gives only active Participants' rows.
-- E2 (Signatory Access) is RP-614's: not built yet.

-- One live row per Company on a Project --------------------------------------------------------

alter table participant drop constraint participant_project_company_key;
create unique index participant_project_company_key on participant (project_id, company_id) where status <> 'withdrawn';

-- Inviting a withdrawn Company again ----------------------------------------------------------

create or replace function app.add_participant(p_project_id uuid, p_cr_number text, p_base_role text, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_cr_number text := trim(p_cr_number);
      v_company_id uuid;
      v_role_id uuid;
      v_lead_id uuid;
      v_participant_id uuid;
    begin
      if not exists (select 1 from app.current_project_ids() x where x = p_project_id) then
        return 'not_found';
      end if;
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        raise exception 'only a Project Admin can invite Participants' using errcode = '42501';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      select id into v_role_id from project_role where owner_kind = 'rabaed' and base_role = p_base_role;
      if v_role_id is null then
        raise exception 'unknown base role %', p_base_role using errcode = '22023';
      end if;

      -- Onboarding the Company with this CR number converts its leads under the
      -- same lock, so a lead is never written after that conversion looked.
      perform app.lock_cr_number(v_cr_number);
      select id into v_company_id from company where cr_number = v_cr_number and status = 'active';
      if v_company_id is null then
        insert into onboarding_lead as l (cr_number, project_id, project_role_id, requested_by_member_id, created_at, updated_at)
        values (v_cr_number, p_project_id, v_role_id, app.current_member_id(), v_at, v_at)
        on conflict (project_id, cr_number) do update
          set project_role_id = excluded.project_role_id, requested_by_member_id = excluded.requested_by_member_id,
            withdrawn_at = null, withdrawn_by_member_id = null, closed_at = null, updated_at = v_at
          -- A converted lead is kept as it was, for audit.
          where l.converted_at is null;
        return 'invited';
      end if;

      -- A withdrawn Company is invited again as any Company is: its withdrawn row stays as it was,
      -- and the invitation is a new row (RP-1261).
      if exists (
        select 1 from participant
        where project_id = p_project_id and company_id = v_company_id and status = 'active'
      ) then
        return 'already_participant';
      end if;
      -- A lead for this CR number that was never converted (withdrawn before
      -- Rabaed onboarded the Company): the new invitation takes its id, as a
      -- conversion would, so the Project Admin's row keeps its id (scenario 31).
      select l.id into v_lead_id from onboarding_lead l
      where l.project_id = p_project_id and l.cr_number = v_cr_number and l.converted_at is null
      for update;
      insert into participant as p
        (id, project_id, company_id, project_role_id, status, invited_by_member_id, invited_at, created_at, updated_at)
      values (
        coalesce(v_lead_id, gen_random_uuid()), p_project_id, v_company_id, v_role_id, 'invited', app.current_member_id(),
        v_at, v_at, v_at
      )
      on conflict (project_id, company_id) where status <> 'withdrawn' do update
        set status = 'invited', project_role_id = excluded.project_role_id,
          invited_by_member_id = excluded.invited_by_member_id, invited_at = v_at, responded_at = null,
          withdrawn_at = null, withdrawn_by_member_id = null, updated_at = v_at
        where p.status in ('invited', 'declined', 'invitation_withdrawn')
      returning p.id into v_participant_id;
      if v_lead_id is not null and v_participant_id = v_lead_id then
        update onboarding_lead set converted_at = v_at, participant_id = v_lead_id, updated_at = v_at
        where id = v_lead_id;
      end if;
      -- The invited Company's Authorized Person is emailed later, by the worker (RP-1072).
      insert into outbox (kind, project_id, payload)
      values ('participant_invitation', p_project_id, jsonb_build_object('participantId', v_participant_id, 'invitedAt', v_at));
      return 'invited';
    end
  $$;

-- Converts the open leads for p_company_id's CR number on active Projects, but never a withdrawn
-- one; a lead converts onto its Company's live row on the Project, never a withdrawn one (otherwise
-- as in the withdraw_invitation migration).
create or replace function app.convert_onboarding_leads(p_company_id uuid, p_now timestamptz)
  returns table (lead_id uuid, participant_id uuid, project_id uuid)
  language plpgsql volatile security invoker
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_lead record;
      v_participant_id uuid;
    begin
      perform app.lock_cr_number((select cr_number from company where id = p_company_id));
      for v_lead in
        select l.* from onboarding_lead l
        join company co on co.cr_number = l.cr_number and co.id = p_company_id
        join project pr on pr.id = l.project_id and pr.status = 'active'
        where l.converted_at is null and l.withdrawn_at is null
        order by l.created_at, l.id
        for update of l
      loop
        insert into participant (
          id, project_id, company_id, project_role_id, status, invited_by_member_id, invited_at, created_at, updated_at
        ) values (
          v_lead.id, v_lead.project_id, p_company_id, v_lead.project_role_id, 'invited', v_lead.requested_by_member_id,
          v_lead.updated_at, v_at, v_at
        )
        on conflict (project_id, company_id) where status <> 'withdrawn' do nothing
        returning id into v_participant_id;
        if v_participant_id is null then
          select p.id into v_participant_id from participant p
          where p.project_id = v_lead.project_id and p.company_id = p_company_id and p.status <> 'withdrawn';
        end if;
        update onboarding_lead set converted_at = v_at, participant_id = v_participant_id, updated_at = v_at
        where id = v_lead.id;
        lead_id := v_lead.id;
        participant_id := v_participant_id;
        project_id := v_lead.project_id;
        return next;
      end loop;
    end
  $$;

-- A Member's link to a withdrawn Participant counts for nothing ---------------------------------

-- Whether the acting Member holds Assign on any of their Projects, through an active Participant.
create or replace function app.holds_assign_permission() returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from project_member pm
        join participant p on p.id = pm.participant_id and p.status = 'active'
        where pm.member_id = app.current_member_id() and pm.status = 'active'
          and pm.project_id in (select app.current_project_ids())
          and app.project_member_holds_assign(pm.id)
      );
    end
  $$;

-- The values the acting Member covers on Project p_project_id, through their active Participant.
create or replace function app.my_visibility(p_project_id uuid) returns table(kind text, value_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, c.id
        from project_member pm
        join participant p on p.id = pm.participant_id and p.status = 'active'
        join visibility_dimension d on d.project_id = pm.project_id
        cross join lateral app.values_covered_by_project_member(pm.id, d.id) as c (id)
        where pm.project_id = p_project_id and pm.member_id = app.current_member_id() and pm.status = 'active'
          and p_project_id in (select app.current_project_ids());
    end
  $$;

-- One weekly report per Member holding Assign on an active Project, through an active Participant.
create or replace function app.enqueue_step_age_reports() returns integer
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
      join participant pa on pa.id = pm.participant_id and pa.status = 'active'
      join project p on p.id = pm.project_id and p.status = 'active'
      join member m on m.id = pm.member_id and m.status = 'active'
      where pm.status = 'active' and app.project_member_holds_assign(pm.id);
      get diagnostics v_count = row_count;
      return v_count;
    end
  $$;

-- As in 20271126000000_step_hidden_outside_holder.sql, with "still on the Project, holding Assign"
-- asked of an active Participant's link only.
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
      -- Still on the Project, holding Assign, through an active Participant.
      if not exists (
        select 1 from project_member pm
        join participant pa on pa.id = pm.participant_id and pa.status = 'active'
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
