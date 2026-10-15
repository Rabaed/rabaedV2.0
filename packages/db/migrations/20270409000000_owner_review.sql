-- Spec RP-598, RP-593: the Owner's review (ADR 0022; workflow-engine.md §1, §3.1, §5.3a;
-- visibility.md V5, scenarios RP-593-1 to RP-593-3). Renamed from 20270401000000 to sort
-- after main's latest migration (20270404000000, PR #208).
--
-- * A Step may confirm a Code (`outcome_mode` `confirm_code`): it is reached by a Submit that
--   carries a Code (`workflow_transition.outcome`) from a Step that Recommends a Code, the
--   Consultant PM's Recommended Code to the Owner. Its closes, one per Code, issue it: only the
--   one whose outcome is the Code the item came with is offered and taken
--   (app.confirm_allowed, read by app.takeable_transitions, app.transition_routed and
--   app.take_transition). The publish checks (@rabaed/domain, workflow-checks.ts) keep the
--   shape.
-- * The Recommended Code and the moves of the review (the Recommendation, the Owner's Send
--   Back) are read by the two Participants of the exchange only: each event is written once
--   internal to the Consultant and once internal to the Participant holding the review, so
--   every read that keeps V5 (the events' RLS, the history, the Activity Feed, notifications)
--   keeps the Contractor and everyone else out without change. The Owner's Confirm is a shared
--   `issue_code` event, as any issued Code.
-- * Confirming runs the Code's result as an issued Code does: Code B's Comments are made from
--   the Recommendation's rows (its shared answers), raised by the Consultant and its Member who
--   recommended it, the reviewer of record (app.transition_follow_up_items takes the Member).
-- * The Owner's review is held by an Owner Representative covering the item where the Project
--   has one, else by the Owner (app.next_step_holder), for a confirming Step of the Owner's role.
-- * Rabaed Default Positions "Project Manager" for the Owner and the Owner Representative, with
--   View, Review and Approve in the Submittals: the PM who confirms (ADR 0022).
--
-- Rebuilt from their latest bodies: app.take_transition
-- (20270117100000_raisers_form_review_fixes.sql), app.transition_effects
-- (20270118100000_retire_other_participant_sections.sql), app.next_step_holder
-- (20270107000000_code_b_comments.sql), app.takeable_transitions
-- (20270106600000_cancel_not_for_revisions.sql), app.transition_routed
-- (20261230000000_transition_rules.sql), app.transition_follow_up_items
-- (20270323000000_project_form_for_new_items.sql).

alter table workflow_step drop constraint workflow_step_outcome_mode_check;
alter table workflow_step add constraint workflow_step_outcome_mode_check
  check (outcome_mode in ('none', 'recommend_code', 'issue_code', 'inspection_result', 'confirm_code'));

-- Positions ----------------------------------------------------------------------------------

insert into position (owner_kind, base_role, key, name, sort) values
  ('rabaed', 'owner', 'project_manager', '{"en": "Project Manager", "ar": "مدير المشروع"}', 2),
  ('rabaed', 'owner_representative', 'project_manager', '{"en": "Project Manager", "ar": "مدير المشروع"}', 2);

insert into position_permission (position_id, module_key, permission)
select p.id, 'submittals', x.permission
from (values ('view'), ('review'), ('approve')) as x (permission)
join position p on p.owner_kind = 'rabaed' and p.base_role in ('owner', 'owner_representative') and p.key = 'project_manager';

-- The Code to confirm ---------------------------------------------------------------------------

-- The Recommendation item p_work_item_id holds a confirming Step with: the latest move that
-- brought it there (either copy: they are the same move), its Transition, who took it, its
-- shared answers and the Code it carries. No row at any other Step. Internal: its callers
-- (security definer) check who asks.
create function app.recommendation_to_confirm(p_work_item_id uuid)
  returns table (transition_id uuid, actor_participant_id uuid, actor_member_id uuid, answers jsonb, code text)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select last.transition_id, last.actor_participant_id, last.actor_member_id,
          last.payload - 'document_number' - 'outcome', tr.outcome
        from work_item w
        join workflow_step s on s.id = w.current_step_id and s.outcome_mode = 'confirm_code'
        cross join lateral (
          select e.transition_id, e.actor_participant_id, e.actor_member_id, e.payload from work_item_event e
          where e.work_item_id = w.id and e.type = 'transition' and e.to_step_id = w.current_step_id
          order by e.seq desc limit 1
        ) last
        join workflow_transition tr on tr.id = last.transition_id
        where w.id = p_work_item_id;
    end
  $$;

-- The Code item p_work_item_id holds a confirming Step with (its Recommendation's); null at
-- any other Step. Internal.
create function app.code_to_confirm(p_work_item_id uuid) returns text
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return (select r.code from app.recommendation_to_confirm(p_work_item_id) r);
    end
  $$;

-- Whether Transition p_transition_id may be taken on item p_work_item_id as far as the Owner's
-- review goes: a close from a confirming Step only when it sets the Code to confirm (the Owner
-- picks none of its own, ADR 0022); every other Transition, yes. Internal.
create function app.confirm_allowed(p_work_item_id uuid, p_transition_id uuid) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return not exists (
        select 1 from workflow_transition tr
        join workflow_step s on s.id = tr.from_step_id
        where tr.id = p_transition_id and s.outcome_mode = 'confirm_code' and tr.kind = 'close'
          and tr.outcome is distinct from app.code_to_confirm(p_work_item_id)
      );
    end
  $$;

revoke all on function app.recommendation_to_confirm(uuid) from public;
revoke all on function app.code_to_confirm(uuid) from public;
revoke all on function app.confirm_allowed(uuid, uuid) from public;

-- Routing among Transitions sharing a label: the Owner's one "Confirm" goes to the close of the Code it confirms.
create or replace function app.transition_routed(p_work_item_id uuid, p_transition_id uuid, p_answers jsonb) returns uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_ids uuid[];
    begin
      if not exists (
        select 1 from workflow_transition tr
        join workflow_transition g on g.workflow_version_id = tr.workflow_version_id and g.from_step_id = tr.from_step_id
          and g.label = tr.label and g.id <> tr.id
        where tr.id = p_transition_id)
      then
        return p_transition_id;
      end if;
      select array_agg(g.id) into v_ids
      from workflow_transition tr
      join workflow_transition g on g.workflow_version_id = tr.workflow_version_id and g.from_step_id = tr.from_step_id
        and g.label = tr.label
      where tr.id = p_transition_id and app.transition_conditions_hold(p_work_item_id, g.rules, coalesce(p_answers, '{}'))
        and app.confirm_allowed(p_work_item_id, g.id);
      return case when cardinality(v_ids) = 1 then v_ids[1] end;
    end
  $$;

create or replace function app.takeable_transitions(p_work_item_id uuid) returns table(transition_id uuid, key text, label jsonb, kind text, sort integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select distinct on (tr.label) tr.id, tr.key, tr.label, tr.kind, tr.sort
        from app.held_work_item(p_work_item_id) h
        join work_item w on w.id = h.work_item_id
        join workflow_transition tr on tr.workflow_version_id = h.workflow_version_id and tr.from_step_id = h.current_step_id
        where app.project_member_has_permission(h.project_member_id, h.module_key, tr.permission)
          and (select n.outcome from app.next_step_holder(h.work_item_id, tr.id) n) in ('ok', 'terminal')
          and app.transition_restrictions_hold(h.work_item_id, tr.rules, h.project_member_id, h.participant_id)
          and app.cancel_allowed(tr.kind, h.submitted_at, w.revision_no)
          -- The Owner's review: only the close of the Code it confirms (ADR 0022).
          and app.confirm_allowed(h.work_item_id, tr.id)
          and (app.transition_routed(h.work_item_id, tr.id, '{}') is distinct from tr.id
            or app.transition_conditions_hold(h.work_item_id, tr.rules, '{}'))
        order by tr.label, tr.sort;
    end
  $$;

-- Who holds the Owner's review ------------------------------------------------------------------

create or replace function app.next_step_holder(p_work_item_id uuid, p_transition_id uuid)
  returns table (outcome text, participant_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_target record;
      v_candidates uuid[];
      v_previous uuid;
      v_actor uuid := (select me.participant_id from app.acting_project_member(p_work_item_id) me);
    begin
      select tr.to_step_id as step_id, tr.kind, target.actor_rule ->> 'base_role' as base_role,
        target.outcome_mode as target_outcome_mode,
        w.raised_by_participant_id as raiser_id, raiser_role.base_role as raiser_base_role
      into v_target
      from work_item w
      join workflow_transition tr on tr.id = p_transition_id and tr.workflow_version_id = w.workflow_version_id
      join workflow_step target on target.id = tr.to_step_id
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      where w.id = p_work_item_id;
      if v_target.base_role is null then
        return query select 'terminal'::text, null::uuid;
        return;
      end if;

      if v_target.base_role = v_target.raiser_base_role then
        -- The raiser's own Steps stay with the raiser, never another Participant of its role (V3).
        if exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_target.raiser_id, v_actor)) then
          return query select 'ok'::text, v_target.raiser_id;
        else
          return query select 'no_step_pool'::text, null::uuid;
        end if;
        return;
      end if;

      -- A Send Back goes back to the Participant that held that Step (it Submitted the
      -- item from there), never to another of its role (V3): a Comment Returned to Open
      -- reaches the Contractor that resolved it.
      if v_target.kind = 'send_back' then
        select a.participant_id into v_previous from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_target.step_id and a.status = 'done'
        order by a.done_at desc, a.id desc limit 1;
      end if;
      if v_previous is not null then
        v_candidates := array[v_previous];
      else
        -- The Owner's review (ADR 0022): an Owner Representative covering the item holds it
        -- where the Project has one, else the Owner.
        if v_target.target_outcome_mode = 'confirm_code' and v_target.base_role = 'owner' then
          select coalesce(array_agg(p.id), '{}') into v_candidates
          from work_item w
          join participant p on p.project_id = w.project_id and p.status = 'active'
          join project_role r on r.id = p.project_role_id and r.base_role = 'owner_representative'
          where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
        end if;
        if coalesce(cardinality(v_candidates), 0) = 0 then
          select coalesce(array_agg(p.id), '{}') into v_candidates
          from work_item w
          join participant p on p.project_id = w.project_id and p.status = 'active'
          join project_role r on r.id = p.project_role_id and r.base_role = v_target.base_role
          where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
        end if;
      end if;
      if cardinality(v_candidates) = 1
        and exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_candidates[1], v_actor))
      then
        return query select 'ok'::text, v_candidates[1];
      else
        return query select 'next_step_unavailable'::text, null::uuid;
      end if;
    end
  $$;

-- The effects -------------------------------------------------------------------------------------

create or replace function app.transition_effects(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_assignment_id uuid, p_next_outcome text, p_next_participant_id uuid, p_holder uuid, p_answers jsonb, p_note text, p_recommended_code text, p_at timestamp with time zone)
 returns void
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
    declare
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_transition record;
      v_number text;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
      v_new_assignment_id uuid;
      v_review boolean;
      v_audiences uuid[];
      v_to uuid;
    begin
      select w.* into v_item from work_item w where w.id = p_work_item_id;
      select tr.*, target.stage_key as to_stage_key, target.outcome_mode as to_outcome_mode,
        source.outcome_mode as from_outcome_mode, app.is_draft_step(source.id) as from_draft
      into v_transition
      from workflow_transition tr
      join workflow_step target on target.id = tr.to_step_id
      join workflow_step source on source.id = tr.from_step_id
      where tr.id = p_transition_id;

      -- The Document Number, from the Numbering Pattern in effect (gap-free: in this transaction).
      -- A Cancel issues none (RP-433): a Draft cancelled keeps "No number yet".
      if v_item.document_number is null and v_transition.from_draft and v_transition.kind <> 'cancel' then
        if v_item.revision_no > 0 then
          -- RP-316: a Revision takes its chain's base number with " Rev n", and no counter.
          v_number := (select r.document_number from work_item r where r.id = v_item.root_id) || ' Rev ' || v_item.revision_no;
        else
          v_number := app.issue_document_number(p_work_item_id, p_at);
        end if;
      end if;

      if p_next_outcome = 'terminal' then
        v_outcome := coalesce(v_transition.outcome, case when v_transition.kind = 'cancel' then 'cancelled' end);
        -- Publish-time validation requires one (workflow-engine.md §1, check 3); never guess it.
        if v_outcome is null then
          raise exception 'Transition % closes the item without an outcome', v_transition.key;
        end if;
      end if;

      -- The Owner's review (ADR 0022): the Recommendation to it and its Send Back are read by
      -- the two Participants of the exchange only, each event written once internal to each.
      v_review := p_next_participant_id is not null and p_next_participant_id <> p_participant_id and (
        (v_transition.to_outcome_mode = 'confirm_code' and v_transition.outcome is not null)
        or (v_transition.from_outcome_mode = 'confirm_code' and v_transition.kind = 'send_back'
          and v_transition.to_outcome_mode = 'recommend_code'));
      v_audiences := case when v_review then array[p_participant_id, p_next_participant_id] else array[p_participant_id] end;

      -- The Recommended Code is Internal Communication (V5): its own event, internal to
      -- the recommender's Participant (and to the Owner's review it goes to), just before the
      -- Internal Note written with it and the Transition. Never on the item, so no other read
      -- can reach it.
      if p_recommended_code is not null or (v_review and v_transition.to_outcome_mode = 'confirm_code') then
        foreach v_to in array v_audiences loop
          insert into work_item_event (
            project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
            from_step_id, payload, audience, audience_participant_id, created_at
          ) values (
            v_item.project_id, p_work_item_id, 'recommend_code', v_member_id, p_participant_id, p_transition_id,
            v_item.current_step_id,
            jsonb_build_object('recommended_code', coalesce(p_recommended_code, v_transition.outcome)), 'internal', v_to, p_at
          );
        end loop;
      end if;
      -- The Internal Note stays inside the writer's Participant even when the
      -- Transition crosses to another (V5). It goes just before the Transition it
      -- is written with.
      if p_note is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'internal_note', v_member_id, p_participant_id, p_transition_id,
          jsonb_build_object('internal_note', p_note), 'internal', p_participant_id, p_at
        );
      end if;
      -- It leaves the acting Participant: handed to another, or closed (nobody holds it).
      v_crosses := p_next_participant_id is distinct from p_participant_id;
      -- Only what crosses is shared (a Send Back always does): a move inside one
      -- Participant stays its own, even from a Step that could issue a Code (V5, V14).
      v_audience := case
        when v_crosses or v_transition.kind in ('submit', 'send_back', 'close') then 'shared'
        else 'internal' end;
      foreach v_to in array (case when v_review then v_audiences else array[null::uuid] end) loop
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, created_at
        ) values (
          v_item.project_id, p_work_item_id,
          -- A Code is issued only where one is set; any other move from that Step is a plain Transition.
          case when v_transition.from_outcome_mode in ('issue_code', 'confirm_code') and v_outcome is not null then 'issue_code'
            else 'transition' end,
          v_member_id, p_participant_id, p_transition_id,
          v_item.current_step_id, v_transition.to_step_id,
          -- The Action Form answers (with what its actions set), then what the engine
          -- writes (no Action Form field takes those keys).
          jsonb_strip_nulls(p_answers || jsonb_build_object('document_number', v_number, 'outcome', v_outcome)),
          case when v_review then 'internal' else v_audience end,
          case when v_review then v_to when v_audience = 'internal' then p_participant_id end,
          -- The item's exact content as this Transition leaves it (ADR 0017).
          app.work_item_content_sha256(p_work_item_id, v_item.title, v_item.data, v_outcome),
          p_at
        );
      end loop;

      update step_assignment set status = 'done', done_at = p_at, updated_at = p_at where id = p_assignment_id;

      update work_item set
        current_step_id = v_transition.to_step_id,
        current_stage_key = v_transition.to_stage_key,
        step_entered_at = p_at,
        participant_entered_at = case when v_crosses then p_at else participant_entered_at end,
        participant_entered_step_id = case when v_crosses then v_transition.to_step_id else participant_entered_step_id end,
        document_number = coalesce(document_number, v_number),
        -- The Creation Date: with the Document Number, at the first exit from Draft.
        numbered_at = case when v_number is not null then coalesce(numbered_at, p_at) else numbered_at end,
        -- The Submission Date: the first Submit out of the raiser's Participant; never changed.
        submitted_at = case
          when v_transition.kind = 'submit' and p_participant_id = v_item.raised_by_participant_id
            then coalesce(submitted_at, p_at)
          else submitted_at end,
        outcome = v_outcome,
        closed_at = case when v_outcome is not null then p_at end,
        updated_at = p_at
      where id = p_work_item_id;

      -- RP-316: the item a Revision revises links to it from its first Submit, never
      -- while it is the raiser's own (V1).
      if v_transition.kind = 'submit' and v_item.revision_of_id is not null then
        insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
        values (v_item.project_id, v_item.revision_of_id, p_work_item_id, 'related', v_member_id, p_at)
        on conflict on constraint work_item_link_once do nothing;
      end if;

      if p_next_outcome = 'ok' then
        insert into step_assignment (
          project_id, work_item_id, step_id, participant_id, assignee_member_id, status, picked_up_at, created_at, updated_at
        ) values (
          v_item.project_id, p_work_item_id, v_transition.to_step_id, p_next_participant_id, p_holder,
          case when p_holder is null then 'pooled' else 'picked_up' end,
          case when p_holder is null then null else p_at end, p_at, p_at
        ) returning id into v_new_assignment_id;
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (p_work_item_id, v_item.project_id, p_next_participant_id, p_at, 'handling')
        on conflict do nothing;
        -- Rule 4 (§3.3): a pool of one holds it at once, judged now, on arrival.
        perform app.hold_pool_of_one(v_new_assignment_id);
      end if;

      -- Oversight (V2): Owners and Owner Representatives whose Visibility covers the Submitted item.
      if v_transition.kind = 'submit' then
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        select p_work_item_id, v_item.project_id, p.id, p_at, 'oversight'
        from participant p
        join project_role r on r.id = p.project_role_id
        where p.project_id = v_item.project_id and p.status = 'active'
          and r.base_role in ('owner', 'owner_representative')
          and app.participant_covers_item(p.id, p_work_item_id)
        on conflict do nothing;
      end if;
    end
  $function$;

-- Follow-up items, raised by a given Member ---------------------------------------------------------

drop function app.transition_follow_up_items(uuid, uuid, uuid, jsonb, timestamptz);

-- As before, but the items are raised by p_member_id when given (the Owner's Confirm raises
-- Code B's Comments as the Consultant's Member who recommended it), else the acting Member.
create function app.transition_follow_up_items(
  p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_answers jsonb, p_at timestamp with time zone,
  p_member_id uuid default null
)
 returns void
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
    #variable_conflict use_column
    declare
      v_member_id uuid := coalesce(p_member_id, app.current_member_id());
      v_source record;
      v_type record;
      v_version_id uuid;
      v_route record;
      v_form_version_id uuid;
      v_fields text[];
      v_subject_key text;
      v_subject text;
      v_row jsonb;
      v_data jsonb;
      v_id uuid;
      v_number text;
    begin
      if jsonb_typeof(p_answers -> 'items_to_create') is distinct from 'array' then
        return;
      end if;
      select w.*, raiser_role.base_role as raiser_base_role, actor_role.base_role as actor_base_role
      into v_source
      from work_item w
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      join participant actor on actor.id = p_participant_id
      join project_role actor_role on actor_role.id = actor.project_role_id
      where w.id = p_work_item_id;
      -- The Type its outcome's rows become, in the Type's set on the item's Project (RP-429).
      select t.id, t.code into v_type
      from outcome o
      cross join lateral jsonb_array_elements(o.actions) a
      join work_item_type t on t.owner_kind = 'rabaed' and t.code = a ->> 'type'
      where o.project_id = v_source.project_id and o.work_item_type_id = v_source.work_item_type_id
        and o.code = v_source.outcome and a ->> 'kind' = 'create_items';
      if v_type.id is null then
        if exists (
          select 1 from outcome o
          where o.project_id = v_source.project_id and o.work_item_type_id = v_source.work_item_type_id
            and o.code = v_source.outcome and o.actions @> '[{"kind": "create_items"}]')
        then
          raise exception 'outcome % creates items of a Type that does not exist', v_source.outcome;
        end if;
        return;
      end if;

      -- Its Workflow as a new item of that raiser starts (RP-426), and the Step its
      -- Draft's Submit leads to: the item is raised already, at the source's raiser.
      v_version_id := app.new_item_workflow_version(v_source.project_id, v_type.id, p_participant_id);
      -- v_route: the Draft Step (key, role), its Submit, and the Step it leads to.
      select s.id, s.stage_key, s.actor_rule ->> 'base_role' as base_role, d.key as draft_key,
        d.actor_rule ->> 'base_role' as draft_role, tr.id as transition_id
      into strict v_route
      from workflow_step d
      join workflow_transition tr on tr.from_step_id = d.id and tr.kind = 'submit'
      join workflow_step s on s.id = tr.to_step_id
      where d.workflow_version_id = v_version_id and app.is_draft_step(d.id);
      if v_route.draft_role is distinct from v_source.actor_base_role then
        raise exception 'a % does not raise % items', v_source.actor_base_role, v_type.code;
      end if;
      if v_route.base_role is distinct from v_source.raiser_base_role then
        raise exception '% items do not start with the raiser''s role %', v_type.code, v_source.raiser_base_role;
      end if;

      v_form_version_id := app.new_item_form_version(v_source.project_id, v_type.code);
      -- The answers a row gives: its cells of the fields the raiser fills at the Draft
      -- (sections with no `editable_at`, or naming the Draft Step), never a section
      -- another Participant fills later, such as the Comment's Resolution (WF-8). The
      -- Built-in Fields come from the source, never from a row.
      v_fields := array(
        select f ->> 'key'
        from form_version v
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where v.id = v_form_version_id and f ->> 'key' not in ('trade', 'location', 'scopes')
          and (s -> 'editable_at' is null or s -> 'editable_at' ? v_route.draft_key));
      -- Each row's Subject: its first text cell (publishing asks the table for one).
      select c ->> 'key' into v_subject_key
      from workflow_transition tr
      cross join lateral jsonb_array_elements(tr.action_form -> 'sections') s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      cross join lateral jsonb_array_elements(f -> 'columns') with ordinality as c (c, n)
      where tr.id = p_transition_id and f ->> 'key' = 'items_to_create' and c ->> 'type' = 'text'
      order by n limit 1;

      for v_row in select r from jsonb_array_elements(p_answers -> 'items_to_create') r loop
        select coalesce(jsonb_object_agg(k, v), '{}') into v_data
        from jsonb_each(v_row) as cell (k, v) where k = any (v_fields);
        v_subject := left(btrim(coalesce(v_row ->> v_subject_key, '')), 200);
        insert into work_item (
          project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data, field_times,
          workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at,
          submitted_at, arrivals, created_at, updated_at
        ) values (
          v_source.project_id, v_type.id, p_participant_id, v_member_id,
          v_subject,
          v_data, (select coalesce(jsonb_object_agg(k, to_jsonb(p_at)), '{}') from jsonb_object_keys(v_data) k),
          v_version_id, v_form_version_id, v_route.id, v_route.stage_key, p_at,
          -- It has left its raiser: shared from the start, like an item Submitted (V1).
          p_at, 1, p_at, p_at
        ) returning id into v_id;
        -- The source's Trade, Location and Scopes, so the same Members see it (layer 4).
        insert into work_item_dimension_value (work_item_id, project_id, dimension_id, dimension_value_id)
        select v_id, v.project_id, v.dimension_id, v.dimension_value_id
        from work_item_dimension_value v where v.work_item_id = p_work_item_id;
        insert into work_item_scope (work_item_id, project_id, scope_id)
        select v_id, s.project_id, s.scope_id from work_item_scope s where s.work_item_id = p_work_item_id;

        v_number := app.issue_document_number(v_id, p_at);
        update work_item set document_number = v_number, numbered_at = p_at where id = v_id;

        -- Visible exactly where the source is (V2): the raiser, the source's raiser
        -- holding it, and every other Participant the source has, for the same reason.
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (v_id, v_source.project_id, p_participant_id, p_at, 'raised'),
          (v_id, v_source.project_id, v_source.raised_by_participant_id, p_at, 'handling');
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        select v_id, a.project_id, a.participant_id, p_at, a.reason
        from work_item_access a where a.work_item_id = p_work_item_id
        on conflict do nothing;

        -- Held by the source's raiser's Step Pool, from which a Member picks it up.
        insert into step_assignment (project_id, work_item_id, step_id, participant_id, status, created_at, updated_at)
        values (v_source.project_id, v_id, v_route.id, v_source.raised_by_participant_id, 'pooled', p_at, p_at);

        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
          audience, audience_participant_id, created_at
        ) values (
          v_source.project_id, v_id, 'created', v_member_id, p_participant_id, v_route.id,
          jsonb_build_object('title', v_subject),
          'internal', p_participant_id, p_at
        );
        -- Raised: its Draft's Submit, taken with the outcome by the same Member, shared.
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, to_step_id, payload, audience, content_sha256, created_at
        ) select
          v_source.project_id, v_id, 'transition', v_member_id, p_participant_id, v_route.transition_id,
          tr.from_step_id, v_route.id, jsonb_build_object('document_number', v_number), 'shared',
          app.work_item_content_sha256(v_id, w.title, w.data, null), p_at
        from workflow_transition tr, work_item w
        where tr.id = v_route.transition_id and w.id = v_id;

        insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
        values (v_source.project_id, v_id, p_work_item_id, 'raised_from', v_member_id, p_at);

        -- Rule 4 (§3.3): a pool of one holds it at once, after the events that raised it.
        perform app.hold_pool_of_one(a.id) from step_assignment a where a.work_item_id = v_id and a.status = 'pooled';
      end loop;
    end
  $function$;

revoke all on function app.transition_follow_up_items(uuid, uuid, uuid, jsonb, timestamptz, uuid) from public;

-- take_transition ---------------------------------------------------------------------------------

create or replace function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_answers jsonb, p_internal_note text, p_checked_data_sha256 bytea,
  p_idempotency_key uuid, p_now timestamptz, p_assign_to uuid default null, p_recommended_code text default null
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_me record;
      v_used record;
      v_assignment record;
      v_transition record;
      v_rules record;
      v_actions record;
      v_next record;
      v_internal text[];
      v_internal_answers jsonb;
      v_recommendation record;
      v_recommendation_found boolean := false;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      select w.*, t.module_key, pr.status as project_status
      into v_item
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;

      select work_item_id, command into v_used from command_idempotency
      where member_id = v_member_id and key = p_idempotency_key;
      if v_used.work_item_id is not null then
        return case when v_used.work_item_id = p_work_item_id and v_used.command = 'transition:' || p_transition_key
          then 'applied' else 'idempotency_key_reused' end;
      end if;

      if v_item.closed_at is not null then
        return 'item_closed';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      select * into v_assignment from step_assignment
      where work_item_id = p_work_item_id and status in ('pooled', 'picked_up', 'vacant');
      if v_assignment.status is distinct from 'picked_up' or v_assignment.assignee_member_id <> v_member_id
        or v_assignment.participant_id <> v_me.participant_id
      then
        return 'not_holder';
      end if;

      select tr.* into v_transition
      from workflow_transition tr
      where tr.workflow_version_id = v_item.workflow_version_id and tr.from_step_id = v_item.current_step_id
        and tr.key = p_transition_key;
      -- A Cancel after the first Submit, or of a Revision, isn't there either (RP-433).
      if v_transition.id is null or not app.cancel_allowed(v_transition.kind, v_item.submitted_at, v_item.revision_no) then
        return 'transition_not_available';
      end if;
      -- Its rules (WF-7): the route among Transitions sharing its label, Restrict, Validate.
      select * into v_rules from app.transition_rules(p_work_item_id, v_transition.id, p_answers);
      if v_rules.refusal is not null then
        return v_rules.refusal;
      end if;
      if v_rules.transition_id <> v_transition.id then
        select tr.* into v_transition from workflow_transition tr where tr.id = v_rules.transition_id;
      end if;
      -- The Owner's review (ADR 0022): only the close of the Code it confirms.
      if not app.confirm_allowed(p_work_item_id, v_transition.id) then
        return 'transition_not_available';
      end if;
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, v_transition.permission) then
        return 'forbidden';
      end if;
      -- The Action Form answers, which the API checked against the Transition's
      -- schema: here only that each is one of its fields and each field it always
      -- requires is answered, so the app role can't write others (a Return without its reason).
      if not app.action_form_fits(v_transition.action_form, p_answers) then
        return 'invalid_action_form';
      end if;
      -- Moving on by a Member who may save the answers now (the raiser's holder at a Step
      -- that edits the Form; or the Participant holding a Step a Form Section names), and
      -- every Submit of the raiser's, whoever takes it: only with the answers the API found
      -- complete (the row is locked). A cancel, a Return or a Send Back needs no complete Form.
      -- (app.answers_sha256_of without checking again: where it may save, and at a Submit,
      -- app.answers_open is app.is_draft_step of the Step its Participant entered at.)
      if v_transition.kind not in ('cancel', 'return', 'send_back')
        and ((v_transition.kind = 'submit' and v_me.participant_id = v_item.raised_by_participant_id)
          or app.can_save_answers(p_work_item_id))
        and p_checked_data_sha256 is distinct from app.answers_sha256_of(
          p_work_item_id, app.is_draft_step(v_item.participant_entered_step_id))
      then
        return 'form_not_checked';
      end if;
      -- The next holder (§3), with the "Assign to" pick (WF-8).
      select * into v_next from app.transition_next_holder(p_work_item_id, v_transition.id, v_me.participant_id, p_assign_to);
      if v_next.outcome not in ('ok', 'terminal') then
        return v_next.outcome;
      end if;
      -- The Recommended Code (RP-433, §5.3): only one the Transition offers, so only
      -- from a Step that Recommends a Code, to the next reviewer of the same
      -- Participant, and a closing outcome of the Type's set; refused alike otherwise,
      -- before the actions step writes anything.
      if p_recommended_code is not null and not exists (
        select 1 from app.recommendable_outcomes(p_work_item_id, v_transition.id, v_me.participant_id) o
        where o.code = p_recommended_code)
      then
        return 'recommended_code_not_offered';
      end if;
      -- The reply's internal answers (its Screen's internal fields, RP-516) stay inside
      -- the acting Participant (V5): never copied into a shared field or the Form (the
      -- publish checks refuse it too, copy_internal_answer).
      v_internal := app.transition_internal_fields(v_transition.id);
      if exists (
        select 1 from jsonb_array_elements(coalesce(v_transition.actions, '[]')) a
        where a.value ->> 'type' = 'copy_field' and a.value ->> 'from' = any(v_internal)
          and not (a.value ->> 'to' = any(v_internal)))
      then
        return 'action_not_allowed';
      end if;
      -- Its actions (WF-8): set and copy, into what the acting Participant fills at
      -- this Step only; refused as a whole, or written (and recorded) before any effect.
      select * into v_actions from app.transition_actions(p_work_item_id, v_transition.id, p_answers, v_at);
      if v_actions.refusal is not null then
        return v_actions.refusal;
      end if;

      -- The internal answers: their own event, carrying the Transition's id.
      v_internal_answers := coalesce((
        select jsonb_object_agg(a.key, a.value) from jsonb_each(coalesce(v_actions.answers, '{}')) a
        where a.key = any(v_internal)), '{}');
      if v_internal_answers <> '{}' then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'internal_answers', v_member_id, v_me.participant_id, v_transition.id,
          v_item.current_step_id, jsonb_build_object('answers', v_internal_answers), 'internal', v_me.participant_id, v_at
        );
      end if;

      -- Confirming the Owner's review: the Recommendation it confirms (its latest move there),
      -- read before the item moves on.
      if v_next.outcome = 'terminal' then
        select * into v_recommendation from app.recommendation_to_confirm(p_work_item_id);
        v_recommendation_found := found;
      end if;

      perform app.transition_effects(
        p_work_item_id, v_transition.id, v_me.participant_id, v_assignment.id,
        v_next.outcome, v_next.participant_id, v_next.holder_member_id,
        coalesce(v_actions.answers, '{}') - v_internal, nullif(btrim(p_internal_note), ''), p_recommended_code, v_at);
      -- Its outcome's follow-up items (WF-11: Code B's Comments), once it is closed: from
      -- the shared answers only, since the items are shared with the raiser (V5). Confirming
      -- the Owner's review makes them from the Recommendation's shared answers, raised by the
      -- Consultant and its Member who recommended the Code, the reviewer of record (ADR 0022).
      if v_next.outcome = 'terminal' and v_recommendation_found then
        perform app.transition_follow_up_items(
          p_work_item_id, v_recommendation.transition_id, v_recommendation.actor_participant_id,
          v_recommendation.answers, v_at, v_recommendation.actor_member_id);
      elsif v_next.outcome = 'terminal' then
        perform app.transition_follow_up_items(
          p_work_item_id, v_transition.id, v_me.participant_id, coalesce(v_actions.answers, '{}') - v_internal, v_at);
      end if;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;
