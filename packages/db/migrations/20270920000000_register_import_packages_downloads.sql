-- RP-644 (spec RP-631, stories 11, 17, 28–31, 34): Packages from a Submittal Register Import, the
-- import's original register, and saved mappings (data-model.md §8 submittal_register_import,
-- register_import_mapping; visibility.md RP-589-1).
--
-- * Packages. A row goes to no Package, to one Package for the whole register (new, named in the
--   import, or an Open Package of the importing Participant), or to the Package its "Package" column
--   names: an Open Package of the Participant by name in either language, else a new one. The api
--   matches names among app.register_import_packages (the importer's own Participant's Packages
--   only) and hands each row `package_id` (an existing Package) or `package_name` (a new one); the
--   preview checks every id again: one of another Participant, discarded or made up refuses the
--   whole preview ('package_not_found', the same answer whoever asks: a Member, or a Rabaed
--   Engineer acting as the default Member), and one In Progress or Done makes its rows bad
--   (`package_not_open`). New Packages are created only on confirm, once per name, through
--   app.create_package (the Package numbering and rules), by the importer; each Draft goes in
--   through app.add_package_item as its raiser, as if added by hand (only the owning Participant's
--   submittals). A Package no longer Open at confirm refuses the confirm ('preview_outdated').
-- * The original register (story 34): the api stores a Member's register under the Project's prefix
--   (ADR 0007), projects/<project>/register-imports/<import>/<file>, and records it here
--   (`source_file_id`); it is downloaded through the api only, with no time. An Engineer's import in
--   Rabaed Admin keeps none (Rabaed Admin has no file store). A preview's file goes with the
--   preview: the worker's clean-up leaves each key in register_import_file_removal, which the api
--   empties (it alone may delete files).
-- * Saved mappings (story 11): a mapping saved under a name for the importer's Participant on the
--   Project, read by that Participant's Members only, never with a time. Written only through the
--   functions below; Rabaed Admin reads the Participant's through app.register_import_mappings.
-- * No import time anywhere (owner, 2026-10-19): neither the stored file's upload time nor a saved
--   mapping's is read by anyone.

-- The original register ---------------------------------------------------------------------

alter table submittal_register_import add column source_file_id uuid;
grant select (source_file_id) on submittal_register_import to rabaed_app;

-- Where an import's original register is stored: under its Project first (ADR 0007).
create function app.register_import_file_key(p_project_id uuid, p_import_id uuid, p_file_id uuid) returns text
  language sql immutable
  set search_path = pg_catalog
  as $$ select 'projects/' || p_project_id || '/register-imports/' || p_import_id || '/' || p_file_id $$;

-- The api has stored the register of the acting Member's own preview p_import_id as p_file_id.
-- Outcome 'stored', or 'not_found' (not their preview, or one that has a file already).
create function app.store_register_import_file(p_import_id uuid, p_file_id uuid) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      update submittal_register_import i set source_file_id = p_file_id
      where i.id = p_import_id and i.status = 'previewed' and i.source_file_id is null
        and i.run_by_member_id = app.current_member_id()
        and i.participant_id in (select app.current_participant_ids())
        and i.project_id in (select app.current_project_ids());
      return case when found then 'stored' else 'not_found' end;
    end
  $$;

-- The files of previews the worker cleaned up, for the api to delete. Nobody reads anything else of them.
create table register_import_file_removal (storage_key text primary key);
revoke all on register_import_file_removal from rabaed_app;
revoke all on register_import_file_removal from rabaed_admin;

-- Up to p_limit keys of files to delete, taken off the list: the api deletes each.
create function app.take_register_import_file_removals(p_limit integer) returns setof text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        delete from register_import_file_removal f
        where f.storage_key in (select x.storage_key from register_import_file_removal x order by x.storage_key limit least(p_limit, 100) for update skip locked)
        returning f.storage_key;
    end
  $$;

-- The worker's daily clean-up (20270628000000), now also leaving each deleted preview's file for the api to delete.
create or replace function app.clean_previewed_register_imports(p_now timestamptz) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_count integer;
    begin
      perform app.require_worker();
      with gone as (
        delete from submittal_register_import
        where status = 'previewed' and created_at < p_now - interval '7 days'
        returning project_id, id, source_file_id
      ), files as (
        insert into register_import_file_removal (storage_key)
        select app.register_import_file_key(g.project_id, g.id, g.source_file_id) from gone g where g.source_file_id is not null
        on conflict do nothing
      )
      select count(*) into v_count from gone;
      return v_count;
    end
  $$;

-- Packages ----------------------------------------------------------------------------------

alter table submittal_register_import_row
  -- The Package cell as read, trimmed ("" when none or no column).
  add column package_text text not null default '',
  -- The existing Package the row goes to; after confirm also the new one it went to.
  add column package_id uuid references package (id),
  -- The name of the new Package the row goes to, created on confirm.
  add column package_name text check (package_name is null or (package_name = btrim(package_name) and length(package_name) between 1 and 200));
create index submittal_register_import_row_package_id_idx on submittal_register_import_row (package_id) where package_id is not null;

-- The Company's own register and its own Packages.
grant select (package_text, package_id, package_name) on submittal_register_import_row to rabaed_app;

alter table submittal_register_import_row drop constraint submittal_register_import_row_reasons_check;
alter table submittal_register_import_row add constraint submittal_register_import_row_reasons_check check (reasons <@ array[
  'subject_missing', 'subject_too_long', 'type_missing', 'type_unknown', 'type_not_allowed',
  'trade_missing', 'trade_unknown', 'trade_outside_visibility', 'scope_unknown', 'scope_not_under_trade',
  'location_unknown', 'location_outside_visibility', 'field_invalid',
  'paper_ref_too_long', 'paper_ref_repeated', 'paper_ref_taken',
  'assignee_unknown', 'assignee_cannot_create', 'assignee_outside_visibility',
  'package_not_open', 'package_name_too_long']::text[]);

-- The Packages of the importer's own Participant on p_project_id (not discarded), each with its
-- number and status: what a register's Package names match, and the Open ones the wizard offers.
-- Said for the acting Member (a Rabaed Engineer's default Member in Rabaed Admin), never by RLS.
create function app.register_import_packages(p_project_id uuid)
  returns table (package_id uuid, seq integer, name jsonb, status text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select k.id, k.seq, k.name, k.status
        from package k
        join app.register_importer(p_project_id) i on i.participant_id = k.participant_id
        where k.project_id = p_project_id and k.discarded_at is null
        order by k.seq;
    end
  $$;

-- The preview (20270808000000), now also checking each row's Package.
create or replace function app.register_import_preview(
  p_engineer_id uuid, p_participant_id uuid,
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
      -- The row's Package (RP-644): an existing one, or the name of a new one.
      v_package_id uuid;
      v_package_name text;
      v_package_status text;
      v_reasons text[];
      v_total integer := 0;
      v_rejected integer := 0;
    begin
      select i.project_member_id, i.participant_id into v_project_member_id, v_participant_id
      from app.register_importer(p_project_id) i;
      -- An Engineer's default Member is a Member of the Participant they import for.
      if v_project_member_id is null or (p_engineer_id is not null and v_participant_id is distinct from p_participant_id) then
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
      -- A Package the rows name must be one of the importing Participant's own on the Project
      -- (RP-644): another Participant's, a discarded one or a made-up id is one answer, whoever asks.
      if exists (
        select 1 from jsonb_array_elements(p_rows) r
        where nullif(r.value ->> 'package_id', '') is not null
          and not exists (
            select 1 from package k
            where k.id = (r.value ->> 'package_id')::uuid and k.project_id = p_project_id
              and k.participant_id = v_participant_id and k.discarded_at is null))
      then
        return query select 'package_not_found'::text, null::uuid;
        return;
      end if;
      v_repeated := array(
        select lower(btrim(r.value ->> 'paper_ref')) from jsonb_array_elements(p_rows) r
        where btrim(coalesce(r.value ->> 'paper_ref', '')) <> ''
        group by 1 having count(*) > 1);

      -- A Member's import is theirs; an Engineer's is the Engineer's, for its default Member.
      insert into submittal_register_import (
        project_id, participant_id, run_by_member_id, run_by_engineer_id, default_member_id,
        file_name, sheet, header_row, headers, mapping, rows_total, rows_rejected, created_at
      ) values (
        p_project_id, v_participant_id,
        case when p_engineer_id is null then app.current_member_id() end,
        p_engineer_id,
        case when p_engineer_id is not null then app.current_member_id() end,
        p_file_name, p_sheet, p_header_row, p_headers, p_mapping, 0, 0, v_at
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

        -- The Package (RP-644): an existing one of the Participant (checked above), which must
        -- still be Open to take new Drafts; or a new one, named in the import, created on confirm.
        v_package_id := nullif(v_row ->> 'package_id', '')::uuid;
        v_package_name := nullif(btrim(coalesce(v_row ->> 'package_name', '')), '');
        if v_package_id is not null and v_package_name is not null then
          raise exception 'a register row goes to one Package' using errcode = '22023';
        end if;
        if v_package_id is not null then
          select k.status into v_package_status from package k where k.id = v_package_id;
          if v_package_status <> 'open' then
            v_reasons := array_append(v_reasons, 'package_not_open');
          end if;
        elsif length(v_package_name) > 200 then
          v_reasons := array_append(v_reasons, 'package_name_too_long');
          v_package_name := null;
        end if;

        insert into submittal_register_import_row (
          import_id, row_no, cells, subject, type_text, trade_text, work_item_type_id, trade_id,
          location_text, location_id, scopes_text, scope_ids, paper_ref, field_cells, invalid_fields,
          form_version_id, answers, assignee_text, assignee_member_id,
          package_text, package_id, package_name, reasons
        ) values (
          v_import_id, (v_row ->> 'row_no')::integer, coalesce(v_row -> 'cells', '[]'), coalesce(v_row ->> 'subject', ''),
          v_type_cell, v_trade_cell, v_type_id, v_trade_id,
          coalesce(v_row ->> 'location', ''), v_location_id, coalesce(v_row ->> 'scopes', ''), v_scope_ids, v_paper_ref,
          coalesce(v_row -> 'fields', '{}'),
          coalesce(array(select jsonb_array_elements_text(coalesce(v_row -> 'invalid_fields', '[]'))), '{}'),
          nullif(v_row ->> 'form_version_id', '')::uuid, coalesce(v_row -> 'answers', '{}'),
          v_assignee_text, v_assignee_id,
          btrim(coalesce(v_row ->> 'package', '')), v_package_id, v_package_name, v_reasons
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

-- The confirm (20270808000000), now also putting each Draft in its Package.
create or replace function app.register_import_confirm(p_engineer_id uuid, p_import_id uuid, p_now timestamptz)
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
      -- The Packages this confirm created, by their name in lower case (RP-644).
      v_new_packages jsonb := '{}';
      v_package record;
      v_package_id uuid;
      v_package_status text;
    begin
      select i.* into v_import from submittal_register_import i
      where i.id = p_import_id
        and case
          when p_engineer_id is null then i.run_by_member_id = app.current_member_id()
          else i.run_by_engineer_id = p_engineer_id and i.default_member_id = app.current_member_id()
        end
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
            nullif(r.paper_ref, '') as paper_ref, r.answers, r.form_version_id, r.package_id, r.package_name,
            -- An assignee other than the importer (the Member, or the default Member) raises the row's Draft.
            nullif(r.assignee_member_id, coalesce(v_import.run_by_member_id, v_import.default_member_id)) as raiser,
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
          -- Its existing Package, still the Participant's and still Open (RP-644): locked, so a
          -- Submit can't start it while its new Drafts go in.
          if v_row.package_id is not null then
            v_package_status := null;
            select k.status into v_package_status from package k
            where k.id = v_row.package_id and k.participant_id = v_import.participant_id and k.discarded_at is null
            for update;
            if v_package_status is distinct from 'open' then
              raise exception 'a previewed row no longer passes' using errcode = 'RI001';
            end if;
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
          -- Its Package (RP-644): a new one is created once per name, by the importer, through
          -- app.create_package (the Package numbering and rules); then the Draft goes in as its
          -- raiser through app.add_package_item, as if they had added it by hand.
          v_package_id := v_row.package_id;
          if v_row.package_name is not null then
            v_package_id := (v_new_packages ->> lower(v_row.package_name))::uuid;
            if v_package_id is null then
              perform set_config('app.member_id', v_importer, true);
              select c.outcome, c.package_id into v_package
              from app.create_package(v_import.project_id, jsonb_build_object('en', v_row.package_name, 'ar', v_row.package_name), v_at) c;
              if v_package.outcome is distinct from 'created' then
                raise exception 'a previewed row no longer passes' using errcode = 'RI001';
              end if;
              v_package_id := v_package.package_id;
              v_new_packages := v_new_packages || jsonb_build_object(lower(v_row.package_name), v_package_id);
              if v_row.raiser is not null then
                perform set_config('app.member_id', v_row.raiser::text, true);
              end if;
            end if;
          end if;
          if v_package_id is not null and app.add_package_item(v_package_id, v_created.work_item_id, v_at) is distinct from 'added' then
            raise exception 'a previewed row no longer passes' using errcode = 'RI001';
          end if;
          perform set_config('app.member_id', v_importer, true);
          update work_item set import_id = p_import_id, paper_ref = v_row.paper_ref where id = v_created.work_item_id;
          update submittal_register_import_row set work_item_id = v_created.work_item_id, package_id = v_package_id
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

-- Saved mappings ----------------------------------------------------------------------------

create table register_import_mapping (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id),
  participant_id uuid not null,
  name text not null check (name = btrim(name) and length(name) between 1 and 100),
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  created_by_member_id uuid not null references member (id),
  -- For audit only: never read (no import time anywhere, owner 2026-10-19).
  created_at timestamptz not null default now(),
  constraint register_import_mapping_participant_fk foreign key (participant_id, project_id) references participant (id, project_id)
);
create unique index register_import_mapping_name_key on register_import_mapping (participant_id, lower(name));
create index register_import_mapping_project_id_idx on register_import_mapping (project_id);
create index register_import_mapping_created_by_member_id_idx on register_import_mapping (created_by_member_id);

alter table register_import_mapping enable row level security;
revoke all on register_import_mapping from rabaed_app;
-- Its name and mapping; never who saved it or when.
grant select (id, project_id, participant_id, name, mapping) on register_import_mapping to rabaed_app;
create policy member_reads_own_participant_register_import_mappings on register_import_mapping for select to rabaed_app
  using (participant_id in (select app.current_participant_ids()) and project_id in (select app.current_project_ids()));

-- The saved mappings of the importer's own Participant on p_project_id, by name. Said for the
-- acting Member (a Rabaed Engineer's default Member in Rabaed Admin), never by RLS.
create function app.register_import_mappings(p_project_id uuid) returns table (mapping_id uuid, name text, mapping jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select m.id, m.name, m.mapping
        from register_import_mapping m
        join app.register_importer(p_project_id) i on i.participant_id = m.participant_id
        where m.project_id = p_project_id
        order by lower(m.name), m.id;
    end
  $$;

-- A Member of a Participant on p_project_id saves mapping p_mapping under p_name for their
-- Participant. Outcome 'saved' (with its id), 'not_found' (not a Project of theirs) or 'name_taken'.
create function app.save_register_import_mapping(p_project_id uuid, p_name text, p_mapping jsonb, p_now timestamptz)
  returns table (outcome text, mapping_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_participant_id uuid;
      v_id uuid;
    begin
      select i.participant_id into v_participant_id from app.register_importer(p_project_id) i;
      if v_participant_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if exists (select 1 from register_import_mapping m where m.participant_id = v_participant_id and lower(m.name) = lower(btrim(p_name))) then
        return query select 'name_taken'::text, null::uuid;
        return;
      end if;
      insert into register_import_mapping (project_id, participant_id, name, mapping, created_by_member_id, created_at)
      values (p_project_id, v_participant_id, btrim(p_name), p_mapping, app.current_member_id(), greatest(p_now, now()))
      returning id into v_id;
      return query select 'saved'::text, v_id;
    exception when unique_violation then
      return query select 'name_taken'::text, null::uuid;
    end
  $$;

-- The saved mapping p_mapping_id of the acting Member's Participant, locked; no row for anyone else.
create function app.register_import_mapping_for_write(p_mapping_id uuid) returns table (mapping_id uuid, participant_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select m.id, m.participant_id from register_import_mapping m
        join app.register_importer(m.project_id) i on i.participant_id = m.participant_id
        where m.id = p_mapping_id
        for update of m;
    end
  $$;

-- A Member of its Participant renames saved mapping p_mapping_id. Outcome 'renamed', 'not_found' or 'name_taken'.
create function app.rename_register_import_mapping(p_mapping_id uuid, p_name text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_mapping record;
    begin
      select * into v_mapping from app.register_import_mapping_for_write(p_mapping_id);
      if v_mapping.mapping_id is null then
        return 'not_found';
      end if;
      if exists (
        select 1 from register_import_mapping m
        where m.participant_id = v_mapping.participant_id and lower(m.name) = lower(btrim(p_name)) and m.id <> p_mapping_id)
      then
        return 'name_taken';
      end if;
      update register_import_mapping set name = btrim(p_name) where id = p_mapping_id;
      return 'renamed';
    exception when unique_violation then
      return 'name_taken';
    end
  $$;

-- A Member of its Participant deletes saved mapping p_mapping_id. Outcome 'removed' or 'not_found'.
create function app.delete_register_import_mapping(p_mapping_id uuid) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_mapping record;
    begin
      select * into v_mapping from app.register_import_mapping_for_write(p_mapping_id);
      if v_mapping.mapping_id is null then
        return 'not_found';
      end if;
      delete from register_import_mapping where id = p_mapping_id;
      return 'removed';
    end
  $$;

-- Grants ------------------------------------------------------------------------------------

revoke all on function
  app.register_import_file_key(uuid, uuid, uuid),
  app.store_register_import_file(uuid, uuid),
  app.take_register_import_file_removals(integer),
  app.register_import_packages(uuid),
  app.register_import_mappings(uuid),
  app.save_register_import_mapping(uuid, text, jsonb, timestamptz),
  app.register_import_mapping_for_write(uuid),
  app.rename_register_import_mapping(uuid, text),
  app.delete_register_import_mapping(uuid)
  from public;
grant execute on function
  app.register_import_file_key(uuid, uuid, uuid),
  app.store_register_import_file(uuid, uuid),
  app.take_register_import_file_removals(integer),
  app.register_import_packages(uuid),
  app.register_import_mappings(uuid),
  app.save_register_import_mapping(uuid, text, jsonb, timestamptz),
  app.rename_register_import_mapping(uuid, text),
  app.delete_register_import_mapping(uuid)
  to rabaed_app;
-- Rabaed Admin's import code reads the default Member's Packages and saved mappings (RP-645's wizard).
grant execute on function
  app.register_import_packages(uuid),
  app.register_import_mappings(uuid)
  to rabaed_admin;
