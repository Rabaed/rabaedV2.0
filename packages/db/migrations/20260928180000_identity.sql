-- Identity: Companies, Members, Rabaed Engineers, credentials, sessions,
-- invitations and admin_action (data-model.md §1, §9; RP-187).
--
-- Who can reach what:
-- * rabaed_app (api, worker) reads company and member through RLS: a Member sees
--   only their own Company and its Members. It cannot touch rabaed_engineer,
--   credential, session, invitation or admin_action directly; the pre-sign-in
--   steps go through the SECURITY DEFINER functions at the end of this file.
-- * rabaed_admin (Rabaed Admin) bypasses RLS; admin_action is insert-only for it.

grant usage on schema app to rabaed_admin;
alter default privileges in schema public
  grant select, insert, update, delete on tables to rabaed_admin;
alter default privileges in schema public
  grant usage, select on sequences to rabaed_admin;

-- UUIDv7 (time-ordered) for PostgreSQL 16, which has no uuidv7().
create function app.uuid_v7() returns uuid
  language sql volatile
  as $$
    select encode(
      set_bit(set_bit(
        overlay(uuid_send(gen_random_uuid())
          placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6),
        52, 1), 53, 1),
      'hex')::uuid
  $$;

create function app.is_bilingual(value jsonb) returns boolean
  language sql immutable
  as $$
    select jsonb_typeof(value) = 'object'
      and coalesce(length(trim(value ->> 'en')), 0) > 0
      and coalesce(length(trim(value ->> 'ar')), 0) > 0
  $$;

create table rabaed_engineer (
  id uuid primary key default app.uuid_v7(),
  email text not null unique check (email = lower(trim(email))),
  full_name text not null,
  status text not null default 'active' check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table company (
  id uuid primary key default app.uuid_v7(),
  legal_name jsonb not null check (app.is_bilingual(legal_name)),
  cr_number text not null check (cr_number ~ '^\d{10}$'),
  vat_number text not null check (vat_number ~ '^3\d{13}3$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- Exactly one; null only while onboarding.
  authorized_person_id uuid,
  onboarded_by uuid not null references rabaed_engineer (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_cr_number_key unique (cr_number),
  constraint company_vat_number_key unique (vat_number)
);

create table member (
  id uuid primary key default app.uuid_v7(),
  company_id uuid not null references company (id),
  email text not null check (email = lower(trim(email))),
  full_name jsonb not null check (app.is_bilingual(full_name)),
  phone text,
  locale text not null default 'en' check (locale in ('en', 'ar')),
  status text not null default 'invited' check (status in ('invited', 'active', 'locked', 'deactivated')),
  can_create_projects boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Unique per Instance.
  constraint member_email_key unique (email)
);
create index member_company_id_idx on member (company_id);

alter table company
  add constraint company_authorized_person_fk
  foreign key (authorized_person_id) references member (id) deferrable initially deferred;

-- One password per principal. MFA factors and lockout counters get their own
-- tables/columns later without touching this shape.
create table credential (
  id uuid primary key default app.uuid_v7(),
  member_id uuid unique references member (id),
  engineer_id uuid unique references rabaed_engineer (id),
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((member_id is null) <> (engineer_id is null))
);

-- Server-side sessions. The cookie holds a random token; only its SHA-256 is stored.
create table session (
  id uuid primary key default app.uuid_v7(),
  token_hash bytea not null unique,
  member_id uuid references member (id),
  engineer_id uuid references rabaed_engineer (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check ((member_id is null) <> (engineer_id is null))
);

-- One-time, expiring invitation to set a password. Only the token's SHA-256 is stored.
create table invitation (
  id uuid primary key default app.uuid_v7(),
  member_id uuid not null references member (id),
  token_hash bytea not null unique,
  invited_by_engineer_id uuid references rabaed_engineer (id),
  invited_by_member_id uuid references member (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check ((invited_by_engineer_id is null) <> (invited_by_member_id is null))
);

-- Every Rabaed Engineer action, with its reason (visibility.md V9).
create table admin_action (
  id uuid primary key default app.uuid_v7(),
  engineer_id uuid not null references rabaed_engineer (id),
  action text not null check (action in ('onboard_company')),
  target_kind text not null,
  target_id uuid not null,
  reason text not null check (length(trim(reason)) > 0),
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

-- Access for rabaed_app ------------------------------------------------------

alter table rabaed_engineer enable row level security;
alter table company enable row level security;
alter table member enable row level security;
alter table credential enable row level security;
alter table session enable row level security;
alter table invitation enable row level security;
alter table admin_action enable row level security;

revoke all on rabaed_engineer, credential, session, invitation, admin_action from rabaed_app;
-- Writes to company and member come with the tickets that need them (RP-188).
revoke insert, update, delete on company, member from rabaed_app;

-- The acting Member's Company, or null. SECURITY DEFINER so policies on member
-- can use it without recursing into member's own policy.
create function app.current_company_id() returns uuid
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select company_id from member
    where id = app.current_member_id() and status = 'active'
  $$;

create policy member_reads_own_company on company for select to rabaed_app
  using (id = app.current_company_id());

create policy member_reads_own_company_members on member for select to rabaed_app
  using (company_id = app.current_company_id());

-- Access for rabaed_admin ----------------------------------------------------

-- The audit trail is append-only; passwords and sessions are never read by admins.
revoke update, delete on admin_action from rabaed_admin;
revoke all on credential, session from rabaed_admin;

-- Pre-sign-in steps for rabaed_app ------------------------------------------
-- Narrow SECURITY DEFINER functions: each does one thing and returns only what
-- the step needs. Times come from the caller so tests can move the clock.

-- The stored hash for a sign-in attempt, or no row. Only active principals.
create function app.sign_in_candidate(p_kind text, p_email text)
  returns table (principal_id uuid, password_hash text)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select m.id, c.password_hash
    from member m join credential c on c.member_id = m.id
    join company co on co.id = m.company_id
    where p_kind = 'member' and m.email = lower(trim(p_email))
      and m.status = 'active' and co.status = 'active'
    union all
    select e.id, c.password_hash
    from rabaed_engineer e join credential c on c.engineer_id = e.id
    where p_kind = 'engineer' and e.email = lower(trim(p_email)) and e.status = 'active'
  $$;

create function app.create_session(
  p_token_hash bytea, p_member_id uuid, p_engineer_id uuid, p_expires_at timestamptz
) returns uuid
  language sql volatile security definer
  set search_path = pg_catalog, public
  as $$
    insert into session (token_hash, member_id, engineer_id, expires_at)
    values (p_token_hash, p_member_id, p_engineer_id, p_expires_at)
    returning id
  $$;

-- Who a session token belongs to, if it is live and its principal still active.
create function app.session_principal(p_token_hash bytea, p_now timestamptz)
  returns table (session_id uuid, member_id uuid, engineer_id uuid)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select s.id, s.member_id, s.engineer_id
    from session s
    left join member m on m.id = s.member_id
    left join company co on co.id = m.company_id
    left join rabaed_engineer e on e.id = s.engineer_id
    where s.token_hash = p_token_hash
      and s.revoked_at is null
      and s.expires_at > p_now
      and (
        (m.status = 'active' and co.status = 'active')
        or e.status = 'active'
      )
  $$;

create function app.revoke_session(p_token_hash bytea, p_now timestamptz) returns void
  language sql volatile security definer
  set search_path = pg_catalog, public
  as $$
    update session set revoked_at = p_now
    where token_hash = p_token_hash and revoked_at is null
  $$;

-- Uses an invitation once: sets the Member's password and activates them.
-- Returns the Member, or null when the token is unknown, used or expired.
create function app.accept_invitation(p_token_hash bytea, p_password_hash text, p_now timestamptz)
  returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member_id uuid;
    begin
      update invitation set used_at = p_now
      where token_hash = p_token_hash and used_at is null and expires_at > p_now
      returning member_id into v_member_id;

      if v_member_id is null then
        return null;
      end if;

      update member set status = 'active', updated_at = p_now
      where id = v_member_id and status = 'invited';
      if not found then
        return null;
      end if;

      insert into credential (member_id, password_hash) values (v_member_id, p_password_hash)
      on conflict (member_id) do update
        set password_hash = excluded.password_hash, updated_at = p_now;
      return v_member_id;
    end
  $$;

revoke all on function
  app.sign_in_candidate(text, text),
  app.create_session(bytea, uuid, uuid, timestamptz),
  app.session_principal(bytea, timestamptz),
  app.revoke_session(bytea, timestamptz),
  app.accept_invitation(bytea, text, timestamptz),
  app.current_company_id()
  from public;
grant execute on function
  app.sign_in_candidate(text, text),
  app.create_session(bytea, uuid, uuid, timestamptz),
  app.session_principal(bytea, timestamptz),
  app.revoke_session(bytea, timestamptz),
  app.accept_invitation(bytea, text, timestamptz),
  app.current_company_id()
  to rabaed_app;
