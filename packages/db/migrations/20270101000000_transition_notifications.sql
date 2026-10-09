-- RP-432 (WF-9, spec RP-423, decision 2026-10-08): notifications per Transition,
-- and in-app always sent.
--
-- * A Transition may name extra recipients (@rabaed/domain's workflow-definition
--   `notifications`): the next holder or Step Pool (always, as today), the raiser,
--   watchers, a Position of the acting Participant. Never a person, a group, an
--   email address or "everyone on the Project". The column workflow_transition.
--   notifications holds them (null for none). They are delivered by the existing
--   watched-item path (kind `watched_event`, event_type `transition`) so they take
--   its settings, its email templates and its leak-channel row: the raiser and the
--   Members holding the Position are added to the Members that path delivers to.
--   Watchers always hear of a Transition on a watched chain, so naming them changes
--   nothing. Every recipient is re-checked at send time, as that Member
--   (app.sees_work_item through app.notify_member, V5 for internal events), and
--   still goes through their settings, mute and pause: a Workflow never overrides
--   a Member's own notification settings (visibility.md, Notifications and emails).
--   Not redefined here: app.take_transition (the outbox trigger does the routing).
-- * In-app is always sent: notification_setting loses its in_app column (and the
--   weekly report's in-app check with it), and the routing rule loses its in-app
--   argument. Email stays per group (off, immediate, digest) and Pause all email.

alter table workflow_transition
  add column notifications jsonb check (notifications is null or jsonb_typeof(notifications) = 'array');

-- In-app has no setting ------------------------------------------------------------------

alter table notification_setting drop column in_app;
alter table notification_setting add constraint notification_setting_weekly_report_email_only
  check (notification_group <> 'weekly_report' or email in ('off', 'immediate'));

-- The routing rule without the in-app argument: the bell is always on, except for the
-- weekly report (an email only); a muted Project or an unticked outcome silences both;
-- pausing email, or a group's email off, stops only the email.
create function app.notification_route(
  p_kind text, p_outcome text, p_email text, p_outcomes text[], p_muted boolean, p_email_paused boolean
) returns table (in_app boolean, email text)
  language plpgsql immutable
  as $$
    declare
      v_in_app boolean := p_kind <> 'weekly_report';
    begin
      if p_muted or (
        p_kind = 'watched_event'
        and p_outcome = any (array['A', 'B', 'C', 'D', 'passed', 'passed_with_comments', 'failed', 'approved', 'rejected', 'cancelled'])
        and not (p_outcome = any (p_outcomes))
      ) then
        return query select false, 'none'::text;
        return;
      end if;
      if p_email_paused or p_email = 'off' then
        return query select v_in_app, 'none'::text;
        return;
      end if;
      return query select v_in_app, case when p_kind = 'weekly_report' then 'immediate' else p_email end;
    end
  $$;

create or replace function app.member_notification_route(p_member_id uuid, p_project_id uuid, p_kind text, p_outcome text)
  returns table (in_app boolean, email text)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_group text := case p_kind when 'watched_event' then 'watched' else p_kind end;
      v_setting record;
    begin
      select s.email, s.outcomes into v_setting
      from notification_setting s where s.member_id = p_member_id and s.notification_group = v_group;
      return query select r.in_app, r.email from app.notification_route(
        p_kind, p_outcome,
        coalesce(v_setting.email, case when v_group in ('step_reached', 'sent_back', 'weekly_report') then 'immediate' else 'digest' end),
        coalesce(v_setting.outcomes,
          array['A', 'B', 'C', 'D', 'passed', 'passed_with_comments', 'failed', 'approved', 'rejected', 'cancelled']),
        exists (select 1 from project_mute m where m.member_id = p_member_id and m.project_id = p_project_id),
        coalesce((select p.email_paused from member_notification_preference p where p.member_id = p_member_id), false)
      ) r;
    end
  $$;

drop function app.notification_route(text, text, boolean, text, text[], boolean, boolean);

-- Per-Transition recipients -----------------------------------------------------------------

-- The Members a Transition's own `notifications` name besides the next holder or Step
-- Pool and the watchers: its raiser (the Member who created the item), and the active
-- Members of the acting Participant who hold a named Position (of the Participant's
-- base role). Candidates only: delivery re-checks each as that Member.
create function app.transition_notice_members(p_work_item_event_id uuid) returns table (member_id uuid)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select w.created_by_member_id
        from work_item_event e
        join workflow_transition tr on tr.id = e.transition_id
        join work_item w on w.id = e.work_item_id
        where e.id = p_work_item_event_id and e.type = 'transition'
          and tr.notifications @> '[{"to": "raiser"}]'
        union
        select pm.member_id
        from work_item_event e
        join workflow_transition tr on tr.id = e.transition_id
        cross join lateral jsonb_array_elements(tr.notifications) n
        join participant pa on pa.id = e.actor_participant_id
        join project_role pr on pr.id = pa.project_role_id
        join position po on po.base_role = pr.base_role and po.key = n ->> 'position'
        join project_member pm on pm.participant_id = pa.id and pm.status = 'active'
        join project_member_position mp on mp.project_member_id = pm.id and mp.position_id = po.id
        join member m on m.id = pm.member_id and m.status = 'active'
        where e.id = p_work_item_event_id and e.type = 'transition'
          and jsonb_typeof(tr.notifications) = 'array' and n ->> 'to' = 'position';
    end
  $$;

-- A watched chain's event goes out when someone other than its actor watches, or
-- when its Transition names the raiser or a Position.
create or replace function app.outbox_watched_event() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if exists (
          select 1 from work_item_watch ww join work_item w on w.root_id = ww.root_id
          where w.id = new.work_item_id and ww.member_id is distinct from new.actor_member_id
        )
        or (
          new.type = 'transition' and exists (
            select 1 from workflow_transition tr
            where tr.id = new.transition_id and tr.notifications is not null
              and jsonb_path_exists(tr.notifications, '$[*] ? (@.to == "raiser" || @.to == "position")')
          )
        )
      then
        insert into outbox (kind, project_id, payload, created_at, available_at)
        values ('notification', new.project_id,
          jsonb_strip_nulls(jsonb_build_object('work_item_id', new.work_item_id, 'work_item_event_id', new.id,
            'actor_member_id', new.actor_member_id)),
          new.created_at, now());
      end if;
      return null;
    end
  $$;

-- As in 20261216100000_notification_helpers.sql, but a watched event also reaches the
-- Members its Transition names (app.transition_notice_members).
create or replace function app.deliver_notification(p_outbox_id uuid) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_row record;
      v_assignment record;
      v_event record;
      v_actor uuid;
      v_recipient uuid;
      v_recipients uuid[];
      v_waiting uuid[];
      v_sent_back_to uuid[];
      v_count integer := 0;
    begin
      perform app.require_worker();
      select * into v_row from outbox where id = p_outbox_id;
      v_actor := (v_row.payload ->> 'actor_member_id')::uuid;

      -- A closed Project goes quiet: what was still in the outbox reaches nobody.
      if not exists (
        select 1 from work_item w join project p on p.id = w.project_id and p.status = 'active'
        where w.id = (v_row.payload ->> 'work_item_id')::uuid
      ) then
        return 0;
      end if;

      if v_row.payload ->> 'notification' = 'sent_back' then
        select e.* into v_event from work_item_event e
        join project p on p.id = e.project_id and p.status = 'active'
        where e.id = (v_row.payload ->> 'work_item_event_id')::uuid
          and e.work_item_id = (v_row.payload ->> 'work_item_id')::uuid;
        if v_event.id is null then
          return 0;
        end if;
        foreach v_recipient in array array(select s.member_id from app.sent_back_members(v_event.work_item_id, v_event.created_at) s) loop
          continue when v_recipient = v_actor;
          v_count := v_count + app.notify_member(
            p_outbox_id, v_recipient, v_event.project_id, v_event.work_item_id, 'sent_back', null,
            null, null, v_event.id, 'transition', null);
        end loop;
        return v_count;
      end if;

      if v_row.payload ->> 'notification' = 'vacancy' then
        select a.*, co.authorized_person_id into v_assignment from step_assignment a
        join project p on p.id = a.project_id and p.status = 'active'
        join participant pa on pa.id = a.participant_id
        join company co on co.id = pa.company_id
        where a.id = (v_row.payload ->> 'step_assignment_id')::uuid
          and a.work_item_id = (v_row.payload ->> 'work_item_id')::uuid
          -- Filled again before delivery: nothing to name.
          and a.status = 'vacant';
        if v_assignment.id is null or v_assignment.authorized_person_id is null then
          return 0;
        end if;
        return app.notify_member(
          p_outbox_id, v_assignment.authorized_person_id, v_assignment.project_id, v_assignment.work_item_id, 'vacancy', null,
          v_assignment.step_id, v_assignment.id, null, null, null);
      end if;

      if v_row.payload ? 'work_item_event_id' then
        select e.*, w.revision_no, tr.kind as transition_kind into v_event from work_item_event e
        join work_item w on w.id = e.work_item_id
        left join workflow_transition tr on tr.id = e.transition_id
        where e.id = (v_row.payload ->> 'work_item_event_id')::uuid
          and e.work_item_id = (v_row.payload ->> 'work_item_id')::uuid;
        if v_event.id is null then
          return 0;
        end if;
        -- Those the event made it wait on hear of it as "Step reached", not twice.
        -- (Its holder when it was handed to one, otherwise its Step Pool.)
        v_waiting := array(
          select a.assignee_member_id from step_assignment a
          where a.work_item_id = v_event.work_item_id and a.created_at = v_event.created_at
            and a.claimed_at = a.created_at
          union
          select p.member_id from step_assignment a
          cross join app.step_pool(a.work_item_id, a.step_id, a.participant_id) p
          where a.work_item_id = v_event.work_item_id and a.created_at = v_event.created_at
            and a.claimed_at is distinct from a.created_at);
        -- Those it was Sent Back to hear of it as "Sent Back" only.
        v_sent_back_to := case when v_event.transition_kind = 'send_back'
          then array(select s.member_id from app.sent_back_members(v_event.work_item_id, v_event.created_at) s)
          else '{}' end;
        -- Who watches the chain and still sees this item (scenario 68, V1), and the
        -- raiser or Position Members its Transition names; each is checked again, as
        -- that Member, in app.notify_member. Of them, V5: an internal event reaches
        -- only its own Participant's Members.
        v_recipients := array(
          select w.member_id from app.work_item_watchers(v_event.work_item_id) w
          union
          select t.member_id from app.transition_notice_members(v_event.id) t);
        foreach v_recipient in array v_recipients loop
          continue when v_recipient = v_actor or v_recipient = any (v_waiting) or v_recipient = any (v_sent_back_to);
          v_count := v_count + app.notify_member(
            p_outbox_id, v_recipient, v_event.project_id, v_event.work_item_id, 'watched_event',
            app.event_outcome(v_event.type, v_event.payload), null, null, v_event.id,
            case v_event.type when 'created' then 'revision_created' else v_event.type end,
            v_event.audience_participant_id);
        end loop;
        return v_count;
      end if;

      select a.* into v_assignment from step_assignment a
      where a.id = (v_row.payload ->> 'step_assignment_id')::uuid
        and a.work_item_id = (v_row.payload ->> 'work_item_id')::uuid
        and a.status in ('pooled', 'claimed');
      -- The item moved on before delivery: it no longer waits for them.
      if v_assignment.id is null then
        return 0;
      end if;
      -- A Step a Send Back gave back: its Participant hears of it as "Sent Back".
      if exists (
        select 1 from work_item_event e join workflow_transition tr on tr.id = e.transition_id
        where e.work_item_id = v_assignment.work_item_id and e.created_at = v_assignment.created_at
          and e.type = 'transition' and tr.kind = 'send_back'
      ) then
        return 0;
      end if;

      for v_recipient in
        select r.member_id from (
          select v_assignment.assignee_member_id as member_id where v_assignment.status = 'claimed'
          union
          select p.member_id
          from app.step_pool(v_assignment.work_item_id, v_assignment.step_id, v_assignment.participant_id) p
          where v_assignment.status = 'pooled'
        ) r
        -- Never the Member whose move it was.
        where r.member_id is distinct from v_actor
      loop
        v_count := v_count + app.notify_member(
          p_outbox_id, v_recipient, v_assignment.project_id, v_assignment.work_item_id, 'step_reached', null,
          v_assignment.step_id, v_assignment.id, null, null, null);
      end loop;
      return v_count;
    end
  $$;

revoke all on function
  app.notification_route(text, text, text, text[], boolean, boolean),
  app.transition_notice_members(uuid)
  from public;
