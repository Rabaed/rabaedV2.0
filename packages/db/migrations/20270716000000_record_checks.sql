-- RP-155 (spec RP-632; ADR 0023; workflow-engine.md §7): no broken record reaches a customer.
--
-- * The record job saves the record as 'preparing', checks the PDF it made (it opens, validates
--   as PDF/A-3, shows every signer's Signature, has the pages it should, its seal verifies; the
--   worker runs them, apps/worker/src/record/checks.ts) and then app.finish_documental_record
--   moves it to 'published' or 'failed_checks' and keeps what the checks found. A failed check
--   publishes nothing (app.documental_record_file answers only a published record), and
--   app.documental_record_alerts lists it for Rabaed Admin.
-- * "Record being prepared": app.documental_record_state, for a Member who sees the item:
--   'preparing' while the job is waiting or running, 'published' once the record can be
--   downloaded, nothing for an item with no record (a failed one included).
-- * "Record ready": publishing queues one outbox row of the new kind 'record_ready'. The worker
--   delivers it (app.deliver_record_ready) as a notification of the new kind 'record_ready' to
--   each active Member of the Project who sees the item at delivery (app.sees_work_item, as
--   that Member), unless they muted the Project; in the bell only, it names no Company and no
--   person, only the item the Member already reads. A closed Project goes quiet.
-- * Re-produce: Rabaed Admin queues an outbox row of the new kind 'documental_record_reproduce'
--   (app.request_documental_record_reproduction, logged in admin_action with the Engineer's
--   reason). The worker remakes the PDF from the stored Record Data, checks it, and
--   app.reproduce_documental_record then replaces the record's PDF fingerprint and seal date and
--   keeps the replaced PDF's in documental_record_reproduction. The PDF stays at the same
--   storage key, so its name and download link stay. The item, its Transitions and its
--   stored_file rows (immutable: the PDF's row keeps the first PDF's fingerprint and size;
--   documental_record.pdf_sha256 is the current one) are never touched.
-- * documental_record_check and documental_record_reproduction: admin-only, no grant to the app
--   role; written by the definer functions below, never changed.
--
-- Rebuilt from their only definitions (20270709000000_documental_record.sql):
-- app.save_documental_record (saves 'preparing') and app.refuse_documental_record_change (also
-- lets a Re-produce replace the PDF's fingerprint and seal date, and nothing else).
-- app.take_transition and app.transition_effects are unchanged.

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check
  check (kind in ('notification', 'email', 'digest', 'step_age_report', 'documental_record', 'record_ready', 'documental_record_reproduce'));

alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check
  check (kind in ('step_reached', 'watched_event', 'sent_back', 'record_ready'));

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
    'reproduce_documental_record', 'read_documental_record_alerts'
  ));

-- What the checks found, one row for each run: the job's, and each Re-produce's.
create table documental_record_check (
  id uuid primary key default gen_random_uuid(),
  documental_record_id uuid not null references documental_record (id),
  run_kind text not null check (run_kind in ('closure', 'reproduce')),
  passed boolean not null,
  -- What failed, in words, for a Rabaed Engineer: never customer text.
  problems jsonb not null default '[]'::jsonb check (jsonb_typeof(problems) = 'array' and (passed = (jsonb_array_length(problems) = 0))),
  ran_at timestamptz not null default now()
);
create index documental_record_check_record_idx on documental_record_check (documental_record_id, ran_at desc);

-- The PDF each Re-produce replaced, with its fingerprint, kept for good.
create table documental_record_reproduction (
  id uuid primary key default gen_random_uuid(),
  documental_record_id uuid not null references documental_record (id),
  -- The Rabaed Engineer's action, with its reason.
  admin_action_id uuid not null unique references admin_action (id),
  previous_status text not null check (previous_status in ('published', 'failed_checks')),
  -- The replaced PDF: where it is kept now, its fingerprint and size, and when it was sealed.
  replaced_storage_key text not null check (length(replaced_storage_key) > 0),
  replaced_sha256 bytea not null check (length(replaced_sha256) = 32),
  replaced_size bigint not null check (replaced_size > 0),
  replaced_sealed_at timestamptz not null,
  -- The new PDF, at the record's own storage key.
  new_sha256 bytea not null check (length(new_sha256) = 32),
  new_size bigint not null check (new_size > 0),
  new_sealed_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index documental_record_reproduction_record_idx on documental_record_reproduction (documental_record_id, created_at);

create function app.refuse_documental_record_history_change() returns trigger
  language plpgsql
  as $$
    begin
      raise exception '% is never changed', tg_table_name using errcode = '42501';
    end
  $$;
revoke all on function app.refuse_documental_record_history_change() from public;
create trigger documental_record_check_kept before update or delete on documental_record_check
  for each row execute function app.refuse_documental_record_history_change();
create trigger documental_record_reproduction_kept before update or delete on documental_record_reproduction
  for each row execute function app.refuse_documental_record_history_change();

alter table documental_record_check enable row level security;
alter table documental_record_reproduction enable row level security;
revoke all on documental_record_check, documental_record_reproduction from rabaed_app;
revoke insert, update, delete, truncate on documental_record_check, documental_record_reproduction from rabaed_admin;

-- Written once, but for its status moving forward (checks) and a Re-produce replacing the
-- PDF's fingerprint and seal date: nothing else changes, and no row is removed.
create or replace function app.refuse_documental_record_change() returns trigger
  language plpgsql
  as $$
    begin
      if tg_op = 'UPDATE' then
        if (to_jsonb(old) - 'status') = (to_jsonb(new) - 'status')
          and (old.status, new.status) in (('preparing', 'published'), ('preparing', 'failed_checks'), ('failed_checks', 'published'))
        then
          return new;
        end if;
        -- Only app.reproduce_documental_record sets this, for its own update.
        if coalesce(current_setting('app.documental_record_reproduce', true), '') = 'on'
          and (to_jsonb(old) - 'status' - 'pdf_sha256' - 'sealed_at') = (to_jsonb(new) - 'status' - 'pdf_sha256' - 'sealed_at')
          and (new.status = old.status or (old.status, new.status) = ('failed_checks', 'published'))
          and old.status in ('published', 'failed_checks')
        then
          return new;
        end if;
      end if;
      raise exception 'documental_record is written once' using errcode = '42501';
    end
  $$;

-- The worker's write of the made record (see the header): 'preparing' until its checks have run.
-- False when the item already has one, or the row is not a record job.
create or replace function app.save_documental_record(
  p_outbox_id uuid, p_pdf_storage_key text, p_pdf_sha256 bytea, p_pdf_size bigint,
  p_data_storage_key text, p_data_sha256 bytea, p_data_size bigint,
  p_layout_version text, p_language text, p_sealed_at timestamptz,
  p_verification_token_hash bytea, p_verification_code text
) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
      v_pdf uuid;
      v_data uuid;
    begin
      perform app.require_worker();
      select w.id, w.project_id, w.outcome into v_item
      from work_item w
      where w.id = app.documental_record_item(p_outbox_id) and w.closed_at is not null
      for update;
      if v_item.id is null or exists (select 1 from documental_record r where r.work_item_id = v_item.id) then
        return false;
      end if;
      insert into stored_file (storage_key, sha256, size, mime)
      values (p_pdf_storage_key, p_pdf_sha256, p_pdf_size, 'application/pdf') returning id into v_pdf;
      insert into stored_file (storage_key, sha256, size, mime)
      values (p_data_storage_key, p_data_sha256, p_data_size, 'application/xml') returning id into v_data;
      insert into documental_record (
        project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
        pdf_sha256, sealed_at, verification_token_hash, verification_code, status
      ) values (
        v_item.project_id, v_item.id, v_pdf, v_data, p_layout_version, p_language, v_item.outcome,
        p_pdf_sha256, p_sealed_at, p_verification_token_hash, p_verification_code, 'preparing'
      );
      return true;
    end
  $$;

-- The checks' verdict on a 'preparing' record of job `p_outbox_id`: published, or failed_checks
-- with what was found. A published record queues its "record ready" notification. False when
-- the job's item has no record waiting for its checks.
create function app.finish_documental_record(p_outbox_id uuid, p_passed boolean, p_problems jsonb) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_record record;
    begin
      perform app.require_worker();
      select r.id, r.project_id, r.work_item_id, r.status into v_record
      from documental_record r
      where r.work_item_id = app.documental_record_item(p_outbox_id)
      for update;
      if v_record.id is null or v_record.status <> 'preparing' then
        return false;
      end if;
      insert into documental_record_check (documental_record_id, run_kind, passed, problems)
      values (v_record.id, 'closure', p_passed, coalesce(p_problems, '[]'::jsonb));
      update documental_record set status = case when p_passed then 'published' else 'failed_checks' end where id = v_record.id;
      if p_passed then
        insert into outbox (kind, project_id, payload)
        values ('record_ready', v_record.project_id, jsonb_build_object('work_item_id', v_record.work_item_id));
      end if;
      return true;
    end
  $$;
revoke all on function app.finish_documental_record(uuid, boolean, jsonb) from public;
grant execute on function app.finish_documental_record(uuid, boolean, jsonb) to rabaed_app;

-- A closed item's record as its Members see it: 'preparing' while the job is waiting or running
-- (or the checks are), 'published' once it can be downloaded; null for an item with no record,
-- one whose checks failed included, and for anyone who doesn't see the item.
create function app.documental_record_state(p_work_item_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_status text;
    begin
      if app.current_member_id() is null or not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      select r.status into v_status from documental_record r where r.work_item_id = p_work_item_id;
      if v_status is null then
        if exists (
          select 1 from outbox o
          where o.kind = 'documental_record' and o.payload ->> 'closed_work_item_id' = p_work_item_id::text
            and o.processed_at is null and o.dead_at is null
        ) then
          return 'preparing';
        end if;
        return null;
      end if;
      return case v_status when 'failed_checks' then null else v_status end;
    end
  $$;
revoke all on function app.documental_record_state(uuid) from public;
grant execute on function app.documental_record_state(uuid) to rabaed_app;

-- Delivers a 'record_ready' outbox row (see the header). Returns how many Members got it.
create function app.deliver_record_ready(p_outbox_id uuid) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_saved text := current_setting('app.member_id', true);
      v_item record;
      v_member uuid;
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
        if app.sees_work_item(v_item.id)
          and not exists (select 1 from project_mute m where m.member_id = v_member and m.project_id = v_item.project_id)
        then
          insert into notification (member_id, project_id, work_item_id, outbox_id, kind, in_app, email)
          values (v_member, v_item.project_id, v_item.id, p_outbox_id, 'record_ready', true, 'none')
          on conflict (outbox_id, member_id) do nothing;
          get diagnostics v_inserted = row_count;
          v_count := v_count + v_inserted;
        end if;
      end loop;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
      return v_count;
    end
  $$;
revoke all on function app.deliver_record_ready(uuid) from public;
grant execute on function app.deliver_record_ready(uuid) to rabaed_app;

-- Re-produce, the worker's side -----------------------------------------------------------

-- What a 'documental_record_reproduce' job needs: where the record's files are, the PDF's
-- fingerprint and seal date now. Null when the row is not such a job, the record is gone, or
-- the Engineer's action already has its Re-produce (a retry after it was done).
create function app.documental_record_reproduction_source(p_outbox_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.require_worker();
      return (
        select jsonb_build_object(
          'workItemId', r.work_item_id,
          'projectId', r.project_id,
          'status', r.status,
          'pdfKey', f.storage_key,
          'recordDataKey', d.storage_key,
          'pdfSha256', encode(r.pdf_sha256, 'hex'),
          'sealedAt', app.iso_utc(r.sealed_at))
        from outbox o
        join documental_record r on r.work_item_id = (o.payload ->> 'work_item_id')::uuid
        join stored_file f on f.id = r.pdf_file_id
        join stored_file d on d.id = r.record_data_file_id
        where o.id = p_outbox_id and o.kind = 'documental_record_reproduce'
          and r.status in ('published', 'failed_checks')
          and not exists (
            select 1 from documental_record_reproduction x
            where x.admin_action_id = (o.payload ->> 'admin_action_id')::uuid)
      );
    end
  $$;
revoke all on function app.documental_record_reproduction_source(uuid) from public;
grant execute on function app.documental_record_reproduction_source(uuid) to rabaed_app;

-- The worker's write of a Re-produce, once the new PDF is made and checked (and stored, when it
-- passed). 'replaced': the record has the new PDF's fingerprint and seal date, the replaced
-- one's kept; a record whose checks had failed is published (and its "record ready" queued).
-- 'checks_failed': the new PDF failed its checks, so nothing changes but the finding, which
-- stays in the alerts. 'not_found' for a row that is no longer a Re-produce to do.
create function app.reproduce_documental_record(
  p_outbox_id uuid, p_replaced_storage_key text, p_replaced_sha256 bytea, p_replaced_size bigint,
  p_new_sha256 bytea, p_new_size bigint, p_new_sealed_at timestamptz, p_passed boolean, p_problems jsonb
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_payload jsonb;
      v_record record;
    begin
      perform app.require_worker();
      select o.payload into v_payload from outbox o where o.id = p_outbox_id and o.kind = 'documental_record_reproduce';
      select r.* into v_record from documental_record r
      where r.work_item_id = (v_payload ->> 'work_item_id')::uuid and r.status in ('published', 'failed_checks')
      for update;
      if v_record.id is null
        or exists (select 1 from documental_record_reproduction x where x.admin_action_id = (v_payload ->> 'admin_action_id')::uuid)
      then
        return 'not_found';
      end if;
      insert into documental_record_check (documental_record_id, run_kind, passed, problems)
      values (v_record.id, 'reproduce', p_passed, coalesce(p_problems, '[]'::jsonb));
      if not p_passed then
        return 'checks_failed';
      end if;
      insert into documental_record_reproduction (
        documental_record_id, admin_action_id, previous_status, replaced_storage_key, replaced_sha256, replaced_size,
        replaced_sealed_at, new_sha256, new_size, new_sealed_at
      ) values (
        v_record.id, (v_payload ->> 'admin_action_id')::uuid, v_record.status, p_replaced_storage_key, p_replaced_sha256,
        p_replaced_size, v_record.sealed_at, p_new_sha256, p_new_size, p_new_sealed_at
      );
      perform set_config('app.documental_record_reproduce', 'on', true);
      update documental_record set pdf_sha256 = p_new_sha256, sealed_at = p_new_sealed_at, status = 'published'
      where id = v_record.id;
      perform set_config('app.documental_record_reproduce', 'off', true);
      if v_record.status = 'failed_checks' then
        insert into outbox (kind, project_id, payload)
        values ('record_ready', v_record.project_id, jsonb_build_object('work_item_id', v_record.work_item_id));
      end if;
      return 'replaced';
    end
  $$;
revoke all on function app.reproduce_documental_record(uuid, text, bytea, bigint, bytea, bigint, timestamptz, boolean, jsonb) from public;
grant execute on function app.reproduce_documental_record(uuid, text, bytea, bigint, bytea, bigint, timestamptz, boolean, jsonb) to rabaed_app;

-- Rabaed Admin's side ----------------------------------------------------------------------

-- Queues the Re-produce of an item's record (published, or failed its checks), for the Engineer
-- whose admin_action is `p_admin_action_id` (written in the same transaction, by the caller).
-- 'queued', 'already_queued' while one is waiting, or 'not_found'. Touches neither the item nor
-- its Transitions.
create function app.request_documental_record_reproduction(p_work_item_id uuid, p_admin_action_id uuid) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_record record;
    begin
      select r.id, r.project_id into v_record from documental_record r
      where r.work_item_id = p_work_item_id and r.status in ('published', 'failed_checks')
      for update;
      if v_record.id is null then
        return 'not_found';
      end if;
      if exists (
        select 1 from outbox o
        where o.kind = 'documental_record_reproduce' and o.payload ->> 'work_item_id' = p_work_item_id::text
          and o.processed_at is null and o.dead_at is null
      ) then
        return 'already_queued';
      end if;
      insert into outbox (kind, project_id, payload)
      values ('documental_record_reproduce', v_record.project_id,
        jsonb_build_object('work_item_id', p_work_item_id, 'admin_action_id', p_admin_action_id));
      return 'queued';
    end
  $$;
revoke all on function app.request_documental_record_reproduction(uuid, uuid) from public;
grant execute on function app.request_documental_record_reproduction(uuid, uuid) to rabaed_admin;

-- The alerts of Rabaed Admin: every record whose latest checks failed (a failed Re-produce of a
-- published one included), and every record job (or Re-produce) that ran out of attempts.
-- Oldest first. It lists what a Rabaed Engineer reads anyway (read through asEngineer).
create function app.documental_record_alerts()
  returns table (
    work_item_id uuid, project_id uuid, project_name jsonb, document_number text, status text,
    problems jsonb, raised_at timestamptz)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
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
    join work_item w on w.id = coalesce((o.payload ->> 'closed_work_item_id')::uuid, (o.payload ->> 'work_item_id')::uuid)
    join project pr on pr.id = w.project_id
    where o.kind in ('documental_record', 'documental_record_reproduce') and o.dead_at is not null
    order by 7, 1
  $$;
revoke all on function app.documental_record_alerts() from public;
grant execute on function app.documental_record_alerts() to rabaed_admin;
