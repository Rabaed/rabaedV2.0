-- RP-1140 (visibility.md V5, V14; scenario RP-1140-1): the Step an event left is its actor's
-- Participant's own. A shared move leaves from a Step of the Participant that took it: K1's close
-- with a Code leaves from Consultant approval, where K1's own move inside K1 (Send to Manager) took
-- it after C1's Submit, and C1's Submit leaves from C1's internal review. The other Participants
-- read the item at the Step the shared move reached (app.work_items_seen, app.step_as_seen), and
-- app.work_item_history names an event's Steps to the actor's own Participant only, but the app
-- role was granted work_item_event.from_step_id and transition_id, so anyone who read the shared
-- event read the id of the Step it left: directly, or through its Transition, which leaves one Step
-- (workflow_transition.from_step_id). Only the api kept it from C1.
--
-- * work_item_event.from_step_id and transition_id are no longer granted to the app role.
--   to_step_id stays: on a shared event it is where the shared move took the item, which every
--   reader of the event knows (the List's closed card finds its closer by it); an internal event
--   is its Participant's alone (the events policy).
-- * app.event_transitions(event ids) gives, for each of those events the events policy lets the
--   reader read, what everyone who reads it is shown of its Transition (its label, kind and Action
--   Form: the history, the Activity Feed, Home and notifications show them), and the Transition
--   and the Step it left only for an event of the reader's own Participant (or of no Participant,
--   as the history has it).
-- * app.work_item_history, rebuilt from its newest body (20271116000000_history_actor_positions),
--   and app.activity_feed, rebuilt from its newest body (20261217000100_activity_feed_plpgsql),
--   read the Transition and the Step it left through it. The history named that Step to the
--   actor's own Participant only already, and both show the label as before, so neither answers
--   anything new or less.

revoke select (from_step_id, transition_id) on work_item_event from rabaed_app;

create function app.event_transitions(p_event_ids uuid[])
  returns table (event_id uuid, transition_id uuid, from_step_id uuid, label jsonb, kind text, action_form jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_own uuid[];
    begin
      v_own := array(select app.current_participant_ids());
      return query
        select e.id,
          -- The Transition and the Step it left are the actor's own Participant's (V5, V14): a Transition
          -- leaves one Step, so its id names that Step. A Rabaed Engineer's event keeps both.
          case when e.actor_participant_id is null or e.actor_participant_id = any (v_own) then e.transition_id end,
          case when e.actor_participant_id is null or e.actor_participant_id = any (v_own) then e.from_step_id end,
          tr.label, tr.kind, tr.action_form
        from work_item_event e
        left join workflow_transition tr on tr.id = e.transition_id
        where e.id = any (p_event_ids)
          and (e.transition_id is not null or e.from_step_id is not null)
          -- As the events policy: never the `created` event (the Draft's start), only an item the reader
          -- sees, and a shared event or one internal to the reader's own Participant (V5).
          and e.type <> 'created'
          and app.sees_work_item(e.work_item_id)
          and (e.audience = 'shared' or e.audience_participant_id = any (v_own));
    end
  $$;

revoke all on function app.event_transitions(uuid[]) from public;
grant execute on function app.event_transitions(uuid[]) to rabaed_app;

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
  left join workflow_step ts on ts.id = e.to_step_id
  left join member hf on hf.id = (e.payload -> 'handover' ->> 'from_member_id')::uuid
  left join member ht on ht.id = (e.payload -> 'handover' ->> 'to_member_id')::uuid
  left join app.history_actor_positions(p_work_item_id) ap on ap.event_id = e.id
  where e.work_item_id = p_work_item_id
  order by e.seq
$$;

revoke all on function app.work_item_history(uuid) from public;
grant execute on function app.work_item_history(uuid) to rabaed_app;

create or replace function app.activity_feed(
  p_project_id uuid, p_module_key text, p_type_codes text[], p_mine boolean, p_after_event_id uuid, p_limit integer
)
  returns table (
    id uuid, created_at timestamptz, type text, audience text,
    company_name jsonb, member_name jsonb, transition_label jsonb, outcome text,
    work_item_id uuid, document_number text, title text, type_code text, type_name jsonb
  )
  language plpgsql stable security invoker
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        with page as (
          select e.id, e.created_at, e.seq, e.type, e.audience, e.work_item_id, e.actor_participant_id, e.actor_member_id,
            e.payload ->> 'outcome' as outcome
          from work_item_event e
          join work_item w on w.id = e.work_item_id
          join work_item_type t on t.id = w.work_item_type_id
          where e.project_id = p_project_id
            and e.type <> 'answers_changed'
            and (p_module_key is null or t.module_key = p_module_key)
            and (cardinality(coalesce(p_type_codes, '{}')) = 0 or t.code = any(p_type_codes))
            and (not coalesce(p_mine, false)
              or w.created_by_member_id = app.current_member_id()
              or exists (select 1 from step_assignment a where a.work_item_id = w.id and a.assignee_member_id = app.current_member_id())
              or exists (select 1 from work_item_event mine where mine.work_item_id = w.id and mine.actor_member_id = app.current_member_id())
              -- Watched (RP-354): the caller's own Watch on the item's chain.
              or app.watching_work_item(w.id))
            and (p_after_event_id is null or (e.created_at, e.work_item_id, e.seq) < (
              select a.created_at, a.work_item_id, a.seq from work_item_event a where a.id = p_after_event_id))
          order by e.created_at desc, e.work_item_id desc, e.seq desc
          limit greatest(1, least(coalesce(p_limit, 30), 101))
        )
        select p.id, p.created_at, p.type, p.audience, actor.legal_name, m.full_name, tr.label, p.outcome,
          w.id, w.document_number, w.title, t.code, t.name
        from page p
        join work_item w on w.id = p.work_item_id
        join work_item_type t on t.id = w.work_item_type_id
        left join lateral (
          select c.legal_name from app.work_item_companies(p.work_item_id) c where c.participant_id = p.actor_participant_id
        ) actor on true
        left join member m on m.id = p.actor_member_id
        -- The Transition's label, which everyone who reads the event is shown (RP-1140: the Transition itself
        -- is the actor's own Participant's).
        left join app.event_transitions(array(select page.id from page)) tr on tr.event_id = p.id
        order by p.created_at desc, p.work_item_id desc, p.seq desc;
    end
  $$;
