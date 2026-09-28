-- Projects and participation (data-model.md §2; RP-189).
--
-- The Project is the tenancy boundary (ADR 0007). This migration sets the
-- pattern every later Project-owned table follows:
-- * the table carries project_id (project itself: id), and
-- * RLS lets rabaed_app read a row only when app.current_project_ids() holds
--   its project_id: the Projects the acting Member is an active Project Member of.
-- The seam-2 suite checks every table with a project_id column automatically.
--
-- rabaed_app gets no direct writes here: a Project is created through
-- app.create_project, which checks the Project Creator flag.
--
-- Deferred to the tickets that need them (data-model.md §2–3): project's
-- planned_completion, record_language, origin and tender_ref, and the trade and
-- location Visibility Dimensions every Project gets at creation.

-- Project Roles: Rabaed defaults (project_id null) and, later, a Project's own
-- custom roles, each based on one of the four base roles.
create table project_role (
  id uuid primary key default app.uuid_v7(),
  owner_kind text not null check (owner_kind in ('rabaed', 'project')),
  project_id uuid,
  base_role text not null check (base_role in ('contractor', 'consultant', 'owner', 'owner_representative')),
  name jsonb not null check (app.is_bilingual(name)),
  code text not null check (code ~ '^[A-Z0-9]{1,6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_kind = 'rabaed') = (project_id is null))
);
create unique index project_role_rabaed_base_role_key on project_role (base_role) where owner_kind = 'rabaed';

insert into project_role (owner_kind, base_role, name, code) values
  ('rabaed', 'contractor', '{"en": "Contractor", "ar": "المقاول"}', 'CTR'),
  ('rabaed', 'consultant', '{"en": "Consultant", "ar": "الاستشاري"}', 'CSL'),
  ('rabaed', 'owner', '{"en": "Owner", "ar": "المالك"}', 'OWN'),
  ('rabaed', 'owner_representative', '{"en": "Owner Representative", "ar": "ممثل المالك"}', 'OWR');

create table project (
  id uuid primary key default app.uuid_v7(),
  -- Whose subscription it counts against and whose Project Number series it uses.
  host_company_id uuid not null references company (id),
  project_number integer not null check (project_number > 0),
  -- Short and editable; used in Document Numbers.
  code text not null check (code ~ '^[A-Z0-9]{2,10}$'),
  name jsonb not null check (app.is_bilingual(name)),
  status text not null default 'active' check (status in ('active', 'closed')),
  closed_at timestamptz,
  creator_member_id uuid not null references member (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_host_number_key unique (host_company_id, project_number)
);

alter table project_role
  add constraint project_role_project_fk foreign key (project_id) references project (id);

-- The last Project Number each Host Company used; incremented in the same
-- transaction that creates the Project, so numbers are gap-free.
create table company_project_counter (
  company_id uuid primary key references company (id),
  last_project_number integer not null check (last_project_number > 0)
);

create table participant (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null references project (id),
  company_id uuid not null references company (id),
  project_role_id uuid not null references project_role (id),
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A Company appears once per Project.
  constraint participant_project_company_key unique (project_id, company_id),
  -- Lets project_member prove its Participant is on the same Project.
  constraint participant_id_project_key unique (id, project_id)
);

create table project_member (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null,
  participant_id uuid not null,
  member_id uuid not null references member (id),
  status text not null default 'active' check (status in ('active', 'removed')),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_member_participant_fk
    foreign key (participant_id, project_id) references participant (id, project_id),
  constraint project_member_participant_member_key unique (participant_id, member_id)
);
create index project_member_member_id_idx on project_member (member_id);

create table project_admin (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null references project (id),
  member_id uuid not null references member (id),
  appointed_by_member_id uuid references member (id),
  appointed_by_engineer_id uuid references rabaed_engineer (id),
  created_at timestamptz not null default now(),
  constraint project_admin_project_member_key unique (project_id, member_id),
  check ((appointed_by_member_id is null) <> (appointed_by_engineer_id is null))
);

-- Access for rabaed_app ------------------------------------------------------

alter table project_role enable row level security;
alter table project enable row level security;
alter table company_project_counter enable row level security;
alter table participant enable row level security;
alter table project_member enable row level security;
alter table project_admin enable row level security;

-- Writes come through app.create_project now, and through the functions of the
-- tickets that need them later (RP-190: Participants and Project Members).
revoke insert, update, delete on project_role, project, participant, project_member, project_admin from rabaed_app;
-- Only app.create_project uses the counter; Members never read it (it would tell
-- how many Projects their Company has created).
revoke all on company_project_counter from rabaed_app;

-- The Projects the acting Member is an active Project Member of, through an
-- active Participant of their own, active Company. SECURITY DEFINER so policies
-- on these tables can use it without recursing into their own policies.
create function app.current_project_ids() returns setof uuid
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select pm.project_id
    from project_member pm
    join participant p on p.id = pm.participant_id
    join member m on m.id = pm.member_id
    join company co on co.id = m.company_id
    where pm.member_id = app.current_member_id()
      and pm.status = 'active' and p.status = 'active'
      and p.company_id = m.company_id
      and m.status = 'active' and co.status = 'active'
  $$;

create policy member_reads_own_projects on project for select to rabaed_app
  using (id in (select app.current_project_ids()));

create policy member_reads_own_project_participants on participant for select to rabaed_app
  using (project_id in (select app.current_project_ids()));

create policy member_reads_own_project_members on project_member for select to rabaed_app
  using (project_id in (select app.current_project_ids()));

create policy member_reads_own_project_admins on project_admin for select to rabaed_app
  using (project_id in (select app.current_project_ids()));

-- Rabaed's default roles are readable by any active Member; a Project's own
-- roles only on that Project.
create policy member_reads_project_roles on project_role for select to rabaed_app
  using (
    (project_id is null and app.current_company_id() is not null)
    or project_id in (select app.current_project_ids())
  );

-- Creating a Project ---------------------------------------------------------

-- A Project Creator creates a Project. It takes the next Project Number of their
-- Company (the Host Company); their Company becomes its first Participant, in
-- the Rabaed default role for p_base_role; they become a Project Member and its
-- first Project Admin. Anyone but an active Project Creator of an active Company
-- is refused with SQLSTATE 42501.
create function app.create_project(p_name jsonb, p_code text, p_base_role text)
  returns table (project_id uuid, project_number integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_member_id uuid := app.current_member_id();
      v_company_id uuid;
      v_role_id uuid;
      v_number integer;
      v_project_id uuid;
      v_participant_id uuid;
    begin
      select m.company_id into v_company_id
      from member m join company co on co.id = m.company_id
      where m.id = v_member_id and m.status = 'active' and co.status = 'active' and m.can_create_projects;
      if v_company_id is null then
        raise exception 'only a Project Creator can create a Project' using errcode = '42501';
      end if;

      select id into v_role_id from project_role where owner_kind = 'rabaed' and base_role = p_base_role;
      if v_role_id is null then
        raise exception 'unknown base role %', p_base_role using errcode = '22023';
      end if;

      -- The row lock serialises concurrent creations for one Company; a rollback
      -- later in this transaction gives the number back, so there are no gaps.
      insert into company_project_counter as c (company_id, last_project_number)
      values (v_company_id, 1)
      on conflict (company_id) do update set last_project_number = c.last_project_number + 1
      returning c.last_project_number into v_number;

      insert into project (host_company_id, project_number, code, name, creator_member_id)
      values (v_company_id, v_number, p_code, p_name, v_member_id)
      returning id into v_project_id;
      insert into participant (project_id, company_id, project_role_id)
      values (v_project_id, v_company_id, v_role_id)
      returning id into v_participant_id;
      insert into project_member (project_id, participant_id, member_id)
      values (v_project_id, v_participant_id, v_member_id);
      insert into project_admin (project_id, member_id, appointed_by_member_id)
      values (v_project_id, v_member_id, v_member_id);

      return query select v_project_id, v_number;
    end
  $$;

revoke all on function app.current_project_ids(), app.create_project(jsonb, text, text) from public;
grant execute on function app.current_project_ids(), app.create_project(jsonb, text, text) to rabaed_app;
