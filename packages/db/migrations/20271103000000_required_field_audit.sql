-- RP-664 follow-up (RP-1082 item 5, from the epic review RP-676 of spec RP-649): the Project setting
-- that makes a link question required (RP-82, project_required_field) is audited in setup_event,
-- like "Show Inspections in Submittals" (20271025000000_show_inspections_setting_audit.sql).
--
-- * A new type of the kind `project_setting`: `required_field_changed`, naming the Type
--   (`work_item_type_id`), the field (`field_key`) and the value before and after (`from`, `to`).
-- * app.set_project_required_field writes the row only when its insert or delete changes a row:
--   setting the value it already has stays 'set' and writes nothing, and so does a refusal. Two
--   Project Admins setting the same value at once write one row: the second insert finds the first's
--   row (on conflict do nothing), the second delete finds it gone.
-- * A null p_required is 'not_found', as a null is for "Show Inspections in Submittals" (it used to
--   delete the row like false; the API sends a boolean only).
-- * Read by nobody through the app role, like every setup_event (visibility.md RP-450-1).
--
-- Redefined from their newest bodies on main: app.setup_event_kind and setup_event_type_check
-- (20271025000000_show_inspections_setting_audit.sql; setup_event_kind_check already lists
-- project_setting and is left as it is), app.set_project_required_field
-- (20270601000000_project_required_field.sql). Everything already there is kept.

alter table setup_event drop constraint setup_event_type_check;
alter table setup_event add constraint setup_event_type_check check (
  (kind = 'workflow' and type in ('duplicated', 'draft_saved', 'published', 'bound', 'unbound'))
  or (kind = 'screen' and type in ('screen_created', 'screen_draft_saved', 'screen_published'))
  or (kind = 'stage' and type in ('stage_added', 'stage_renamed', 'stages_reordered', 'stage_removed'))
  or (kind = 'outcome_set' and type in ('outcome_added', 'outcome_changed', 'outcomes_reordered'))
  or (kind = 'company_default' and type in ('default_set', 'default_cleared', 'defaults_applied'))
  or (kind = 'checklist_template' and type in ('checklist_template_created', 'checklist_template_edited', 'checklist_template_retired'))
  or (kind = 'project_setting' and type in ('show_inspections_in_submittals_changed', 'required_field_changed'))
);

create or replace function app.setup_event_kind(p_type text) returns text
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select case
      when p_type in ('duplicated', 'draft_saved', 'published', 'bound', 'unbound') then 'workflow'
      when p_type like 'screen\_%' then 'screen'
      when p_type like 'stage%' then 'stage'
      when p_type like 'outcome%' then 'outcome_set'
      when p_type in ('default_set', 'default_cleared', 'defaults_applied') then 'company_default'
      when p_type like 'checklist\_template\_%' then 'checklist_template'
      when p_type in ('show_inspections_in_submittals_changed', 'required_field_changed') then 'project_setting'
    end
  $$;
revoke all on function app.setup_event_kind(text) from public;

-- A Project Admin makes the field p_field_key of the Type p_type_code required on their
-- Project (p_required) or not. The Type is the Project's own of that code, else the Rabaed
-- Default. Outcome: 'set' (also when it already was so), 'not_found' (not a Project the acting
-- Member is a Project Admin of, whether or not it exists, or a null p_required, which used to
-- count as off), 'project_closed' or 'type_not_found'. Only a change writes a setup_event.
create or replace function app.set_project_required_field(p_project_id uuid, p_type_code text, p_field_key text, p_required boolean, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_type_id uuid;
      v_changed integer;
    begin
      if p_required is null or not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return 'not_found';
      end if;
      -- The Project row, shared, so it can't close between this check and the write.
      perform 1 from project where id = p_project_id for share;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      v_type_id := app.project_type_id(p_project_id, p_type_code);
      if v_type_id is null then
        return 'type_not_found';
      end if;
      if p_required then
        insert into project_required_field (project_id, work_item_type_id, field_key, set_by_member_id, set_at)
        values (p_project_id, v_type_id, p_field_key, app.current_member_id(), greatest(p_now, now()))
        on conflict do nothing;
      else
        delete from project_required_field
        where project_id = p_project_id and work_item_type_id = v_type_id and field_key = p_field_key;
      end if;
      get diagnostics v_changed = row_count;
      if v_changed > 0 then
        perform app.write_setup_event(null, p_project_id, null, 'required_field_changed',
          jsonb_build_object('work_item_type_id', v_type_id, 'field_key', p_field_key, 'from', not p_required, 'to', p_required),
          greatest(p_now, now()));
      end if;
      return 'set';
    end
  $$;
revoke all on function app.set_project_required_field(uuid, text, text, boolean, timestamptz) from public;
grant execute on function app.set_project_required_field(uuid, text, text, boolean, timestamptz) to rabaed_app;
