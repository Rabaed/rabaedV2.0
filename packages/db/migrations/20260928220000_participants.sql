-- Participants and Project Members (RP-190).
--
-- * A Project Admin adds another Company, found by its CR number, as a
--   Participant in a Project Role. A Company appears once per Project.
-- * Only a Participant's own Authorized Person adds or removes its Project
--   Members, and only Members of their own Company. They can do so before they
--   are on the Project themselves.
-- * A Participant's Project Members list is private to that Participant's
--   Company: other Participants see the Company on the Project, never its people
--   (visibility.md V14).
--
-- As before, rabaed_app writes only through the SECURITY DEFINER functions below.

-- The acting Member's own Company's Participants that they may look into: those
-- on Projects they are a Project Member of, and, for the Authorized Person, all
-- of their Company's active Participants.
create function app.current_participant_ids() returns setof uuid
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select p.id from participant p
    where p.status = 'active'
      and p.company_id = app.current_company_id()
      and (
        p.project_id in (select app.current_project_ids())
        or p.company_id = app.current_authorized_company_id()
      )
  $$;

-- Project Members: only your own Participant's (replaces RP-189's per-Project policy).
drop policy member_reads_own_project_members on project_member;
create policy member_reads_own_participant_members on project_member for select to rabaed_app
  using (participant_id in (select app.current_participant_ids()));

-- Participants: every Participant of your Projects, plus your Company's own
-- Participants for its Authorized Person.
drop policy member_reads_own_project_participants on participant;
create policy member_reads_project_participants on participant for select to rabaed_app
  using (project_id in (select app.current_project_ids()) or id in (select app.current_participant_ids()));

-- The Participants of one of the acting Member's Projects, with each Company's
-- name (and nothing else of the Company: its CR and VAT numbers stay private).
-- No rows for a Project they are not on.
create function app.project_participants(p_project_id uuid)
  returns table (participant_id uuid, company_id uuid, legal_name jsonb, base_role text, role_name jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select p.id, co.id, co.legal_name, r.base_role, r.name
    from participant p
    join company co on co.id = p.company_id
    join project_role r on r.id = p.project_role_id
    where p.project_id = p_project_id and p.status = 'active'
      and p_project_id in (select app.current_project_ids())
    order by p.created_at, p.id
  $$;

-- The acting Authorized Person's Company's Participants, with each Project's
-- number, code and name. Anyone else is refused (42501).
create function app.company_participants()
  returns table (participant_id uuid, project_id uuid, project_number integer, code text, name jsonb, base_role text, role_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      -- Checked up front, so the refusal doesn't depend on there being rows.
      v_company_id uuid := app.require_authorized_company_id();
    begin
      return query
        select p.id, pr.id, pr.project_number, pr.code, pr.name, r.base_role, r.name
        from participant p
        join project pr on pr.id = p.project_id
        join project_role r on r.id = p.project_role_id
        where p.company_id = v_company_id and p.status = 'active'
        order by p.created_at desc, p.id desc;
    end
  $$;

-- One of the acting Member's own Company's Participants that they may look into
-- (see app.current_participant_ids), with its Project; no row otherwise.
create function app.participation(p_participant_id uuid)
  returns table (participant_id uuid, project_id uuid, project_number integer, code text, name jsonb, base_role text, role_name jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select p.id, pr.id, pr.project_number, pr.code, pr.name, r.base_role, r.name
    from participant p
    join project pr on pr.id = p.project_id
    join project_role r on r.id = p.project_role_id
    where p.id = p_participant_id and p.id in (select app.current_participant_ids())
  $$;

-- A Project Admin adds a Company as a Participant in the Rabaed default role for
-- p_base_role. Outcome: 'added' (with the Participant), 'not_found' (not one of
-- the acting Member's Projects), 'unknown_company' or 'already_participant'.
-- A Project Member who is not a Project Admin is refused (42501).
create function app.add_participant(p_project_id uuid, p_cr_number text, p_base_role text)
  returns table (outcome text, participant_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_company_id uuid;
      v_role_id uuid;
      v_participant_id uuid;
    begin
      if not exists (select 1 from app.current_project_ids() x where x = p_project_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if not exists (
        select 1 from project_admin where project_id = p_project_id and member_id = app.current_member_id()
      ) then
        raise exception 'only a Project Admin can add Participants' using errcode = '42501';
      end if;

      select id into v_company_id from company where cr_number = trim(p_cr_number) and status = 'active';
      if v_company_id is null then
        return query select 'unknown_company'::text, null::uuid;
        return;
      end if;
      select id into v_role_id from project_role where owner_kind = 'rabaed' and base_role = p_base_role;
      if v_role_id is null then
        raise exception 'unknown base role %', p_base_role using errcode = '22023';
      end if;

      insert into participant (project_id, company_id, project_role_id)
      values (p_project_id, v_company_id, v_role_id)
      on conflict (project_id, company_id) do nothing
      returning id into v_participant_id;
      if v_participant_id is null then
        return query select 'already_participant'::text, null::uuid;
        return;
      end if;
      return query select 'added'::text, v_participant_id;
    end
  $$;

-- The Participant's Authorized Person adds a Member of their own Company to the
-- Project (again, if they were removed). Outcome: 'added', 'not_found' (not one
-- of their Company's Participants) or 'member_not_found' (not an invited or
-- active Member of their Company). Anyone but an Authorized Person is refused (42501).
create function app.add_project_member(p_participant_id uuid, p_member_id uuid) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_project_id uuid;
    begin
      select project_id into v_project_id from participant
      where id = p_participant_id and company_id = v_company_id and status = 'active';
      if v_project_id is null then
        return 'not_found';
      end if;
      if not exists (
        select 1 from member where id = p_member_id and company_id = v_company_id and status in ('invited', 'active')
      ) then
        return 'member_not_found';
      end if;

      insert into project_member as pm (project_id, participant_id, member_id)
      values (v_project_id, p_participant_id, p_member_id)
      on conflict (participant_id, member_id) do update
        set status = 'active', removed_at = null, updated_at = now()
        where pm.status = 'removed';
      return 'added';
    end
  $$;

-- The Participant's Authorized Person removes a Project Member: their access to
-- the Project ends at once. Outcome: 'removed', 'not_found' or 'member_not_found'
-- (not on the Project through this Participant).
create function app.remove_project_member(p_participant_id uuid, p_member_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_at timestamptz := greatest(p_now, now());
    begin
      if not exists (
        select 1 from participant where id = p_participant_id and company_id = v_company_id and status = 'active'
      ) then
        return 'not_found';
      end if;
      update project_member set status = 'removed', removed_at = v_at, updated_at = v_at
      where participant_id = p_participant_id and member_id = p_member_id and status = 'active';
      if not found then
        return 'member_not_found';
      end if;
      return 'removed';
    end
  $$;

revoke all on function
  app.current_participant_ids(),
  app.project_participants(uuid),
  app.company_participants(),
  app.participation(uuid),
  app.add_participant(uuid, text, text),
  app.add_project_member(uuid, uuid),
  app.remove_project_member(uuid, uuid, timestamptz)
  from public;
grant execute on function
  app.current_participant_ids(),
  app.project_participants(uuid),
  app.company_participants(),
  app.participation(uuid),
  app.add_participant(uuid, text, text),
  app.add_project_member(uuid, uuid),
  app.remove_project_member(uuid, uuid, timestamptz)
  to rabaed_app;
