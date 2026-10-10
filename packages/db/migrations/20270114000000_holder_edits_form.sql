-- Only the Step's holder edits the raiser's Form, never after the first Submit (Send
-- Back excepted); the Draft Step setting "Drafts visible to" (RP-514, spec RP-511
-- decision 4; ADR 0019; form-engine.md §4; workflow-engine.md §1; visibility.md V1,
-- scenario RP-514-1).
--
-- * workflow_step.edits_form: whether the raiser's Form is edited at the Step. Null
--   (every Version published before this) is the default: a Step of the Draft Step's
--   Participant role held with the Draft Step's Function Permission (the author's:
--   the Draft, and the Contractor Engineer Step), never the internal reviewer's.
--   app.step_edits_form reads it; @rabaed/domain's stepEditsForm says the same.
--   Publishing refuses one at or after a Submit, except at a raiser's Step a
--   `send_back` leads to (form_edited_after_submit, workflow-checks.ts).
-- * workflow_step.drafts_visible_to: on the Draft Step, `company` (null: the default,
--   as before) or `author`. Under `author`, a Draft (an item that never left its Draft
--   Step: no Document Number) is seen only by the Member holding it (app.sees_work_item);
--   the Authorized Person's Handover lists it by its Step and Project, as any item they
--   don't see (RP-108-2), and hands it over. Other Companies never see a Draft (V1).
-- * app.can_save_answers: the raiser's answers are saved only by the Member holding
--   the current assignment (picked up), at a Step that edits the Form, while the item
--   was never Submitted, or after a Send Back while it is back with the raiser (its
--   current assignment the raiser's). Pooled or vacant: nobody. Another Participant's
--   Form Sections (`editable_at`, ADR 0013) keep their rule until RP-516 retires them.
-- * app.editable_section_keys: the raiser's sections wherever it may save (not only
--   when the item entered its Participant at the Draft), so a Send Back to a raiser
--   Step other than the Draft reopens them.
-- * app.workflow_version_rows and app.store_workflow_draft carry both columns, each
--   only when set, so authoring, the CLI and a copy keep them.
--
-- Rebuilt from their latest bodies: app.can_save_answers (20270110000000_pick_up_rename.sql),
-- app.editable_section_keys (20261103000000_answer_permission_speed.sql), app.sees_work_item
-- (20261110000000_sent_back_as_it_was.sql), app.workflow_version_rows and
-- app.store_workflow_draft (20270105000000_on_workflow_core.sql).

alter table workflow_step
  add column edits_form boolean,
  add column drafts_visible_to text check (drafts_visible_to in ('company', 'author'));

-- Whether the raiser's Form is edited at a Step --------------------------------------------

-- Its `edits_form`, else the default: a Step of the Draft Step's role held with the
-- Draft Step's Function Permission (the Draft Step itself included).
create function app.step_edits_form(p_step_id uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select coalesce(s.edits_form, exists (
      select 1 from workflow_step d
      where d.workflow_version_id = s.workflow_version_id and app.is_draft_step(d.id)
        and d.actor_rule ->> 'base_role' = s.actor_rule ->> 'base_role'
        and d.actor_rule ->> 'permission' = s.actor_rule ->> 'permission'
    ))
    from workflow_step s
    where s.id = p_step_id
  $$;

revoke all on function app.step_edits_form(uuid) from public;

-- Who may save -------------------------------------------------------------------------

-- As in the pick_up_rename migration, with the raiser's rule replaced: the holder only,
-- at a Step that edits the Form, before the first Submit or back after a Send Back.
create or replace function app.can_save_answers(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return false;
      end if;
      select w.id, w.project_id, w.raised_by_participant_id, w.current_step_id, w.form_version_id,
        w.submitted_at, a.participant_id as holder_participant_id, a.status as holder_status,
        a.assignee_member_id as holder_member_id
      into v_item
      from work_item w
      join project pr on pr.id = w.project_id and pr.status = 'active'
      left join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
      where w.id = p_work_item_id and w.closed_at is null;
      if v_item.id is null then
        return false;
      end if;
      -- The raiser's Form: its Member holding the Step (never pooled), where the Workflow
      -- lets the Form be edited, before the first Submit or while a Send Back has it back
      -- (publishing lets no Step at or after a Submit edit, but a Send Back's).
      if v_item.holder_participant_id = v_item.raised_by_participant_id then
        return v_item.holder_status = 'picked_up' and v_item.holder_member_id = app.current_member_id()
          and app.step_edits_form(v_item.current_step_id)
          and exists (
            select 1 from project_member pm
            join participant p on p.id = pm.participant_id
            where pm.project_id = v_item.project_id and pm.member_id = app.current_member_id()
              and pm.status = 'active' and p.status = 'active' and p.company_id = app.current_company_id()
              and pm.participant_id = v_item.raised_by_participant_id
          );
      end if;
      -- Another Participant holding a Step a Form Section names (app.answers_held; ADR 0013,
      -- to retire with ADR 0019).
      return exists (
        select 1 from project_member pm
        join participant p on p.id = pm.participant_id
        where pm.project_id = v_item.project_id and pm.member_id = app.current_member_id()
          and pm.status = 'active' and p.status = 'active' and p.company_id = app.current_company_id()
          and pm.participant_id = v_item.holder_participant_id
          and pm.participant_id <> v_item.raised_by_participant_id
      ) and exists (
        select 1 from form_version v
        join workflow_step cur on cur.id = v_item.current_step_id
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        where v.id = v_item.form_version_id and (s -> 'editable_at') ? cur.key
      );
    end
  $$;

-- As in the answer_permission_speed migration, the raiser's sections wherever it may
-- save: where it may save, another Participant's Step is never the Draft Step's role.
create or replace function app.editable_section_keys(p_work_item_id uuid) returns setof text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_draft_role text;
    begin
      if not app.can_save_answers(p_work_item_id) then
        return;
      end if;
      select d.actor_rule ->> 'base_role' into v_draft_role
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
            else cur.actor_rule ->> 'base_role' = v_draft_role
          end;
    end
  $$;

-- V1 and "Drafts visible to" -----------------------------------------------------------

-- As in the sent_back_as_it_was migration, and a Draft whose Draft Step is visible to
-- its author only is seen by the Member holding it alone.
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
          where w.id = p_work_item_id
            and w.project_id in (select app.current_project_ids())
            and pm.member_id = app.current_member_id() and pm.status = 'active'
            and p.status = 'active' and p.company_id = app.current_company_id()
            and (p.id = w.raised_by_participant_id or w.submitted_at is not null
              or s.actor_rule ->> 'base_role' is distinct from raiser_role.base_role)
            and (w.document_number is not null or s.drafts_visible_to is distinct from 'author'
              or exists (
                select 1 from step_assignment h
                where h.work_item_id = w.id and h.status = 'picked_up' and h.assignee_member_id = pm.member_id))
            and not exists (
              select 1 from work_item_dimension_value dv
              where dv.work_item_id = w.id
                and dv.dimension_value_id not in (select app.values_covered_by_project_member(pm.id, dv.dimension_id))
            )
        )
      );
    end
  $$;

-- A Version's rows, with a Step's edits_form and drafts_visible_to -----------------------

-- As in the on_workflow_core migration, each Step column only when it is set.
create or replace function app.workflow_version_rows(p_version_id uuid)
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
              'is_signing', s.is_signing, 'outcome_mode', s.outcome_mode)
              || case when s.edits_form is null then '{}'::jsonb else jsonb_build_object('edits_form', s.edits_form) end
              || case when s.drafts_visible_to is null then '{}'::jsonb
                else jsonb_build_object('drafts_visible_to', s.drafts_visible_to) end
              order by s.created_at, s.key)
            from workflow_step s where s.workflow_version_id = v.id), '[]'::jsonb),
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'key', t.key, 'from_step_key', f.key, 'to_step_key', s.key, 'label', t.label, 'kind', t.kind,
              'outcome', t.outcome, 'permission', t.permission, 'sort', t.sort, 'action_form', t.action_form)
              -- Each only when the Transition has it, as @rabaed/domain's rows have them.
              || case when t.rules is null then '{}'::jsonb else jsonb_build_object('rules', t.rules) end
              || case when t.actions is null then '{}'::jsonb else jsonb_build_object('actions', t.actions) end
              || case when t.notifications is null then '{}'::jsonb else jsonb_build_object('notifications', t.notifications) end
              order by t.sort, t.key)
            from workflow_transition t
            join workflow_step f on f.id = t.from_step_id
            join workflow_step s on s.id = t.to_step_id
            where t.workflow_version_id = v.id), '[]'::jsonb)
        from workflow_version v
        where v.id = p_version_id;
    end
  $$;

-- As in the on_workflow_core migration, storing a Step's edits_form and drafts_visible_to
-- (null when its row leaves them out).
create or replace function app.store_workflow_draft(
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
        or exists (
          select 1 from jsonb_array_elements(p_steps) s
          where jsonb_typeof(s -> 'edits_form') not in ('boolean', 'null')
             or coalesce(s ->> 'drafts_visible_to', 'company') not in ('company', 'author'))
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

      insert into workflow_step (
        workflow_version_id, key, name, stage_key, actor_rule, is_signing, outcome_mode, edits_form, drafts_visible_to, created_at
      )
      select v_version_id, e.s ->> 'key', e.s -> 'name', e.s ->> 'stage_key', coalesce(e.s -> 'actor_rule', '{}'), false,
        e.s ->> 'outcome_mode', (e.s ->> 'edits_form')::boolean, e.s ->> 'drafts_visible_to',
        -- In the order given, which the draft's read keeps.
        p_at + make_interval(secs => e.ord / 1000000.0)
      from jsonb_array_elements(p_steps) with ordinality as e (s, ord);
      insert into workflow_transition (
        workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form,
        rules, actions, notifications, created_at
      )
      select v_version_id, e.t ->> 'key', f.id, s.id, e.t -> 'label', e.t ->> 'kind', e.t ->> 'outcome', e.t ->> 'permission',
        coalesce((e.t ->> 'sort')::integer, e.ord::integer), nullif(e.t -> 'action_form', 'null'::jsonb),
        nullif(e.t -> 'rules', 'null'::jsonb), nullif(e.t -> 'actions', 'null'::jsonb), nullif(e.t -> 'notifications', 'null'::jsonb),
        p_at
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
