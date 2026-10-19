-- RP-616: the notification kinds of both sides of a merge with main (planning/parallel-sessions.md
-- rule 11.1). RP-643 (20270624000000_package_submit_notification.sql) added `package_submitted` and
-- RP-155 (20270805000000_record_checks.sql) added `record_ready`, each rebuilding
-- notification_kind_check from the kinds it knew, so whichever sorts last drops the other's kind.
-- This sorts after both and lists every kind; outbox_kind_check is RP-155's alone (RP-643 adds no
-- outbox kind) and stays as it is.

alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check
  check (kind in ('step_reached', 'watched_event', 'sent_back', 'package_submitted', 'record_ready'));
