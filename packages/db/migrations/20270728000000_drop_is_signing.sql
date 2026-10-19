-- RP-85 (spec RP-632; ADR 0017): the dead `workflow_step.is_signing` column is dropped. Every
-- Transition is confirmed and records the Signature in force, so there is no signing Step.
-- app.workflow_version_step_rows and app.insert_workflow_rows, as
-- 20270210000000_after_send_back.sql left them, without the column.

create or replace function app.workflow_version_step_rows(p_version_id uuid) returns jsonb
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', s.key, 'name', s.name, 'stage_key', s.stage_key, 'actor_rule', s.actor_rule,
          'outcome_mode', s.outcome_mode)
          || case when s.edits_form is null then '{}'::jsonb else jsonb_build_object('edits_form', s.edits_form) end
          || case when s.drafts_visible_to is null then '{}'::jsonb
            else jsonb_build_object('drafts_visible_to', s.drafts_visible_to) end
          || case when s.after_send_back is null then '{}'::jsonb
            else jsonb_build_object('after_send_back', s.after_send_back) end
          order by s.created_at, s.key)
        from workflow_step s where s.workflow_version_id = p_version_id), '[]'::jsonb);
    end
  $$;

create or replace function app.insert_workflow_rows(p_version_id uuid, p_steps jsonb, p_transitions jsonb, p_at timestamptz) returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_count integer;
    begin
      insert into workflow_step (
        workflow_version_id, key, name, stage_key, actor_rule, outcome_mode, edits_form, drafts_visible_to,
        after_send_back, created_at
      )
      select p_version_id, e.s ->> 'key', e.s -> 'name', e.s ->> 'stage_key', coalesce(e.s -> 'actor_rule', '{}'),
        e.s ->> 'outcome_mode', (e.s ->> 'edits_form')::boolean, e.s ->> 'drafts_visible_to', e.s ->> 'after_send_back',
        -- In the order given, which the draft's read keeps.
        p_at + make_interval(secs => e.ord / 1000000.0)
      from jsonb_array_elements(p_steps) with ordinality as e (s, ord);
      insert into workflow_transition (
        workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form,
        screen_key, rules, actions, notifications, created_at
      )
      select p_version_id, e.t ->> 'key', f.id, s.id, e.t -> 'label', e.t ->> 'kind', e.t ->> 'outcome', e.t ->> 'permission',
        coalesce((e.t ->> 'sort')::integer, e.ord::integer), nullif(e.t -> 'action_form', 'null'::jsonb),
        e.t ->> 'screen_key',
        nullif(e.t -> 'rules', 'null'::jsonb), nullif(e.t -> 'actions', 'null'::jsonb), nullif(e.t -> 'notifications', 'null'::jsonb),
        p_at
      from jsonb_array_elements(p_transitions) with ordinality as e (t, ord)
      join workflow_step f on f.workflow_version_id = p_version_id and f.key = e.t ->> 'from_step_key'
      join workflow_step s on s.workflow_version_id = p_version_id and s.key = e.t ->> 'to_step_key';
      get diagnostics v_count = row_count;
      if v_count <> jsonb_array_length(p_transitions) then
        raise exception 'store_workflow_draft: a Transition lost its Steps';
      end if;
    end
  $$;

alter table workflow_step drop column is_signing;
