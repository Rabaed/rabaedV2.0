-- RP-1139 PR 2 (visibility.md V14, owner's grill 2026-10-31, docs PR #535; scenarios RP-1139-5 to RP-1139-7):
-- no other Company reads a Member's id, the rest after PR 1 (20271214000000: an event's actor and a
-- Document's uploader). A sweep of the app role's column grants found five more Member id columns on
-- rows another Company reads:
--
-- * work_item.created_by_member_id: every Participant that sees the item read its raiser's id.
-- * numbering_pattern.set_by_member_id: every Participant of the Project read its setter's id.
-- * participant.invited_by_member_id and withdrawn_by_member_id: an invited Company reads its own
--   Participant row, whose inviter and withdrawer are the host's Project Admins.
-- * project.creator_member_id: every Participant of the Project read its creator's id.
--
-- None is granted to the app role now. No api read used them: the numbering pattern's setter is named
-- through app.numbering_pattern_versions (own Company only), and the writers are definers. The one
-- security-invoker reader the app role runs, app.activity_feed, compared the item's raiser with the
-- caller for "Items I'm on": it reads app.my_created_work_items now, once per call, beside #705's
-- app.my_acted_work_items. Its body is the newest (20271214000000), only that rule changed.
--
-- Every other `*_member_id` column still granted is on rows of the reader's own Member or own
-- Participant only (RLS), or is never set on a row another Company reads: document.removed_by_member_id
-- (a removed Document is no one's to read) and project_admin.appointed_by_member_id (own Company's admins
-- only, appointed by their own Company). work_item_link.created_by_member_id was never granted.
--
-- work_item's grants are by column already. numbering_pattern, participant and project were granted
-- whole, which a column revoke leaves standing: each is granted by column now, every column it had but
-- the Member id.
revoke select (created_by_member_id) on work_item from rabaed_app;
revoke select on numbering_pattern from rabaed_app;
grant select (id, project_id, work_item_type_id, segments, separator, seq_digits, seq_scope, shared_counter_accepted_at,
  admin_action_id, effective_from, created_at, follows_project) on numbering_pattern to rabaed_app;
revoke select on participant from rabaed_app;
grant select (id, project_id, company_id, project_role_id, status, withdrawn_at, created_at, updated_at, ordinal,
  invited_at, responded_at, code, code_locked_at) on participant to rabaed_app;
revoke select on project from rabaed_app;
grant select (id, host_company_id, project_number, code, name, status, closed_at, created_at, updated_at,
  show_inspections_in_submittals, record_language, record_hijri_dates, working_copy_watermark) on project to rabaed_app;

create function app.my_created_work_items(p_project_id uuid)
  returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      -- The items the reader's own Member raised, on a Project of theirs and that they still see: it names no one else.
      -- One set per call, so the Activity Feed asks it once, not per event.
      if p_project_id not in (select app.current_project_ids()) then
        return;
      end if;
      return query
        select w.id
        from work_item w
        where w.project_id = p_project_id and w.created_by_member_id = app.current_member_id()
          and app.sees_work_item(w.id);
    end
  $$;
revoke all on function app.my_created_work_items(uuid) from public;
grant execute on function app.my_created_work_items(uuid) to rabaed_app;

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
    declare
      -- The items the caller's own Member raised or acted on (RP-1139: neither the raiser nor the actor
      -- column is the app role's), asked once.
      v_mine uuid[] := array(select app.my_created_work_items(p_project_id) union select app.my_acted_work_items(p_project_id));
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
              or (w.id = any (v_mine)
                or exists (select 1 from step_assignment a where a.work_item_id = w.id and a.assignee_member_id = app.current_member_id())
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
          (w.id = any (v_mine)
            or exists (select 1 from step_assignment a where a.work_item_id = w.id and a.assignee_member_id = app.current_member_id())
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
