-- RP-1251 (follow-up to RP-1239): the Project Settings that pick a Trade or Location never take a
-- deactivated one ("Archive" on screen) as a new choice. Scenarios RP-1251-1 to RP-1251-3.
--
-- * app.add_approved_supplier: a supplier on a deactivated Trade is 'trade_not_found', as for a Trade
--   that isn't the Project's. A supplier already on it stays listed.
-- * app.create_checklist_template: the same. app.edit_checklist_template keeps a template's own
--   deactivated Trade (the editor shows it, so saving doesn't drop it), but never moves a template
--   onto another deactivated Trade.
-- * app.set_numbering_counter_start: a deactivated Trade or Location is 'value_not_found'.
--
-- Each function is rebuilt from its newest body; only the Trade or Location check changes. Anyone but
-- the Project Admin still gets 'not_found' first, so nothing new is named to anyone. `create or
-- replace` keeps each function's grants.

-- From 20270402000000_approved_supplier_list.sql.
create or replace function app.add_approved_supplier(p_project_id uuid, p_trade_id uuid, p_scope_id uuid, p_name jsonb, p_now timestamptz)
  returns table (outcome text, supplier_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_supplier_id uuid;
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      -- An active Trade of the Project: a deactivated one is never picked anew (RP-1251).
      if not exists (
        select 1 from dimension_value v join visibility_dimension d on d.id = v.dimension_id
        where v.id = p_trade_id and v.project_id = p_project_id and d.kind = 'trade' and v.status = 'active'
      ) then
        return query select 'trade_not_found'::text, null::uuid;
        return;
      end if;
      if p_scope_id is not null and not exists (
        select 1 from scope s where s.id = p_scope_id and s.trade_value_id = p_trade_id and s.status = 'active'
      ) then
        return query select 'scope_not_found'::text, null::uuid;
        return;
      end if;
      -- The check and the insert below, one Trade at a time.
      perform pg_advisory_xact_lock(hashtextextended('approved_supplier/' || p_trade_id::text, 0));
      if app.approved_supplier_listed(p_trade_id, p_name) then
        return query select 'supplier_exists'::text, null::uuid;
        return;
      end if;

      insert into approved_supplier (project_id, name, trade_value_id, scope_id, source, added_by_member_id, added_at)
      values (
        p_project_id,
        jsonb_build_object('en', btrim(p_name ->> 'en'), 'ar', btrim(p_name ->> 'ar')),
        p_trade_id, p_scope_id, 'preloaded', app.current_member_id(), greatest(p_now, now())
      )
      returning id into v_supplier_id;
      return query select 'added'::text, v_supplier_id;
    end
  $$;

-- From 20270630000000_checklist_templates.sql.
create or replace function app.create_checklist_template(p_project_id uuid, p_name jsonb, p_trade_id uuid, p_items jsonb, p_now timestamptz)
  returns table (outcome text, template_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_template_id uuid;
      v_at timestamptz := greatest(p_now, now());
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      -- The Project row, shared, so it can't close between this check and the write.
      perform 1 from project where id = p_project_id for share;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      -- An active Trade of the Project (RP-1251).
      if not app.is_project_trade(p_project_id, p_trade_id)
        or exists (select 1 from dimension_value where id = p_trade_id and status = 'deactivated') then
        return query select 'trade_not_found'::text, null::uuid;
        return;
      end if;

      insert into checklist_template (project_id, created_by_member_id, created_at)
      values (p_project_id, app.current_member_id(), v_at)
      returning id into v_template_id;
      insert into checklist_template_version (checklist_template_id, project_id, version_no, name, trade_value_id, items, created_by_member_id, created_at)
      values (v_template_id, p_project_id, 1, p_name, p_trade_id, p_items, app.current_member_id(), v_at);
      perform app.write_setup_event(null, p_project_id, null, 'checklist_template_created',
        jsonb_build_object('checklist_template_id', v_template_id, 'version_no', 1, 'name', p_name), v_at);
      return query select 'created'::text, v_template_id;
    end
  $$;

-- From 20270630000000_checklist_templates.sql.
create or replace function app.edit_checklist_template(p_template_id uuid, p_name jsonb, p_trade_id uuid, p_items jsonb, p_now timestamptz)
  returns table (outcome text, version_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_template checklist_template;
      v_version_id uuid;
      v_at timestamptz := greatest(p_now, now());
    begin
      select * into v_template from checklist_template
      where id = p_template_id and project_id in (select app.current_admin_project_ids())
      for update;
      if v_template.id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      perform 1 from project where id = v_template.project_id for share;
      if exists (select 1 from project where id = v_template.project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if v_template.status = 'retired' then
        return query select 'template_retired'::text, null::uuid;
        return;
      end if;
      -- An active Trade of the Project, or the template's own, kept even once deactivated (RP-1251).
      if not app.is_project_trade(v_template.project_id, p_trade_id)
        or (
          exists (select 1 from dimension_value where id = p_trade_id and status = 'deactivated')
          and not exists (
            select 1 from checklist_template_version
            where checklist_template_id = p_template_id and version_no = v_template.version_no and trade_value_id = p_trade_id)
        ) then
        return query select 'trade_not_found'::text, null::uuid;
        return;
      end if;

      insert into checklist_template_version (checklist_template_id, project_id, version_no, name, trade_value_id, items, created_by_member_id, created_at)
      values (p_template_id, v_template.project_id, v_template.version_no + 1, p_name, p_trade_id, p_items, app.current_member_id(), v_at)
      returning id into v_version_id;
      update checklist_template set version_no = v_template.version_no + 1 where id = p_template_id;
      perform app.write_setup_event(null, v_template.project_id, null, 'checklist_template_edited',
        jsonb_build_object('checklist_template_id', p_template_id, 'version_no', v_template.version_no + 1, 'name', p_name), v_at);
      return query select 'edited'::text, v_version_id;
    end
  $$;

-- From 20261104000100_numbering_admin.sql.
create or replace function app.set_numbering_counter_start(
  p_project_id uuid, p_type_code text, p_participant_id uuid, p_trade_id uuid, p_location_id uuid,
  p_starting_value integer, p_now timestamptz
) returns table (outcome text, counter_key text, next_number text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return query select 'not_found'::text, null::text, null::text;
        return;
      end if;
      -- A deactivated Trade or Location of the Project is never picked anew (RP-1251).
      if exists (
        select 1 from dimension_value v
        where v.id in (p_trade_id, p_location_id) and v.project_id = p_project_id and v.status = 'deactivated'
      ) then
        return query select 'value_not_found'::text, null::text, null::text;
        return;
      end if;
      return query select * from app.start_numbering_counter(
        p_project_id, p_type_code, p_participant_id, p_trade_id, p_location_id, p_starting_value, p_now);
    end
  $$;
