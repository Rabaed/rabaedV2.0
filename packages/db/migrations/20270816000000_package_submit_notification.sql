-- RP-643: the grouped notification of a Package Submit (spec RP-616 "Grouped notification";
-- visibility.md scenario RP-588-2; data-model.md notification).
--
-- * A Submit Package takes each item's Submit through app.take_transition, and each new open
--   assignment writes its "Step reached" outbox row as for a single Submit
--   (app.outbox_step_reached). When the Submit is recorded in the Package's trail
--   (package_event `submitted`, app.record_package_submit, same transaction), trigger
--   package_event_group_notifications takes those rows out of the outbox and writes one
--   instead: `{notification: package_submitted, package_id, step_assignment_ids}`. Nothing
--   here changes app.take_transition or app.transition_effects; watched-item and other
--   outbox rows of the Submits are left as they are, and the Activity Feed is unchanged.
-- * Delivery (app.deliver_package_submitted, from app.deliver_notification): one notification
--   per Member those assignments wait on (the holder, or the Step Pool; never the actor), of
--   kind `package_submitted` with the Package id, holding the assignments of the items that
--   Member sees then (notification_package_item). Routed as "Step reached" (its settings
--   group), with mute, pause and the email choice. A single Submit of an item added later
--   notifies as before.
-- * Count: the items of the notification the Member sees now, never a total of the
--   Package's (app.package_notification_count). The bell shows it only while that is at
--   least one, and names the Package (number, name, owning Company by name, V14) only then
--   (app.notification_package): the spec's rule, a Package is seen by whoever sees one of
--   its items.
-- * Withdrawn, as a "Step reached" is, once colleagues have picked up every one of its
--   Steps (trigger step_assignment_withdraw_package_submitted).
-- * Emails and the digest: app.notification_email_content gives a package notification's
--   Package and count, as the recipient sees it at send time, and sends it only while one of
--   its Steps still waits; its result (and so app.take_notification_email's and
--   app.take_notification_digest's) gains the Package's columns.

alter table notification alter column work_item_id drop not null;
alter table notification add column package_id uuid references package (id);
alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check
  check (kind in ('step_reached', 'watched_event', 'sent_back', 'package_submitted'));
-- A package notification is about its Package, every other about one item.
alter table notification add constraint notification_package_submitted
  check (case when kind = 'package_submitted' then package_id is not null and work_item_id is null
    else package_id is null and work_item_id is not null end);

-- The Steps a package notification stands for: the assignments the Submit gave its items
-- that waited on its Member, of the items they saw at delivery. Only the definer functions
-- below read it.
create table notification_package_item (
  notification_id uuid not null references notification (id),
  step_assignment_id uuid not null references step_assignment (id),
  work_item_id uuid not null references work_item (id),
  primary key (notification_id, step_assignment_id)
);
create index notification_package_item_assignment_idx on notification_package_item (step_assignment_id);
alter table notification_package_item enable row level security;
revoke all on notification_package_item from rabaed_app;

-- Collecting -------------------------------------------------------------------------------

-- A Submit Package recorded: the undelivered "Step reached" rows of the assignments its
-- Submits opened (each item's assignments from the moment it was Submitted) become one row.
create function app.group_package_submit_notifications() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_assignments uuid[];
      v_first uuid;
    begin
      with taken as (
        delete from outbox o
        using step_assignment a, work_item w
        where o.kind = 'notification' and o.processed_at is null and o.dead_at is null
          and not (o.payload ? 'notification') and not (o.payload ? 'handed_over_to')
          and o.payload ->> 'step_assignment_id' = a.id::text
          and w.id = a.work_item_id and w.package_id = new.package_id
          and w.id in (select x::uuid from jsonb_array_elements_text(new.payload -> 'work_item_ids') x)
          and a.created_at = w.submitted_at
        returning a.id, a.work_item_id
      )
      select array_agg(t.id order by t.id), min(t.work_item_id::text)::uuid into v_assignments, v_first from taken t;
      if v_assignments is not null then
        insert into outbox (kind, project_id, payload, created_at, available_at)
        values ('notification', new.project_id,
          jsonb_build_object('notification', 'package_submitted', 'package_id', new.package_id, 'work_item_id', v_first,
            'step_assignment_ids', to_jsonb(v_assignments), 'actor_member_id', new.actor_member_id),
          new.created_at, now());
      end if;
      return null;
    end
  $$;
create trigger package_event_group_notifications after insert on package_event
  for each row when (new.type = 'submitted')
  execute function app.group_package_submit_notifications();

-- Delivering -------------------------------------------------------------------------------

-- Delivers package notification row p_outbox_id to Member p_member_id, for those of
-- assignments p_assignment_ids whose items they see (as that Member), through their
-- settings. Returns 1 when a row was written, else 0. Leaves the session's Member as it
-- found it. Only app.deliver_package_submitted calls it.
create function app.notify_member_of_package(
  p_outbox_id uuid, p_member_id uuid, p_project_id uuid, p_package_id uuid, p_assignment_ids uuid[]
) returns integer
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_saved text := current_setting('app.member_id', true);
      v_seen uuid[];
      v_route record;
      v_id uuid;
    begin
      perform set_config('app.member_id', p_member_id::text, true);
      v_seen := array(select a.id from step_assignment a where a.id = any (p_assignment_ids) and app.sees_work_item(a.work_item_id));
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
      if cardinality(v_seen) = 0 then
        return 0;
      end if;
      select * into v_route from app.member_notification_route(p_member_id, p_project_id, 'package_submitted', null);
      if not v_route.in_app and v_route.email = 'none' then
        return 0;
      end if;
      insert into notification (member_id, project_id, work_item_id, package_id, outbox_id, kind, in_app, email)
      values (p_member_id, p_project_id, null, p_package_id, p_outbox_id, 'package_submitted', v_route.in_app, v_route.email)
      on conflict (outbox_id, member_id) do nothing
      returning id into v_id;
      if v_id is null then
        return 0;
      end if;
      insert into notification_package_item (notification_id, step_assignment_id, work_item_id)
      select v_id, a.id, a.work_item_id from step_assignment a where a.id = any (v_seen);
      return 1;
    end
  $$;

-- Delivers a package notification row to the Members its assignments wait on now: the
-- holder of one picked up, the Step Pool of one pooled; never the Member whose Submit it
-- was. The Package gone (an Open Package deleted can't have been Submitted): nobody.
create function app.deliver_package_submitted(p_outbox_id uuid) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_row record;
      v_package record;
      v_r record;
      v_count integer := 0;
    begin
      perform app.require_worker();
      select * into v_row from outbox where id = p_outbox_id;
      select k.id, k.project_id into v_package from package k
      where k.id = (v_row.payload ->> 'package_id')::uuid and k.discarded_at is null;
      if v_package.id is null then
        return 0;
      end if;
      for v_r in
        with assignments as (
          select a.* from step_assignment a
          where a.id in (select x::uuid from jsonb_array_elements_text(v_row.payload -> 'step_assignment_ids') x)
            and a.status in ('pooled', 'picked_up')
        ), waiting as (
          select a.id, a.assignee_member_id as member_id from assignments a where a.status = 'picked_up'
          union
          select a.id, p.member_id from assignments a
          cross join app.step_pool(a.work_item_id, a.step_id, a.participant_id) p
          where a.status = 'pooled'
        )
        select w.member_id, array_agg(w.id) as assignment_ids from waiting w
        where w.member_id is distinct from (v_row.payload ->> 'actor_member_id')::uuid
        group by w.member_id
      loop
        v_count := v_count + app.notify_member_of_package(p_outbox_id, v_r.member_id, v_package.project_id, v_package.id, v_r.assignment_ids);
      end loop;
      return v_count;
    end
  $$;

-- RP-643: app.deliver_notification hands a package notification to app.deliver_package_submitted;
-- otherwise the body of 20270112000000_handover.sql.
CREATE OR REPLACE FUNCTION app.deliver_notification(p_outbox_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

      -- A Submit Package (RP-643): one notification per Member it reached.
      if v_row.payload ->> 'notification' = 'package_submitted' then
        return app.deliver_package_submitted(p_outbox_id);
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
            and a.picked_up_at = a.created_at
          union
          select p.member_id from step_assignment a
          cross join app.step_pool(a.work_item_id, a.step_id, a.participant_id) p
          where a.work_item_id = v_event.work_item_id and a.created_at = v_event.created_at
            and a.picked_up_at is distinct from a.created_at);
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
        and a.status in ('pooled', 'picked_up');
      -- The item moved on before delivery: it no longer waits for them.
      if v_assignment.id is null then
        return 0;
      end if;
      -- A Handover (RP-108): "Step reached" for its new holder only, while it is still theirs.
      if v_row.payload ? 'handed_over_to' then
        if v_assignment.status <> 'picked_up'
          or v_assignment.assignee_member_id is distinct from (v_row.payload ->> 'handed_over_to')::uuid
          or v_assignment.assignee_member_id = v_actor then
          return 0;
        end if;
        return app.notify_member(
          p_outbox_id, v_assignment.assignee_member_id, v_assignment.project_id, v_assignment.work_item_id, 'step_reached', null,
          v_assignment.step_id, v_assignment.id, null, null, null);
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
          select v_assignment.assignee_member_id as member_id where v_assignment.status = 'picked_up'
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
  $function$;

-- A package notification follows the "Step reached" settings group. Otherwise the body of
-- 20270101000000_transition_notifications.sql.
create or replace function app.member_notification_route(p_member_id uuid, p_project_id uuid, p_kind text, p_outcome text)
  returns table (in_app boolean, email text)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_group text := case p_kind when 'watched_event' then 'watched' when 'package_submitted' then 'step_reached' else p_kind end;
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

-- Withdrawing ------------------------------------------------------------------------------

-- A Step of a package notification picked up: once none of its Steps waits on its Member
-- any more (each picked up by a colleague, or moved on), it is withdrawn, as a "Step
-- reached" is.
create function app.withdraw_package_submitted() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      update notification n set withdrawn_at = new.picked_up_at
      where n.kind = 'package_submitted' and n.read_at is null and n.withdrawn_at is null
        and n.member_id is distinct from new.assignee_member_id
        and n.id in (select i.notification_id from notification_package_item i where i.step_assignment_id = new.id)
        and not exists (
          select 1 from notification_package_item i join step_assignment a on a.id = i.step_assignment_id
          where i.notification_id = n.id
            and (a.status = 'pooled' or (a.status = 'picked_up' and a.assignee_member_id = n.member_id))
        );
      return null;
    end
  $$;
create trigger step_assignment_withdraw_package_submitted after update of status on step_assignment
  for each row when (old.status = 'pooled' and new.status = 'picked_up')
  execute function app.withdraw_package_submitted();

-- Reading ----------------------------------------------------------------------------------

-- How many items of the acting Member's own package notification p_notification_id they see
-- now; 0 for anyone else's, and for any other notification.
create function app.package_notification_count(p_notification_id uuid) returns integer
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select count(*)::integer from notification n
        join notification_package_item i on i.notification_id = n.id
        where n.id = p_notification_id and n.member_id = app.current_member_id()
          and app.sees_work_item(i.work_item_id)
      );
    end
  $$;

-- The Package of the acting Member's own package notification p_notification_id, while they
-- see one of its items: its number's sequence, name, owning Company by name (V14), and how
-- many of its items they see. No row otherwise.
create function app.notification_package(p_notification_id uuid)
  returns table (package_id uuid, seq integer, name jsonb, company_name jsonb, item_count integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_count integer := app.package_notification_count(p_notification_id);
    begin
      if v_count = 0 then
        return;
      end if;
      return query
        select k.id, k.seq, k.name, co.legal_name, v_count
        from notification n
        join package k on k.id = n.package_id
        join participant p on p.id = k.participant_id
        join company co on co.id = p.company_id
        where n.id = p_notification_id;
    end
  $$;

-- The bell: a package notification while the Member sees one of its items.
alter policy member_reads_own_notifications on notification
  using (member_id = app.current_member_id() and in_app and withdrawn_at is null
    and case when package_id is null then work_item_id in (select id from work_item)
      else app.package_notification_count(id) > 0 end);

-- Emailing ---------------------------------------------------------------------------------

-- RP-643: a package notification's Package and count; otherwise the body of
-- 20270112000000_handover.sql, with the Package's columns null.
drop function app.take_notification_digest(uuid);
drop function app.take_notification_email(uuid);
drop function app.notification_email_content(uuid, text);

create function app.notification_email_content(p_notification_id uuid, p_email text)
  returns table (
    to_address text, language text, kind text, project_id uuid, project_name jsonb, work_item_id uuid,
    document_number text, subject text, step_name jsonb, event_type text, transition_label jsonb, outcome text,
    company_name jsonb, signer_name jsonb, created_at timestamptz,
    package_id uuid, package_seq integer, package_name jsonb, package_company_name jsonb, item_count integer
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_saved text := current_setting('app.member_id', true);
      v_n record;
      v_event_id uuid;
      v_transition_id uuid;
      v_actor_participant uuid;
      v_audience text;
      v_audience_participant uuid;
      v_outcome text;
      v_email text;
      v_sees boolean;
    begin
      perform app.require_worker();
      select n.* into v_n from notification n where n.id = p_notification_id;
      if v_n.id is null or v_n.withdrawn_at is not null then
        return;
      end if;
      -- A closed Project goes quiet.
      if not exists (select 1 from project p where p.id = v_n.project_id and p.status = 'active') then
        return;
      end if;
      -- A Step reached them: only while it still waits.
      if v_n.kind = 'step_reached' and not exists (
        select 1 from step_assignment a where a.id = v_n.step_assignment_id and a.status in ('pooled', 'picked_up')
      ) then
        return;
      end if;
      -- A Package Submit: only while one of its Steps still waits.
      if v_n.kind = 'package_submitted' and not exists (
        select 1 from notification_package_item i join step_assignment a on a.id = i.step_assignment_id
        where i.notification_id = v_n.id and a.status in ('pooled', 'picked_up')
      ) then
        return;
      end if;
      if v_n.work_item_event_id is not null then
        select e.id, e.transition_id, e.actor_participant_id, e.audience, e.audience_participant_id,
          app.event_outcome(e.type, e.payload)
        into v_event_id, v_transition_id, v_actor_participant, v_audience, v_audience_participant, v_outcome
        from work_item_event e where e.id = v_n.work_item_event_id;
      end if;
      -- Their settings now: email paused, the Project muted, the group's email or ticks changed.
      select r.email into v_email from app.member_notification_route(v_n.member_id, v_n.project_id, v_n.kind, v_outcome) r;
      if v_email is distinct from p_email then
        return;
      end if;

      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_n.member_id::text, true);
      if v_n.kind = 'package_submitted' then
        return query
          select m.email, coalesce(pref.preferred_language, m.locale), v_n.kind, p.id, p.name, null::uuid,
            null::text, null::text, null::jsonb, null::text, null::jsonb, null::text, null::jsonb, null::jsonb,
            v_n.created_at, k.package_id, k.seq, k.name, k.company_name, k.item_count
          from member m
          left join member_notification_preference pref on pref.member_id = m.id
          join project p on p.id = v_n.project_id
          cross join app.notification_package(v_n.id) k
          where m.id = v_n.member_id;
      else
        v_sees := app.sees_work_item(v_n.work_item_id)
          and (v_event_id is null or v_audience = 'shared' or v_audience_participant in (select app.current_participant_ids()));
        if v_sees then
          return query
            select m.email, coalesce(pref.preferred_language, m.locale), v_n.kind, p.id, p.name, w.id, w.document_number, w.title,
              s.name, v_n.event_type, tr.label, v_outcome,
              (select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = v_actor_participant),
              case when v_event_id is not null then app.code_signer_name(v_event_id) end,
              v_n.created_at, null::uuid, null::integer, null::jsonb, null::jsonb, null::integer
            from member m
            left join member_notification_preference pref on pref.member_id = m.id
            join work_item w on w.id = v_n.work_item_id
            join project p on p.id = v_n.project_id
            left join workflow_step s on s.id = v_n.step_id
            left join workflow_transition tr on tr.id = v_transition_id
            where m.id = v_n.member_id;
        end if;
      end if;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
    end
  $$;

-- RP-357's immediate email, with the Package's columns (20261214000000_notification_digest.sql).
create function app.take_notification_email(p_outbox_id uuid)
  returns table (
    to_address text, language text, kind text, work_item_id uuid, document_number text, subject text,
    step_name jsonb, event_type text, transition_label jsonb, outcome text, company_name jsonb, signer_name jsonb,
    package_id uuid, package_seq integer, package_name jsonb, package_company_name jsonb, item_count integer
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_n record;
    begin
      perform app.require_worker();
      select n.* into v_n from outbox o
      join notification n on n.id = (o.payload ->> 'notification_id')::uuid
      where o.id = p_outbox_id and o.kind = 'email'
      for update of n;
      if v_n.id is null or v_n.email <> 'immediate' or v_n.emailed_at is not null then
        return;
      end if;
      return query
        select c.to_address, c.language, c.kind, c.work_item_id, c.document_number, c.subject, c.step_name, c.event_type,
          c.transition_label, c.outcome, c.company_name, c.signer_name,
          c.package_id, c.package_seq, c.package_name, c.package_company_name, c.item_count
        from app.notification_email_content(v_n.id, 'immediate') c;
      if found then
        update notification set emailed_at = now() where id = v_n.id;
      end if;
    end
  $$;

-- RP-358's digest, with the Package's columns (20261214000000_notification_digest.sql).
create function app.take_notification_digest(p_outbox_id uuid)
  returns table (
    to_address text, language text, kind text, project_id uuid, project_name jsonb, work_item_id uuid,
    document_number text, subject text, step_name jsonb, event_type text, transition_label jsonb, outcome text,
    company_name jsonb, signer_name jsonb, created_at timestamptz,
    package_id uuid, package_seq integer, package_name jsonb, package_company_name jsonb, item_count integer
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member_id uuid;
      v_id uuid;
    begin
      perform app.require_worker();
      select (o.payload ->> 'member_id')::uuid into v_member_id from outbox o where o.id = p_outbox_id and o.kind = 'digest';
      if v_member_id is null then
        return;
      end if;
      for v_id in
        select n.id from notification n
        where n.member_id = v_member_id and n.email = 'digest'
          and n.digested_at is null and n.emailed_at is null and n.withdrawn_at is null
        order by n.created_at, n.id
        for update
      loop
        update notification set digested_at = now() where id = v_id;
        return query select * from app.notification_email_content(v_id, 'digest');
      end loop;
    end
  $$;

revoke all on function
  app.group_package_submit_notifications(),
  app.notify_member_of_package(uuid, uuid, uuid, uuid, uuid[]),
  app.deliver_package_submitted(uuid),
  app.withdraw_package_submitted(),
  app.package_notification_count(uuid),
  app.notification_package(uuid),
  app.notification_email_content(uuid, text),
  app.take_notification_email(uuid),
  app.take_notification_digest(uuid)
  from public;
-- The bell's reads; the worker connects as the app role (app.require_worker refuses a Member's session).
grant execute on function
  app.package_notification_count(uuid),
  app.notification_package(uuid),
  app.take_notification_email(uuid),
  app.take_notification_digest(uuid)
  to rabaed_app;
