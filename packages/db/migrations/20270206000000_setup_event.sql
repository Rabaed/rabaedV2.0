-- RP-450 (spec RP-511, decision 12; data-model.md setup_event, workflow-engine.md "Authoring"):
-- one append-only record of setup changes, replacing workflow_event (Workflow, binding,
-- Screen and Company-default changes) and project_event (Stage and Outcome set changes).
--
-- * Each row is one setup change: kind (workflow, form, screen, stage, outcome_set,
--   company_default), type, payload, actor, and the Project or the Company it changed (exactly
--   one of them; a change to a Project's own Workflow names the Project only). Rows are
--   moved over with their ids and times; the two old tables are dropped.
-- * The writers keep their names, so no command is rewritten: app.write_workflow_event and
--   app.write_project_event now insert into setup_event (through app.write_setup_event),
--   and work out the kind from the type. A later command calls app.write_setup_event.
-- * Append-only and unreadable through the app role, as the old tables were. Rabaed Admin's
--   changes keep their admin_action with a reason; they are not written here.
-- * 'form' is a kind with no type yet: Forms are authored through Screens (RP-516).

create table setup_event (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('workflow', 'form', 'screen', 'stage', 'outcome_set', 'company_default')),
  type text not null,
  -- The Workflow it concerns, when one does; null for an unbinding back to the Rabaed Default.
  workflow_definition_id uuid references workflow_definition (id),
  project_id uuid references project (id),
  company_id uuid references company (id),
  actor_member_id uuid not null references member (id),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check ((project_id is null) <> (company_id is null)),
  check (
    (kind = 'workflow' and type in ('duplicated', 'draft_saved', 'published', 'bound', 'unbound'))
    or (kind = 'screen' and type in ('screen_created', 'screen_draft_saved', 'screen_published'))
    or (kind = 'stage' and type in ('stage_added', 'stage_renamed', 'stages_reordered', 'stage_removed'))
    or (kind = 'outcome_set' and type in ('outcome_added', 'outcome_changed', 'outcomes_reordered'))
    or (kind = 'company_default' and type in ('default_set', 'default_cleared', 'defaults_applied'))
  )
);
create index setup_event_definition on setup_event (workflow_definition_id, created_at) where workflow_definition_id is not null;
create index setup_event_project on setup_event (project_id, created_at) where project_id is not null;
create index setup_event_company on setup_event (company_id, created_at) where company_id is not null;
alter table setup_event enable row level security;
revoke all on setup_event from rabaed_app;
revoke update, delete, truncate on setup_event from rabaed_admin;

create function app.refuse_setup_event_change() returns trigger
  language plpgsql
  as $$
    begin
      raise exception 'setup_event is append-only' using errcode = '42501';
    end
  $$;
revoke all on function app.refuse_setup_event_change() from public;
create trigger setup_event_append_only before update or delete on setup_event
  for each row execute function app.refuse_setup_event_change();
create trigger setup_event_no_truncate before truncate on setup_event
  for each statement execute function app.refuse_setup_event_change();

-- The kind of a type, so a writer names only the type.
create function app.setup_event_kind(p_type text) returns text
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select case
      when p_type in ('duplicated', 'draft_saved', 'published', 'bound', 'unbound') then 'workflow'
      when p_type like 'screen\_%' then 'screen'
      when p_type like 'stage%' then 'stage'
      when p_type like 'outcome%' then 'outcome_set'
      when p_type in ('default_set', 'default_cleared', 'defaults_applied') then 'company_default'
    end
  $$;
revoke all on function app.setup_event_kind(text) from public;

-- Move the old rows over, ids and times kept. A change naming both a Project and a Company
-- (a duplicate into a Project) belongs to the Project.
insert into setup_event (id, kind, type, workflow_definition_id, project_id, company_id, actor_member_id, payload, created_at)
select e.id, app.setup_event_kind(e.type), e.type, e.workflow_definition_id, e.project_id,
       case when e.project_id is null then e.company_id end, e.actor_member_id, e.payload, e.created_at
from workflow_event e;
insert into setup_event (id, kind, type, project_id, actor_member_id, payload, created_at)
select e.id, app.setup_event_kind(e.type), e.type, e.project_id, e.actor_member_id, e.payload, e.created_at
from project_event e;

-- The writers.
create function app.write_setup_event(
  p_definition_id uuid, p_project_id uuid, p_company_id uuid, p_type text, p_payload jsonb, p_at timestamptz default now()
) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into setup_event (kind, type, workflow_definition_id, project_id, company_id, actor_member_id, payload, created_at)
      values (app.setup_event_kind(p_type), p_type, p_definition_id, p_project_id,
              case when p_project_id is null then p_company_id end, app.current_member_id(), p_payload, p_at);
    end
  $$;
revoke all on function app.write_setup_event(uuid, uuid, uuid, text, jsonb, timestamptz) from public;

create or replace function app.write_workflow_event(
  p_definition_id uuid, p_project_id uuid, p_company_id uuid, p_type text, p_payload jsonb, p_at timestamptz
) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.write_setup_event(p_definition_id, p_project_id, p_company_id, p_type, p_payload, p_at);
    end
  $$;

create or replace function app.write_project_event(p_project_id uuid, p_type text, p_payload jsonb) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.write_setup_event(null, p_project_id, null, p_type, p_payload);
    end
  $$;

drop table workflow_event;
drop table project_event;
drop function app.refuse_workflow_event_change();
drop function app.refuse_project_event_change();
