-- RP-554: new items use the Project's own Form for their Type, from the Company defaults
-- (RP-517; form-engine.md §7 "Which Form a new item gets"; ADR 0006; visibility.md V13, V18).
--
-- * app.new_item_form_version(p_project_id, p_type_code): the Form a new item of the Rabaed
--   Default Type p_type_code on Project p_project_id is pinned to. The latest published
--   Version of the Project's own Form for that Type (owner_kind `project`, its
--   work_item_type_id; app.seed_project_from_company_defaults copies it from the creating
--   Company's default), else the Type's Rabaed Default Form's (app.latest_form_version(text),
--   unchanged, still used where no Project is in question).
--   Security definer, so it answers with the Project's Form only when the caller is on that
--   Project (app.current_project_ids); anyone else gets the Rabaed Default's, never another
--   Project's Form id, whatever Project id they pass. Every caller below has already checked
--   that the acting Member is on the Project; the api passes the Project the Member asked for.
-- * The commands that create a new item pick their Form through it: app.create_work_item
--   (its `form_version_not_latest` check), app.create_revision, app.create_replacement and
--   app.transition_follow_up_items. Items already raised keep the Version they are pinned to:
--   nothing that reads an existing item's form_version_id changes.
--
-- Rebuilt from their latest bodies: app.create_work_item, app.create_revision and
-- app.create_replacement (20270110000000_pick_up_rename.sql), app.transition_follow_up_items
-- (20270111000000_pool_of_one.sql).

create function app.new_item_form_version(p_project_id uuid, p_type_code text) returns uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return coalesce(
        (
          select v.id from form_definition f
          join work_item_type t on t.id = f.work_item_type_id and t.owner_kind = 'rabaed' and t.code = p_type_code
          join form_version v on v.form_definition_id = f.id and v.status = 'published'
          where f.owner_kind = 'project' and f.project_id = p_project_id
            and p_project_id in (select app.current_project_ids())
          order by f.created_at desc, f.id desc, v.version_no desc limit 1
        ),
        app.latest_form_version(p_type_code)
      );
    end
  $$;

revoke all on function app.new_item_form_version(uuid, text) from public;
grant execute on function app.new_item_form_version(uuid, text) to rabaed_app;

-- app.create_work_item
CREATE OR REPLACE FUNCTION app.create_work_item(p_project_id uuid, p_type_code text, p_title text, p_form_version_id uuid, p_data jsonb, p_trade_id uuid, p_location_id uuid, p_now timestamp with time zone, p_scope_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(outcome text, work_item_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      -- New items use the latest published Version of the Project's own Form for the Type,
      -- else of its Rabaed Default Form (RP-554), and stay on it.
      if p_form_version_id is distinct from app.new_item_form_version(p_project_id, p_type_code) then
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

      insert into step_assignment (project_id, work_item_id, step_id, participant_id, assignee_member_id, status, picked_up_at, created_at)
      values (p_project_id, v_item_id, v_step.id, v_participant_id, app.current_member_id(), 'picked_up', v_at, v_at);

      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        p_project_id, v_item_id, 'created', app.current_member_id(), v_participant_id, v_step.id,
        jsonb_build_object('title', btrim(p_title)), 'internal', v_participant_id, v_at
      );

      return query select 'created'::text, v_item_id;
    end
  $function$;

-- app.create_revision
CREATE OR REPLACE FUNCTION app.create_revision(p_work_item_id uuid, p_idempotency_key uuid, p_now timestamp with time zone)
 RETURNS TABLE(outcome text, work_item_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      v_form_version_id := app.new_item_form_version(v_item.project_id, v_item.type_code);
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
      insert into step_assignment (project_id, work_item_id, step_id, participant_id, assignee_member_id, status, picked_up_at, created_at)
      values (v_item.project_id, v_id, v_draft.step_id, v_item.raised_by_participant_id, v_member_id, 'picked_up', v_at, v_at);
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
  $function$;

-- app.create_replacement
CREATE OR REPLACE FUNCTION app.create_replacement(p_work_item_id uuid, p_idempotency_key uuid, p_now timestamp with time zone)
 RETURNS TABLE(outcome text, work_item_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      -- The source, locked: two requests never open two replacements of it.
      select w.*, pr.status as project_status into v_item
      from work_item w
      join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;

      select c.work_item_id, c.command into v_used from command_idempotency c
      where c.member_id = v_member_id and c.key = p_idempotency_key;
      if v_used.work_item_id is not null then
        return query select
          case when v_used.command = 'create_replacement:' || p_work_item_id then 'applied' else 'idempotency_key_reused' end,
          case when v_used.command = 'create_replacement:' || p_work_item_id then v_used.work_item_id end;
        return;
      end if;
      if v_item.project_status <> 'active' then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if not app.can_create_replacement(p_work_item_id) then
        return query select 'replacement_not_allowed'::text, null::uuid;
        return;
      end if;

      -- A new item: on the Workflow a new item of its Type raised by its raiser runs (the
      -- raiser's exception, else the Project's binding, else the Rabaed Default; RP-426),
      -- at its Draft Step, as app.create_work_item starts one.
      select s.id as step_id, s.workflow_version_id, s.stage_key into v_draft
      from workflow_step s
      where s.workflow_version_id = app.new_item_workflow_version(v_item.project_id, v_item.work_item_type_id, v_item.raised_by_participant_id)
        and app.is_draft_step(s.id);
      v_form_version_id := app.new_item_form_version(v_item.project_id, (select t.code from work_item_type t where t.id = v_item.work_item_type_id));
      -- A new original: not a Revision (no revision_of_id; the trigger makes it its own chain's root).
      insert into work_item (
        project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data,
        workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at,
        created_at, updated_at
      ) values (
        v_item.project_id, v_item.work_item_type_id, v_item.raised_by_participant_id, v_member_id, v_item.title, '{}',
        v_draft.workflow_version_id, v_form_version_id, v_draft.step_id, v_draft.stage_key, v_at,
        v_at, v_at
      ) returning id into v_id;

      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (v_id, v_item.project_id, v_item.raised_by_participant_id, v_at, 'raised');
      insert into step_assignment (project_id, work_item_id, step_id, participant_id, assignee_member_id, status, picked_up_at, created_at)
      values (v_item.project_id, v_id, v_draft.step_id, v_item.raised_by_participant_id, v_member_id, 'picked_up', v_at, v_at);
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, v_id, 'created', v_member_id, v_item.raised_by_participant_id, v_draft.step_id,
        jsonb_build_object('title', v_item.title),
        'internal', v_item.raised_by_participant_id, v_at
      );

      -- The answers (never another Participant's sections).
      if app.fill_revision(v_id, p_work_item_id, v_at) <> 'filled' then
        raise exception 'fill_revision refused a replacement';
      end if;

      -- The Documents, as new unfrozen rows: of the Attachments System Field, and of
      -- the fields the replacement still has.
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

      -- Linked to the rejected item. Read under the replacement's own row-level
      -- security, so it reaches nobody while the replacement is a Draft (V1); the
      -- rejected item lists the replacement in Linked from once it is Submitted (E3).
      insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
      values (v_item.project_id, v_id, p_work_item_id, 'replaces', v_member_id, v_at);

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, v_id, 'create_replacement:' || p_work_item_id, v_at);
      return query select 'created'::text, v_id;
    end
  $function$;

-- app.transition_follow_up_items
CREATE OR REPLACE FUNCTION app.transition_follow_up_items(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_answers jsonb, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    declare
      v_member_id uuid := app.current_member_id();
      v_source record;
      v_type record;
      v_version_id uuid;
      v_route record;
      v_form_version_id uuid;
      v_fields text[];
      v_subject_key text;
      v_subject text;
      v_row jsonb;
      v_data jsonb;
      v_id uuid;
      v_number text;
    begin
      if jsonb_typeof(p_answers -> 'items_to_create') is distinct from 'array' then
        return;
      end if;
      select w.*, raiser_role.base_role as raiser_base_role, actor_role.base_role as actor_base_role
      into v_source
      from work_item w
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      join participant actor on actor.id = p_participant_id
      join project_role actor_role on actor_role.id = actor.project_role_id
      where w.id = p_work_item_id;
      -- The Type its outcome's rows become, in the Type's set on the item's Project (RP-429).
      select t.id, t.code into v_type
      from outcome o
      cross join lateral jsonb_array_elements(o.actions) a
      join work_item_type t on t.owner_kind = 'rabaed' and t.code = a ->> 'type'
      where o.project_id = v_source.project_id and o.work_item_type_id = v_source.work_item_type_id
        and o.code = v_source.outcome and a ->> 'kind' = 'create_items';
      if v_type.id is null then
        if exists (
          select 1 from outcome o
          where o.project_id = v_source.project_id and o.work_item_type_id = v_source.work_item_type_id
            and o.code = v_source.outcome and o.actions @> '[{"kind": "create_items"}]')
        then
          raise exception 'outcome % creates items of a Type that does not exist', v_source.outcome;
        end if;
        return;
      end if;

      -- Its Workflow as a new item of that raiser starts (RP-426), and the Step its
      -- Draft's Submit leads to: the item is raised already, at the source's raiser.
      v_version_id := app.new_item_workflow_version(v_source.project_id, v_type.id, p_participant_id);
      -- v_route: the Draft Step (key, role), its Submit, and the Step it leads to.
      select s.id, s.stage_key, s.actor_rule ->> 'base_role' as base_role, d.key as draft_key,
        d.actor_rule ->> 'base_role' as draft_role, tr.id as transition_id
      into strict v_route
      from workflow_step d
      join workflow_transition tr on tr.from_step_id = d.id and tr.kind = 'submit'
      join workflow_step s on s.id = tr.to_step_id
      where d.workflow_version_id = v_version_id and app.is_draft_step(d.id);
      if v_route.draft_role is distinct from v_source.actor_base_role then
        raise exception 'a % does not raise % items', v_source.actor_base_role, v_type.code;
      end if;
      if v_route.base_role is distinct from v_source.raiser_base_role then
        raise exception '% items do not start with the raiser''s role %', v_type.code, v_source.raiser_base_role;
      end if;

      v_form_version_id := app.new_item_form_version(v_source.project_id, v_type.code);
      -- The answers a row gives: its cells of the fields the raiser fills at the Draft
      -- (sections with no `editable_at`, or naming the Draft Step), never a section
      -- another Participant fills later, such as the Comment's Resolution (WF-8). The
      -- Built-in Fields come from the source, never from a row.
      v_fields := array(
        select f ->> 'key'
        from form_version v
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where v.id = v_form_version_id and f ->> 'key' not in ('trade', 'location', 'scopes')
          and (s -> 'editable_at' is null or s -> 'editable_at' ? v_route.draft_key));
      -- Each row's Subject: its first text cell (publishing asks the table for one).
      select c ->> 'key' into v_subject_key
      from workflow_transition tr
      cross join lateral jsonb_array_elements(tr.action_form -> 'sections') s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      cross join lateral jsonb_array_elements(f -> 'columns') with ordinality as c (c, n)
      where tr.id = p_transition_id and f ->> 'key' = 'items_to_create' and c ->> 'type' = 'text'
      order by n limit 1;

      for v_row in select r from jsonb_array_elements(p_answers -> 'items_to_create') r loop
        select coalesce(jsonb_object_agg(k, v), '{}') into v_data
        from jsonb_each(v_row) as cell (k, v) where k = any (v_fields);
        v_subject := left(btrim(coalesce(v_row ->> v_subject_key, '')), 200);
        insert into work_item (
          project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data, field_times,
          workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at,
          submitted_at, arrivals, created_at, updated_at
        ) values (
          v_source.project_id, v_type.id, p_participant_id, v_member_id,
          v_subject,
          v_data, (select coalesce(jsonb_object_agg(k, to_jsonb(p_at)), '{}') from jsonb_object_keys(v_data) k),
          v_version_id, v_form_version_id, v_route.id, v_route.stage_key, p_at,
          -- It has left its raiser: shared from the start, like an item Submitted (V1).
          p_at, 1, p_at, p_at
        ) returning id into v_id;
        -- The source's Trade, Location and Scopes, so the same Members see it (layer 4).
        insert into work_item_dimension_value (work_item_id, project_id, dimension_id, dimension_value_id)
        select v_id, v.project_id, v.dimension_id, v.dimension_value_id
        from work_item_dimension_value v where v.work_item_id = p_work_item_id;
        insert into work_item_scope (work_item_id, project_id, scope_id)
        select v_id, s.project_id, s.scope_id from work_item_scope s where s.work_item_id = p_work_item_id;

        v_number := app.issue_document_number(v_id, p_at);
        update work_item set document_number = v_number, numbered_at = p_at where id = v_id;

        -- Visible exactly where the source is (V2): the raiser, the source's raiser
        -- holding it, and every other Participant the source has, for the same reason.
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (v_id, v_source.project_id, p_participant_id, p_at, 'raised'),
          (v_id, v_source.project_id, v_source.raised_by_participant_id, p_at, 'handling');
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        select v_id, a.project_id, a.participant_id, p_at, a.reason
        from work_item_access a where a.work_item_id = p_work_item_id
        on conflict do nothing;

        -- Held by the source's raiser's Step Pool, from which a Member picks it up.
        insert into step_assignment (project_id, work_item_id, step_id, participant_id, status, created_at, updated_at)
        values (v_source.project_id, v_id, v_route.id, v_source.raised_by_participant_id, 'pooled', p_at, p_at);

        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
          audience, audience_participant_id, created_at
        ) values (
          v_source.project_id, v_id, 'created', v_member_id, p_participant_id, v_route.id,
          jsonb_build_object('title', v_subject),
          'internal', p_participant_id, p_at
        );
        -- Raised: its Draft's Submit, taken with the outcome by the same Member, shared.
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, to_step_id, payload, audience, content_sha256, created_at
        ) select
          v_source.project_id, v_id, 'transition', v_member_id, p_participant_id, v_route.transition_id,
          tr.from_step_id, v_route.id, jsonb_build_object('document_number', v_number), 'shared',
          app.work_item_content_sha256(v_id, w.title, w.data, null), p_at
        from workflow_transition tr, work_item w
        where tr.id = v_route.transition_id and w.id = v_id;

        insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
        values (v_source.project_id, v_id, p_work_item_id, 'raised_from', v_member_id, p_at);

        -- Rule 4 (§3.3): a pool of one holds it at once, after the events that raised it.
        perform app.hold_pool_of_one(a.id) from step_assignment a where a.work_item_id = v_id and a.status = 'pooled';
      end loop;
    end
  $function$;
