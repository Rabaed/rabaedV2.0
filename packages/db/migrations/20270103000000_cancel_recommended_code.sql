-- Cancel from the raiser's Steps, and the Recommended Code (RP-433, WF-10; spec RP-423;
-- workflow-engine.md §5.1, §5.3, §6; visibility.md V5 and scenario RP-433-1).
--
-- * Cancel (`kind = cancel`; publishing keeps it to the raiser's own Steps, into a
--   cancelled Stage, with no outcome): closes the item with outcome `cancelled`
--   (allowed by work_item_outcome_in_set outside every set), recorded like any
--   Transition. It is offered (app.takeable_transitions) and taken (app.take_transition)
--   only until the item is first Submitted (`submitted_at`), so never once another
--   Participant has had it, even back at the raiser's Steps after a Send Back; then it
--   is refused like a Transition that isn't there ('transition_not_available'). A
--   Cancel issues no Document Number: a Draft cancelled keeps "No number yet".
--   Open Subtasks are cancelled with it (§6) once Subtasks exist; there are none yet
--   (no work_item.parent_id), and Comments are raised only by a Code, after Submit.
-- * A Rabaed Default Stage "Cancelled" (category `cancelled`) in Submittals, copied
--   into every Project (trigger stage_rabaed_default_copied), for the Rabaed Default
--   Workflows' Cancel to go to.
-- * The Recommended Code: on a Step whose outcome mode is `recommend_code`, the
--   holder may propose one of the Type's closing outcomes (its Project's copy of the
--   set) to the next reviewer of the same Participant, taking a `send` whose next
--   Step that Participant holds (app.recommendable_outcomes; for the API
--   app.transition_recommendable_outcomes). take_transition takes it as
--   `p_recommended_code`; any other is refused 'recommended_code_not_offered', one answer
--   whatever the reason, with nothing written. It is its own `recommend_code` event,
--   internal to the recommender's Participant (V5), just before the Internal Note
--   written with it (its note) and the Transition. It is kept nowhere else (no column
--   on work_item, which every Participant that sees the item reads), so every read of
--   events (the history, the Activity Feed, notifications: the watched-event trigger
--   ignores it, and delivery checks V5) leaves it out for anyone else, and so does
--   their numbering of the events.
-- * app.work_item_history gives each event's Recommended Code.
-- * app.take_transition: redefined with the Cancel rule, `p_recommended_code` and its
--   event in 20270105100000_cancel_take_transition.sql, on the body that
--   20270105000000_on_workflow_core.sql gives it (lane B's confirmation and content
--   hash with this spec's rules, routed reload, "Assign to" and actions steps).

-- The Rabaed Default Cancelled Stage -------------------------------------------------

insert into stage (owner_kind, module_key, key, name, category, sort)
values ('rabaed', 'submittals', 'cancelled', '{"en": "Cancelled", "ar": "ملغى"}', 'cancelled', 6);

-- The Recommended Code ------------------------------------------------------------------

-- The outcomes the acting Participant `p_participant_id` may recommend when taking
-- Transition `p_transition_id`: none unless it leaves a Step that Recommends a Code
-- and is a `send` whose next Step that same Participant holds; then the Type's
-- closing outcomes on the item's Project, in order.
create function app.recommendable_outcomes(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid)
  returns table(code text, name jsonb)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_next record;
    begin
      if not exists (
        select 1 from workflow_transition tr join workflow_step s on s.id = tr.from_step_id
        where tr.id = p_transition_id and tr.kind = 'send' and s.outcome_mode = 'recommend_code')
      then
        return;
      end if;
      select * into v_next from app.next_step_holder(p_work_item_id, p_transition_id);
      if v_next.outcome is distinct from 'ok' or v_next.participant_id is distinct from p_participant_id then
        return;
      end if;
      return query
        select o.code, o.name
        from work_item w
        join outcome o on o.project_id = w.project_id and o.work_item_type_id = w.work_item_type_id and o.closing
        where w.id = p_work_item_id
        order by o.sort, o.code;
    end
  $$;

-- For the API: the outcomes the acting Member, holding the item, may recommend when
-- taking `p_transition_key` (the Transition its button takes before any pop-up answer).
create function app.transition_recommendable_outcomes(p_work_item_id uuid, p_transition_key text)
  returns table(code text, name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select o.code, o.name
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'claimed'
          and a.assignee_member_id = app.current_member_id() and a.participant_id = me.participant_id
        join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.from_step_id = w.current_step_id
          and tr.key = p_transition_key
        cross join lateral app.recommendable_outcomes(w.id, coalesce(app.transition_routed(w.id, tr.id, '{}'), tr.id), me.participant_id) o
        where w.id = p_work_item_id and w.closed_at is null and app.sees_work_item(w.id);
    end
  $$;

-- What the acting Member may press ---------------------------------------------------

-- As in the transition_rules migration, offering a Cancel only until the item is
-- first Submitted.
create or replace function app.takeable_transitions(p_work_item_id uuid) returns table(transition_id uuid, key text, label jsonb, kind text, sort integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select distinct on (tr.label) tr.id, tr.key, tr.label, tr.kind, tr.sort
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        join work_item_type t on t.id = w.work_item_type_id
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'claimed'
          and a.assignee_member_id = app.current_member_id() and a.participant_id = me.participant_id
        join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.from_step_id = w.current_step_id
        where w.id = p_work_item_id and w.closed_at is null
          and app.project_member_has_permission(me.project_member_id, t.module_key, tr.permission)
          and (select h.outcome from app.next_step_holder(w.id, tr.id) h) in ('ok', 'terminal')
          and app.transition_restrictions_hold(w.id, tr.rules, me.project_member_id, me.participant_id)
          -- A Cancel only until the item is first Submitted (RP-433).
          and (tr.kind <> 'cancel' or w.submitted_at is null)
          and (app.transition_routed(w.id, tr.id, '{}') is distinct from tr.id
            or app.transition_conditions_hold(w.id, tr.rules, '{}'))
        order by tr.label, tr.sort;
    end
  $$;

-- History -----------------------------------------------------------------------------

-- As in the mar_workflow_v2 migration, with each event's Recommended Code (its own
-- event, read through the same RLS: only its Participant's Members read it).
drop function app.work_item_history(uuid);
create function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text, outcome text,
    internal_note text, changes jsonb, remarks text, recommended_code text
  )
  language sql stable security invoker
  set search_path = pg_catalog, public
  as $$
    select (row_number() over (order by e.seq))::integer, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
      tr.label, fs.name, ts.name, e.payload ->> 'reason', e.payload ->> 'document_number', e.payload ->> 'outcome',
      e.payload ->> 'internal_note', e.payload -> 'changes', e.payload ->> 'remarks', e.payload ->> 'recommended_code'
    from work_item_event e
    join work_item w on w.id = e.work_item_id
    left join app.work_item_companies(p_work_item_id) actor on actor.participant_id = e.actor_participant_id
    left join member m on m.id = e.actor_member_id
    left join workflow_transition tr on tr.id = e.transition_id
    left join workflow_step fs on fs.id = e.from_step_id
    left join workflow_step ts on ts.id = e.to_step_id
    where e.work_item_id = p_work_item_id
    order by e.seq
  $$;

revoke all on function app.recommendable_outcomes(uuid, uuid, uuid) from public;
revoke all on function app.transition_recommendable_outcomes(uuid, text) from public;
revoke all on function app.work_item_history(uuid) from public;
grant execute on function app.transition_recommendable_outcomes(uuid, text) to rabaed_app;
grant execute on function app.work_item_history(uuid) to rabaed_app;
