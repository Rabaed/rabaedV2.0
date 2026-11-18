-- RP-1315: a Checklist Template names an optional Scope or Sub-scope of its Trade (ADR 0031;
-- data-model.md "Checklist Templates", form-engine.md §3.2, scenario file RP-1315).
--
-- * `checklist_template_version.scope_id`: a Scope or Sub-scope of the Version's own Trade, as
--   `approved_supplier.scope_id`; null for the whole Trade. Every existing Version stays a
--   whole-Trade one (no backfill). An edit, the next Version, may move it to another Scope or back.
-- * Create and edit take it as a last, optional argument (so every call made before keeps
--   working) and refuse any Scope that isn't an active Scope or Sub-scope of the template's Trade
--   as 'scope_not_found', as app.add_approved_supplier does. An edit may keep the Scope the
--   template already has, deactivated since, as it may keep its Trade (RP-1251).
-- * app.sync_work_item_checklists: a new copy takes a Scope's template only when the item ticks
--   that Scope or one of its Sub-scopes, and a Sub-scope's only when it ticks that Sub-scope; with
--   no Scope ticked, any of the Trade's (packages/domain checklistTemplateFitsScopes, the same rule).
--   The Version a Revision carries from the item it revises is not checked again.
-- * Visibility: no change. Scopes are not a Visibility Dimension, and every Project Member already
--   reads the Project's Scopes and its templates (V20); the app role now reads `scope_id` too.

alter table checklist_template_version add column scope_id uuid;
-- Of the Version's own Trade, so of its Project (scope.trade_value_id is a value of scope.project_id).
alter table checklist_template_version add constraint checklist_template_version_scope_fk
  foreign key (scope_id, trade_value_id) references scope (id, trade_value_id);
create index checklist_template_version_scope_id_idx on checklist_template_version (scope_id);

grant select (scope_id) on checklist_template_version to rabaed_app;

-- From 20271211000000_settings_refuse_deactivated_values.sql, with p_scope_id.
drop function app.create_checklist_template(uuid, jsonb, uuid, jsonb, timestamptz);
create function app.create_checklist_template(
  p_project_id uuid, p_name jsonb, p_trade_id uuid, p_items jsonb, p_now timestamptz, p_scope_id uuid default null
)
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
      -- A Trade of the Project, and not a deactivated one (RP-1251).
      if not app.is_project_trade(p_project_id, p_trade_id) or app.is_deactivated_value(p_project_id, p_trade_id) then
        return query select 'trade_not_found'::text, null::uuid;
        return;
      end if;
      -- An active Scope or Sub-scope of that Trade (RP-1315), as app.add_approved_supplier.
      if p_scope_id is not null and not exists (
        select 1 from scope s where s.id = p_scope_id and s.trade_value_id = p_trade_id and s.status = 'active'
      ) then
        return query select 'scope_not_found'::text, null::uuid;
        return;
      end if;

      insert into checklist_template (project_id, created_by_member_id, created_at)
      values (p_project_id, app.current_member_id(), v_at)
      returning id into v_template_id;
      insert into checklist_template_version (checklist_template_id, project_id, version_no, name, trade_value_id, scope_id, items, created_by_member_id, created_at)
      values (v_template_id, p_project_id, 1, p_name, p_trade_id, p_scope_id, p_items, app.current_member_id(), v_at);
      perform app.write_setup_event(null, p_project_id, null, 'checklist_template_created',
        jsonb_build_object('checklist_template_id', v_template_id, 'version_no', 1, 'name', p_name), v_at);
      return query select 'created'::text, v_template_id;
    end
  $$;

-- From 20271211000000_settings_refuse_deactivated_values.sql, with p_scope_id.
drop function app.edit_checklist_template(uuid, jsonb, uuid, jsonb, timestamptz);
create function app.edit_checklist_template(
  p_template_id uuid, p_name jsonb, p_trade_id uuid, p_items jsonb, p_now timestamptz, p_scope_id uuid default null
)
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
      -- A Trade of the Project, not a deactivated one unless it is the template's own (RP-1251).
      if not app.is_project_trade(v_template.project_id, p_trade_id)
        or (
          app.is_deactivated_value(v_template.project_id, p_trade_id)
          and not exists (
            select 1 from checklist_template_version
            where checklist_template_id = p_template_id and version_no = v_template.version_no and trade_value_id = p_trade_id)
        ) then
        return query select 'trade_not_found'::text, null::uuid;
        return;
      end if;
      -- A Scope or Sub-scope of that Trade: an active one, or the one the template has now (RP-1315).
      if p_scope_id is not null and not exists (
        select 1 from scope s
        where s.id = p_scope_id and s.trade_value_id = p_trade_id
          and (s.status = 'active' or exists (
            select 1 from checklist_template_version
            where checklist_template_id = p_template_id and version_no = v_template.version_no and scope_id = p_scope_id))
      ) then
        return query select 'scope_not_found'::text, null::uuid;
        return;
      end if;

      insert into checklist_template_version (checklist_template_id, project_id, version_no, name, trade_value_id, scope_id, items, created_by_member_id, created_at)
      values (p_template_id, v_template.project_id, v_template.version_no + 1, p_name, p_trade_id, p_scope_id, p_items, app.current_member_id(), v_at)
      returning id into v_version_id;
      update checklist_template set version_no = v_template.version_no + 1 where id = p_template_id;
      perform app.write_setup_event(null, v_template.project_id, null, 'checklist_template_edited',
        jsonb_build_object('checklist_template_id', p_template_id, 'version_no', v_template.version_no + 1, 'name', p_name), v_at);
      return query select 'edited'::text, v_version_id;
    end
  $$;

-- A dropped function takes its grants with it: as 20270630000000_checklist_templates.sql gave them.
revoke all on function
  app.create_checklist_template(uuid, jsonb, uuid, jsonb, timestamptz, uuid),
  app.edit_checklist_template(uuid, jsonb, uuid, jsonb, timestamptz, uuid)
  from public;
grant execute on function
  app.create_checklist_template(uuid, jsonb, uuid, jsonb, timestamptz, uuid),
  app.edit_checklist_template(uuid, jsonb, uuid, jsonb, timestamptz, uuid)
  to rabaed_app;

-- From 20271102000000_inspections_cleanup.sql, with the Scope rule on a new copy.
create or replace function app.sync_work_item_checklists(p_work_item_id uuid, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item work_item;
      v_trade_id uuid;
      v_key text;
      v_answer text;
      v_held uuid;
      v_version checklist_template_version;
      v_offered boolean;
    begin
      if not app.sees_work_item(p_work_item_id) or not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;
      select * into v_item from work_item where id = p_work_item_id;
      select wdv.dimension_value_id into v_trade_id
      from work_item_dimension_value wdv join visibility_dimension d on d.id = wdv.dimension_id and d.kind = 'trade'
      where wdv.work_item_id = p_work_item_id;
      for v_key in
        select f ->> 'key'
        from form_version fv
        cross join lateral jsonb_array_elements(fv.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where fv.id = v_item.form_version_id and f ->> 'type' = 'checklist_template'
      loop
        v_answer := case when jsonb_typeof(v_item.data -> v_key) = 'string' then v_item.data ->> v_key end;
        v_held := null;
        select checklist_template_version_id into v_held from work_item_checklist where work_item_id = p_work_item_id and field_key = v_key;
        if v_answer is not distinct from v_held::text then
          continue;
        end if;
        -- After the first Submit an existing copy never changes; a missing one is only filled in.
        if v_item.submitted_at is not null and v_held is not null then
          return 'checklist_fixed';
        end if;
        if v_answer is null then
          delete from work_item_checklist where work_item_id = p_work_item_id and field_key = v_key;
          continue;
        end if;
        v_version := null;
        select * into v_version from checklist_template_version
        where id::text = v_answer and project_id = v_item.project_id and trade_value_id = v_trade_id;
        if v_version.id is null then
          return 'template_not_found';
        end if;
        -- The template's row, shared: its edit or retirement waits for this copy, or this sees it.
        select t.status = 'active' and t.version_no = v_version.version_no into v_offered
        from checklist_template t where t.id = v_version.checklist_template_id
        for share;
        -- Offered for the item's ticked Scopes (RP-1315): a whole-Trade one, any with no Scope ticked,
        -- else one on a ticked Scope or Sub-scope or on the Scope of a ticked Sub-scope.
        v_offered := v_offered and (
          v_version.scope_id is null
          or not exists (select 1 from work_item_scope ws where ws.work_item_id = p_work_item_id)
          or exists (
            select 1 from work_item_scope ws join scope s on s.id = ws.scope_id
            where ws.work_item_id = p_work_item_id and (s.id = v_version.scope_id or s.parent_id = v_version.scope_id)
          )
        );
        -- A Revision's carries the Version of the item it revises, as it is.
        if not v_offered and not exists (
          select 1 from work_item_checklist c
          where c.work_item_id = v_item.revision_of_id and c.field_key = v_key and c.checklist_template_version_id = v_version.id
        ) then
          return 'template_not_found';
        end if;
        insert into work_item_checklist (work_item_id, project_id, field_key, checklist_template_version_id, name, items, copied_at)
        values (p_work_item_id, v_item.project_id, v_key, v_version.id, v_version.name, v_version.items, greatest(p_now, now()))
        on conflict (work_item_id, field_key) do update
          set checklist_template_version_id = excluded.checklist_template_version_id, name = excluded.name,
              items = excluded.items, copied_at = excluded.copied_at;
      end loop;
      return 'synced';
    end
  $$;
