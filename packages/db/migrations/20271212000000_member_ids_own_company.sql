-- RP-1139 (visibility.md V14, owner's grill 2026-10-31, docs PR #535; scenarios RP-1139-1 to RP-1139-4):
-- no other Company reads a Member's id. RP-1166 swept the app.* functions, but the app role was still
-- granted two Member id columns on rows another Company reads: an event's actor (C1, at the Owner's
-- review, read the id of K1's manager on the shared Recommendation) and a Document's uploader (K1 read
-- the id of C1's engineer on the Documents that reached it). No api read named another Company's
-- Member from them (member's RLS gives names of one's own Company only); the database gave out the ids.
--
-- * work_item_event.actor_member_id and document.uploaded_by_member_id are no longer granted to the
--   app role. document.removed_by_member_id stays: it is set only with removed_at, and the Documents
--   policy shows no removed Document.
-- * app.event_actor_members(event ids) and app.document_uploaders(document ids) give, for each row the
--   events or Documents policy lets the reader read, the Member's id only where the Member is of the
--   reader's own Company; null otherwise.
-- * app.acted_on_work_item(item) says whether the reader has acted on the item: the Activity Feed's
--   "Items I'm on" asks it of the reader's own Member only.
-- * app.work_item_history and app.activity_feed (security invoker, run by the app role) read the actor
--   through them, from their newest bodies (20271127000000 and 20271207000000). The other readers of
--   both columns run inside definer functions only (the app role may not run them).
revoke select (actor_member_id) on work_item_event from rabaed_app;
revoke select (uploaded_by_member_id) on document from rabaed_app;

create function app.event_actor_members(p_event_ids uuid[])
  returns table (event_id uuid, actor_member_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_own uuid[];
      v_seen uuid[];
      v_company uuid;
    begin
      v_own := array(select app.current_participant_ids());
      v_company := app.current_company_id();
      -- The items the reader sees, each asked once, however many of its events are asked about.
      v_seen := array(
        select i.work_item_id from (select distinct x.work_item_id from work_item_event x where x.id = any (p_event_ids)) i
        where app.sees_work_item(i.work_item_id));
      return query
        select e.id,
          -- A Member of the reader's own Company only; never another Company's (V14).
          case when exists (select 1 from member m where m.id = e.actor_member_id and m.company_id = v_company) then e.actor_member_id end
        from work_item_event e
        where e.id = any (p_event_ids)
          -- As the events policy: never the `created` event (the Draft's start), only an item the reader
          -- sees, and a shared event or one internal to the reader's own Participant (V5).
          and e.type <> 'created'
          and e.work_item_id = any (v_seen)
          and (e.audience = 'shared' or e.audience_participant_id = any (v_own));
    end
  $$;
revoke all on function app.event_actor_members(uuid[]) from public;
grant execute on function app.event_actor_members(uuid[]) to rabaed_app;

create function app.document_uploaders(p_document_ids uuid[])
  returns table (document_id uuid, uploaded_by_member_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_company uuid;
    begin
      v_company := app.current_company_id();
      return query
        select d.id,
          -- A Member of the reader's own Company only; another Company's Document names its Company (V14).
          case when exists (select 1 from member m where m.id = d.uploaded_by_member_id and m.company_id = v_company) then d.uploaded_by_member_id end
        from document d
        where d.id = any (p_document_ids)
          -- As the Documents policy.
          and d.confirmed_at is not null
          and d.removed_at is null
          and d.project_id in (select app.current_project_ids())
          and app.sees_work_item(d.work_item_id)
          and app.document_seen(d.work_item_id, d.arrival, d.reply_event_id);
    end
  $$;
revoke all on function app.document_uploaders(uuid[]) from public;
grant execute on function app.document_uploaders(uuid[]) to rabaed_app;

create function app.acted_on_work_item(p_work_item_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
as $$
  -- The reader's own moves only: it names no one else.
  select exists (select 1 from work_item_event e where e.work_item_id = p_work_item_id and e.actor_member_id = app.current_member_id())
$$;
revoke all on function app.acted_on_work_item(uuid) from public;
grant execute on function app.acted_on_work_item(uuid) to rabaed_app;

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
    -- Participant's or terminal (RP-1192, RP-1203), on an event of the reader's own Participant or a Rabaed Engineer's.
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
    case when am.actor_member_id is not null and e.actor_participant_id = any (own.participant_ids) then coalesce(ap.positions, '[]'::jsonb) end
  from work_item_event e
  cross join own
  join work_item w on w.id = e.work_item_id
  left join app.work_item_companies(p_work_item_id) actor on actor.participant_id = e.actor_participant_id
  -- The actor's id only for the reader's own Company (RP-1139); member's RLS names that Company's people only.
  left join app.event_actor_members(array(select x.id from work_item_event x where x.work_item_id = p_work_item_id)) am on am.event_id = e.id
  left join member m on m.id = am.actor_member_id
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

create or replace function app.activity_feed(
  p_project_id uuid, p_module_key text, p_type_codes text[], p_mine boolean, p_after_event_id uuid, p_limit integer
)
  returns table (
    id uuid, created_at timestamptz, type text, audience text,
    company_name jsonb, member_name jsonb, transition_label jsonb, outcome text,
    work_item_id uuid, document_number text, title text, type_code text, type_name jsonb,
    on_item boolean, by_me boolean
  )
  language plpgsql stable security invoker
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        with page as (
          select e.id, e.created_at, e.seq, e.type, e.audience, e.work_item_id, e.actor_participant_id,
            e.payload ->> 'outcome' as outcome
          from work_item_event e
          join work_item w on w.id = e.work_item_id
          join work_item_type t on t.id = w.work_item_type_id
          where e.project_id = p_project_id
            and e.type <> 'answers_changed'
            and (p_module_key is null or t.module_key = p_module_key)
            and (cardinality(coalesce(p_type_codes, '{}')) = 0 or t.code = any(p_type_codes))
            and (not coalesce(p_mine, false)
              or (w.created_by_member_id = app.current_member_id()
                or exists (select 1 from step_assignment a where a.work_item_id = w.id and a.assignee_member_id = app.current_member_id())
                or app.acted_on_work_item(w.id)
                -- Watched (RP-354): the caller's own Watch on the item's chain.
                or app.watching_work_item(w.id)))
            and (p_after_event_id is null or (e.created_at, e.work_item_id, e.seq) < (
              select a.created_at, a.work_item_id, a.seq from work_item_event a where a.id = p_after_event_id))
          order by e.created_at desc, e.work_item_id desc, e.seq desc
          limit greatest(1, least(coalesce(p_limit, 30), 101))
        ),
        -- The actor's id only for the reader's own Company (RP-1139); member's RLS names that Company's people only.
        actors as (select am.event_id, am.actor_member_id from app.event_actor_members(array(select page.id from page)) am)
        select p.id, p.created_at, p.type, p.audience, actor.legal_name, m.full_name, tr.label, p.outcome,
          w.id, w.document_number, w.title, t.code, t.name,
          -- "Items I'm on", the filter's rule above, asked of the page's rows only.
          (w.created_by_member_id = app.current_member_id()
            or exists (select 1 from step_assignment a where a.work_item_id = w.id and a.assignee_member_id = app.current_member_id())
            or app.acted_on_work_item(w.id)
            -- Watched (RP-354): the caller's own Watch on the item's chain.
            or app.watching_work_item(w.id)) is true,
          coalesce(ac.actor_member_id = app.current_member_id(), false)
        from page p
        join work_item w on w.id = p.work_item_id
        join work_item_type t on t.id = w.work_item_type_id
        left join lateral (
          select c.legal_name from app.work_item_companies(p.work_item_id) c where c.participant_id = p.actor_participant_id
        ) actor on true
        left join actors ac on ac.event_id = p.id
        left join member m on m.id = ac.actor_member_id
        -- The Transition's label, which everyone who reads the event is shown (RP-1140: the Transition itself
        -- is the actor's own Participant's).
        left join app.event_transitions(array(select page.id from page)) tr on tr.event_id = p.id
        order by p.created_at desc, p.work_item_id desc, p.seq desc;
    end
  $$;
revoke all on function app.activity_feed(uuid, text, text[], boolean, uuid, integer) from public;
grant execute on function app.activity_feed(uuid, text, text[], boolean, uuid, integer) to rabaed_app;
