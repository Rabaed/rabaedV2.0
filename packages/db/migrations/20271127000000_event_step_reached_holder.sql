-- RP-1203 (visibility.md V14; scenario RP-1192-1): the Step an event reached is the holding Participant's.
-- RP-1192 took the Step out of every read of the item for another Company, but the app role was still
-- granted work_item_event.to_step_id (RP-1140 kept it): C1, reading its own Submit, read the id of K1's
-- Consultant review, and workflow_step (definitions, V20) names it. No api read named a Step from it; the
-- database gave it out.
--
-- * work_item_event.to_step_id is no longer granted to the app role, so none of the event's Step columns
--   are (RP-1140 took from_step_id and transition_id).
-- * app.event_steps_reached(event ids) gives, for each of those events the events policy lets the reader
--   read and that moved the item, the Step it reached only where that Step is the reader's own
--   Participant's (the reader's Participant has an assignment at it on the item) or is terminal (no actor:
--   its outcome names it to everyone); null otherwise. It has a row for every such event, so a read that
--   asks only whether an event moved the item (the api's latest move) still finds it.
-- * app.work_item_history, rebuilt from its newest body (20271126000000_step_hidden_outside_holder), reads
--   the Step there. It named it on the same rule already, on an event of the reader's own Participant, so
--   it answers nothing new or less.
--
-- Its other readers run inside definer functions only (the app role may not run them), so the revoke
-- does not reach them. The api reads it through the new function: the List's closed card (its closer,
-- by the terminal Step) and the latest move of a reply's arrival.

revoke select (to_step_id) on work_item_event from rabaed_app;

create function app.event_steps_reached(p_event_ids uuid[])
  returns table (event_id uuid, to_step_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_own uuid[];
      v_seen uuid[];
    begin
      v_own := array(select app.current_participant_ids());
      -- The items the reader sees, each asked once, however many of its events are asked about.
      v_seen := array(
        select i.work_item_id from (select distinct x.work_item_id from work_item_event x where x.id = any (p_event_ids)) i
        where app.sees_work_item(i.work_item_id));
      return query
        select e.id,
          -- The holding Participant's own Step, or a terminal one; never another Company's (V14).
          case when not (s.actor_rule ? 'base_role' or s.actor_rule ? 'raiser')
            or exists (
              select 1 from step_assignment a
              where a.work_item_id = e.work_item_id and a.step_id = e.to_step_id and a.participant_id = any (v_own))
            then e.to_step_id end
        from work_item_event e
        join workflow_step s on s.id = e.to_step_id
        where e.id = any (p_event_ids)
          -- As the events policy: never the `created` event (the Draft's start), only an item the reader
          -- sees, and a shared event or one internal to the reader's own Participant (V5).
          and e.type <> 'created'
          and e.work_item_id = any (v_seen)
          and (e.audience = 'shared' or e.audience_participant_id = any (v_own));
    end
  $$;

revoke all on function app.event_steps_reached(uuid[]) from public;
grant execute on function app.event_steps_reached(uuid[]) to rabaed_app;

-- From 20271126000000_step_hidden_outside_holder.sql.
create or replace function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text,
    outcome text, internal_note text, changes jsonb, remarks text, recommended_code text, handover jsonb, answers jsonb,
    action_form jsonb, member_positions jsonb
  )
  language sql stable
  set search_path = pg_catalog, public
as $$
  with own as (select array(select app.current_participant_ids()) as participant_ids)
  select (row_number() over (order by e.seq))::integer, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
    tr.label,
    -- Which Step held the item is its own Participant's (V14): a Rabaed Engineer's event keeps both.
    -- The Step it left comes from app.event_transitions, which gives it for those events only.
    fs.name,
    -- The Step it reached, which app.event_steps_reached gives only where it is the reader's own
    -- Participant's or terminal (RP-1192, RP-1203), on an event of the reader's own Participant.
    case when e.actor_participant_id is null or e.actor_participant_id = any (own.participant_ids) then ts.name end,
    -- A pool of one's `assigned` event stores why ("only_member"): its label says so.
    case when e.type <> 'assigned' then e.payload ->> 'reason' end,
    e.payload ->> 'document_number', e.payload ->> 'outcome',
    e.payload ->> 'internal_note', e.payload -> 'changes', e.payload ->> 'remarks', e.payload ->> 'recommended_code',
    -- A Handover is internal to the holding Participant (V5), so both are its own Members.
    case when e.payload ? 'handover' then jsonb_build_object(
      'from', hf.full_name, 'to', ht.full_name, 'because', e.payload -> 'handover' ->> 'because') end,
    case
      when e.type in ('transition', 'issue_code') then nullif(e.payload - 'document_number' - 'outcome', '{}'::jsonb)
      when e.type = 'internal_answers' then e.payload -> 'answers'
    end,
    -- The Action Form the answers were given in, as its Workflow Version pinned it.
    case when e.type in ('transition', 'issue_code', 'internal_answers') then tr.action_form end,
    -- A Position only for a Member of the reader's own Participant; never another Company's, the Code's signer included (V14).
    case when e.actor_member_id is not null and e.actor_participant_id = any (own.participant_ids) then coalesce(ap.positions, '[]'::jsonb) end
  from work_item_event e
  cross join own
  join work_item w on w.id = e.work_item_id
  left join app.work_item_companies(p_work_item_id) actor on actor.participant_id = e.actor_participant_id
  left join member m on m.id = e.actor_member_id
  left join app.event_transitions(array(select x.id from work_item_event x where x.work_item_id = p_work_item_id)) tr on tr.event_id = e.id
  left join workflow_step fs on fs.id = tr.from_step_id
  left join app.event_steps_reached(array(select x.id from work_item_event x where x.work_item_id = p_work_item_id)) rs on rs.event_id = e.id
  left join workflow_step ts on ts.id = rs.to_step_id
  left join member hf on hf.id = (e.payload -> 'handover' ->> 'from_member_id')::uuid
  left join member ht on ht.id = (e.payload -> 'handover' ->> 'to_member_id')::uuid
  left join app.history_actor_positions(p_work_item_id) ap on ap.event_id = e.id
  where e.work_item_id = p_work_item_id
  order by e.seq
$$;

revoke all on function app.work_item_history(uuid) from public;
grant execute on function app.work_item_history(uuid) to rabaed_app;
