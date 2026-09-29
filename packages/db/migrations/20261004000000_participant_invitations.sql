-- Participant Invitations with consent, and a uniform answer to a CR number
-- (RP-224; ADR 0009; visibility.md V15, scenarios 30 and 31).
--
-- * A Participant Invitation, by CR number, no longer makes a Company a Participant. A
--   Company on Rabaed gets an Invited Participant; a CR number that isn't on
--   Rabaed becomes an onboarding lead for Rabaed Admin. The Project Admin gets
--   the same answer either way, so nothing reveals whether a CR number is a
--   Rabaed customer.
-- * The invited Company's Authorized Person sees the invitation (Project name,
--   Host Company, offered Project Role) and accepts or declines it. Only on
--   acceptance is the Company Active, and so anywhere in the Project. A
--   declined invitation is kept for audit and shown to nobody.
-- * The Project Admin sees their pending invitations by CR number, both kinds
--   alike, never with a Company's name. A declined invitation stays pending for
--   them, like a CR number that isn't on Rabaed, so a decline doesn't reveal a
--   customer either; only an acceptance (the Company's consent) does.
--
-- Every existing read already keeps to Active Participants (app.current_participant_ids,
-- app.project_participants, the Visibility and Work Item functions), so an
-- Invited or Declined Participant stays out of all of them.

alter table participant drop constraint participant_status_check;
alter table participant add constraint participant_status_check
  check (status in ('invited', 'declined', 'active', 'withdrawn'));
alter table participant
  add column invited_by_member_id uuid references member (id),
  add column invited_at timestamptz,
  add column responded_at timestamptz;

-- A Participant's ordinal (in its Document Numbers) is set when it becomes
-- Active, so pending and declined invitations leave no gaps in it.
alter table participant alter column ordinal drop not null;
alter table participant add constraint participant_ordinal_when_joined
  check (ordinal is not null or status in ('invited', 'declined'));

create or replace function app.number_participant() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if new.status <> 'active' or new.ordinal is not null then
        return new;
      end if;
      -- Concurrent additions to one Project queue up on its row.
      perform 1 from project where id = new.project_id for update;
      select coalesce(max(ordinal), 0) + 1 into new.ordinal from participant where project_id = new.project_id;
      return new;
    end
  $$;
drop trigger participant_ordinal on participant;
create trigger participant_ordinal before insert or update of status on participant
  for each row execute function app.number_participant();

-- Project Admins see every Participant that joined, never an invitation: those
-- only through app.project_invitations, which shows no Company.
drop policy member_reads_own_or_administered_participants on participant;
create policy member_reads_own_or_administered_participants on participant for select to rabaed_app
  using (
    id in (select app.current_participant_ids())
    or (project_id in (select app.current_admin_project_ids()) and status in ('active', 'withdrawn'))
  );

-- A CR number a Project Admin invited that isn't on Rabaed: Rabaed contacts the
-- Host Company to onboard it. Read only through Rabaed Admin (V9).
create table onboarding_lead (
  id uuid primary key default app.uuid_v7(),
  cr_number text not null,
  project_id uuid not null references project (id),
  project_role_id uuid not null references project_role (id),
  requested_by_member_id uuid not null references member (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_lead_project_cr_key unique (project_id, cr_number)
);
alter table onboarding_lead enable row level security;
revoke all on onboarding_lead from rabaed_app;

alter table admin_action drop constraint admin_action_action_check;
alter table admin_action add constraint admin_action_action_check
  check (action in ('onboard_company', 'read_onboarding_leads'));
-- A read of a list has no single target.
alter table admin_action alter column target_id drop not null;

-- A Project Admin invites a Company, by its CR number, in the Rabaed default role
-- for p_base_role. Outcome: 'invited' for a Company on Rabaed and for a CR
-- number that isn't alike (inviting again changes the offered role), or
-- 'not_found' (not one of the acting Member's Projects), 'project_closed', or
-- 'already_participant' (it joined already: every Project Admin sees it).
-- A Project Member who is not a Project Admin is refused (42501).
drop function app.add_participant(uuid, text, text);
create function app.add_participant(p_project_id uuid, p_cr_number text, p_base_role text, p_now timestamptz)
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

      select id into v_company_id from company where cr_number = v_cr_number and status = 'active';
      if v_company_id is null then
        insert into onboarding_lead as l (cr_number, project_id, project_role_id, requested_by_member_id, created_at, updated_at)
        values (v_cr_number, p_project_id, v_role_id, app.current_member_id(), v_at, v_at)
        on conflict (project_id, cr_number) do update
          set project_role_id = excluded.project_role_id, requested_by_member_id = excluded.requested_by_member_id,
            updated_at = v_at;
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

-- The pending invitations of a Project, for its Project Admins: the Companies
-- invited (declined ones too, see above) and the CR numbers that aren't on
-- Rabaed, alike, each by its CR number and offered role and never with a
-- Company's name. No rows for anyone else, not even the Project's other
-- Members.
create function app.project_invitations(p_project_id uuid)
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
      where l.project_id = p_project_id
    ) x
    join project_role r on r.id = x.project_role_id
    where p_project_id in (select app.current_admin_project_ids())
    order by x.at desc, x.id desc
  $$;

-- The acting Authorized Person's Company's pending invitations: each Project's
-- name, its Host Company's name and the offered Project Role, and nothing else
-- of the Project. Anyone else is refused (42501).
create function app.company_invitations()
  returns table (participant_id uuid, project_name jsonb, host_name jsonb, base_role text, role_name jsonb, invited_at timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_company_id uuid := app.require_authorized_company_id();
    begin
      return query
        select p.id, pr.name, host.legal_name, r.base_role, r.name, p.invited_at
        from participant p
        join project pr on pr.id = p.project_id and pr.status = 'active'
        join company host on host.id = pr.host_company_id
        join project_role r on r.id = p.project_role_id
        where p.company_id = v_company_id and p.status = 'invited'
        order by p.invited_at desc, p.id desc;
    end
  $$;

-- The invited Company's Authorized Person accepts (the Company becomes an Active
-- Participant in the offered role) or declines (nothing changes on the Project).
-- Outcome: 'accepted', 'declined', 'not_found' (not a pending invitation of
-- their Company) or 'project_closed'. Anyone else is refused (42501).
create function app.respond_to_invitation(p_participant_id uuid, p_accept boolean, p_now timestamptz) returns text
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
      return case when p_accept then 'accepted' else 'declined' end;
    end
  $$;

revoke all on function
  app.add_participant(uuid, text, text, timestamptz),
  app.project_invitations(uuid),
  app.company_invitations(),
  app.respond_to_invitation(uuid, boolean, timestamptz)
  from public;
grant execute on function
  app.add_participant(uuid, text, text, timestamptz),
  app.project_invitations(uuid),
  app.company_invitations(),
  app.respond_to_invitation(uuid, boolean, timestamptz)
  to rabaed_app;
