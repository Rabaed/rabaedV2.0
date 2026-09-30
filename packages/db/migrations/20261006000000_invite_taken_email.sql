-- Inviting an email that is already taken (visibility.md V17; RP-234).
--
-- An email belongs to one Member on the Instance. app.invite_member now tells
-- the Authorized Person why an email can't be invited instead of raising a
-- unique_violation, and app.reactivate_member brings a deactivated Member of
-- their own Company back as the same Member.
--
-- The one thing the Authorized Person learns about an email of another
-- Company's Member is that it is taken: the answer carries no Company and no
-- Member id.

drop function app.invite_member(text, jsonb, text, bytea, timestamptz);

-- Creates an invited Member of the acting Authorized Person's Company and their
-- one-time invitation, and returns ('invited', their id). When the email is
-- taken, nothing changes and it returns:
--   ('already_a_member', null)                  a Member of the Company who isn't deactivated;
--   ('deactivated_member', id)                  a deactivated Member of the Company, to reactivate;
--   ('registered_with_another_company', null)   any Member of another Company.
create function app.invite_member(
  p_email text, p_full_name jsonb, p_locale text, p_token_hash bytea, p_expires_at timestamptz
) returns table (outcome text, member_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_email text := lower(trim(p_email));
      v_member_id uuid;
      v_taken record;
    begin
      -- Waits for a concurrent invitation of the same email, then does nothing.
      insert into member (company_id, email, full_name, locale)
      values (v_company_id, v_email, p_full_name, p_locale)
      on conflict (email) do nothing
      returning id into v_member_id;

      if v_member_id is not null then
        insert into invitation (member_id, token_hash, invited_by_member_id, expires_at)
        values (v_member_id, p_token_hash, app.current_member_id(), p_expires_at);
        return query select 'invited', v_member_id;
        return;
      end if;

      select m.id, m.company_id, m.status into v_taken from member m where m.email = v_email;
      if v_taken.company_id <> v_company_id then
        return query select 'registered_with_another_company', null::uuid;
      elsif v_taken.status = 'deactivated' then
        return query select 'deactivated_member', v_taken.id;
      else
        return query select 'already_a_member', null::uuid;
      end if;
    end
  $$;

-- Reactivates a deactivated Member of the acting Authorized Person's Company,
-- keeping the same Member and everything tied to them. One who had set a
-- password is active again and signs in with it; one who never accepted their
-- invitation is invited again, with the new invitation given here. Returns
-- 'reactivated', 'unchanged' (they weren't deactivated), or null when they are
-- not in the Company.
create function app.reactivate_member(p_member_id uuid, p_token_hash bytea, p_expires_at timestamptz, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_at timestamptz := greatest(p_now, now());
      v_status text;
    begin
      select status into v_status from member
      where id = p_member_id and company_id = v_company_id
      for update;
      if v_status is null then
        return null;
      end if;
      if v_status <> 'deactivated' then
        return 'unchanged';
      end if;

      if exists (select 1 from credential where member_id = p_member_id) then
        v_status := 'active';
      else
        v_status := 'invited';
        insert into invitation (member_id, token_hash, invited_by_member_id, expires_at)
        values (p_member_id, p_token_hash, app.current_member_id(), p_expires_at);
      end if;
      update member set status = v_status, updated_at = v_at where id = p_member_id;
      return 'reactivated';
    end
  $$;

revoke all on function
  app.invite_member(text, jsonb, text, bytea, timestamptz),
  app.reactivate_member(uuid, bytea, timestamptz, timestamptz)
  from public;
grant execute on function
  app.invite_member(text, jsonb, text, bytea, timestamptz),
  app.reactivate_member(uuid, bytea, timestamptz, timestamptz)
  to rabaed_app;
