-- Company defaults: a Company's default Forms, Workflows and Screens seed the Projects
-- it creates (RP-517, spec RP-511 decision 8; ADR 0019; ADR 0016; GLOSSARY "Company
-- default"; workflow-engine.md §1 "Company defaults"; visibility.md V18, scenario RP-517-1).
--
-- * company_default: per Company, Work Item Type and kind (form, workflow, screen), the
--   one Library item the Company starts a new Project from. Read by the Company's own
--   Members (its Library is private, V18); written only by app.set_company_default and
--   app.clear_company_default, which answer anyone but the Company's Authorized Person
--   `not_found`, like a made-up id, as for every Library command (RP-427, RP-516).
-- * A Form can sit in a Company's Library: form_definition gains owner_kind `company` with
--   company_id, and work_item_type_id (the Type it is made for, as workflow_definition has
--   it). Its read policy is tightened to match: a Library Form is read by its Company only.
--   Nothing yet creates one through the api (the Form builder and Libraries come with
--   RP-442); a default can only name one that exists.
-- * Creating a Project (app.create_project) copies the creating Company's defaults into it,
--   Type by Type, through app.seed_project_from_company_defaults: its default Forms and
--   Screens as the Project's own, then its default Workflows, each copied as the latest
--   published Version, published and bound as the Type's default binding. Screens a copied
--   Workflow names that the Project does not have yet are copied from the Library too, so
--   the Project's Workflow pins what the Library's did. Where a Company has no default for
--   a Type, nothing is copied and app.new_item_workflow_version's chain stays: the raiser's
--   exception, the Project's binding, the Type's Rabaed Default. A Company joining a
--   Project gets nothing copied (ADR 0016): it runs the Project's copies; a raising
--   exception (V15) is only ever set up on purpose.
-- * The audit trail is workflow_event, as the other setup commands write it (RP-450 moves
--   them into one record): `default_set` and `default_cleared` in the Company's name,
--   `defaults_applied` on the Project that was seeded.
--
-- Rebuilt from their latest bodies: app.create_project (20260928210000_projects.sql).

-- A Form in a Company's Library ----------------------------------------------------------

alter table form_definition add column company_id uuid references company (id);
alter table form_definition add column work_item_type_id uuid references work_item_type (id);
alter table form_definition drop constraint form_definition_owner_kind_check;
alter table form_definition drop constraint form_definition_check;
alter table form_definition add constraint form_definition_owner_kind_check
  check (owner_kind in ('rabaed', 'project', 'company'));
alter table form_definition add constraint form_definition_owner_check
  check (
    (owner_kind = 'rabaed' and project_id is null and company_id is null)
    or (owner_kind = 'project' and project_id is not null and company_id is null)
    or (owner_kind = 'company' and company_id is not null and project_id is null)
  );
create index form_definition_company_id on form_definition (company_id) where company_id is not null;

-- Rabaed Defaults for any active Member; a Project's own on that Project; a Library's for
-- its own Company only (V18).
drop policy member_reads_form_definitions on form_definition;
create policy member_reads_form_definitions on form_definition for select to rabaed_app
  using (
    (owner_kind = 'rabaed' and app.current_company_id() is not null)
    or (owner_kind = 'project' and project_id in (select app.current_project_ids()))
    or (owner_kind = 'company' and company_id = app.current_company_id())
  );

-- The defaults ---------------------------------------------------------------------------------

create table company_default (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company (id),
  work_item_type_id uuid not null references work_item_type (id),
  kind text not null check (kind in ('form', 'workflow', 'screen')),
  form_definition_id uuid references form_definition (id),
  workflow_definition_id uuid references workflow_definition (id),
  screen_id uuid references screen (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The item of its kind, and no other.
  check (
    (kind = 'form' and form_definition_id is not null and workflow_definition_id is null and screen_id is null)
    or (kind = 'workflow' and workflow_definition_id is not null and form_definition_id is null and screen_id is null)
    or (kind = 'screen' and screen_id is not null and form_definition_id is null and workflow_definition_id is null)
  ),
  -- One default per Type and kind.
  unique (company_id, work_item_type_id, kind)
);

alter table company_default enable row level security;
revoke insert, update, delete, truncate on company_default from rabaed_app;
create policy member_reads_company_defaults on company_default for select to rabaed_app
  using (company_id = app.current_company_id());

alter table workflow_event drop constraint workflow_event_type_check;
alter table workflow_event add constraint workflow_event_type_check
  check (type in (
    'duplicated', 'draft_saved', 'published', 'bound', 'unbound', 'screen_created', 'screen_draft_saved', 'screen_published',
    'default_set', 'default_cleared', 'defaults_applied'
  ));

-- The commands ---------------------------------------------------------------------------------

-- The Authorized Person marks Library item p_item_id as their Company's default of kind
-- p_kind for Work Item Type p_type_id, replacing the one there was. The item is one of
-- their own Company's Library, with a published Version, and (a Workflow, a Form with a
-- Type of its own) made for that Type. Outcome: 'set'; 'not_found' (not the Authorized
-- Person, an unknown kind, Type or item, another Company's item); 'not_published';
-- 'not_for_type'.
create function app.set_company_default(p_type_id uuid, p_kind text, p_item_id uuid, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_company_id uuid := app.current_authorized_company_id();
      v_form_type uuid;
    begin
      if v_company_id is null or p_kind is null or p_kind not in ('form', 'workflow', 'screen')
        or not exists (select 1 from work_item_type t where t.id = p_type_id and t.owner_kind = 'rabaed')
      then
        return 'not_found';
      end if;
      if p_kind = 'workflow' then
        if not exists (
          select 1 from workflow_definition d where d.id = p_item_id and d.owner_kind = 'company' and d.company_id = v_company_id
        ) then
          return 'not_found';
        end if;
        if not app.workflow_is_published(p_item_id) then
          return 'not_published';
        end if;
        if app.workflow_type(p_item_id) is distinct from p_type_id then
          return 'not_for_type';
        end if;
      elsif p_kind = 'screen' then
        if not exists (select 1 from screen s where s.id = p_item_id and s.owner_kind = 'company' and s.company_id = v_company_id) then
          return 'not_found';
        end if;
        if not app.screen_is_published(p_item_id) then
          return 'not_published';
        end if;
      else
        select f.work_item_type_id into v_form_type
        from form_definition f where f.id = p_item_id and f.owner_kind = 'company' and f.company_id = v_company_id;
        if not found then
          return 'not_found';
        end if;
        if not exists (select 1 from form_version v where v.form_definition_id = p_item_id and v.status = 'published') then
          return 'not_published';
        end if;
        if v_form_type is not null and v_form_type <> p_type_id then
          return 'not_for_type';
        end if;
      end if;

      insert into company_default (
        company_id, work_item_type_id, kind, form_definition_id, workflow_definition_id, screen_id, created_at, updated_at
      ) values (
        v_company_id, p_type_id, p_kind,
        case when p_kind = 'form' then p_item_id end,
        case when p_kind = 'workflow' then p_item_id end,
        case when p_kind = 'screen' then p_item_id end,
        v_at, v_at
      )
      on conflict (company_id, work_item_type_id, kind) do update
      set form_definition_id = excluded.form_definition_id,
          workflow_definition_id = excluded.workflow_definition_id,
          screen_id = excluded.screen_id,
          updated_at = excluded.updated_at;
      perform app.write_workflow_event(null, null, v_company_id, 'default_set',
        jsonb_build_object('work_item_type_id', p_type_id, 'kind', p_kind, 'item_id', p_item_id), v_at);
      return 'set';
    end
  $$;

-- The Authorized Person takes their Company's default of kind p_kind for Type p_type_id
-- away: new Projects start from the Rabaed Default there again. Projects already created
-- keep their copies. Outcome: 'cleared' (also when there was none); 'not_found' (not the
-- Authorized Person, or an unknown kind).
create function app.clear_company_default(p_type_id uuid, p_kind text, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_company_id uuid := app.current_authorized_company_id();
      v_cleared uuid;
    begin
      if v_company_id is null or p_kind is null or p_kind not in ('form', 'workflow', 'screen') then
        return 'not_found';
      end if;
      delete from company_default d
      where d.company_id = v_company_id and d.work_item_type_id = p_type_id and d.kind = p_kind
      returning d.id into v_cleared;
      if v_cleared is not null then
        perform app.write_workflow_event(null, null, v_company_id, 'default_cleared',
          jsonb_build_object('work_item_type_id', p_type_id, 'kind', p_kind), v_at);
      end if;
      return 'cleared';
    end
  $$;

-- Seeding a new Project ------------------------------------------------------------------------

-- Copies Company p_company_id's defaults into the new Project p_project_id, Type by Type
-- (see the top of this file). Checks no caller: only app.create_project calls it, as the
-- Project's creator, in the transaction that creates the Project, so a copy that cannot be
-- made undoes the Project.
create function app.seed_project_from_company_defaults(p_project_id uuid, p_company_id uuid, p_at timestamptz)
  returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_default record;
      v_screen record;
      v_rows record;
      v_form_id uuid;
      v_screen_id uuid;
      v_definition_id uuid;
      v_applied jsonb := '[]';
    begin
      -- Forms: the Library's latest published Version, as the Project's own Version 1.
      for v_default in
        select d.work_item_type_id, d.form_definition_id, t.code
        from company_default d join work_item_type t on t.id = d.work_item_type_id
        where d.company_id = p_company_id and d.kind = 'form'
        order by t.code
      loop
        insert into form_definition (owner_kind, project_id, name, work_item_type_id, created_at, updated_at)
        select 'project', p_project_id, f.name, v_default.work_item_type_id, p_at, p_at
        from form_definition f where f.id = v_default.form_definition_id
        returning id into v_form_id;
        insert into form_version (form_definition_id, version_no, status, schema, published_at, created_at, updated_at)
        select v_form_id, 1, 'published', v.schema, p_at, p_at, p_at
        from form_version v where v.form_definition_id = v_default.form_definition_id and v.status = 'published'
        order by v.version_no desc limit 1;
        v_applied := v_applied || jsonb_build_object('kind', 'form', 'work_item_type', v_default.code);
      end loop;

      -- Screens: the default ones, then the ones a default Workflow names, as the Project's own.
      for v_screen in
        select s.id, s.key, t.code
        from company_default d
        join screen s on s.id = d.screen_id
        join work_item_type t on t.id = d.work_item_type_id
        where d.company_id = p_company_id and d.kind = 'screen'
        order by t.code
      loop
        perform app.copy_screen_into_project(v_screen.id, p_project_id, p_at);
        v_applied := v_applied || jsonb_build_object('kind', 'screen', 'work_item_type', v_screen.code);
      end loop;
      for v_screen in
        select distinct s.id, s.key
        from company_default d
        join workflow_version v on v.workflow_definition_id = d.workflow_definition_id and v.status = 'published'
        join workflow_transition tr on tr.workflow_version_id = v.id and tr.screen_key is not null
        join screen s on s.owner_kind = 'company' and s.company_id = p_company_id and s.key = tr.screen_key
        where d.company_id = p_company_id and d.kind = 'workflow'
        order by s.key
      loop
        perform app.copy_screen_into_project(v_screen.id, p_project_id, p_at);
      end loop;

      -- Workflows: the latest published Version, published as the Project's own and bound as
      -- the Type's default there. Publishing pins the Project's Screens (app.workflow_screens).
      for v_default in
        select d.work_item_type_id, d.workflow_definition_id, t.code, w.name
        from company_default d
        join work_item_type t on t.id = d.work_item_type_id
        join workflow_definition w on w.id = d.workflow_definition_id
        where d.company_id = p_company_id and d.kind = 'workflow'
        order by t.code
      loop
        select r.* into v_rows
        from (
          select v.id from workflow_version v
          where v.workflow_definition_id = v_default.workflow_definition_id and v.status = 'published'
          order by v.version_no desc limit 1
        ) v
        cross join lateral app.workflow_version_rows(v.id) r;
        insert into workflow_definition (owner_kind, project_id, name, work_item_type_id, created_at, updated_at)
        values ('project', p_project_id, v_default.name, v_default.work_item_type_id, p_at, p_at)
        returning id into v_definition_id;
        perform 1 from app.store_workflow_draft(v_definition_id, null, v_rows.layout, v_rows.steps, v_rows.transitions, p_at);
        perform 1 from app.publish_workflow_draft(v_definition_id, p_at);
        insert into workflow_binding (project_id, work_item_type_id, raising_participant_id, workflow_definition_id, created_at, updated_at)
        values (p_project_id, v_default.work_item_type_id, null, v_definition_id, p_at, p_at);
        v_applied := v_applied || jsonb_build_object('kind', 'workflow', 'work_item_type', v_default.code);
      end loop;

      if jsonb_array_length(v_applied) > 0 then
        perform app.write_workflow_event(null, p_project_id, null, 'defaults_applied',
          jsonb_build_object('company_id', p_company_id, 'defaults', v_applied), p_at);
      end if;
    end
  $$;

-- Copies Library Screen p_screen_id into Project p_project_id as the Project's own, its
-- latest published Version as Version 1, unless the Project has a Screen with that key
-- already. Checks no caller: for app.seed_project_from_company_defaults.
create function app.copy_screen_into_project(p_screen_id uuid, p_project_id uuid, p_at timestamptz)
  returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_new_id uuid;
    begin
      if exists (
        select 1 from screen s join screen o on o.id = p_screen_id
        where s.owner_kind = 'project' and s.project_id = p_project_id and s.key = o.key
      ) then
        return;
      end if;
      insert into screen (owner_kind, project_id, key, name, created_at, updated_at)
      select 'project', p_project_id, s.key, s.name, p_at, p_at from screen s where s.id = p_screen_id
      returning id into v_new_id;
      insert into screen_version (screen_id, version_no, status, schema, internal_fields, published_at, created_at, updated_at)
      select v_new_id, 1, 'published', v.schema, v.internal_fields, p_at, p_at, p_at
      from screen_version v where v.screen_id = p_screen_id and v.status = 'published'
      order by v.version_no desc limit 1;
    end
  $$;

-- Creating a Project ---------------------------------------------------------------------------

-- As in the projects migration (20260928210000), and the creating Company's defaults are
-- copied into the Project once its Participant, Member and Project Admin exist.
create or replace function app.create_project(p_name jsonb, p_code text, p_base_role text)
  returns table (project_id uuid, project_number integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_member_id uuid := app.current_member_id();
      v_company_id uuid;
      v_role_id uuid;
      v_number integer;
      v_project_id uuid;
      v_participant_id uuid;
    begin
      select m.company_id into v_company_id
      from member m join company co on co.id = m.company_id
      where m.id = v_member_id and m.status = 'active' and co.status = 'active' and m.can_create_projects;
      if v_company_id is null then
        raise exception 'only a Project Creator can create a Project' using errcode = '42501';
      end if;

      select id into v_role_id from project_role where owner_kind = 'rabaed' and base_role = p_base_role;
      if v_role_id is null then
        raise exception 'unknown base role %', p_base_role using errcode = '22023';
      end if;

      -- The row lock serialises concurrent creations for one Company; a rollback
      -- later in this transaction gives the number back, so there are no gaps.
      insert into company_project_counter as c (company_id, last_project_number)
      values (v_company_id, 1)
      on conflict (company_id) do update set last_project_number = c.last_project_number + 1
      returning c.last_project_number into v_number;

      insert into project (host_company_id, project_number, code, name, creator_member_id)
      values (v_company_id, v_number, p_code, p_name, v_member_id)
      returning id into v_project_id;
      insert into participant (project_id, company_id, project_role_id)
      values (v_project_id, v_company_id, v_role_id)
      returning id into v_participant_id;
      insert into project_member (project_id, participant_id, member_id)
      values (v_project_id, v_participant_id, v_member_id);
      insert into project_admin (project_id, member_id, appointed_by_member_id)
      values (v_project_id, v_member_id, v_member_id);

      perform app.seed_project_from_company_defaults(v_project_id, v_company_id, now());

      return query select v_project_id, v_number;
    end
  $$;

-- Grants ------------------------------------------------------------------------------------------

revoke all on function app.set_company_default(uuid, text, uuid, timestamptz) from public;
grant execute on function app.set_company_default(uuid, text, uuid, timestamptz) to rabaed_app;
revoke all on function app.clear_company_default(uuid, text, timestamptz) from public;
grant execute on function app.clear_company_default(uuid, text, timestamptz) to rabaed_app;
revoke all on function app.seed_project_from_company_defaults(uuid, uuid, timestamptz) from public;
revoke all on function app.copy_screen_into_project(uuid, uuid, timestamptz) from public;
