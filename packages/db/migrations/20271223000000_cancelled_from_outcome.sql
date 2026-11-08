-- RP-1263 (RP-952 Q4 (a), owner 2026-11-08): Cancelled is read from the item's outcome, `cancelled`,
-- everywhere; no Workflow gets a Cancelled Step. When Rabaed cancels an item at a Participant's
-- withdrawal (app.withdraw_participant) and its Workflow Version has no Step in a cancelled Stage, the
-- item stays at its Step. Every reader still reads it Cancelled:
--
-- * app.stage_key_as_read: the Stage an item reads as. A cancelled item whose Step's Stage is not a
--   cancelled one reads its Module's Cancelled Stage on its Project (the first by order); any other item
--   its Step's own Stage. Definitions only (stage, work_item_type), which every Member of the Project
--   reads (policy member_reads_stages); internal, granted to nobody.
-- * app.step_as_seen_unchecked and app.work_item_shared_stage give that Stage, so the List, its Stage
--   counts and its "open" filter, the Kanban's columns, Home's counts, the detail page, the Revisions
--   and the shared download all read it Cancelled, and never as open work (query.ts: `closed` is the
--   Stage's category). Need My Action and the Step Pool already skip it: it is closed and its Steps done.
-- * app.step_as_seen and app.work_items_seen give a closed item's Step only while it reads that Step's
--   own Stage, so a cancelled item is never shown at the Step it stopped at.
-- * Every Module has a Cancelled Stage (GLOSSARY.md › Stage, Main 1's answer on RP-1263): the Snag
--   List's Rabaed Defaults gain "Cancelled" / "ملغى", last, which app.copy_rabaed_stages copies to every
--   new Project; each Project Module with no cancelled-category Stage gets one, last, as its own. A
--   Project's own renamed or added Stages are left as they are. app.delete_stage refuses to delete a
--   Module's last cancelled Stage: 'last_cancelled_stage'.
--
-- No column, no grant, no policy changes. Like RP-622's Snag Stages (20270429000000_snag_type) the new
-- Stages are the platform's, so no project_event is written for them.

-- 1. -------------------------------------------------------------------------------------------------
create function app.stage_key_as_read(p_project_id uuid, p_work_item_type_id uuid, p_outcome text, p_stage_key text) returns text
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select case
      when p_outcome is distinct from 'cancelled' then p_stage_key
      -- Its own Stage when that is a cancelled one; else its Module's first Cancelled Stage.
      else coalesce((
        select c.key from stage c
        join work_item_type t on t.id = p_work_item_type_id
        where c.owner_kind = 'project' and c.project_id = p_project_id and c.module_key = t.module_key and c.category = 'cancelled'
        order by (c.key = p_stage_key) desc, c.sort, c.key
        limit 1
      ), p_stage_key)
    end
  $$;
revoke all on function app.stage_key_as_read(uuid, uuid, text, text) from public;

-- 2. -------------------------------------------------------------------------------------------------
-- From 20271019000000_reads_at_scale.sql.
create or replace function app.step_as_seen_unchecked(p_work_item_id uuid, p_participant_ids uuid[])
  returns table(step_id uuid, stage_key text, entered_at timestamp with time zone)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select s.id,
          -- A cancelled item reads its Module's Cancelled Stage, whatever Step it stopped at (RP-1263). Asked of a
          -- cancelled item only, so the List's read of every other row calls nothing more than before.
          case when w.outcome = 'cancelled' then app.stage_key_as_read(w.project_id, w.work_item_type_id, w.outcome, s.stage_key)
            else s.stage_key end,
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

-- 3. -------------------------------------------------------------------------------------------------
-- From 20271126000000_step_hidden_outside_holder.sql.
create or replace function app.step_as_seen(p_work_item_id uuid)
  returns table(step_id uuid, stage_key text, entered_at timestamp with time zone, holder_role text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_mine uuid[];
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      v_mine := array(select app.current_participant_ids());
      return query
        select
          -- The holding Participant's own Step, or a closed item's terminal Step; never another Company's (V14).
          -- Never the Step a cancelled item stopped at, outside a Cancelled Stage (RP-1263).
          case when (w.closed_at is not null and seen.stage_key = s.stage_key) or app.holds_work_item(w.id) then seen.step_id end,
          seen.stage_key, seen.entered_at,
          app.actor_role(s.actor_rule, app.work_item_raiser_role(w.id))
        from app.step_as_seen_unchecked(p_work_item_id, v_mine) seen
        join work_item w on w.id = p_work_item_id
        join workflow_step s on s.id = seen.step_id;
    end
  $$;

-- 4. -------------------------------------------------------------------------------------------------
-- From 20271126000000_step_hidden_outside_holder.sql.
create or replace function app.work_items_seen(p_project_id uuid, p_module_keys text[], p_all_revisions boolean, p_work_item_ids uuid[] default null)
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
            and (p_work_item_ids is null or w.root_id in (select o.root_id from work_item o where o.id = any(p_work_item_ids)))
        ), checked as materialized (
          select s.* from scoped s where app.sees_work_item(s.id)
        ), seen as materialized (
          select c.id, c.root_id from checked c
          where (p_work_item_ids is null or c.id = any(p_work_item_ids))
            and (p_all_revisions or not exists (
              select 1 from checked o
              where o.root_id = c.root_id and o.revision_no > c.revision_no and o.discarded_at is null))
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
          -- The holding Participant's own Step, or a closed item's terminal Step; never another Company's (V14).
          -- Never the Step a cancelled item stopped at, outside a Cancelled Stage (RP-1263).
          case when (w.closed_at is not null and step.stage_key = s.stage_key) or seen.id in (select held.work_item_id from held) then step.step_id end,
          step.stage_key, step.entered_at, h.participant_id, h.assignee_member_id,
          case when s.outcome_mode = 'confirm_code' then app.with_owner_review_unchecked(w.id, v_mine) end,
          seen.root_id in (select code_c.root_id from code_c),
          app.work_item_creation_date_unchecked(w.id, v_mine),
          coalesce(d.dimension_ids, '{}'), coalesce(d.value_ids, '{}'),
          holder_company.legal_name, raiser_company.legal_name
        from seen
        join work_item w on w.id = seen.id
        cross join lateral app.step_as_seen_unchecked(w.id, v_mine) step
        -- Read here only for the Owner's review label and whether it reads its Step's own Stage, never returned.
        join workflow_step s on s.id = step.step_id
        left join lateral (select * from app.work_item_holder_unchecked(w.id, v_mine) limit 1) h on true
        left join dimensions d on d.work_item_id = w.id
        left join participant holder on holder.id = h.participant_id
        left join company holder_company on holder_company.id = holder.company_id
        left join participant raiser on raiser.id = w.raised_by_participant_id
        left join company raiser_company on raiser_company.id = raiser.company_id;
    end
  $$;

-- 5. -------------------------------------------------------------------------------------------------
-- From 20270117000400_list_row_commands.sql.
create or replace function app.work_item_shared_stage(p_work_item_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        -- A cancelled item reads its Module's Cancelled Stage (RP-1263).
        select app.stage_key_as_read(w.project_id, w.work_item_type_id, w.outcome, s.stage_key) from work_item w
        join workflow_step s on s.id = w.participant_entered_step_id
        where w.id = p_work_item_id and app.sees_work_item(w.id) and w.submitted_at is not null
      );
    end
  $$;

-- 6. -------------------------------------------------------------------------------------------------
-- From 20261229000000_project_stages.sql. Outcomes as before, and 'last_cancelled_stage': the Module's
-- only cancelled Stage, which a cancelled item reads (RP-1263).
create or replace function app.delete_stage(p_project_id uuid, p_module_key text, p_key text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_refusal text := app.stage_command_refusal(p_project_id, p_module_key);
      v_stage stage;
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      select * into v_stage from stage
      where project_id = p_project_id and module_key = p_module_key and key = p_key;
      if v_stage.id is null then
        return 'not_found';
      end if;
      if app.stage_in_use(p_project_id, p_module_key, p_key) then
        return 'stage_in_use';
      end if;
      if v_stage.category = 'cancelled' and not exists (
        select 1 from stage o
        where o.project_id = p_project_id and o.module_key = p_module_key and o.category = 'cancelled' and o.id <> v_stage.id
      ) then
        return 'last_cancelled_stage';
      end if;
      delete from stage where id = v_stage.id;
      perform app.write_project_event(p_project_id, 'stage_removed',
        jsonb_build_object('module', p_module_key, 'key', p_key, 'name', v_stage.name, 'category', v_stage.category));
      return 'removed';
    end
  $$;

-- 7. -------------------------------------------------------------------------------------------------
-- The Rabaed Defaults: a Cancelled Stage, last, for each Module with none (the Snag List). A new Rabaed
-- Default reaches only Projects created from now on (20270207000000_default_sets_reach_new_projects);
-- step 8 gives the existing ones theirs.
insert into stage (owner_kind, module_key, key, name, category, sort)
select 'rabaed', m.module_key, 'cancelled', '{"en": "Cancelled", "ar": "ملغى"}', 'cancelled', max(m.sort) + 1
from stage m
where m.owner_kind = 'rabaed'
group by m.module_key
having not bool_or(m.category = 'cancelled') and not bool_or(m.key = 'cancelled');

-- 8. -------------------------------------------------------------------------------------------------
-- Each Project Module with no cancelled-category Stage gets one, last, as its own: key `cancelled`, or
-- `rabaed_cancelled` where the Project already uses that key for another kind of Stage.
insert into stage (owner_kind, project_id, module_key, key, name, category, sort)
select 'project', m.project_id, m.module_key,
  case when bool_or(m.key = 'cancelled') then 'rabaed_cancelled' else 'cancelled' end,
  '{"en": "Cancelled", "ar": "ملغى"}', 'cancelled', max(m.sort) + 1
from stage m
where m.owner_kind = 'project'
group by m.project_id, m.module_key
having not bool_or(m.category = 'cancelled');
