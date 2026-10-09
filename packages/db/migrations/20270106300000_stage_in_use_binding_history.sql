-- Review fix of spec RP-423 (RP-428, WF-5; workflow-engine.md "Stages"; data-model.md
-- stage, workflow_binding_history): a Stage stays in use while any Workflow the
-- Project's items can be on uses it, including one whose binding was taken away.
--
-- app.stage_in_use read only the bindings that exist now, so once a Project Admin
-- unbound a Workflow its Stages could be deleted while items raised under the binding
-- still ran it. It stays definition-side, never reading items (so no refusal differs
-- by hidden Drafts): workflow_binding_history keeps every Workflow the Project ever
-- bound a Type to, written by a trigger on workflow_binding (for every writer: the
-- binding commands, Rabaed Admin, a migration) and never removed. Backfilled from
-- the bindings that exist and from workflow_event's 'bound' and 'unbound' records.

create table workflow_binding_history (
  project_id uuid not null references project (id),
  work_item_type_id uuid not null references work_item_type (id),
  workflow_definition_id uuid not null references workflow_definition (id),
  first_bound_at timestamptz not null default now(),
  primary key (project_id, work_item_type_id, workflow_definition_id)
);
-- Read by app.stage_in_use (security definer) only: the app role reads none of it.
alter table workflow_binding_history enable row level security;
revoke all on workflow_binding_history from rabaed_app;

create function app.record_workflow_binding() returns trigger
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into workflow_binding_history (project_id, work_item_type_id, workflow_definition_id, first_bound_at)
      values (new.project_id, new.work_item_type_id, new.workflow_definition_id, new.updated_at)
      on conflict do nothing;
      return null;
    end
  $$;
revoke all on function app.record_workflow_binding() from public;
create trigger workflow_binding_recorded after insert or update of workflow_definition_id, work_item_type_id on workflow_binding
  for each row execute function app.record_workflow_binding();

-- The backfill: today's bindings, and those the binding commands recorded.
insert into workflow_binding_history (project_id, work_item_type_id, workflow_definition_id, first_bound_at)
select b.project_id, b.work_item_type_id, b.workflow_definition_id, b.created_at from workflow_binding b
union all
select e.project_id, (e.payload ->> 'work_item_type_id')::uuid, e.workflow_definition_id, e.created_at
from workflow_event e
where e.type = 'bound' and e.project_id is not null and e.workflow_definition_id is not null
union all
select e.project_id, (e.payload ->> 'work_item_type_id')::uuid, (e.payload ->> 'workflow_definition_id')::uuid, e.created_at
from workflow_event e
where e.type = 'unbound' and e.project_id is not null and e.payload ? 'workflow_definition_id'
on conflict do nothing;

-- As in 20261229000000_project_stages.sql, counting every Workflow the Project ever
-- bound a Type of that Module to (workflow_binding_history), not only today's bindings.
create or replace function app.stage_in_use(p_project_id uuid, p_module_key text, p_key text) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if p_project_id not in (select app.current_project_ids()) then
        return false;
      end if;
      return exists (
        select 1 from workflow_step s
        join workflow_version v on v.id = s.workflow_version_id
        where s.stage_key = p_key
          and (
            v.workflow_definition_id in (select d.id from workflow_definition d where d.project_id = p_project_id)
            or v.workflow_definition_id in (
              select t.workflow_definition_id from work_item_type t
              where t.module_key = p_module_key and (t.project_id is null or t.project_id = p_project_id)
            )
            -- A Workflow the Project binds, or once bound, a Type of that Module to (WF-3,
            -- RP-426), an exception's too: items raised under the binding still run it. It
            -- is the Project's own or a Rabaed Default, which every Member reads (V20), so
            -- the answer names no Participant and reads no item.
            or v.workflow_definition_id in (
              select h.workflow_definition_id from workflow_binding_history h
              join work_item_type t on t.id = h.work_item_type_id
              where h.project_id = p_project_id and t.module_key = p_module_key
            )
          )
      );
    end
  $$;
