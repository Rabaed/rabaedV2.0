-- An onboarding lead becomes a Participant Invitation when Rabaed onboards its
-- Company (RP-252; ADR 0009; visibility.md V9, V15, scenario 31).
--
-- * app.convert_onboarding_leads, for Rabaed Admin only: every open lead with the
--   onboarded Company's CR number becomes an Invited Participant on the lead's
--   Project, in the offered role, invited by the Project Admin who asked. The API
--   calls it in the onboarding transaction, logged in that onboarding's
--   admin_action.
-- * The Invited Participant takes the lead's id and time, so the Project Admin's
--   pending row stays exactly as it was: same id, CR number, role and time.
--   Nothing shows them that the CR number is now on Rabaed (scenario 31).
-- * The lead is closed (converted_at, participant_id) and kept for audit, read
--   only through Rabaed Admin (V9). app.project_invitations lists open leads only,
--   and none beside an invitation of its CR number, so a CR number is never
--   listed twice on a Project.
-- * Open leads whose CR number already belongs to an active Company (onboarded
--   before this migration) are converted now, with no admin_action: no Engineer
--   acted.
--
-- Not here: closing a lead that won't be onboarded (to be decided, RP-252).

alter table onboarding_lead
  add column converted_at timestamptz,
  add column participant_id uuid references participant (id),
  add constraint onboarding_lead_converted check ((converted_at is null) = (participant_id is null));

-- Converts the open leads for p_company_id's CR number, and returns each lead
-- with the Participant it became. A Company already invited to, or on, a lead's
-- Project keeps that Participant; the lead is closed onto it.
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
      for v_lead in
        select l.* from onboarding_lead l
        join company co on co.cr_number = l.cr_number and co.id = p_company_id
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

revoke all on function app.convert_onboarding_leads(uuid, timestamptz) from public;
grant execute on function app.convert_onboarding_leads(uuid, timestamptz) to rabaed_admin;

select app.convert_onboarding_leads(co.id, now())
from company co
where co.status = 'active' and co.cr_number in (select cr_number from onboarding_lead where converted_at is null);

-- The pending invitations of a Project, for its Project Admins: open leads only,
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
