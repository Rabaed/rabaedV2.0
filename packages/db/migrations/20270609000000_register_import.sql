-- RP-637 (spec RP-631): the Submittal Register Import tracer (data-model.md §8, visibility.md scenario RP-589-1).
--
-- * A Member uploads a register (.xlsx or .csv); the api reads it (sheet and header
--   row as chosen), takes each row's Subject, Type and Trade from the mapped columns
--   (or a fixed Type or Trade for the file), and hands the rows to
--   app.preview_register_import. It checks every row by the rules app.create_work_item
--   enforces, records every reason a row is bad (not only the first), and keeps the
--   import `previewed` with its rows: nothing exists in the Project yet.
-- * app.confirm_register_import creates a Draft for every good row and none for the
--   bad, all or nothing, through app.create_work_item itself (raised by the importer,
--   so the same checks run again) and app.record_field_times, as a single Draft is
--   made. Each Draft carries `work_item.import_id`, and its `created` event names the
--   import (`payload.import_id`, trigger work_item_event_add_register_import). A row
--   that no longer passes (the Project changed since the preview) refuses the whole
--   confirm: 'preview_outdated', nothing created.
-- * A preview never confirmed is deleted after 7 days by the worker
--   (app.clean_previewed_register_imports), with its rows.
-- * Visibility: only Members of the importing Participant read an import and its
--   rows, and a `previewed` one only its importer; no other Company reads anything
--   of it (RP-589-1). A created row's Draft is given only to a caller who sees it
--   (app.register_import_results). No time is granted: when an import was confirmed
--   is when its Drafts were started, which nobody sees (scenario 61), and
--   `work_item.import_id` is never granted.
--
-- rabaed_app writes only through the SECURITY DEFINER functions below, and a Closed
-- Project answers 'project_closed'.

create table submittal_register_import (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id),
  -- The importing Participant: the Drafts are its own.
  participant_id uuid not null references participant (id),
  run_by_member_id uuid not null references member (id),
  file_name text not null check (length(file_name) between 1 and 255),
  sheet text not null,
  header_row integer not null check (header_row >= 1),
  -- The header row's cells, as read.
  headers jsonb not null check (jsonb_typeof(headers) = 'array'),
  -- Which column gives the Subject, Type and Trade, or a fixed Type or Trade
  -- (`@rabaed/domain` registerImportMapping).
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  status text not null default 'previewed' check (status in ('previewed', 'created')),
  rows_total integer not null check (rows_total between 0 and 2000),
  rows_rejected integer not null check (rows_rejected between 0 and rows_total),
  rows_created integer check (rows_created between 0 and rows_total),
  -- Never granted to the app role: an import's times are its Drafts' start (scenario 61).
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  -- Set only while app.confirm_register_import runs, for the created-event trigger.
  confirm_txid bigint,
  check ((status = 'created') = (confirmed_at is not null and rows_created is not null))
);

create index submittal_register_import_project_id_idx on submittal_register_import (project_id);
create index submittal_register_import_participant_id_idx on submittal_register_import (participant_id);
create index submittal_register_import_run_by_member_id_idx on submittal_register_import (run_by_member_id);

create table submittal_register_import_row (
  import_id uuid not null references submittal_register_import (id) on delete cascade,
  -- The row's number in the sheet, as the spreadsheet shows it.
  row_no integer not null check (row_no >= 1),
  -- Every cell of the row as read, one per header (the record, and the rejected rows later).
  cells jsonb not null check (jsonb_typeof(cells) = 'array'),
  -- The mapped values as read ("" for an empty cell, or a fixed Type or Trade).
  subject text not null,
  type_text text not null,
  trade_text text not null,
  -- What they matched, when they did.
  work_item_type_id uuid references work_item_type (id),
  trade_id uuid references dimension_value (id),
  -- Every reason the row is bad; empty for a good row.
  reasons text[] not null default '{}' check (reasons <@ array[
    'subject_missing', 'subject_too_long', 'type_missing', 'type_unknown', 'type_not_allowed',
    'trade_missing', 'trade_unknown', 'trade_outside_visibility']::text[]),
  -- The Draft a good row created on confirm. Never granted (app.register_import_results).
  work_item_id uuid references work_item (id),
  primary key (import_id, row_no)
);

create index submittal_register_import_row_work_item_type_id_idx on submittal_register_import_row (work_item_type_id);
create index submittal_register_import_row_trade_id_idx on submittal_register_import_row (trade_id);
create index submittal_register_import_row_work_item_id_idx on submittal_register_import_row (work_item_id);

-- Traceability: the import that created the Draft. Not granted to the app role: once
-- Submitted, other Companies see the item, and nothing of the import is theirs.
alter table work_item add column import_id uuid references submittal_register_import (id);
create index work_item_import_id_idx on work_item (import_id);

-- Access for rabaed_app ------------------------------------------------------

alter table submittal_register_import enable row level security;
revoke all on submittal_register_import from rabaed_app;
-- Everything but the times (scenario 61) and the confirm's working column.
grant select (
  id, project_id, participant_id, run_by_member_id, file_name, sheet, header_row, headers, mapping,
  status, rows_total, rows_rejected, rows_created
) on submittal_register_import to rabaed_app;

-- The importing Participant's Members (RP-589-1); a preview only its importer.
create policy member_reads_own_participant_register_imports on submittal_register_import for select to rabaed_app
  using (
    participant_id in (select app.current_participant_ids())
    and project_id in (select app.current_project_ids())
    and (status = 'created' or run_by_member_id = app.current_member_id())
  );

alter table submittal_register_import_row enable row level security;
revoke all on submittal_register_import_row from rabaed_app;
-- The row as read and its reasons: the Company's own register. Its Draft only through
-- app.register_import_results, where the caller sees it.
grant select (
  import_id, row_no, cells, subject, type_text, trade_text, work_item_type_id, trade_id, reasons
) on submittal_register_import_row to rabaed_app;

-- A row is read exactly where its import is (that table's own policy).
create policy member_reads_register_import_rows on submittal_register_import_row for select to rabaed_app
  using (import_id in (select id from submittal_register_import));

-- Helpers ---------------------------------------------------------------------

-- Whether a Member of p_participant_id (base role p_base_role) may raise Work Item Type
-- p_type_id on p_project_id, as app.create_work_item decides it: a Form to start from,
-- and a Workflow bound for the Participant whose Draft Step their base role holds.
create function app.register_import_type_raisable(
  p_project_id uuid, p_type_id uuid, p_type_code text, p_participant_id uuid, p_base_role text
) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.new_item_form_version(p_project_id, p_type_code) is not null
        and exists (
          select 1 from workflow_step s
          where s.workflow_version_id = app.new_item_workflow_version(p_project_id, p_type_id, p_participant_id)
            and app.is_draft_step(s.id)
            and s.actor_rule ->> 'base_role' = p_base_role
        );
    end
  $$;
revoke all on function app.register_import_type_raisable(uuid, uuid, text, uuid, text) from public;

-- Preview ---------------------------------------------------------------------

-- Checks the rows the api read from a register and keeps them as a `previewed`
-- import of the caller's Participant. p_rows is an array of
-- {"row_no", "cells", "subject", "type", "trade"} ("type" and "trade" are the cells'
-- text, "" where p_fixed_type or p_fixed_trade_id gives the value for every row).
-- Outcomes: 'previewed' (with the import's id) / 'not_found' (not one of the caller's
-- Projects) / 'project_closed' / 'forbidden' (the caller may raise no Submittals Type
-- there) / 'type_not_found' (a fixed Type they may not raise) / 'trade_not_found'
-- (a fixed Trade that isn't the Project's).
create function app.preview_register_import(
  p_project_id uuid, p_file_name text, p_sheet text, p_header_row integer, p_headers jsonb,
  p_mapping jsonb, p_rows jsonb, p_fixed_type text, p_fixed_trade_id uuid, p_now timestamptz
) returns table (outcome text, import_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_project_member_id uuid;
      v_participant_id uuid;
      v_base_role text;
      v_trade_dimension uuid;
      v_raisable uuid[];
      v_fixed_type_id uuid;
      v_import_id uuid;
      v_row jsonb;
      v_subject text;
      v_type_text text;
      v_trade_text text;
      v_type_id uuid;
      v_trade_id uuid;
      v_reasons text[];
      v_total integer := 0;
      v_rejected integer := 0;
    begin
      -- The caller, as app.create_work_item finds them.
      select pm.id, pm.participant_id, r.base_role into v_project_member_id, v_participant_id, v_base_role
      from project_member pm
      join participant p on p.id = pm.participant_id
      join project_role r on r.id = p.project_role_id
      where pm.project_id = p_project_id and pm.member_id = app.current_member_id() and pm.status = 'active'
        and p.status = 'active' and p.company_id = app.current_company_id()
        and p_project_id in (select app.current_project_ids());
      if v_project_member_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 2000
        or jsonb_typeof(p_headers) is distinct from 'array' or jsonb_typeof(p_mapping) is distinct from 'object'
      then
        raise exception 'a register import takes an array of at most 2000 rows' using errcode = '22023';
      end if;

      v_raisable := array(
        select t.id from work_item_type t
        where t.owner_kind = 'rabaed' and t.module_key = 'submittals'
          and app.register_import_type_raisable(p_project_id, t.id, t.code, v_participant_id, v_base_role)
      );
      if cardinality(v_raisable) = 0 then
        return query select 'forbidden'::text, null::uuid;
        return;
      end if;
      if p_fixed_type is not null then
        select t.id into v_fixed_type_id from work_item_type t
        where t.owner_kind = 'rabaed' and t.code = p_fixed_type and t.id = any (v_raisable);
        if v_fixed_type_id is null then
          return query select 'type_not_found'::text, null::uuid;
          return;
        end if;
      end if;
      v_trade_dimension := app.project_dimension_id(p_project_id, 'trade');
      if p_fixed_trade_id is not null
        and not exists (select 1 from dimension_value where id = p_fixed_trade_id and dimension_id = v_trade_dimension)
      then
        return query select 'trade_not_found'::text, null::uuid;
        return;
      end if;

      insert into submittal_register_import (
        project_id, participant_id, run_by_member_id, file_name, sheet, header_row, headers, mapping,
        rows_total, rows_rejected, created_at
      ) values (
        p_project_id, v_participant_id, app.current_member_id(), p_file_name, p_sheet, p_header_row, p_headers, p_mapping,
        0, 0, v_at
      ) returning id into v_import_id;

      for v_row in select value from jsonb_array_elements(p_rows) loop
        v_reasons := '{}';
        v_subject := btrim(coalesce(v_row ->> 'subject', ''));
        if v_subject = '' then
          v_reasons := array_append(v_reasons, 'subject_missing');
        elsif length(v_subject) > 200 then
          v_reasons := array_append(v_reasons, 'subject_too_long');
        end if;

        -- The Type: a Submittals Type by its code or its English or Arabic name, as written.
        v_type_text := case when p_fixed_type is null then btrim(coalesce(v_row ->> 'type', '')) else p_fixed_type end;
        v_type_id := v_fixed_type_id;
        if p_fixed_type is null then
          select t.id into v_type_id from work_item_type t
          where t.owner_kind = 'rabaed' and t.module_key = 'submittals'
            and v_type_text in (t.code, t.name ->> 'en', t.name ->> 'ar')
          order by t.code limit 1;
          if v_type_text = '' then
            v_reasons := array_append(v_reasons, 'type_missing');
          elsif v_type_id is null then
            v_reasons := array_append(v_reasons, 'type_unknown');
          elsif not (v_type_id = any (v_raisable)) then
            v_reasons := array_append(v_reasons, 'type_not_allowed');
          end if;
        end if;

        -- The Trade: one of the Project's by its code or its English or Arabic name, as
        -- written; then within the importer's Visibility, as app.create_work_item checks it.
        v_trade_id := p_fixed_trade_id;
        if p_fixed_trade_id is null then
          v_trade_text := btrim(coalesce(v_row ->> 'trade', ''));
          select dv.id into v_trade_id from dimension_value dv
          where dv.dimension_id = v_trade_dimension and v_trade_text in (dv.code, dv.name ->> 'en', dv.name ->> 'ar')
          order by dv.sort, dv.code limit 1;
        else
          select dv.code into v_trade_text from dimension_value dv where dv.id = p_fixed_trade_id;
        end if;
        if v_trade_text = '' then
          v_reasons := array_append(v_reasons, 'trade_missing');
        elsif v_trade_id is null then
          v_reasons := array_append(v_reasons, 'trade_unknown');
        elsif app.check_work_item_built_ins(null, p_project_id, v_project_member_id, v_trade_id, null, '{}') = 'outside_visibility' then
          v_reasons := array_append(v_reasons, 'trade_outside_visibility');
        end if;

        insert into submittal_register_import_row (
          import_id, row_no, cells, subject, type_text, trade_text, work_item_type_id, trade_id, reasons
        ) values (
          v_import_id, (v_row ->> 'row_no')::integer, coalesce(v_row -> 'cells', '[]'), coalesce(v_row ->> 'subject', ''),
          case when p_fixed_type is null then coalesce(v_row ->> 'type', '') else p_fixed_type end,
          case when p_fixed_trade_id is null then coalesce(v_row ->> 'trade', '') else v_trade_text end,
          v_type_id, v_trade_id, v_reasons
        );
        v_total := v_total + 1;
        if cardinality(v_reasons) > 0 then
          v_rejected := v_rejected + 1;
        end if;
      end loop;

      update submittal_register_import set rows_total = v_total, rows_rejected = v_rejected where id = v_import_id;
      return query select 'previewed'::text, v_import_id;
    end
  $$;
revoke all on function app.preview_register_import(uuid, text, text, integer, jsonb, jsonb, jsonb, text, uuid, timestamptz) from public;
grant execute on function app.preview_register_import(uuid, text, text, integer, jsonb, jsonb, jsonb, text, uuid, timestamptz) to rabaed_app;

-- Confirm ---------------------------------------------------------------------

-- The created event of a Draft made by app.confirm_register_import names its import.
-- Only the import that function is confirming in this very transaction counts, so
-- no other Draft can claim one.
create function app.add_register_import_to_created_event() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_import_id uuid;
    begin
      if new.type = 'created' then
        select i.id into v_import_id from submittal_register_import i
        where i.confirm_txid = txid_current() and i.status = 'previewed'
          and i.project_id = new.project_id and i.run_by_member_id = new.actor_member_id;
        if v_import_id is not null then
          new.payload := new.payload || jsonb_build_object('import_id', v_import_id);
        end if;
      end if;
      return new;
    end
  $$;
revoke all on function app.add_register_import_to_created_event() from public;

-- Before work_item_event_chain (triggers fire in name order), so the hash covers it.
create trigger work_item_event_add_register_import before insert on work_item_event
  for each row execute function app.add_register_import_to_created_event();

-- Creates the Drafts of the caller's own `previewed` import: one per good row, raised
-- by the caller through app.create_work_item, all or nothing. Outcomes: 'created'
-- (with how many; again, unchanged, for an import already created) / 'not_found'
-- (not the caller's preview, or older than 7 days) / 'project_closed' /
-- 'nothing_to_import' (no good row) / 'preview_outdated' (a good row no longer
-- passes: nothing is created; preview again).
create function app.confirm_register_import(p_import_id uuid, p_now timestamptz)
  returns table (outcome text, rows_created integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_import record;
      v_row record;
      v_created record;
      v_count integer := 0;
    begin
      select i.* into v_import from submittal_register_import i
      where i.id = p_import_id and i.run_by_member_id = app.current_member_id()
        and i.participant_id in (select app.current_participant_ids())
        and i.project_id in (select app.current_project_ids())
      for update;
      if not found or (v_import.status = 'previewed' and v_import.created_at < v_at - interval '7 days') then
        return query select 'not_found'::text, null::integer;
        return;
      end if;
      if v_import.status = 'created' then
        return query select 'created'::text, v_import.rows_created;
        return;
      end if;
      if exists (select 1 from project where id = v_import.project_id and status = 'closed') then
        return query select 'project_closed'::text, null::integer;
        return;
      end if;
      if v_import.rows_total = v_import.rows_rejected then
        return query select 'nothing_to_import'::text, null::integer;
        return;
      end if;

      update submittal_register_import set confirm_txid = txid_current() where id = p_import_id;
      begin
        for v_row in
          select r.row_no, btrim(r.subject) as subject, t.code as type_code, r.trade_id
          from submittal_register_import_row r
          join work_item_type t on t.id = r.work_item_type_id
          where r.import_id = p_import_id and cardinality(r.reasons) = 0
          order by r.row_no
        loop
          -- The same path as a single Draft (apps/api createWorkItem): the Type's Form to
          -- start from, no answers yet, the Trade, then the answers' times.
          select c.outcome, c.work_item_id into v_created
          from app.create_work_item(
            v_import.project_id, v_row.type_code, v_row.subject, app.new_item_form_version(v_import.project_id, v_row.type_code),
            '{}'::jsonb, v_row.trade_id, null, v_at) c;
          if v_created.outcome is distinct from 'created' then
            raise exception 'a previewed row no longer passes' using errcode = 'RI001';
          end if;
          if app.record_field_times(v_created.work_item_id, v_at) is distinct from 'recorded' then
            raise exception 'a previewed row no longer passes' using errcode = 'RI001';
          end if;
          update work_item set import_id = p_import_id where id = v_created.work_item_id;
          update submittal_register_import_row set work_item_id = v_created.work_item_id
          where import_id = p_import_id and row_no = v_row.row_no;
          v_count := v_count + 1;
        end loop;
      exception when sqlstate 'RI001' or insufficient_privilege then
        -- The block's writes are undone; only the working column is left to clear.
        update submittal_register_import set confirm_txid = null where id = p_import_id;
        return query select 'preview_outdated'::text, null::integer;
        return;
      end;

      update submittal_register_import
      set status = 'created', confirmed_at = v_at, rows_created = v_count, confirm_txid = null
      where id = p_import_id;
      return query select 'created'::text, v_count;
    end
  $$;
revoke all on function app.confirm_register_import(uuid, timestamptz) from public;
grant execute on function app.confirm_register_import(uuid, timestamptz) to rabaed_app;

-- Reads ------------------------------------------------------------------------

-- The Drafts an import's rows created: for each row of an import the caller reads,
-- whether it created a Draft, and that Draft's id only where the caller sees it
-- (a colleague outside its Visibility, or a Draft since Deleted, gets none).
create function app.register_import_results(p_import_id uuid)
  returns table (row_no integer, created boolean, work_item_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select r.row_no, r.work_item_id is not null,
          case when r.work_item_id is not null and app.sees_work_item(r.work_item_id) then r.work_item_id end
        from submittal_register_import i
        join submittal_register_import_row r on r.import_id = i.id
        where i.id = p_import_id
          -- The table's own policy, said again: this function reads past it.
          and i.participant_id in (select app.current_participant_ids())
          and i.project_id in (select app.current_project_ids())
          and (i.status = 'created' or i.run_by_member_id = app.current_member_id())
        order by r.row_no;
    end
  $$;
revoke all on function app.register_import_results(uuid) from public;
grant execute on function app.register_import_results(uuid) to rabaed_app;

-- Clean-up ---------------------------------------------------------------------

-- The worker's daily clean-up: deletes every preview never confirmed, older than 7
-- days, with its rows (spec RP-631). Returns how many. Refuses a Member's session.
create function app.clean_previewed_register_imports(p_now timestamptz) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_count integer;
    begin
      perform app.require_worker();
      delete from submittal_register_import
      where status = 'previewed' and created_at < p_now - interval '7 days';
      get diagnostics v_count = row_count;
      return v_count;
    end
  $$;
revoke all on function app.clean_previewed_register_imports(timestamptz) from public;
grant execute on function app.clean_previewed_register_imports(timestamptz) to rabaed_app;
