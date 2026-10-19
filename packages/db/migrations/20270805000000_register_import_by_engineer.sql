-- RP-645 (spec RP-631, stories 38–41): a Register Import run by a Rabaed Engineer in Rabaed Admin
-- for a chosen Participant (data-model.md §8 submittal_register_import; visibility.md RP-589-3).
--
-- * The Engineer picks a Project, a Participant and a default Member of it, gives a reason, and
--   runs the same import the Member would: the Rabaed Admin service runs the api's own import
--   code (read, match, preview, confirm) on its connection, acting as the default Member
--   (`app.member_id`), so every check is the one a Member's import gets, the default Member
--   standing where the importer stands: they raise every row nobody else is assigned
--   ("Assign to" by email, a rule, or the wizard's default override it per row with the same
--   refusals), each row's Type is one they may raise and its values inside their Visibility.
-- * The import records the Engineer (`run_by_engineer_id`) and the default Member
--   (`default_member_id`), never as `run_by_member_id`: the Company's Members read "Rabaed" as
--   who imported, on the Imports page, the import's page and the Drafts' history, never the
--   Engineer (`run_by_engineer_id` is not granted to the app role; the default Member, their own,
--   is). No time is read by anyone, the Admin wizard included; the admin_action keeps its own
--   `at` for Rabaed's audit only.
-- * Only rabaed_admin runs the Engineer's preview, confirm and results
--   (app.preview_register_import_by_engineer and the others below); only rabaed_app the
--   Member's. Both are the one body each (app.register_import_preview, app.register_import_confirm,
--   app.register_import_row_results), so the checks exist once.
-- * Each Draft's `created` event names the Engineer as its actor (`actor_engineer_id`) and the
--   import (still read by nobody: scenario 61). app.register_import_of_work_item gives the
--   importing Participant's Members the import a Draft came from, for its history (story 35),
--   with "Rabaed" for an Engineer's and no time. An import notifies nobody (owner, 2026-10-19).
-- * Every use of the admin connection is an admin_action with the Engineer's reason (V9):
--   `read_register_import` (the Project's Participants and Members, the register as read, what
--   it may fill, a preview), `preview_register_import`, `confirm_register_import`.

-- The import ---------------------------------------------------------------------------

alter table submittal_register_import
  alter column run_by_member_id drop not null,
  -- A Rabaed Engineer's import (Rabaed Admin): never granted, the Company reads "Rabaed".
  add column run_by_engineer_id uuid references rabaed_engineer (id),
  -- The Member who raises the rows nobody else is assigned in an Engineer's import (the
  -- importer's place): one of the Company's own, granted like run_by_member_id.
  add column default_member_id uuid references member (id),
  add constraint submittal_register_import_run_by_check check ((run_by_member_id is null) <> (run_by_engineer_id is null)),
  add constraint submittal_register_import_default_member_check check ((run_by_engineer_id is null) = (default_member_id is null));

create index submittal_register_import_run_by_engineer_id_idx on submittal_register_import (run_by_engineer_id);
create index submittal_register_import_default_member_id_idx on submittal_register_import (default_member_id);

-- Who raises its unassigned rows is the Company's own Member; the Engineer is never granted.
grant select (default_member_id) on submittal_register_import to rabaed_app;

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
    'read_register_import', 'preview_register_import', 'confirm_register_import'
  ));

-- Who may import for a Participant (Rabaed Admin) -----------------------------------------

-- The active Members of each active Participant on p_project_id, and whether each may import
-- there: a Submittals Type they may raise, by the rule the preview and the confirm check
-- (app.register_import_type_raisable). Rabaed Admin's Company & reason step; for rabaed_admin.
create function app.register_import_raisers(p_project_id uuid)
  returns table (participant_id uuid, member_id uuid, may_import boolean)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select pm.participant_id, pm.member_id, exists (
          select 1 from work_item_type t
          where t.owner_kind = 'rabaed' and t.module_key = 'submittals'
            and app.register_import_type_raisable(p_project_id, t.id, t.code, pm.participant_id, pm.id, r.base_role))
        from project_member pm
        join member m on m.id = pm.member_id
        join participant p on p.id = pm.participant_id
        join project_role r on r.id = p.project_role_id
        where pm.project_id = p_project_id and pm.status = 'active' and m.status = 'active'
          and p.status = 'active' and m.company_id = p.company_id;
    end
  $$;
revoke all on function app.register_import_raisers(uuid) from public;
grant execute on function app.register_import_raisers(uuid) to rabaed_admin;

-- Preview ------------------------------------------------------------------------------

-- The preview's one body (20270802000000's app.preview_register_import, with the Engineer's
-- import): checks the rows the api read and matched, and keeps them as a `previewed` import of
-- the importer's Participant. The importer is the session's Member: the Member importing, or
-- for p_engineer_id the default Member they import for, of Participant p_participant_id (any
-- other Participant answers 'not_found'). See app.preview_register_import for p_rows and the
-- outcomes. Not granted: the two wrappers below are.
create function app.register_import_preview(
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
revoke all on function app.register_import_preview(uuid, uuid, uuid, text, text, integer, jsonb, jsonb, jsonb, text, uuid, timestamptz) from public;

-- A Member's preview (granted to rabaed_app since 20270628000000). p_rows is an array of
-- {"row_no", "cells", "subject", "type", "type_code", "trade", "trade_id", "location",
--  "location_id", "scopes", "scope_ids", "scope_reason", "paper_ref", "fields",
--  "invalid_fields", "form_version_id", "answers", "assignee", "assignee_member_id"} (see
-- 20270802000000). Outcomes: 'previewed' (with the import's id) / 'not_found' / 'project_closed'
-- / 'forbidden' / 'type_not_found' / 'trade_not_found'.
create or replace function app.preview_register_import(
  p_project_id uuid, p_file_name text, p_sheet text, p_header_row integer, p_headers jsonb,
  p_mapping jsonb, p_rows jsonb, p_fixed_type text, p_fixed_trade_id uuid, p_now timestamptz
) returns table (outcome text, import_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return query select * from app.register_import_preview(
        null, null, p_project_id, p_file_name, p_sheet, p_header_row, p_headers, p_mapping, p_rows, p_fixed_type, p_fixed_trade_id, p_now);
    end
  $$;

-- A Rabaed Engineer's preview for Participant p_participant_id, run as its default Member (the
-- session's Member, set by Rabaed Admin): the same checks, the default Member as the importer.
-- Rabaed Admin only.
create function app.preview_register_import_by_engineer(
  p_engineer_id uuid, p_participant_id uuid,
  p_project_id uuid, p_file_name text, p_sheet text, p_header_row integer, p_headers jsonb,
  p_mapping jsonb, p_rows jsonb, p_fixed_type text, p_fixed_trade_id uuid, p_now timestamptz
) returns table (outcome text, import_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if p_engineer_id is null or p_participant_id is null then
        raise exception 'an Engineer''s import names its Engineer and Participant' using errcode = '22023';
      end if;
      return query select * from app.register_import_preview(
        p_engineer_id, p_participant_id, p_project_id, p_file_name, p_sheet, p_header_row, p_headers, p_mapping, p_rows,
        p_fixed_type, p_fixed_trade_id, p_now);
    end
  $$;
revoke all on function app.preview_register_import_by_engineer(uuid, uuid, uuid, text, text, integer, jsonb, jsonb, jsonb, text, uuid, timestamptz) from public;
grant execute on function app.preview_register_import_by_engineer(uuid, uuid, uuid, text, text, integer, jsonb, jsonb, jsonb, text, uuid, timestamptz) to rabaed_admin;

-- Confirm ------------------------------------------------------------------------------

-- The created event of a Draft made by app.confirm_register_import names its import, and its
-- importer as its actor even when the row's assignee raised it (RP-640): the Member, or for an
-- Engineer's import the Engineer (RP-645), whom the Company reads as "Rabaed". Only the import
-- confirming in this very transaction, for the event's own Participant, counts.
create or replace function app.add_register_import_to_created_event() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_import record;
    begin
      if new.type = 'created' then
        select i.id, i.run_by_member_id, i.run_by_engineer_id into v_import from submittal_register_import i
        where i.confirm_txid = txid_current() and i.status = 'previewed'
          and i.project_id = new.project_id and i.participant_id = new.actor_participant_id;
        if v_import.id is not null then
          new.payload := new.payload || jsonb_build_object('import_id', v_import.id);
          new.actor_member_id := v_import.run_by_member_id;
          new.actor_engineer_id := v_import.run_by_engineer_id;
        end if;
      end if;
      return new;
    end
  $$;

-- The confirm's one body (20270802000000's app.confirm_register_import, with the Engineer's
-- import): creates the Drafts of the session Member's own `previewed` import, or for
-- p_engineer_id that Engineer's import whose default Member the session's Member is. Every good
-- row's Draft is raised by its assignee, else by the importer (the Member, or the default
-- Member), through app.create_work_item, all or nothing. See app.confirm_register_import for the
-- outcomes. Not granted: the two wrappers below are.
create function app.register_import_confirm(p_engineer_id uuid, p_import_id uuid, p_now timestamptz)
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
            nullif(r.paper_ref, '') as paper_ref, r.answers, r.form_version_id,
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
revoke all on function app.register_import_confirm(uuid, uuid, timestamptz) from public;

-- A Member's confirm of their own preview (granted to rabaed_app since 20270628000000).
-- Outcomes: 'created' (with how many; again, unchanged, for an import already created) /
-- 'not_found' (not the caller's preview, or older than 7 days) / 'project_closed' /
-- 'nothing_to_import' (no good row) / 'preview_outdated' (a good row no longer passes:
-- nothing is created; preview again).
create or replace function app.confirm_register_import(p_import_id uuid, p_now timestamptz)
  returns table (outcome text, rows_created integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return query select * from app.register_import_confirm(null, p_import_id, p_now);
    end
  $$;

-- A Rabaed Engineer's confirm of their own preview, run as its default Member (the session's
-- Member). The same outcomes. Rabaed Admin only.
create function app.confirm_register_import_by_engineer(p_engineer_id uuid, p_import_id uuid, p_now timestamptz)
  returns table (outcome text, rows_created integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if p_engineer_id is null then
        raise exception 'an Engineer''s import names its Engineer' using errcode = '22023';
      end if;
      return query select * from app.register_import_confirm(p_engineer_id, p_import_id, p_now);
    end
  $$;
revoke all on function app.confirm_register_import_by_engineer(uuid, uuid, timestamptz) from public;
grant execute on function app.confirm_register_import_by_engineer(uuid, uuid, timestamptz) to rabaed_admin;

-- Results ------------------------------------------------------------------------------

-- The results' one body (20270628000000's app.register_import_results, with the Engineer's
-- import): each row of an import the session's Member reads (a created one of their
-- Participant, their own preview, or for p_engineer_id that Engineer's preview for its default
-- Member), whether it created a Draft, and that Draft only where they see it. Not granted.
create function app.register_import_row_results(p_engineer_id uuid, p_import_id uuid)
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
          and case
            when p_engineer_id is null then i.status = 'created' or i.run_by_member_id = app.current_member_id()
            else i.run_by_engineer_id = p_engineer_id and i.default_member_id = app.current_member_id()
          end
        order by r.row_no;
    end
  $$;
revoke all on function app.register_import_row_results(uuid, uuid) from public;

create or replace function app.register_import_results(p_import_id uuid)
  returns table (row_no integer, created boolean, work_item_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return query select * from app.register_import_row_results(null, p_import_id);
    end
  $$;

-- Rabaed Admin only: an Engineer's own import's rows, read as its default Member.
create function app.register_import_results_by_engineer(p_engineer_id uuid, p_import_id uuid)
  returns table (row_no integer, created boolean, work_item_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if p_engineer_id is null then
        raise exception 'an Engineer''s import names its Engineer' using errcode = '22023';
      end if;
      return query select * from app.register_import_row_results(p_engineer_id, p_import_id);
    end
  $$;
revoke all on function app.register_import_results_by_engineer(uuid, uuid) from public;
grant execute on function app.register_import_results_by_engineer(uuid, uuid) to rabaed_admin;

-- The import in a Draft's history ------------------------------------------------------------

-- The import that created Draft p_work_item_id, for its history (story 35): which import (its
-- id and file name) and who ran it: a Member of the importing Participant by name, or a Rabaed
-- Engineer as "Rabaed" (`by_rabaed`, never the Engineer). No time: the import's is when the
-- Draft was started (scenario 61), and the `created` event stays unread. Only for a Member of
-- the importing Participant who sees the Draft; no row for anyone else (another Company never
-- learns of the import, `work_item.import_id` stays ungranted).
create function app.register_import_of_work_item(p_work_item_id uuid)
  returns table (import_id uuid, file_name text, member_name jsonb, by_rabaed boolean)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select i.id, i.file_name, m.full_name, i.run_by_engineer_id is not null
        from work_item w
        join submittal_register_import i on i.id = w.import_id
        left join member m on m.id = i.run_by_member_id
        where w.id = p_work_item_id
          and i.participant_id in (select app.current_participant_ids())
          and app.sees_work_item(w.id);
    end
  $$;
revoke all on function app.register_import_of_work_item(uuid) from public;
grant execute on function app.register_import_of_work_item(uuid) to rabaed_app;

-- The api's import code, run by Rabaed Admin as the default Member --------------------------

-- What the api's read, match and preview steps call besides the functions above: the rule of
-- what the default Member may raise, and the definer helpers the api reads the Project through
-- for its Members (their Participant, the Form and Workflow a new Draft gets, whom a field may
-- name). Each answers for the session's Member only; rabaed_admin reads every table anyway.
grant execute on function app.register_import_raisable_types(uuid) to rabaed_admin;
grant execute on function
  app.current_participant_ids(),
  app.new_item_form_version(uuid, text),
  app.new_item_workflow_version(uuid, uuid, uuid),
  app.form_participant_choices(uuid, uuid),
  app.actor_holder(jsonb)
  to rabaed_admin;
