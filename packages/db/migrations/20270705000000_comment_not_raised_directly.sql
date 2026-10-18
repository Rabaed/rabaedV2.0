-- RP-668: a Comment is not raised directly. By the glossary a Comment comes only from a Code B
-- (or a Passed with Comments Inspection), as a follow-up item `raised_from` its source; the
-- Snag List's "+ New" offered it to the Consultant because the CMT Workflow's Draft Step is the
-- Consultant's.
--
-- * work_item_type.raised_from_item_only marks a Type created only from another item. The
--   Rabaed Default CMT is the one. The Code B path (app.transition_follow_up_items) inserts
--   its items itself and is unaffected.
-- * app.create_work_item, as 20270611000000_raiser_step_holder.sql left it, refuses such a Type
--   as it does a Type that is not there (`type_not_found`); one added check, nothing else changed.

alter table work_item_type add column raised_from_item_only boolean not null default false;
update work_item_type set raised_from_item_only = true where owner_kind = 'rabaed' and code = 'CMT';

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
