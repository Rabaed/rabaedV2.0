-- RP-1238 (owner's decision 2026-11-06, while approving RP-1154's gap table): a Member's
-- mute on a Project stops email only, as Pause all email does. The bell still rings for a
-- muted Project; an outcome a watcher didn't tick still silences both.
--
-- * app.notification_route is rebuilt from 20270101000000_transition_notifications.sql (its
--   latest definition) with the mute moved from the "silent" branch to the "no email"
--   branch. The same rule as @rabaed/domain's routeNotification (a seam-2 test checks both
--   on every combination).
-- * Nothing else is rebuilt. Every delivery path reads the route through
--   app.member_notification_route: the Step reached, Sent Back and watched notices, the
--   package notice (app.notify_member_of_package) and Record ready (app.deliver_record_ready,
--   whose own mute filter went in 20271007000000_record_ready_email.sql). They write a bell
--   row whenever the route's in_app is true. The send-time email checks
--   (app.take_notification_email, app.notification_email_content, the digest and
--   app.take_step_age_report) refuse an email whose route is 'none', which a mute still gives.
-- * Visibility doesn't change: the mute only decides whether a notice the Member may already
--   receive reaches their bell; who receives it, and the as-that-Member check at delivery,
--   stay as they are.

create or replace function app.notification_route(
  p_kind text, p_outcome text, p_email text, p_outcomes text[], p_muted boolean, p_email_paused boolean
) returns table (in_app boolean, email text)
  language plpgsql immutable
  as $$
    declare
      v_in_app boolean := p_kind <> 'weekly_report';
    begin
      if p_kind = 'watched_event'
        and p_outcome = any (array['A', 'B', 'C', 'D', 'passed', 'passed_with_comments', 'failed', 'approved', 'rejected', 'cancelled'])
        and not (p_outcome = any (p_outcomes))
      then
        return query select false, 'none'::text;
        return;
      end if;
      -- A muted Project, a pause or a group's email off: the bell only.
      if p_muted or p_email_paused or p_email = 'off' then
        return query select v_in_app, 'none'::text;
        return;
      end if;
      return query select v_in_app, case when p_kind = 'weekly_report' then 'immediate' else p_email end;
    end
  $$;
