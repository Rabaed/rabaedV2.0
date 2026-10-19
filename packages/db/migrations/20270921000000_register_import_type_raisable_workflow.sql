-- RP-960 (the gap the whole-branch review RP-657 found): app.register_import_type_raisable is
-- security definer, so the Workflow app.new_item_workflow_version answers inside it is read past
-- row-level security. Its fallback is the Type's own Workflow; a Rabaed Type whose own Workflow is
-- another Project's (only a migrator can make one) counted as raisable on every Project: offered
-- by the import's Map fields and accepted in a row, while "+ New" (getRaisableTypes, through
-- row-level security) never offers it. Now the Workflow counts only when it is a Rabaed Default
-- or the Project's own: workflow_definition's policy, said for the Project imported into. A
-- binding names nothing else (app.check_workflow_binding), so only that fallback changes.
-- Redefined from 20270628000000_register_import.sql, its only body; the import's own function.

create or replace function app.register_import_type_raisable(
  p_project_id uuid, p_type_id uuid, p_type_code text, p_participant_id uuid, p_project_member_id uuid, p_base_role text
) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.new_item_form_version(p_project_id, p_type_code) is not null
        and exists (
          select 1 from workflow_step s
          join work_item_type t on t.id = p_type_id
          join workflow_version v on v.id = s.workflow_version_id
          join workflow_definition d on d.id = v.workflow_definition_id
          where s.workflow_version_id = app.new_item_workflow_version(p_project_id, p_type_id, p_participant_id)
            and (d.owner_kind = 'rabaed' or (d.owner_kind = 'project' and d.project_id = p_project_id))
            and app.is_draft_step(s.id)
            and case
              when s.actor_rule ? 'raiser' then app.project_member_has_permission(p_project_member_id, t.module_key, s.actor_rule ->> 'permission')
              else s.actor_rule ->> 'base_role' = p_base_role
            end
        );
    end
  $$;
