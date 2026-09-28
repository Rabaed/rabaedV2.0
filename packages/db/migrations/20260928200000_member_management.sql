-- The Authorized Person manages their Company's Members (RP-188): invite,
-- mark as Project Creator, deactivate.
--
-- rabaed_app still has no direct write on member (nor any access to invitation
-- or session). Each step is a narrow SECURITY DEFINER function that acts only
-- when the acting Member (app.current_member_id()) is the active Authorized
-- Person of an active Company, and only on that Company's Members. A Member of
-- another Company is indistinguishable from one that doesn't exist.

-- The Company the acting Member is Authorized Person of, or null.
create function app.current_authorized_company_id() returns uuid
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select co.id from company co join member m on m.id = co.authorized_person_id
    where m.id = app.current_member_id() and m.status = 'active' and co.status = 'active'
  $$;

-- Refuses anyone but the Authorized Person with SQLSTATE 42501, which the API
-- answers with 403 (the Company is theirs to see, so nothing leaks).
create function app.require_authorized_company_id() returns uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.current_authorized_company_id();
    begin
      if v_company_id is null then
        raise exception 'only the Authorized Person can manage Members' using errcode = '42501';
      end if;
      return v_company_id;
    end
  $$;

-- Creates an invited Member of the acting Authorized Person's Company and their
-- one-time invitation. A taken email raises unique_violation on member_email_key.
create function app.invite_member(
  p_email text, p_full_name jsonb, p_locale text, p_token_hash bytea, p_expires_at timestamptz
) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_member_id uuid;
    begin
      insert into member (company_id, email, full_name, locale)
      values (v_company_id, lower(trim(p_email)), p_full_name, p_locale)
      returning id into v_member_id;
      insert into invitation (member_id, token_hash, invited_by_member_id, expires_at)
      values (v_member_id, p_token_hash, app.current_member_id(), p_expires_at);
      return v_member_id;
    end
  $$;

-- Sets or clears Project Creator. Returns the Member's status ('deactivated'
-- means nothing changed), or null when they are not in the Company.
create function app.set_project_creator(p_member_id uuid, p_value boolean) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_status text;
    begin
      select status into v_status from member
      where id = p_member_id and company_id = v_company_id
      for update;
      if v_status is not null and v_status <> 'deactivated' then
        update member set can_create_projects = p_value, updated_at = now() where id = p_member_id;
      end if;
      return v_status;
    end
  $$;

-- Deactivates a Member: their sessions end and any pending invitation is void.
-- Returns 'deactivated', 'authorized_person' (refused: a Company always has
-- one), or null when they are not in the Company.
create function app.deactivate_member(p_member_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_at timestamptz := greatest(p_now, now());
      v_found boolean;
    begin
      select true into v_found from member
      where id = p_member_id and company_id = v_company_id
      for update;
      if v_found is null then
        return null;
      end if;
      if exists (select 1 from company where id = v_company_id and authorized_person_id = p_member_id) then
        return 'authorized_person';
      end if;

      update member set status = 'deactivated', updated_at = v_at
      where id = p_member_id and status <> 'deactivated';
      update session set revoked_at = v_at where member_id = p_member_id and revoked_at is null;
      update invitation set expires_at = v_at where member_id = p_member_id and used_at is null and expires_at > v_at;
      return 'deactivated';
    end
  $$;

revoke all on function
  app.current_authorized_company_id(),
  app.require_authorized_company_id(),
  app.invite_member(text, jsonb, text, bytea, timestamptz),
  app.set_project_creator(uuid, boolean),
  app.deactivate_member(uuid, timestamptz)
  from public;
grant execute on function
  app.current_authorized_company_id(),
  app.require_authorized_company_id(),
  app.invite_member(text, jsonb, text, bytea, timestamptz),
  app.set_project_creator(uuid, boolean),
  app.deactivate_member(uuid, timestamptz)
  to rabaed_app;
