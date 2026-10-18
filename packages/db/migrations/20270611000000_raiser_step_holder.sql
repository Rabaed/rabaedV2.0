-- RP-622 (SNAG-2, spec RP-619): the raiser as a Step holder (workflow-engine.md §3.1;
-- visibility.md V1, V3, scenarios RP-622-1 to RP-622-3).
--
-- A Step's actor rule may name the raiser instead of a role: `{"raiser": true, "permission",
-- "positions"?}`, the Participant that raised the item, whatever its role, its Step Pool still
-- holding the rule's Function Permission (app.step_pool reads only `permission` and `positions`,
-- so it is unchanged). The definition's form is `@rabaed/domain` `workflow-definition.ts`.
--
-- Two helpers say what such a rule means, and the functions comparing Steps' roles read them:
-- * app.actor_holder(rule): the holder as Steps of one Workflow are compared: the role, or
--   'raiser' as its own holder (a Step held by the raiser is the raiser's own Step, the Draft
--   Step's, whoever raises the item). app.step_edits_form, app.editable_section_keys,
--   app.revision_dropped_keys and app.publish_workflow_draft compare a Step with the Draft Step
--   so, as the publish checks and the Form Section checks do (`form-sections.ts`).
-- * app.actor_role(rule, raiser's role): the role holding a Step of one item. app.next_step_holder
--   (a Step held by the raiser is of the raiser's role, so the raiser holds it, a Send Back into
--   it included: checked first), app.sees_work_item (a Draft held by the raiser stays the
--   raiser's own until its first Submit, V1), app.can_create_revision and
--   app.can_create_replacement read it.
-- * app.create_work_item: a Draft Step held by the raiser is started by any Participant whose
--   raising Member's Positions hold its rule's Function Permission (`create`) for the Type.
-- * app.work_item_raiser_role: the item's raiser's role, for whoever sees the item, so its
--   Workflow map shows the raiser's Steps as that role's (`withRaiserRole`).
--
-- app.take_transition is unchanged (it reads no actor rule; RP-603). app.transition_follow_up_items
-- (Code B's Comments) still reads a role rule only: a Comment Workflow whose Draft names the
-- raiser is refused there, as a Draft of another role is.
--
-- Each function is rebuilt from its latest body (`pnpm db:fn`).

create function app.actor_holder(p_actor_rule jsonb) returns text
  language sql immutable
  as $$ select case when p_actor_rule ? 'raiser' then 'raiser' else p_actor_rule ->> 'base_role' end $$;

revoke all on function app.actor_holder(jsonb) from public;
grant execute on function app.actor_holder(jsonb) to rabaed_app;

create function app.actor_role(p_actor_rule jsonb, p_raiser_role text) returns text
  language sql immutable
  as $$ select case when p_actor_rule ? 'raiser' then p_raiser_role else p_actor_rule ->> 'base_role' end $$;

revoke all on function app.actor_role(jsonb, text) from public;
grant execute on function app.actor_role(jsonb, text) to rabaed_app;

-- The raiser's role on item p_work_item_id, for whoever sees it (its raiser's Company is on
-- the item for everyone who does); null otherwise.
create function app.work_item_raiser_role(p_work_item_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select r.base_role
        from work_item w
        join participant p on p.id = w.raised_by_participant_id
        join project_role r on r.id = p.project_role_id
        where w.id = p_work_item_id and app.sees_work_item(w.id)
      );
    end
  $$;

revoke all on function app.work_item_raiser_role(uuid) from public;
grant execute on function app.work_item_raiser_role(uuid) to rabaed_app;

-- From 20270429000100_own_role_steps_stay.sql: the target Step's role through app.actor_role.
create or replace function app.next_step_holder(p_work_item_id uuid, p_transition_id uuid)
  returns table (outcome text, participant_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_target record;
      v_candidates uuid[];
      v_previous uuid;
      v_actor uuid := (select me.participant_id from app.acting_project_member(p_work_item_id) me);
    begin
      select tr.to_step_id as step_id, tr.kind, app.actor_role(target.actor_rule, raiser_role.base_role) as base_role,
        target.outcome_mode as target_outcome_mode,
        w.raised_by_participant_id as raiser_id, raiser_role.base_role as raiser_base_role
      into v_target
      from work_item w
      join workflow_transition tr on tr.id = p_transition_id and tr.workflow_version_id = w.workflow_version_id
      join workflow_step target on target.id = tr.to_step_id
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      where w.id = p_work_item_id;
      if v_target.base_role is null then
        return query select 'terminal'::text, null::uuid;
        return;
      end if;

      if v_target.base_role = v_target.raiser_base_role then
        -- The raiser's own Steps stay with the raiser, never another Participant of its role (V3):
        -- a Step of its role, and a Step held by the raiser, whatever its role (RP-622), a Send
        -- Back into it included.
        if exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_target.raiser_id, v_actor)) then
          return query select 'ok'::text, v_target.raiser_id;
        else
          return query select 'no_step_pool'::text, null::uuid;
        end if;
        return;
      end if;

      -- A Step of the acting Participant's own role stays with that Participant (RP-90): a
      -- move inside it, such as a Snag's Open ⇄ In Progress ⇄ On Hold at the Contractor,
      -- never goes to another Participant of its role covering the item too (V3).
      if exists (
        select 1 from participant p join project_role r on r.id = p.project_role_id
        where p.id = v_actor and r.base_role = v_target.base_role
      ) then
        if exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_actor, v_actor)) then
          return query select 'ok'::text, v_actor;
        else
          return query select 'next_step_unavailable'::text, null::uuid;
        end if;
        return;
      end if;

      -- A Send Back goes back to the Participant that held that Step (it Submitted the
      -- item from there), never to another of its role (V3): a Comment Returned to Open
      -- reaches the Contractor that resolved it.
      if v_target.kind = 'send_back' then
        select a.participant_id into v_previous from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_target.step_id and a.status = 'done'
        order by a.done_at desc, a.id desc limit 1;
      end if;
      if v_previous is not null then
        v_candidates := array[v_previous];
      else
        -- The Owner's review (ADR 0022): an Owner Representative covering the item holds it
        -- where the Project has one, else the Owner.
        if v_target.target_outcome_mode = 'confirm_code' and v_target.base_role = 'owner' then
          select coalesce(array_agg(p.id), '{}') into v_candidates
          from work_item w
          join participant p on p.project_id = w.project_id and p.status = 'active'
          join project_role r on r.id = p.project_role_id and r.base_role = 'owner_representative'
          where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
        end if;
        if coalesce(cardinality(v_candidates), 0) = 0 then
          select coalesce(array_agg(p.id), '{}') into v_candidates
          from work_item w
          join participant p on p.project_id = w.project_id and p.status = 'active'
          join project_role r on r.id = p.project_role_id and r.base_role = v_target.base_role
          where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
        end if;
      end if;
      if cardinality(v_candidates) = 1
        and exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_candidates[1], v_actor))
      then
        return query select 'ok'::text, v_candidates[1];
      else
        return query select 'next_step_unavailable'::text, null::uuid;
      end if;
    end
  $$;

-- From 20270323000000_project_form_for_new_items.sql: a Draft Step held by the raiser asks the
-- raising Member for its rule's Function Permission instead of a role.
create or replace function app.create_work_item(
  p_project_id uuid, p_type_code text, p_title text, p_form_version_id uuid, p_data jsonb, p_trade_id uuid,
  p_location_id uuid, p_now timestamptz, p_scope_ids uuid[] default '{}'
)
  returns table (outcome text, work_item_id uuid)
  language plpgsql security definer
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
      -- A Draft held by the raiser: any Participant, its Member's Positions holding the rule's
      -- Function Permission for the Type (RP-622). Else the Draft's role.
      if v_step.actor_rule ? 'raiser' then
        if not app.project_member_has_permission(v_project_member_id, v_type.module_key, v_step.actor_rule ->> 'permission') then
          raise exception 'only a Member holding % can raise this Work Item Type', v_step.actor_rule ->> 'permission'
            using errcode = '42501';
        end if;
      elsif v_step.actor_rule ->> 'base_role' is distinct from v_base_role then
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
  $$;

-- From 20270326000000_sent_back_built_ins.sql: the current Step's role through app.actor_role,
-- so a Draft held by the raiser stays the raiser's own until its first Submit (V1).
create or replace function app.sees_work_item(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1
          from work_item w
          join project_member pm on pm.project_id = w.project_id
          join participant p on p.id = pm.participant_id
          join work_item_access a on a.work_item_id = w.id and a.participant_id = pm.participant_id
          join participant raiser on raiser.id = w.raised_by_participant_id
          join project_role raiser_role on raiser_role.id = raiser.project_role_id
          join workflow_step s on s.id = w.current_step_id
          -- Whether the reader's Participant holds it: then it reads the values as they are now.
          cross join lateral (
            select w.built_ins_as_arrived is null or exists (
              select 1 from step_assignment h
              where h.work_item_id = w.id and h.status in ('pooled', 'picked_up', 'vacant') and h.participant_id = pm.participant_id
            ) as live
          ) reads
          where w.id = p_work_item_id
            and w.project_id in (select app.current_project_ids())
            and pm.member_id = app.current_member_id() and pm.status = 'active'
            and p.status = 'active' and p.company_id = app.current_company_id()
            and (p.id = w.raised_by_participant_id or w.submitted_at is not null
              or app.actor_role(s.actor_rule, raiser_role.base_role) is distinct from raiser_role.base_role)
            and (w.document_number is not null or s.drafts_visible_to is distinct from 'author'
              or exists (
                select 1 from step_assignment h
                where h.work_item_id = w.id and h.status = 'picked_up' and h.assignee_member_id = pm.member_id))
            and not exists (
              select 1 from work_item_dimension_value dv
              where reads.live and dv.work_item_id = w.id
                and dv.dimension_value_id not in (select app.values_covered_by_project_member(pm.id, dv.dimension_id))
            )
            and not exists (
              select 1 from jsonb_each_text(w.built_ins_as_arrived -> 'dimensions') v
              where not reads.live
                and v.value::uuid not in (select app.values_covered_by_project_member(pm.id, v.key::uuid))
            )
        )
      );
    end
  $$;

-- From 20270105000000_on_workflow_core.sql: a Revision's Draft held by the raiser is the raiser's.
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
            and app.outcome_offers(w.project_id, w.work_item_type_id, w.outcome, 'offer_revision') and w.discarded_at is null
            and app.actor_role(d.actor_rule, r.base_role) = r.base_role
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

-- From 20270104000000_replace_rejected.sql: a replacement's Draft held by the raiser is the raiser's.
create or replace function app.can_create_replacement(p_work_item_id uuid) returns boolean
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
          -- The Draft Step of the Workflow a new item of its Type raised by its raiser runs.
          join workflow_step d on d.workflow_version_id = app.new_item_workflow_version(w.project_id, w.work_item_type_id, w.raised_by_participant_id)
            and app.is_draft_step(d.id)
          where w.id = p_work_item_id
            and w.closed_at is not null and w.discarded_at is null
            and app.outcome_offers(w.project_id, w.work_item_type_id, w.outcome, 'offer_replacement')
            and app.actor_role(d.actor_rule, r.base_role) = r.base_role
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

-- From 20270114000000_holder_edits_form.sql: the raiser's Steps by app.actor_holder.
create or replace function app.editable_section_keys(p_work_item_id uuid) returns setof text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_draft_holder text;
    begin
      if not app.can_save_answers(p_work_item_id) then
        return;
      end if;
      select app.actor_holder(d.actor_rule) into v_draft_holder
      from work_item w
      join workflow_step d on d.workflow_version_id = w.workflow_version_id
      where w.id = p_work_item_id and app.is_draft_step(d.id)
      limit 1;
      return query
        select s ->> 'key'
        from work_item w
        join form_version v on v.id = w.form_version_id
        join workflow_step cur on cur.id = w.current_step_id
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        where w.id = p_work_item_id
          and case when s ? 'editable_at' then (s -> 'editable_at') ? cur.key
            else app.actor_holder(cur.actor_rule) = v_draft_holder
          end;
    end
  $$;

-- From 20261108000000_plpgsql_definer_helpers.sql: the raiser's Steps by app.actor_holder.
create or replace function app.revision_dropped_keys(p_work_item_id uuid) returns text[]
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select coalesce(array_agg(f ->> 'key'), '{}')
        from work_item w
        join form_version v on v.id = w.form_version_id
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where w.id = p_work_item_id and s ? 'editable_at'
          and (
            select app.actor_holder(h.actor_rule) from workflow_step h
            where h.workflow_version_id = w.workflow_version_id and h.key = s -> 'editable_at' ->> 0
          ) is distinct from (
            select app.actor_holder(d.actor_rule) from workflow_step d
            where d.workflow_version_id = w.workflow_version_id and app.is_draft_step(d.id)
            limit 1)
      );
    end
  $$;

-- From 20270117100000_raisers_form_review_fixes.sql: the Draft Step's holder by app.actor_holder,
-- as `stepEditsForm` (workflow-checks.ts).
create or replace function app.step_edits_form(p_step_id uuid) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select coalesce(s.edits_form, exists (
          select 1 from workflow_step d
          where d.workflow_version_id = s.workflow_version_id and app.is_draft_step(d.id)
            and app.actor_holder(d.actor_rule) = app.actor_holder(s.actor_rule)
            and d.actor_rule ->> 'permission' = s.actor_rule ->> 'permission'
        ))
        from workflow_step s
        where s.id = p_step_id
      );
    end
  $$;

-- From 20270327000000_after_send_back_review_fixes.sql: the raiser's Steps by app.actor_holder,
-- as `sendBackSteps` (workflow-checks.ts).
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
      update workflow_step s set after_send_back = 'comment'
      where s.workflow_version_id = v_version.id and s.after_send_back is null
        and exists (
          select 1 from workflow_transition t
          where t.workflow_version_id = v_version.id and t.kind = 'send_back' and t.to_step_id = s.id)
        and exists (
          select 1 from workflow_step d
          where d.workflow_version_id = v_version.id and app.is_draft_step(d.id)
            and app.actor_holder(d.actor_rule) = app.actor_holder(s.actor_rule));
      update workflow_version v set status = 'published', published_at = p_at, draft_name = null, updated_at = p_at
      where v.id = v_version.id;
      if v_version.draft_name is not null then
        update workflow_definition d set name = v_version.draft_name, updated_at = p_at where d.id = p_definition_id;
      end if;
      return query select 'published'::text, v_version.id, v_version.version_no;
    end
  $$;
