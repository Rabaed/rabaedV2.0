-- Review fix of spec RP-423 (RP-449; CODING_STANDARDS, Duplicated Code): the block
-- that writes a Form's answers and records the change, copied from
-- app.save_work_item_answers into app.transition_actions (RP-431, WF-8), becomes one
-- helper both call, app.write_work_item_answers. Behaviour is unchanged: the answers
-- as they arrived kept for everyone else (V19), Link answers synced, and once the item
-- has left Draft an answers_changed event internal to the writer's Participant (V5)
-- whose content hash covers the answers.

-- Writes `p_data` as item `p_work_item_id`'s answers at `p_at`, by the acting Member of
-- Participant `p_participant_id`; `p_before` is the full answers before
-- (app.work_item_full_answers).
create function app.write_work_item_answers(
  p_work_item_id uuid, p_project_id uuid, p_form_version_id uuid, p_participant_id uuid,
  p_before jsonb, p_data jsonb, p_at timestamptz
) returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_after jsonb;
      v_recorded_before jsonb;
      v_recorded_after jsonb;
      v_changes jsonb;
    begin
      update work_item set
        data = p_data,
        -- Everyone but the holder goes on reading the answers as they arrived (V19).
        data_as_arrived = coalesce(data_as_arrived, p_before),
        updated_at = p_at
      where id = p_work_item_id;
      perform app.sync_link_answers(p_work_item_id, p_project_id, p_form_version_id, p_data, p_at);

      -- Once it has left Draft, every change is on the record (a Draft it was
      -- Returned to included), inside the writer's Participant (V5, V19).
      if exists (
        select 1 from work_item_event e
        where e.work_item_id = p_work_item_id and e.type = 'transition' and app.is_draft_step(e.from_step_id)
      ) then
        v_after := app.work_item_full_answers(p_work_item_id);
        v_recorded_before := app.link_answers_recorded(p_form_version_id, p_before);
        v_recorded_after := app.link_answers_recorded(p_form_version_id, v_after);
        select jsonb_agg(jsonb_build_object('field', k, 'old', v_recorded_before -> k, 'new', v_recorded_after -> k) order by k)
        into v_changes
        from (select jsonb_object_keys(p_before) union select jsonb_object_keys(v_after)) as keys (k)
        where (v_recorded_before -> k) is distinct from (v_recorded_after -> k);
        if v_changes is not null then
          insert into work_item_event (
            project_id, work_item_id, type, actor_member_id, actor_participant_id, payload,
            audience, audience_participant_id, content_sha256, created_at
          ) values (
            p_project_id, p_work_item_id, 'answers_changed', app.current_member_id(), p_participant_id,
            jsonb_build_object('changes', v_changes), 'internal', p_participant_id,
            sha256(convert_to(v_after::text, 'UTF8')), p_at
          );
        end if;
      end if;
    end
  $$;
revoke all on function app.write_work_item_answers(uuid, uuid, uuid, uuid, jsonb, jsonb, timestamptz) from public;

-- As in 20261030000000_consultant_section.sql, writing through app.write_work_item_answers.
create or replace function app.save_work_item_answers(
  p_work_item_id uuid, p_data jsonb, p_trade_id uuid, p_location_id uuid, p_scope_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_built_ins constant text[] := array['trade', 'location', 'scopes'];
      v_item record;
      v_me record;
      v_outcome text;
      v_locked text[];
      v_given jsonb;
      v_seen jsonb;
      v_data jsonb;
      v_before jsonb;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- Locked, so a Transition onwards checks exactly the answers it moves with.
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
      if not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;

      -- A section not editable now comes back as the saver reads it, or nothing is saved.
      v_locked := app.locked_field_keys(p_work_item_id);
      v_seen := app.work_item_answers(p_work_item_id);
      v_given := coalesce(p_data, '{}') - v_built_ins || jsonb_strip_nulls(jsonb_build_object(
        'trade', p_trade_id, 'location', p_location_id,
        'scopes', case when cardinality(p_scope_ids) > 0 then to_jsonb(p_scope_ids) end));
      if exists (
        select 1 from unnest(v_locked) k
        where app.answer_canonical(v_given -> k) is distinct from app.answer_canonical(v_seen -> k)
      ) then
        return 'not_editable';
      end if;

      if not (v_locked && v_built_ins) then
        v_outcome := app.check_work_item_built_ins(
          p_work_item_id, v_item.project_id, v_me.project_member_id, p_trade_id, p_location_id, p_scope_ids);
        if v_outcome <> 'ok' then
          return v_outcome;
        end if;
      end if;
      v_before := app.work_item_full_answers(p_work_item_id);
      v_data := app.resolve_link_answers(
        p_work_item_id, v_item.project_id, v_item.form_version_id, v_before, coalesce(p_data, '{}') - v_built_ins - v_locked);
      if v_data is null then
        return 'target_not_found';
      end if;
      -- The locked fields as stored: what the saver read may lack a reference stripped from it.
      v_data := v_data || coalesce((
        select jsonb_object_agg(k, v_item.data -> k) from unnest(v_locked) k where v_item.data ? k), '{}');
      if not (v_locked && v_built_ins) then
        perform app.set_work_item_built_ins(p_work_item_id, v_item.project_id, p_trade_id, p_location_id, p_scope_ids);
      end if;
      perform app.write_work_item_answers(
        p_work_item_id, v_item.project_id, v_item.form_version_id, v_me.participant_id, v_before, v_data, v_at);
      return 'saved';
    end
  $$;

-- As in 20261231000000_transition_actions.sql, writing through app.write_work_item_answers.
create or replace function app.transition_actions(p_work_item_id uuid, p_transition_id uuid, p_answers jsonb, p_at timestamptz)
  returns table(refusal text, answers jsonb)
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_transition record;
      v_item record;
      v_me record;
      v_answers jsonb := coalesce(p_answers, '{}');
      v_action_form_types jsonb;
      v_form_types jsonb;
      v_reads jsonb;
      v_changes jsonb := '{}';
      v_action jsonb;
      v_to text;
      v_from text;
      v_type text;
      v_value jsonb;
      v_data jsonb;
      v_before jsonb;
    begin
      select tr.actions, tr.kind, tr.action_form into v_transition from workflow_transition tr where tr.id = p_transition_id;
      if not exists (
        select 1 from jsonb_array_elements(coalesce(v_transition.actions, '[]')) a where a.value ->> 'type' <> 'offer_assign_to')
      then
        return query select null::text, v_answers;
        return;
      end if;
      select w.id, w.project_id, w.form_version_id, w.data into v_item from work_item w where w.id = p_work_item_id;
      select * into v_me from app.acting_project_member(p_work_item_id);
      -- What may be written, by key and type: the Action Form's fields, and those of
      -- the Form Sections the acting Member may change now (none unless they may save).
      select coalesce(jsonb_object_agg(f ->> 'key', f ->> 'type'), '{}') into v_action_form_types
      from jsonb_array_elements(coalesce(v_transition.action_form -> 'sections', '[]')) s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      where f ->> 'type' <> 'calculated';
      select coalesce(jsonb_object_agg(f ->> 'key', f ->> 'type'), '{}') into v_form_types
      from form_version v
      cross join lateral jsonb_array_elements(v.schema -> 'sections') s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      where v.id = v_item.form_version_id
        and f ->> 'type' not in ('calculated', 'trade', 'location', 'scopes')
        and (s ->> 'key') in (select app.editable_section_keys(p_work_item_id));
      -- The Form as the actor reads it, for a copy: only its own fields are read.
      v_reads := app.work_item_answers(p_work_item_id);

      for v_action in select a.value from jsonb_array_elements(v_transition.actions) a loop
        continue when v_action ->> 'type' = 'offer_assign_to';
        if v_action ->> 'type' = 'set_field' then
          v_to := v_action ->> 'field';
          v_type := coalesce(v_action_form_types ->> v_to, v_form_types ->> v_to);
          if jsonb_typeof(v_action -> 'value') = 'object' then
            v_value := case when v_action -> 'value' = '{"now": true}' then app.moment_answer(v_type, p_at) end;
          elsif v_type <> 'member' then
            v_value := v_action -> 'value';
          else
            v_value := null;
          end if;
          if v_type is null or v_value is null then
            return query select 'action_not_allowed'::text, null::jsonb;
            return;
          end if;
        elsif v_action ->> 'type' = 'copy_field' then
          v_from := v_action ->> 'from';
          v_to := v_action ->> 'to';
          if v_action_form_types ? v_from then
            -- An internal move's Action Form answers stay inside its Participant (V5).
            if not v_action_form_types ? v_to and v_transition.kind in ('send', 'return') then
              return query select 'action_not_allowed'::text, null::jsonb;
              return;
            end if;
            v_value := v_answers -> v_from;
          elsif v_form_types ? v_from then
            v_value := case when v_changes ? v_from then v_changes -> v_from else v_reads -> v_from end;
          else
            return query select 'action_not_allowed'::text, null::jsonb;
            return;
          end if;
          if not (v_action_form_types ? v_to or v_form_types ? v_to) then
            return query select 'action_not_allowed'::text, null::jsonb;
            return;
          end if;
          v_value := coalesce(v_value, 'null');
        else
          return query select 'action_not_allowed'::text, null::jsonb;
          return;
        end if;
        if v_action_form_types ? v_to then
          v_answers := case when v_value = 'null' then v_answers - v_to else v_answers || jsonb_build_object(v_to, v_value) end;
        else
          v_changes := v_changes || jsonb_build_object(v_to, v_value);
        end if;
      end loop;

      if v_changes = '{}' then
        return query select null::text, v_answers;
        return;
      end if;
      -- Saved as Save draft saves (app.write_work_item_answers), with field times.
      v_before := app.work_item_full_answers(p_work_item_id);
      v_data := (v_item.data - array(select k from jsonb_each(v_changes) c (k, v) where v = 'null'))
        || coalesce((select jsonb_object_agg(k, v) from jsonb_each(v_changes) c (k, v) where v <> 'null'), '{}');
      perform app.write_work_item_answers(
        p_work_item_id, v_item.project_id, v_item.form_version_id, v_me.participant_id, v_before, v_data, p_at);
      perform app.record_field_times(p_work_item_id, p_at);
      return query select null::text, v_answers;
    end
  $$;
