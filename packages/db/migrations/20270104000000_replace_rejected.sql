-- A replacement for a rejected item (RP-435, WF-12; spec RP-423;
-- workflow-engine.md §5.5 and §6; visibility.md V1, E1, E3; data-model.md
-- work_item_link).
--
-- * An item closed with an outcome that offers a replacement in its Type's set
--   (`offer_replacement`, RP-429: Code D in the Rabaed Defaults) lets its raiser
--   create a NEW Work Item: not a Revision, so no `revision_of_id`, its own
--   chain, and a new Document Number from the counter when it first leaves
--   Draft. It starts as a Draft with the source's answers (never another
--   Participant's Form Sections, as for a Revision) and Documents copied as new
--   unfrozen rows, pinned to the latest published Form and Workflow Versions,
--   visible like any new Draft: to the raiser only (V1).
-- * `work_item_link.kind` gains `replaces`: from the replacement TO the source,
--   made at creation. It is read under the replacement's row-level security, so
--   it reaches nobody while the replacement is the raiser's own Draft; the source
--   lists the replacement in Linked from (E3) once it has been Submitted, and the
--   replacement lists the source under its Links (E1), like any Link. It is not a
--   free Link: the Links System Field cannot remove it.
-- * At most one replacement stands per source: a second is refused while one that
--   isn't discarded or cancelled exists. Cancelling the Draft frees the source.
-- * app.can_create_replacement asks the outcome's `offer_replacement` as
--   app.can_create_revision asks `offer_revision`, never a code. app.fill_revision,
--   which the replacement uses for its answers, now asks that the closed item's
--   outcome offers a Revision or a replacement instead of being Code C.
-- * app.take_transition is not touched: the Link is made at creation, not at the
--   first Submit.

alter table work_item_link drop constraint work_item_link_kind_check;
alter table work_item_link add constraint work_item_link_kind_check
  check (kind in ('related', 'relies_on', 'raised_from', 'replaces'));

-- As in 20261107000300_revision_code_c_only.sql, but the closed item's outcome offers
-- a Revision or a replacement in its Type's set on the Project (RP-429, RP-435).
create or replace function app.fill_revision(p_revision_id uuid, p_closed_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_closed record;
      v_revision record;
      v_answers jsonb;
      v_scopes uuid[];
    begin
      if not app.sees_work_item(p_closed_item_id) or not app.sees_work_item(p_revision_id) then
        return 'not_found';
      end if;
      select * into v_closed from work_item where id = p_closed_item_id;
      select * into v_revision from work_item where id = p_revision_id for update;
      if not (
          app.outcome_offers(v_closed.project_id, v_closed.work_item_type_id, v_closed.outcome, 'offer_revision')
          or app.outcome_offers(v_closed.project_id, v_closed.work_item_type_id, v_closed.outcome, 'offer_replacement'))
        or p_revision_id = p_closed_item_id
        or v_closed.raised_by_participant_id not in (select app.current_participant_ids())
        or v_revision.raised_by_participant_id <> v_closed.raised_by_participant_id
        or v_revision.project_id <> v_closed.project_id
        or v_revision.work_item_type_id <> v_closed.work_item_type_id
        or v_revision.closed_at is not null
        or not app.is_draft_step(v_revision.current_step_id)
        or exists (select 1 from work_item_event e where e.work_item_id = p_revision_id and e.type = 'transition')
        or not app.can_save_answers(p_revision_id)
      then
        return 'not_allowed';
      end if;

      v_answers := app.revision_answers(p_closed_item_id) - app.revision_dropped_keys(p_revision_id);
      -- Only the answers the new item's Form Version still has, with the same type;
      -- the Built-in Fields are in every Form.
      v_answers := coalesce((
        select jsonb_object_agg(a.key, a.value) from jsonb_each(v_answers) a
        where a.key in ('trade', 'location', 'scopes')
          or app.form_field_type(v_revision.form_version_id, a.key) = app.form_field_type(v_closed.form_version_id, a.key)
      ), '{}'::jsonb);
      v_scopes := array(select x::uuid from jsonb_array_elements_text(coalesce(v_answers -> 'scopes', '[]')) x);
      perform app.set_work_item_built_ins(
        p_revision_id, v_revision.project_id,
        (v_answers ->> 'trade')::uuid, (v_answers ->> 'location')::uuid, v_scopes);
      update work_item set
        data = v_answers - array['trade', 'location', 'scopes'],
        data_as_arrived = null,
        field_times = '{}'::jsonb,
        field_times_as_arrived = null,
        updated_at = v_at
      where id = p_revision_id;
      perform app.sync_link_answers(
        p_revision_id, v_revision.project_id, v_revision.form_version_id, v_answers - array['trade', 'location', 'scopes'], v_at);
      perform app.record_field_times(p_revision_id, p_now);
      return 'filled';
    end
  $$;

-- Who may create one ------------------------------------------------------------------

-- As app.can_create_revision (20270102000000_outcome_sets.sql): the raiser's Participant
-- and a Member the Workflow's Draft Step allows, on a closed item whose outcome offers a
-- replacement; no replacement of it standing (not discarded, not cancelled).
create function app.can_create_replacement(p_work_item_id uuid) returns boolean
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
          join app.latest_draft_step(w.work_item_type_id) d on true
          where w.id = p_work_item_id
            and w.closed_at is not null and w.discarded_at is null
            and app.outcome_offers(w.project_id, w.work_item_type_id, w.outcome, 'offer_replacement')
            and d.actor_rule ->> 'base_role' = r.base_role
            and app.project_member_has_permission(me.project_member_id, t.module_key, d.actor_rule ->> 'permission')
            and not exists (
              select 1
              from work_item_link l
              join work_item x on x.id = l.from_id
              where l.to_id = w.id and l.kind = 'replaces'
                and x.discarded_at is null and x.outcome is distinct from 'cancelled')
        )
      );
    end
  $$;

-- Creating one ------------------------------------------------------------------------

-- The acting Member creates a replacement of a closed item. Outcomes: 'created' (with
-- the new item's id), 'applied' (the same key again: the same item), 'not_found' (the
-- item is hidden), 'project_closed', 'idempotency_key_reused', or
-- 'replacement_not_allowed' for every other reason alike, so nobody outside the raiser
-- learns whether a replacement stands.
create function app.create_replacement(p_work_item_id uuid, p_idempotency_key uuid, p_now timestamptz)
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

      select * into v_draft from app.latest_draft_step(v_item.work_item_type_id);
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
      insert into step_assignment (project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at)
      values (v_item.project_id, v_id, v_draft.step_id, v_item.raised_by_participant_id, v_member_id, 'claimed', v_at, v_at);
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
  $$;

revoke all on function
  app.can_create_replacement(uuid),
  app.create_replacement(uuid, uuid, timestamptz)
  from public;
grant execute on function
  app.can_create_replacement(uuid),
  app.create_replacement(uuid, uuid, timestamptz)
  to rabaed_app;
