-- RP-677: snag report outbox kind.
-- RP-677: the outbox kind 'snag_report' (the Snag report's worker job, 20270929000000_snag_report.sql).
-- Rebuilt after main's own change (RP-621's 'working_copy', 20270928000000_working_copy.sql) with every kind either side allows
-- (planning/parallel-sessions.md rule 11.1).

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check
  check (kind in ('notification', 'email', 'digest', 'step_age_report', 'documental_record', 'record_ready', 'documental_record_reproduce', 'working_copy', 'snag_report'));
