-- An onboarding lead becomes a Participant Invitation when Rabaed onboards its
-- Company (RP-252; ADR 0009; visibility.md V9, V15, scenario 31).
--
-- * app.convert_onboarding_leads, for Rabaed Admin only (security invoker, granted
--   to rabaed_admin alone, so the app role can't reach it): every open lead with the
--   onboarded Company's CR number becomes an Invited Participant on the lead's
--   Project, in the offered role, invited by the Project Admin who asked. The API
--   calls it in the onboarding transaction, logged in that onboarding's
--   admin_action.
-- * The Invited Participant takes the lead's id and time, so the Project Admin's
--   pending row stays exactly as it was: same id, CR number, role and time.
--   Nothing shows them that the CR number is now on Rabaed (scenario 31).
-- * The lead is marked converted (converted_at, participant_id) and kept for
--   audit, read only through Rabaed Admin (V9). app.project_invitations lists
--   unconverted leads only, and none beside an invitation of its CR number, so a
--   CR number is never listed twice on a Project.
-- * Open leads whose CR number already belongs to an active Company (onboarded
--   before this migration) are converted now, with no admin_action: no Engineer
--   acted.
-- * app.add_participant and the conversion take the same lock on the CR number,
--   so a lead written while its Company is being onboarded is converted too.
--   Leads on a closed Project are left as they are, as add_participant refuses one.
--
-- Not here: closing a lead that won't be onboarded (to be decided, RP-256).
-- converted_at records the conversion only, not any other way a lead may close.

alter table onboarding_lead
  add column converted_at timestamptz,
  add column participant_id uuid references participant (id),
  add constraint onboarding_lead_converted check ((converted_at is null) = (participant_id is null));

-- Serialises inviting a CR number with onboarding the Company that has it, until
-- the transaction ends.
create function app.lock_cr_number(p_cr_number text) returns void
  language sql volatile
  set search_path = pg_catalog, public
  as $$
    select pg_advisory_xact_lock(hashtextextended('cr_number/' || p_cr_number, 0))
  $$;

-- Converts the open leads for p_company_id's CR number on active Projects, and
-- returns each lead with the Participant it became. A Company already invited
-- to, or on, a lead's Project keeps that Participant; the lead is marked
-- converted onto it.
create function app.convert_onboarding_leads(p_company_id uuid, p_now timestamptz)
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
        where l.converted_at is null
        order by l.created_at, l.id
        for update of l
      loop
        insert into participant (
          id, project_id, company_id, project_role_id, status, invited_by_member_id, invited_at, created_at, updated_at
        ) values (
          v_lead.id, v_lead.project_id, p_company_id, v_lead.project_role_id, 'invited', v_lead.requested_by_member_id,
          v_lead.updated_at, v_at, v_at
        )
        on conflict (project_id, company_id) do nothing
        returning id into v_participant_id;
        if v_participant_id is null then
          select p.id into v_participant_id from participant p
          where p.project_id = v_lead.project_id and p.company_id = p_company_id;
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

revoke all on function app.lock_cr_number(text), app.convert_onboarding_leads(uuid, timestamptz) from public;
grant execute on function app.lock_cr_number(text), app.convert_onboarding_leads(uuid, timestamptz) to rabaed_admin;

select app.convert_onboarding_leads(co.id, now())
from company co
where co.status = 'active' and co.cr_number in (select cr_number from onboarding_lead where converted_at is null);

-- A Project Admin invites a Company by its CR number, under the CR number's lock,
-- never changing a converted lead (otherwise as in the participant_invitations
-- migration).
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
            updated_at = v_at
          -- A converted lead is kept as it was, for audit.
          where l.converted_at is null;
        return 'invited';
      end if;

      if exists (
        select 1 from participant
        where project_id = p_project_id and company_id = v_company_id and status in ('active', 'withdrawn')
      ) then
        return 'already_participant';
      end if;
      insert into participant as p
        (project_id, company_id, project_role_id, status, invited_by_member_id, invited_at, created_at, updated_at)
      values (p_project_id, v_company_id, v_role_id, 'invited', app.current_member_id(), v_at, v_at, v_at)
      on conflict (project_id, company_id) do update
        set status = 'invited', project_role_id = excluded.project_role_id,
          invited_by_member_id = excluded.invited_by_member_id, invited_at = v_at, responded_at = null, updated_at = v_at
        where p.status in ('invited', 'declined');
      return 'invited';
    end
  $$;

-- The pending invitations of a Project, for its Project Admins: unconverted leads only,
-- since a converted one is listed as the invitation it became, and never a lead
-- beside an invitation of the same CR number (otherwise as in the
-- participant_invitations migration).
create or replace function app.project_invitations(p_project_id uuid)
  returns table (invitation_id uuid, cr_number text, base_role text, role_name jsonb, invited_at timestamptz)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select x.id, x.cr_number, r.base_role, r.name, x.at
    from (
      select p.id, co.cr_number, p.project_role_id, p.invited_at as at
      from participant p join company co on co.id = p.company_id
      where p.project_id = p_project_id and p.status in ('invited', 'declined')
      union all
      select l.id, l.cr_number, l.project_role_id, l.updated_at
      from onboarding_lead l
      where l.project_id = p_project_id and l.converted_at is null
        -- A lead written while its Company was being onboarded: once that Company
        -- is invited, the invitation alone is listed.
        and not exists (
          select 1 from participant p join company co on co.id = p.company_id
          where p.project_id = l.project_id and co.cr_number = l.cr_number
        )
    ) x
    join project_role r on r.id = x.project_role_id
    where p_project_id in (select app.current_admin_project_ids())
    order by x.at desc, x.id desc
  $$;
