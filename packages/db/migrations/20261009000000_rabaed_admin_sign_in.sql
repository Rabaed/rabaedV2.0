-- Rabaed Admin is its own service (ADR 0010, RP-254): Rabaed Engineers sign in
-- there, and only there, with a password and then a one-time code sent by email.
--
-- * The customer api (rabaed_app) can no longer sign an Engineer in or resolve
--   an Engineer's session: its pre-sign-in functions serve Members only, and
--   every Engineer session it ever made is revoked.
-- * The admin service connects as rabaed_admin only. It keeps its own sign-in
--   records in the engineer_* tables below, with direct access (they hold
--   nothing of any Company), and reads an Engineer's password hash through
--   app.engineer_sign_in_candidate, since credential stays closed to it.
-- * rabaed_app can touch none of the engineer_* tables.

-- Lockout: consecutive failed passwords or codes, and until when the Engineer is locked out.
alter table rabaed_engineer
  add column failed_sign_ins integer not null default 0 check (failed_sign_ins >= 0),
  add column locked_until timestamptz;

-- A sign-in waiting for its code: the browser holds the challenge token (a
-- cookie), the Engineer's inbox the code. Only hashes are stored. Single use,
-- short expiry, and refused after a few wrong codes.
create table engineer_sign_in_code (
  id uuid primary key default app.uuid_v7(),
  engineer_id uuid not null references rabaed_engineer (id),
  challenge_hash bytea not null unique,
  code_hash bytea not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0)
);
create index engineer_sign_in_code_engineer_idx on engineer_sign_in_code (engineer_id, created_at);

-- An Engineer's session in Rabaed Admin. It ends after 30 minutes without a
-- request (last_seen_at), at expires_at at the latest, or at sign-out.
create table engineer_session (
  id uuid primary key default app.uuid_v7(),
  token_hash bytea not null unique,
  engineer_id uuid not null references rabaed_engineer (id),
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

-- The browsers an Engineer has signed in from (a long-lived random cookie;
-- only its hash is stored). A sign-in from any other one emails an alert.
create table engineer_device (
  id uuid primary key default app.uuid_v7(),
  engineer_id uuid not null references rabaed_engineer (id),
  device_hash bytea not null,
  first_seen_at timestamptz not null,
  constraint engineer_device_key unique (engineer_id, device_hash)
);

-- Every sign-in, failure and sign-out, append-only. engineer_id is null when
-- the email matched no active Engineer.
create table engineer_sign_in_event (
  id uuid primary key default app.uuid_v7(),
  engineer_id uuid references rabaed_engineer (id),
  email text not null,
  event text not null check (event in (
    'password_failed', 'locked_out', 'refused_while_locked', 'code_sent', 'code_rate_limited',
    'code_failed', 'signed_in', 'new_device', 'signed_out', 'idle_signed_out'
  )),
  ip text,
  user_agent text,
  at timestamptz not null
);
create index engineer_sign_in_event_engineer_idx on engineer_sign_in_event (engineer_id, at);

-- Access ---------------------------------------------------------------------

alter table engineer_sign_in_code enable row level security;
alter table engineer_session enable row level security;
alter table engineer_device enable row level security;
alter table engineer_sign_in_event enable row level security;

revoke all on engineer_sign_in_code, engineer_session, engineer_device, engineer_sign_in_event from rabaed_app;

-- rabaed_admin got select, insert, update and delete by default; the log is append-only.
revoke update, delete on engineer_sign_in_event from rabaed_admin;
revoke delete on engineer_sign_in_code, engineer_session, engineer_device from rabaed_admin;

-- An active Engineer's id and password hash, for a sign-in attempt; no row otherwise.
create function app.engineer_sign_in_candidate(p_email text)
  returns table (engineer_id uuid, password_hash text)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select e.id, c.password_hash
    from rabaed_engineer e join credential c on c.engineer_id = e.id
    where e.email = lower(trim(p_email)) and e.status = 'active'
  $$;
revoke all on function app.engineer_sign_in_candidate(text) from public;
grant execute on function app.engineer_sign_in_candidate(text) to rabaed_admin;

-- Rabaed Admin's own actions: inviting an Authorized Person again.
alter table admin_action drop constraint admin_action_action_check;
alter table admin_action add constraint admin_action_action_check
  check (action in ('onboard_company', 'read_onboarding_leads', 'invite_authorized_person'));

-- The customer api's pre-sign-in steps serve Members only --------------------

create or replace function app.sign_in_candidate(p_kind text, p_email text)
  returns table (principal_id uuid, password_hash text)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select m.id, c.password_hash
    from member m join credential c on c.member_id = m.id
    join company co on co.id = m.company_id
    where p_kind = 'member' and m.email = lower(trim(p_email))
      and m.status = 'active' and co.status = 'active'
  $$;

create or replace function app.create_session(
  p_token_hash bytea, p_member_id uuid, p_engineer_id uuid, p_expires_at timestamptz
) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_id uuid;
    begin
      if p_engineer_id is not null or not app.principal_is_active(p_member_id, null) then
        raise exception 'principal is not active, or not a Member';
      end if;
      insert into session (token_hash, member_id, expires_at)
      values (p_token_hash, p_member_id, p_expires_at)
      returning id into v_id;
      return v_id;
    end
  $$;

create or replace function app.session_principal(p_token_hash bytea, p_now timestamptz)
  returns table (session_id uuid, member_id uuid, engineer_id uuid)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select s.id, s.member_id, null::uuid
    from session s
    where s.token_hash = p_token_hash
      and s.member_id is not null
      and s.revoked_at is null
      and s.expires_at > greatest(p_now, now())
      and app.principal_is_active(s.member_id, null)
  $$;

update session set revoked_at = now() where engineer_id is not null and revoked_at is null;
