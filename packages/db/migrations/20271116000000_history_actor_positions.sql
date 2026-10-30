-- RP-1091 (spec RP-1054; visibility.md V5, V14, the "Work Item history" row; scenarios RP-1091-1 to
-- RP-1091-3): the history names the reader's own people with their Position.
--
-- * app.history_actor_positions: each event of the item whose actor is a Member of the reader's own
--   Participant, with the Positions that Member held: as the event's work_item_event_signer row kept
--   them when it was written (a Transition or a Code, RP-620), else their Project Positions now (a
--   Draft's start, a pick-up, an Internal Note: no such row). Nothing for another Participant's
--   actor, nor for an item the reader doesn't see. work_item_event_signer is never the app role's,
--   hence security definer; it reads only the reader's own Participants' events they read (V5).
-- * app.work_item_history gives them (`member_positions`), and says the own-Participant rule itself
--   rather than leaving it to row-level security on project_member_position: null for another
--   Participant's actor, the final Code's signer included (named, V14, but with no Position), and
--   for a Rabaed Engineer's. An event by another Participant gives no Step name either
--   (`from_step_name`, `to_step_name`): which of its Steps held the item is its own (V14).
--
-- Rebuilt from its latest body: app.work_item_history (20270119000000_rabaed_defaults_review_fixes.sql).

create function app.history_actor_positions(p_work_item_id uuid) returns table (event_id uuid, positions jsonb)
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
        select e.id, coalesce(s.positions, (
            select jsonb_agg(po.name order by po.sort, po.id)
            from project_member pm
            join project_member_position pmp on pmp.project_member_id = pm.id
            join position po on po.id = pmp.position_id
            where pm.participant_id = e.actor_participant_id and pm.member_id = e.actor_member_id
          ), '[]'::jsonb)
        from work_item_event e
        left join work_item_event_signer s on s.event_id = e.id
        where e.work_item_id = p_work_item_id
          and e.actor_member_id is not null
          and e.actor_participant_id = any (v_own)
          -- As the events policy: a shared event, or one internal to the reader's own Participant (V5).
          and (e.audience = 'shared' or e.audience_participant_id = any (v_own));
    end
  $$;
revoke all on function app.history_actor_positions(uuid) from public;
grant execute on function app.history_actor_positions(uuid) to rabaed_app;

-- As in the rabaed_defaults_review_fixes migration, with `member_positions`, and no Step name on another Participant's event.
drop function app.work_item_history(uuid);
create function app.work_item_history(p_work_item_id uuid)
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
    case when e.actor_participant_id is null or e.actor_participant_id = any (own.participant_ids) then fs.name end,
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
  left join workflow_step fs on fs.id = e.from_step_id
  left join workflow_step ts on ts.id = e.to_step_id
  left join member hf on hf.id = (e.payload -> 'handover' ->> 'from_member_id')::uuid
  left join member ht on ht.id = (e.payload -> 'handover' ->> 'to_member_id')::uuid
  left join app.history_actor_positions(p_work_item_id) ap on ap.event_id = e.id
  where e.work_item_id = p_work_item_id
  order by e.seq
$$;
revoke all on function app.work_item_history(uuid) from public;
grant execute on function app.work_item_history(uuid) to rabaed_app;
