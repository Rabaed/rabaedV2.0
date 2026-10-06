-- A closed Project goes quiet (RP-360, spec RP-344; visibility.md scenario 15).
--
-- * Delivery: app.deliver_notification delivers nothing for an item of a
--   Project that is no longer active, whatever the notification (Step reached,
--   watched item, Sent Back, Vacancy): events still in the outbox when it
--   closes reach nobody, in the bell or by email. Before, only Sent Back and
--   Vacancy checked it. Notifications already delivered stay readable.
-- * Digest: app.enqueue_notification_digests queues a digest only for a Member
--   with something waiting on an active Project, so what was collected on a
--   Project closed since queues nothing. (Taking a digest already left a
--   closed Project's entries out: app.notification_email_content.)
-- * Immediate email and the weekly report already check the Project at send
--   time (app.notification_email_content, app.take_step_age_report), and the
--   report's queueing skips closed Projects (app.enqueue_step_age_reports).

-- Delivers a notification row, to the Members who should hear of it then, each
-- only if they still see the item and through their settings (the routing rule):
-- * a Step reached: the open assignment's holder, or its Step Pool;
-- * a watched event: the chain's watchers who may read the event;
-- * a Send Back: the Members of the Participant it was sent back to;
-- * a Vacancy: the Authorized Person of the vacant Step's Company.
-- Never the Member whose move it was (but a Vacancy's: the Authorized Person who
-- removed its holder still has to fill it). Nothing of a Project that is no
-- longer active reaches anybody. Returns how many Members got it now.
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

-- The daily digest job: one outbox row per Member with notifications waiting for
-- a digest on an active Project, unless one is already waiting to be sent.
-- Returns how many.
create or replace function app.enqueue_notification_digests() returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_count integer;
    begin
      perform app.require_worker();
      insert into outbox (kind, project_id, payload)
      select 'digest', null, jsonb_build_object('member_id', waiting.member_id)
      from (
        select distinct n.member_id from notification n
        join project p on p.id = n.project_id and p.status = 'active'
        where n.email = 'digest' and n.digested_at is null and n.emailed_at is null and n.withdrawn_at is null
      ) waiting
      where not exists (
        select 1 from outbox o
        where o.kind = 'digest' and o.processed_at is null and o.dead_at is null
          and o.payload ->> 'member_id' = waiting.member_id::text
      );
      get diagnostics v_count = row_count;
      return v_count;
    end
  $$;
