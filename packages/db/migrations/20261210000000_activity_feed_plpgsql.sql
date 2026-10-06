-- app.activity_feed as plpgsql (RP-353 review; CODING_STANDARDS.md › Database).
--
-- It was `language sql` with `set search_path`, which PostgreSQL never inlines, so it
-- gained nothing from sql and was planned again on every call. Plain sql stays for small
-- invoker helpers that can be inlined; this one is plpgsql, keeping its plans for the
-- session. Same arguments, result, body and rules as 20261209000000_activity_feed.sql:
-- security invoker, read through RLS (layers 3 to 5, V5), another Company named by its
-- name only (V14), `answers_changed` left out (V19). `#variable_conflict use_column`
-- makes a name that is both a column and an output column mean the column, as in sql.

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
        order by p.created_at desc, p.work_item_id desc, p.seq desc;
    end
  $$;

revoke all on function app.activity_feed(uuid, text, text[], boolean, uuid, integer) from public;
grant execute on function app.activity_feed(uuid, text, text[], boolean, uuid, integer) to rabaed_app;
