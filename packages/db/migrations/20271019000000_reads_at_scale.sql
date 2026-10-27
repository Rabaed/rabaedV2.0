-- RP-1050: reads at scale.
--
-- System UAT round 0 loaded one Project of 858 work items: Home took 18 s and the Lists 3 to 4.4 s. Every row the
-- work item query read asked app.sees_work_item about eleven times: once for row-level security, then again inside
-- each per-row helper it called (app.step_as_seen, app.work_item_holder, app.work_item_creation_date,
-- app.with_owner_review, app.latest_visible_revision, app.revision_chain), each of which checks the item it is given.
-- Each check built the reader's whole Trade and Location coverage, by recursion over the grants, for each of the
-- item's values. And a read of an item's events, assignments or values checked every work item in the database
-- (section 6). Nothing here changes who sees what:
--
-- 1. app.current_participant_ids reads the Company and the authorized Company once per call, not once per row.
-- 2. app.sees_work_item: the same rule, read cheaper. The Member and their Company are read once per call, not once
--    per joined row; app.current_project_ids is replaced by what it adds to the rest of the query (the Company is
--    active: the joined project_member row is the one it would find). A value is covered by a grant of all of its
--    dimension, or by a grant of it or of a value above it (app.values_covered_by_grant gives every value under the
--    grant's): one walk up from the value instead of the grant's whole set. Both the Member's grant and the
--    Participant's must cover it, as app.values_covered_by_project_member's intersect asks.
-- 3. app.step_as_seen, app.work_item_holder, app.work_item_creation_date and app.with_owner_review each get an
--    unchecked body (`<name>_unchecked`, for the Participants it is given), which the function itself calls after its
--    own app.sees_work_item check, so each rule is still written once. Only the migrator may run the unchecked bodies:
--    definer functions call them for items they have checked.
-- 4. app.work_items_seen: the visible items of one Project's Modules with what the work item query reads of each,
--    checking each item once. The work item query reads its rows from it.
-- 5. app.work_items_waiting_on_me: the Need My Action items, from the reader's own open assignments.
-- 6. The policies that read an item's rows through work_item ask for each row's item, not for every item.

-- 1. ------------------------------------------------------------------------------------------------------------
-- From 20261108000000_plpgsql_definer_helpers.sql: the Company and the authorized Company as variables.
create or replace function app.current_participant_ids() returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_company uuid := app.current_company_id();
      v_authorized uuid := app.current_authorized_company_id();
    begin
      return query
        select p.id from participant p
        where p.status = 'active'
          and p.company_id = v_company
          and (
            p.project_id in (select app.current_project_ids())
            or p.company_id = v_authorized
          );
    end
  $$;

-- 2. ------------------------------------------------------------------------------------------------------------
-- From 20270611000000_raiser_step_holder.sql. The Member and Company once; app.current_project_ids folded in; each
-- value's coverage by one walk up from it (the values as it arrived the same way as the live ones).
create or replace function app.sees_work_item(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_member uuid := app.current_member_id();
      v_company uuid;
    begin
      -- app.current_company_id, and app.current_project_ids' own conditions on the Member and Company: an active
      -- Member of an active Company. The query's project_member and participant rows are the rest of them.
      select m.company_id into v_company
      from member m join company co on co.id = m.company_id
      where m.id = v_member and m.status = 'active' and co.status = 'active';
      if v_company is null then
        return false;
      end if;
      return (
        select exists (
          select 1
          from work_item w
          join project_member pm on pm.project_id = w.project_id
          join participant p on p.id = pm.participant_id
          join work_item_access a on a.work_item_id = w.id and a.participant_id = pm.participant_id
          join participant raiser on raiser.id = w.raised_by_participant_id
          join project_role raiser_role on raiser_role.id = raiser.project_role_id
          join workflow_step s on s.id = w.current_step_id
          -- Whether the reader's Participant holds it: then it reads the values as they are now.
          cross join lateral (
            select w.built_ins_as_arrived is null or exists (
              select 1 from step_assignment h
              where h.work_item_id = w.id and h.status in ('pooled', 'picked_up', 'vacant') and h.participant_id = pm.participant_id
            ) as live
          ) reads
          where w.id = p_work_item_id
            and pm.member_id = v_member and pm.status = 'active'
            and p.status = 'active' and p.company_id = v_company
            and (p.id = w.raised_by_participant_id or w.submitted_at is not null
              or app.actor_role(s.actor_rule, raiser_role.base_role) is distinct from raiser_role.base_role)
            and (w.document_number is not null or s.drafts_visible_to is distinct from 'author'
              or exists (
                select 1 from step_assignment h
                where h.work_item_id = w.id and h.status = 'picked_up' and h.assignee_member_id = pm.member_id))
            -- Each value it is read with (as it is now, or as it arrived) covered by the Member's grant and by
            -- their Participant's.
            and not exists (
              select 1
              from (
                select dv.dimension_id, dv.dimension_value_id as value_id
                from work_item_dimension_value dv
                where reads.live and dv.work_item_id = w.id
                union all
                select v.key::uuid, v.value::uuid
                from jsonb_each_text(w.built_ins_as_arrived -> 'dimensions') v
                where not reads.live
              ) d
              -- A grant of all of the dimension covers a value of it (a value's parent is of its dimension:
              -- dimension_value_parent_fk). A grant of some values covers each of them and every value under one,
              -- so a value it or a value above it is granted. A value that is no dimension_value is granted by none
              -- (visibility_grant_value_value_fk).
              cross join lateral (
                select
                  exists (select 1 from dimension_value v where v.id = d.value_id and v.dimension_id = d.dimension_id) as in_dimension,
                  array(
                    with recursive up (id) as (
                      select d.value_id
                      union
                      select parent.id
                      from up cross join lateral (select v.parent_id as id from dimension_value v where v.id = up.id) parent
                      where parent.id is not null
                    )
                    select up.id from up
                  ) as ids
              ) value
              cross join lateral (
                select
                  exists (
                    select 1 from visibility_grant g
                    where g.project_member_id = pm.id and g.dimension_id = d.dimension_id
                      and case when g.is_all then value.in_dimension
                        else exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id and gv.dimension_value_id = any(value.ids)) end
                  ) as by_member,
                  exists (
                    select 1 from visibility_grant g
                    where g.participant_id = pm.participant_id and g.project_member_id is null and g.dimension_id = d.dimension_id
                      and case when g.is_all then value.in_dimension
                        else exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id and gv.dimension_value_id = any(value.ids)) end
                  ) as by_participant
              ) covered
              where not (covered.by_member and covered.by_participant)
            )
        )
      );
    end
  $$;

-- 3. ------------------------------------------------------------------------------------------------------------
-- From 20270115000000_return_in_internal_review.sql: app.step_as_seen's body, for the Participants p_participant_ids.
create function app.step_as_seen_unchecked(p_work_item_id uuid, p_participant_ids uuid[])
  returns table(step_id uuid, stage_key text, entered_at timestamp with time zone)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select s.id, s.stage_key,
          case
            -- A Draft (never left its Draft Step, so never numbered): its Step began when it
            -- was started, which reaches nobody (ADR 0020; visibility.md "Creation Date").
            when w.document_number is null and app.is_draft_step(w.current_step_id) then null
            when h.mine then w.step_entered_at
            else w.participant_entered_at
          end
        from work_item w
        cross join lateral (
          select exists (
            select 1 from step_assignment a
            where a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
              and a.participant_id = any(p_participant_ids)
          ) as mine
        ) h
        join workflow_step s on s.id = case when h.mine then w.current_step_id else w.participant_entered_step_id end
        where w.id = p_work_item_id;
    end
  $$;

create or replace function app.step_as_seen(p_work_item_id uuid)
  returns table(step_id uuid, stage_key text, entered_at timestamp with time zone)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query select * from app.step_as_seen_unchecked(p_work_item_id, array(select app.current_participant_ids()));
    end
  $$;

-- From 20270110000000_pick_up_rename.sql.
create function app.work_item_holder_unchecked(p_work_item_id uuid, p_participant_ids uuid[])
  returns table(participant_id uuid, assignee_member_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select a.participant_id,
          case when a.participant_id = any(p_participant_ids) then a.assignee_member_id end
        from step_assignment a
        where a.work_item_id = p_work_item_id and a.status in ('pooled', 'picked_up', 'vacant');
    end
  $$;

create or replace function app.work_item_holder(p_work_item_id uuid)
  returns table(participant_id uuid, assignee_member_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query select * from app.work_item_holder_unchecked(p_work_item_id, array(select app.current_participant_ids()));
    end
  $$;

-- From 20261109000000_send_back.sql.
create function app.work_item_creation_date_unchecked(p_work_item_id uuid, p_participant_ids uuid[]) returns timestamptz
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select w.numbered_at from work_item w
        where w.id = p_work_item_id
          and w.raised_by_participant_id = any(p_participant_ids)
      );
    end
  $$;

create or replace function app.work_item_creation_date(p_work_item_id uuid) returns timestamptz
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      return app.work_item_creation_date_unchecked(p_work_item_id, array(select app.current_participant_ids()));
    end
  $$;

-- From 20270409000300_with_owner_review.sql.
create function app.with_owner_review_unchecked(p_work_item_id uuid, p_participant_ids uuid[]) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if exists (
        select 1
        from work_item w
        join workflow_step s on s.id = w.current_step_id and s.outcome_mode = 'confirm_code'
        where w.id = p_work_item_id and w.closed_at is null
          -- Not the Participant holding the review.
          and not exists (
            select 1 from step_assignment a
            where a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
              and a.participant_id = any(p_participant_ids))
          -- Nor the Consultant whose Recommendation brought it there (app.recommendation_to_confirm,
          -- read here past row-level security: that Submit is internal to the two).
          and not exists (
            select 1 from (
              select e.actor_participant_id from work_item_event e
              where e.work_item_id = w.id and e.type = 'transition' and e.to_step_id = w.current_step_id
              order by e.seq desc limit 1
            ) last
            where last.actor_participant_id = any(p_participant_ids))
      ) then
        return '{"en": "Owner review", "ar": "مراجعة المالك"}'::jsonb;
      end if;
      return null;
    end
  $$;

create or replace function app.with_owner_review(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      return app.with_owner_review_unchecked(p_work_item_id, array(select app.current_participant_ids()));
    end
  $$;

revoke all on function app.step_as_seen_unchecked(uuid, uuid[]) from public;
revoke all on function app.work_item_holder_unchecked(uuid, uuid[]) from public;
revoke all on function app.work_item_creation_date_unchecked(uuid, uuid[]) from public;
revoke all on function app.with_owner_review_unchecked(uuid, uuid[]) from public;

-- 4. ------------------------------------------------------------------------------------------------------------
-- The items of Project p_project_id in Modules p_module_keys the reader sees, each checked once (app.sees_work_item),
-- with what the work item query reads of each:
-- * its columns the app role may read;
-- * its Step, Stage and Step Age as seen (app.step_as_seen), its holder (app.work_item_holder, the first one), its
--   Creation Date (app.work_item_creation_date), and "Owner review" where its Step as seen confirms a Code
--   (app.with_owner_review);
-- * unless p_all_revisions, only the latest Revision of each chain the reader sees (app.latest_visible_revision); and
--   whether a Revision of its chain they see got an outcome that offers a Revision, Code C (app.revision_chain, with
--   app.outcome_offers). Every Revision of a chain is of the item's Type, so in the scope: the Revisions the reader sees
--   are the checked items of its chain, and neither asks any other item;
-- * the Trade and Location values it is read with, as work_item_dimension_value_seen gives them (as it arrived, unless
--   one of the reader's Participants holds it: app.holds_work_item), as two arrays of one entry per value;
-- * the holder's and the raiser's Company by name, which app.work_item_companies gives everyone who sees the item (a
--   Participant holding or raising it is always one of its Companies); the holder's even where "Owner review" is read
--   in its place, which the caller leaves out there.
create function app.work_items_seen(p_project_id uuid, p_module_keys text[], p_all_revisions boolean)
  returns table(
    id uuid, project_id uuid, work_item_type_id uuid, title text, document_number text, revision_no integer,
    outcome text, paper_ref text, submitted_at timestamptz, raised_by_participant_id uuid, closed_at timestamptz,
    step_id uuid, stage_key text, entered_at timestamptz, holder_participant_id uuid, holder_member_id uuid,
    owner_review jsonb, had_code_c boolean, creation_date timestamptz, dimension_ids uuid[], dimension_value_ids uuid[],
    holder_company_name jsonb, raiser_company_name jsonb
  )
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_mine uuid[] := array(select app.current_participant_ids());
    begin
      return query
        -- The scope's items first, then the check, so no other Module's item is checked.
        with scoped as materialized (
          select w.id, w.project_id, w.work_item_type_id, w.root_id, w.revision_no, w.outcome, w.discarded_at
          from work_item w
          join work_item_type t on t.id = w.work_item_type_id
          where w.project_id = p_project_id and t.module_key = any(p_module_keys)
        ), checked as materialized (
          select s.* from scoped s where app.sees_work_item(s.id)
        ), seen as materialized (
          select c.id, c.root_id from checked c
          where p_all_revisions or not exists (
            select 1 from checked o
            where o.root_id = c.root_id and o.revision_no > c.revision_no and o.discarded_at is null)
        ), code_c as (
          select distinct o.root_id from checked o
          where o.discarded_at is null and o.outcome is not null
            and app.outcome_offers(o.project_id, o.work_item_type_id, o.outcome, 'offer_revision')
        ), held as (
          select distinct a.work_item_id from step_assignment a join seen on seen.id = a.work_item_id
          where a.status in ('pooled', 'picked_up', 'vacant') and a.participant_id = any(v_mine)
        ), dimensions as (
          select x.work_item_id, array_agg(x.dimension_id) as dimension_ids, array_agg(x.value_id) as value_ids
          from (
            select dv.work_item_id, dv.dimension_id, dv.dimension_value_id as value_id
            from seen
            join work_item w on w.id = seen.id
            join work_item_dimension_value dv on dv.work_item_id = w.id
            where w.built_ins_as_arrived is null or seen.id in (select held.work_item_id from held)
            union all
            select w.id, v.key::uuid, v.value::uuid
            from seen
            join work_item w on w.id = seen.id
            cross join lateral jsonb_each_text(w.built_ins_as_arrived -> 'dimensions') v
            where w.built_ins_as_arrived is not null and seen.id not in (select held.work_item_id from held)
          ) x
          group by x.work_item_id
        )
        select w.id, w.project_id, w.work_item_type_id, w.title, w.document_number, w.revision_no,
          w.outcome, w.paper_ref, w.submitted_at, w.raised_by_participant_id, w.closed_at,
          step.step_id, step.stage_key, step.entered_at, h.participant_id, h.assignee_member_id,
          case when s.outcome_mode = 'confirm_code' then app.with_owner_review_unchecked(w.id, v_mine) end,
          seen.root_id in (select code_c.root_id from code_c),
          app.work_item_creation_date_unchecked(w.id, v_mine),
          coalesce(d.dimension_ids, '{}'), coalesce(d.value_ids, '{}'),
          holder_company.legal_name, raiser_company.legal_name
        from seen
        join work_item w on w.id = seen.id
        cross join lateral app.step_as_seen_unchecked(w.id, v_mine) step
        join workflow_step s on s.id = step.step_id
        left join lateral (select * from app.work_item_holder_unchecked(w.id, v_mine) limit 1) h on true
        left join dimensions d on d.work_item_id = w.id
        left join participant holder on holder.id = h.participant_id
        left join company holder_company on holder_company.id = holder.company_id
        left join participant raiser on raiser.id = w.raised_by_participant_id
        left join company raiser_company on raiser_company.id = raiser.company_id;
    end
  $$;

revoke all on function app.work_items_seen(uuid, text[], boolean) from public;
grant execute on function app.work_items_seen(uuid, text[], boolean) to rabaed_app;

-- 5. ------------------------------------------------------------------------------------------------------------
-- The items of Projects p_project_ids waiting on the reader (app.need_my_action is 'waiting'), the latest Revision of
-- each chain they see (app.latest_visible_revision): the Projects page's Need My Action count and Home's list. It was
-- a read of every visible item joined to the open assignments the reader's Participants may read; it now starts from
-- those assignments (a pooled or picked-up Step of one of the reader's Participants), so it asks only of the items
-- one of them holds, and asks for the Revision only of those waiting on them. An item has one open assignment
-- (step_assignment_open_key), and app.need_my_action says 'waiting' only when it is pooled, or picked up by the
-- reader: one a colleague picked up is not asked about.
create function app.work_items_waiting_on_me(p_project_ids uuid[]) returns table(project_id uuid, work_item_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_mine uuid[] := array(select app.current_participant_ids());
      v_me uuid := app.current_member_id();
    begin
      return query
        select distinct a.project_id, a.work_item_id
        from step_assignment a
        where a.project_id = any(p_project_ids)
          and (a.status = 'pooled' or (a.status = 'picked_up' and a.assignee_member_id = v_me))
          and a.participant_id = any(v_mine)
          and case when app.need_my_action(a.work_item_id) = 'waiting'
            then app.latest_visible_revision(a.work_item_id) else false end;
    end
  $$;

revoke all on function app.work_items_waiting_on_me(uuid[]) from public;
grant execute on function app.work_items_waiting_on_me(uuid[]) to rabaed_app;

-- 6. ------------------------------------------------------------------------------------------------------------
-- The policies of the tables read through the item's own asked `<column> in (select id from work_item)`. PostgreSQL
-- ran that subquery once per statement as a set: app.sees_work_item on every row of work_item, every Company's, even
-- to read one item's three events (2,204 checks, 162 ms, in the RP-1050 seam test). work_item has one policy for the
-- app role, app.sees_work_item(id), so the subquery asks exactly app.sees_work_item(<column>), and now the policies
-- say so: each row read is checked for its own item, and nothing else is. The two that also read the item's values
-- as it arrived ask `exists (select 1 from work_item ...)` for that item, which the planner may still read as a set
-- when it reads many rows. Each condition is otherwise as it was; the columns are never null where asked.
-- The work_item policy first keeps to the reader's Projects, which app.sees_work_item asks too, so a read of many
-- items checks none of another Project's.
alter policy member_reads_visible_work_items on work_item
  using (project_id in (select app.current_project_ids()) and app.sees_work_item(id));

alter policy member_reads_visible_work_item_values on work_item_dimension_value
  using (exists (
    select 1 from work_item w
    where w.id = work_item_dimension_value.work_item_id and (w.built_ins_as_arrived is null or app.holds_work_item(w.id))));

alter policy member_reads_visible_work_item_scopes on work_item_scope
  using (exists (
    select 1 from work_item w
    where w.id = work_item_scope.work_item_id and (w.built_ins_as_arrived is null or app.holds_work_item(w.id))));

alter policy member_reads_visible_step_assignments on step_assignment
  using (participant_id in (select app.current_participant_ids()) and app.sees_work_item(work_item_id));

alter policy member_reads_visible_work_item_access on work_item_access
  using (app.sees_work_item(work_item_id));

alter policy member_reads_visible_work_item_events on work_item_event
  using (type <> 'created'
    and app.sees_work_item(work_item_id)
    and (audience = 'shared' or audience_participant_id in (select app.current_participant_ids())));

alter policy member_reads_own_notifications on notification
  using (member_id = app.current_member_id() and in_app and withdrawn_at is null
    and case when package_id is null
      then app.sees_work_item(work_item_id)
      else app.package_notification_count(id) > 0 end);

alter policy member_reads_documents on document
  using (confirmed_at is not null and removed_at is null
    and project_id in (select app.current_project_ids())
    and app.sees_work_item(work_item_id)
    and app.item_row_seen(work_item_id, arrival, false));

alter policy member_reads_work_item_links on work_item_link
  using (project_id in (select app.current_project_ids())
    and app.sees_work_item(from_id)
    and app.item_row_seen(from_id, arrival, removed_at is not null));

alter policy member_reads_work_item_checklists on work_item_checklist
  using (app.sees_work_item(work_item_id));
