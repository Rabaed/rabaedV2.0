-- Transition actions at run time: "Assign to" among the actor's own Participant's
-- Members, set a field, copy a field (RP-431, WF-8; spec RP-423; workflow-engine.md
-- §1 "Definition format", §3.3, §5.1; visibility.md "Refusals of a Transition",
-- scenarios RP-431-1 and RP-431-2).
--
-- * workflow_transition.actions: a Transition's actions as the definition format
--   has them (workflow-definition.ts `actions`), null when it has none. Published
--   Versions keep null: adding the column changes no row, so the frozen-Version
--   guard (RP-424) has nothing to refuse.
-- * "Assign to" (offer_assign_to): app.assignees_offered is the one rule. The
--   Members offered are the next Step's Step Pool (app.step_pool: Positions with
--   its permission, Visibility covering the item) when the next Step is held by
--   the actor's own Participant, else nobody: never another Company's Members.
--   app.transition_assignees gives the API that list for a Transition key.
--   take_transition takes the pick as `p_assign_to` (§3.3, rule 2: after the
--   holder coming back by a Return or a Send Back): a pick it couldn't have offered
--   (another Company's Member, a Member without the Position or the Visibility, a
--   made-up id, or a Transition that offers no Assign to) is refused
--   'assignee_not_offered', one answer for all, with nothing written.
-- * Set and copy: app.transition_actions, the actions step, kept apart from
--   app.take_transition so later redefinitions call it unchanged. It runs after
--   the rules step and every check, before any effect, in the same transaction. A
--   write goes into the Transition's Action Form answers when the Action Form has
--   that key, else into the Form, and only into the fields the acting Participant
--   fills at that Step: its Action Form's, and those of the Form Sections it may
--   change now (app.editable_section_keys; no calculated or Built-in Field). A copy
--   reads only from those same fields, as the actor reads them (app.work_item_answers),
--   so never from another Participant's answers (V19) or an Internal Note (not a
--   field). On a move inside one Participant (send, return) the Action Form
--   answers are Internal Communication (V5: internal approvals, Returns,
--   Recommended Codes): a copy from them into the Form is refused, since the Form
--   reaches every Participant once the item leaves. "Now" is the moment the
--   Transition is taken, into a date (Riyadh), time (Riyadh) or date and time
--   (UTC) field only; a Member field is never set to a value (names_person). Any
--   other write is refused 'action_not_allowed', one answer whatever the reason,
--   with nothing written. Publishing refuses each of them first (workflow-checks.ts).
-- * Form writes are recorded like any answer change (app.save_work_item_answers):
--   the answers as they arrived kept for everyone else (V19), field times, and,
--   once the item has left Draft, an answers_changed event internal to the actor's
--   Participant, just before the Transition's event, whose content hash covers them.
-- * app.take_transition takes `p_assign_to` and runs the actions step after the
--   rules step (transition_rules migration): one redefinition with both, on PR
--   #159's body (20270105000000_on_workflow_core.sql).

alter table workflow_transition add column actions jsonb
  check (actions is null or jsonb_typeof(actions) = 'array');

-- "Assign to" --------------------------------------------------------------------------

-- The Members the acting Participant `p_participant_id` may pick as the next holder
-- when taking Transition `p_transition_id`: nobody unless it offers "Assign to" and
-- its next Step is held by that same Participant; then that Step's Step Pool.
create function app.assignees_offered(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid)
  returns table(member_id uuid)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_to_step uuid;
      v_next record;
    begin
      select tr.to_step_id into v_to_step from workflow_transition tr
      where tr.id = p_transition_id and coalesce(tr.actions, '[]') @> '[{"type": "offer_assign_to"}]';
      if v_to_step is null then
        return;
      end if;
      select * into v_next from app.next_step_holder(p_work_item_id, p_transition_id);
      if v_next.outcome is distinct from 'ok' or v_next.participant_id is distinct from p_participant_id then
        return;
      end if;
      return query select p.member_id from app.step_pool(p_work_item_id, v_to_step, p_participant_id) p;
    end
  $$;

-- For the API: the Members the acting Member, holding the item, may pick when taking
-- `p_transition_key` (the Transition its button takes before any pop-up answer),
-- with their names: only their own Participant's, so their own Company's (V14).
create function app.transition_assignees(p_work_item_id uuid, p_transition_key text)
  returns table(member_id uuid, full_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select m.id, m.full_name
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'claimed'
          and a.assignee_member_id = app.current_member_id() and a.participant_id = me.participant_id
        join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.from_step_id = w.current_step_id
          and tr.key = p_transition_key
        cross join lateral app.assignees_offered(w.id, coalesce(app.transition_routed(w.id, tr.id, '{}'), tr.id), me.participant_id) o
        join member m on m.id = o.member_id
        where w.id = p_work_item_id and w.closed_at is null and app.sees_work_item(w.id)
        order by m.full_name ->> 'en', m.id;
    end
  $$;

-- Set and copy ------------------------------------------------------------------------------

-- The answer a `date`, `time` (Riyadh) or `datetime` (UTC) field takes for the moment `p_at`.
create function app.moment_answer(p_type text, p_at timestamptz) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select to_jsonb(case p_type
      when 'date' then to_char(p_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD')
      when 'time' then to_char(p_at at time zone 'Asia/Riyadh', 'HH24:MI')
      when 'datetime' then to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end)
  $$;

-- The actions step of taking Transition `p_transition_id` with the Action Form
-- answers `p_answers`, by the acting Member holding the item: the Action Form
-- answers to record, and the refusal, if any ('action_not_allowed', nothing
-- written). Form writes are saved, and recorded, here.
create function app.transition_actions(p_work_item_id uuid, p_transition_id uuid, p_answers jsonb, p_at timestamptz)
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
      v_after jsonb;
      v_recorded_before jsonb;
      v_recorded_after jsonb;
      v_changed jsonb;
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
      -- Saved as Save draft saves: the answers as they arrived kept for everyone else
      -- (V19), field times, and the change on the record once it has left Draft.
      v_before := app.work_item_full_answers(p_work_item_id);
      v_data := (v_item.data - array(select k from jsonb_each(v_changes) c (k, v) where v = 'null'))
        || coalesce((select jsonb_object_agg(k, v) from jsonb_each(v_changes) c (k, v) where v <> 'null'), '{}');
      update work_item set
        data = v_data,
        data_as_arrived = coalesce(data_as_arrived, v_before),
        updated_at = p_at
      where id = p_work_item_id;
      perform app.sync_link_answers(p_work_item_id, v_item.project_id, v_item.form_version_id, v_data, p_at);
      perform app.record_field_times(p_work_item_id, p_at);
      if exists (
        select 1 from work_item_event e
        where e.work_item_id = p_work_item_id and e.type = 'transition' and app.is_draft_step(e.from_step_id)
      ) then
        v_after := app.work_item_full_answers(p_work_item_id);
        v_recorded_before := app.link_answers_recorded(v_item.form_version_id, v_before);
        v_recorded_after := app.link_answers_recorded(v_item.form_version_id, v_after);
        select jsonb_agg(jsonb_build_object('field', k, 'old', v_recorded_before -> k, 'new', v_recorded_after -> k) order by k)
        into v_changed
        from (select jsonb_object_keys(v_before) union select jsonb_object_keys(v_after)) as keys (k)
        where (v_recorded_before -> k) is distinct from (v_recorded_after -> k);
        if v_changed is not null then
          insert into work_item_event (
            project_id, work_item_id, type, actor_member_id, actor_participant_id, payload,
            audience, audience_participant_id, content_sha256, created_at
          ) values (
            v_item.project_id, p_work_item_id, 'answers_changed', app.current_member_id(), v_me.participant_id,
            jsonb_build_object('changes', v_changed), 'internal', v_me.participant_id,
            sha256(convert_to(v_after::text, 'UTF8')), p_at
          );
        end if;
      end if;
      return query select null::text, v_answers;
    end
  $$;

revoke all on function app.assignees_offered(uuid, uuid, uuid) from public;
revoke all on function app.transition_assignees(uuid, text) from public;
revoke all on function app.moment_answer(text, timestamptz) from public;
revoke all on function app.transition_actions(uuid, uuid, jsonb, timestamptz) from public;
grant execute on function app.transition_assignees(uuid, text) to rabaed_app;
