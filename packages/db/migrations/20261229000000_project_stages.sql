-- Stages per Project and Module (RP-428, WF-5; spec RP-423; workflow-engine.md
-- "Stages"; data-model.md stage).
--
-- * Every Project has its own Stage set per Module, copied from the Rabaed
--   Defaults when the Project is created (trigger project_stages) and backfilled
--   here for the Projects that exist. A Rabaed Default Stage added later (a new
--   Module's, by migration or Rabaed Admin) is copied into every Project that has
--   no Stage of that key in that Module (trigger stage_rabaed_default_copied), so
--   the Rabaed Default Workflows every Project runs always find their Stages.
-- * A Project Admin renames, adds, reorders and deletes the Project's Stages
--   (app.rename_stage, app.add_stage, app.reorder_stages, app.delete_stage), each
--   audited in project_event. A Stage keeps its key and its category: a new one
--   takes both when it is added. A Stage is deleted only when no Step of any
--   Workflow Version of the Project uses it (app.stage_in_use).
-- * Reads of an item's Stage (app.need_my_action, the weekly Step Age report, and
--   the api's work item query) read the item's Project's Stages, never the Rabaed
--   Defaults. Whether a Step is a Draft start (app.is_draft_step) is read from the
--   Stage set its Workflow is published against: the Project's for a Project's
--   own Workflow, the Rabaed Defaults' for any other.
-- * Stages stay readable by every Member of the Project (policy
--   member_reads_stages, unchanged): they are the Kanban columns everyone sees.

create unique index stage_project_key on stage (project_id, module_key, key) where owner_kind = 'project';

-- Seeding -------------------------------------------------------------------------

-- The Rabaed Default Stages a Project doesn't have yet (by Module and key), as its own.
create function app.copy_rabaed_stages(p_project_id uuid) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into stage (owner_kind, project_id, module_key, key, name, category, sort)
      select 'project', p_project_id, d.module_key, d.key, d.name, d.category, d.sort
      from stage d
      where d.owner_kind = 'rabaed'
        and not exists (
          select 1 from stage x where x.project_id = p_project_id and x.module_key = d.module_key and x.key = d.key
        )
      order by d.module_key, d.sort;
    end
  $$;
revoke all on function app.copy_rabaed_stages(uuid) from public;

create function app.create_project_stages() returns trigger
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.copy_rabaed_stages(new.id);
      return new;
    end
  $$;
revoke all on function app.create_project_stages() from public;
create trigger project_stages after insert on project
  for each row execute function app.create_project_stages();

create function app.copy_rabaed_stage_to_projects() returns trigger
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into stage (owner_kind, project_id, module_key, key, name, category, sort)
      select 'project', p.id, new.module_key, new.key, new.name, new.category, new.sort
      from project p
      where not exists (select 1 from stage x where x.project_id = p.id and x.module_key = new.module_key and x.key = new.key);
      return new;
    end
  $$;
revoke all on function app.copy_rabaed_stage_to_projects() from public;
create trigger stage_rabaed_default_copied after insert on stage
  for each row when (new.owner_kind = 'rabaed') execute function app.copy_rabaed_stage_to_projects();

-- The backfill.
do $$
  declare
    v_project uuid;
  begin
    for v_project in select id from project loop
      perform app.copy_rabaed_stages(v_project);
    end loop;
  end
$$;

-- The audit trail of a Project's settings -------------------------------------------

-- Append-only, like work_item_event. Nobody reads it through the app yet: it stays
-- out of the Activity Feed until its audience rules are settled (data-model.md §9).
create table project_event (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id),
  type text not null check (type in ('stage_added', 'stage_renamed', 'stages_reordered', 'stage_removed')),
  actor_member_id uuid not null references member (id),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index project_event_project on project_event (project_id, created_at);
alter table project_event enable row level security;
revoke all on project_event from rabaed_app;
revoke update, delete, truncate on project_event from rabaed_admin;

create function app.refuse_project_event_change() returns trigger
  language plpgsql
  as $$
    begin
      raise exception 'project_event is append-only' using errcode = '42501';
    end
  $$;
revoke all on function app.refuse_project_event_change() from public;
create trigger project_event_append_only before update or delete on project_event
  for each row execute function app.refuse_project_event_change();
create trigger project_event_no_truncate before truncate on project_event
  for each statement execute function app.refuse_project_event_change();

-- In use --------------------------------------------------------------------------

-- Whether a Step of any Workflow Version of the Project uses the Stage: a Version
-- of one of the Project's own Workflows (any Module: a Workflow names no Module), or
-- of the Workflow of a Work Item Type of that Module the Project can use (the
-- Rabaed Defaults' included, which every Project runs today). Every item is on a
-- Version of its Type's Workflow, so no item is ever left in a deleted Stage. Read
-- from definitions only, which every Member of the Project reads (ADR 0016), never
-- from items: the answer says nothing about items the caller doesn't see.
create function app.stage_in_use(p_project_id uuid, p_module_key text, p_key text) returns boolean
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
          )
      );
    end
  $$;
revoke all on function app.stage_in_use(uuid, text, text) from public;
grant execute on function app.stage_in_use(uuid, text, text) to rabaed_app;

-- The Project Admin's commands ---------------------------------------------------------

-- Common to every command: 'not_found' unless the acting Member is a Project Admin
-- of the Project (whether it exists or not, so it names nothing) and the Module is
-- one; 'project_closed'. Takes the Project's Stage lock for the Module, so two
-- commands on the same Stages (or a delete and a check of what uses it) never interleave.
create function app.stage_command_refusal(p_project_id uuid, p_module_key text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if p_module_key is null or p_module_key not in ('submittals', 'inspections', 'snag_list', 'site_reports', 'drawings')
        or not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id)
      then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('stages:' || p_project_id::text || ':' || p_module_key, 0));
      return null;
    end
  $$;
revoke all on function app.stage_command_refusal(uuid, text) from public;

create function app.write_project_event(p_project_id uuid, p_type text, p_payload jsonb) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into project_event (project_id, type, actor_member_id, payload)
      values (p_project_id, p_type, app.current_member_id(), p_payload);
    end
  $$;
revoke all on function app.write_project_event(uuid, text, jsonb) from public;

-- Outcome: 'renamed'; 'not_found' (also a key the Module doesn't have); 'project_closed'; 'invalid_name'.
create function app.rename_stage(p_project_id uuid, p_module_key text, p_key text, p_name jsonb) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_refusal text := app.stage_command_refusal(p_project_id, p_module_key);
      v_stage stage;
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      select * into v_stage from stage
      where project_id = p_project_id and module_key = p_module_key and key = p_key;
      if v_stage.id is null then
        return 'not_found';
      end if;
      if not coalesce(app.is_bilingual(p_name), false) then
        return 'invalid_name';
      end if;
      p_name := jsonb_build_object('en', trim(p_name ->> 'en'), 'ar', trim(p_name ->> 'ar'));
      update stage set name = p_name, updated_at = now() where id = v_stage.id;
      perform app.write_project_event(p_project_id, 'stage_renamed',
        jsonb_build_object('module', p_module_key, 'key', p_key, 'from', v_stage.name, 'to', p_name));
      return 'renamed';
    end
  $$;
revoke all on function app.rename_stage(uuid, text, text, jsonb) from public;
grant execute on function app.rename_stage(uuid, text, text, jsonb) to rabaed_app;

-- Outcome: 'added' (last in the Module's order); 'not_found'; 'project_closed';
-- 'invalid_stage' (a key that isn't snake_case, a name without English and Arabic,
-- an unknown category); 'stage_exists' (the Module has that key).
create function app.add_stage(p_project_id uuid, p_module_key text, p_key text, p_name jsonb, p_category text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_refusal text := app.stage_command_refusal(p_project_id, p_module_key);
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,62}$' or not coalesce(app.is_bilingual(p_name), false)
        or p_category is null or p_category not in ('draft', 'in_progress', 'closed_positive', 'closed_negative', 'cancelled')
      then
        return 'invalid_stage';
      end if;
      if exists (select 1 from stage where project_id = p_project_id and module_key = p_module_key and key = p_key) then
        return 'stage_exists';
      end if;
      p_name := jsonb_build_object('en', trim(p_name ->> 'en'), 'ar', trim(p_name ->> 'ar'));
      insert into stage (owner_kind, project_id, module_key, key, name, category, sort)
      select 'project', p_project_id, p_module_key, p_key, p_name, p_category, coalesce(max(s.sort), 0) + 1
      from stage s where s.project_id = p_project_id and s.module_key = p_module_key;
      perform app.write_project_event(p_project_id, 'stage_added',
        jsonb_build_object('module', p_module_key, 'key', p_key, 'name', p_name, 'category', p_category));
      return 'added';
    end
  $$;
revoke all on function app.add_stage(uuid, text, text, jsonb, text) from public;
grant execute on function app.add_stage(uuid, text, text, jsonb, text) to rabaed_app;

-- Outcome: 'reordered'; 'not_found'; 'project_closed'; 'invalid_order' (not exactly
-- the Module's Stage keys, each once).
create function app.reorder_stages(p_project_id uuid, p_module_key text, p_keys text[]) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_refusal text := app.stage_command_refusal(p_project_id, p_module_key);
      v_before text[];
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      select array_agg(key order by sort, key) into v_before
      from stage where project_id = p_project_id and module_key = p_module_key;
      if p_keys is null or cardinality(p_keys) <> coalesce(cardinality(v_before), 0)
        or (select count(distinct k) from unnest(p_keys) k) <> cardinality(p_keys)
        or exists (select 1 from unnest(p_keys) k where k is null or k <> all(v_before))
      then
        return 'invalid_order';
      end if;
      update stage s set sort = o.n, updated_at = now()
      from unnest(p_keys) with ordinality as o (key, n)
      where s.project_id = p_project_id and s.module_key = p_module_key and s.key = o.key and s.sort <> o.n;
      perform app.write_project_event(p_project_id, 'stages_reordered',
        jsonb_build_object('module', p_module_key, 'from', to_jsonb(v_before), 'to', to_jsonb(p_keys)));
      return 'reordered';
    end
  $$;
revoke all on function app.reorder_stages(uuid, text, text[]) from public;
grant execute on function app.reorder_stages(uuid, text, text[]) to rabaed_app;

-- Outcome: 'removed'; 'not_found'; 'project_closed'; 'stage_in_use' (a Step of a
-- Workflow Version of the Project uses it: app.stage_in_use).
create function app.delete_stage(p_project_id uuid, p_module_key text, p_key text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_refusal text := app.stage_command_refusal(p_project_id, p_module_key);
      v_stage stage;
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      select * into v_stage from stage
      where project_id = p_project_id and module_key = p_module_key and key = p_key;
      if v_stage.id is null then
        return 'not_found';
      end if;
      if app.stage_in_use(p_project_id, p_module_key, p_key) then
        return 'stage_in_use';
      end if;
      delete from stage where id = v_stage.id;
      perform app.write_project_event(p_project_id, 'stage_removed',
        jsonb_build_object('module', p_module_key, 'key', p_key, 'name', v_stage.name, 'category', v_stage.category));
      return 'removed';
    end
  $$;
revoke all on function app.delete_stage(uuid, text, text) from public;
grant execute on function app.delete_stage(uuid, text, text) to rabaed_app;

-- Reads of Stages -------------------------------------------------------------------

-- As in 20261108000000_plpgsql_definer_helpers.sql, but the Stage set is the one the
-- Step's Workflow is published against: its Project's for a Project's own Workflow,
-- the Rabaed Defaults' for any other.
create or replace function app.is_draft_step(p_step_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1 from workflow_step s
          join workflow_version v on v.id = s.workflow_version_id
          join workflow_definition d on d.id = v.workflow_definition_id
          join work_item_type t on t.workflow_definition_id = v.workflow_definition_id
          join stage st on st.module_key = t.module_key and st.key = s.stage_key
            and case when d.owner_kind = 'project' then st.project_id = d.project_id else st.owner_kind = 'rabaed' end
          where s.id = p_step_id and st.category = 'draft'
        )
      );
    end
  $$;

-- As in 20261202000000_need_my_action.sql, but with the item's Project's Stages.
create or replace function app.need_my_action(p_work_item_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_me uuid := app.current_member_id();
    begin
      return (
        select case
          when st.category = 'draft' and w.created_by_member_id = v_me then 'own_draft'
          when exists (
            select 1 from step_assignment a
            where a.work_item_id = w.id
              and (
                (a.status = 'claimed' and a.assignee_member_id = v_me)
                or (a.status = 'pooled' and exists (
                  select 1 from app.step_pool(w.id, a.step_id, a.participant_id) p where p.member_id = v_me
                ))
              )
          ) then 'waiting'
        end
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        join work_item_type t on t.id = w.work_item_type_id
        join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = w.current_stage_key
        where w.id = p_work_item_id and w.closed_at is null and w.discarded_at is null
          and app.sees_work_item(w.id)
      );
    end
  $$;

-- As in 20261219000000_draft_start_time.sql, but with the Project's Stages: its open
-- ones for the link to the List, in its order, and each item's Stage name.
create or replace function app.take_step_age_report(p_outbox_id uuid)
  returns table (
    to_address text, language text, project_id uuid, project_name jsonb, open_stage_keys text[],
    work_item_id uuid, document_number text, subject text, stage_name jsonb,
    held_by_own boolean, step_name jsonb, holder_name jsonb, entered_at timestamptz
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_saved text := current_setting('app.member_id', true);
      v_project uuid;
      v_member uuid;
    begin
      perform app.require_worker();
      select o.project_id, (o.payload ->> 'member_id')::uuid into v_project, v_member
      from outbox o where o.id = p_outbox_id and o.kind = 'step_age_report' and o.processed_at is null;
      if v_member is null then
        return;
      end if;
      -- A closed Project goes quiet.
      if not exists (select 1 from project p where p.id = v_project and p.status = 'active') then
        return;
      end if;
      -- Still on the Project, holding Assign.
      if not exists (
        select 1 from project_member pm
        join member m on m.id = pm.member_id and m.status = 'active'
        where pm.project_id = v_project and pm.member_id = v_member and pm.status = 'active'
          and app.project_member_holds_assign(pm.id)
      ) then
        return;
      end if;
      -- Their settings now: the group's email off, email paused, the Project muted.
      -- "Immediately" and "daily digest" both send it: the report has its own time.
      if coalesce((select r.email from app.member_notification_route(v_member, v_project, 'weekly_report', null) r), 'none') = 'none' then
        return;
      end if;

      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_member::text, true);
      return query
        select m.email, coalesce(pref.preferred_language, m.locale), pr.id, pr.name,
          array(
            select s.key from stage s
            where s.module_key = 'submittals' and s.project_id = v_project and s.category in ('draft', 'in_progress')
            order by s.sort, s.key
          ),
          i.id, i.document_number, i.title, i.stage_name, i.held_by_own, i.step_name, i.holder_name, i.entered_at
        from member m
        left join member_notification_preference pref on pref.member_id = m.id
        join project pr on pr.id = v_project
        cross join lateral (
          select w.id, w.document_number, w.title, st.name as stage_name,
            coalesce(h.participant_id in (select app.current_participant_ids()), false) as held_by_own,
            s.name as step_name, hc.legal_name as holder_name, seen.entered_at
          from work_item w
          cross join lateral app.step_as_seen(w.id) seen
          join workflow_step s on s.id = seen.step_id
          join work_item_type t on t.id = w.work_item_type_id
          join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = seen.stage_key
          left join lateral (select * from app.work_item_holder(w.id) limit 1) h on true
          left join lateral (
            select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = h.participant_id
          ) hc on true
          where w.project_id = v_project and t.module_key = 'submittals'
            and st.category in ('draft', 'in_progress')
            -- An un-numbered Draft has no Step Age (scenario 76).
            and w.document_number is not null
            and app.latest_visible_revision(w.id)
        ) i
        where m.id = v_member
        order by i.entered_at, i.id;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
    end
  $$;
