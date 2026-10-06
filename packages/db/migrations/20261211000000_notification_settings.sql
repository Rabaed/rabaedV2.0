-- Notification settings, the routing rule, and in-app notifications for watched
-- items (RP-355, spec RP-344 "Notifications" and "Notification settings";
-- visibility.md the Notifications row and scenario 68; data-model.md §9;
-- workflow-engine.md §5.1 effect 7; design/prompts/views-dashboard-notifications.md §7).
--
-- * Settings, per Member: per group (Step reached · Items I watch · Sent Back ·
--   Vacancy · Weekly report) an in-app switch and an email choice (off,
--   immediate, digest), and for "Items I watch" the outcomes that notify
--   (notification_setting); "Pause all email" and the preferred language for
--   email (member_notification_preference); and a mute per Project
--   (project_mute). A group with no row has the defaults: in-app on; email
--   immediately for Step reached and Sent Back, a digest for the rest; every
--   outcome ticked. Only the Member reads and writes their own settings (RLS);
--   a mute is written through app.set_project_mute, for a Project they are on.
-- * The routing rule, app.notification_route, is @rabaed/domain's routeNotification
--   (a seam-2 test checks both on every combination): a muted Project, or an
--   outcome a watcher didn't tick, silences the bell and email; pausing email
--   stops only email. Delivery applies it to every recipient, and stores the
--   email it chose on the notification (notification.email) for the email and
--   digest jobs to send. A notification for neither the bell nor email is not
--   written; one for email only is written with in_app false and never shown.
--   Need My Action never passes through it.
-- * Watched items: an outbox row for each work_item_event a watcher may hear of
--   (a Transition, a Code or Inspection Result, a Revision created, a cancel)
--   when someone other than its actor watches the item's chain. Never for
--   answers_changed, Documents, claims, Recommended Codes or Internal Notes.
--   Delivery, at delivery time: the chain's watchers who still see the item
--   (app.work_item_watchers, so scenario 68 and V1), and may read the event
--   (V5: an internal move reaches only its own Participant's Members), except
--   its actor and the Members the event made it wait on (they get "Step reached").
-- * A claim withdraws the other pool Members' unread "Step reached" for that Step
--   (scenario 70): they no longer see it in their bell.

-- Settings ----------------------------------------------------------------------------

create table notification_setting (
  member_id uuid not null references member (id),
  notification_group text not null
    check (notification_group in ('step_reached', 'watched', 'sent_back', 'vacancy', 'weekly_report')),
  in_app boolean not null,
  email text not null check (email in ('off', 'immediate', 'digest')),
  -- "Items I watch" only: the outcomes that notify.
  outcomes text[] check (outcomes <@ array['A', 'B', 'C', 'D', 'passed', 'passed_with_comments', 'failed', 'approved',
    'rejected', 'cancelled']),
  updated_at timestamptz not null default now(),
  primary key (member_id, notification_group),
  check ((notification_group = 'watched') = (outcomes is not null))
);

create table member_notification_preference (
  member_id uuid primary key references member (id),
  email_paused boolean not null default false,
  -- Set at first sign-in from the browser's language; until then the Member's locale.
  preferred_language text check (preferred_language in ('en', 'ar')),
  updated_at timestamptz not null default now()
);

-- A Project the Member hears nothing from: no in-app notification, no email.
create table project_mute (
  member_id uuid not null references member (id),
  project_id uuid not null references project (id),
  created_at timestamptz not null default now(),
  primary key (member_id, project_id)
);

alter table notification_setting enable row level security;
alter table member_notification_preference enable row level security;
alter table project_mute enable row level security;
-- The Member's own settings only: nobody else reads or writes them.
create policy member_owns_notification_settings on notification_setting for all to rabaed_app
  using (member_id = app.current_member_id()) with check (member_id = app.current_member_id());
create policy member_owns_notification_preference on member_notification_preference for all to rabaed_app
  using (member_id = app.current_member_id()) with check (member_id = app.current_member_id());
-- Read only; written through app.set_project_mute, like every Project table.
revoke insert, update, delete on project_mute from rabaed_app;
create policy member_reads_own_mutes on project_mute for select to rabaed_app
  using (member_id = app.current_member_id() and project_id in (select app.current_project_ids()));

-- Mutes or unmutes a Project for the acting Member: 'set', or 'not_found' for a
-- Project they are not on.
create function app.set_project_mute(p_project_id uuid, p_muted boolean) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if p_project_id is null or p_project_id not in (select app.current_project_ids()) then
        return 'not_found';
      end if;
      if p_muted then
        insert into project_mute (member_id, project_id) values (app.current_member_id(), p_project_id)
        on conflict do nothing;
      else
        delete from project_mute where member_id = app.current_member_id() and project_id = p_project_id;
      end if;
      return 'set';
    end
  $$;

-- Whether the acting Member holds the Assign permission on any Project they are
-- on: the Weekly Step Age report's recipients (spec RP-344), who see its row.
create function app.holds_assign_permission() returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from project_member pm
        join project_member_position mp on mp.project_member_id = pm.id
        join position_permission pp on pp.position_id = mp.position_id and pp.permission = 'assign'
        where pm.member_id = app.current_member_id() and pm.status = 'active'
          and pm.project_id in (select app.current_project_ids())
      );
    end
  $$;

-- The routing rule ---------------------------------------------------------------------

-- For one recipient of one event: whether it reaches the bell, and how it is
-- emailed ('none', 'immediate', 'digest'). The same rule as @rabaed/domain's
-- routeNotification. p_in_app, p_email and p_outcomes are the recipient's
-- setting for the kind's group.
create function app.notification_route(
  p_kind text, p_outcome text, p_in_app boolean, p_email text, p_outcomes text[], p_muted boolean, p_email_paused boolean
) returns table (in_app boolean, email text)
  language plpgsql immutable
  as $$
    begin
      if p_muted or (
        p_kind = 'watched_event'
        and p_outcome = any (array['A', 'B', 'C', 'D', 'passed', 'passed_with_comments', 'failed', 'approved', 'rejected', 'cancelled'])
        and not (p_outcome = any (p_outcomes))
      ) then
        return query select false, 'none'::text;
        return;
      end if;
      return query select p_in_app, case when p_email_paused or p_email = 'off' then 'none' else p_email end;
    end
  $$;

-- The route for one Member of an event of `p_kind` on Project `p_project_id`,
-- from their settings (the defaults where they set none), their mute and pause.
-- Called by delivery only.
create function app.member_notification_route(p_member_id uuid, p_project_id uuid, p_kind text, p_outcome text)
  returns table (in_app boolean, email text)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_group text := case p_kind when 'watched_event' then 'watched' else p_kind end;
      v_setting record;
    begin
      select s.in_app, s.email, s.outcomes into v_setting
      from notification_setting s where s.member_id = p_member_id and s.notification_group = v_group;
      return query select r.in_app, r.email from app.notification_route(
        p_kind, p_outcome,
        coalesce(v_setting.in_app, true),
        coalesce(v_setting.email, case when v_group in ('step_reached', 'sent_back') then 'immediate' else 'digest' end),
        coalesce(v_setting.outcomes,
          array['A', 'B', 'C', 'D', 'passed', 'passed_with_comments', 'failed', 'approved', 'rejected', 'cancelled']),
        exists (select 1 from project_mute m where m.member_id = p_member_id and m.project_id = p_project_id),
        coalesce((select p.email_paused from member_notification_preference p where p.member_id = p_member_id), false)
      ) r;
    end
  $$;

-- Notifications ----------------------------------------------------------------------

alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in ('step_reached', 'watched_event'));
alter table notification alter column step_id drop not null;
alter table notification
  -- The assignment a "Step reached" is for, so a claim can withdraw it.
  add column step_assignment_id uuid references step_assignment (id),
  -- The event a watched-item notification is about.
  add column work_item_event_id uuid references work_item_event (id),
  -- What happened, for a watched-item notification (a new Revision's event is read by nobody).
  add column event_type text check (event_type in ('transition', 'issue_code', 'revision_created', 'cancelled')),
  -- Shown in the bell; false for one routed to email only.
  add column in_app boolean not null default true,
  -- How it is emailed, as routed at delivery; the email jobs send it.
  add column email text not null default 'none' check (email in ('none', 'immediate', 'digest')),
  -- Withdrawn from the bell: a colleague claimed the Step.
  add column withdrawn_at timestamptz,
  add constraint notification_step_reached_step check (kind <> 'step_reached' or step_id is not null),
  add constraint notification_watched_event check (kind <> 'watched_event' or (work_item_event_id is not null and event_type is not null));
update notification n set step_assignment_id = (o.payload ->> 'step_assignment_id')::uuid
from outbox o where o.id = n.outbox_id and n.kind = 'step_reached';
create index notification_step_assignment_idx on notification (step_assignment_id) where step_assignment_id is not null;

-- The bell: the Member's own, shown in-app, not withdrawn, of items they still see.
alter policy member_reads_own_notifications on notification
  using (member_id = app.current_member_id() and in_app and withdrawn_at is null and work_item_id in (select id from work_item));

-- An event a watcher may hear of, on an item someone other than its actor
-- watches: a Transition (a close or a Send Back too), a Code or Inspection
-- Result, a new Revision, a cancel.
create function app.outbox_watched_event() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if (new.type <> 'created' or exists (select 1 from work_item w where w.id = new.work_item_id and w.revision_no > 0))
        and exists (
          select 1 from work_item_watch ww join work_item w on w.root_id = ww.root_id
          where w.id = new.work_item_id and ww.member_id is distinct from new.actor_member_id
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
create trigger work_item_event_outbox_watched after insert on work_item_event
  for each row when (new.type in ('transition', 'issue_code', 'created', 'cancelled'))
  execute function app.outbox_watched_event();

-- A claim withdraws the other pool Members' unread "Step reached" for that Step.
create function app.withdraw_step_reached() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      update notification set withdrawn_at = new.claimed_at
      where step_assignment_id = new.id and kind = 'step_reached' and read_at is null and withdrawn_at is null
        and member_id is distinct from new.assignee_member_id;
      return null;
    end
  $$;
create trigger step_assignment_withdraw_step_reached after update of status on step_assignment
  for each row when (old.status = 'pooled' and new.status = 'claimed')
  execute function app.withdraw_step_reached();

-- Delivers a notification row, to the Members who should hear of it then, each
-- only if they still see the item and through their settings (the routing rule):
-- * a Step reached: the open assignment's holder, or its Step Pool;
-- * a watched event: the chain's watchers who may read the event.
-- Never the Member whose move it was. Returns how many Members got it now.
create or replace function app.deliver_notification(p_outbox_id uuid) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_row record;
      v_assignment record;
      v_event record;
      v_actor uuid;
      v_outcome text;
      v_recipient uuid;
      v_watchers uuid[];
      v_waiting uuid[];
      v_route record;
      v_count integer := 0;
      v_inserted integer;
    begin
      perform app.require_worker();
      select * into v_row from outbox where id = p_outbox_id;
      v_actor := (v_row.payload ->> 'actor_member_id')::uuid;

      if v_row.payload ? 'work_item_event_id' then
        select e.*, w.revision_no into v_event from work_item_event e join work_item w on w.id = e.work_item_id
        where e.id = (v_row.payload ->> 'work_item_event_id')::uuid
          and e.work_item_id = (v_row.payload ->> 'work_item_id')::uuid;
        if v_event.id is null then
          return 0;
        end if;
        v_outcome := coalesce(v_event.payload ->> 'outcome', case when v_event.type = 'cancelled' then 'cancelled' end);
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
        -- Who watches the chain and still sees this item (scenario 68, V1).
        v_watchers := array(select w.member_id from app.work_item_watchers(v_event.work_item_id) w);
        foreach v_recipient in array v_watchers loop
          continue when v_recipient = v_actor or v_recipient = any (v_waiting);
          perform set_config('app.member_id', v_recipient::text, true);
          -- V5: an internal event reaches only its own Participant's Members.
          if v_event.audience = 'shared' or v_event.audience_participant_id in (select app.current_participant_ids()) then
            select * into v_route from app.member_notification_route(v_recipient, v_event.project_id, 'watched_event', v_outcome);
            if v_route.in_app or v_route.email <> 'none' then
              insert into notification (
                member_id, project_id, work_item_id, outbox_id, kind, work_item_event_id, event_type, in_app, email
              ) values (
                v_recipient, v_event.project_id, v_event.work_item_id, p_outbox_id, 'watched_event', v_event.id,
                case v_event.type when 'created' then 'revision_created' else v_event.type end, v_route.in_app, v_route.email
              )
              on conflict (outbox_id, member_id) do nothing;
              get diagnostics v_inserted = row_count;
              v_count := v_count + v_inserted;
            end if;
          end if;
          perform set_config('app.member_id', '', true);
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
        -- Exactly the visibility every read of this Member applies (layers 2-4).
        perform set_config('app.member_id', v_recipient::text, true);
        if app.sees_work_item(v_assignment.work_item_id) then
          select * into v_route from app.member_notification_route(v_recipient, v_assignment.project_id, 'step_reached', null);
          if v_route.in_app or v_route.email <> 'none' then
            insert into notification (
              member_id, project_id, work_item_id, outbox_id, kind, step_id, step_assignment_id, in_app, email
            ) values (
              v_recipient, v_assignment.project_id, v_assignment.work_item_id, p_outbox_id, 'step_reached',
              v_assignment.step_id, v_assignment.id, v_route.in_app, v_route.email
            )
            on conflict (outbox_id, member_id) do nothing;
            get diagnostics v_inserted = row_count;
            v_count := v_count + v_inserted;
          end if;
        end if;
        perform set_config('app.member_id', '', true);
      end loop;
      return v_count;
    end
  $$;

revoke all on function
  app.set_project_mute(uuid, boolean),
  app.holds_assign_permission(),
  app.notification_route(text, text, boolean, text, text[], boolean, boolean),
  app.member_notification_route(uuid, uuid, text, text),
  app.outbox_watched_event(),
  app.withdraw_step_reached()
  from public;
grant execute on function
  app.set_project_mute(uuid, boolean),
  app.holds_assign_permission()
  to rabaed_app;
