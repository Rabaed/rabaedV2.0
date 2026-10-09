-- An outcome's code, closing and polarity are editable while it is unused (RP-429, WF-6;
-- decided 2026-10-09; workflow-engine.md §1 "Outcomes"; data-model.md outcome).
--
-- A Project Admin may change an outcome's code, whether it closes the item, and
-- positive/negative only while no published Workflow Version the Project's items can
-- run names it (app.outcome_in_use); once used, only its names, follow-up actions and
-- order change, as before. Refused 'outcome_in_use' (the api: 409 with an English and
-- Arabic message), audited in project_event like the other outcome commands.
--
-- "Used" is read from definitions only, never from items. Whether an item of the
-- Project closed with the outcome is not asked: closed items past Draft are on the
-- Documental Record of their Participants only, so a Project Admin whose Company was
-- never on an item would learn from the refusal that a hidden item closed with that
-- outcome (CODING_STANDARDS, Visibility: number and count only what the viewer sees).
-- Nothing is lost by it: an item's outcome is only ever set by a closing Transition of
-- the published Version it runs (app.take_transition; work_item_outcome_in_set keeps
-- it to the set), and every Version the Project's items can run is counted here:
-- the Project's own Workflows, the Rabaed Defaults for the Type, the Type's own default
-- Workflow, and every Workflow the Project ever bound the Type to
-- (workflow_binding_history). So no item can have closed with an unused outcome.
-- (`cancelled` is in no set.) Every Member of the Project reads these definitions
-- (ADR 0016), so the answer depends on nothing the Project Admin can't see.

-- Whether outcome `p_code` of Type `p_type_id` is named by a closing Transition of a
-- published Workflow Version the items of Project `p_project_id` can run.
create function app.outcome_in_use(p_project_id uuid, p_type_id uuid, p_code text) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from workflow_transition tr
        join workflow_version v on v.id = tr.workflow_version_id and v.status = 'published'
        join workflow_definition d on d.id = v.workflow_definition_id
        where tr.outcome = p_code
          and (
            (app.workflow_type(d.id) = p_type_id and (d.owner_kind = 'rabaed' or d.project_id = p_project_id))
            or d.id = (select t.workflow_definition_id from work_item_type t where t.id = p_type_id)
            or d.id in (
              select h.workflow_definition_id from workflow_binding_history h
              where h.project_id = p_project_id and h.work_item_type_id = p_type_id)
          )
      );
    end
  $$;
revoke all on function app.outcome_in_use(uuid, uuid, text) from public;

-- As in 20270102000000_outcome_sets.sql, with the outcome's code, closing and polarity
-- (null: kept) changeable while it is unused.
-- Outcome: 'changed'; 'not_found' (also a code the set doesn't have); 'project_closed';
-- 'invalid_outcome'; 'outcome_in_use' (a change of code, closing or polarity of a used
-- outcome); 'outcome_exists' (a new code the set has).
drop function app.change_outcome(uuid, text, text, jsonb, jsonb);
create function app.change_outcome(
  p_project_id uuid, p_type_code text, p_code text, p_name jsonb, p_actions jsonb,
  p_new_code text default null, p_closing boolean default null, p_polarity text default null
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_type uuid := app.project_type_id(p_project_id, p_type_code);
      v_refusal text := app.outcome_command_refusal(p_project_id, v_type);
      v_outcome outcome;
      v_code text;
      v_closing boolean;
      v_polarity text;
      v_redefined boolean;
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      select * into v_outcome from outcome where project_id = p_project_id and work_item_type_id = v_type and code = p_code;
      if v_outcome.id is null then
        return 'not_found';
      end if;
      v_code := coalesce(p_new_code, v_outcome.code);
      v_closing := coalesce(p_closing, v_outcome.closing);
      v_polarity := coalesce(p_polarity, v_outcome.polarity);
      if not coalesce(app.is_bilingual(p_name), false) or not coalesce(app.is_outcome_actions(p_actions), false)
        or not coalesce(app.is_outcome_code(v_code), false) or v_polarity not in ('positive', 'negative')
      then
        return 'invalid_outcome';
      end if;
      v_redefined := (v_code, v_closing, v_polarity) is distinct from (v_outcome.code, v_outcome.closing, v_outcome.polarity);
      if v_redefined and app.outcome_in_use(p_project_id, v_type, v_outcome.code) then
        return 'outcome_in_use';
      end if;
      if v_code <> v_outcome.code and exists (
        select 1 from outcome where project_id = p_project_id and work_item_type_id = v_type and code = v_code)
      then
        return 'outcome_exists';
      end if;
      p_name := jsonb_build_object('en', trim(p_name ->> 'en'), 'ar', trim(p_name ->> 'ar'));
      update outcome set name = p_name, actions = p_actions, code = v_code, closing = v_closing, polarity = v_polarity, updated_at = now()
      where id = v_outcome.id;
      perform app.write_project_event(p_project_id, 'outcome_changed', jsonb_build_object(
        'type', p_type_code, 'code', p_code,
        'from', jsonb_build_object('name', v_outcome.name, 'actions', v_outcome.actions)
          || case when v_redefined then jsonb_build_object(
            'code', v_outcome.code, 'closing', v_outcome.closing, 'polarity', v_outcome.polarity) else '{}'::jsonb end,
        'to', jsonb_build_object('name', p_name, 'actions', p_actions)
          || case when v_redefined then jsonb_build_object(
            'code', v_code, 'closing', v_closing, 'polarity', v_polarity) else '{}'::jsonb end));
      return 'changed';
    end
  $$;
revoke all on function app.change_outcome(uuid, text, text, jsonb, jsonb, text, boolean, text) from public;
grant execute on function app.change_outcome(uuid, text, text, jsonb, jsonb, text, boolean, text) to rabaed_app;
