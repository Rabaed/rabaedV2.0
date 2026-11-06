-- RP-1157 (the Activity Feed page to the owner's reference; visibility.md "Activity Feed", V5, V14;
-- scenarios RP-1157-1 and RP-1157-2): two flags on each entry, both about the viewer only.
--
-- * on_item: the viewer is on the entry's item, by the rule "Only items I'm on" already filters
--   by (raised it, holds or held one of its Steps, acted on it, or watches its chain). The page
--   shows "You're on this item". It never says that another Member is on it: it is the filter's
--   own answer, per entry, for the one Member reading.
-- * by_me: the viewer took the event (the page's "(you)" after their own name).
--
-- app.activity_feed is rebuilt from its newest body (20271123000000_event_from_step_own_participant)
-- with the two columns added; every row, filter, name and label is read as before. A function's
-- result columns can't change in place, so it is dropped and created again, with its grants.

drop function app.activity_feed(uuid, text, text[], boolean, uuid, integer);

create function app.activity_feed(
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
          select e.id, e.created_at, e.seq, e.type, e.audience, e.work_item_id, e.actor_participant_id, e.actor_member_id,
            e.payload ->> 'outcome' as outcome, mine.on_item,
            coalesce(e.actor_member_id = app.current_member_id(), false) as by_me
          from work_item_event e
          join work_item w on w.id = e.work_item_id
          join work_item_type t on t.id = w.work_item_type_id
          -- "Items I'm on": the caller raised it, holds or held a Step of it, acted on it, or watches it.
          cross join lateral (
            select (w.created_by_member_id = app.current_member_id()
              or exists (select 1 from step_assignment a where a.work_item_id = w.id and a.assignee_member_id = app.current_member_id())
              or exists (select 1 from work_item_event mine where mine.work_item_id = w.id and mine.actor_member_id = app.current_member_id())
              -- Watched (RP-354): the caller's own Watch on the item's chain.
              or app.watching_work_item(w.id)) is true as on_item
          ) mine
          where e.project_id = p_project_id
            and e.type <> 'answers_changed'
            and (p_module_key is null or t.module_key = p_module_key)
            and (cardinality(coalesce(p_type_codes, '{}')) = 0 or t.code = any(p_type_codes))
            and (not coalesce(p_mine, false) or mine.on_item)
            and (p_after_event_id is null or (e.created_at, e.work_item_id, e.seq) < (
              select a.created_at, a.work_item_id, a.seq from work_item_event a where a.id = p_after_event_id))
          order by e.created_at desc, e.work_item_id desc, e.seq desc
          limit greatest(1, least(coalesce(p_limit, 30), 101))
        )
        select p.id, p.created_at, p.type, p.audience, actor.legal_name, m.full_name, tr.label, p.outcome,
          w.id, w.document_number, w.title, t.code, t.name, p.on_item, p.by_me
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

revoke all on function app.activity_feed(uuid, text, text[], boolean, uuid, integer) from public;
grant execute on function app.activity_feed(uuid, text, text[], boolean, uuid, integer) to rabaed_app;
