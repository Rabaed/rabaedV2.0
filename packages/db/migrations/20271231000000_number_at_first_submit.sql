-- RP-1316: a Document Number is given at the first Submit, not at Send for Review (ADR 0030; owner's
-- decisions on RP-1302, comments 15899, 15903 and 15907; UAT WF-16). Nobody outside the raiser's
-- Participant sees an item before its first Submit, so the number now comes in that moment, with the
-- Submission Date, and an item cancelled in Internal Review never had one: the numbers other Companies
-- see run with no gap (V1, scenario 53, RP-1316-1). Numbers already given stay as they are.
--
-- The Creation Date stays at the first exit from Draft, so it gets its own column, left_draft_at, and
-- numbered_at is only when the number came. Every read that took numbered_at as the Creation Date
-- reads left_draft_at; every check that took "no Document Number" to mean "still a Draft" asks whether
-- the item ever left Draft, since an item in Internal Review has no number yet and isn't a Draft. Each
-- function is redefined from its newest body on main with that one change; signatures and grants stay.
-- app.issue_document_number is unchanged: its counter row's upsert still makes two Submits at once
-- take consecutive numbers in their own transactions (ADR 0008).

-- The Creation Date --------------------------------------------------------------------
-- Shown only to the raiser's Participant, through app.work_item_creation_date: not granted to the app
-- role, as numbered_at isn't. Until now every item that left Draft was numbered as it left, so
-- numbered_at holds each existing item's Creation Date (a follow-up item's being when it was raised).
-- This moves no number: none is given or taken back.
alter table work_item add column left_draft_at timestamptz;
comment on column work_item.left_draft_at is
  'The Creation Date: when the item first left Draft (a follow-up item: when it was raised). Not granted to the app role; read through app.work_item_creation_date (RP-1316).';
update work_item set left_draft_at = numbered_at where numbered_at is not null;

-- Whether an item has left Draft: the one definition of it every rule below reads (CODING_STANDARDS.md, one
-- definition per layer). A Creation Date, or a number: every item that left Draft before RP-1316 was numbered
-- as it left, so a number alone still says it did (one given some other way than a Transition, too).
-- A plain invoker sql helper with no search_path, so it is inlined where it is read (CODING_STANDARDS.md, RP-310).
create function app.left_draft(p_left_draft_at timestamptz, p_document_number text) returns boolean
  language sql immutable parallel safe
  as $$ select p_left_draft_at is not null or p_document_number is not null $$;
revoke all on function app.left_draft(timestamptz, text) from public;

-- app.transition_effects ---------------------------------------------------------------
-- The Document Number at the first Submit out of the raiser's Participant (ADR 0030), in the
-- transaction and at the moment of its Submission Date; a Revision's " Rev n" the same way.
-- An item whose Workflow Version has no Submit is numbered when it first leaves Draft. The
-- Creation Date (left_draft_at) stays at the first exit from Draft; numbered_at is when the
-- number came.
-- As in packages/db/migrations/20270727000000_member_signature.sql, except as said above.
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
      v_leaves_draft boolean;
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

      -- The first exit from Draft, by any Transition but a Cancel (RP-433): the Creation Date.
      v_leaves_draft := v_transition.from_draft and v_transition.kind <> 'cancel';
      -- The Document Number, from the Numbering Pattern in effect (gap-free: in this transaction; ADR 0008),
      -- at the first Submit out of the raiser's Participant, with the Submission Date (RP-1316, ADR 0030):
      -- nobody outside the raiser sees the item before it, so an item cancelled in Internal Review never
      -- had one and leaves no gap. An item whose Workflow Version has no Submit is numbered when it first
      -- leaves Draft. Follow-up items are numbered when raised (app.raise_follow_up_item), so never here.
      if v_item.document_number is null and (
        (v_transition.kind = 'submit' and p_participant_id = v_item.raised_by_participant_id)
        or (v_leaves_draft and not exists (
          select 1 from workflow_transition s where s.workflow_version_id = v_item.workflow_version_id and s.kind = 'submit'))
      ) then
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
          from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, signature_id, created_at
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
          -- The Signature in force as the Member takes it (RP-85): a later one never changes it.
          app.active_signature_id(v_member_id),
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
        -- When the Document Number came: at the first Submit (ADR 0030), so no longer the Creation Date.
        numbered_at = case when v_number is not null then coalesce(numbered_at, p_at) else numbered_at end,
        -- The Creation Date: the first exit from Draft (GLOSSARY.md), whether or not a number came with it.
        left_draft_at = case when v_leaves_draft then coalesce(left_draft_at, p_at) else left_draft_at end,
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

-- app.raise_follow_up_item -------------------------------------------------------------
-- A follow-up item is still numbered when it is raised (ADR 0030: shared the moment it exists),
-- and that moment is its Creation Date too.
-- As in packages/db/migrations/20271016000000_raised_from_link_arrival_zero.sql, except as said above.
create or replace function app.raise_follow_up_item(
  p_source_id uuid, p_type_id uuid, p_route record, p_form_version_id uuid, p_participant_id uuid, p_member_id uuid,
  p_subject text, p_data jsonb, p_at timestamptz, p_checklist_key text default null, p_item_key text default null
) returns uuid
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_source record;
      v_id uuid;
      v_number text;
    begin
      select w.project_id, w.raised_by_participant_id into strict v_source from work_item w where w.id = p_source_id;
      insert into work_item (
        project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data, field_times,
        workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at,
        submitted_at, arrivals, created_at, updated_at
      ) values (
        v_source.project_id, p_type_id, p_participant_id, p_member_id,
        p_subject,
        p_data, (select coalesce(jsonb_object_agg(k, to_jsonb(p_at)), '{}') from jsonb_object_keys(p_data) k),
        p_route.workflow_version_id, p_form_version_id, p_route.step_id, p_route.stage_key, p_at,
        -- It has left its raiser: shared from the start, like an item Submitted (V1).
        p_at, 1, p_at, p_at
      ) returning id into v_id;
      -- The source's Trade, Location and Scopes, so the same Members see it (layer 4).
      insert into work_item_dimension_value (work_item_id, project_id, dimension_id, dimension_value_id)
      select v_id, v.project_id, v.dimension_id, v.dimension_value_id
      from work_item_dimension_value v where v.work_item_id = p_source_id;
      insert into work_item_scope (work_item_id, project_id, scope_id)
      select v_id, s.project_id, s.scope_id from work_item_scope s where s.work_item_id = p_source_id;

      v_number := app.issue_document_number(v_id, p_at);
      update work_item set document_number = v_number, numbered_at = p_at, left_draft_at = p_at where id = v_id;

      -- Visible exactly where the source is (V2): the raiser, the source's raiser
      -- holding it, and every other Participant the source has, for the same reason.
      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (v_id, v_source.project_id, p_participant_id, p_at, 'raised'),
        (v_id, v_source.project_id, v_source.raised_by_participant_id, p_at, 'handling');
      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      select v_id, a.project_id, a.participant_id, p_at, a.reason
      from work_item_access a where a.work_item_id = p_source_id
      on conflict do nothing;

      -- Held by the source's raiser's Step Pool, from which a Member picks it up.
      insert into step_assignment (project_id, work_item_id, step_id, participant_id, status, created_at, updated_at)
      values (v_source.project_id, v_id, p_route.step_id, v_source.raised_by_participant_id, 'pooled', p_at, p_at);

      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_source.project_id, v_id, 'created', p_member_id, p_participant_id, p_route.step_id,
        jsonb_build_object('title', p_subject),
        'internal', p_participant_id, p_at
      );
      -- Raised: its Draft's Submit, taken with the outcome by the same Member, shared.
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, content_sha256, created_at
      ) select
        v_source.project_id, v_id, 'transition', p_member_id, p_participant_id, p_route.transition_id,
        tr.from_step_id, p_route.step_id, jsonb_build_object('document_number', v_number), 'shared',
        app.work_item_content_sha256(v_id, w.title, w.data, null), p_at
      from workflow_transition tr, work_item w
      where tr.id = p_route.transition_id and w.id = v_id;

      insert into work_item_link (project_id, from_id, to_id, kind, checklist_key, item_key, created_by_member_id, created_at)
      values (v_source.project_id, v_id, p_source_id, 'raised_from', p_checklist_key, p_item_key, p_member_id, p_at);
      -- It came with the item, before its first arrival (the insert stamped the current one), so
      -- whoever sees the item reads it, as the Snag's "before" photos (RP-1031).
      update work_item_link set arrival = 0 where from_id = v_id and kind = 'raised_from';

      -- Rule 4 (§3.3): a pool of one holds it at once, after the events that raised it.
      perform app.hold_pool_of_one(a.id) from step_assignment a where a.work_item_id = v_id and a.status = 'pooled';
      return v_id;
    end
  $$;

-- The Creation Date's reads: left_draft_at, no longer numbered_at -----------------------
-- app.work_item_creation_date_unchecked: the Creation Date, to the raiser's own Participant only.
-- As in packages/db/migrations/20271019000000_reads_at_scale.sql, except as said above.
create or replace function app.work_item_creation_date_unchecked(p_work_item_id uuid, p_participant_ids uuid[]) returns timestamptz
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select w.left_draft_at from work_item w
        where w.id = p_work_item_id
          and w.raised_by_participant_id = any(p_participant_ids)
      );
    end
  $$;

-- app.work_item_field_times: an answer's time reads no earlier than the Creation Date (RP-392), so a
-- Draft's save times reach nobody once it has left Draft, in Internal Review too.
-- As in packages/db/migrations/20270117100000_raisers_form_review_fixes.sql, except as said above.
create or replace function app.work_item_field_times(p_work_item_id uuid, p_lock boolean default false) returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_times jsonb;
      v_left_draft_at timestamptz;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      if not exists (
          select 1 from work_item w
          join project_member pm on pm.project_id = w.project_id and pm.participant_id = w.raised_by_participant_id
          join participant p on p.id = pm.participant_id
          where w.id = p_work_item_id and pm.member_id = app.current_member_id() and pm.status = 'active'
            and p.status = 'active' and p.company_id = app.current_company_id())
        and not app.can_save_answers(p_work_item_id)
      then
        return null;
      end if;
      if p_lock then
        select w.field_times, w.left_draft_at into v_times, v_left_draft_at from work_item w where w.id = p_work_item_id for update;
      else
        select w.field_times, w.left_draft_at into v_times, v_left_draft_at from work_item w where w.id = p_work_item_id;
      end if;
      return coalesce((
        select jsonb_object_agg(t.key, jsonb_build_object(
          'at', to_char((greatest((t.value ->> 'at')::timestamptz, v_left_draft_at)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'by', t.value ->> 'by',
          'name', m.full_name))
        from jsonb_each(v_times) t
        join member m on m.id = app.uuid_or_null(t.value -> 'by') and m.company_id = app.current_company_id()
      ), '{}'::jsonb);
    end
  $$;

-- app.document_times: a Document's time reads no earlier than its first item's Creation Date.
-- As in packages/db/migrations/20271122000000_close_shares_handed_over.sql, except as said above.
create or replace function app.document_times(p_work_item_id uuid)
  returns table (document_id uuid, uploaded_at timestamptz, seq integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        with recursive visible as (
          -- The rows the documents policy shows the acting Member.
          select d.id, d.confirmed_at, d.file_name from document d
          where d.work_item_id = p_work_item_id and d.confirmed_at is not null and d.removed_at is null
            and app.document_seen(d.work_item_id, d.arrival, d.reply_event_id)
        ), origin as (
          -- Each Document back to the one first uploaded, through any copy of a copy.
          select v.id as document_id, v.id as source_id from visible v
          union all
          select o.document_id, c.copied_from_id from origin o join document_copy c on c.document_id = o.source_id
        )
        select v.id, greatest(v.confirmed_at, w.left_draft_at),
          (row_number() over (order by v.confirmed_at, v.file_name, v.id))::integer
        from visible v
        join origin o on o.document_id = v.id
          and not exists (select 1 from document_copy c where c.document_id = o.source_id)
        join document s on s.id = o.source_id
        join work_item w on w.id = s.work_item_id
        order by 3;
    end
  $$;

-- app.work_item_links: a Link's time reads no earlier than its item's Creation Date.
-- As in packages/db/migrations/20261222000000_draft_row_times_floor.sql, except as said above.
create or replace function app.work_item_links(p_work_item_id uuid)
  returns table(id uuid, kind text, field_key text, document_number text, subject text, work_item_id uuid, created_at timestamp with time zone)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select l.id, l.kind, l.field_key, t.document_number, t.title,
          case when app.sees_work_item(t.id) then t.id end, greatest(l.created_at, f.left_draft_at)
        from work_item_link l
        join work_item f on f.id = l.from_id
        join work_item t on t.id = l.to_id
        where l.from_id = p_work_item_id and app.sees_work_item(p_work_item_id)
          and app.item_row_seen(l.from_id, l.arrival, l.removed_at is not null)
          and not app.chain_item_hidden(p_work_item_id, t.id)
        order by l.created_at, t.document_number collate "C", l.id;
    end
  $$;

-- "Never left Draft" is now left_draft_at is null, not "no Document Number": an item in Internal
-- Review has none yet (ADR 0030), and isn't a Draft.
-- app.step_as_seen_unchecked: a Draft's Step Age reaches nobody; an item in Internal Review has one.
-- As in packages/db/migrations/20271223000000_cancelled_from_outcome.sql, except as said above.
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
          case when w.outcome = 'cancelled' then app.cancelled_stage_key(w.project_id, w.work_item_type_id, s.stage_key)
            else s.stage_key end,
          case
            -- A Draft (never left its Draft Step): its Step began when it was started, which
            -- reaches nobody (ADR 0020; visibility.md "Creation Date").
            when not app.left_draft(w.left_draft_at, w.document_number) and app.is_draft_step(w.current_step_id) then null
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

-- app.take_step_age_report: every open item past its Draft, numbered or not yet (scenario 76).
-- As in packages/db/migrations/20271220000000_reinvite_withdrawn_participant.sql, except as said above.
create or replace function app.take_step_age_report(p_outbox_id uuid)
  returns table (
    to_address text, language text, project_id uuid, project_name jsonb, open_stage_keys text[],
    work_item_id uuid, document_number text, subject text, stage_name jsonb,
    held_by_own boolean, step_name jsonb, holder_name jsonb, entered_at timestamptz
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_saved text := current_setting('app.member_id', true);
      v_project uuid;
      v_member uuid;
    begin
      perform app.require_worker();
      select o.project_id, (o.payload ->> 'member_id')::uuid into v_project, v_member
      from outbox o where o.id = p_outbox_id and o.kind = 'step_age_report' and o.processed_at is null;
      if v_member is null then
        return;
      end if;
      -- A closed Project goes quiet.
      if not exists (select 1 from project p where p.id = v_project and p.status = 'active') then
        return;
      end if;
      -- Still on the Project, holding Assign, through an active Participant.
      if not exists (
        select 1 from project_member pm
        join participant pa on pa.id = pm.participant_id and pa.status = 'active'
        join member m on m.id = pm.member_id and m.status = 'active'
        where pm.project_id = v_project and pm.member_id = v_member and pm.status = 'active'
          and app.project_member_holds_assign(pm.id)
      ) then
        return;
      end if;
      -- Their settings now: the group's email off, email paused, the Project muted.
      -- "Immediately" and "daily digest" both send it: the report has its own time.
      if coalesce((select r.email from app.member_notification_route(v_member, v_project, 'weekly_report', null) r), 'none') = 'none' then
        return;
      end if;

      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_member::text, true);
      return query
        select m.email, coalesce(pref.preferred_language, m.locale), pr.id, pr.name,
          array(
            select s.key from stage s
            where s.module_key = 'submittals' and s.project_id = v_project and s.category in ('draft', 'in_progress')
            order by s.sort, s.key
          ),
          i.id, i.document_number, i.title, i.stage_name, i.held_by_own, i.step_name, i.holder_name, i.entered_at
        from member m
        left join member_notification_preference pref on pref.member_id = m.id
        join project pr on pr.id = v_project
        cross join lateral (
          select w.id, w.document_number, w.title, st.name as stage_name,
            coalesce(h.participant_id in (select app.current_participant_ids()), false) as held_by_own,
            s.name as step_name, coalesce(app.with_owner_review(w.id), hc.legal_name) as holder_name, seen.entered_at
          from work_item w
          cross join lateral app.step_as_seen(w.id) seen
          -- Null for an item another Company holds: app.step_as_seen names its Step to that Company only (RP-1192).
          left join workflow_step s on s.id = seen.step_id
          join work_item_type t on t.id = w.work_item_type_id
          join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = seen.stage_key
          left join lateral (select * from app.work_item_holder(w.id) limit 1) h on true
          left join lateral (
            select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = h.participant_id
          ) hc on true
          where w.project_id = v_project and t.module_key = 'submittals'
            and st.category in ('draft', 'in_progress')
            -- A Draft that never left Draft has no Step Age (scenario 76); an item in Internal Review
            -- has one, before its number (ADR 0030).
            and app.left_draft(w.left_draft_at, w.document_number)
            and app.latest_visible_revision(w.id)
        ) i
        where m.id = v_member
        order by i.entered_at, i.id;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
    end
  $$;

-- app.request_snag_report: Step Age as the api prints it (query.ts), for an item past its Draft.
-- As in packages/db/migrations/20271030000000_snag_hardening.sql, except as said above.
create or replace function app.request_snag_report(p_project_id uuid, p_language text, p_content jsonb, p_now timestamptz) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member uuid := app.current_member_id();
      v_items jsonb := p_content -> 'items';
      v_ids uuid[];
      v_report uuid := gen_random_uuid();
      v_outbox uuid;
    begin
      if v_member is null or p_now is null or p_language not in ('en', 'ar') or jsonb_typeof(p_content) is distinct from 'object'
        or jsonb_typeof(v_items) is distinct from 'array' or jsonb_typeof(p_content -> 'capped') is distinct from 'boolean'
        or not exists (select 1 from app.current_project_ids() x where x = p_project_id)
        or p_content -> 'projectName' is distinct from (select p.name from project p where p.id = p_project_id)
        -- Every row names its item by id.
        or exists (
          select 1 from jsonb_array_elements(v_items) i
          where jsonb_typeof(i) is distinct from 'object'
            or coalesce(i ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )
      then
        return null;
      end if;
      v_ids := array(select (i ->> 'id')::uuid from jsonb_array_elements(v_items) i);
      if exists (
          -- A photo is printed by its storage key as the owner role: only a Document this Member reads,
          -- as member_reads_documents lets them.
          select 1 from jsonb_array_elements(v_items) i
          where jsonb_typeof(i -> 'photo') = 'object'
            and not exists (
              select 1 from document d
              where d.storage_key = i -> 'photo' ->> 'storageKey' and d.project_id = p_project_id
                and d.confirmed_at is not null and d.removed_at is null
                and app.item_row_seen(d.work_item_id, d.arrival, false)
            )
        )
        -- Each row, but its photo, is exactly what the Snag List shows this Member for its item (the
        -- api's visibleRows and toRow in apps/api/src/work-items/query.ts, and askForSnagReport): an
        -- item they do not see has no row here, so it is refused.
        or exists (
          with seen as (
            select w.id, jsonb_build_object(
                'documentNumber', w.document_number,
                'subject', w.title,
                'type', t.name,
                'trade', tv.name,
                'location', lv.name,
                'stage', st.name,
                -- Who it is with (V14): none once closed; "Owner review" for those it gives; the
                -- Member's own person holding it, else their Company; another Company by name only.
                'with', case
                  when st.category not in ('draft', 'in_progress') then null
                  when w.owner_review is not null then w.owner_review
                  when w.holder_company_name is null then null
                  when w.holder_participant_id in (select app.current_participant_ids()) then coalesce(m.full_name, w.holder_company_name)
                  else w.holder_company_name
                end,
                -- Weeks at the Step it is seen at (stepAgeWeeks): none once closed, nor for a Draft that never left
                -- Draft (no number and no Creation Date; ADR 0030).
                -- To the millisecond, as the api reads the time, so a week's edge falls the same on both sides.
                'stepAgeWeeks', case
                  when st.category in ('draft', 'in_progress') and (w.document_number is not null or w.creation_date is not null)
                    then greatest(0, floor(extract(epoch from p_now - date_trunc('milliseconds', w.entered_at)) / 604800))::integer + 1
                end
              ) as printed
            from app.work_items_seen(p_project_id, array['snag_list'], true, v_ids) w
            join work_item_type t on t.id = w.work_item_type_id
            join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = w.stage_key
            join visibility_dimension td on td.project_id = w.project_id and td.kind = 'trade'
            join lateral unnest(w.dimension_ids, w.dimension_value_ids) as tdv (dimension_id, value_id) on tdv.dimension_id = td.id
            join dimension_value tv on tv.id = tdv.value_id
            join visibility_dimension ld on ld.project_id = w.project_id and ld.kind = 'location'
            left join lateral unnest(w.dimension_ids, w.dimension_value_ids) as ldv (dimension_id, value_id) on ldv.dimension_id = ld.id
            left join dimension_value lv on lv.id = ldv.value_id
            left join member m on m.id = w.holder_member_id
          )
          select 1 from jsonb_array_elements(v_items) i
          where not exists (select 1 from seen s where s.id = (i ->> 'id')::uuid and i - 'id' - 'photo' = s.printed)
        )
      then
        return null;
      end if;
      insert into outbox (kind, project_id, payload)
      values ('snag_report', p_project_id, jsonb_build_object('snag_report_id', v_report))
      returning id into v_outbox;
      insert into snag_report (id, project_id, member_id, language, content, outbox_id)
      values (v_report, p_project_id, v_member, p_language, p_content, v_outbox);
      return v_report;
    end
  $$;

-- app.can_discard_draft: only a Draft that never left Draft is deleted; an item in Internal Review
-- with no number yet is not (it is cancelled, as before).
-- As in packages/db/migrations/20270117000400_list_row_commands.sql, except as said above.
create or replace function app.can_discard_draft(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.sees_work_item(p_work_item_id) and exists (
        select 1
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        where w.id = p_work_item_id
          and w.closed_at is null and not app.left_draft(w.left_draft_at, w.document_number) and app.is_draft_step(w.current_step_id)
      ) and app.can_save_answers(p_work_item_id);
    end
  $$;

-- app.can_discard_revision: likewise for a Draft Revision.
-- As in packages/db/migrations/20261108000000_plpgsql_definer_helpers.sql, except as said above.
create or replace function app.can_discard_revision(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(p_work_item_id) and exists (
          select 1
          from work_item w
          join project pr on pr.id = w.project_id and pr.status = 'active'
          join app.acting_project_member(w.id) me on me.participant_id = w.raised_by_participant_id
          where w.id = p_work_item_id and w.revision_no > 0
            and w.closed_at is null and not app.left_draft(w.left_draft_at, w.document_number) and app.is_draft_step(w.current_step_id)
        )
      );
    end
  $$;

-- app.withdrawal_cancels: a withdrawn Participant's items that left Draft (numbered or not yet)
-- are cancelled by Rabaed with a Record.
-- As in packages/db/migrations/20271215000000_withdraw_participant.sql, except as said above.
create or replace function app.withdrawal_cancels(p_participant_id uuid) returns setof uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select w.id from work_item w
        where w.raised_by_participant_id = p_participant_id and w.closed_at is null and app.left_draft(w.left_draft_at, w.document_number);
    end
  $$;

-- app.withdraw_participant: the same split, a Draft being one that never left Draft.
-- As in packages/db/migrations/20271224000000_vacancy_handoff.sql, except as said above.
create or replace function app.withdraw_participant(p_participant_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_refusal text;
      v_participant record;
      v_item record;
      v_member uuid;
      v_outbox uuid;
    begin
      -- Nobody locks a Participant they may not withdraw: checked first, then locked, then checked
      -- again under the lock, so one withdrawal runs at a time and the second reads 'not_found'.
      v_refusal := app.withdrawal_refusal(p_participant_id);
      if v_refusal is not null then
        return v_refusal;
      end if;
      select p.id, p.project_id, p.company_id into v_participant from participant p where p.id = p_participant_id for update;
      v_refusal := app.withdrawal_refusal(p_participant_id);
      if v_refusal is not null then
        return v_refusal;
      end if;
      -- Every item it changes, locked first in one order (app.take_transition locks an item before its Steps
      -- too), so two withdrawals on one Project, each touching the other's items, never deadlock.
      -- RP-1262: with the Project's other Vacancies, which the hand-off below may pass, so it takes no lock out of order.
      perform 1 from work_item w
      where w.id in (
        select x.id from work_item x where x.raised_by_participant_id = p_participant_id and x.closed_at is null
        union
        select a.work_item_id from step_assignment a where a.participant_id = p_participant_id and a.status in ('pooled', 'picked_up')
        union
        select a.work_item_id from step_assignment a where a.project_id = v_participant.project_id and a.status = 'vacant')
      order by w.id
      for update;

      -- Its items: those that left Draft Cancelled by Rabaed with a Record, its Drafts and Draft Revisions with none.
      for v_item in
        select w.id, w.current_step_id, not app.left_draft(w.left_draft_at, w.document_number) as is_draft, cancelled.id as cancelled_step_id, cancelled.stage_key
        from work_item w
        join work_item_type t on t.id = w.work_item_type_id
        -- Where an item that left Draft goes, as a Member's Cancel takes it: its Version's Step in a cancelled
        -- Stage, so every reader reads it Cancelled. A Version with none leaves it at its Step (RP-952 follow-up).
        left join lateral (
          select s.id, s.stage_key from workflow_step s
          join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = s.stage_key
          where s.workflow_version_id = w.workflow_version_id and st.category = 'cancelled' and app.left_draft(w.left_draft_at, w.document_number)
          order by s.id
          limit 1
        ) cancelled on true
        where w.raised_by_participant_id = p_participant_id and w.closed_at is null
        order by w.id
        for update of w
      loop
        insert into work_item_event (project_id, work_item_id, type, from_step_id, to_step_id, payload, audience, audience_participant_id, created_at)
        values (v_participant.project_id, v_item.id, 'cancelled', v_item.current_step_id, v_item.cancelled_step_id,
          jsonb_build_object('left_participant_id', p_participant_id),
          case when v_item.is_draft then 'internal' else 'shared' end,
          case when v_item.is_draft then p_participant_id end, v_at);
        update step_assignment set status = 'done', done_at = v_at, updated_at = v_at
        where work_item_id = v_item.id and status in ('pooled', 'picked_up', 'vacant');
        update work_item set outcome = 'cancelled', closed_at = v_at, updated_at = v_at,
          discarded_at = case when v_item.is_draft then v_at end,
          current_step_id = coalesce(v_item.cancelled_step_id, current_step_id),
          current_stage_key = coalesce(v_item.stage_key, current_stage_key),
          step_entered_at = case when v_item.cancelled_step_id is null then step_entered_at else v_at end,
          participant_entered_at = case when v_item.cancelled_step_id is null then participant_entered_at else v_at end,
          participant_entered_step_id = coalesce(v_item.cancelled_step_id, participant_entered_step_id)
        where id = v_item.id;
      end loop;

      -- Its Steps on other Companies' items: Participant-level Vacancies.
      update step_assignment set status = 'vacant', assignee_member_id = null, updated_at = v_at
      where id in (select app.withdrawal_vacates(p_participant_id));

      -- Its Notices, before its Members lose the Project: its Company's Authorized Person and Project Members.
      for v_member in
        select m.id from member m
        where m.status = 'active' and (
          m.id = (select co.authorized_person_id from company co where co.id = v_participant.company_id)
          or m.id in (select pm.member_id from project_member pm where pm.participant_id = p_participant_id and pm.status = 'active'))
        order by m.id
      loop
        insert into outbox (kind, project_id, payload)
        values ('participant_withdrawn', v_participant.project_id, jsonb_build_object('participantId', p_participant_id, 'memberId', v_member))
        returning id into v_outbox;
        insert into notification (member_id, project_id, outbox_id, kind, in_app, email, created_at)
        values (v_member, v_participant.project_id, v_outbox, 'participant_withdrawn', true, 'none', v_at);
      end loop;

      update participant set status = 'withdrawn', withdrawn_at = v_at, withdrawn_by_member_id = app.current_member_id(), updated_at = v_at
      where id = p_participant_id;
      -- RP-1262: every item it may pass is locked above, in item order.
      perform app.pass_vacancies(v_participant.project_id, v_at);
      return 'withdrawn';
    end
  $$;

-- app.add_package_item: a Draft is one that never left Draft.
-- As in packages/db/migrations/20271026000000_package_owner_before_lock.sql, except as said above.
create or replace function app.add_package_item(p_package_id uuid, p_work_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_package record;
      v_item record;
    begin
      if not app.owns_package(p_package_id) then
        return 'not_found';
      end if;
      perform app.lock_work_items(array[p_work_item_id]);
      select * into v_package from app.package_for_write(p_package_id);
      if v_package.id is null then
        return 'not_found';
      end if;
      if v_package.project_status <> 'active' then
        return 'project_closed';
      end if;
      if not app.sees_work_item(p_work_item_id) then
        return 'item_not_offered';
      end if;
      select w.id, w.package_id, w.document_number, w.left_draft_at into v_item
      from work_item w join work_item_type t on t.id = w.work_item_type_id
      where w.id = p_work_item_id and w.project_id = v_package.project_id
        and w.raised_by_participant_id = v_package.participant_id
        and t.module_key = 'submittals' and w.discarded_at is null
      for update of w;
      if v_item.id is null then
        return 'item_not_offered';
      end if;
      if v_item.package_id = p_package_id then
        return 'added';
      end if;
      if v_item.package_id is not null then
        return 'in_another_package';
      end if;
      -- A Draft: never sent (GLOSSARY.md Draft). An item in Internal Review has no number yet either (ADR 0030).
      if not app.left_draft(v_item.left_draft_at, v_item.document_number) and not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;
      update work_item set package_id = p_package_id where id = p_work_item_id;
      perform app.write_package_event(p_package_id, 'item_added', p_work_item_id, '{}', v_at);
      return 'added';
    end
  $$;

-- app.sees_work_item: "Drafts visible to: author" holds for a Draft that never left Draft only, as
-- it did while every item past its Draft had a number.
-- As in packages/db/migrations/20271226000000_whole_project_location.sql, except as said above.
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
            and (app.left_draft(w.left_draft_at, w.document_number) or s.drafts_visible_to is distinct from 'author'
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
              -- (visibility_grant_value_value_fk). The Whole Project Location is covered by a grant of any value
              -- of its dimension (RP-1304), and is no grant's value (visibility_grant_value_not_whole_project_fk).
              cross join lateral (
                select
                  exists (select 1 from dimension_value v where v.id = d.value_id and v.dimension_id = d.dimension_id) as in_dimension,
                  exists (
                    select 1 from dimension_value v where v.id = d.value_id and v.dimension_id = d.dimension_id and v.whole_project
                  ) as whole_project,
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
                        when value.whole_project then exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id)
                        else exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id and gv.dimension_value_id = any(value.ids)) end
                  ) as by_member,
                  exists (
                    select 1 from visibility_grant g
                    where g.participant_id = pm.participant_id and g.project_member_id is null and g.dimension_id = d.dimension_id
                      and case when g.is_all then value.in_dimension
                        when value.whole_project then exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id)
                        else exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id and gv.dimension_value_id = any(value.ids)) end
                  ) as by_participant
              ) covered
              where not (covered.by_member and covered.by_participant)
            )
        )
      );
    end
  $$;

-- revision_created -----------------------------------------------------------------------
-- A new Revision's `created` event goes out to the chain's watchers when it first leaves Draft,
-- dated its Creation Date, as before: both keyed on numbered_at while the number came then, now
-- on left_draft_at (the Revision's " Rev n" waits for its first Submit, ADR 0030). The notice
-- reads "No number yet" until then; delivery still reaches only who sees the Revision (V1).
-- The function and trigger names ("numbered") are kept: renaming them would drop and recreate the trigger
-- for no change of behaviour; they now mean "left Draft".
-- As in 20261219000000_draft_start_time.sql, except as said above.
create or replace function app.outbox_revision_numbered() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_event record;
    begin
      select e.id, e.actor_member_id into v_event from work_item_event e
      where e.work_item_id = new.id and e.type = 'created';
      if v_event.id is not null and exists (
        select 1 from work_item_watch ww
        where ww.root_id = new.root_id and ww.member_id is distinct from v_event.actor_member_id
      ) then
        insert into outbox (kind, project_id, payload, created_at, available_at)
        values ('notification', new.project_id,
          jsonb_strip_nulls(jsonb_build_object('work_item_id', new.id, 'work_item_event_id', v_event.id,
            'actor_member_id', v_event.actor_member_id)),
          new.left_draft_at, now());
      end if;
      return null;
    end
  $$;
drop trigger work_item_revision_numbered on work_item;
create trigger work_item_revision_numbered after update of left_draft_at on work_item
  for each row when (old.left_draft_at is null and new.left_draft_at is not null and new.revision_no > 0)
  execute function app.outbox_revision_numbered();

-- As in 20261219000000_draft_start_time.sql, except as said above.
create or replace function app.revision_created_once_numbered() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_left_draft_at timestamptz;
    begin
      select w.left_draft_at into v_left_draft_at from work_item w where w.id = new.work_item_id;
      if v_left_draft_at is null then
        return null;
      end if;
      new.created_at := v_left_draft_at;
      return new;
    end
  $$;

-- app.set_work_item_paper_ref (RP-639): the Paper ref is changed only on a Draft that never left Draft, as before
-- RP-1316 "no number" said. On MAR Workflow Version 2 a Return goes back to the Draft Step, and the item there
-- now has no number yet but has left Draft.
-- As in 20270916000000_register_import_values.sql, except as said above.
create or replace function app.set_work_item_paper_ref(p_work_item_id uuid, p_paper_ref text, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_ref text := nullif(btrim(coalesce(p_paper_ref, '')), '');
      v_item record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.id, w.project_id, w.raised_by_participant_id, w.document_number, w.left_draft_at, w.discarded_at, w.current_step_id
      into v_item from work_item w where w.id = p_work_item_id
      for update;
      if exists (select 1 from project where id = v_item.project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if app.left_draft(v_item.left_draft_at, v_item.document_number) or v_item.discarded_at is not null
        or not app.is_draft_step(v_item.current_step_id) or not app.can_save_answers(p_work_item_id)
      then
        return 'not_editable';
      end if;
      if length(v_ref) > 100 then
        return 'paper_ref_too_long';
      end if;
      if v_ref is not null and exists (
        select 1 from work_item w
        where w.project_id = v_item.project_id and w.raised_by_participant_id = v_item.raised_by_participant_id
          and lower(w.paper_ref) = lower(v_ref) and w.discarded_at is null and w.id <> p_work_item_id)
      then
        return 'paper_ref_taken';
      end if;
      begin
        update work_item set paper_ref = v_ref, updated_at = greatest(p_now, now()) where id = p_work_item_id;
      exception when unique_violation then
        -- Taken by a write that committed while this one ran.
        return 'paper_ref_taken';
      end;
      return 'saved';
    end
  $$;
