-- RP-664 (follow-up of RP-652, spec RP-649): the Project setting "Show Inspections in the Submittals
-- tab" is audited in setup_event.
--
-- * A new kind, `project_setting`, for a Project setting a Project Admin changes; its one type so far
--   is `show_inspections_in_submittals_changed`, with the value before and after (`from`, `to`).
-- * app.set_show_inspections_in_submittals writes the row only when the value changes: setting the
--   value it already has stays 'set' and writes nothing, and a refusal writes nothing.
-- * Read by nobody through the app role, like every setup_event (visibility.md RP-450-1).
--
-- Redefined from their newest bodies on main: app.setup_event_kind and the two checks
-- (20270630000000_checklist_templates.sql), app.set_show_inspections_in_submittals
-- (20270602000000_show_inspections_in_submittals.sql). Everything already there is kept.

alter table setup_event drop constraint setup_event_kind_check;
alter table setup_event add constraint setup_event_kind_check
  check (kind in ('workflow', 'form', 'screen', 'stage', 'outcome_set', 'company_default', 'checklist_template', 'project_setting'));
alter table setup_event drop constraint setup_event_type_check;
alter table setup_event add constraint setup_event_type_check check (
  (kind = 'workflow' and type in ('duplicated', 'draft_saved', 'published', 'bound', 'unbound'))
  or (kind = 'screen' and type in ('screen_created', 'screen_draft_saved', 'screen_published'))
  or (kind = 'stage' and type in ('stage_added', 'stage_renamed', 'stages_reordered', 'stage_removed'))
  or (kind = 'outcome_set' and type in ('outcome_added', 'outcome_changed', 'outcomes_reordered'))
  or (kind = 'company_default' and type in ('default_set', 'default_cleared', 'defaults_applied'))
  or (kind = 'checklist_template' and type in ('checklist_template_created', 'checklist_template_edited', 'checklist_template_retired'))
  or (kind = 'project_setting' and type in ('show_inspections_in_submittals_changed'))
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
      when p_type in ('show_inspections_in_submittals_changed') then 'project_setting'
    end
  $$;
revoke all on function app.setup_event_kind(text) from public;

-- A Project Admin turns the setting on or off.
-- Outcome: 'set'; 'not_found' for anyone who is no Project Admin of the Project (whether it exists or not, so it
-- names nothing); 'project_closed'. Setting the value it already has is 'set' and writes no setup_event.
create or replace function app.set_show_inspections_in_submittals(p_project_id uuid, p_show boolean) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_status text;
      v_from boolean;
    begin
      if p_show is null or not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return 'not_found';
      end if;
      select status, show_inspections_in_submittals into v_status, v_from from project where id = p_project_id for update;
      if v_status = 'closed' then
        return 'project_closed';
      end if;
      if v_from is distinct from p_show then
        update project set show_inspections_in_submittals = p_show, updated_at = now() where id = p_project_id;
        perform app.write_setup_event(null, p_project_id, null, 'show_inspections_in_submittals_changed',
          jsonb_build_object('from', v_from, 'to', p_show));
      end if;
      return 'set';
    end
  $$;
revoke all on function app.set_show_inspections_in_submittals(uuid, boolean) from public;
grant execute on function app.set_show_inspections_in_submittals(uuid, boolean) to rabaed_app;
