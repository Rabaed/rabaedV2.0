-- Screens: reusable, versioned Action Forms per Project, pinned by Workflow Versions;
-- a reply's internal fields stay with the acting Participant (RP-516, spec RP-511
-- decisions 5-6; ADR 0019; workflow-engine.md §5.7; data-model.md screen;
-- visibility.md V5, V20, scenario RP-516-1).
--
-- * screen / screen_version: a named Action Form with a key, owned by Rabaed (a Rabaed
--   Default Screen), a Project or a Company's Library, like workflow_definition (ADR
--   0016). A Version holds an Action Form schema and the keys of its fields internal to
--   the acting Participant (`internal_fields`); every other field is shared. A
--   published Version never changes (as workflow_version, RP-424).
-- * Who reads: a Rabaed Default by every Company; a Project's by its Members (V20); a
--   Library's by its Company (V18); only published Versions, and a Screen with none
--   only by its authors. The app role writes no Screen table: the commands below, each
--   audited in workflow_event (read by nobody through the app role).
-- * Who authors: a Project's Screens, its Project Admins; a Library's, its Company's
--   Authorized Person (app.can_author_screen). The api checks a draft
--   (@rabaed/domain screenProblems) in the transaction that publishes it, on the draft
--   app.screen_draft has locked.
-- * workflow_transition.screen_key names the Screen a Transition shows; publishing a
--   Workflow Version pins it (app.publish_workflow_draft): the latest published Version
--   of the owner's Screen with that key, else the Rabaed Default one
--   (app.workflow_screens), into screen_version_id, with its schema copied into
--   action_form. Everything that reads a Transition's Action Form at run time reads that
--   copy, frozen with the Version (RP-424): a new Screen Version never changes an item
--   running on the old one.
-- * app.take_transition: the answers to the pinned Screen Version's internal fields go
--   in an `internal_answers` event internal to the acting Participant, just before the
--   Transition's (as the Internal Note, V5); the Transition's event keeps the shared ones.
-- * app.work_item_history gives each event's Action Form answers (`answers`): a
--   Transition's or Code's shared ones, an internal_answers event's internal ones,
--   through the same row-level security as every event.
--
-- Rebuilt from their latest bodies: app.take_transition (20270110000000_pick_up_rename.sql),
-- app.publish_workflow_draft (20261226000000_workflow_authoring.sql),
-- app.workflow_version_rows and app.store_workflow_draft (20270114000000_holder_edits_form.sql),
-- app.work_item_history (20270113000000_handover_review.sql).

-- The tables ------------------------------------------------------------------------------

create table screen (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('rabaed', 'project', 'company')),
  project_id uuid references project (id),
  company_id uuid references company (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$' and length(key) <= 64),
  name jsonb not null check (app.is_bilingual(name)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (owner_kind = 'rabaed' and project_id is null and company_id is null)
    or (owner_kind = 'project' and project_id is not null and company_id is null)
    or (owner_kind = 'company' and company_id is not null and project_id is null)
  )
);
create unique index screen_rabaed_key on screen (key) where owner_kind = 'rabaed';
create unique index screen_project_key on screen (project_id, key) where owner_kind = 'project';
create unique index screen_company_key on screen (company_id, key) where owner_kind = 'company';

create table screen_version (
  id uuid primary key default gen_random_uuid(),
  screen_id uuid not null references screen (id),
  version_no integer not null check (version_no > 0),
  status text not null check (status in ('draft', 'published')),
  schema jsonb not null check (jsonb_typeof(schema) = 'object'),
  internal_fields text[] not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (screen_id, version_no),
  check ((status = 'published') = (published_at is not null))
);
-- At most one draft per Screen: the next Version.
create unique index screen_version_one_draft on screen_version (screen_id) where status = 'draft';

alter table workflow_transition
  add column screen_key text check (screen_key ~ '^[a-z][a-z0-9_]*$' and length(screen_key) <= 64),
  add column screen_version_id uuid references screen_version (id);
create index workflow_transition_screen_version on workflow_transition (screen_version_id) where screen_version_id is not null;

-- A published Screen Version never changes or goes away, not even for the tables' owner.
create function app.refuse_published_screen_version_change() returns trigger
  language plpgsql
  as $$
    begin
      if old.status = 'published' then
        raise exception 'screen_version % is published and never changes', old.id using errcode = '42501';
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end
  $$;
create trigger screen_version_published_frozen before update or delete on screen_version
  for each row execute function app.refuse_published_screen_version_change();

-- The audit trail: Screen commands are Workflow setup changes (RP-450 merges them into one record).
alter table workflow_event drop constraint workflow_event_type_check;
alter table workflow_event add constraint workflow_event_type_check
  check (type in ('duplicated', 'draft_saved', 'published', 'bound', 'unbound', 'screen_created', 'screen_draft_saved', 'screen_published'));

-- An Action Form's internal answers, their own event (V5).
alter table work_item_event drop constraint work_item_event_type_check;
alter table work_item_event add constraint work_item_event_type_check check (type in (
  'created', 'transition', 'recommend_code', 'issue_code', 'assigned', 'picked_up', 'returned_to_pool',
  'vacated', 'admin_reassigned', 'admin_reset', 'internal_note', 'cancelled', 'answers_changed',
  'claimed', 'released', 'internal_answers'
));

-- Who authors and reads a Screen ----------------------------------------------------------

-- The acting Member may change Screen p_screen_id: a Project Admin of its Project, or the
-- Authorized Person of the Company whose Library holds it. Nobody changes a Rabaed
-- Default through the app role.
create function app.can_author_screen(p_screen_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return exists (
        select 1 from screen s
        where s.id = p_screen_id
          and (
            (s.owner_kind = 'project' and s.project_id in (select app.current_admin_project_ids()))
            or (s.owner_kind = 'company' and s.company_id = app.current_authorized_company_id())
          )
      );
    end
  $$;

-- Whether Screen p_screen_id has a published Version (for the policy below).
create function app.screen_is_published(p_screen_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return exists (select 1 from screen_version v where v.screen_id = p_screen_id and v.status = 'published');
    end
  $$;

alter table screen enable row level security;
alter table screen_version enable row level security;
revoke insert, update, delete, truncate on screen, screen_version from rabaed_app;
create policy member_reads_screens on screen for select to rabaed_app
  using (
    (
      (owner_kind = 'rabaed' and app.current_company_id() is not null)
      or (owner_kind = 'project' and project_id in (select app.current_project_ids()))
      or (owner_kind = 'company' and company_id = app.current_company_id())
    )
    and (app.screen_is_published(id) or app.can_author_screen(id))
  );
-- Published Versions only, of Screens the caller reads (the subquery is itself filtered).
create policy member_reads_screen_versions on screen_version for select to rabaed_app
  using (status = 'published' and screen_id in (select id from screen));

-- The Screens a Workflow's Transitions may show: by key, the latest published Version
-- of its owner's Screen with that key, else of the Rabaed Default one. The one rule:
-- publishing pins it (app.publish_workflow_draft) and the publish checks read it
-- (readWorkflowCheckContext). Security invoker: through the app role it reads what
-- the caller reads.
create function app.workflow_screens(p_definition_id uuid)
  returns table (key text, screen_version_id uuid, schema jsonb, internal_fields text[])
  language sql stable
  set search_path = pg_catalog, public
as $$
  select distinct on (s.key) s.key, v.id, v.schema, v.internal_fields
  from workflow_definition d
  join screen s on s.owner_kind = 'rabaed'
    or (s.owner_kind = 'project' and d.owner_kind = 'project' and s.project_id = d.project_id)
    or (s.owner_kind = 'company' and d.owner_kind = 'company' and s.company_id = d.company_id)
  join screen_version v on v.screen_id = s.id and v.status = 'published'
  where d.id = p_definition_id
  order by s.key, s.owner_kind = 'rabaed', v.version_no desc
$$;

-- The commands -----------------------------------------------------------------------------

-- 'not_found' unless the acting Member authors Screen p_screen_id; 'project_closed' for a
-- closed Project's; else null.
create function app.screen_command_refusal(p_screen_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.can_author_screen(p_screen_id) then
        return 'not_found';
      end if;
      if exists (select 1 from screen s join project pr on pr.id = s.project_id where s.id = p_screen_id and pr.status = 'closed') then
        return 'project_closed';
      end if;
      return null;
    end
  $$;

-- A Project Admin creates Screen p_key on Project p_project_id, named p_name, with
-- p_schema and p_internal_fields as its draft Version 1 (checked when it is published).
-- Outcome: 'created'; 'not_found' (not its Project Admin); 'project_closed';
-- 'invalid_name'; 'key_taken' (the Project has a Screen with that key).
create function app.create_screen(
  p_project_id uuid, p_key text, p_name jsonb, p_schema jsonb, p_internal_fields text[], p_now timestamptz
) returns table (outcome text, screen_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_id uuid;
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return query select 'not_found'::text, null::uuid, null::integer;
        return;
      end if;
      if exists (select 1 from project pr where pr.id = p_project_id and pr.status = 'closed') then
        return query select 'project_closed'::text, null::uuid, null::integer;
        return;
      end if;
      if not app.is_bilingual(p_name) then
        return query select 'invalid_name'::text, null::uuid, null::integer;
        return;
      end if;
      perform 1 from project pr where pr.id = p_project_id for update;
      if exists (select 1 from screen s where s.owner_kind = 'project' and s.project_id = p_project_id and s.key = p_key) then
        return query select 'key_taken'::text, null::uuid, null::integer;
        return;
      end if;
      insert into screen (owner_kind, project_id, key, name, created_at, updated_at)
      values ('project', p_project_id, p_key, p_name, v_at, v_at)
      returning id into v_id;
      insert into screen_version (screen_id, version_no, status, schema, internal_fields, created_at, updated_at)
      values (v_id, 1, 'draft', p_schema, coalesce(p_internal_fields, '{}'), v_at, v_at);
      perform app.write_workflow_event(null, p_project_id, null, 'screen_created',
        jsonb_build_object('screen_id', v_id, 'key', p_key), v_at);
      return query select 'created'::text, v_id, 1;
    end
  $$;

-- The draft of Screen p_screen_id, for its authors only, locking the Screen so the
-- caller's checks and its publish see the draft no save changes in between. Nothing
-- when it has none, or for anyone else.
create function app.screen_draft(p_screen_id uuid)
  returns table (screen_version_id uuid, version_no integer, schema jsonb, internal_fields text[])
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.can_author_screen(p_screen_id) then
        return;
      end if;
      perform 1 from screen s where s.id = p_screen_id for update;
      return query
        select v.id, v.version_no, v.schema, v.internal_fields from screen_version v
        where v.screen_id = p_screen_id and v.status = 'draft';
    end
  $$;

-- Saves the draft of Screen p_screen_id: its next Version (the draft it has, or a new one
-- after its latest). Outcome: 'saved'; 'not_found'; 'project_closed'.
create function app.save_screen_draft(p_screen_id uuid, p_schema jsonb, p_internal_fields text[], p_now timestamptz)
  returns table (outcome text, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_refusal text := app.screen_command_refusal(p_screen_id);
      v_screen record;
      v_no integer;
    begin
      if v_refusal is not null then
        return query select v_refusal, null::integer;
        return;
      end if;
      select s.id, s.project_id, s.company_id into v_screen from screen s where s.id = p_screen_id for update;
      update screen_version v set schema = p_schema, internal_fields = coalesce(p_internal_fields, '{}'), updated_at = v_at
      where v.screen_id = p_screen_id and v.status = 'draft'
      returning v.version_no into v_no;
      if v_no is null then
        insert into screen_version (screen_id, version_no, status, schema, internal_fields, created_at, updated_at)
        select p_screen_id, coalesce(max(o.version_no), 0) + 1, 'draft', p_schema, coalesce(p_internal_fields, '{}'), v_at, v_at
        from screen_version o where o.screen_id = p_screen_id
        returning screen_version.version_no into v_no;
      end if;
      perform app.write_workflow_event(null, v_screen.project_id, v_screen.company_id, 'screen_draft_saved',
        jsonb_build_object('screen_id', p_screen_id, 'version_no', v_no), v_at);
      return query select 'saved'::text, v_no;
    end
  $$;

-- Publishes the draft of Screen p_screen_id, after the api has checked it on
-- app.screen_draft's rows in this transaction: it becomes its newest published Version,
-- which never changes again. Workflow Versions published before keep the Version they
-- pinned. Outcome: 'published'; 'not_found'; 'project_closed'; 'no_draft'.
create function app.publish_screen(p_screen_id uuid, p_now timestamptz)
  returns table (outcome text, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_refusal text := app.screen_command_refusal(p_screen_id);
      v_screen record;
      v_no integer;
    begin
      if v_refusal is not null then
        return query select v_refusal, null::integer;
        return;
      end if;
      select s.id, s.project_id, s.company_id into v_screen from screen s where s.id = p_screen_id for update;
      update screen_version v set status = 'published', published_at = v_at, updated_at = v_at
      where v.screen_id = p_screen_id and v.status = 'draft'
      returning v.version_no into v_no;
      if v_no is null then
        return query select 'no_draft'::text, null::integer;
        return;
      end if;
      perform app.write_workflow_event(null, v_screen.project_id, v_screen.company_id, 'screen_published',
        jsonb_build_object('screen_id', p_screen_id, 'version_no', v_no), v_at);
      return query select 'published'::text, v_no;
    end
  $$;

-- A Version's rows, with the Screen a Transition shows ------------------------------------

-- As in the holder_edits_form migration, with a Transition's screen_key when it has one;
-- its action_form then reads null (on a published Version it is the pinned copy), so a
-- copy of the Version pins again when it is published.
create or replace function app.workflow_version_rows(p_version_id uuid)
  returns table (layout jsonb, steps jsonb, transitions jsonb)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select v.layout,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'key', s.key, 'name', s.name, 'stage_key', s.stage_key, 'actor_rule', s.actor_rule,
              'is_signing', s.is_signing, 'outcome_mode', s.outcome_mode)
              || case when s.edits_form is null then '{}'::jsonb else jsonb_build_object('edits_form', s.edits_form) end
              || case when s.drafts_visible_to is null then '{}'::jsonb
                else jsonb_build_object('drafts_visible_to', s.drafts_visible_to) end
              order by s.created_at, s.key)
            from workflow_step s where s.workflow_version_id = v.id), '[]'::jsonb),
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'key', t.key, 'from_step_key', f.key, 'to_step_key', s.key, 'label', t.label, 'kind', t.kind,
              'outcome', t.outcome, 'permission', t.permission, 'sort', t.sort,
              'action_form', case when t.screen_key is null then t.action_form end)
              -- Each only when the Transition has it, as @rabaed/domain's rows have them.
              || case when t.screen_key is null then '{}'::jsonb else jsonb_build_object('screen_key', t.screen_key) end
              || case when t.rules is null then '{}'::jsonb else jsonb_build_object('rules', t.rules) end
              || case when t.actions is null then '{}'::jsonb else jsonb_build_object('actions', t.actions) end
              || case when t.notifications is null then '{}'::jsonb else jsonb_build_object('notifications', t.notifications) end
              order by t.sort, t.key)
            from workflow_transition t
            join workflow_step f on f.id = t.from_step_id
            join workflow_step s on s.id = t.to_step_id
            where t.workflow_version_id = v.id), '[]'::jsonb)
        from workflow_version v
        where v.id = p_version_id;
    end
  $$;

-- As in the holder_edits_form migration, storing a Transition's screen_key (null when its
-- row leaves it out); a Transition naming a Screen stores no Action Form of its own.
create or replace function app.store_workflow_draft(
  p_definition_id uuid, p_name jsonb, p_layout jsonb, p_steps jsonb, p_transitions jsonb, p_at timestamptz
) returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_version record;
      v_version_id uuid;
      v_count integer;
    begin
      perform 1 from workflow_definition d where d.id = p_definition_id for update;
      if not found then
        return query select 'not_found'::text, null::uuid, null::integer;
        return;
      end if;
      if p_name is not null and not app.is_bilingual(p_name) then
        return query select 'invalid_name'::text, null::uuid, null::integer;
        return;
      end if;
      if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_typeof(p_transitions) is distinct from 'array'
        or jsonb_typeof(coalesce(p_layout, '{}')) <> 'object'
        or (select count(distinct s ->> 'key') from jsonb_array_elements(p_steps) s) <> jsonb_array_length(p_steps)
        or (select count(distinct t ->> 'key') from jsonb_array_elements(p_transitions) t) <> jsonb_array_length(p_transitions)
        or exists (
          select 1 from jsonb_array_elements(p_transitions) t
          where not exists (select 1 from jsonb_array_elements(p_steps) s where s ->> 'key' = t ->> 'from_step_key')
             or not exists (select 1 from jsonb_array_elements(p_steps) s where s ->> 'key' = t ->> 'to_step_key'))
        or exists (
          select 1 from jsonb_array_elements(p_steps) s
          where jsonb_typeof(s -> 'edits_form') not in ('boolean', 'null')
             or coalesce(s ->> 'drafts_visible_to', 'company') not in ('company', 'author'))
        or exists (
          select 1 from jsonb_array_elements(p_transitions) t
          where jsonb_typeof(t -> 'screen_key') not in ('string', 'null')
             or (t ->> 'screen_key' is not null and (t ->> 'screen_key' !~ '^[a-z][a-z0-9_]*$' or length(t ->> 'screen_key') > 64))
             or (t ->> 'screen_key' is not null and jsonb_typeof(t -> 'action_form') not in ('null')))
      then
        return query select 'invalid_definition'::text, null::uuid, null::integer;
        return;
      end if;

      select v.id, v.version_no, v.status into v_version
      from workflow_version v where v.workflow_definition_id = p_definition_id
      order by v.version_no desc limit 1;
      if v_version.id is not null and v_version.status = 'draft' then
        v_version_id := v_version.id;
        delete from workflow_transition t where t.workflow_version_id = v_version_id;
        delete from workflow_step s where s.workflow_version_id = v_version_id;
        update workflow_version v
        set layout = coalesce(p_layout, '{}'), draft_name = coalesce(p_name, v.draft_name), updated_at = p_at
        where v.id = v_version_id;
      else
        insert into workflow_version (workflow_definition_id, version_no, status, layout, draft_name, created_at, updated_at)
        values (p_definition_id, coalesce(v_version.version_no, 0) + 1, 'draft', coalesce(p_layout, '{}'), p_name, p_at, p_at)
        returning id into v_version_id;
      end if;

      insert into workflow_step (
        workflow_version_id, key, name, stage_key, actor_rule, is_signing, outcome_mode, edits_form, drafts_visible_to, created_at
      )
      select v_version_id, e.s ->> 'key', e.s -> 'name', e.s ->> 'stage_key', coalesce(e.s -> 'actor_rule', '{}'), false,
        e.s ->> 'outcome_mode', (e.s ->> 'edits_form')::boolean, e.s ->> 'drafts_visible_to',
        -- In the order given, which the draft's read keeps.
        p_at + make_interval(secs => e.ord / 1000000.0)
      from jsonb_array_elements(p_steps) with ordinality as e (s, ord);
      insert into workflow_transition (
        workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form,
        screen_key, rules, actions, notifications, created_at
      )
      select v_version_id, e.t ->> 'key', f.id, s.id, e.t -> 'label', e.t ->> 'kind', e.t ->> 'outcome', e.t ->> 'permission',
        coalesce((e.t ->> 'sort')::integer, e.ord::integer), nullif(e.t -> 'action_form', 'null'::jsonb),
        e.t ->> 'screen_key',
        nullif(e.t -> 'rules', 'null'::jsonb), nullif(e.t -> 'actions', 'null'::jsonb), nullif(e.t -> 'notifications', 'null'::jsonb),
        p_at
      from jsonb_array_elements(p_transitions) with ordinality as e (t, ord)
      join workflow_step f on f.workflow_version_id = v_version_id and f.key = e.t ->> 'from_step_key'
      join workflow_step s on s.workflow_version_id = v_version_id and s.key = e.t ->> 'to_step_key';
      get diagnostics v_count = row_count;
      if v_count <> jsonb_array_length(p_transitions) then
        raise exception 'store_workflow_draft: a Transition lost its Steps';
      end if;
      return query select 'saved'::text, v_version_id, (select v.version_no from workflow_version v where v.id = v_version_id);
    end
  $$;

-- Publishing pins the Screens ---------------------------------------------------------------

-- As in the workflow_authoring migration, and every Transition naming a Screen pins its
-- Version (app.workflow_screens) before the Version is published: screen_version_id,
-- and its schema as the Transition's action_form, frozen with it (RP-424). The caller's
-- publish checks refused a Screen with no published Version (screen_not_found); one
-- missing here raises.
create or replace function app.publish_workflow_draft(p_definition_id uuid, p_at timestamptz)
  returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_version record;
      v_unpinned text;
    begin
      perform 1 from workflow_definition d where d.id = p_definition_id for update;
      if not found then
        return query select 'not_found'::text, null::uuid, null::integer;
        return;
      end if;
      select v.id, v.version_no, v.status, v.draft_name into v_version
      from workflow_version v where v.workflow_definition_id = p_definition_id
      order by v.version_no desc limit 1;
      if v_version.id is null or v_version.status <> 'draft' then
        return query select 'no_draft'::text, null::uuid, null::integer;
        return;
      end if;
      update workflow_transition t set screen_version_id = p.screen_version_id, action_form = p.schema
      from app.workflow_screens(p_definition_id) p
      where t.workflow_version_id = v_version.id and t.screen_key = p.key;
      select t.screen_key into v_unpinned from workflow_transition t
      where t.workflow_version_id = v_version.id and t.screen_key is not null and t.screen_version_id is null
      limit 1;
      if v_unpinned is not null then
        raise exception 'publish_workflow_draft: Screen % has no published Version this Workflow can use', v_unpinned;
      end if;
      update workflow_version v set status = 'published', published_at = p_at, draft_name = null, updated_at = p_at
      where v.id = v_version.id;
      if v_version.draft_name is not null then
        update workflow_definition d set name = v_version.draft_name, updated_at = p_at where d.id = p_definition_id;
      end if;
      return query select 'published'::text, v_version.id, v_version.version_no;
    end
  $$;

-- Taking a Transition: a reply's internal answers -------------------------------------------

-- The keys of Transition p_transition_id's Action Form fields internal to the acting
-- Participant: its pinned Screen Version's; none for an Action Form of its own.
create function app.transition_internal_fields(p_transition_id uuid) returns text[]
  language sql stable
  set search_path = pg_catalog, public
as $$
  select coalesce((
    select v.internal_fields from workflow_transition t
    join screen_version v on v.id = t.screen_version_id
    where t.id = p_transition_id), '{}')
$$;

-- As in the pick_up_rename migration, and the answers to the Action Form's internal
-- fields go in an `internal_answers` event internal to the acting Participant, before
-- the Transition's own events; the Transition's event records the shared ones. Its
-- follow-up items read all of them (they are the acting Participant's own).
create or replace function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_answers jsonb, p_internal_note text, p_checked_data_sha256 bytea,
  p_idempotency_key uuid, p_now timestamptz, p_assign_to uuid default null, p_recommended_code text default null
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_me record;
      v_used record;
      v_assignment record;
      v_transition record;
      v_rules record;
      v_actions record;
      v_next record;
      v_internal text[];
      v_internal_answers jsonb;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      select w.*, t.module_key, pr.status as project_status
      into v_item
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;

      select work_item_id, command into v_used from command_idempotency
      where member_id = v_member_id and key = p_idempotency_key;
      if v_used.work_item_id is not null then
        return case when v_used.work_item_id = p_work_item_id and v_used.command = 'transition:' || p_transition_key
          then 'applied' else 'idempotency_key_reused' end;
      end if;

      if v_item.closed_at is not null then
        return 'item_closed';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      select * into v_assignment from step_assignment
      where work_item_id = p_work_item_id and status in ('pooled', 'picked_up', 'vacant');
      if v_assignment.status is distinct from 'picked_up' or v_assignment.assignee_member_id <> v_member_id
        or v_assignment.participant_id <> v_me.participant_id
      then
        return 'not_holder';
      end if;

      select tr.* into v_transition
      from workflow_transition tr
      where tr.workflow_version_id = v_item.workflow_version_id and tr.from_step_id = v_item.current_step_id
        and tr.key = p_transition_key;
      -- A Cancel after the first Submit, or of a Revision, isn't there either (RP-433).
      if v_transition.id is null or not app.cancel_allowed(v_transition.kind, v_item.submitted_at, v_item.revision_no) then
        return 'transition_not_available';
      end if;
      -- Its rules (WF-7): the route among Transitions sharing its label, Restrict, Validate.
      select * into v_rules from app.transition_rules(p_work_item_id, v_transition.id, p_answers);
      if v_rules.refusal is not null then
        return v_rules.refusal;
      end if;
      if v_rules.transition_id <> v_transition.id then
        select tr.* into v_transition from workflow_transition tr where tr.id = v_rules.transition_id;
      end if;
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, v_transition.permission) then
        return 'forbidden';
      end if;
      -- The Action Form answers, which the API checked against the Transition's
      -- schema: here only that each is one of its fields and each field it always
      -- requires is answered, so the app role can't write others (a Return without its reason).
      if not app.action_form_fits(v_transition.action_form, p_answers) then
        return 'invalid_action_form';
      end if;
      -- Moving on by a Member who may save the answers now (the raiser while they
      -- are open, Draft and its internal Steps, so a Submit too; or the Participant
      -- holding a Step a Form Section names): only with the answers the API found
      -- complete (the row is locked). A cancel, a Return or a Send Back needs no complete Form.
      -- (app.answers_sha256_of without checking again: where it may save, app.answers_open
      -- is app.is_draft_step of the Step its Participant entered at.)
      if v_transition.kind not in ('cancel', 'return', 'send_back') and app.can_save_answers(p_work_item_id)
        and p_checked_data_sha256 is distinct from app.answers_sha256_of(
          p_work_item_id, app.is_draft_step(v_item.participant_entered_step_id))
      then
        return 'form_not_checked';
      end if;
      -- The next holder (§3), with the "Assign to" pick (WF-8).
      select * into v_next from app.transition_next_holder(p_work_item_id, v_transition.id, v_me.participant_id, p_assign_to);
      if v_next.outcome not in ('ok', 'terminal') then
        return v_next.outcome;
      end if;
      -- The Recommended Code (RP-433, §5.3): only one the Transition offers, so only
      -- from a Step that Recommends a Code, to the next reviewer of the same
      -- Participant, and a closing outcome of the Type's set; refused alike otherwise,
      -- before the actions step writes anything.
      if p_recommended_code is not null and not exists (
        select 1 from app.recommendable_outcomes(p_work_item_id, v_transition.id, v_me.participant_id) o
        where o.code = p_recommended_code)
      then
        return 'recommended_code_not_offered';
      end if;
      -- Its actions (WF-8): set and copy, into what the acting Participant fills at
      -- this Step only; refused as a whole, or written (and recorded) before any effect.
      select * into v_actions from app.transition_actions(p_work_item_id, v_transition.id, p_answers, v_at);
      if v_actions.refusal is not null then
        return v_actions.refusal;
      end if;

      -- The reply's internal answers (its Screen's internal fields, RP-516) stay inside
      -- the acting Participant (V5): their own event, carrying the Transition's id.
      v_internal := app.transition_internal_fields(v_transition.id);
      v_internal_answers := coalesce((
        select jsonb_object_agg(a.key, a.value) from jsonb_each(coalesce(v_actions.answers, '{}')) a
        where a.key = any(v_internal)), '{}');
      if v_internal_answers <> '{}' then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'internal_answers', v_member_id, v_me.participant_id, v_transition.id,
          v_item.current_step_id, jsonb_build_object('answers', v_internal_answers), 'internal', v_me.participant_id, v_at
        );
      end if;

      perform app.transition_effects(
        p_work_item_id, v_transition.id, v_me.participant_id, v_assignment.id,
        v_next.outcome, v_next.participant_id, v_next.holder_member_id,
        coalesce(v_actions.answers, '{}') - v_internal, nullif(btrim(p_internal_note), ''), p_recommended_code, v_at);
      -- Its outcome's follow-up items (WF-11: Code B's Comments), once it is closed.
      if v_next.outcome = 'terminal' then
        perform app.transition_follow_up_items(p_work_item_id, v_transition.id, v_me.participant_id, v_actions.answers, v_at);
      end if;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;

-- The history: each event's Action Form answers --------------------------------------------

-- As in the handover_review migration, with `answers`: a Transition's or Code's Action
-- Form answers (its payload less what the engine writes), an internal_answers event's
-- own. Through the same row-level security as the rest (V5).
drop function app.work_item_history(uuid);
create function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text,
    outcome text, internal_note text, changes jsonb, remarks text, recommended_code text, handover jsonb, answers jsonb
  )
  language sql stable
  set search_path = pg_catalog, public
as $$
  select (row_number() over (order by e.seq))::integer, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
    tr.label, fs.name, ts.name,
    -- A pool of one's `assigned` event stores why ("only_member"): its label says so.
    case when e.type <> 'assigned' then e.payload ->> 'reason' end,
    e.payload ->> 'document_number', e.payload ->> 'outcome',
    e.payload ->> 'internal_note', e.payload -> 'changes', e.payload ->> 'remarks', e.payload ->> 'recommended_code',
    -- A Handover is internal to the holding Participant (V5), so both are its own Members.
    case when e.payload ? 'handover' then jsonb_build_object(
      'from', hf.full_name, 'to', ht.full_name, 'because', e.payload -> 'handover' ->> 'because') end,
    case
      when e.type in ('transition', 'issue_code') then nullif(e.payload - 'document_number' - 'outcome', '{}'::jsonb)
      when e.type = 'internal_answers' then e.payload -> 'answers'
    end
  from work_item_event e
  join work_item w on w.id = e.work_item_id
  left join app.work_item_companies(p_work_item_id) actor on actor.participant_id = e.actor_participant_id
  left join member m on m.id = e.actor_member_id
  left join workflow_transition tr on tr.id = e.transition_id
  left join workflow_step fs on fs.id = e.from_step_id
  left join workflow_step ts on ts.id = e.to_step_id
  left join member hf on hf.id = (e.payload -> 'handover' ->> 'from_member_id')::uuid
  left join member ht on ht.id = (e.payload -> 'handover' ->> 'to_member_id')::uuid
  where e.work_item_id = p_work_item_id
  order by e.seq
$$;

-- Grants ------------------------------------------------------------------------------------

revoke all on function app.refuse_published_screen_version_change() from public;
revoke all on function app.can_author_screen(uuid) from public;
grant execute on function app.can_author_screen(uuid) to rabaed_app;
revoke all on function app.screen_is_published(uuid) from public;
grant execute on function app.screen_is_published(uuid) to rabaed_app;
revoke all on function app.workflow_screens(uuid) from public;
grant execute on function app.workflow_screens(uuid) to rabaed_app, rabaed_admin;
revoke all on function app.screen_command_refusal(uuid) from public;
revoke all on function app.create_screen(uuid, text, jsonb, jsonb, text[], timestamptz) from public;
grant execute on function app.create_screen(uuid, text, jsonb, jsonb, text[], timestamptz) to rabaed_app;
revoke all on function app.screen_draft(uuid) from public;
grant execute on function app.screen_draft(uuid) to rabaed_app;
revoke all on function app.save_screen_draft(uuid, jsonb, text[], timestamptz) from public;
grant execute on function app.save_screen_draft(uuid, jsonb, text[], timestamptz) to rabaed_app;
revoke all on function app.publish_screen(uuid, timestamptz) from public;
grant execute on function app.publish_screen(uuid, timestamptz) to rabaed_app;
revoke all on function app.transition_internal_fields(uuid) from public;
revoke all on function app.work_item_history(uuid) from public;
grant execute on function app.work_item_history(uuid) to rabaed_app;
