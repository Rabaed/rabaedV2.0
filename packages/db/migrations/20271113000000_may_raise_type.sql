-- RP-1089: one "may this Member raise an item of this Type" rule, app.may_raise_type, the Draft
-- Step's actor rule. It was written out in app.create_work_item, app.register_import_type_raisable,
-- app.can_create_revision and app.can_create_replacement, and getRaisableTypes (the api's "+ New")
-- checked the role only, so it offered a Draft held by the raiser to a Member whose Positions lack
-- its permission, and app.create_work_item then refused it (42501).
--
-- Each function below is its latest body, the rule replaced by the call, and nothing else changed:
--   app.create_work_item               from 20270705000000_comment_not_raised_directly.sql
--   app.register_import_type_raisable  from 20270921000000_register_import_type_raisable_workflow.sql
--   app.can_create_revision            from 20270611000000_raiser_step_holder.sql
--   app.can_create_replacement         from 20270611000000_raiser_step_holder.sql
-- A Revision and a replacement still also ask that the Member's Positions hold the Draft's
-- permission whoever holds the Draft (docs/workflow-engine.md §5.4, "role and permission").

-- Whether the Project Member `p_project_member_id` may raise an item of the Type `p_type_id` on
-- the Workflow Version `p_workflow_version_id`, by its Draft Step's actor rule (app.is_draft_step):
-- a Draft held by the raiser (RP-622) asks that the Member's Positions hold the rule's Function
-- Permission for the Type's Module; any other Draft that the base role of the Member's Participant
-- is the rule's role. False when one of them isn't found. Any Project Member: the register import
-- asks it of the Members it assigns rows to (app.register_import_type_raisable), so no role but
-- the owner runs it, as app.project_member_has_permission; the app role asks through
-- app.raisable_type_ids, for its own Member only.
create function app.may_raise_type(p_project_member_id uuid, p_type_id uuid, p_workflow_version_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return coalesce((
        select case
          when s.actor_rule ? 'raiser' then app.project_member_has_permission(pm.id, t.module_key, s.actor_rule ->> 'permission')
          else s.actor_rule ->> 'base_role' = r.base_role
        end
        from project_member pm
        join participant p on p.id = pm.participant_id
        join project_role r on r.id = p.project_role_id
        join work_item_type t on t.id = p_type_id
        join workflow_step s on s.workflow_version_id = p_workflow_version_id and app.is_draft_step(s.id)
        where pm.id = p_project_member_id
      ), false);
    end
  $$;
revoke all on function app.may_raise_type(uuid, uuid, uuid) from public;

-- "+ New" (getRaisableTypes): the Rabaed Types of the Module `p_module_key` the acting Member may
-- raise on the Project, through their own active Project Member there: a Type raised from an item
-- only (a Comment) never, and else app.may_raise_type on the Workflow a new item of it raised by
-- their Participant runs (app.new_item_workflow_version), as app.create_work_item asks it.
create function app.raisable_type_ids(p_project_id uuid, p_module_key text) returns table (work_item_type_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select t.id
        from work_item_type t
        cross join project_member pm
        join participant p on p.id = pm.participant_id
        where t.owner_kind = 'rabaed' and t.module_key = p_module_key and not t.raised_from_item_only
          and pm.project_id = p_project_id and pm.member_id = app.current_member_id() and pm.status = 'active'
          and p_project_id in (select app.current_project_ids())
          and pm.participant_id in (select app.current_participant_ids())
          and p.status = 'active' and p.company_id = app.current_company_id()
          and exists (
            -- A Workflow the Member reads (workflow_definition's policy, said again, as the api's
            -- draftOf does): a Rabaed Default, or one of their Projects' own (RP-657).
            select 1 from workflow_version v
            join workflow_definition d on d.id = v.workflow_definition_id
            where v.id = app.new_item_workflow_version(p_project_id, t.id, pm.participant_id)
              and (d.owner_kind = 'rabaed' or (d.owner_kind = 'project' and d.project_id in (select app.current_project_ids())))
              and app.may_raise_type(pm.id, t.id, v.id));
    end
  $$;
revoke all on function app.raisable_type_ids(uuid, text) from public;
grant execute on function app.raisable_type_ids(uuid, text) to rabaed_app;

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
      v_type record;
      v_version_id uuid;
      v_step record;
      v_item_id uuid;
      v_outcome text;
    begin
      select pm.id, pm.participant_id into v_project_member_id, v_participant_id
      from project_member pm
      join participant p on p.id = pm.participant_id
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

      select t.id, t.module_key, t.workflow_definition_id, t.raised_from_item_only into v_type
      from work_item_type t where t.owner_kind = 'rabaed' and t.code = p_type_code;
      -- A Type created only from another item (a Comment) is nobody's to raise directly.
      if v_type.id is null or v_type.raised_from_item_only then
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
      -- The Draft Step's actor rule, app.may_raise_type (RP-1089): a Draft held by the raiser asks
      -- for the rule's Function Permission (RP-622), any other Draft for its role.
      if not app.may_raise_type(v_project_member_id, v_type.id, v_version_id) then
        if v_step.actor_rule ? 'raiser' then
          raise exception 'only a Member holding % can raise this Work Item Type', v_step.actor_rule ->> 'permission'
            using errcode = '42501';
        end if;
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

-- p_participant_id and p_base_role are kept so the signature (and register_import_raisable_types'
-- call) stays as it is; the base role is the one of p_project_member_id's Participant.
create or replace function app.register_import_type_raisable(
  p_project_id uuid, p_type_id uuid, p_type_code text, p_participant_id uuid, p_project_member_id uuid, p_base_role text
) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.new_item_form_version(p_project_id, p_type_code) is not null
        and exists (
          select 1 from workflow_step s
          join workflow_version v on v.id = s.workflow_version_id
          join workflow_definition d on d.id = v.workflow_definition_id
          where s.workflow_version_id = app.new_item_workflow_version(p_project_id, p_type_id, p_participant_id)
            and (d.owner_kind = 'rabaed' or (d.owner_kind = 'project' and d.project_id = p_project_id))
            and app.is_draft_step(s.id)
            and app.may_raise_type(p_project_member_id, p_type_id, s.workflow_version_id)
        );
    end
  $$;

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
          join app.revision_draft_step(w.id) d on true
          where w.id = p_work_item_id
            and app.outcome_offers(w.project_id, w.work_item_type_id, w.outcome, 'offer_revision') and w.discarded_at is null
            and app.may_raise_type(me.project_member_id, w.work_item_type_id, d.workflow_version_id)
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
          -- The Draft Step of the Workflow a new item of its Type raised by its raiser runs.
          join workflow_step d on d.workflow_version_id = app.new_item_workflow_version(w.project_id, w.work_item_type_id, w.raised_by_participant_id)
            and app.is_draft_step(d.id)
          where w.id = p_work_item_id
            and w.closed_at is not null and w.discarded_at is null
            and app.outcome_offers(w.project_id, w.work_item_type_id, w.outcome, 'offer_replacement')
            and app.may_raise_type(me.project_member_id, w.work_item_type_id, d.workflow_version_id)
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
