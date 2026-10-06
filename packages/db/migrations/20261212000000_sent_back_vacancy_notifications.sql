-- The Sent Back and Vacancy notifications (RP-356, spec RP-344 "Notifications";
-- visibility.md the Notifications row; workflow-engine.md §9; GLOSSARY "Send
-- Back", "Vacancy").
--
-- * Sent Back: when a send_back Transition is taken (RP-334), the Members of the
--   Participant it is sent back to (the one its new Step belongs to) who see the
--   item then hear of it, routed by their "Sent Back" settings. Its text names
--   the Company that sent it back by name only (V14): it is the event's, read
--   like a watched event's. For them it is the one notification of that move:
--   they get no "Step reached" for the Step it gave back, nor a watched-item
--   notification of it. Everyone else watching hears of it as before.
-- * Vacancy: when a Step's assignment becomes vacant (its holder left the
--   Project; RP-108 makes it so, nothing does yet), the Authorized Person of the
--   Participant's Company hears of it, if they see the item, routed by their
--   "Vacancy" settings, to name a replacement. No other Company does. It is
--   delivered only while the assignment is still vacant.
-- * Both: nothing for a closed Project, checked at delivery.

alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check
  check (kind in ('step_reached', 'watched_event', 'sent_back', 'vacancy'));
alter table notification
  add constraint notification_sent_back check (kind <> 'sent_back' or (work_item_event_id is not null and event_type = 'transition')),
  add constraint notification_vacancy check (kind <> 'vacancy' or (step_id is not null and step_assignment_id is not null));

-- A Send Back: an outbox row for the Participant it is sent back to.
create function app.outbox_sent_back() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if exists (select 1 from workflow_transition tr where tr.id = new.transition_id and tr.kind = 'send_back') then
        insert into outbox (kind, project_id, payload, created_at, available_at)
        values ('notification', new.project_id,
          jsonb_strip_nulls(jsonb_build_object('notification', 'sent_back', 'work_item_id', new.work_item_id,
            'work_item_event_id', new.id, 'actor_member_id', new.actor_member_id)),
          new.created_at, now());
      end if;
      return null;
    end
  $$;
create trigger work_item_event_outbox_sent_back after insert on work_item_event
  for each row when (new.type = 'transition' and new.transition_id is not null)
  execute function app.outbox_sent_back();

-- A Step's assignment becoming vacant: an outbox row for its Company's Authorized Person.
create function app.outbox_vacancy() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into outbox (kind, project_id, payload, created_at, available_at)
      values ('notification', new.project_id,
        jsonb_build_object('notification', 'vacancy', 'work_item_id', new.work_item_id, 'step_assignment_id', new.id),
        now(), now());
      return null;
    end
  $$;
create trigger step_assignment_outbox_vacancy after update of status on step_assignment
  for each row when (old.status <> 'vacant' and new.status = 'vacant')
  execute function app.outbox_vacancy();

-- The Members of the Participant item `p_work_item_id` was Sent Back to by the
-- Send Back taken at `p_event_created_at` (the Participant of the Step it gave
-- back, created with it): its active Project Members. Delivery checks who of
-- them sees it.
create function app.sent_back_members(p_work_item_id uuid, p_event_created_at timestamptz) returns table (member_id uuid)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select distinct pm.member_id
        from step_assignment a
        join project_member pm on pm.participant_id = a.participant_id and pm.status = 'active'
        join member m on m.id = pm.member_id and m.status = 'active'
        where a.work_item_id = p_work_item_id and a.created_at = p_event_created_at;
    end
  $$;

-- Delivers a notification row, to the Members who should hear of it then, each
-- only if they still see the item and through their settings (the routing rule):
-- * a Step reached: the open assignment's holder, or its Step Pool;
-- * a watched event: the chain's watchers who may read the event;
-- * a Send Back: the Members of the Participant it was sent back to;
-- * a Vacancy: the Authorized Person of the vacant Step's Company.
-- Never the Member whose move it was (but a Vacancy's: the Authorized Person who
-- removed its holder still has to fill it). A Send Back or Vacancy of a closed
-- Project reaches nobody. Returns how many Members got it now.
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
      v_sent_back_to uuid[];
      v_route record;
      v_count integer := 0;
      v_inserted integer;
    begin
      perform app.require_worker();
      select * into v_row from outbox where id = p_outbox_id;
      v_actor := (v_row.payload ->> 'actor_member_id')::uuid;

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
          perform set_config('app.member_id', v_recipient::text, true);
          if app.sees_work_item(v_event.work_item_id) then
            select * into v_route from app.member_notification_route(v_recipient, v_event.project_id, 'sent_back', null);
            if v_route.in_app or v_route.email <> 'none' then
              insert into notification (
                member_id, project_id, work_item_id, outbox_id, kind, work_item_event_id, event_type, in_app, email
              ) values (
                v_recipient, v_event.project_id, v_event.work_item_id, p_outbox_id, 'sent_back', v_event.id,
                'transition', v_route.in_app, v_route.email
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
        v_recipient := v_assignment.authorized_person_id;
        perform set_config('app.member_id', v_recipient::text, true);
        if app.sees_work_item(v_assignment.work_item_id) then
          select * into v_route from app.member_notification_route(v_recipient, v_assignment.project_id, 'vacancy', null);
          if v_route.in_app or v_route.email <> 'none' then
            insert into notification (
              member_id, project_id, work_item_id, outbox_id, kind, step_id, step_assignment_id, in_app, email
            ) values (
              v_recipient, v_assignment.project_id, v_assignment.work_item_id, p_outbox_id, 'vacancy',
              v_assignment.step_id, v_assignment.id, v_route.in_app, v_route.email
            )
            on conflict (outbox_id, member_id) do nothing;
            get diagnostics v_count = row_count;
          end if;
        end if;
        perform set_config('app.member_id', '', true);
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
        -- Those it was Sent Back to hear of it as "Sent Back" only.
        v_sent_back_to := case when v_event.transition_kind = 'send_back'
          then array(select s.member_id from app.sent_back_members(v_event.work_item_id, v_event.created_at) s)
          else '{}' end;
        -- Who watches the chain and still sees this item (scenario 68, V1).
        v_watchers := array(select w.member_id from app.work_item_watchers(v_event.work_item_id) w);
        foreach v_recipient in array v_watchers loop
          continue when v_recipient = v_actor or v_recipient = any (v_waiting) or v_recipient = any (v_sent_back_to);
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
  app.outbox_sent_back(),
  app.outbox_vacancy(),
  app.sent_back_members(uuid, timestamptz)
  from public;
