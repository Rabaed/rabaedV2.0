-- RP-652 (INSP-7, spec RP-649): the Project setting "Show Inspections in the Submittals tab".
--
-- Off by default. On: the Project's Module tabs leave out Inspections, and the Submittals tab's List and
-- Kanban also list the Inspections Module's Work Items (the work item query's tab scope, apps/api
-- src/work-items/query.ts). Inspections stays its own Module either way: Document Numbers, Function
-- Permissions, Workflows, Stages and item URLs do not change, and no row becomes visible to anyone who
-- could not already read it (the merged read goes through the same RLS and app.step_as_seen).
--
-- No existing app.* function is redefined: only this setting's own command is new. The change is not
-- written to setup_event yet: a new kind would redefine app.setup_event_kind and its check, which the
-- other Inspections tickets (Checklist Templates) would meet too.

alter table project add column show_inspections_in_submittals boolean not null default false;

-- A Project Admin turns the setting on or off.
-- Outcome: 'set'; 'not_found' for anyone who is no Project Admin of the Project (whether it exists or not, so it
-- names nothing); 'project_closed'. Setting the value it already has is 'set'.
create function app.set_show_inspections_in_submittals(p_project_id uuid, p_show boolean) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_status text;
    begin
      if p_show is null or not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return 'not_found';
      end if;
      select status into v_status from project where id = p_project_id for update;
      if v_status = 'closed' then
        return 'project_closed';
      end if;
      update project set show_inspections_in_submittals = p_show, updated_at = now()
      where id = p_project_id and show_inspections_in_submittals is distinct from p_show;
      return 'set';
    end
  $$;
revoke all on function app.set_show_inspections_in_submittals(uuid, boolean) from public;
grant execute on function app.set_show_inspections_in_submittals(uuid, boolean) to rabaed_app;
