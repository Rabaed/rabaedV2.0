-- RP-952 PR 1 of 2 (ADR 0028; visibility.md "A Participant's withdrawal"; workflow-engine.md §9;
-- data-model.md "Withdrawn Participant"; scenarios RP-952-1 to RP-952-5): the Host Company's Project
-- Admin withdraws a Participant.
--
-- * Who: only a Project Admin of the Project whose own Company is its Host Company. Anyone else, a
--   Participant not active on such a Project, or one already withdrawn reads 'not_found', as for an
--   id that does not exist; a closed Project 'project_closed'; the Host Company itself 'host_company'
--   (app.withdrawal_refusal, one rule for the preview and the withdrawal).
-- * The preview (app.participant_withdrawal_preview): counts only, the items to be Cancelled and the
--   Steps to become Vacancies. The items are those that left Draft: a Draft or Draft Revision was never
--   seen by another Company, so the Host Company does not learn how many there are.
-- * The withdrawal (app.withdraw_participant), in one transaction:
--   - Each open item it raised that left Draft (it has a Document Number) gets Rabaed's `cancelled`
--     event: shared, no Member and no Engineer, payload `{"left_participant_id"}`, which RP-650's
--     Record already prints ("Cancelled by Rabaed: ‹Company› left the Project"). Its open Steps are
--     marked done at the close (RP-955: app.held_at_close finds who held it), then the item closes with
--     outcome `cancelled`, so the record job is queued (trigger work_item_queues_documental_record).
--     Watchers of the item hear of it as of any cancel (app.outbox_watched_event); nobody else does.
--   - Each of its Drafts and Draft Revisions (no Document Number) is Cancelled with no Record: an
--     internal event of its own Participant, its Steps done, and `discarded_at` set with `closed_at`,
--     which the record trigger skips. Unlike app.discard_revision it keeps the item's work_item_access
--     row (nothing it did is removed); nobody reads it, since its Participant is withdrawn.
--   - Its open Steps on other Companies' items become Participant-level Vacancies: `vacant`, with no
--     assignee. app.work_item_holder_unchecked no longer gives a `vacant` row as a holder, so no
--     reader sees the old Company as the item's holder or in the "With" filter; app.work_item_vacancy
--     names only its Project Role ("Waiting for a new ‹role›"). Step Age is untouched: the others count
--     from `participant_entered_at`, which nothing here moves.
--   - The Participant becomes `withdrawn` (withdrawn_at, withdrawn_by_member_id), which takes its
--     Members off the Project: app.current_project_ids and app.current_participant_ids read active
--     Participants only. Nothing it did is removed. (E2, Signatory Access, is RP-614's.)
--   - Its Company's Authorized Person and each of its active Project Members get an in-app notice
--     (kind `participant_withdrawn`, no item) and an email (outbox kind `participant_withdrawn`, one
--     row per Member, read by app.participant_withdrawn_email). Both name the Project and the Host
--     Company, never who withdrew it. No other Company is told.
-- * The Vacancies list (app.project_vacancies), for the Host Company's Project Admins: each open
--   Vacancy with the role it waits for and when; the item's id, Document Number and Subject only when
--   the Admin sees the item (as RP-511's Handover list).
-- * app.work_item_event's actor check allows Rabaed's cancel alone to have neither actor.
--
-- Not here: a Vacancy passing to a replacement Participant (workflow-engine.md §9), and inviting a
-- withdrawn Company again (app.add_participant refuses a `withdrawn` row as `already_participant`).
-- Rebuilt from main's newest body: app.work_item_holder_unchecked (20271121000000_owner_review_hides_holder.sql).

-- Rabaed's own cancel has no actor --------------------------------------------------------------

-- `work_item_event_check` is Postgres's name for the table's first unnamed check, the actor rule
-- (20260929000000_work_items.sql); the new one is named.
alter table work_item_event drop constraint work_item_event_check;
alter table work_item_event add constraint work_item_event_actor_check
  check ((actor_member_id is null) <> (actor_engineer_id is null)
    or (type = 'cancelled' and actor_member_id is null and actor_engineer_id is null and payload ? 'left_participant_id'));

-- The notice ---------------------------------------------------------------------------------

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check
  check (kind in ('notification', 'email', 'digest', 'step_age_report', 'documental_record', 'record_ready', 'documental_record_reproduce', 'working_copy', 'snag_report', 'password_reset', 'participant_invitation', 'participant_withdrawn'));

alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check
  check (kind in ('step_reached', 'watched_event', 'sent_back', 'package_submitted', 'record_ready', 'participant_withdrawn'));
-- A package notification is about its Package, a withdrawal notice about its Project only, every other about one item.
alter table notification drop constraint notification_package_submitted;
alter table notification add constraint notification_about_one_thing
  check (case when kind = 'package_submitted' then package_id is not null and work_item_id is null
    when kind = 'participant_withdrawn' then package_id is null and work_item_id is null
    else package_id is null and work_item_id is not null end);

-- As in 20271019000000_reads_at_scale.sql, with the withdrawal notice: its Member reads it though they
-- no longer see the Project.
alter policy member_reads_own_notifications on notification
  using (member_id = app.current_member_id() and in_app and withdrawn_at is null
    and case when kind = 'participant_withdrawn' then true
      when package_id is null then app.sees_work_item(work_item_id)
      else app.package_notification_count(id) > 0 end);

-- Who may withdraw ---------------------------------------------------------------------------

-- Whether the acting Member is a Project Admin of Project `p_project_id` and their own Company hosts it:
-- the one who withdraws its Participants and reads its Vacancies (ADR 0028).
create function app.is_host_admin(p_project_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from project pr
        where pr.id = p_project_id and pr.id in (select app.current_admin_project_ids())
          and pr.host_company_id = app.current_company_id()
      );
    end
  $$;
revoke all on function app.is_host_admin(uuid) from public;
grant execute on function app.is_host_admin(uuid) to rabaed_app;

-- Why the acting Member may not preview or withdraw Participant `p_participant_id`, or null when they
-- may: 'not_found' unless it is active on a Project whose Host Company's Project Admin they are;
-- 'project_closed'; 'host_company' for the Host Company's own Participant.
create function app.withdrawal_refusal(p_participant_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_target record;
    begin
      select p.company_id, pr.host_company_id, pr.status as project_status into v_target
      from participant p
      join project pr on pr.id = p.project_id
      where p.id = p_participant_id and p.status = 'active' and app.is_host_admin(pr.id);
      if not found then
        return 'not_found';
      end if;
      if v_target.project_status <> 'active' then
        return 'project_closed';
      end if;
      if v_target.company_id = v_target.host_company_id then
        return 'host_company';
      end if;
      return null;
    end
  $$;
revoke all on function app.withdrawal_refusal(uuid) from public;

-- The open items Participant `p_participant_id` raised that left Draft: what its withdrawal Cancels with a Record.
create function app.withdrawal_cancels(p_participant_id uuid) returns setof uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select w.id from work_item w
        where w.raised_by_participant_id = p_participant_id and w.closed_at is null and w.document_number is not null;
    end
  $$;
revoke all on function app.withdrawal_cancels(uuid) from public;

-- Its open Steps on other Companies' items: what its withdrawal makes Vacancies.
create function app.withdrawal_vacates(p_participant_id uuid) returns setof uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select a.id from step_assignment a
        join work_item w on w.id = a.work_item_id
        where a.participant_id = p_participant_id and a.status in ('pooled', 'picked_up')
          and w.closed_at is null and w.raised_by_participant_id <> p_participant_id;
    end
  $$;
revoke all on function app.withdrawal_vacates(uuid) from public;

-- The confirmation's counts, for the Host Company's Project Admin; no counts with a refusal.
create function app.participant_withdrawal_preview(p_participant_id uuid)
  returns table (outcome text, items_to_cancel integer, steps_to_vacate integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_refusal text := app.withdrawal_refusal(p_participant_id);
    begin
      if v_refusal is not null then
        return query select v_refusal, null::integer, null::integer;
        return;
      end if;
      return query select 'ok'::text,
        (select count(*)::integer from app.withdrawal_cancels(p_participant_id)),
        (select count(*)::integer from app.withdrawal_vacates(p_participant_id));
    end
  $$;
revoke all on function app.participant_withdrawal_preview(uuid) from public;
grant execute on function app.participant_withdrawal_preview(uuid) to rabaed_app;

-- The withdrawal itself; 'withdrawn', or the refusal.
create function app.withdraw_participant(p_participant_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_refusal text;
      v_participant record;
      v_item record;
      v_member uuid;
      v_outbox uuid;
    begin
      -- Nobody locks a Participant they may not withdraw: checked first, then locked, then checked
      -- again under the lock, so one withdrawal runs at a time and the second reads 'not_found'.
      v_refusal := app.withdrawal_refusal(p_participant_id);
      if v_refusal is not null then
        return v_refusal;
      end if;
      select p.id, p.project_id, p.company_id into v_participant from participant p where p.id = p_participant_id for update;
      v_refusal := app.withdrawal_refusal(p_participant_id);
      if v_refusal is not null then
        return v_refusal;
      end if;
      -- Every item it changes, locked first in one order (app.take_transition locks an item before its Steps
      -- too), so two withdrawals on one Project, each touching the other's items, never deadlock.
      perform 1 from work_item w
      where w.id in (
        select x.id from work_item x where x.raised_by_participant_id = p_participant_id and x.closed_at is null
        union
        select a.work_item_id from step_assignment a where a.participant_id = p_participant_id and a.status in ('pooled', 'picked_up'))
      order by w.id
      for update;

      -- Its items: those that left Draft Cancelled by Rabaed with a Record, its Drafts and Draft Revisions with none.
      for v_item in
        select w.id, w.current_step_id, w.document_number is null as is_draft, cancelled.id as cancelled_step_id, cancelled.stage_key
        from work_item w
        join work_item_type t on t.id = w.work_item_type_id
        -- Where an item that left Draft goes, as a Member's Cancel takes it: its Version's Step in a cancelled
        -- Stage, so every reader reads it Cancelled. A Version with none leaves it at its Step (RP-952 follow-up).
        left join lateral (
          select s.id, s.stage_key from workflow_step s
          join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = s.stage_key
          where s.workflow_version_id = w.workflow_version_id and st.category = 'cancelled' and w.document_number is not null
          order by s.id
          limit 1
        ) cancelled on true
        where w.raised_by_participant_id = p_participant_id and w.closed_at is null
        order by w.id
        for update of w
      loop
        insert into work_item_event (project_id, work_item_id, type, from_step_id, to_step_id, payload, audience, audience_participant_id, created_at)
        values (v_participant.project_id, v_item.id, 'cancelled', v_item.current_step_id, v_item.cancelled_step_id,
          jsonb_build_object('left_participant_id', p_participant_id),
          case when v_item.is_draft then 'internal' else 'shared' end,
          case when v_item.is_draft then p_participant_id end, v_at);
        update step_assignment set status = 'done', done_at = v_at, updated_at = v_at
        where work_item_id = v_item.id and status in ('pooled', 'picked_up', 'vacant');
        update work_item set outcome = 'cancelled', closed_at = v_at, updated_at = v_at,
          discarded_at = case when v_item.is_draft then v_at end,
          current_step_id = coalesce(v_item.cancelled_step_id, current_step_id),
          current_stage_key = coalesce(v_item.stage_key, current_stage_key),
          step_entered_at = case when v_item.cancelled_step_id is null then step_entered_at else v_at end,
          participant_entered_at = case when v_item.cancelled_step_id is null then participant_entered_at else v_at end,
          participant_entered_step_id = coalesce(v_item.cancelled_step_id, participant_entered_step_id)
        where id = v_item.id;
      end loop;

      -- Its Steps on other Companies' items: Participant-level Vacancies.
      update step_assignment set status = 'vacant', assignee_member_id = null, updated_at = v_at
      where id in (select app.withdrawal_vacates(p_participant_id));

      -- Its Notices, before its Members lose the Project: its Company's Authorized Person and Project Members.
      for v_member in
        select m.id from member m
        where m.status = 'active' and (
          m.id = (select co.authorized_person_id from company co where co.id = v_participant.company_id)
          or m.id in (select pm.member_id from project_member pm where pm.participant_id = p_participant_id and pm.status = 'active'))
        order by m.id
      loop
        insert into outbox (kind, project_id, payload)
        values ('participant_withdrawn', v_participant.project_id, jsonb_build_object('participantId', p_participant_id, 'memberId', v_member))
        returning id into v_outbox;
        insert into notification (member_id, project_id, outbox_id, kind, in_app, email, created_at)
        values (v_member, v_participant.project_id, v_outbox, 'participant_withdrawn', true, 'none', v_at);
      end loop;

      update participant set status = 'withdrawn', withdrawn_at = v_at, withdrawn_by_member_id = app.current_member_id(), updated_at = v_at
      where id = p_participant_id;
      return 'withdrawn';
    end
  $$;
revoke all on function app.withdraw_participant(uuid, timestamptz) from public;
grant execute on function app.withdraw_participant(uuid, timestamptz) to rabaed_app;

-- The reads ----------------------------------------------------------------------------------

-- As in 20271121000000_owner_review_hides_holder.sql, with a Participant-level Vacancy holding no
-- Company: a `vacant` row is no holder, so nobody reads the withdrawn Company as the item's holder.
create or replace function app.work_item_holder_unchecked(p_work_item_id uuid, p_participant_ids uuid[])
  returns table(participant_id uuid, assignee_member_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      -- "With Owner review" in place of the holder: no holder reaches the reader.
      if app.with_owner_review_unchecked(p_work_item_id, p_participant_ids) is not null then
        return;
      end if;
      return query
        select a.participant_id,
          case when a.participant_id = any(p_participant_ids) then a.assignee_member_id end
        from step_assignment a
        where a.work_item_id = p_work_item_id and a.status in ('pooled', 'picked_up');
    end
  $$;

-- The Project Role an open item waits for when its Step is a Participant-level Vacancy ("Waiting for a
-- new ‹role›"), to whoever sees the item; never the Company. Nothing while it waits for the Owner's
-- review, which those readers read in place of any holder.
create function app.work_item_vacancy(p_work_item_id uuid) returns table (base_role text, role_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) or app.with_owner_review(p_work_item_id) is not null then
        return;
      end if;
      return query
        select r.base_role, r.name
        from step_assignment a
        join work_item w on w.id = a.work_item_id and w.closed_at is null
        join participant p on p.id = a.participant_id
        join project_role r on r.id = p.project_role_id
        where a.work_item_id = p_work_item_id and a.status = 'vacant'
        limit 1;
    end
  $$;
revoke all on function app.work_item_vacancy(uuid) from public;
grant execute on function app.work_item_vacancy(uuid) to rabaed_app;

-- The Project's open Vacancies, for the Host Company's Project Admins only (nothing for anyone else):
-- the role each waits for and since when; the item only when the Admin sees it.
create function app.project_vacancies(p_project_id uuid)
  returns table (step_assignment_id uuid, work_item_id uuid, document_number text, title text, base_role text, role_name jsonb, vacant_since timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.is_host_admin(p_project_id) then
        return;
      end if;
      return query
        select a.id, seen.id, seen.document_number, seen.title, r.base_role, r.name, p.withdrawn_at
        from step_assignment a
        join work_item w on w.id = a.work_item_id and w.project_id = p_project_id and w.closed_at is null
        join participant p on p.id = a.participant_id
        join project_role r on r.id = p.project_role_id
        left join lateral (select w.id, w.document_number, w.title where app.sees_work_item(w.id)) seen on true
        where a.status = 'vacant'
        order by p.withdrawn_at, seen.document_number nulls last, a.id;
    end
  $$;
revoke all on function app.project_vacancies(uuid) from public;
grant execute on function app.project_vacancies(uuid) to rabaed_app;

-- A withdrawal notice of the acting Member's own: the Project's code and name and its Host Company,
-- which its Member no longer reads through the Project. Nothing for any other notification or Member.
create function app.withdrawal_notice(p_notification_id uuid) returns table (project_code text, project_name jsonb, host_company_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select pr.code, pr.name, host.legal_name
        from notification n
        join project pr on pr.id = n.project_id
        join company host on host.id = pr.host_company_id
        where n.id = p_notification_id and n.kind = 'participant_withdrawn' and n.member_id = app.current_member_id();
    end
  $$;
revoke all on function app.withdrawal_notice(uuid) from public;
grant execute on function app.withdrawal_notice(uuid) to rabaed_app;

-- The outbox handler's read: where, in which language and what to email Member `p_member_id` of
-- withdrawn Participant `p_participant_id` (its Company's Authorized Person or one of its Project
-- Members). No row when it is not withdrawn or the Member is no longer active.
-- It is the worker's (the app role with no Member set), and refuses any Member (app.require_worker):
-- the Participant's id is no secret to its Host Company's Project Admin, so the ids alone must not
-- give a Member's email address. The api never calls it.
create function app.participant_withdrawn_email(p_participant_id uuid, p_member_id uuid)
  returns table (to_address text, language text, project_name jsonb, host_company_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      perform app.require_worker();
      return query
      select m.email, coalesce(np.preferred_language, m.locale), pr.name, host.legal_name
      from participant p
      join project pr on pr.id = p.project_id
      join company host on host.id = pr.host_company_id
      join company co on co.id = p.company_id
      join member m on m.id = p_member_id and m.status = 'active'
      left join member_notification_preference np on np.member_id = m.id
      where p.id = p_participant_id and p.status = 'withdrawn'
        and (m.id = co.authorized_person_id
          or exists (select 1 from project_member pm where pm.participant_id = p.id and pm.member_id = m.id and pm.status = 'active'));
    end
  $$;
revoke all on function app.participant_withdrawn_email(uuid, uuid) from public;
grant execute on function app.participant_withdrawn_email(uuid, uuid) to rabaed_app;
