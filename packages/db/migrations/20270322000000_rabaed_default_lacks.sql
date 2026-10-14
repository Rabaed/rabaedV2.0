-- RP-566 (decided 2026-10-14, option 1; workflow-engine.md "Rabaed Admin -> Workflows",
-- data-model.md `stage` and `outcome`): an edit of a Rabaed Default set reaches only the
-- Projects created afterwards, so no Project may run a Rabaed Default Version that uses an
-- outcome or Stage its own sets lack.
--
-- * Publishing a Rabaed Default Version is refused in `writeRabaedDefaultWorkflow`
--   (@rabaed/db) while an Active Project running that Rabaed Default lacks one. A refused
--   publish is logged in admin_action as 'refuse_workflow_publish' (V9).
-- * The other way onto a Rabaed Default is a Project Admin's binding: binding the Type, or one
--   raising Participant, to the Rabaed Default (app.bind_workflow), or taking away the binding
--   that kept the Project or the Participant off it (app.unbind_workflow). Each is refused
--   'default_lacks_entries' while the Project lacks an outcome or Stage the Rabaed Default's
--   latest Version uses; app.binding_lacks_entries names them, the Project's own only, to its
--   Project Admins.
-- * The locks (CODING_STANDARDS "a lock per check-then-write"): each check takes the Project's
--   outcome-set and Stage-set advisory locks shared (app.lock_project_sets_shared), the keys
--   the Project Admin's outcome and Stage commands take exclusively, so app.delete_stage or an
--   outcome's code change can't slip between the check and its write; and the Rabaed Default's
--   workflow_definition row, which a publish locks for update and a binding command locks too
--   (bind_workflow already locked the Workflow it binds; unbind_workflow now locks the one it
--   falls back to), so a binding and a publish never interleave.

alter table admin_action drop constraint admin_action_action_check;
alter table admin_action add constraint admin_action_action_check
  check (action in (
    'onboard_company', 'read_onboarding_leads', 'invite_authorized_person', 'close_onboarding_lead',
    'create_option_list', 'add_option', 'rename_option', 'retire_option', 'restore_option',
    'read_numbering', 'set_numbering_pattern', 'set_participant_code', 'set_numbering_counter_start',
    'save_workflow_draft', 'publish_workflow',
    'duplicate_workflow', 'add_default_outcome', 'change_default_outcome', 'reorder_default_outcomes',
    'add_default_stage', 'rename_default_stage', 'reorder_default_stages',
    'refuse_workflow_publish'
  ));

-- Holds Project `p_project_id`'s outcome set of Type `p_type_id` and its Stage set of the Type's
-- Module, shared, until the transaction ends: the keys app.outcome_command_refusal and
-- app.stage_command_refusal take exclusively.
create function app.lock_project_sets_shared(p_project_id uuid, p_type_id uuid) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform pg_advisory_xact_lock_shared(hashtextextended('outcomes:' || p_project_id::text || ':' || p_type_id::text, 0));
      perform pg_advisory_xact_lock_shared(hashtextextended(
        'stages:' || p_project_id::text || ':' || (select t.module_key from work_item_type t where t.id = p_type_id), 0));
    end
  $$;
revoke all on function app.lock_project_sets_shared(uuid, uuid) from public;
grant execute on function app.lock_project_sets_shared(uuid, uuid) to rabaed_admin;

-- What a Project Admin's binding command would put raisers of Type `p_type_id` on Project
-- `p_project_id` back on, when it is a Rabaed Default: the outcomes its latest published Version
-- sets that the Project's copy of the Type's set holds no closing outcome of, and the Stages its
-- Steps sit in that the Project's Stage set of the Module lacks. `p_definition_id` is the Workflow
-- a bind names; null for an unbind, which falls back to the Project-wide binding (for one
-- Participant's exception), else the Type's Rabaed Default. Empty for a Workflow that isn't a
-- Rabaed Default, and for anyone but the Project's Project Admins (it names nothing to anyone
-- else). Locks the Project's sets (shared) and the Rabaed Default (for share) first.
create function app.binding_lacks_entries(p_project_id uuid, p_type_id uuid, p_participant_id uuid, p_definition_id uuid)
  returns table (outcomes text[], stages text[])
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_target uuid := p_definition_id;
      v_version uuid;
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return query select '{}'::text[], '{}'::text[];
        return;
      end if;
      if v_target is null then
        v_target := coalesce(
          (select b.workflow_definition_id from workflow_binding b
           where p_participant_id is not null and b.project_id = p_project_id and b.work_item_type_id = p_type_id
             and b.raising_participant_id is null),
          (select t.workflow_definition_id from work_item_type t where t.id = p_type_id));
      end if;
      perform 1 from workflow_definition d where d.id = v_target and d.owner_kind = 'rabaed' for share;
      if not found then
        return query select '{}'::text[], '{}'::text[];
        return;
      end if;
      perform app.lock_project_sets_shared(p_project_id, p_type_id);
      select v.id into v_version from workflow_version v
      where v.workflow_definition_id = v_target and v.status = 'published'
      order by v.version_no desc limit 1;
      return query
        select
          coalesce((
            select array_agg(distinct tr.outcome order by tr.outcome) from workflow_transition tr
            where tr.workflow_version_id = v_version and tr.outcome is not null
              and not exists (
                select 1 from outcome o
                where o.project_id = p_project_id and o.work_item_type_id = p_type_id and o.code = tr.outcome and o.closing)
          ), '{}'::text[]),
          coalesce((
            select array_agg(distinct s.stage_key order by s.stage_key) from workflow_step s
            where s.workflow_version_id = v_version
              and not exists (
                select 1 from stage x join work_item_type t on t.id = p_type_id
                where x.project_id = p_project_id and x.module_key = t.module_key and x.key = s.stage_key)
          ), '{}'::text[]);
    end
  $$;
revoke all on function app.binding_lacks_entries(uuid, uuid, uuid, uuid) from public;
grant execute on function app.binding_lacks_entries(uuid, uuid, uuid, uuid) to rabaed_app;

-- Rebuilt from 20261226000000_workflow_authoring.sql (its only definition): refused
-- 'default_lacks_entries' when it binds to a Rabaed Default the Project lacks an outcome or
-- Stage of.
create or replace function app.bind_workflow(
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
      if exists (
        select 1 from app.binding_lacks_entries(p_project_id, p_type_id, p_participant_id, p_definition_id) l
        where cardinality(l.outcomes) + cardinality(l.stages) > 0
      ) then
        return 'default_lacks_entries';
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

-- Rebuilt from 20261226000000_workflow_authoring.sql (its only definition): refused
-- 'default_lacks_entries' when taking the binding away puts the raisers back on a Rabaed Default
-- the Project lacks an outcome or Stage of.
create or replace function app.unbind_workflow(p_project_id uuid, p_type_id uuid, p_participant_id uuid, p_now timestamptz) returns text
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
      if exists (
          select 1 from workflow_binding b
          where b.project_id = p_project_id and b.work_item_type_id = p_type_id
            and b.raising_participant_id is not distinct from p_participant_id)
        and exists (
          select 1 from app.binding_lacks_entries(p_project_id, p_type_id, p_participant_id, null) l
          where cardinality(l.outcomes) + cardinality(l.stages) > 0)
      then
        return 'default_lacks_entries';
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
