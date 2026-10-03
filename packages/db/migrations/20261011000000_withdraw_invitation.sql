-- A Project Admin withdraws a pending invitation, and Rabaed closes onboarding
-- leads for its own housekeeping (RP-260; ADR 0009, "Pending invitations and
-- leads"; visibility.md scenario 38).
--
-- * app.withdraw_invitation takes any row of the Project Admin's pending list
--   off it: an invitation to a Company on Rabaed (pending or declined) or an
--   onboarding lead. Both kinds are found the same way, through
--   app.project_invitations, and give the same outcome, so withdrawing reveals
--   nothing about which CR numbers are Companies on Rabaed. Anyone else, and
--   anything not on that list, gets 'not_found', like an id that doesn't exist.
-- * A withdrawn invitation to a Company leaves its Authorized Person's list
--   (status 'invitation_withdrawn'; app.company_invitations shows 'invited'
--   only). A withdrawn lead is never converted when its Company is onboarded,
--   and leaves Rabaed Admin's list. Both are kept for audit.
-- * The same CR number can be invited again: app.add_participant reopens the
--   withdrawn row, keeping its id, for both kinds alike. A withdrawn lead whose
--   Company Rabaed onboarded since becomes that Company's invitation, with the
--   lead's id, as a conversion would have made it.
-- * Rabaed Admin closes a lead (closed_at, with the reason in admin_action). That
--   only takes it off Rabaed's own list: the Project Admin's row stays exactly as
--   it was (its time is the lead's updated_at, which closing leaves alone), and
--   if Rabaed onboards the Company after all, the lead still becomes its
--   invitation. Inviting the CR number again opens the lead again.

alter table participant drop constraint participant_status_check;
alter table participant add constraint participant_status_check
  check (status in ('invited', 'declined', 'invitation_withdrawn', 'active', 'withdrawn'));
alter table participant drop constraint participant_ordinal_when_joined;
alter table participant add constraint participant_ordinal_when_joined
  check (ordinal is not null or status in ('invited', 'declined', 'invitation_withdrawn'));
alter table participant add column withdrawn_by_member_id uuid references member (id);

alter table onboarding_lead
  add column withdrawn_at timestamptz,
  add column withdrawn_by_member_id uuid references member (id),
  add column closed_at timestamptz,
  add constraint onboarding_lead_withdrawn check ((withdrawn_at is null) = (withdrawn_by_member_id is null));

alter table admin_action drop constraint admin_action_action_check;
alter table admin_action add constraint admin_action_action_check
  check (action in ('onboard_company', 'read_onboarding_leads', 'invite_authorized_person', 'close_onboarding_lead'));

-- The pending invitations of a Project, for its Project Admins: withdrawn ones
-- left out, closed leads kept (otherwise as in the onboarding_lead_conversion
-- migration).
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
      where l.project_id = p_project_id and l.converted_at is null and l.withdrawn_at is null
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

-- A Project Admin withdraws one of the Project's pending invitations, whichever
-- kind it is. Outcome: 'withdrawn', 'not_found' (not on the acting Member's
-- pending list for this Project, which only its Project Admins have) or
-- 'project_closed'.
create function app.withdraw_invitation(p_project_id uuid, p_invitation_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_cr_number text;
      v_leads integer;
      v_invitations integer;
    begin
      select i.cr_number into v_cr_number from app.project_invitations(p_project_id) i where i.invitation_id = p_invitation_id;
      if v_cr_number is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      -- Onboarding the Company converts its leads under this lock, and an answer
      -- locks the invitation's row, so each update below sees where things stand.
      perform app.lock_cr_number(v_cr_number);
      update onboarding_lead
      set withdrawn_at = v_at, withdrawn_by_member_id = app.current_member_id(), updated_at = v_at
      where id = p_invitation_id and project_id = p_project_id and converted_at is null and withdrawn_at is null;
      get diagnostics v_leads = row_count;
      update participant
      set status = 'invitation_withdrawn', withdrawn_at = v_at, withdrawn_by_member_id = app.current_member_id(),
        updated_at = v_at
      where id = p_invitation_id and project_id = p_project_id and status in ('invited', 'declined');
      get diagnostics v_invitations = row_count;
      -- Answered or converted in the meantime: no longer the pending row the Project Admin saw.
      return case when v_leads + v_invitations > 0 then 'withdrawn' else 'not_found' end;
    end
  $$;

-- Converts the open leads for p_company_id's CR number on active Projects, but
-- never a withdrawn one (otherwise as in the onboarding_lead_conversion
-- migration). A closed lead is converted: its Project Admin's invitation stands.
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

-- A Project Admin invites a Company by its CR number. Inviting again reopens a
-- withdrawn invitation or lead, and a closed lead, keeping its id; a withdrawn
-- lead whose Company is now on Rabaed becomes its invitation with that id
-- (otherwise as in the onboarding_lead_conversion migration).
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

      if exists (
        select 1 from participant
        where project_id = p_project_id and company_id = v_company_id and status in ('active', 'withdrawn')
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
        coalesce(v_lead_id, app.uuid_v7()), p_project_id, v_company_id, v_role_id, 'invited', app.current_member_id(),
        v_at, v_at, v_at
      )
      on conflict (project_id, company_id) do update
        set status = 'invited', project_role_id = excluded.project_role_id,
          invited_by_member_id = excluded.invited_by_member_id, invited_at = v_at, responded_at = null,
          withdrawn_at = null, withdrawn_by_member_id = null, updated_at = v_at
        where p.status in ('invited', 'declined', 'invitation_withdrawn')
      returning p.id into v_participant_id;
      if v_lead_id is not null and v_participant_id = v_lead_id then
        update onboarding_lead set converted_at = v_at, participant_id = v_lead_id, updated_at = v_at
        where id = v_lead_id;
      end if;
      return 'invited';
    end
  $$;

revoke all on function app.withdraw_invitation(uuid, uuid, timestamptz) from public;
grant execute on function app.withdraw_invitation(uuid, uuid, timestamptz) to rabaed_app;
