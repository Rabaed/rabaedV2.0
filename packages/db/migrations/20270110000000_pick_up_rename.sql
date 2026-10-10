-- Claim becomes Pick up, Release becomes Return to pool (ADR 0018; RP-512, spec RP-511).
-- "Claim" is the Financial module's payment request (GLOSSARY.md); taking a pooled
-- Step is Pick up. Behaviour is unchanged; only names move:
--
-- * step_assignment.status 'claimed' -> 'picked_up'; claimed_at -> picked_up_at.
-- * work_item_event types 'claimed' / 'released' -> 'picked_up' / 'returned_to_pool'.
--   The audit trail is append-only and hash-chained, so events already written keep
--   their old type: the check keeps accepting 'claimed' and 'released' for them.
-- * app.claim_step -> app.pick_up_step, app.release_step -> app.return_to_pool_step;
--   outcomes 'claimed' / 'already_claimed' / 'released' -> 'picked_up' /
--   'already_picked_up' / 'returned_to_pool'; app.work_item_actions rows 'claim' /
--   'release' -> 'pick_up' / 'return_to_pool'.
-- * Every other function whose latest body named the status, the column or an event
--   type is redefined below from that body (app.claim_scheduled_run, the scheduled-job
--   lock, is not the Financial claim and keeps its name).

-- The table: constraints, index and trigger that name the status -----------------------

drop trigger step_assignment_withdraw_step_reached on step_assignment;
drop index step_assignment_open_key;
alter table step_assignment drop constraint step_assignment_status_check;
alter table step_assignment drop constraint step_assignment_check;
alter table work_item_event drop constraint work_item_event_type_check;

alter table step_assignment rename column claimed_at to picked_up_at;
update step_assignment set status = 'picked_up' where status = 'claimed';

alter table step_assignment add constraint step_assignment_status_check
  check (status in ('pooled', 'picked_up', 'done', 'vacant', 'reassigned'));
alter table step_assignment add constraint step_assignment_check
  check (status <> 'picked_up' or assignee_member_id is not null);
create unique index step_assignment_open_key on step_assignment (work_item_id)
  where status in ('pooled', 'picked_up', 'vacant');

alter table work_item_event add constraint work_item_event_type_check check (type in (
  'created', 'transition', 'recommend_code', 'issue_code', 'assigned', 'picked_up', 'returned_to_pool',
  'vacated', 'admin_reassigned', 'admin_reset', 'internal_note', 'cancelled', 'answers_changed',
  'claimed', 'released'
));

-- The functions ---------------------------------------------------------------------------

-- answers_held
CREATE OR REPLACE FUNCTION app.answers_held(p_work_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(p_work_item_id) and exists (
          select 1 from work_item w
          join project pr on pr.id = w.project_id and pr.status = 'active'
          join workflow_step cur on cur.id = w.current_step_id
          join form_version v on v.id = w.form_version_id
          cross join lateral app.acting_project_member(w.id) me
          join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
            and a.participant_id = me.participant_id
          where w.id = p_work_item_id and w.closed_at is null
            and not app.is_draft_step(w.participant_entered_step_id)
            and me.participant_id <> w.raised_by_participant_id
            and exists (select 1 from jsonb_array_elements(v.schema -> 'sections') s where (s -> 'editable_at') ? cur.key)
        )
      );
    end
  $function$;

-- can_save_answers
CREATE OR REPLACE FUNCTION app.can_save_answers(p_work_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    declare
      v_item record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return false;
      end if;
      select w.id, w.project_id, w.raised_by_participant_id, w.current_step_id, w.form_version_id,
        app.is_draft_step(w.participant_entered_step_id) as open
      into v_item
      from work_item w
      join project pr on pr.id = w.project_id and pr.status = 'active'
      where w.id = p_work_item_id and w.closed_at is null;
      if v_item.id is null then
        return false;
      end if;
      -- The acting Member's own Project Member rows (app.acting_project_member; the item is seen).
      if v_item.open then
        -- The raiser, while its answers are open (app.answers_open).
        return exists (
          select 1 from project_member pm
          join participant p on p.id = pm.participant_id
          where pm.project_id = v_item.project_id and pm.member_id = app.current_member_id()
            and pm.status = 'active' and p.status = 'active' and p.company_id = app.current_company_id()
            and pm.participant_id = v_item.raised_by_participant_id
        );
      end if;
      -- Another Participant holding a Step a Form Section names (app.answers_held).
      return exists (
        select 1 from project_member pm
        join participant p on p.id = pm.participant_id
        join step_assignment a on a.work_item_id = v_item.id and a.status in ('pooled', 'picked_up', 'vacant')
          and a.participant_id = pm.participant_id
        where pm.project_id = v_item.project_id and pm.member_id = app.current_member_id()
          and pm.status = 'active' and p.status = 'active' and p.company_id = app.current_company_id()
          and pm.participant_id <> v_item.raised_by_participant_id
      ) and exists (
        select 1 from form_version v
        join workflow_step cur on cur.id = v_item.current_step_id
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        where v.id = v_item.form_version_id and (s -> 'editable_at') ? cur.key
      );
    end
  $function$;

-- pick_up_step
CREATE FUNCTION app.pick_up_step(p_work_item_id uuid, p_now timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_assignment record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.id, w.project_id, w.closed_at, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;
      if v_item.closed_at is not null then
        return 'item_closed';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      select * into v_assignment from step_assignment
      where work_item_id = p_work_item_id and status in ('pooled', 'picked_up', 'vacant');
      -- Another Participant's Step: whether it is picked up is internal to them (§5.2).
      if v_assignment.participant_id is distinct from v_me.participant_id then
        return 'forbidden';
      end if;
      if v_assignment.status = 'picked_up' then
        return case when v_assignment.assignee_member_id = app.current_member_id() then 'picked_up' else 'already_picked_up' end;
      end if;
      if v_assignment.status <> 'pooled' or v_me.project_member_id not in (
        select project_member_id from app.step_pool(p_work_item_id, v_assignment.step_id, v_assignment.participant_id))
      then
        return 'forbidden';
      end if;

      update step_assignment
      set status = 'picked_up', assignee_member_id = app.current_member_id(), picked_up_at = v_at, updated_at = v_at
      where id = v_assignment.id and status = 'pooled';
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, p_work_item_id, 'picked_up', app.current_member_id(), v_me.participant_id,
        'internal', v_me.participant_id, v_at
      );
      return 'picked_up';
    end
  $function$;

-- return_to_pool_step
CREATE FUNCTION app.return_to_pool_step(p_work_item_id uuid, p_now timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_assignment_id uuid;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.id, w.project_id, w.closed_at, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;
      if v_item.closed_at is not null then
        return 'item_closed';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      update step_assignment a
      set status = 'pooled', assignee_member_id = null, picked_up_at = null, updated_at = v_at
      where a.work_item_id = p_work_item_id and a.status = 'picked_up' and a.assignee_member_id = app.current_member_id()
        and not app.is_draft_step(a.step_id)
      returning a.id into v_assignment_id;
      if v_assignment_id is null then
        return 'not_holder';
      end if;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, p_work_item_id, 'returned_to_pool', app.current_member_id(), v_me.participant_id,
        'internal', v_me.participant_id, v_at
      );
      return 'returned_to_pool';
    end
  $function$;

-- create_replacement
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
      v_form_version_id := app.latest_form_version((select t.code from work_item_type t where t.id = v_item.work_item_type_id));
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

-- create_revision
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

-- create_work_item
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

-- deliver_notification
CREATE OR REPLACE FUNCTION app.deliver_notification(p_outbox_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    declare
      v_row record;
      v_assignment record;
      v_event record;
      v_actor uuid;
      v_recipient uuid;
      v_recipients uuid[];
      v_waiting uuid[];
      v_sent_back_to uuid[];
      v_count integer := 0;
    begin
      perform app.require_worker();
      select * into v_row from outbox where id = p_outbox_id;
      v_actor := (v_row.payload ->> 'actor_member_id')::uuid;

      -- A closed Project goes quiet: what was still in the outbox reaches nobody.
      if not exists (
        select 1 from work_item w join project p on p.id = w.project_id and p.status = 'active'
        where w.id = (v_row.payload ->> 'work_item_id')::uuid
      ) then
        return 0;
      end if;

      if v_row.payload ->> 'notification' = 'sent_back' then
        select e.* into v_event from work_item_event e
        join project p on p.id = e.project_id and p.status = 'active'
        where e.id = (v_row.payload ->> 'work_item_event_id')::uuid
          and e.work_item_id = (v_row.payload ->> 'work_item_id')::uuid;
        if v_event.id is null then
          return 0;
        end if;
        foreach v_recipient in array array(select s.member_id from app.sent_back_members(v_event.work_item_id, v_event.created_at) s) loop
          continue when v_recipient = v_actor;
          v_count := v_count + app.notify_member(
            p_outbox_id, v_recipient, v_event.project_id, v_event.work_item_id, 'sent_back', null,
            null, null, v_event.id, 'transition', null);
        end loop;
        return v_count;
      end if;

      if v_row.payload ->> 'notification' = 'vacancy' then
        select a.*, co.authorized_person_id into v_assignment from step_assignment a
        join project p on p.id = a.project_id and p.status = 'active'
        join participant pa on pa.id = a.participant_id
        join company co on co.id = pa.company_id
        where a.id = (v_row.payload ->> 'step_assignment_id')::uuid
          and a.work_item_id = (v_row.payload ->> 'work_item_id')::uuid
          -- Filled again before delivery: nothing to name.
          and a.status = 'vacant';
        if v_assignment.id is null or v_assignment.authorized_person_id is null then
          return 0;
        end if;
        return app.notify_member(
          p_outbox_id, v_assignment.authorized_person_id, v_assignment.project_id, v_assignment.work_item_id, 'vacancy', null,
          v_assignment.step_id, v_assignment.id, null, null, null);
      end if;

      if v_row.payload ? 'work_item_event_id' then
        select e.*, w.revision_no, tr.kind as transition_kind into v_event from work_item_event e
        join work_item w on w.id = e.work_item_id
        left join workflow_transition tr on tr.id = e.transition_id
        where e.id = (v_row.payload ->> 'work_item_event_id')::uuid
          and e.work_item_id = (v_row.payload ->> 'work_item_id')::uuid;
        if v_event.id is null then
          return 0;
        end if;
        -- Those the event made it wait on hear of it as "Step reached", not twice.
        -- (Its holder when it was handed to one, otherwise its Step Pool.)
        v_waiting := array(
          select a.assignee_member_id from step_assignment a
          where a.work_item_id = v_event.work_item_id and a.created_at = v_event.created_at
            and a.picked_up_at = a.created_at
          union
          select p.member_id from step_assignment a
          cross join app.step_pool(a.work_item_id, a.step_id, a.participant_id) p
          where a.work_item_id = v_event.work_item_id and a.created_at = v_event.created_at
            and a.picked_up_at is distinct from a.created_at);
        -- Those it was Sent Back to hear of it as "Sent Back" only.
        v_sent_back_to := case when v_event.transition_kind = 'send_back'
          then array(select s.member_id from app.sent_back_members(v_event.work_item_id, v_event.created_at) s)
          else '{}' end;
        -- Who watches the chain and still sees this item (scenario 68, V1), and the
        -- raiser or Position Members its Transition names; each is checked again, as
        -- that Member, in app.notify_member. Of them, V5: an internal event reaches
        -- only its own Participant's Members.
        v_recipients := array(
          select w.member_id from app.work_item_watchers(v_event.work_item_id) w
          union
          select t.member_id from app.transition_notice_members(v_event.id) t);
        foreach v_recipient in array v_recipients loop
          continue when v_recipient = v_actor or v_recipient = any (v_waiting) or v_recipient = any (v_sent_back_to);
          v_count := v_count + app.notify_member(
            p_outbox_id, v_recipient, v_event.project_id, v_event.work_item_id, 'watched_event',
            app.event_outcome(v_event.type, v_event.payload), null, null, v_event.id,
            case v_event.type when 'created' then 'revision_created' else v_event.type end,
            v_event.audience_participant_id);
        end loop;
        return v_count;
      end if;

      select a.* into v_assignment from step_assignment a
      where a.id = (v_row.payload ->> 'step_assignment_id')::uuid
        and a.work_item_id = (v_row.payload ->> 'work_item_id')::uuid
        and a.status in ('pooled', 'picked_up');
      -- The item moved on before delivery: it no longer waits for them.
      if v_assignment.id is null then
        return 0;
      end if;
      -- A Step a Send Back gave back: its Participant hears of it as "Sent Back".
      if exists (
        select 1 from work_item_event e join workflow_transition tr on tr.id = e.transition_id
        where e.work_item_id = v_assignment.work_item_id and e.created_at = v_assignment.created_at
          and e.type = 'transition' and tr.kind = 'send_back'
      ) then
        return 0;
      end if;

      for v_recipient in
        select r.member_id from (
          select v_assignment.assignee_member_id as member_id where v_assignment.status = 'picked_up'
          union
          select p.member_id
          from app.step_pool(v_assignment.work_item_id, v_assignment.step_id, v_assignment.participant_id) p
          where v_assignment.status = 'pooled'
        ) r
        -- Never the Member whose move it was.
        where r.member_id is distinct from v_actor
      loop
        v_count := v_count + app.notify_member(
          p_outbox_id, v_recipient, v_assignment.project_id, v_assignment.work_item_id, 'step_reached', null,
          v_assignment.step_id, v_assignment.id, null, null, null);
      end loop;
      return v_count;
    end
  $function$;

-- discard_revision
CREATE OR REPLACE FUNCTION app.discard_revision(p_work_item_id uuid, p_now timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.*, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      if not app.can_discard_revision(p_work_item_id) then
        return 'not_discardable';
      end if;

      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, from_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, p_work_item_id, 'cancelled', app.current_member_id(), v_me.participant_id, v_item.current_step_id,
        jsonb_build_object('revision_discarded', true), 'internal', v_item.raised_by_participant_id, v_at
      );
      update step_assignment set status = 'done', done_at = v_at, updated_at = v_at
      where work_item_id = p_work_item_id and status in ('pooled', 'picked_up', 'vacant');
      update work_item set outcome = 'cancelled', closed_at = v_at, discarded_at = v_at, updated_at = v_at
      where id = p_work_item_id;
      -- Nobody sees it again; it never left the raiser's Participant.
      delete from work_item_access where work_item_id = p_work_item_id;
      return 'discarded';
    end
  $function$;

-- held_work_item
CREATE OR REPLACE FUNCTION app.held_work_item(p_work_item_id uuid)
 RETURNS TABLE(work_item_id uuid, workflow_version_id uuid, current_step_id uuid, submitted_at timestamp with time zone, module_key text, project_member_id uuid, participant_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    begin
      return query
        select w.id, w.workflow_version_id, w.current_step_id, w.submitted_at, t.module_key, me.project_member_id, me.participant_id
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        join work_item_type t on t.id = w.work_item_type_id
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'picked_up'
          and a.assignee_member_id = app.current_member_id() and a.participant_id = me.participant_id
        where w.id = p_work_item_id and w.closed_at is null;
    end
  $function$;

-- holds_work_item
CREATE OR REPLACE FUNCTION app.holds_work_item(p_work_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1 from step_assignment a
          where a.work_item_id = p_work_item_id and a.status in ('pooled', 'picked_up', 'vacant')
            and a.participant_id in (select app.current_participant_ids())
        )
      );
    end
  $function$;

-- need_my_action
CREATE OR REPLACE FUNCTION app.need_my_action(p_work_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
                (a.status = 'picked_up' and a.assignee_member_id = v_me)
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
  $function$;

-- notification_email_content
CREATE OR REPLACE FUNCTION app.notification_email_content(p_notification_id uuid, p_email text)
 RETURNS TABLE(to_address text, language text, kind text, project_id uuid, project_name jsonb, work_item_id uuid, document_number text, subject text, step_name jsonb, event_type text, transition_label jsonb, outcome text, company_name jsonb, signer_name jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    declare
      v_saved text := current_setting('app.member_id', true);
      v_n record;
      v_event_id uuid;
      v_transition_id uuid;
      v_actor_participant uuid;
      v_audience text;
      v_audience_participant uuid;
      v_outcome text;
      v_email text;
      v_sees boolean;
    begin
      perform app.require_worker();
      select n.* into v_n from notification n where n.id = p_notification_id;
      if v_n.id is null or v_n.withdrawn_at is not null then
        return;
      end if;
      -- A closed Project goes quiet.
      if not exists (select 1 from project p where p.id = v_n.project_id and p.status = 'active') then
        return;
      end if;
      -- A Step reached them: only while it still waits.
      if v_n.kind = 'step_reached' and not exists (
        select 1 from step_assignment a where a.id = v_n.step_assignment_id and a.status in ('pooled', 'picked_up')
      ) then
        return;
      end if;
      -- A Vacancy (RP-356): only while the Step is still vacant.
      if v_n.kind = 'vacancy' and not exists (
        select 1 from step_assignment a where a.id = v_n.step_assignment_id and a.status = 'vacant'
      ) then
        return;
      end if;
      if v_n.work_item_event_id is not null then
        select e.id, e.transition_id, e.actor_participant_id, e.audience, e.audience_participant_id,
          app.event_outcome(e.type, e.payload)
        into v_event_id, v_transition_id, v_actor_participant, v_audience, v_audience_participant, v_outcome
        from work_item_event e where e.id = v_n.work_item_event_id;
      end if;
      -- Their settings now: email paused, the Project muted, the group's email or ticks changed.
      select r.email into v_email from app.member_notification_route(v_n.member_id, v_n.project_id, v_n.kind, v_outcome) r;
      if v_email is distinct from p_email then
        return;
      end if;

      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_n.member_id::text, true);
      v_sees := app.sees_work_item(v_n.work_item_id)
        and (v_event_id is null or v_audience = 'shared' or v_audience_participant in (select app.current_participant_ids()));
      if v_sees then
        return query
          select m.email, coalesce(pref.preferred_language, m.locale), v_n.kind, p.id, p.name, w.id, w.document_number, w.title,
            s.name, v_n.event_type, tr.label, v_outcome,
            (select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = v_actor_participant),
            case when v_event_id is not null then app.code_signer_name(v_event_id) end,
            v_n.created_at
          from member m
          left join member_notification_preference pref on pref.member_id = m.id
          join work_item w on w.id = v_n.work_item_id
          join project p on p.id = v_n.project_id
          left join workflow_step s on s.id = v_n.step_id
          left join workflow_transition tr on tr.id = v_transition_id
          where m.id = v_n.member_id;
      end if;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
    end
  $function$;

-- outbox_step_reached
CREATE OR REPLACE FUNCTION app.outbox_step_reached()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    begin
      if new.status in ('pooled', 'picked_up') and new.assignee_member_id is distinct from app.current_member_id() then
        insert into outbox (kind, project_id, payload, created_at, available_at)
        values ('notification', new.project_id,
          jsonb_strip_nulls(jsonb_build_object('work_item_id', new.work_item_id, 'step_assignment_id', new.id,
            'actor_member_id', app.current_member_id())),
          new.created_at, now());
      end if;
      return new;
    end
  $function$;

-- step_as_seen
CREATE OR REPLACE FUNCTION app.step_as_seen(p_work_item_id uuid)
 RETURNS TABLE(step_id uuid, stage_key text, entered_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    begin
      return query
        select s.id, s.stage_key, case when h.mine then w.step_entered_at else w.participant_entered_at end
        from work_item w
        cross join lateral (
          select exists (
            select 1 from step_assignment a
            where a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
              and a.participant_id in (select app.current_participant_ids())
          ) as mine
        ) h
        join workflow_step s on s.id = case when h.mine then w.current_step_id else w.participant_entered_step_id end
        where w.id = p_work_item_id and app.sees_work_item(w.id);
    end
  $function$;

-- take_transition
CREATE OR REPLACE FUNCTION app.take_transition(p_work_item_id uuid, p_transition_key text, p_answers jsonb, p_internal_note text, p_checked_data_sha256 bytea, p_idempotency_key uuid, p_now timestamp with time zone, p_assign_to uuid DEFAULT NULL::uuid, p_recommended_code text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

      perform app.transition_effects(
        p_work_item_id, v_transition.id, v_me.participant_id, v_assignment.id,
        v_next.outcome, v_next.participant_id, v_next.holder_member_id,
        v_actions.answers, nullif(btrim(p_internal_note), ''), p_recommended_code, v_at);
      -- Its outcome's follow-up items (WF-11: Code B's Comments), once it is closed.
      if v_next.outcome = 'terminal' then
        perform app.transition_follow_up_items(p_work_item_id, v_transition.id, v_me.participant_id, v_actions.answers, v_at);
      end if;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $function$;

-- transition_effects
CREATE OR REPLACE FUNCTION app.transition_effects(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_assignment_id uuid, p_next_outcome text, p_next_participant_id uuid, p_holder uuid, p_answers jsonb, p_note text, p_recommended_code text, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    declare
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_transition record;
      v_number text;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
      v_discarded text[];
      v_data jsonb;
      v_times jsonb;
    begin
      select w.* into v_item from work_item w where w.id = p_work_item_id;
      select tr.*, target.stage_key as to_stage_key,
        source.outcome_mode as from_outcome_mode, app.is_draft_step(source.id) as from_draft
      into v_transition
      from workflow_transition tr
      join workflow_step target on target.id = tr.to_step_id
      join workflow_step source on source.id = tr.from_step_id
      where tr.id = p_transition_id;

      -- The Document Number, from the Numbering Pattern in effect (gap-free: in this transaction).
      -- A Cancel issues none (RP-433): a Draft cancelled keeps "No number yet".
      if v_item.document_number is null and v_transition.from_draft and v_transition.kind <> 'cancel' then
        if v_item.revision_no > 0 then
          -- RP-316: a Revision takes its chain's base number with " Rev n", and no counter.
          v_number := (select r.document_number from work_item r where r.id = v_item.root_id) || ' Rev ' || v_item.revision_no;
        else
          v_number := app.issue_document_number(p_work_item_id, p_at);
        end if;
      end if;

      if p_next_outcome = 'terminal' then
        v_outcome := coalesce(v_transition.outcome, case when v_transition.kind = 'cancel' then 'cancelled' end);
        -- Publish-time validation requires one (workflow-engine.md §1, check 3); never guess it.
        if v_outcome is null then
          raise exception 'Transition % closes the item without an outcome', v_transition.key;
        end if;
      end if;
      -- The Recommended Code is Internal Communication (V5): its own event, internal to
      -- the recommender's Participant, just before the Internal Note written with it
      -- and the Transition. Never on the item, so no other read can reach it.
      if p_recommended_code is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'recommend_code', v_member_id, p_participant_id, p_transition_id,
          v_item.current_step_id, jsonb_build_object('recommended_code', p_recommended_code), 'internal', p_participant_id, p_at
        );
      end if;
      -- The Internal Note stays inside the writer's Participant even when the
      -- Transition crosses to another (V5). It goes just before the Transition it
      -- is written with.
      if p_note is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'internal_note', v_member_id, p_participant_id, p_transition_id,
          jsonb_build_object('internal_note', p_note), 'internal', p_participant_id, p_at
        );
      end if;
      -- It leaves the acting Participant: handed to another, or closed (nobody holds it).
      v_crosses := p_next_participant_id is distinct from p_participant_id;
      -- A Send Back out of a Step of a Participant other than the raiser discards
      -- what it wrote: the sections it fills go back to how they arrived, their
      -- field times too, before the trigger clears the "as arrived" copy (V19, ADR 0013).
      v_data := v_item.data;
      v_times := v_item.field_times;
      if v_transition.kind = 'send_back' and v_crosses and p_participant_id <> v_item.raised_by_participant_id
        and v_item.data_as_arrived is not null
      then
        v_discarded := array(
          select k from unnest(app.revision_dropped_keys(p_work_item_id)) k where k not in ('trade', 'location', 'scopes'));
        v_data := (v_data - v_discarded) || coalesce((
          select jsonb_object_agg(k, v_item.data_as_arrived -> k) from unnest(v_discarded) k where v_item.data_as_arrived ? k), '{}');
        v_times := (v_times - v_discarded) || coalesce((
          select jsonb_object_agg(k, a.times -> k)
          from unnest(v_discarded) k
          cross join (select coalesce(v_item.field_times_as_arrived, v_item.field_times) as times) a
          where a.times ? k), '{}');
      end if;
      -- Only what crosses is shared (a Send Back always does): a move inside one
      -- Participant stays its own, even from a Step that could issue a Code (V5, V14).
      v_audience := case
        when v_crosses or v_transition.kind in ('submit', 'send_back', 'close') then 'shared'
        else 'internal' end;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, created_at
      ) values (
        v_item.project_id, p_work_item_id,
        -- A Code is issued only where one is set; any other move from that Step is a plain Transition.
        case when v_transition.from_outcome_mode = 'issue_code' and v_outcome is not null then 'issue_code'
          else 'transition' end,
        v_member_id, p_participant_id, p_transition_id,
        v_item.current_step_id, v_transition.to_step_id,
        -- The Action Form answers (with what its actions set), then what the engine
        -- writes (no Action Form field takes those keys).
        jsonb_strip_nulls(p_answers || jsonb_build_object('document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then p_participant_id end,
        -- The item's exact content as this Transition leaves it (ADR 0017).
        app.work_item_content_sha256(p_work_item_id, v_item.title, v_data, v_outcome),
        p_at
      );

      update step_assignment set status = 'done', done_at = p_at, updated_at = p_at where id = p_assignment_id;

      update work_item set
        current_step_id = v_transition.to_step_id,
        current_stage_key = v_transition.to_stage_key,
        step_entered_at = p_at,
        participant_entered_at = case when v_crosses then p_at else participant_entered_at end,
        participant_entered_step_id = case when v_crosses then v_transition.to_step_id else participant_entered_step_id end,
        document_number = coalesce(document_number, v_number),
        -- The Creation Date: with the Document Number, at the first exit from Draft.
        numbered_at = case when v_number is not null then coalesce(numbered_at, p_at) else numbered_at end,
        -- The Submission Date: the first Submit out of the raiser's Participant; never changed.
        submitted_at = case
          when v_transition.kind = 'submit' and p_participant_id = v_item.raised_by_participant_id
            then coalesce(submitted_at, p_at)
          else submitted_at end,
        outcome = v_outcome,
        closed_at = case when v_outcome is not null then p_at end,
        data = v_data,
        field_times = v_times,
        updated_at = p_at
      where id = p_work_item_id;
      if v_discarded is not null then
        perform app.sync_link_answers(p_work_item_id, v_item.project_id, v_item.form_version_id, v_data, p_at);
      end if;

      -- RP-316: the item a Revision revises links to it from its first Submit, never
      -- while it is the raiser's own (V1).
      if v_transition.kind = 'submit' and v_item.revision_of_id is not null then
        insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
        values (v_item.project_id, v_item.revision_of_id, p_work_item_id, 'related', v_member_id, p_at)
        on conflict on constraint work_item_link_once do nothing;
      end if;

      if p_next_outcome = 'ok' then
        insert into step_assignment (
          project_id, work_item_id, step_id, participant_id, assignee_member_id, status, picked_up_at, created_at, updated_at
        ) values (
          v_item.project_id, p_work_item_id, v_transition.to_step_id, p_next_participant_id, p_holder,
          case when p_holder is null then 'pooled' else 'picked_up' end,
          case when p_holder is null then null else p_at end, p_at, p_at
        );
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (p_work_item_id, v_item.project_id, p_next_participant_id, p_at, 'handling')
        on conflict do nothing;
      end if;

      -- Oversight (V2): Owners and Owner Representatives whose Visibility covers the Submitted item.
      if v_transition.kind = 'submit' then
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        select p_work_item_id, v_item.project_id, p.id, p_at, 'oversight'
        from participant p
        join project_role r on r.id = p.project_role_id
        where p.project_id = v_item.project_id and p.status = 'active'
          and r.base_role in ('owner', 'owner_representative')
          and app.participant_covers_item(p.id, p_work_item_id)
        on conflict do nothing;
      end if;
    end
  $function$;

-- transition_follow_up_items
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

      v_form_version_id := app.latest_form_version(v_type.code);
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
      end loop;
    end
  $function$;

-- withdraw_step_reached
CREATE OR REPLACE FUNCTION app.withdraw_step_reached()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    begin
      update notification set withdrawn_at = new.picked_up_at
      where step_assignment_id = new.id and kind = 'step_reached' and read_at is null and withdrawn_at is null
        and member_id is distinct from new.assignee_member_id;
      return null;
    end
  $function$;

-- work_item_actions
CREATE OR REPLACE FUNCTION app.work_item_actions(p_work_item_id uuid)
 RETURNS TABLE(action text, transition_key text, label jsonb, transition_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    begin
      return query
        select 'pick_up', null::text, null::jsonb, null::text
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'pooled' and a.participant_id = me.participant_id
        where w.id = p_work_item_id and w.closed_at is null
          and me.project_member_id in (select project_member_id from app.step_pool(w.id, a.step_id, a.participant_id))
        union all
        select 'return_to_pool', null, null, null
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'picked_up'
          and a.assignee_member_id = app.current_member_id()
        where w.id = p_work_item_id and w.closed_at is null and not app.is_draft_step(a.step_id)
        union all
        select * from (
          select 'transition', t.key, t.label, t.kind from app.takeable_transitions(p_work_item_id) t order by t.sort
        ) x;
    end
  $function$;

-- work_item_holder
CREATE OR REPLACE FUNCTION app.work_item_holder(p_work_item_id uuid)
 RETURNS TABLE(participant_id uuid, assignee_member_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    begin
      return query
        select a.participant_id,
          case when a.participant_id in (select app.current_participant_ids()) then a.assignee_member_id end
        from step_assignment a
        where a.work_item_id = p_work_item_id and a.status in ('pooled', 'picked_up', 'vacant')
          and app.sees_work_item(p_work_item_id);
    end
  $function$;

-- The renamed commands: grants as the old ones had, then the old names go ---------------

revoke all on function app.pick_up_step(uuid, timestamptz) from public;
grant execute on function app.pick_up_step(uuid, timestamptz) to rabaed_app;
revoke all on function app.return_to_pool_step(uuid, timestamptz) from public;
grant execute on function app.return_to_pool_step(uuid, timestamptz) to rabaed_app;
drop function app.claim_step(uuid, timestamptz);
drop function app.release_step(uuid, timestamptz);

create trigger step_assignment_withdraw_step_reached after update of status on step_assignment
  for each row when (old.status = 'pooled' and new.status = 'picked_up')
  execute function app.withdraw_step_reached();
