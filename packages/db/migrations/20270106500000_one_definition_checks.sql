-- Review fixes of spec RP-423 (RP-449; CODING_STANDARDS, Tests: "A rule enforced in SQL
-- and in TypeScript has one definition per layer, both tested against the same cases").
--
-- * app.is_stage_key: the Stage key (stage.ts `stageKey`), once in SQL, for app.add_stage;
--   run over stage-key-cases.json with the unit test.
-- * app.module_keys / app.is_module_key: the Modules (module.ts `moduleKeys`), once in
--   SQL, for app.stage_command_refusal and the module_key checks of stage,
--   work_item_type and position_permission (each had its own copy of the list).
-- * app.is_outcome_actions, run over outcome-cases.json with outcome.ts: a
--   `create_items` with no `type` passed (a null comparison counted as true). Fixed.

-- The Stage key and the Modules ----------------------------------------------------------

-- Whether `p_key` is a Stage key: snake_case, at most 63 (stage.ts `stageKey`).
create function app.is_stage_key(p_key text) returns boolean
  language sql immutable
  as $$ select coalesce(p_key ~ '^[a-z][a-z0-9_]{0,62}$', false) $$;
revoke all on function app.is_stage_key(text) from public;

-- The Modules (module.ts `moduleKeys`; seam-2 project-stages.test.ts checks they agree).
create function app.module_keys() returns text[]
  language sql immutable
  as $$ select array['snag_list', 'submittals', 'inspections', 'site_reports', 'drawings'] $$;

-- Whether `p_module_key` is a Module.
create function app.is_module_key(p_module_key text) returns boolean
  language sql immutable
  as $$ select coalesce(p_module_key = any (app.module_keys()), false) $$;
revoke all on function app.module_keys() from public;
revoke all on function app.is_module_key(text) from public;
-- Plain helpers of the table checks below, for whichever role writes the rows (as app.is_bilingual).
grant execute on function app.module_keys(), app.is_module_key(text) to rabaed_app, rabaed_admin;

alter table stage drop constraint stage_module_key_check;
alter table stage add constraint stage_module_key_check check (app.is_module_key(module_key));
alter table work_item_type drop constraint work_item_type_module_key_check;
alter table work_item_type add constraint work_item_type_module_key_check check (app.is_module_key(module_key));
alter table position_permission drop constraint position_permission_module_key_check;
alter table position_permission add constraint position_permission_module_key_check check (app.is_module_key(module_key));

-- As in 20261229000000_project_stages.sql, the Modules from app.is_module_key.
create or replace function app.stage_command_refusal(p_project_id uuid, p_module_key text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.is_module_key(p_module_key)
        or not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id)
      then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('stages:' || p_project_id::text || ':' || p_module_key, 0));
      return null;
    end
  $$;

-- As in 20261229000000_project_stages.sql, the key checked by app.is_stage_key.
create or replace function app.add_stage(p_project_id uuid, p_module_key text, p_key text, p_name jsonb, p_category text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_refusal text := app.stage_command_refusal(p_project_id, p_module_key);
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      if not app.is_stage_key(p_key) or not coalesce(app.is_bilingual(p_name), false)
        or p_category is null or p_category not in ('draft', 'in_progress', 'closed_positive', 'closed_negative', 'cancelled')
      then
        return 'invalid_stage';
      end if;
      if exists (select 1 from stage where project_id = p_project_id and module_key = p_module_key and key = p_key) then
        return 'stage_exists';
      end if;
      p_name := jsonb_build_object('en', trim(p_name ->> 'en'), 'ar', trim(p_name ->> 'ar'));
      insert into stage (owner_kind, project_id, module_key, key, name, category, sort)
      select 'project', p_project_id, p_module_key, p_key, p_name, p_category, coalesce(max(s.sort), 0) + 1
      from stage s where s.project_id = p_project_id and s.module_key = p_module_key;
      perform app.write_project_event(p_project_id, 'stage_added',
        jsonb_build_object('module', p_module_key, 'key', p_key, 'name', p_name, 'category', p_category));
      return 'added';
    end
  $$;

-- Outcome follow-up actions -----------------------------------------------------------------

-- As in 20270102000000_outcome_sets.sql; a `create_items` must name a Type code (a
-- missing `type` compared as null, and passed).
create or replace function app.is_outcome_actions(p_actions jsonb) returns boolean
  language plpgsql immutable
  as $$
    begin
      if p_actions is null or jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) > 3 then
        return false;
      end if;
      if exists (
        select 1 from jsonb_array_elements(p_actions) e
        where jsonb_typeof(e) <> 'object'
          or not coalesce(
            (e ->> 'kind' in ('offer_revision', 'offer_replacement') and e - 'kind' = '{}'::jsonb)
            or (e ->> 'kind' = 'create_items' and jsonb_typeof(e -> 'type') = 'string'
              and e ->> 'type' ~ '^[A-Z]{2,6}$' and e - 'kind' - 'type' = '{}'::jsonb),
            false)
      ) then
        return false;
      end if;
      return (select count(distinct e ->> 'kind') from jsonb_array_elements(p_actions) e) = jsonb_array_length(p_actions);
    end
  $$;
