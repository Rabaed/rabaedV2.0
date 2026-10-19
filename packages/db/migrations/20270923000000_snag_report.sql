-- RP-677 (spec RP-619; ADR 0023; docs/visibility.md V3, V14, scenarios RP-677-n): the Snag report, a
-- plain PDF of the Snag List items a Member sees, rendered by the worker with the Documental Record's
-- headless-Chromium pipeline. Not PDF/A-3, not sealed, not a Documental Record.
--
-- * snag_report: one row for each report a Member asks for. `content` is the snapshot the api read
--   as that Member, through the Snag List's own visible-items read, when they asked: exactly the
--   rows (and, per row, the one photo) they saw then; the worker prints it and reads nothing else
--   about the items. Row-level security lets a Member read only their own rows, and the app role
--   has no grant on the table: it is reached through the functions below.
-- * app.request_snag_report(project, language, content): for a Member of the Project; queues the
--   row for the worker (outbox kind 'snag_report', ids only) and returns the report's id; null for
--   anyone who is not on the Project.
-- * app.snag_report_state(report): 'preparing', 'ready' (with the PDF's storage key and file name)
--   or 'failed' (its job was dead-lettered), for the Member who asked; no row for anyone else and
--   for a made-up id.
-- * app.snag_report_job / app.save_snag_report: the worker's.
-- outbox_kind_check lists every kind on main plus RP-621's 'working_copy' (claimed on RP-603), so
-- whichever of the two sorts last keeps the other's kind.

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check
  check (kind in ('notification', 'email', 'digest', 'step_age_report', 'documental_record', 'record_ready', 'documental_record_reproduce', 'working_copy', 'snag_report'));

create table snag_report (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id),
  member_id uuid not null references member (id),
  language text not null check (language in ('en', 'ar')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  outbox_id uuid references outbox (id),
  file_id uuid references stored_file (id),
  made_at timestamptz,
  created_at timestamptz not null default now(),
  check ((file_id is null) = (made_at is null))
);
alter table snag_report enable row level security;
revoke all on snag_report from rabaed_app;
create policy snag_report_owner on snag_report for select to rabaed_app using (member_id = app.current_member_id());

create function app.request_snag_report(p_project_id uuid, p_language text, p_content jsonb) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member uuid := app.current_member_id();
      v_report uuid := gen_random_uuid();
      v_outbox uuid;
    begin
      if v_member is null or p_language not in ('en', 'ar') or jsonb_typeof(p_content) is distinct from 'object'
        or not exists (select 1 from app.current_project_ids() x where x = p_project_id)
      then
        return null;
      end if;
      insert into outbox (kind, project_id, payload)
      values ('snag_report', p_project_id, jsonb_build_object('snag_report_id', v_report))
      returning id into v_outbox;
      insert into snag_report (id, project_id, member_id, language, content, outbox_id)
      values (v_report, p_project_id, v_member, p_language, p_content, v_outbox);
      return v_report;
    end
  $$;
revoke all on function app.request_snag_report(uuid, text, jsonb) from public;
grant execute on function app.request_snag_report(uuid, text, jsonb) to rabaed_app;

create function app.snag_report_state(p_report_id uuid)
  returns table (status text, storage_key text, file_name text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if app.current_member_id() is null then
        return;
      end if;
      return query
        select case when r.file_id is not null then 'ready' when o.dead_at is not null then 'failed' else 'preparing' end,
          f.storage_key,
          case when r.file_id is not null then 'snag-report.pdf' end
        from snag_report r
        left join outbox o on o.id = r.outbox_id
        left join stored_file f on f.id = r.file_id
        where r.id = p_report_id and r.member_id = app.current_member_id();
    end
  $$;
revoke all on function app.snag_report_state(uuid) from public;
grant execute on function app.snag_report_state(uuid) to rabaed_app;

-- What the worker prints, for a 'snag_report' outbox row not yet made; no row otherwise.
create function app.snag_report_job(p_outbox_id uuid)
  returns table (report_id uuid, project_id uuid, language text, content jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      perform app.require_worker();
      return query
        select r.id, r.project_id, r.language, r.content
        from snag_report r
        join outbox o on o.id = r.outbox_id and o.kind = 'snag_report'
        where o.id = p_outbox_id and r.file_id is null;
    end
  $$;
revoke all on function app.snag_report_job(uuid) from public;
grant execute on function app.snag_report_job(uuid) to rabaed_app;

-- The worker's write of the made PDF. False when the row is not a snag report job or it is made already.
create function app.save_snag_report(p_outbox_id uuid, p_storage_key text, p_sha256 bytea, p_size bigint) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_report uuid;
      v_file uuid;
    begin
      perform app.require_worker();
      select r.id into v_report
      from snag_report r
      join outbox o on o.id = r.outbox_id and o.kind = 'snag_report'
      where o.id = p_outbox_id and r.file_id is null
      for update of r;
      if v_report is null then
        return false;
      end if;
      insert into stored_file (storage_key, sha256, size, mime)
      values (p_storage_key, p_sha256, p_size, 'application/pdf') returning id into v_file;
      update snag_report set file_id = v_file, made_at = now() where id = v_report;
      return true;
    end
  $$;
revoke all on function app.save_snag_report(uuid, text, bytea, bigint) from public;
grant execute on function app.save_snag_report(uuid, text, bytea, bigint) to rabaed_app;
