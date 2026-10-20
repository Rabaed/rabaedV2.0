-- RP-670 (spec RP-632; ADR 0023; workflow-engine.md §5 and §7): the Record Job Monitor in
-- Rabaed Admin. A record job (an outbox row of kind 'documental_record' or
-- 'documental_record_reproduce') that fails now shows to a Rabaed Engineer with what went
-- wrong, and a job that ran out of attempts can be retried.
--
-- * `outbox.last_failed_at`: when an attempt last failed. `app.outbox_failed` (rebuilt from
--   20270829000000, changing only this) sets it with the error.
-- * app.record_jobs(): every record job that is failing (an attempt failed, more are to come) or
--   dead (out of attempts, and not retried since). Oldest first. For Rabaed Admin only.
-- * Retry: app.retry_record_job queues a FRESH outbox row of the dead job's kind, Project and
--   payload (attempts 0) and records it in `record_job_retry`. The dead row is never reset
--   or changed: its attempts, `dead_at` and `last_error` stay as audit. The fresh row goes
--   through the worker's normal take/hold/attempt rules (RP-958). A dead row is retried once;
--   'already_queued' while a job of the same kind for the same item is waiting or running.
-- * app.documental_record_alerts (rebuilt from 20270805000000, changing only this): a dead
--   job that has been retried is no longer a 'job_failed' alert; its fresh row is judged on
--   its own.
-- * app.documental_record_history and app.documental_record_check_runs: an item's Re-produce
--   requests (who asked, why, and how each ended) and what each run of the checks found, for
--   Rabaed Admin's History view.
-- * record_job_retry is admin-only, like documental_record_reproduction: no grant to the app
--   role, read-only for rabaed_admin, written by app.retry_record_job, never changed. The
--   error text stays Rabaed's: a Member sees "being prepared" or nothing, never a failure.

alter table outbox add column last_failed_at timestamptz;

alter table admin_action drop constraint admin_action_action_check;
alter table admin_action add constraint admin_action_action_check
  check (action in (
    'onboard_company', 'read_onboarding_leads', 'invite_authorized_person', 'close_onboarding_lead',
    'create_option_list', 'add_option', 'rename_option', 'retire_option', 'restore_option',
    'read_numbering', 'set_numbering_pattern', 'set_participant_code', 'set_numbering_counter_start',
    'save_workflow_draft', 'publish_workflow',
    'duplicate_workflow', 'add_default_outcome', 'change_default_outcome', 'reorder_default_outcomes',
    'add_default_stage', 'rename_default_stage', 'reorder_default_stages',
    'refuse_workflow_publish',
    'reproduce_documental_record', 'read_documental_record_alerts',
    'read_register_import', 'preview_register_import', 'confirm_register_import',
    'read_record_jobs', 'retry_record_job', 'read_documental_record_history'
  ));

-- Attempt p_attempts, counted at take, failed: records why and when, and retries the row after
-- p_retry_after_ms or, when that was its last attempt, dead-letters it. 'gone' when the row is
-- processed, dead-lettered, or taken again since (its attempts moved on): a late record never
-- overwrites a later attempt's. (20270829000000, with `last_failed_at`.)
create or replace function app.outbox_failed(p_outbox_id uuid, p_attempts integer, p_error text, p_max_attempts integer, p_retry_after_ms integer)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_attempts integer;
    begin
      perform app.require_worker();
      update outbox set
        last_error = left(p_error, 500),
        last_failed_at = now(),
        available_at = now() + make_interval(secs => p_retry_after_ms / 1000.0),
        dead_at = case when attempts >= p_max_attempts then now() end
      where id = p_outbox_id and attempts = p_attempts and processed_at is null and dead_at is null
      returning attempts into v_attempts;
      return case when v_attempts is null then 'gone' when v_attempts >= p_max_attempts then 'dead' else 'retry' end;
    end
  $$;

-- The item a record job (an outbox row of `p_kind` with `p_payload`) is for: the payload key
-- is `closed_work_item_id` for a 'documental_record' job and `work_item_id` for a
-- 'documental_record_reproduce' job; null for any other kind. The one place that rule is written.
create function app.record_job_item(p_kind text, p_payload jsonb) returns uuid
  language plpgsql immutable
  set search_path = pg_catalog, public
  as $$
    begin
      return case p_kind
        when 'documental_record' then (p_payload ->> 'closed_work_item_id')::uuid
        when 'documental_record_reproduce' then (p_payload ->> 'work_item_id')::uuid
      end;
    end
  $$;
revoke all on function app.record_job_item(text, jsonb) from public;

-- The retry of a dead record job: the dead row, the fresh row that replaced it, and the
-- Engineer's action (with its reason). Written once, never changed.
create table record_job_retry (
  id uuid primary key default gen_random_uuid(),
  dead_outbox_id uuid not null unique references outbox (id),
  outbox_id uuid not null unique references outbox (id),
  -- The caller writes the admin_action after this function returns, in the same transaction.
  admin_action_id uuid not null unique references admin_action (id) deferrable initially deferred,
  created_at timestamptz not null default now()
);

create trigger record_job_retry_kept before update or delete on record_job_retry
  for each row execute function app.refuse_documental_record_history_change();

alter table record_job_retry enable row level security;
revoke all on record_job_retry from rabaed_app;
revoke insert, update, delete, truncate on record_job_retry from rabaed_admin;

-- Every record job that is failing or dead, oldest first (`last_ran_at`; a job that failed
-- before this migration has none). 'failing': an attempt failed and the job waits for the next
-- (`next_try_at`). 'dead': out of attempts and not retried since. `kind` is the outbox row's.
-- It lists what a Rabaed Engineer reads anyway (read through asEngineer).
create function app.record_jobs()
  returns table (
    outbox_id uuid, kind text, work_item_id uuid, project_id uuid, project_name jsonb, document_number text,
    state text, error text, attempts integer, last_ran_at timestamptz, next_try_at timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select o.id, o.kind, w.id, w.project_id, pr.name, w.document_number,
          case when o.dead_at is not null then 'dead' else 'failing' end,
          o.last_error, o.attempts, coalesce(o.dead_at, o.last_failed_at),
          case when o.dead_at is null then o.available_at end
        from outbox o
        join work_item w on w.id = app.record_job_item(o.kind, o.payload)
        join project pr on pr.id = w.project_id
        where o.kind in ('documental_record', 'documental_record_reproduce')
          and (
            (o.processed_at is null and o.dead_at is null and o.last_error is not null)
            or (o.dead_at is not null and not exists (select 1 from record_job_retry r where r.dead_outbox_id = o.id))
          )
        order by 10, 1;
    end
  $$;
revoke all on function app.record_jobs() from public;
grant execute on function app.record_jobs() to rabaed_admin;

-- Retries dead record job `p_outbox_id` for the Engineer whose admin_action is
-- `p_admin_action_id` (written in the same transaction, by the caller). `result`: 'queued' (a
-- fresh row of the same kind, Project and payload is waiting, attempts 0); 'already_queued' (a job
-- of that kind for that item is waiting or running); 'not_found' (not a dead record job, already
-- retried, or a Re-produce that was carried out after all, so nothing would be remade). `item_id`:
-- the job's item, for the caller's admin_action target; null when the row is no dead record job.
-- The dead row is never changed.
--
-- Locks, always in this order: the dead row, the item's work_item row, then (a Re-produce) the
-- item's documental_record row, which is the one app.request_documental_record_reproduction
-- locks. So two retries of one item, or a retry beside a Re-produce request, cannot both find no
-- job waiting and both queue one. The pending test is app.record_job_pending's, by the one
-- payload-key rule (app.record_job_item).
create function app.retry_record_job(p_outbox_id uuid, p_admin_action_id uuid, out result text, out item_id uuid)
  returns record
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_dead outbox%rowtype;
      v_fresh uuid;
    begin
      select * into v_dead from outbox o
      where o.id = p_outbox_id and o.kind in ('documental_record', 'documental_record_reproduce') and o.dead_at is not null
      for update;
      if v_dead.id is null then
        result := 'not_found';
        return;
      end if;
      item_id := app.record_job_item(v_dead.kind, v_dead.payload);
      perform 1 from work_item w where w.id = item_id for update;
      if v_dead.kind = 'documental_record_reproduce' then
        perform 1 from documental_record r where r.work_item_id = item_id for update;
      end if;
      if exists (select 1 from record_job_retry r where r.dead_outbox_id = v_dead.id)
        or (v_dead.kind = 'documental_record_reproduce' and exists (
          select 1 from documental_record_reproduction x where x.admin_action_id = (v_dead.payload ->> 'admin_action_id')::uuid
        )) then
        result := 'not_found';
        return;
      end if;
      if exists (
        select 1 from outbox o
        where o.kind = v_dead.kind and app.record_job_item(o.kind, o.payload) = item_id
          and o.processed_at is null and o.dead_at is null
      ) then
        result := 'already_queued';
        return;
      end if;
      insert into outbox (kind, project_id, payload)
      values (v_dead.kind, v_dead.project_id, v_dead.payload)
      returning id into v_fresh;
      insert into record_job_retry (dead_outbox_id, outbox_id, admin_action_id)
      values (v_dead.id, v_fresh, p_admin_action_id);
      result := 'queued';
    end
  $$;
revoke all on function app.retry_record_job(uuid, uuid) from public;
grant execute on function app.retry_record_job(uuid, uuid) to rabaed_admin;

-- The alerts of Rabaed Admin (20270805000000), but a dead job that has been retried no longer
-- shows as 'job_failed'.
create or replace function app.documental_record_alerts()
  returns table (
    work_item_id uuid, project_id uuid, project_name jsonb, document_number text, status text,
    problems jsonb, raised_at timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select w.id, w.project_id, pr.name, w.document_number, r.status, c.problems, c.ran_at
        from documental_record r
        join lateral (
          select x.problems, x.ran_at, x.passed from documental_record_check x
          where x.documental_record_id = r.id order by x.ran_at desc, x.id desc limit 1
        ) c on not c.passed
        join work_item w on w.id = r.work_item_id
        join project pr on pr.id = w.project_id
        union all
        select w.id, w.project_id, pr.name, w.document_number, 'job_failed', jsonb_build_array(coalesce(o.last_error, 'failed')), o.dead_at
        from outbox o
        join work_item w on w.id = app.record_job_item(o.kind, o.payload)
        join project pr on pr.id = w.project_id
        where o.kind in ('documental_record', 'documental_record_reproduce') and o.dead_at is not null
          and not exists (select 1 from record_job_retry t where t.dead_outbox_id = o.id)
        order by 7, 1;
    end
  $$;

-- The Re-produce requests of item `p_work_item_id`'s record, oldest first: when, which Engineer,
-- their reason, and how it ended. 'replaced': the PDF was remade and replaced (the replaced and
-- the new PDF's fingerprints, hex). 'waiting': its job is waiting or running. 'job_failed': its
-- job ran out of attempts. 'checks_failed': the job ran, the new PDF failed its checks, and nothing
-- was replaced. A request whose job was retried is judged by the jobs of its action together.
create function app.documental_record_history(p_work_item_id uuid)
  returns table (
    requested_at timestamptz, engineer_email text, reason text, outcome text,
    replaced_sha256 text, new_sha256 text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select a.at, e.email, a.reason,
          case
            when x.id is not null then 'replaced'
            when exists (
              select 1 from outbox o
              where o.kind = 'documental_record_reproduce' and o.payload ->> 'admin_action_id' = a.id::text
                and o.processed_at is null and o.dead_at is null
            ) then 'waiting'
            when exists (
              select 1 from outbox o
              where o.kind = 'documental_record_reproduce' and o.payload ->> 'admin_action_id' = a.id::text
                and o.processed_at is not null
            ) then 'checks_failed'
            else 'job_failed'
          end,
          encode(x.replaced_sha256, 'hex'), encode(x.new_sha256, 'hex')
        from admin_action a
        join rabaed_engineer e on e.id = a.engineer_id
        left join documental_record_reproduction x on x.admin_action_id = a.id
        where a.action = 'reproduce_documental_record' and a.target_id = p_work_item_id
          and a.after ->> 'result' = 'queued'
        order by 1, a.id;
    end
  $$;
revoke all on function app.documental_record_history(uuid) from public;
grant execute on function app.documental_record_history(uuid) to rabaed_admin;

-- What each run of the checks found for item `p_work_item_id`'s record, oldest first.
create function app.documental_record_check_runs(p_work_item_id uuid)
  returns table (run_kind text, passed boolean, problems jsonb, ran_at timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select c.run_kind, c.passed, c.problems, c.ran_at
        from documental_record r
        join documental_record_check c on c.documental_record_id = r.id
        where r.work_item_id = p_work_item_id
        order by 4, c.id;
    end
  $$;
revoke all on function app.documental_record_check_runs(uuid) from public;
grant execute on function app.documental_record_check_runs(uuid) to rabaed_admin;
