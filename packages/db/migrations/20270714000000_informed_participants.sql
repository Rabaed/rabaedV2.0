-- RP-625 (SNAG-3, spec RP-619): Informed Participants (workflow-engine.md §1, §5.1; visibility.md
-- layer 3, V2, V3, V5, V14, V19; scenarios RP-625-1 to RP-625-5).
--
-- A Submit may name roles to inform (`inform` in the definition, `@rabaed/domain`
-- `workflow-definition.ts`). It has no column of its own: it is stored in
-- `workflow_transition.actions` as `{"type": "inform", "roles": [...]}`, so the Version rows
-- (app.insert_workflow_rows, app.workflow_version_step_rows) carry it unchanged. When the
-- Transition is taken, every active Participant of those roles whose Visibility covers all the
-- item's dimension values gets Participant access (layer 3) with the new reason `informed`.
-- It reads the item as any Participant without the Step does: never holds a Step, is never
-- offered a Transition, gets no "Step reached", and Need My Action never counts it (they all read
-- `step_assignment`, which it never has). Its Members still pass layer 4 (app.sees_work_item):
-- narrowing their Visibility hides the item at once, as for oversight.
--
-- * work_item_access.reason gains `informed`.
-- * app.transition_actions (Transition actions, WF-8) skips the `inform` entry: the trigger
--   below is its effect.
-- * app.inform_participants (trigger on work_item_event insert): the Transition event a Submit
--   writes grants `informed` access. Never to a Participant of the raiser's role or of the role
--   the Submit hands the item to (V3: another Participant of the same role never sees it), and a
--   Participant that already has access (the raiser, the holder, oversight) keeps its own row.
--   A trigger, so app.take_transition and app.transition_effects are not redefined (RP-603).
-- * app.submit_reaches_others (BEFORE UPDATE trigger on work_item): a Submit or a Send Back that
--   stays inside the acting Participant (a Contractor's Raise of its own Snag: its Open is of
--   its own role, so it holds every Step, RP-622) is a shared move, so for everyone else the item
--   arrives there: `participant_entered_at` and `participant_entered_step_id` move with it, as
--   they do when it crosses. So everyone outside it reads the Stage and Step Age from that move
--   (app.step_as_seen, V14: the Consultant informed by the Raise counts from the Raise, never
--   from when the Draft was started), the Documents and Links as they were at it (V19: the
--   arrival, app.item_row_seen), and its Documents freeze (app.freeze_documents_at_submit).
--   Inside it, Step Age still counts from the last move (`step_entered_at`).

-- The reason --------------------------------------------------------------------------------------

alter table work_item_access drop constraint work_item_access_reason_check;
alter table work_item_access add constraint work_item_access_reason_check
  check (reason in ('raised', 'handling', 'oversight', 'informed'));

-- Actions: inform is not one to run ---------------------------------------------------------------

-- From 20270106400000_write_answers_helper.sql: an `inform` entry is skipped, as "Assign to" is.
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
        select 1 from jsonb_array_elements(coalesce(v_transition.actions, '[]')) a
        where a.value ->> 'type' not in ('offer_assign_to', 'inform'))
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
        continue when v_action ->> 'type' in ('offer_assign_to', 'inform');
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

-- Informing ---------------------------------------------------------------------------------------

-- The event of a Submit naming roles to inform gives their Participants covering the item
-- `informed` access, from the move. The Owner's review writes its event twice (ADR 0022): the
-- second finds the rows there.
create function app.inform_participants() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      select new.work_item_id, new.project_id, p.id, new.created_at, 'informed'
      from workflow_transition tr
      join workflow_step target on target.id = tr.to_step_id
      join work_item w on w.id = new.work_item_id
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      cross join lateral jsonb_array_elements(coalesce(tr.actions, '[]')) a
      cross join lateral jsonb_array_elements_text(a.value -> 'roles') informed (base_role)
      join participant p on p.project_id = new.project_id and p.status = 'active'
      join project_role r on r.id = p.project_role_id and r.base_role = informed.base_role
      where tr.id = new.transition_id and tr.kind = 'submit' and a.value ->> 'type' = 'inform'
        -- V3: never another Participant of the raiser's role, or of the role it is handed to.
        and r.base_role <> raiser_role.base_role
        and r.base_role is distinct from app.actor_role(target.actor_rule, raiser_role.base_role)
        and app.participant_covers_item(p.id, new.work_item_id)
      on conflict do nothing;
      return null;
    end
  $$;
revoke all on function app.inform_participants() from public;

create trigger work_item_event_informs after insert on work_item_event
  for each row when (new.transition_id is not null and new.type in ('transition', 'issue_code'))
  execute function app.inform_participants();

-- A shared move inside one Participant reaches the others -------------------------------------------

-- Before app.share_answers_on_leaving (triggers run by name), which then counts the arrival.
-- The move's Transition event is written just before the item is updated (app.transition_effects),
-- at the same time as the Step it enters.
create function app.submit_reaches_others() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if exists (
        select 1 from work_item_event e
        join workflow_transition tr on tr.id = e.transition_id
        where e.work_item_id = new.id and e.type in ('transition', 'issue_code')
          and e.created_at = new.step_entered_at and e.to_step_id = new.current_step_id
          and tr.kind in ('submit', 'send_back')
      ) then
        new.participant_entered_at := new.step_entered_at;
        new.participant_entered_step_id := new.current_step_id;
      end if;
      return new;
    end
  $$;
revoke all on function app.submit_reaches_others() from public;

create trigger work_item_reaches_others_on_submit before update of current_step_id, step_entered_at on work_item
  for each row when (
    new.step_entered_at is distinct from old.step_entered_at
    and new.participant_entered_at is not distinct from old.participant_entered_at
    and new.closed_at is null
  )
  execute function app.submit_reaches_others();
