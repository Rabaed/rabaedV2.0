-- RP-427 (WF-4, spec RP-423, ADR 0016): the Workflow authoring commands. Duplicate a
-- Workflow into a Project or a Company's Library, save its draft, publish it, bind a
-- Project's Work Item Type to it (by default, or for one raising Participant) and
-- unbind it. workflow-engine.md §1 "Authoring" has the rules; visibility.md V18, V20.
--
-- - The app role still writes no definition table: every write is one of the
--   security definer commands below, each one transaction, each audited. A
--   Member's command writes a workflow_event (who, when, what); a Rabaed
--   Engineer's goes through Rabaed Admin's admin_action, with a reason (V9).
-- - Who may: a Project's Workflows and bindings, its Project Admins; a Library's,
--   its Company's Authorized Person (there is no Position permission for it yet);
--   a Rabaed Default, Rabaed Admin and the `workflow:publish` CLI, through
--   app.write_workflow_draft and app.mark_workflow_published, granted to rabaed_admin
--   alone and refusing any Workflow but a Rabaed Default. Anyone else is answered
--   `not_found`, as for a made-up id.
-- - The publish checks (workflowPublishProblems, @rabaed/domain) run in the api
--   or Rabaed Admin, in the transaction that publishes: app.workflow_draft_rows
--   locks the definition, so no save can come between the check and the publish.
-- - A Workflow is made for one Work Item Type (its outcome set, its Module's
--   Stages, its Form): workflow_definition.work_item_type_id, copied with it, and
--   a binding names a Workflow of the bound Type.
-- - An exception binding's Workflow is read Project-wide (V20), so its name never
--   names a Participant: bind and publish refuse a name holding a Participant's
--   Company name or Participant Code (app.names_participant).
-- - A Revision starts on the latest published Version of the Workflow the item it
--   revises runs (app.revision_draft_step), no longer always the Type's Rabaed
--   Default: once bindings change, the chain stays on its own Workflow (ADR 0016).
-- - Drafts stay unread through the app role's row-level security; their authors
--   read them through app.workflow_draft. A draft's new name waits with the draft
--   (workflow_version.draft_name) and becomes the Workflow's at publish; a Workflow
--   with no published Version is read by its authors only (V20).
-- - app.latest_draft_step (a Revision's start by the Type's Rabaed Default) is dropped:
--   nothing calls it once app.revision_draft_step replaces it.

-- The Type a Workflow is for ------------------------------------------------------------

alter table workflow_definition add column work_item_type_id uuid references work_item_type (id);
-- As the definitions were made: the Type whose Rabaed Default it is, else the first a
-- Project binds it to.
update workflow_definition d set work_item_type_id = coalesce(
  (select t.id from work_item_type t where t.workflow_definition_id = d.id order by t.created_at, t.id limit 1),
  (select b.work_item_type_id from workflow_binding b where b.workflow_definition_id = d.id order by b.created_at, b.id limit 1)
);
create index workflow_definition_work_item_type_id on workflow_definition (work_item_type_id) where work_item_type_id is not null;

-- The Type Workflow p_definition_id is for: its own, else (a definition made before it
-- had one) the Type whose Rabaed Default it is, else the first a binding names. The one
-- rule: the commands below and the publish checks' context (readWorkflowCheckContext)
-- use it. Security invoker: through the app role it reads only what the caller reads.
create function app.workflow_type(p_definition_id uuid) returns uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return coalesce(
        (select d.work_item_type_id from workflow_definition d where d.id = p_definition_id),
        (select t.id from work_item_type t where t.workflow_definition_id = p_definition_id order by t.created_at, t.id limit 1),
        (select b.work_item_type_id from workflow_binding b where b.workflow_definition_id = p_definition_id
         order by b.created_at, b.id limit 1)
      );
    end
  $$;

-- The audit trail of Members' Workflow changes ----------------------------------------------

-- Append-only, like work_item_event. Read by nobody through the app role yet: who reads
-- a Project's settings history is settled with project_event's audience rules.
create table workflow_event (
  id uuid primary key default gen_random_uuid(),
  -- Null for an unbinding back to the Rabaed Default (the payload names what it unbound).
  workflow_definition_id uuid references workflow_definition (id),
  project_id uuid references project (id),
  company_id uuid references company (id),
  actor_member_id uuid not null references member (id),
  type text not null check (type in ('duplicated', 'draft_saved', 'published', 'bound', 'unbound')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (project_id is not null or company_id is not null)
);
create index workflow_event_definition on workflow_event (workflow_definition_id, created_at);
create index workflow_event_project on workflow_event (project_id, created_at) where project_id is not null;
alter table workflow_event enable row level security;
revoke all on workflow_event from rabaed_app;
revoke update, delete, truncate on workflow_event from rabaed_admin;

create function app.refuse_workflow_event_change() returns trigger
  language plpgsql
  as $$
    begin
      raise exception 'workflow_event is append-only' using errcode = '42501';
    end
  $$;
create trigger workflow_event_append_only before update or delete on workflow_event
  for each row execute function app.refuse_workflow_event_change();
create trigger workflow_event_no_truncate before truncate on workflow_event
  for each statement execute function app.refuse_workflow_event_change();

create function app.write_workflow_event(
  p_definition_id uuid, p_project_id uuid, p_company_id uuid, p_type text, p_payload jsonb, p_at timestamptz
) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into workflow_event (workflow_definition_id, project_id, company_id, actor_member_id, type, payload, created_at)
      values (p_definition_id, p_project_id, p_company_id, app.current_member_id(), p_type, p_payload, p_at);
    end
  $$;

-- Rabaed Admin's actions ------------------------------------------------------------------

alter table admin_action drop constraint admin_action_action_check;
alter table admin_action add constraint admin_action_action_check
  check (action in (
    'onboard_company', 'read_onboarding_leads', 'invite_authorized_person', 'close_onboarding_lead',
    'create_option_list', 'add_option', 'rename_option', 'retire_option', 'restore_option',
    'read_numbering', 'set_numbering_pattern', 'set_participant_code', 'set_numbering_counter_start',
    'save_workflow_draft', 'publish_workflow'
  ));

-- Who may author a Workflow ------------------------------------------------------------------

-- The acting Member may change Workflow p_definition_id: a Project Admin of its Project,
-- or the Authorized Person of the Company whose Library holds it. Nobody may change a
-- Rabaed Default through the app role.
create function app.can_author_workflow(p_definition_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return exists (
        select 1 from workflow_definition d
        where d.id = p_definition_id
          and (
            (d.owner_kind = 'project' and d.project_id in (select app.current_admin_project_ids()))
            or (d.owner_kind = 'company' and d.company_id = app.current_authorized_company_id())
          )
      );
    end
  $$;

-- Whether p_name (a Workflow's English and Arabic name) names a Participant of Project
-- p_project_id: holds its Company's legal name (English or Arabic, in either language,
-- ignoring case) or its Participant Code as a whole word. An exception binding's Workflow
-- is read by every Member of the Project, so its name must not say whom it is for (V20).
create function app.names_participant(p_project_id uuid, p_name jsonb) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_text text := lower(coalesce(p_name ->> 'en', '') || ' ' || coalesce(p_name ->> 'ar', ''));
    begin
      return exists (
        select 1
        from participant p
        join company c on c.id = p.company_id
        where p.project_id = p_project_id
          and (
            (length(btrim(c.legal_name ->> 'en')) > 1 and position(lower(btrim(c.legal_name ->> 'en')) in v_text) > 0)
            or (length(btrim(c.legal_name ->> 'ar')) > 1 and position(lower(btrim(c.legal_name ->> 'ar')) in v_text) > 0)
            or (p.code is not null and v_text ~ ('(^|[^a-z0-9])' || lower(p.code) || '([^a-z0-9]|$)'))
          )
      );
    end
  $$;

-- Whether Workflow p_definition_id is bound as an exception on its Project.
create function app.is_exception_workflow(p_definition_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return exists (
        select 1 from workflow_binding b
        where b.workflow_definition_id = p_definition_id and b.raising_participant_id is not null
      );
    end
  $$;

-- Who reads a Workflow ------------------------------------------------------------------------

-- Whether Workflow p_definition_id has a published Version. Security definer, for the
-- policy below (workflow_version's own policy reads workflow_definition).
create function app.workflow_is_published(p_definition_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return exists (
        select 1 from workflow_version v where v.workflow_definition_id = p_definition_id and v.status = 'published');
    end
  $$;

-- As in the workflow ownership migration (20261225000000), except that a Workflow with
-- no published Version yet (a copy being drafted) is read by its authors only: its
-- name is the draft's (V20).
drop policy member_reads_workflow_definitions on workflow_definition;
create policy member_reads_workflow_definitions on workflow_definition for select to rabaed_app
  using (
    (
      (owner_kind = 'rabaed' and app.current_company_id() is not null)
      or (owner_kind = 'project' and project_id in (select app.current_project_ids()))
      or (owner_kind = 'company' and company_id = app.current_company_id())
    )
    and (app.workflow_is_published(id) or app.can_author_workflow(id))
  );

-- The core: a draft, read and written; publishing it ---------------------------------------------

-- A draft's rename waits with the draft: the Workflow's name changes when it is
-- published (app.publish_workflow_draft). Until then Members, and the items running
-- the Workflow (app.work_item_workflow), read the name published last (V20).
alter table workflow_version add column draft_name jsonb;

-- Version p_version_id as rows: its layout, its Steps and its Transitions with their
-- Steps by key, in the shape of @rabaed/domain's WorkflowVersionRows; what
-- app.store_workflow_draft takes. The one shaping of a Version's rows: the draft read,
-- the copy and the api's read of a published Version use it. Security invoker:
-- through the app role it reads only the Versions the caller reads (published ones).
create function app.workflow_version_rows(p_version_id uuid)
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
              'is_signing', s.is_signing, 'outcome_mode', s.outcome_mode) order by s.created_at, s.key)
            from workflow_step s where s.workflow_version_id = v.id), '[]'::jsonb),
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'key', t.key, 'from_step_key', f.key, 'to_step_key', s.key, 'label', t.label, 'kind', t.kind,
              'outcome', t.outcome, 'permission', t.permission, 'sort', t.sort, 'action_form', t.action_form)
              order by t.sort, t.key)
            from workflow_transition t
            join workflow_step f on f.id = t.from_step_id
            join workflow_step s on s.id = t.to_step_id
            where t.workflow_version_id = v.id), '[]'::jsonb)
        from workflow_version v
        where v.id = p_version_id;
    end
  $$;

-- The draft of Workflow p_definition_id (its newest Version, while unpublished) as rows
-- (app.workflow_version_rows), with the name the Workflow takes when it is published.
-- Locks the definition, so the caller's checks and its publish see the draft no save
-- changes in between. Nothing when it has no draft. Checks no caller: app.workflow_draft
-- does, for a Member.
create function app.workflow_draft_rows(p_definition_id uuid)
  returns table (workflow_version_id uuid, version_no integer, name jsonb, layout jsonb, steps jsonb, transitions jsonb)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      perform 1 from workflow_definition d where d.id = p_definition_id for update;
      return query
        select v.id, v.version_no, coalesce(v.draft_name, d.name), r.layout, r.steps, r.transitions
        from workflow_version v
        join workflow_definition d on d.id = v.workflow_definition_id
        cross join lateral app.workflow_version_rows(v.id) r
        where v.workflow_definition_id = p_definition_id and v.status = 'draft'
          and v.version_no = (select max(o.version_no) from workflow_version o where o.workflow_definition_id = p_definition_id);
    end
  $$;

-- Saves the draft of Workflow p_definition_id: its rows become p_layout, p_steps and
-- p_transitions (as @rabaed/domain's definitionToRows writes them), in its draft
-- Version, or in a new one after its latest when it has none. p_name, when given, is
-- the name the Workflow takes when this draft is published (null keeps the draft's).
-- Outcome: 'saved'; 'not_found' (no such Workflow); 'invalid_name';
-- 'invalid_definition' (a Transition names a Step it doesn't have, or two Steps or
-- Transitions share a key). Checks no caller: for the commands below.
create function app.store_workflow_draft(
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

      insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, is_signing, outcome_mode, created_at)
      select v_version_id, e.s ->> 'key', e.s -> 'name', e.s ->> 'stage_key', coalesce(e.s -> 'actor_rule', '{}'), false,
        e.s ->> 'outcome_mode',
        -- In the order given, which the draft's read keeps.
        p_at + make_interval(secs => e.ord / 1000000.0)
      from jsonb_array_elements(p_steps) with ordinality as e (s, ord);
      insert into workflow_transition (
        workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form, created_at
      )
      select v_version_id, e.t ->> 'key', f.id, s.id, e.t -> 'label', e.t ->> 'kind', e.t ->> 'outcome', e.t ->> 'permission',
        coalesce((e.t ->> 'sort')::integer, e.ord::integer), nullif(e.t -> 'action_form', 'null'::jsonb), p_at
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

-- Publishes the draft of Workflow p_definition_id: it becomes its newest published
-- Version, which never changes again (RP-424), and new items start on it; the
-- Workflow takes the draft's name, when it has one. The caller has run every publish
-- check on app.workflow_draft_rows' rows in this transaction. Outcome: 'published';
-- 'not_found'; 'no_draft'. Checks no caller: for the commands below.
create function app.publish_workflow_draft(p_definition_id uuid, p_at timestamptz)
  returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_version record;
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
      update workflow_version v set status = 'published', published_at = p_at, draft_name = null, updated_at = p_at
      where v.id = v_version.id;
      if v_version.draft_name is not null then
        update workflow_definition d set name = v_version.draft_name, updated_at = p_at where d.id = p_definition_id;
      end if;
      return query select 'published'::text, v_version.id, v_version.version_no;
    end
  $$;

-- Rabaed Admin's and the `workflow:publish` CLI's: a Rabaed Default's draft saved
-- (app.store_workflow_draft, keeping its name) and published (app.publish_workflow_draft).
-- Granted to rabaed_admin, so they refuse any other Workflow, a Project's or a
-- Library's, as 'not_found' (V9: an Engineer changes no Company's data here).
create function app.write_workflow_draft(
  p_definition_id uuid, p_layout jsonb, p_steps jsonb, p_transitions jsonb, p_at timestamptz
) returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not exists (select 1 from workflow_definition d where d.id = p_definition_id and d.owner_kind = 'rabaed') then
        return query select 'not_found'::text, null::uuid, null::integer;
        return;
      end if;
      return query select * from app.store_workflow_draft(p_definition_id, null, p_layout, p_steps, p_transitions, p_at);
    end
  $$;

create function app.mark_workflow_published(p_definition_id uuid, p_at timestamptz)
  returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not exists (select 1 from workflow_definition d where d.id = p_definition_id and d.owner_kind = 'rabaed') then
        return query select 'not_found'::text, null::uuid, null::integer;
        return;
      end if;
      return query select * from app.publish_workflow_draft(p_definition_id, p_at);
    end
  $$;

-- A Member's commands ------------------------------------------------------------------------

-- The refusal common to a Member's change of Workflow p_definition_id, or null when
-- they may: 'not_found' unless they author it; 'project_closed' for a closed Project's.
create function app.workflow_command_refusal(p_definition_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.can_author_workflow(p_definition_id) then
        return 'not_found';
      end if;
      if exists (
        select 1 from workflow_definition d join project pr on pr.id = d.project_id
        where d.id = p_definition_id and pr.status = 'closed'
      ) then
        return 'project_closed';
      end if;
      return null;
    end
  $$;

-- Copies the latest published Version of Workflow p_source_id, as the draft Version 1
-- of a new Workflow named p_name: Project p_project_id's own (its Project Admin), or,
-- when p_project_id is null, in the acting Member's Company Library (its Authorized
-- Person). The source is one the Member reads (V18, V20): a Rabaed Default, a Workflow
-- of a Project they are a Member of, or one of their Company's Library. The copy is
-- independent: nothing records where it came from (ADR 0016). Outcome: 'duplicated';
-- 'not_found' (a source they don't read or with nothing published, a target they may
-- not change); 'project_closed'; 'invalid_name'.
create function app.duplicate_workflow(p_source_id uuid, p_project_id uuid, p_name jsonb, p_now timestamptz)
  returns table (outcome text, workflow_definition_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_company_id uuid;
      v_source record;
      v_type_id uuid;
      v_rows record;
      v_id uuid;
    begin
      if p_project_id is not null then
        if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
          return query select 'not_found'::text, null::uuid;
          return;
        end if;
      else
        v_company_id := app.current_authorized_company_id();
        if v_company_id is null then
          return query select 'not_found'::text, null::uuid;
          return;
        end if;
      end if;

      select d.id, d.owner_kind into v_source
      from workflow_definition d
      where d.id = p_source_id
        and (
          (d.owner_kind = 'rabaed' and app.current_company_id() is not null)
          or (d.owner_kind = 'project' and d.project_id in (select app.current_project_ids()))
          or (d.owner_kind = 'company' and d.company_id = app.current_company_id())
        );
      v_type_id := app.workflow_type(v_source.id);
      select r.* into v_rows
      from (
        select v.id from workflow_version v
        where v.workflow_definition_id = v_source.id and v.status = 'published'
        order by v.version_no desc limit 1
      ) v
      cross join lateral app.workflow_version_rows(v.id) r;
      if v_source.id is null or v_rows.layout is null or v_type_id is null
        -- A Project's own Type is used on that Project only.
        or (p_project_id is not null and not exists (
          select 1 from work_item_type t where t.id = v_type_id and (t.project_id is null or t.project_id = p_project_id)))
        or (p_project_id is null and exists (select 1 from work_item_type t where t.id = v_type_id and t.project_id is not null))
      then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if exists (select 1 from project pr where pr.id = p_project_id and pr.status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if not coalesce(app.is_bilingual(p_name), false) then
        return query select 'invalid_name'::text, null::uuid;
        return;
      end if;

      insert into workflow_definition (owner_kind, project_id, company_id, name, work_item_type_id, created_at, updated_at)
      values (case when p_project_id is null then 'company' else 'project' end, p_project_id, v_company_id, p_name, v_type_id, v_at, v_at)
      returning id into v_id;
      perform 1 from app.store_workflow_draft(v_id, null, v_rows.layout, v_rows.steps, v_rows.transitions, v_at);
      perform app.write_workflow_event(v_id, p_project_id, v_company_id, 'duplicated',
        jsonb_build_object('from', v_source.owner_kind, 'name', p_name), v_at);
      return query select 'duplicated'::text, v_id;
    end
  $$;

-- The draft of Workflow p_definition_id, for those who author it (app.workflow_draft_rows);
-- nothing for anyone else, or when it has no draft. Locks the definition, so a publish
-- in the same transaction publishes exactly the draft read.
create function app.workflow_draft(p_definition_id uuid)
  returns table (workflow_version_id uuid, version_no integer, name jsonb, layout jsonb, steps jsonb, transitions jsonb)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.can_author_workflow(p_definition_id) then
        return;
      end if;
      return query select * from app.workflow_draft_rows(p_definition_id);
    end
  $$;

-- A Project Admin or Authorized Person saves the draft of a Workflow they author (as
-- app.store_workflow_draft: a new name waits with the draft until it is published).
-- Outcome: 'saved'; 'not_found'; 'project_closed'; 'invalid_name';
-- 'invalid_definition'; 'workflow_name_names_participant' (a new name naming a
-- Participant, for a Workflow an exception binds).
create function app.save_workflow_draft(
  p_definition_id uuid, p_name jsonb, p_layout jsonb, p_steps jsonb, p_transitions jsonb, p_now timestamptz
) returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_refusal text := app.workflow_command_refusal(p_definition_id);
      v_definition record;
      v_saved record;
    begin
      if v_refusal is not null then
        return query select v_refusal, null::uuid, null::integer;
        return;
      end if;
      select d.project_id, d.company_id into v_definition from workflow_definition d where d.id = p_definition_id;
      if p_name is not null and app.is_bilingual(p_name) and app.is_exception_workflow(p_definition_id)
        and app.names_participant(v_definition.project_id, p_name)
      then
        return query select 'workflow_name_names_participant'::text, null::uuid, null::integer;
        return;
      end if;
      select * into v_saved from app.store_workflow_draft(p_definition_id, p_name, p_layout, p_steps, p_transitions, v_at);
      if v_saved.outcome = 'saved' then
        perform app.write_workflow_event(p_definition_id, v_definition.project_id, v_definition.company_id, 'draft_saved',
          jsonb_build_object('version_no', v_saved.version_no) || case when p_name is null then '{}' else jsonb_build_object('name', p_name) end,
          v_at);
      end if;
      return query select v_saved.outcome, v_saved.workflow_version_id, v_saved.version_no;
    end
  $$;

-- A Project Admin or Authorized Person publishes the draft of a Workflow they author,
-- after the api has run every publish check on app.workflow_draft's rows in this
-- transaction (as app.publish_workflow_draft). Outcome: 'published'; 'not_found';
-- 'project_closed'; 'no_draft'; 'workflow_name_names_participant' (an exception
-- binds it, and the name it takes, its draft's or its own, names a Participant).
create function app.publish_workflow(p_definition_id uuid, p_now timestamptz)
  returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_refusal text := app.workflow_command_refusal(p_definition_id);
      v_definition record;
      v_published record;
    begin
      if v_refusal is not null then
        return query select v_refusal, null::uuid, null::integer;
        return;
      end if;
      select d.project_id, d.company_id,
        coalesce((select v.draft_name from workflow_version v where v.workflow_definition_id = d.id and v.status = 'draft'), d.name) as name
      into v_definition from workflow_definition d where d.id = p_definition_id;
      if app.is_exception_workflow(p_definition_id) and app.names_participant(v_definition.project_id, v_definition.name) then
        return query select 'workflow_name_names_participant'::text, null::uuid, null::integer;
        return;
      end if;
      select * into v_published from app.publish_workflow_draft(p_definition_id, v_at);
      if v_published.outcome = 'published' then
        perform app.write_workflow_event(p_definition_id, v_definition.project_id, v_definition.company_id, 'published',
          jsonb_build_object('version_no', v_published.version_no), v_at);
      end if;
      return query select v_published.outcome, v_published.workflow_version_id, v_published.version_no;
    end
  $$;

-- The refusal common to binding and unbinding on Project p_project_id, or null: 'not_found'
-- unless the acting Member is its Project Admin, the Type is one it uses (a Rabaed one or
-- its own) and the raising Participant, when named, is one of its; 'project_closed'.
create function app.binding_command_refusal(p_project_id uuid, p_type_id uuid, p_participant_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id)
        or not exists (
          select 1 from work_item_type t where t.id = p_type_id and (t.project_id is null or t.project_id = p_project_id))
        or (p_participant_id is not null and not exists (
          select 1 from participant p where p.id = p_participant_id and p.project_id = p_project_id))
      then
        return 'not_found';
      end if;
      if exists (select 1 from project pr where pr.id = p_project_id and pr.status = 'closed') then
        return 'project_closed';
      end if;
      return null;
    end
  $$;

-- A Project Admin binds Work Item Type p_type_id on Project p_project_id to Workflow
-- p_definition_id: for every raiser, or, with p_participant_id, as the exception for
-- items that Participant raises. It replaces the binding there was; items already
-- created keep their Version. Outcome: 'bound'; 'not_found' (also a Workflow of another
-- Project or of a Library, which is copied into the Project first); 'project_closed';
-- 'workflow_not_published' (none of its Versions is published yet);
-- 'workflow_not_for_type' (made for another Work Item Type);
-- 'workflow_name_names_participant' (an exception's Workflow whose name names a
-- Participant, V20).
create function app.bind_workflow(
  p_project_id uuid, p_type_id uuid, p_participant_id uuid, p_definition_id uuid, p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_refusal text := app.binding_command_refusal(p_project_id, p_type_id, p_participant_id);
      v_definition record;
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      select d.id, d.name into v_definition from workflow_definition d
      where d.id = p_definition_id
        and (d.owner_kind = 'rabaed' or (d.owner_kind = 'project' and d.project_id = p_project_id))
      for update;
      if v_definition.id is null then
        return 'not_found';
      end if;
      if not exists (select 1 from workflow_version v where v.workflow_definition_id = p_definition_id and v.status = 'published') then
        return 'workflow_not_published';
      end if;
      if app.workflow_type(p_definition_id) is distinct from p_type_id then
        return 'workflow_not_for_type';
      end if;
      if p_participant_id is not null and app.names_participant(p_project_id, v_definition.name) then
        return 'workflow_name_names_participant';
      end if;

      if p_participant_id is null then
        insert into workflow_binding (project_id, work_item_type_id, raising_participant_id, workflow_definition_id, created_at, updated_at)
        values (p_project_id, p_type_id, null, p_definition_id, v_at, v_at)
        on conflict (project_id, work_item_type_id) where raising_participant_id is null
        do update set workflow_definition_id = excluded.workflow_definition_id, updated_at = excluded.updated_at;
      else
        insert into workflow_binding (project_id, work_item_type_id, raising_participant_id, workflow_definition_id, created_at, updated_at)
        values (p_project_id, p_type_id, p_participant_id, p_definition_id, v_at, v_at)
        on conflict (project_id, work_item_type_id, raising_participant_id) where raising_participant_id is not null
        do update set workflow_definition_id = excluded.workflow_definition_id, updated_at = excluded.updated_at;
      end if;
      perform app.write_workflow_event(p_definition_id, p_project_id, null, 'bound',
        jsonb_build_object('work_item_type_id', p_type_id, 'raising_participant_id', p_participant_id), v_at);
      return 'bound';
    end
  $$;

-- A Project Admin takes the binding of Work Item Type p_type_id on Project p_project_id
-- away (with p_participant_id, that Participant's exception): new items run the
-- Project's binding, else the Type's Rabaed Default again. Outcome: 'unbound' (also
-- when there was none); 'not_found'; 'project_closed'.
create function app.unbind_workflow(p_project_id uuid, p_type_id uuid, p_participant_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_refusal text := app.binding_command_refusal(p_project_id, p_type_id, p_participant_id);
      v_unbound uuid;
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      delete from workflow_binding b
      where b.project_id = p_project_id and b.work_item_type_id = p_type_id
        and b.raising_participant_id is not distinct from p_participant_id
      returning b.workflow_definition_id into v_unbound;
      if v_unbound is not null then
        perform app.write_workflow_event(null, p_project_id, null, 'unbound',
          jsonb_build_object('work_item_type_id', p_type_id, 'raising_participant_id', p_participant_id,
            'workflow_definition_id', v_unbound), v_at);
      end if;
      return 'unbound';
    end
  $$;

-- A Revision starts on its chain's own Workflow ------------------------------------------------

-- The Draft Step of the latest published Version of the Workflow item p_work_item_id
-- runs: where a Revision of it starts (workflow-engine.md §5.4; ADR 0016: a chain keeps
-- its Workflow, whatever the Project binds later). Replaces app.latest_draft_step (by
-- the Type's Rabaed Default) for Revisions.
create function app.revision_draft_step(p_work_item_id uuid)
  returns table (step_id uuid, workflow_version_id uuid, stage_key text, actor_rule jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select s.id, s.workflow_version_id, s.stage_key, s.actor_rule
        from work_item w
        join workflow_version iv on iv.id = w.workflow_version_id
        join lateral (
          select v.id from workflow_version v
          where v.workflow_definition_id = iv.workflow_definition_id and v.status = 'published'
          order by v.version_no desc limit 1
        ) v on true
        join workflow_step s on s.workflow_version_id = v.id
        where w.id = p_work_item_id and app.is_draft_step(s.id);
    end
  $$;

-- As in the plpgsql definer helpers migration (20261108000000), except that the Draft
-- Step is the one a Revision of this item starts on (app.revision_draft_step).
create or replace function app.can_create_revision(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(p_work_item_id) and exists (
          select 1
          from work_item w
          join work_item_type t on t.id = w.work_item_type_id
          join project pr on pr.id = w.project_id and pr.status = 'active'
          join app.acting_project_member(w.id) me on me.participant_id = w.raised_by_participant_id
          join participant p on p.id = me.participant_id
          join project_role r on r.id = p.project_role_id
          join app.revision_draft_step(w.id) d on true
          where w.id = p_work_item_id
            and w.outcome = 'C' and w.discarded_at is null
            and d.actor_rule ->> 'base_role' = r.base_role
            and app.project_member_has_permission(me.project_member_id, t.module_key, d.actor_rule ->> 'permission')
            -- The latest of its chain, and nothing of the chain open.
            and not exists (
              select 1 from work_item o
              where o.root_id = w.root_id and o.discarded_at is null
                and (o.revision_no > w.revision_no or o.closed_at is null))
        )
      );
    end
  $$;

-- As in the random ids migration (20261220000000), except that the Revision starts on
-- the latest published Version of the Workflow the revised item runs (app.revision_draft_step).
create or replace function app.create_revision(p_work_item_id uuid, p_idempotency_key uuid, p_now timestamptz)
  returns table (outcome text, work_item_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_me record;
      v_used record;
      v_draft record;
      v_form_version_id uuid;
      v_id uuid;
      v_kept text[];
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      -- The chain's original, locked: one Revision of a chain at a time.
      perform 1 from work_item r
      where r.id = (select w.root_id from work_item w where w.id = p_work_item_id)
      for update;
      select w.*, t.code as type_code, pr.status as project_status into v_item
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join project pr on pr.id = w.project_id
      where w.id = p_work_item_id;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;

      select c.work_item_id, c.command into v_used from command_idempotency c
      where c.member_id = v_member_id and c.key = p_idempotency_key;
      if v_used.work_item_id is not null then
        return query select
          case when v_used.command = 'create_revision:' || p_work_item_id then 'applied' else 'idempotency_key_reused' end,
          case when v_used.command = 'create_revision:' || p_work_item_id then v_used.work_item_id end;
        return;
      end if;
      if v_item.project_status <> 'active' then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if not app.can_create_revision(p_work_item_id) then
        return query select 'revision_not_allowed'::text, null::uuid;
        return;
      end if;

      select * into v_draft from app.revision_draft_step(p_work_item_id);
      v_form_version_id := app.latest_form_version(v_item.type_code);
      insert into work_item (
        project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data,
        workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at,
        revision_no, revision_of_id, root_id, created_at, updated_at
      ) values (
        v_item.project_id, v_item.work_item_type_id, v_item.raised_by_participant_id, v_member_id, v_item.title, '{}',
        v_draft.workflow_version_id, v_form_version_id, v_draft.step_id, v_draft.stage_key, v_at,
        v_item.revision_no + 1, v_item.id, v_item.root_id, v_at, v_at
      ) returning id into v_id;

      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (v_id, v_item.project_id, v_item.raised_by_participant_id, v_at, 'raised');
      insert into step_assignment (project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at)
      values (v_item.project_id, v_id, v_draft.step_id, v_item.raised_by_participant_id, v_member_id, 'claimed', v_at, v_at);
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, v_id, 'created', v_member_id, v_item.raised_by_participant_id, v_draft.step_id,
        jsonb_build_object('title', v_item.title, 'revision_no', v_item.revision_no + 1),
        'internal', v_item.raised_by_participant_id, v_at
      );

      -- The answers (RP-305: never another Participant's sections).
      if app.fill_revision(v_id, p_work_item_id, v_at) <> 'filled' then
        raise exception 'fill_revision refused a new Revision';
      end if;

      -- The Documents, as new unfrozen rows: of the Attachments System Field, and of
      -- the fields the Revision still has.
      v_kept := array(
        select f ->> 'key'
        from form_version v
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where v.id = v_form_version_id
          and app.form_field_type(v_item.form_version_id, f ->> 'key') = f ->> 'type'
        except select unnest(app.revision_dropped_keys(v_id)));
      with source as materialized (
        select gen_random_uuid() as new_id, d.*
        from (
          select d.* from document d
          where d.work_item_id = p_work_item_id and d.confirmed_at is not null and d.removed_at is null
            and (d.field_key is null or d.field_key = any (v_kept))
          order by d.confirmed_at, d.id
        ) d
      ), copied as (
        insert into document (
          id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
          uploaded_by_member_id, uploaded_by_participant_id, created_at, confirmed_at,
          field_key, item_key, taken_at, taken_latitude, taken_longitude
        )
        select s.new_id, s.project_id, v_id, s.file_name, s.size_bytes, s.content_type,
          app.document_storage_key(s.project_id, v_id, s.new_id),
          s.uploaded_by_member_id, s.uploaded_by_participant_id, s.created_at, s.confirmed_at,
          s.field_key, s.item_key, s.taken_at, s.taken_latitude, s.taken_longitude
        from source s
        returning document.id
      )
      insert into document_copy (document_id, copied_from_id)
      select s.new_id, s.id from source s join copied c on c.id = s.new_id;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, v_id, 'create_revision:' || p_work_item_id, v_at);
      return query select 'created'::text, v_id;
    end
  $$;

drop function app.latest_draft_step(uuid);

-- Grants ------------------------------------------------------------------------------------

revoke all on function app.workflow_type(uuid) from public;
grant execute on function app.workflow_type(uuid) to rabaed_app, rabaed_admin;
revoke all on function app.workflow_is_published(uuid) from public;
grant execute on function app.workflow_is_published(uuid) to rabaed_app;
revoke all on function app.workflow_version_rows(uuid) from public;
grant execute on function app.workflow_version_rows(uuid) to rabaed_app, rabaed_admin;
revoke all on function app.store_workflow_draft(uuid, jsonb, jsonb, jsonb, jsonb, timestamptz) from public;
revoke all on function app.publish_workflow_draft(uuid, timestamptz) from public;
revoke all on function app.refuse_workflow_event_change() from public;
revoke all on function app.write_workflow_event(uuid, uuid, uuid, text, jsonb, timestamptz) from public;
revoke all on function app.can_author_workflow(uuid) from public;
grant execute on function app.can_author_workflow(uuid) to rabaed_app;
revoke all on function app.names_participant(uuid, jsonb) from public;
revoke all on function app.is_exception_workflow(uuid) from public;
revoke all on function app.workflow_draft_rows(uuid) from public;
revoke all on function app.write_workflow_draft(uuid, jsonb, jsonb, jsonb, timestamptz) from public;
grant execute on function app.write_workflow_draft(uuid, jsonb, jsonb, jsonb, timestamptz) to rabaed_admin;
revoke all on function app.mark_workflow_published(uuid, timestamptz) from public;
grant execute on function app.mark_workflow_published(uuid, timestamptz) to rabaed_admin;
revoke all on function app.workflow_command_refusal(uuid) from public;
revoke all on function app.duplicate_workflow(uuid, uuid, jsonb, timestamptz) from public;
grant execute on function app.duplicate_workflow(uuid, uuid, jsonb, timestamptz) to rabaed_app;
revoke all on function app.workflow_draft(uuid) from public;
grant execute on function app.workflow_draft(uuid) to rabaed_app;
revoke all on function app.save_workflow_draft(uuid, jsonb, jsonb, jsonb, jsonb, timestamptz) from public;
grant execute on function app.save_workflow_draft(uuid, jsonb, jsonb, jsonb, jsonb, timestamptz) to rabaed_app;
revoke all on function app.publish_workflow(uuid, timestamptz) from public;
grant execute on function app.publish_workflow(uuid, timestamptz) to rabaed_app;
revoke all on function app.binding_command_refusal(uuid, uuid, uuid) from public;
revoke all on function app.bind_workflow(uuid, uuid, uuid, uuid, timestamptz) from public;
grant execute on function app.bind_workflow(uuid, uuid, uuid, uuid, timestamptz) to rabaed_app;
revoke all on function app.unbind_workflow(uuid, uuid, uuid, timestamptz) from public;
grant execute on function app.unbind_workflow(uuid, uuid, uuid, timestamptz) to rabaed_app;
revoke all on function app.revision_draft_step(uuid) from public;
