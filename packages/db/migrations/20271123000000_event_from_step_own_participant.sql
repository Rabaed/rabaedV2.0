-- RP-1140 (visibility.md V5, V14; scenario RP-1140-1): the Step an event left is its actor's
-- Participant's own. A shared move leaves from a Step of the Participant that took it: K1's close
-- with a Code leaves from Consultant approval, where K1's own move inside K1 (Send to Manager) took
-- it after C1's Submit, and C1's Submit leaves from C1's internal review. The other Participants
-- read the item at the Step the shared move reached (app.work_items_seen, app.step_as_seen), and
-- app.work_item_history names an event's Steps to the actor's own Participant only, but the app
-- role was granted work_item_event.from_step_id, so anyone who read the shared event read the id
-- of the Step it left: only the api kept it from C1.
--
-- * work_item_event.from_step_id is no longer granted to the app role. to_step_id stays: on a
--   shared event it is where the shared move took the item, which every reader of the event knows
--   (the List's closed card finds its closer by it); an internal event is its Participant's alone
--   (the events policy).
-- * app.work_item_event_from_steps(item) gives the Step each event left to the reader, for the
--   events of the reader's own Participant (or of no Participant, as the history has it) that the
--   events policy lets them read.
-- * app.work_item_history, rebuilt from its newest body (20271116000000_history_actor_positions),
--   reads the Step an event left through it. It named that Step to the actor's own Participant
--   only already, so what it answers is unchanged.

revoke select (from_step_id) on work_item_event from rabaed_app;

create function app.work_item_event_from_steps(p_work_item_id uuid) returns table (event_id uuid, from_step_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_own uuid[];
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      v_own := array(select app.current_participant_ids());
      return query
        select e.id, e.from_step_id
        from work_item_event e
        where e.work_item_id = p_work_item_id
          and e.from_step_id is not null
          -- The Step it left is the actor's own Participant's (V5, V14); a Rabaed Engineer's event keeps it.
          and (e.actor_participant_id is null or e.actor_participant_id = any (v_own))
          -- As the events policy: never the `created` event (the Draft's start), and a shared event or
          -- one internal to the reader's own Participant (V5).
          and e.type <> 'created'
          and (e.audience = 'shared' or e.audience_participant_id = any (v_own));
    end
  $$;

revoke all on function app.work_item_event_from_steps(uuid) from public;
grant execute on function app.work_item_event_from_steps(uuid) to rabaed_app;

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
    -- The Step it left comes from app.work_item_event_from_steps, which answers for those events only.
    fs.name,
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
  left join workflow_transition tr on tr.id = e.transition_id
  left join app.work_item_event_from_steps(p_work_item_id) ef on ef.event_id = e.id
  left join workflow_step fs on fs.id = ef.from_step_id
  left join workflow_step ts on ts.id = e.to_step_id
  left join member hf on hf.id = (e.payload -> 'handover' ->> 'from_member_id')::uuid
  left join member ht on ht.id = (e.payload -> 'handover' ->> 'to_member_id')::uuid
  left join app.history_actor_positions(p_work_item_id) ap on ap.event_id = e.id
  where e.work_item_id = p_work_item_id
  order by e.seq
$$;

revoke all on function app.work_item_history(uuid) from public;
grant execute on function app.work_item_history(uuid) to rabaed_app;
