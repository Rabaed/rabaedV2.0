-- RP-639 (spec RP-631): the Register Import's value matching, optional fields and Paper ref
-- (data-model.md §5 work_item.paper_ref, §8 submittal_register_import_row; visibility.md RP-589-1).
--
-- * Matching moves to the api (`@rabaed/domain` register-import-match): Type, Trade,
--   Location, Scopes and option fields are matched by code or name in either language,
--   ignoring case and spaces, or by the value matches the importer made once in the
--   mapping. The api hands app.preview_register_import what each row matched, and the
--   function checks those ids against the Project as before: a Type it may not raise, a
--   Trade or Location outside the importer's Visibility, Scopes not under the row's Trade.
-- * A row may fill the Draft's Location, Scopes, simple Form fields of its Type (the api
--   checks them with the Form's own validator: `answers`, or `invalid_fields`) and its
--   Paper ref: the old paper number of a submittal still under review on paper, never a
--   Document Number. A Paper ref repeated in the register, or held by a Work Item of the
--   same Participant on the Project that isn't discarded, makes the row bad; a unique
--   index keeps it so for every later write.
-- * app.confirm_register_import creates each Draft with those values, through
--   app.create_work_item as before, and sets its Paper ref. A row whose Type's Form has a
--   newer Version since the preview, or whose Paper ref was taken since, no longer passes.
-- * app.set_work_item_paper_ref: the raiser edits the Paper ref while the item is a Draft
--   they may edit.
--
-- work_item.paper_ref is granted to the app role: everyone who sees the item reads it, as
-- they read the Subject. It is written only while the item is a Draft, so a Send Back
-- never changes what another Company saw.

-- Paper ref --------------------------------------------------------------------------

alter table work_item add column paper_ref text
  check (paper_ref is null or (paper_ref = btrim(paper_ref) and length(paper_ref) between 1 and 100));

-- One per Participant on a Project, whatever the case, among items not discarded.
create unique index work_item_paper_ref_key on work_item (project_id, raised_by_participant_id, lower(paper_ref))
  where paper_ref is not null and discarded_at is null;

grant select (paper_ref) on work_item to rabaed_app;

-- Sets the Paper ref of a Draft the caller may edit now (never numbered, at its Draft
-- Step, app.can_save_answers), or clears it (null or blank). Outcomes: 'saved' /
-- 'not_found' (an item they don't see) / 'project_closed' / 'not_editable' /
-- 'paper_ref_too_long' (over 100 characters) / 'paper_ref_taken' (another item of their
-- Participant on the Project, not discarded, holds it, whatever the case).
create function app.set_work_item_paper_ref(p_work_item_id uuid, p_paper_ref text, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_ref text := nullif(btrim(coalesce(p_paper_ref, '')), '');
      v_item record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.id, w.project_id, w.raised_by_participant_id, w.document_number, w.discarded_at, w.current_step_id
      into v_item from work_item w where w.id = p_work_item_id
      for update;
      if exists (select 1 from project where id = v_item.project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if v_item.document_number is not null or v_item.discarded_at is not null
        or not app.is_draft_step(v_item.current_step_id) or not app.can_save_answers(p_work_item_id)
      then
        return 'not_editable';
      end if;
      if length(v_ref) > 100 then
        return 'paper_ref_too_long';
      end if;
      if v_ref is not null and exists (
        select 1 from work_item w
        where w.project_id = v_item.project_id and w.raised_by_participant_id = v_item.raised_by_participant_id
          and lower(w.paper_ref) = lower(v_ref) and w.discarded_at is null and w.id <> p_work_item_id)
      then
        return 'paper_ref_taken';
      end if;
      begin
        update work_item set paper_ref = v_ref, updated_at = greatest(p_now, now()) where id = p_work_item_id;
      exception when unique_violation then
        -- Taken by a write that committed while this one ran.
        return 'paper_ref_taken';
      end;
      return 'saved';
    end
  $$;
revoke all on function app.set_work_item_paper_ref(uuid, text, timestamptz) from public;
grant execute on function app.set_work_item_paper_ref(uuid, text, timestamptz) to rabaed_app;

-- The import's rows ---------------------------------------------------------------------

alter table submittal_register_import_row
  -- The Location and Scopes cells as read ("" when not mapped or empty), and what they matched.
  add column location_text text not null default '',
  add column location_id uuid references dimension_value (id),
  add column scopes_text text not null default '',
  add column scope_ids uuid[] not null default '{}',
  -- The Paper ref as read, trimmed ("" when none).
  add column paper_ref text not null default '',
  -- The mapped Form fields' cells as read, by field key, and the keys whose value doesn't fit its field.
  add column field_cells jsonb not null default '{}' check (jsonb_typeof(field_cells) = 'object'),
  add column invalid_fields text[] not null default '{}',
  -- The Form Version the answers were checked against, and the answers as the Draft takes them
  -- (app.create_work_item's p_data). Never granted: the confirm reads them.
  add column form_version_id uuid references form_version (id),
  add column answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object');

create index submittal_register_import_row_location_id_idx on submittal_register_import_row (location_id);
create index submittal_register_import_row_form_version_id_idx on submittal_register_import_row (form_version_id);

alter table submittal_register_import_row drop constraint submittal_register_import_row_reasons_check;
alter table submittal_register_import_row add constraint submittal_register_import_row_reasons_check check (reasons <@ array[
  'subject_missing', 'subject_too_long', 'type_missing', 'type_unknown', 'type_not_allowed',
  'trade_missing', 'trade_unknown', 'trade_outside_visibility', 'scope_unknown', 'scope_not_under_trade',
  'location_unknown', 'location_outside_visibility', 'field_invalid',
  'paper_ref_too_long', 'paper_ref_repeated', 'paper_ref_taken']::text[]);

-- The Company's own register, as read and as matched.
grant select (location_text, location_id, scopes_text, scope_ids, paper_ref, field_cells, invalid_fields)
  on submittal_register_import_row to rabaed_app;

-- Preview ------------------------------------------------------------------------------

-- Checks the rows the api read and matched, and keeps them as a `previewed` import of the
-- caller's Participant. p_rows is an array of
-- {"row_no", "cells", "subject", "type", "type_code", "trade", "trade_id", "location",
--  "location_id", "scopes", "scope_ids", "scope_reason", "paper_ref", "fields",
--  "invalid_fields", "form_version_id", "answers"}: each mapped cell as read ("" when not
-- mapped), what the api matched it to (null when nothing), "scope_reason" the api's
-- 'scope_unknown' or 'scope_not_under_trade' (a Scope matched by name but under another
-- Trade), and the Form fields' cells, the keys that don't fit their field, and the answers
-- checked against "form_version_id". "type" and "trade" are "" where p_fixed_type or
-- p_fixed_trade_id gives the value for every row. Every id is checked here again.
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

        insert into submittal_register_import_row (
          import_id, row_no, cells, subject, type_text, trade_text, work_item_type_id, trade_id,
          location_text, location_id, scopes_text, scope_ids, paper_ref, field_cells, invalid_fields,
          form_version_id, answers, reasons
        ) values (
          v_import_id, (v_row ->> 'row_no')::integer, coalesce(v_row -> 'cells', '[]'), coalesce(v_row ->> 'subject', ''),
          v_type_cell, v_trade_cell, v_type_id, v_trade_id,
          coalesce(v_row ->> 'location', ''), v_location_id, coalesce(v_row ->> 'scopes', ''), v_scope_ids, v_paper_ref,
          coalesce(v_row -> 'fields', '{}'),
          coalesce(array(select jsonb_array_elements_text(coalesce(v_row -> 'invalid_fields', '[]'))), '{}'),
          nullif(v_row ->> 'form_version_id', '')::uuid, coalesce(v_row -> 'answers', '{}'), v_reasons
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

-- Creates the Drafts of the caller's own `previewed` import: one per good row, raised
-- by the caller through app.create_work_item, with its Location, Scopes, answers and
-- Paper ref, all or nothing. Outcomes: 'created' (with how many; again, unchanged, for
-- an import already created) / 'not_found' (not the caller's preview, or older than 7
-- days) / 'project_closed' / 'nothing_to_import' (no good row) / 'preview_outdated' (a
-- good row no longer passes: nothing is created; preview again).
create or replace function app.confirm_register_import(p_import_id uuid, p_now timestamptz)
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
          select r.row_no, btrim(r.subject) as subject, t.code as type_code, r.trade_id, r.location_id, r.scope_ids,
            nullif(r.paper_ref, '') as paper_ref, r.answers, r.form_version_id,
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
          update work_item set import_id = p_import_id, paper_ref = v_row.paper_ref where id = v_created.work_item_id;
          update submittal_register_import_row set work_item_id = v_created.work_item_id
          where import_id = p_import_id and row_no = v_row.row_no;
          v_count := v_count + 1;
        end loop;
      exception when sqlstate 'RI001' or unique_violation then
        -- The block's writes are undone; only the working column is left to clear. A
        -- unique_violation is a Paper ref another write took while this one ran.
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
