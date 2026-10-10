-- A pool of one holds the Step at once (RP-513, spec RP-511 decision 1; ADR 0018;
-- workflow-engine.md §3.3 rule 4, §3.4, §5.2; visibility.md V14, scenario RP-513-1).
--
-- * app.assignment_pool: the Step Pool of an open assignment, after "not the same
--   person" (the Members the Transition that made it named), whether pooled or held.
-- * app.hold_pool_of_one: a pooled assignment just made whose pool has exactly one
--   Member is theirs at once (status 'picked_up', picked_up_at = its arrival), with an
--   internal event of the holding Participant, type 'assigned', payload
--   {"reason": "only_member"}, its actor the holder (so nobody of another Company is
--   ever named in it). Judged on arrival only: a Member joining later changes nothing.
--   Called after every insert of a pooled assignment: app.transition_effects (rules 1
--   and 2, a Return's previous holder and "Assign to", come first, as they insert a
--   held assignment) and app.transition_follow_up_items (Code B's Comments).
--   The status stays 'picked_up': it means "held by an assignee", as after "Assign to".
-- * app.return_to_pool_step refuses 'pool_of_one' while the pool has one Member, and
--   app.work_item_actions doesn't offer it then.
-- * app.work_item_pool: up to three names of the pool still waiting, and how many more,
--   for the holding Participant's own Members only (V14).
-- The bodies below are the latest (20270110000000_pick_up_rename.sql) with these changes.

-- The Step Pool of an open assignment -----------------------------------------------------

-- Assignment `p_assignment_id`'s Step Pool: app.step_pool without the Members the
-- Transition that made it named as "not the same person" (read as its actor's
-- Participant read them), pooled or held alike.
create function app.assignment_pool(p_assignment_id uuid)
  returns table (project_member_id uuid, member_id uuid)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_a record;
      v_removed uuid[];
    begin
      select a.work_item_id, a.step_id, a.participant_id, a.created_at into v_a from step_assignment a where a.id = p_assignment_id;
      if v_a.work_item_id is null then
        return;
      end if;
      select coalesce(array_agg(x.member_id), '{}') into v_removed
      from work_item_event e
      join workflow_transition tr on tr.id = e.transition_id and tr.rules is not null
      cross join lateral app.not_same_person_members(e.work_item_id, tr.rules, e.actor_participant_id) x
      where e.work_item_id = v_a.work_item_id and e.created_at = v_a.created_at and e.to_step_id = v_a.step_id
        and e.type in ('transition', 'issue_code');
      return query
        select p.project_member_id, p.member_id
        from app.step_pool(v_a.work_item_id, v_a.step_id, v_a.participant_id) p
        where p.member_id <> all (v_removed);
    end
  $$;

-- Rule 4: a pooled assignment just made, whose pool has one Member, is theirs ---------------

create function app.hold_pool_of_one(p_assignment_id uuid)
  returns void
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    declare
      v_a record;
      v_pool uuid[];
    begin
      select a.* into v_a from step_assignment a where a.id = p_assignment_id and a.status = 'pooled';
      if v_a.id is null then
        return;
      end if;
      v_pool := array(select p.member_id from app.assignment_pool(p_assignment_id) p);
      if cardinality(v_pool) <> 1 then
        return;
      end if;
      update step_assignment
      set status = 'picked_up', assignee_member_id = v_pool[1], picked_up_at = v_a.created_at, updated_at = v_a.created_at
      where id = v_a.id;
      -- "Assigned to <name>, the only one who can take this Step": internal to the
      -- holding Participant; its actor is the holder, never the Member who moved it.
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_a.project_id, v_a.work_item_id, 'assigned', v_pool[1], v_a.participant_id, v_a.step_id,
        jsonb_build_object('reason', 'only_member'), 'internal', v_a.participant_id, v_a.created_at
      );
    end
  $$;

-- Who it waits on, for the holding Participant's own Members --------------------------------

-- While item `p_work_item_id` waits in a pool of the viewer's own Participant: up to
-- three of the pool's names (by English name) and how many more. Nothing for anyone
-- else, nor once someone holds it (V14).
create function app.work_item_pool(p_work_item_id uuid)
  returns table (names jsonb, more integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_assignment_id uuid;
    begin
      select a.id into v_assignment_id from step_assignment a
      where a.work_item_id = p_work_item_id and a.status = 'pooled'
        and a.participant_id in (select app.current_participant_ids())
        and app.sees_work_item(p_work_item_id);
      if v_assignment_id is null then
        return;
      end if;
      return query
        select coalesce(jsonb_agg(x.full_name order by x.n) filter (where x.n <= 3), '[]'::jsonb),
          greatest(count(*)::integer - 3, 0)
        from (
          select m.full_name, row_number() over (order by m.full_name ->> 'en', m.id) as n
          from app.assignment_pool(v_assignment_id) p
          join member m on m.id = p.member_id
        ) x;
    end
  $$;

-- return_to_pool_step
CREATE OR REPLACE FUNCTION app.return_to_pool_step(p_work_item_id uuid, p_now timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_assignment_id uuid;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.id, w.project_id, w.closed_at, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;
      if v_item.closed_at is not null then
        return 'item_closed';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      -- Nobody to give it back to: a pool of one holds it (§3.3 rule 4).
      if exists (
        select 1 from step_assignment a
        where a.work_item_id = p_work_item_id and a.status = 'picked_up' and a.assignee_member_id = app.current_member_id()
          and not app.is_draft_step(a.step_id)
          and (select count(*) from app.assignment_pool(a.id)) < 2
      ) then
        return 'pool_of_one';
      end if;
      update step_assignment a
      set status = 'pooled', assignee_member_id = null, picked_up_at = null, updated_at = v_at
      where a.work_item_id = p_work_item_id and a.status = 'picked_up' and a.assignee_member_id = app.current_member_id()
        and not app.is_draft_step(a.step_id)
      returning a.id into v_assignment_id;
      if v_assignment_id is null then
        return 'not_holder';
      end if;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, p_work_item_id, 'returned_to_pool', app.current_member_id(), v_me.participant_id,
        'internal', v_me.participant_id, v_at
      );
      return 'returned_to_pool';
    end
  $function$;

-- transition_effects
CREATE OR REPLACE FUNCTION app.transition_effects(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_assignment_id uuid, p_next_outcome text, p_next_participant_id uuid, p_holder uuid, p_answers jsonb, p_note text, p_recommended_code text, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    declare
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_transition record;
      v_number text;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
      v_discarded text[];
      v_data jsonb;
      v_times jsonb;
      v_new_assignment_id uuid;
    begin
      select w.* into v_item from work_item w where w.id = p_work_item_id;
      select tr.*, target.stage_key as to_stage_key,
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
      -- The Recommended Code is Internal Communication (V5): its own event, internal to
      -- the recommender's Participant, just before the Internal Note written with it
      -- and the Transition. Never on the item, so no other read can reach it.
      if p_recommended_code is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'recommend_code', v_member_id, p_participant_id, p_transition_id,
          v_item.current_step_id, jsonb_build_object('recommended_code', p_recommended_code), 'internal', p_participant_id, p_at
        );
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
      -- A Send Back out of a Step of a Participant other than the raiser discards
      -- what it wrote: the sections it fills go back to how they arrived, their
      -- field times too, before the trigger clears the "as arrived" copy (V19, ADR 0013).
      v_data := v_item.data;
      v_times := v_item.field_times;
      if v_transition.kind = 'send_back' and v_crosses and p_participant_id <> v_item.raised_by_participant_id
        and v_item.data_as_arrived is not null
      then
        v_discarded := array(
          select k from unnest(app.revision_dropped_keys(p_work_item_id)) k where k not in ('trade', 'location', 'scopes'));
        v_data := (v_data - v_discarded) || coalesce((
          select jsonb_object_agg(k, v_item.data_as_arrived -> k) from unnest(v_discarded) k where v_item.data_as_arrived ? k), '{}');
        v_times := (v_times - v_discarded) || coalesce((
          select jsonb_object_agg(k, a.times -> k)
          from unnest(v_discarded) k
          cross join (select coalesce(v_item.field_times_as_arrived, v_item.field_times) as times) a
          where a.times ? k), '{}');
      end if;
      -- Only what crosses is shared (a Send Back always does): a move inside one
      -- Participant stays its own, even from a Step that could issue a Code (V5, V14).
      v_audience := case
        when v_crosses or v_transition.kind in ('submit', 'send_back', 'close') then 'shared'
        else 'internal' end;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, created_at
      ) values (
        v_item.project_id, p_work_item_id,
        -- A Code is issued only where one is set; any other move from that Step is a plain Transition.
        case when v_transition.from_outcome_mode = 'issue_code' and v_outcome is not null then 'issue_code'
          else 'transition' end,
        v_member_id, p_participant_id, p_transition_id,
        v_item.current_step_id, v_transition.to_step_id,
        -- The Action Form answers (with what its actions set), then what the engine
        -- writes (no Action Form field takes those keys).
        jsonb_strip_nulls(p_answers || jsonb_build_object('document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then p_participant_id end,
        -- The item's exact content as this Transition leaves it (ADR 0017).
        app.work_item_content_sha256(p_work_item_id, v_item.title, v_data, v_outcome),
        p_at
      );

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
        data = v_data,
        field_times = v_times,
        updated_at = p_at
      where id = p_work_item_id;
      if v_discarded is not null then
        perform app.sync_link_answers(p_work_item_id, v_item.project_id, v_item.form_version_id, v_data, p_at);
      end if;

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

-- transition_follow_up_items
CREATE OR REPLACE FUNCTION app.transition_follow_up_items(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_answers jsonb, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    declare
      v_member_id uuid := app.current_member_id();
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

      v_form_version_id := app.latest_form_version(v_type.code);
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

-- work_item_actions
CREATE OR REPLACE FUNCTION app.work_item_actions(p_work_item_id uuid)
 RETURNS TABLE(action text, transition_key text, label jsonb, transition_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    begin
      return query
        select 'pick_up', null::text, null::jsonb, null::text
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'pooled' and a.participant_id = me.participant_id
        where w.id = p_work_item_id and w.closed_at is null
          and me.project_member_id in (select project_member_id from app.step_pool(w.id, a.step_id, a.participant_id))
        union all
        select 'return_to_pool', null, null, null
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'picked_up'
          and a.assignee_member_id = app.current_member_id()
        where w.id = p_work_item_id and w.closed_at is null and not app.is_draft_step(a.step_id)
          -- Only while there is someone to give it back to (§3.3 rule 4).
          and (select count(*) from app.assignment_pool(a.id)) > 1
        union all
        select * from (
          select 'transition', t.key, t.label, t.kind from app.takeable_transitions(p_work_item_id) t order by t.sort
        ) x;
    end
  $function$;

revoke all on function app.assignment_pool(uuid) from public;
revoke all on function app.hold_pool_of_one(uuid) from public;
revoke all on function app.work_item_pool(uuid) from public;
grant execute on function app.work_item_pool(uuid) to rabaed_app;
