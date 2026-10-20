-- RP-950: "Record ready" by email and in the daily digest (spec RP-632; visibility.md
-- "Notifications and emails", scenario RP-950-1; RP-155 delivered it in the bell only).
--
-- * Settings: the notification kind 'record_ready' follows the "Items I watch" group
--   ('watched'), whose default is the daily digest. It has no outcome, so the outcome ticks
--   don't apply. app.member_notification_route is rebuilt from
--   20270816000000_package_submit_notification.sql (definition 4) with the one new mapping.
-- * Delivery: app.deliver_record_ready is rebuilt from 20270805000000_record_checks.sql. Who
--   receives it doesn't change (active Members of the Project who see the closed item at
--   delivery, app.sees_work_item as that Member, unless muted). What changes is the row: it
--   takes in_app and email from the Member's route, and no row is written when the route is
--   silent (the mute, or the bell and email both off). 'immediate' reaches the outbox through
--   the existing trigger notification_outbox_email; 'digest' is read by the daily digest job.
-- * Nothing else is rebuilt: app.notification_email_content already writes the item's email
--   for any kind, links to the item (never the file), and checks the route and visibility as
--   the recipient when it is sent.

create or replace function app.member_notification_route(p_member_id uuid, p_project_id uuid, p_kind text, p_outcome text)
  returns table (in_app boolean, email text)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_group text := case p_kind
        when 'watched_event' then 'watched'
        when 'package_submitted' then 'step_reached'
        when 'record_ready' then 'watched'
        else p_kind end;
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

create or replace function app.deliver_record_ready(p_outbox_id uuid) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_saved text := current_setting('app.member_id', true);
      v_item record;
      v_member uuid;
      v_route record;
      v_count integer := 0;
      v_inserted integer;
    begin
      perform app.require_worker();
      select w.id, w.project_id into v_item
      from outbox o
      join work_item w on w.id = (o.payload ->> 'work_item_id')::uuid
      join project p on p.id = w.project_id and p.status = 'active'
      where o.id = p_outbox_id and o.kind = 'record_ready'
        and exists (select 1 from documental_record r where r.work_item_id = w.id and r.status = 'published');
      if v_item.id is null then
        return 0;
      end if;
      for v_member in
        select distinct pm.member_id from project_member pm
        where pm.project_id = v_item.project_id and pm.status = 'active'
        order by pm.member_id
      loop
        -- Exactly the visibility every read of this Member applies.
        perform set_config('app.member_id', v_member::text, true);
        if app.sees_work_item(v_item.id) then
          -- The Member's "Items I watch" settings; a muted Project routes to nothing.
          select r.in_app, r.email into v_route
          from app.member_notification_route(v_member, v_item.project_id, 'record_ready', null) r;
          if v_route.in_app or v_route.email <> 'none' then
            insert into notification (member_id, project_id, work_item_id, outbox_id, kind, in_app, email)
            values (v_member, v_item.project_id, v_item.id, p_outbox_id, 'record_ready', v_route.in_app, v_route.email)
            on conflict (outbox_id, member_id) do nothing;
            get diagnostics v_inserted = row_count;
            v_count := v_count + v_inserted;
          end if;
        end if;
      end loop;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
      return v_count;
    end
  $$;

revoke all on function app.deliver_record_ready(uuid) from public;
grant execute on function app.deliver_record_ready(uuid) to rabaed_app;
