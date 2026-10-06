-- The Activity Feed (RP-353, spec RP-344; visibility.md "Activity Feed", V5, V14,
-- V19; data-model.md §10).
--
-- * app.activity_feed: a Project's `work_item_event`s, newest first, a page at a
--   time, in the same family as app.work_item_history. It is security invoker, so
--   it reads through the same RLS as the history: work_item gives only the items
--   the Member sees (layers 3 and 4, V1, V3), work_item_event only their shared
--   events and the Member's own Participant's internal ones (layer 5, V5), and
--   never the `created` event. Another Company is named by app.work_item_companies,
--   by its name only; member's own RLS names people of the Member's own Company
--   only (V14). Unlike the history it does not name another Company's Code signer:
--   the feed names people of the Member's own Company only.
-- * Left out: `answers_changed` (V19 keeps another Participant's in-progress
--   changes its own; the feed leaves them out for everyone). Documents write no
--   event. `project_event` is not in the feed.
-- * Filters: a Module, Work Item Types, and "items I'm on": items the Member
--   raised (created), held (a Step assigned to them) or acted on (an event of
--   theirs). All three read rows the Member may see, through RLS.
-- * Order: newest first; events of one moment (an Internal Note and the
--   Transition it is written with) by item, the later first, as the history
--   orders them. Paging is keyset from the last entry of the page before, named
--   by its event id: its place is read here, so the stored `seq`, whose gaps
--   would count other Participants' internal events (V5), never leaves the
--   database. An event the Member can't see places nothing: an empty page.

create index work_item_event_project_feed on work_item_event (project_id, created_at desc, work_item_id desc, seq desc);

create function app.activity_feed(
  p_project_id uuid, p_module_key text, p_type_codes text[], p_mine boolean, p_after_event_id uuid, p_limit integer
)
  returns table (
    id uuid, created_at timestamptz, type text, audience text,
    company_name jsonb, member_name jsonb, transition_label jsonb, outcome text,
    work_item_id uuid, document_number text, title text, type_code text, type_name jsonb
  )
  language sql stable security invoker
  set search_path = pg_catalog, public
  as $$
    with page as (
      select e.id, e.created_at, e.seq, e.type, e.audience, e.work_item_id, e.actor_participant_id, e.actor_member_id,
        e.transition_id, e.payload ->> 'outcome' as outcome
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
          or exists (select 1 from work_item_event mine where mine.work_item_id = w.id and mine.actor_member_id = app.current_member_id()))
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
    left join workflow_transition tr on tr.id = p.transition_id
    order by p.created_at desc, p.work_item_id desc, p.seq desc
  $$;

revoke all on function app.activity_feed(uuid, text, text[], boolean, uuid, integer) from public;
grant execute on function app.activity_feed(uuid, text, text[], boolean, uuid, integer) to rabaed_app;
