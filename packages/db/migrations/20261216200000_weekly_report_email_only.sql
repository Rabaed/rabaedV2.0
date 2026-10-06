-- The weekly Step Age report's setting is an email turned on or off (RP-361
-- review). The report is never in the bell and has its own schedule, so an
-- in-app switch or a choice between immediate and digest meant nothing. Its
-- row is stored as `in_app = false` and `email` 'immediate' (on) or 'off'; the
-- routing rule gives it no bell and, while on, 'immediate' (sent on its
-- schedule). The same rule as @rabaed/domain's routeNotification.

update notification_setting
set in_app = false, email = case when email = 'off' then 'off' else 'immediate' end
where notification_group = 'weekly_report';

alter table notification_setting add constraint notification_setting_weekly_report_email_only
  check (notification_group <> 'weekly_report' or (not in_app and email in ('off', 'immediate')));

-- For one recipient of one event: whether it reaches the bell, and how it is
-- emailed ('none', 'immediate', 'digest'). The same rule as @rabaed/domain's
-- routeNotification. p_in_app, p_email and p_outcomes are the recipient's
-- setting for the kind's group.
create or replace function app.notification_route(
  p_kind text, p_outcome text, p_in_app boolean, p_email text, p_outcomes text[], p_muted boolean, p_email_paused boolean
) returns table (in_app boolean, email text)
  language plpgsql immutable
  as $$
    declare
      -- The weekly report is an email only.
      v_in_app boolean := p_kind <> 'weekly_report' and p_in_app;
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
      -- The weekly report, while on, goes on its own schedule.
      return query select v_in_app, case when p_kind = 'weekly_report' then 'immediate' else p_email end;
    end
  $$;

-- The route for one Member of an event of `p_kind` on Project `p_project_id`,
-- from their settings (the defaults where they set none), their mute and pause.
-- Called by delivery only.
create or replace function app.member_notification_route(p_member_id uuid, p_project_id uuid, p_kind text, p_outcome text)
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
        coalesce(v_setting.in_app, v_group <> 'weekly_report'),
        coalesce(v_setting.email, case when v_group in ('step_reached', 'sent_back', 'weekly_report') then 'immediate' else 'digest' end),
        coalesce(v_setting.outcomes,
          array['A', 'B', 'C', 'D', 'passed', 'passed_with_comments', 'failed', 'approved', 'rejected', 'cancelled']),
        exists (select 1 from project_mute m where m.member_id = p_member_id and m.project_id = p_project_id),
        coalesce((select p.email_paused from member_notification_preference p where p.member_id = p_member_id), false)
      ) r;
    end
  $$;
