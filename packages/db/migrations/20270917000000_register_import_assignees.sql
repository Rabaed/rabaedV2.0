-- RP-640 (spec RP-631): a Register Import's rows assigned to a Member, who raises their Drafts
-- (data-model.md §8 submittal_register_import_row; visibility.md RP-589-2).
--
-- * A row's raiser is the importer, unless the row is assigned: picked in the wizard for a
--   group of rows (by Trade or Type, or a default for every row) or named by email in an
--   "Assign to" column. The api matches the email (ignoring case) among the active Members
--   of the importer's own Participant on the Project and hands app.preview_register_import
--   each row's `assignee` (the cell as read, "" when the Member was picked) and
--   `assignee_member_id` (null when nothing matched).
-- * The preview checks the assignee again, as app.create_work_item would check them as the
--   raiser: an active Member of the importing Participant on the Project (anyone else, a
--   Member of another Company, one taken off the Project or a made-up id, is the one reason
--   `assignee_unknown`: nothing tells them apart), who may raise the row's Type
--   (`assignee_cannot_create`) and whose Visibility covers its Trade and Location
--   (`assignee_outside_visibility`). The importer's own checks stay: each row's Type is one
--   they may raise too, and its values inside their Visibility.
-- * app.confirm_register_import creates an assigned row's Draft as its assignee: the
--   session's Member is the assignee while app.create_work_item and app.record_field_times
--   run (as app.notify_member does for a recipient), so the Draft is their own, held by them
--   at its Draft Step, raised only inside their Visibility; then the importer again. A row
--   whose assignee no longer passes refuses the whole confirm (`preview_outdated`).
-- * The Draft's `created` event names the importer as its actor (and the import), not the
--   assignee: app.add_register_import_to_created_event finds the confirm running in this
--   transaction by its Participant and sets the actor.

-- The rows ----------------------------------------------------------------------------

alter table submittal_register_import_row
  -- The "Assign to" cell as read ("" when not mapped, empty, or the Member was picked).
  add column assignee_text text not null default '',
  -- The Member the row is assigned to, who raises its Draft; null: the importer.
  add column assignee_member_id uuid references member (id);

create index submittal_register_import_row_assignee_member_id_idx on submittal_register_import_row (assignee_member_id);

alter table submittal_register_import_row drop constraint submittal_register_import_row_reasons_check;
alter table submittal_register_import_row add constraint submittal_register_import_row_reasons_check check (reasons <@ array[
  'subject_missing', 'subject_too_long', 'type_missing', 'type_unknown', 'type_not_allowed',
  'trade_missing', 'trade_unknown', 'trade_outside_visibility', 'scope_unknown', 'scope_not_under_trade',
  'location_unknown', 'location_outside_visibility', 'field_invalid',
  'paper_ref_too_long', 'paper_ref_repeated', 'paper_ref_taken',
  'assignee_unknown', 'assignee_cannot_create', 'assignee_outside_visibility']::text[]);

-- The Company's own register, and a Member of its own.
grant select (assignee_text, assignee_member_id) on submittal_register_import_row to rabaed_app;

-- Helpers -----------------------------------------------------------------------------

-- Member p_member_id as a raiser for Participant p_participant_id on p_project_id: their
-- active Project Member row, as app.create_work_item finds a raiser (an active Member of
-- the Participant's Company, the Participant active). No row for anyone else.
create function app.register_import_assignee(p_project_id uuid, p_participant_id uuid, p_member_id uuid)
  returns table (project_member_id uuid, base_role text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select pm.id, r.base_role
        from project_member pm
        join member m on m.id = pm.member_id
        join participant p on p.id = pm.participant_id
        join project_role r on r.id = p.project_role_id
        where pm.project_id = p_project_id and pm.participant_id = p_participant_id and pm.member_id = p_member_id
          and pm.status = 'active' and m.status = 'active' and m.company_id = p.company_id and p.status = 'active';
    end
  $$;
revoke all on function app.register_import_assignee(uuid, uuid, uuid) from public;

-- Preview ------------------------------------------------------------------------------

-- Checks the rows the api read and matched, and keeps them as a `previewed` import of the
-- caller's Participant. p_rows is an array of
-- {"row_no", "cells", "subject", "type", "type_code", "trade", "trade_id", "location",
--  "location_id", "scopes", "scope_ids", "scope_reason", "paper_ref", "fields",
--  "invalid_fields", "form_version_id", "answers", "assignee", "assignee_member_id"}: each
-- mapped cell as read ("" when not mapped), what the api matched it to (null when nothing),
-- "scope_reason" the api's 'scope_unknown' or 'scope_not_under_trade' (a Scope matched by
-- name but under another Trade), the Form fields' cells, the keys that don't fit their
-- field, the answers checked against "form_version_id", and the Member the row is assigned
-- to (RP-640). "type" and "trade" are "" where p_fixed_type or p_fixed_trade_id gives the
-- value for every row. Every id is checked here again.
-- Outcomes: 'previewed' (with the import's id) / 'not_found' (not one of the caller's
-- Projects) / 'project_closed' / 'forbidden' (the caller may raise no Submittals Type
-- there) / 'type_not_found' (a fixed Type they may not raise) / 'trade_not_found' (a fixed
-- Trade that isn't the Project's).
create or replace function app.preview_register_import(
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
      v_trade_dimension uuid;
      v_location_dimension uuid;
      v_raisable uuid[];
      v_fixed_type_id uuid;
      v_import_id uuid;
      v_row jsonb;
      v_subject text;
      -- A row's Type and Trade as recorded (the cell, or a fixed value), and trimmed.
      v_type_cell text;
      v_type_text text;
      v_trade_cell text;
      v_trade_text text;
      v_type_id uuid;
      v_trade_id uuid;
      v_location_text text;
      v_location_id uuid;
      v_scope_ids uuid[];
      v_paper_ref text;
      -- The Paper refs that appear more than once in the register, lower case.
      v_repeated text[];
      -- The row's assignee: as read, the Member, and as a raiser (their Project Member row).
      v_assignee_text text;
      v_assignee_id uuid;
      v_assignee_pm uuid;
      v_assignee_role text;
      v_reasons text[];
      v_total integer := 0;
      v_rejected integer := 0;
    begin
      select i.project_member_id, i.participant_id into v_project_member_id, v_participant_id
      from app.register_importer(p_project_id) i;
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

      v_raisable := array(select r.work_item_type_id from app.register_import_raisable_types(p_project_id) r);
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
      v_location_dimension := app.project_dimension_id(p_project_id, 'location');
      if p_fixed_trade_id is not null
        and not exists (select 1 from dimension_value where id = p_fixed_trade_id and dimension_id = v_trade_dimension)
      then
        return query select 'trade_not_found'::text, null::uuid;
        return;
      end if;
      v_repeated := array(
        select lower(btrim(r.value ->> 'paper_ref')) from jsonb_array_elements(p_rows) r
        where btrim(coalesce(r.value ->> 'paper_ref', '')) <> ''
        group by 1 having count(*) > 1);

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

        -- The Type: the Submittals Type the api matched the cell to.
        v_type_cell := case when p_fixed_type is null then coalesce(v_row ->> 'type', '') else p_fixed_type end;
        v_type_text := btrim(v_type_cell);
        v_type_id := v_fixed_type_id;
        if p_fixed_type is null then
          select t.id into v_type_id from work_item_type t
          where t.owner_kind = 'rabaed' and t.module_key = 'submittals' and t.code = v_row ->> 'type_code';
          if v_type_text = '' then
            v_reasons := array_append(v_reasons, 'type_missing');
          elsif v_type_id is null then
            v_reasons := array_append(v_reasons, 'type_unknown');
          elsif not (v_type_id = any (v_raisable)) then
            v_reasons := array_append(v_reasons, 'type_not_allowed');
          end if;
        end if;

        -- The Trade: one of the Project's, as the api matched it; then within the importer's
        -- Visibility, as app.create_work_item checks it.
        v_trade_id := p_fixed_trade_id;
        if p_fixed_trade_id is null then
          v_trade_cell := coalesce(v_row ->> 'trade', '');
          v_trade_text := btrim(v_trade_cell);
          select dv.id into v_trade_id from dimension_value dv
          where dv.dimension_id = v_trade_dimension and dv.id = nullif(v_row ->> 'trade_id', '')::uuid;
        else
          -- A fixed Trade is recorded as its code.
          select dv.code into v_trade_cell from dimension_value dv where dv.id = p_fixed_trade_id;
          v_trade_text := v_trade_cell;
        end if;
        if v_trade_text = '' then
          v_reasons := array_append(v_reasons, 'trade_missing');
        elsif v_trade_id is null then
          v_reasons := array_append(v_reasons, 'trade_unknown');
        elsif app.check_work_item_built_ins(null, p_project_id, v_project_member_id, v_trade_id, null, '{}') = 'outside_visibility' then
          v_reasons := array_append(v_reasons, 'trade_outside_visibility');
        end if;

        -- The Scopes, as the api matched them by name; each must sit under the row's Trade
        -- (a Sub-scope under a Scope chosen too), as app.create_work_item checks it.
        v_scope_ids := coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(v_row -> 'scope_ids', '[]')) x), '{}');
        if v_row ->> 'scope_reason' in ('scope_unknown', 'scope_not_under_trade') then
          v_reasons := array_append(v_reasons, v_row ->> 'scope_reason');
        elsif cardinality(v_scope_ids) > 0 and v_trade_id is not null
          and app.check_work_item_built_ins(null, p_project_id, v_project_member_id, v_trade_id, null, v_scope_ids) = 'value_not_found'
        then
          v_reasons := array_append(v_reasons, 'scope_not_under_trade');
        end if;

        -- The Location: one of the Project's, as the api matched it, within the importer's Visibility.
        v_location_text := btrim(coalesce(v_row ->> 'location', ''));
        select dv.id into v_location_id from dimension_value dv
        where dv.dimension_id = v_location_dimension and dv.id = nullif(v_row ->> 'location_id', '')::uuid;
        if v_location_text <> '' and v_location_id is null then
          v_reasons := array_append(v_reasons, 'location_unknown');
        elsif v_location_id is not null
          and v_location_id not in (select app.values_covered_by_project_member(v_project_member_id, v_location_dimension))
        then
          v_reasons := array_append(v_reasons, 'location_outside_visibility');
        end if;

        -- The Form fields, as the api checked them with the Form's validator.
        if jsonb_array_length(coalesce(v_row -> 'invalid_fields', '[]')) > 0 then
          v_reasons := array_append(v_reasons, 'field_invalid');
        end if;

        -- The Paper ref: once in the register, and not held by another item of the Participant.
        v_paper_ref := btrim(coalesce(v_row ->> 'paper_ref', ''));
        if length(v_paper_ref) > 100 then
          v_reasons := array_append(v_reasons, 'paper_ref_too_long');
        elsif v_paper_ref <> '' then
          if lower(v_paper_ref) = any (v_repeated) then
            v_reasons := array_append(v_reasons, 'paper_ref_repeated');
          end if;
          if exists (
            select 1 from work_item w
            where w.project_id = p_project_id and w.raised_by_participant_id = v_participant_id
              and lower(w.paper_ref) = lower(v_paper_ref) and w.discarded_at is null)
          then
            v_reasons := array_append(v_reasons, 'paper_ref_taken');
          end if;
        end if;

        -- The assignee (RP-640): an active Member of the importing Participant on the Project,
        -- who may raise the row's Type and covers its Trade and Location, as app.create_work_item
        -- checks its raiser. One reason for anyone else, whoever they are.
        v_assignee_text := btrim(coalesce(v_row ->> 'assignee', ''));
        v_assignee_id := nullif(v_row ->> 'assignee_member_id', '')::uuid;
        v_assignee_pm := null;
        v_assignee_role := null;
        if v_assignee_id is not null then
          select a.project_member_id, a.base_role into v_assignee_pm, v_assignee_role
          from app.register_import_assignee(p_project_id, v_participant_id, v_assignee_id) a;
        end if;
        if (v_assignee_id is not null or v_assignee_text <> '') and v_assignee_pm is null then
          v_reasons := array_append(v_reasons, 'assignee_unknown');
          v_assignee_id := null;
        elsif v_assignee_pm is not null then
          if v_type_id is not null and not app.register_import_type_raisable(
            p_project_id, v_type_id, (select t.code from work_item_type t where t.id = v_type_id), v_participant_id,
            v_assignee_pm, v_assignee_role)
          then
            v_reasons := array_append(v_reasons, 'assignee_cannot_create');
          end if;
          if v_trade_id is not null and app.check_work_item_built_ins(
            null, p_project_id, v_assignee_pm, v_trade_id, v_location_id, '{}') = 'outside_visibility'
          then
            v_reasons := array_append(v_reasons, 'assignee_outside_visibility');
          end if;
        end if;

        insert into submittal_register_import_row (
          import_id, row_no, cells, subject, type_text, trade_text, work_item_type_id, trade_id,
          location_text, location_id, scopes_text, scope_ids, paper_ref, field_cells, invalid_fields,
          form_version_id, answers, assignee_text, assignee_member_id, reasons
        ) values (
          v_import_id, (v_row ->> 'row_no')::integer, coalesce(v_row -> 'cells', '[]'), coalesce(v_row ->> 'subject', ''),
          v_type_cell, v_trade_cell, v_type_id, v_trade_id,
          coalesce(v_row ->> 'location', ''), v_location_id, coalesce(v_row ->> 'scopes', ''), v_scope_ids, v_paper_ref,
          coalesce(v_row -> 'fields', '{}'),
          coalesce(array(select jsonb_array_elements_text(coalesce(v_row -> 'invalid_fields', '[]'))), '{}'),
          nullif(v_row ->> 'form_version_id', '')::uuid, coalesce(v_row -> 'answers', '{}'),
          v_assignee_text, v_assignee_id, v_reasons
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

-- Confirm ------------------------------------------------------------------------------

-- The created event of a Draft made by app.confirm_register_import names its import, and
-- the importer as its actor even when the row's assignee raised it (RP-640). Only the
-- import that function is confirming in this very transaction, for the event's own
-- Participant, counts, so no other Draft can claim one.
create or replace function app.add_register_import_to_created_event() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_import record;
    begin
      if new.type = 'created' then
        select i.id, i.run_by_member_id into v_import from submittal_register_import i
        where i.confirm_txid = txid_current() and i.status = 'previewed'
          and i.project_id = new.project_id and i.participant_id = new.actor_participant_id;
        if v_import.id is not null then
          new.payload := new.payload || jsonb_build_object('import_id', v_import.id);
          new.actor_member_id := v_import.run_by_member_id;
        end if;
      end if;
      return new;
    end
  $$;

-- Creates the Drafts of the caller's own `previewed` import: one per good row, raised by
-- its assignee (RP-640), else by the caller, through app.create_work_item, with its
-- Location, Scopes, answers and Paper ref, all or nothing. Outcomes: 'created' (with how
-- many; again, unchanged, for an import already created) / 'not_found' (not the caller's
-- preview, or older than 7 days) / 'project_closed' / 'nothing_to_import' (no good row) /
-- 'preview_outdated' (a good row no longer passes: nothing is created; preview again).
create or replace function app.confirm_register_import(p_import_id uuid, p_now timestamptz)
  returns table (outcome text, rows_created integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_importer text := current_setting('app.member_id', true);
      v_import record;
      v_row record;
      v_created record;
      v_form_version_id uuid;
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
      -- SQLSTATE RI001 ("a previewed row no longer passes") is raised and caught only here:
      -- the block's Drafts are undone and the import answers 'preview_outdated'.
      begin
        for v_row in
          select r.row_no, btrim(r.subject) as subject, t.id as type_id, t.code as type_code, r.trade_id, r.location_id, r.scope_ids,
            nullif(r.paper_ref, '') as paper_ref, r.answers, r.form_version_id,
            -- An assignee other than the importer raises the row's Draft.
            nullif(r.assignee_member_id, v_import.run_by_member_id) as raiser,
            t.id in (select x.work_item_type_id from app.register_import_raisable_types(v_import.project_id) x) as raisable
          from submittal_register_import_row r
          join work_item_type t on t.id = r.work_item_type_id
          where r.import_id = p_import_id and cardinality(r.reasons) = 0
          order by r.row_no
        loop
          -- Its Type is checked again by the preview's rule first, so app.create_work_item's
          -- own refusal of a role (42501) is never mistaken for an outdated row.
          if not v_row.raisable then
            raise exception 'a previewed row no longer passes' using errcode = 'RI001';
          end if;
          v_form_version_id := app.new_item_form_version(v_import.project_id, v_row.type_code);
          -- Its answers were checked against the Form Version of the preview.
          if v_row.answers <> '{}'::jsonb and v_row.form_version_id is distinct from v_form_version_id then
            raise exception 'a previewed row no longer passes' using errcode = 'RI001';
          end if;
          -- Its Paper ref, taken since by another item of the Participant.
          if v_row.paper_ref is not null and exists (
            select 1 from work_item w
            where w.project_id = v_import.project_id and w.raised_by_participant_id = v_import.participant_id
              and lower(w.paper_ref) = lower(v_row.paper_ref) and w.discarded_at is null)
          then
            raise exception 'a previewed row no longer passes' using errcode = 'RI001';
          end if;
          -- Its assignee raises it, as if they had started it themselves: still an active Member
          -- of the Participant on the Project who may raise the Type (the same rule as the
          -- preview), then app.create_work_item checks them as the raiser.
          if v_row.raiser is not null then
            if not exists (select 1 from app.register_import_assignee(v_import.project_id, v_import.participant_id, v_row.raiser)) then
              raise exception 'a previewed row no longer passes' using errcode = 'RI001';
            end if;
            perform set_config('app.member_id', v_row.raiser::text, true);
            if not exists (select 1 from app.register_import_raisable_types(v_import.project_id) x where x.work_item_type_id = v_row.type_id) then
              raise exception 'a previewed row no longer passes' using errcode = 'RI001';
            end if;
          end if;
          -- The same path as a single Draft (apps/api createWorkItem): the Type's Form to
          -- start from, its answers, the Built-in Fields, then the answers' times.
          select c.outcome, c.work_item_id into v_created
          from app.create_work_item(
            v_import.project_id, v_row.type_code, v_row.subject, v_form_version_id,
            v_row.answers, v_row.trade_id, v_row.location_id, v_at, v_row.scope_ids) c;
          if v_created.outcome is distinct from 'created' then
            raise exception 'a previewed row no longer passes' using errcode = 'RI001';
          end if;
          if app.record_field_times(v_created.work_item_id, v_at) is distinct from 'recorded' then
            raise exception 'a previewed row no longer passes' using errcode = 'RI001';
          end if;
          perform set_config('app.member_id', v_importer, true);
          update work_item set import_id = p_import_id, paper_ref = v_row.paper_ref where id = v_created.work_item_id;
          update submittal_register_import_row set work_item_id = v_created.work_item_id
          where import_id = p_import_id and row_no = v_row.row_no;
          v_count := v_count + 1;
        end loop;
      exception when sqlstate 'RI001' or unique_violation then
        -- The block's writes are undone, its Member too; only the working column is left to
        -- clear. A unique_violation is a Paper ref another write took while this one ran.
        perform set_config('app.member_id', v_importer, true);
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
