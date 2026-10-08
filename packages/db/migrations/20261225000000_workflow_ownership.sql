-- RP-426 (spec RP-423, ADR 0016): who owns a Workflow, which one a Project's
-- items of a Work Item Type run, and who reads them.
--
-- - workflow_definition.owner_kind gains `company`: a Workflow in a Company's
--   Library, with its company_id (named for RLS, as project_id is). A copy keeps
--   no link to the Workflow it was copied from (ADR 0016: copies are independent).
-- - workflow_binding: per Project, (Work Item Type, optional raising Participant)
--   -> Workflow definition. At most one default binding per (Project, Type) and one
--   exception per (Project, Type, raising Participant). It binds one of the
--   Project's own Workflows or a Rabaed Default that has a published Version;
--   never another Project's, nor a Library's (copied into the Project first).
-- - app.create_work_item pins the latest published Version of the Workflow that
--   applies (app.new_item_workflow_version): the raiser's exception, else the
--   Project's binding, else the Type's Rabaed Default (as before). Items already
--   created keep their Version.
-- - Reads (visibility.md V20, V18): every Project Member reads the Project's
--   Workflows whole, every Company's Steps included, and the Rabaed Defaults; a
--   Library only its own Company. Only published Versions are read through the
--   app role (drafts are authoring, WF-4's). A binding is read by every Project
--   Member; an exception only by its raising Participant's Members and the
--   Project Admins, since a Participant never learns of another (V15). The item
--   read takes its Workflow's name and Version from app.work_item_workflow, for
--   whoever sees the item, so it never depends on reading the Workflow's rows.
-- - One definition of a Draft Step: app.create_work_item starts at the Step
--   app.is_draft_step names.
-- Writes only through WF-4's commands: the app role writes none of these.

-- Ownership ---------------------------------------------------------------------------

alter table workflow_definition add column company_id uuid references company (id);
alter table workflow_definition drop constraint workflow_definition_owner_kind_check;
alter table workflow_definition drop constraint workflow_definition_check;
alter table workflow_definition add constraint workflow_definition_owner_kind_check
  check (owner_kind in ('rabaed', 'project', 'company'));
alter table workflow_definition add constraint workflow_definition_owner_check
  check (
    (owner_kind = 'rabaed' and project_id is null and company_id is null)
    or (owner_kind = 'project' and project_id is not null and company_id is null)
    or (owner_kind = 'company' and company_id is not null and project_id is null)
  );
create index workflow_definition_company_id on workflow_definition (company_id) where company_id is not null;
create index workflow_definition_project_id on workflow_definition (project_id) where project_id is not null;

-- The Project binding ----------------------------------------------------------------

create table workflow_binding (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id),
  work_item_type_id uuid not null references work_item_type (id),
  -- Null: the Type's Workflow on the Project; else only for items this Participant raises.
  raising_participant_id uuid references participant (id),
  workflow_definition_id uuid not null references workflow_definition (id),
  created_at timestamptz not null default now(),
  -- As on every table (data-model.md), set by the function that changes the row,
  -- `updated_at = v_at`, as the repo's commands do (no trigger keeps it): WF-4's
  -- rebinding command (RP-427). Nothing changes a binding before it.
  updated_at timestamptz not null default now()
);
create unique index workflow_binding_default_key on workflow_binding (project_id, work_item_type_id)
  where raising_participant_id is null;
create unique index workflow_binding_exception_key on workflow_binding (project_id, work_item_type_id, raising_participant_id)
  where raising_participant_id is not null;

-- What a binding may name: the Project's own Type or a Rabaed one; a Participant of
-- the same Project; the Project's own Workflow or a Rabaed Default, with a
-- published Version. Refused as a check violation, like the table's own checks.
create function app.check_workflow_binding() returns trigger
  language plpgsql
  as $$
    begin
      if not exists (
        select 1 from work_item_type t
        where t.id = new.work_item_type_id and (t.owner_kind = 'rabaed' or t.project_id = new.project_id)
      ) then
        raise exception 'a workflow_binding names a Work Item Type of its Project or a Rabaed one' using errcode = '23514';
      end if;
      if new.raising_participant_id is not null and not exists (
        select 1 from participant p where p.id = new.raising_participant_id and p.project_id = new.project_id
      ) then
        raise exception 'a workflow_binding exception names a Participant of its Project' using errcode = '23514';
      end if;
      if not exists (
        select 1 from workflow_definition d
        where d.id = new.workflow_definition_id
          and (d.owner_kind = 'rabaed' or (d.owner_kind = 'project' and d.project_id = new.project_id))
      ) then
        raise exception 'a workflow_binding names its Project''s own Workflow or a Rabaed Default' using errcode = '23514';
      end if;
      if not exists (
        select 1 from workflow_version v where v.workflow_definition_id = new.workflow_definition_id and v.status = 'published'
      ) then
        raise exception 'a workflow_binding names a Workflow with a published Version' using errcode = '23514';
      end if;
      return new;
    end
  $$;
create trigger workflow_binding_checked before insert or update on workflow_binding
  for each row execute function app.check_workflow_binding();

alter table workflow_binding enable row level security;
revoke insert, update, delete, truncate on workflow_binding from rabaed_app;
create policy member_reads_workflow_bindings on workflow_binding for select to rabaed_app
  using (
    project_id in (select app.current_project_ids())
    and (
      raising_participant_id is null
      or raising_participant_id in (select app.current_participant_ids())
      or project_id in (select app.current_admin_project_ids())
    )
  );

-- Reads ------------------------------------------------------------------------------

-- Rabaed Defaults for any active Member; a Project's on that Project, for its
-- Members (V20); a Library's for its own Company only (V18).
drop policy member_reads_workflow_definitions on workflow_definition;
create policy member_reads_workflow_definitions on workflow_definition for select to rabaed_app
  using (
    (owner_kind = 'rabaed' and app.current_company_id() is not null)
    or (owner_kind = 'project' and project_id in (select app.current_project_ids()))
    or (owner_kind = 'company' and company_id = app.current_company_id())
  );
-- Published Versions only, with their definition (the subquery is itself filtered).
drop policy member_reads_workflow_versions on workflow_version;
create policy member_reads_workflow_versions on workflow_version for select to rabaed_app
  using (status = 'published' and workflow_definition_id in (select id from workflow_definition));

-- Which Version a new item starts on ---------------------------------------------------

-- The latest published Version of the Workflow a new item of Type p_type_id,
-- raised by Participant p_participant_id on Project p_project_id, runs: that
-- Participant's exception, else the Project's binding, else the Type's Rabaed
-- Default. Security invoker: through the app role it reads only the bindings the
-- caller may (their own Participant's exception), as app.create_work_item does
-- for them; the api asks it for the Form a new item is filled in at.
create function app.new_item_workflow_version(p_project_id uuid, p_type_id uuid, p_participant_id uuid) returns uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select v.id
        from workflow_version v
        where v.status = 'published'
          and v.workflow_definition_id = coalesce(
            (select b.workflow_definition_id from workflow_binding b
             where b.project_id = p_project_id and b.work_item_type_id = p_type_id
               and b.raising_participant_id = p_participant_id),
            (select b.workflow_definition_id from workflow_binding b
             where b.project_id = p_project_id and b.work_item_type_id = p_type_id
               and b.raising_participant_id is null),
            (select t.workflow_definition_id from work_item_type t where t.id = p_type_id)
          )
        order by v.version_no desc
        limit 1
      );
    end
  $$;

-- The Workflow an item runs, for its read --------------------------------------------

-- The name of the Workflow item p_work_item_id runs and the number of the Version
-- it is pinned to, for whoever sees the item, whether or not they read that
-- Workflow's rows (an E2 reader won't); nothing for anyone else, as for an item
-- that doesn't exist. The item read joins it, so it never hides the item.
create function app.work_item_workflow(p_work_item_id uuid) returns table (name jsonb, version_no integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        select d.name, v.version_no
        from work_item w
        join workflow_version v on v.id = w.workflow_version_id
        join workflow_definition d on d.id = v.workflow_definition_id
        where w.id = p_work_item_id;
    end
  $$;

-- Whether a Step is a Draft ------------------------------------------------------------

-- As in the plpgsql definer helpers migration (20261108000000), except that a
-- Step's Stage is looked up without the Type whose Rabaed Default its Workflow
-- is: a Project's own Workflow is no Type's default, and a binding may later
-- name another, while the items on it stay. The Rabaed Stage sets are the only
-- ones yet, and a Stage key of category draft is a Draft in each Module that has
-- it; Stages per Project and Module (spec RP-423) revisit this.
create or replace function app.is_draft_step(p_step_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1 from workflow_step s
          join stage st on st.owner_kind = 'rabaed' and st.key = s.stage_key
          where s.id = p_step_id and st.category = 'draft'
        )
      );
    end
  $$;

-- Creating a Draft -------------------------------------------------------------------

-- As in the built-in fields migration (20261012000000), except that the Workflow
-- Version is the one app.new_item_workflow_version resolves for the raiser's
-- Participant, not always the Type's Rabaed Default's, and its Draft Step is the
-- one app.is_draft_step names (before: a Stage of the Type's Module only).
create or replace function app.create_work_item(
  p_project_id uuid, p_type_code text, p_title text, p_form_version_id uuid, p_data jsonb,
  p_trade_id uuid, p_location_id uuid, p_now timestamptz, p_scope_ids uuid[] default '{}'
) returns table (outcome text, work_item_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_project_member_id uuid;
      v_participant_id uuid;
      v_base_role text;
      v_type record;
      v_version_id uuid;
      v_step record;
      v_item_id uuid;
      v_outcome text;
    begin
      select pm.id, pm.participant_id, r.base_role into v_project_member_id, v_participant_id, v_base_role
      from project_member pm
      join participant p on p.id = pm.participant_id
      join project_role r on r.id = p.project_role_id
      where pm.project_id = p_project_id and pm.member_id = app.current_member_id() and pm.status = 'active'
        and p.status = 'active' and p.company_id = app.current_company_id()
        and p_project_id in (select app.current_project_ids());
      if v_project_member_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;

      select t.id, t.module_key, t.workflow_definition_id into v_type
      from work_item_type t where t.owner_kind = 'rabaed' and t.code = p_type_code;
      if v_type.id is null then
        return query select 'type_not_found'::text, null::uuid;
        return;
      end if;
      -- New items use the latest published Form Version, and stay on it.
      if p_form_version_id is distinct from app.latest_form_version(p_type_code) then
        return query select 'form_version_not_latest'::text, null::uuid;
        return;
      end if;
      -- And the latest published Version of the Workflow bound for the raiser (RP-426).
      v_version_id := app.new_item_workflow_version(p_project_id, v_type.id, v_participant_id);
      -- The start: the one Step in a Stage of category draft, as app.is_draft_step
      -- tells it everywhere else (one definition of a Draft Step).
      select s.id, s.stage_key, s.actor_rule into v_step
      from workflow_step s
      where s.workflow_version_id = v_version_id and app.is_draft_step(s.id);
      if v_step.actor_rule ->> 'base_role' is distinct from v_base_role then
        raise exception 'only a % can raise this Work Item Type', initcap(v_step.actor_rule ->> 'base_role')
          using errcode = '42501';
      end if;
      v_outcome := app.check_work_item_built_ins(
        null, p_project_id, v_project_member_id, p_trade_id, p_location_id, p_scope_ids);
      if v_outcome <> 'ok' then
        return query select v_outcome, null::uuid;
        return;
      end if;

      insert into work_item (
        project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data,
        workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at, created_at, updated_at
      ) values (
        p_project_id, v_type.id, v_participant_id, app.current_member_id(), btrim(p_title),
        coalesce(p_data, '{}') - array['trade', 'location', 'scopes'],
        v_version_id, p_form_version_id, v_step.id, v_step.stage_key, v_at, v_at, v_at
      ) returning id into v_item_id;
      perform app.set_work_item_built_ins(v_item_id, p_project_id, p_trade_id, p_location_id, p_scope_ids);

      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (v_item_id, p_project_id, v_participant_id, v_at, 'raised');

      insert into step_assignment (project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at)
      values (p_project_id, v_item_id, v_step.id, v_participant_id, app.current_member_id(), 'claimed', v_at, v_at);

      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        p_project_id, v_item_id, 'created', app.current_member_id(), v_participant_id, v_step.id,
        jsonb_build_object('title', btrim(p_title)), 'internal', v_participant_id, v_at
      );

      return query select 'created'::text, v_item_id;
    end
  $$;

revoke all on function app.check_workflow_binding() from public;
revoke all on function app.new_item_workflow_version(uuid, uuid, uuid) from public;
grant execute on function app.new_item_workflow_version(uuid, uuid, uuid) to rabaed_app;
revoke all on function app.work_item_workflow(uuid) from public;
grant execute on function app.work_item_workflow(uuid) to rabaed_app;
