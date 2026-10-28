-- RP-1058: password reset. A Member who forgot their password asks for a link by email; the
-- link carries a one-time token, valid 30 minutes, and sets a new password.
--
-- * The request never tells whether an email is registered: app.request_password_reset answers
--   the same 'requested' for any email (the api pads its answer to the same time), and is
--   limited per email and per visitor whatever the email (password_reset_attempt).
-- * No token is ever stored, not even in the outbox: the request writes a password_reset row
--   with no token and an outbox row naming it. The outbox handler mints the token as it sends
--   the email (app.issue_password_reset) and stores only its SHA-256, in the handler's
--   transaction: a failed send rolls it back, and the retry mints a fresh one.
-- * A new request voids the Member's earlier unused links; using a link (app.reset_password)
--   spends it, voids the rest, sets the password, revokes every session of the Member and
--   records the reset in member_security_event (the time; no token, no password).
-- * Rabaed Engineers are out of scope (ADR 0010): only active Members of active Companies.
-- No table here is granted to the app role or to rabaed_admin; the api and the worker go
-- through the SECURITY DEFINER functions below.

create table password_reset (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references member (id),
  requested_at timestamptz not null,
  -- Set when the email is sent: the SHA-256 of the link's token, and when it expires.
  token_hash bytea unique check (token_hash is null or length(token_hash) = 32),
  expires_at timestamptz,
  used_at timestamptz,
  -- A later request, or a reset by another link, voided it unused.
  voided_at timestamptz,
  check ((token_hash is null) = (expires_at is null)),
  check (used_at is null or voided_at is null)
);
create index password_reset_open_idx on password_reset (member_id) where used_at is null and voided_at is null;
alter table password_reset enable row level security;
revoke all on password_reset from rabaed_app;
revoke all on password_reset from rabaed_admin;

-- One row per request, for the window only: the SHA-256 of the normalised email (kind 'email')
-- and of the visitor's address (kind 'visitor'), never the email or the address.
create table password_reset_attempt (
  kind text not null check (kind in ('email', 'visitor')),
  key_sha256 bytea not null check (length(key_sha256) = 32),
  attempted_at timestamptz not null
);
create index password_reset_attempt_key_idx on password_reset_attempt (kind, key_sha256, attempted_at);
create index password_reset_attempt_at_idx on password_reset_attempt (attempted_at);
alter table password_reset_attempt enable row level security;
revoke all on password_reset_attempt from rabaed_app;
revoke all on password_reset_attempt from rabaed_admin;

-- A Member's security events, append-only: a password reset, by when. Nobody reads it through
-- the app role; it is the audit record.
create table member_security_event (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references member (id),
  kind text not null check (kind in ('password_reset')),
  at timestamptz not null
);
create index member_security_event_member_idx on member_security_event (member_id, at);
alter table member_security_event enable row level security;
revoke all on member_security_event from rabaed_app;
revoke all on member_security_event from rabaed_admin;

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check
  check (kind in ('notification', 'email', 'digest', 'step_age_report', 'documental_record', 'record_ready', 'documental_record_reproduce', 'working_copy', 'snag_report', 'password_reset'));

-- Asks for a reset link for p_email from a visitor (the SHA-256 of their address). Answers
-- 'too_many_attempts' past either limit in the window (nothing else happens), else 'requested',
-- whether or not the email is a Member's. For an active Member of an active Company it voids
-- their unused links and queues the email (outbox kind 'password_reset', the reset's id only).
create function app.request_password_reset(
  p_email text, p_visitor_sha256 bytea, p_now timestamptz,
  p_per_email integer, p_per_visitor integer, p_window interval
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_email_sha256 bytea := sha256(convert_to(lower(trim(p_email)), 'UTF8'));
      v_member_id uuid;
      v_reset_id uuid;
    begin
      if length(p_visitor_sha256) <> 32 then
        raise exception 'visitor must be a SHA-256' using errcode = '22023';
      end if;
      -- Email first, then visitor: every caller takes them in this order, so none deadlock.
      perform pg_advisory_xact_lock(hashtextextended('password_reset_attempt:email:' || encode(v_email_sha256, 'hex'), 0));
      perform pg_advisory_xact_lock(hashtextextended('password_reset_attempt:visitor:' || encode(p_visitor_sha256, 'hex'), 0));
      delete from password_reset_attempt a where a.attempted_at <= v_at - p_window;
      if (select count(*) from password_reset_attempt a
          where a.kind = 'email' and a.key_sha256 = v_email_sha256 and a.attempted_at > v_at - p_window) >= p_per_email
        or (select count(*) from password_reset_attempt a
          where a.kind = 'visitor' and a.key_sha256 = p_visitor_sha256 and a.attempted_at > v_at - p_window) >= p_per_visitor then
        return 'too_many_attempts';
      end if;
      insert into password_reset_attempt (kind, key_sha256, attempted_at)
      values ('email', v_email_sha256, v_at), ('visitor', p_visitor_sha256, v_at);

      select m.id into v_member_id
      from member m join company co on co.id = m.company_id
      where m.email = lower(trim(p_email)) and m.status = 'active' and co.status = 'active'
      for update of m;
      if v_member_id is null then
        return 'requested';
      end if;

      update password_reset set voided_at = v_at
      where member_id = v_member_id and used_at is null and voided_at is null;
      insert into password_reset (member_id, requested_at) values (v_member_id, v_at)
      returning id into v_reset_id;
      insert into outbox (kind, project_id, payload)
      values ('password_reset', null, jsonb_build_object('passwordResetId', v_reset_id));
      return 'requested';
    end
  $$;

-- The outbox handler's step: gives the reset its token (the SHA-256 the handler minted) valid
-- for p_ttl, and returns where and in which language to send it. No row when the reset was
-- voided, used or already sent, or the Member or their Company is no longer active.
create function app.issue_password_reset(p_reset_id uuid, p_token_hash bytea, p_now timestamptz, p_ttl interval)
  returns table (to_address text, language text, expires_at timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
    begin
      return query
      with issued as (
        update password_reset r set token_hash = p_token_hash, expires_at = v_at + p_ttl
        from member m join company co on co.id = m.company_id
        where r.id = p_reset_id and m.id = r.member_id
          and r.token_hash is null and r.used_at is null and r.voided_at is null
          and m.status = 'active' and co.status = 'active'
        returning r.member_id, r.expires_at
      )
      select m.email, coalesce(p.preferred_language, m.locale), i.expires_at
      from issued i
      join member m on m.id = i.member_id
      left join member_notification_preference p on p.member_id = m.id;
    end
  $$;

-- Uses a reset link once: sets the Member's password, spends the link and voids their other
-- links, revokes every session of theirs and records the reset. Returns the Member, or null
-- when the token is unknown, used, voided or expired, or the Member or their Company is no
-- longer active (nothing changes then).
create function app.reset_password(p_token_hash bytea, p_password_hash text, p_now timestamptz)
  returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_reset_id uuid;
      v_member_id uuid;
      v_at timestamptz := greatest(p_now, now());
    begin
      select r.id, r.member_id into v_reset_id, v_member_id
      from password_reset r
      join member m on m.id = r.member_id
      join company co on co.id = m.company_id
      where r.token_hash = p_token_hash and r.used_at is null and r.voided_at is null
        and r.expires_at > v_at and m.status = 'active' and co.status = 'active'
      for update of r, m;

      if v_reset_id is null then
        return null;
      end if;

      update password_reset set used_at = v_at where id = v_reset_id;
      update password_reset set voided_at = v_at
      where member_id = v_member_id and id <> v_reset_id and used_at is null and voided_at is null;
      insert into credential (member_id, password_hash) values (v_member_id, p_password_hash)
      on conflict (member_id) do update
        set password_hash = excluded.password_hash, updated_at = v_at;
      update session set revoked_at = v_at where member_id = v_member_id and revoked_at is null;
      insert into member_security_event (member_id, kind, at) values (v_member_id, 'password_reset', v_at);
      return v_member_id;
    end
  $$;

revoke all on function
  app.request_password_reset(text, bytea, timestamptz, integer, integer, interval),
  app.issue_password_reset(uuid, bytea, timestamptz, interval),
  app.reset_password(bytea, text, timestamptz)
  from public;
grant execute on function
  app.request_password_reset(text, bytea, timestamptz, integer, integer, interval),
  app.issue_password_reset(uuid, bytea, timestamptz, interval),
  app.reset_password(bytea, text, timestamptz)
  to rabaed_app;
