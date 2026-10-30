-- RP-1108 (decision RP-1004): who may raise a Question. `app.may_raise_type`, rebuilt from
-- RP-1089's 20271113000000_may_raise_type.sql (its newest body): a Draft held by the raiser reads
-- the per-Type `create` too (`app.project_member_may_create`, 20271114000000_questions_any_role.sql),
-- and no Question asks the raiser's own role (`app.asks_own_role`). "New" (`app.raisable_type_ids`),
-- `app.create_work_item`, the Register Import and Revisions all read it, so each answers the same.

-- Who may raise a Type -------------------------------------------------------------------

create or replace function app.may_raise_type(p_project_member_id uuid, p_type_id uuid, p_workflow_version_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return coalesce((
        select case
          when s.actor_rule ? 'raiser' then app.project_member_may_create(pm.id, t.id, s.actor_rule ->> 'permission')
          else s.actor_rule ->> 'base_role' = r.base_role
        end
          -- A Question never asks the raiser's own role (RP-1108).
          and not app.asks_own_role(t.id, r.base_role)
        from project_member pm
        join participant p on p.id = pm.participant_id
        join project_role r on r.id = p.project_role_id
        join work_item_type t on t.id = p_type_id
        join workflow_step s on s.workflow_version_id = p_workflow_version_id and app.is_draft_step(s.id)
        where pm.id = p_project_member_id
      ), false);
    end
  $$;
