-- RP-1072: the Participant Invitation email (ADR 0009; visibility.md "Participant Invitation
-- emails", V15, scenarios 31, 38 and RP-1072-1).
--
-- * When a Project Admin invites a Company on Rabaed, app.add_participant queues an outbox row of
--   kind 'participant_invitation' in the same transaction, naming only the invitation and when it
--   was sent. It answers 'invited' exactly as before, for a Company on Rabaed and for a CR number
--   that becomes an onboarding lead alike; a lead queues nothing. The worker sends the email later,
--   so the Project Admin's answer never waits for it.
-- * The handler reads the email through app.participant_invitation_email: the invited Company's
--   active Authorized Person, their language, and what they see of the invitation before accepting
--   (the Project's name, the Host Company and the offered Project Role; app.company_invitations).
--   No row, so no email, once the invitation was withdrawn, answered, or sent again since (a newer
--   row sends that one), or when the Project is closed or the Company or its Authorized Person is
--   not active.
-- * app.add_participant is as in the random_ids migration, with the outbox row added.

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check
  check (kind in ('notification', 'email', 'digest', 'step_age_report', 'documental_record', 'record_ready', 'documental_record_reproduce', 'working_copy', 'snag_report', 'password_reset', 'participant_invitation'));

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
        coalesce(v_lead_id, gen_random_uuid()), p_project_id, v_company_id, v_role_id, 'invited', app.current_member_id(),
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
      -- The invited Company's Authorized Person is emailed later, by the worker (RP-1072).
      insert into outbox (kind, project_id, payload)
      values ('participant_invitation', p_project_id, jsonb_build_object('participantId', v_participant_id, 'invitedAt', v_at));
      return 'invited';
    end
  $$;

-- The outbox handler's read: where, in which language and what to email for the invitation
-- p_participant_id sent at p_invited_at. No row when it is no longer that pending invitation, the
-- Project is closed, or the Company or its Authorized Person is not active.
create function app.participant_invitation_email(p_participant_id uuid, p_invited_at timestamptz)
  returns table (to_address text, language text, project_name jsonb, host_name jsonb, role_name jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select m.email, coalesce(np.preferred_language, m.locale), pr.name, host.legal_name, r.name
    from participant p
    join project pr on pr.id = p.project_id and pr.status = 'active'
    join company host on host.id = pr.host_company_id
    join project_role r on r.id = p.project_role_id
    join company co on co.id = p.company_id and co.status = 'active'
    join member m on m.id = co.authorized_person_id and m.status = 'active'
    left join member_notification_preference np on np.member_id = m.id
    where p.id = p_participant_id and p.status = 'invited' and p.invited_at = p_invited_at
  $$;

revoke all on function app.participant_invitation_email(uuid, timestamptz) from public;
grant execute on function app.participant_invitation_email(uuid, timestamptz) to rabaed_app;
