-- Form answers read-only from Submit, and field-level history (RP-268, spec
-- RP-261; form-engine.md §4, §8; visibility.md V5, V13; workflow-engine.md §5.1).
--
-- * app.answers_open: a visible item's answers are open to its raiser while it
--   has never left the raiser, that is from Draft through the raiser's internal
--   Steps, until Submit (participant_entered_step_id is still the Draft Step it
--   started at). Closed items and closed Projects are never open. From Submit
--   onwards nobody saves, not even if the item comes back to the raiser.
-- * app.can_save_answers: any Member of the raiser's Participant, while the
--   answers are open (before: in Draft only). Documents still change in Draft
--   only, since they freeze when the item leaves it.
-- * app.save_work_item_answers: a save that changes anything once the item has
--   left Draft (later in a Draft it was Returned to too) appends
--   one 'answers_changed' event: payload {changes: [{field, old, new}]} by field
--   key, Built-in Fields included, a missing answer as null. It is internal to
--   the raiser's Participant (V5), carries the answers' hash, and is in the hash
--   chain like every event. Saves before it first leaves Draft are the Draft
--   itself: no event.
-- * app.take_transition: any Transition onwards while the answers are open, the
--   Submit included, needs the hash of the answers the API found complete (before:
--   only out of Draft), so an answer cleared at Internal Review can't be Submitted.
--   A cancel or a Return needs none. Otherwise as in the form versions migration.
-- * app.work_item_history adds each event's changes.

alter table work_item_event drop constraint work_item_event_type_check;
alter table work_item_event add constraint work_item_event_type_check check (type in (
  'created', 'transition', 'recommend_code', 'issue_code', 'assigned', 'claimed', 'released', 'vacated',
  'admin_reassigned', 'admin_reset', 'internal_note', 'cancelled', 'answers_changed'
));

-- Who may save, and when -------------------------------------------------------------

-- Whether a visible item's answers are open to its raiser now: it is open, on an
-- active Project, and has never left the raiser (Draft and its internal Steps).
create function app.answers_open(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.sees_work_item(p_work_item_id) and exists (
      select 1 from work_item w
      join project pr on pr.id = w.project_id and pr.status = 'active'
      where w.id = p_work_item_id and w.closed_at is null and app.is_draft_step(w.participant_entered_step_id)
    )
  $$;

-- Whether the acting Member may save a visible item's answers now: their
-- Participant raised it, and its answers are open. The one rule Save draft and
-- its button follow.
create or replace function app.can_save_answers(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.answers_open(p_work_item_id) and exists (
      select 1 from work_item w
      cross join lateral app.acting_project_member(w.id) me
      where w.id = p_work_item_id and me.participant_id = w.raised_by_participant_id
    )
  $$;

-- Whether the acting Member may change a visible item's Documents' list now as
-- its raiser: they may save its answers and it is in Draft, where its Documents
-- aren't frozen yet.
create function app.can_change_draft_documents(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.can_save_answers(p_work_item_id)
      and exists (select 1 from work_item w where w.id = p_work_item_id and app.is_draft_step(w.current_step_id))
  $$;

-- As in the documents migration, in Draft only.
create or replace function app.can_change_documents(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.can_change_draft_documents(p_work_item_id) and exists (
      select 1 from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      cross join lateral app.acting_project_member(w.id) me
      where w.id = p_work_item_id
        and app.project_member_has_permission(me.project_member_id, t.module_key, 'attach')
    )
  $$;

create or replace function app.documents_refusal(p_work_item_id uuid) returns text
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select case
      when exists (select 1 from work_item w join project pr on pr.id = w.project_id
        where w.id = p_work_item_id and pr.status <> 'active') then 'project_closed'
      when app.can_change_draft_documents(p_work_item_id) then 'forbidden'
      else 'not_editable'
    end
  $$;

-- Saving the answers -----------------------------------------------------------------

-- As in the built_in_fields migration, now also in the raiser's internal Steps,
-- and with a field-level diff for every change after Draft. Outcomes as before.
create or replace function app.save_work_item_answers(
  p_work_item_id uuid, p_data jsonb, p_trade_id uuid, p_location_id uuid, p_scope_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_outcome text;
      v_before jsonb;
      v_after jsonb;
      v_changes jsonb;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- Locked, so a Transition onwards checks exactly the answers it moves with.
      select w.*, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      if not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;
      v_outcome := app.check_work_item_built_ins(
        p_work_item_id, v_item.project_id, v_me.project_member_id, p_trade_id, p_location_id, p_scope_ids);
      if v_outcome <> 'ok' then
        return v_outcome;
      end if;
      v_before := app.work_item_answers(p_work_item_id);
      perform app.set_work_item_built_ins(p_work_item_id, v_item.project_id, p_trade_id, p_location_id, p_scope_ids);
      update work_item set data = coalesce(p_data, '{}') - array['trade', 'location', 'scopes'], updated_at = v_at
      where id = p_work_item_id;

      -- Once it has left Draft, every change is on the record (a Draft it was
      -- Returned to included), inside the raiser (V5).
      if exists (
        select 1 from work_item_event e
        where e.work_item_id = p_work_item_id and e.type = 'transition' and app.is_draft_step(e.from_step_id)
      ) then
        v_after := app.work_item_answers(p_work_item_id);
        select jsonb_agg(jsonb_build_object('field', k, 'old', v_before -> k, 'new', v_after -> k) order by k)
        into v_changes
        from (select jsonb_object_keys(v_before) union select jsonb_object_keys(v_after)) as keys (k)
        where (v_before -> k) is distinct from (v_after -> k);
        if v_changes is not null then
          insert into work_item_event (
            project_id, work_item_id, type, actor_member_id, actor_participant_id, payload,
            audience, audience_participant_id, content_sha256, created_at
          ) values (
            v_item.project_id, p_work_item_id, 'answers_changed', app.current_member_id(), v_me.participant_id,
            jsonb_build_object('changes', v_changes), 'internal', v_item.raised_by_participant_id,
            sha256(convert_to(v_after::text, 'UTF8')), v_at
          );
        end if;
      end if;
      return 'saved';
    end
  $$;

-- Taking a Transition ----------------------------------------------------------------

-- As in the form versions migration: a Transition onwards while the item has
-- never left the raiser (as app.answers_open; the row is locked here), not only
-- out of Draft, needs the checked hash.
create or replace function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_reason text, p_internal_note text, p_checked_data_sha256 bytea,
  p_idempotency_key uuid, p_now timestamptz
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
      v_next record;
      v_raiser record;
      v_reason text := nullif(btrim(p_reason), '');
      v_note text := nullif(btrim(p_internal_note), '');
      v_holder uuid;
      v_number text;
      v_prefix text;
      v_seq integer;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      select w.*, t.module_key, t.code as type_code, pr.status as project_status, pr.code as project_code
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
      where work_item_id = p_work_item_id and status in ('pooled', 'claimed', 'vacant');
      if v_assignment.status is distinct from 'claimed' or v_assignment.assignee_member_id <> v_member_id
        or v_assignment.participant_id <> v_me.participant_id
      then
        return 'not_holder';
      end if;

      select tr.*, target.stage_key as to_stage_key,
        source.outcome_mode as from_outcome_mode, app.is_draft_step(source.id) as from_draft
      into v_transition
      from workflow_transition tr
      join workflow_step target on target.id = tr.to_step_id
      join workflow_step source on source.id = tr.from_step_id
      where tr.workflow_version_id = v_item.workflow_version_id and tr.from_step_id = v_item.current_step_id
        and tr.key = p_transition_key;
      if v_transition.id is null then
        return 'transition_not_available';
      end if;
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, v_transition.permission) then
        return 'forbidden';
      end if;
      if v_transition.kind = 'return' and v_reason is null then
        return 'reason_required';
      end if;
      -- Moving on while the answers are open to the raiser (Draft and its internal
      -- Steps, so a Submit too): only with the answers the API found complete (the
      -- row is locked). A cancel or a Return needs no complete Form.
      if app.is_draft_step(v_item.participant_entered_step_id) and v_transition.kind not in ('cancel', 'return')
        and p_checked_data_sha256 is distinct from app.answers_sha256(p_work_item_id)
      then
        return 'form_not_checked';
      end if;

      -- The next holder (§3): the Participant, then, coming back by Return, the
      -- person who held that Step before if still in its pool; otherwise the pool.
      select * into v_next from app.next_step_holder(p_work_item_id, v_transition.id);
      if v_next.outcome not in ('ok', 'terminal') then
        return v_next.outcome;
      end if;
      if v_transition.kind = 'return' then
        select a.assignee_member_id into v_holder from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_transition.to_step_id and a.status = 'done'
          and a.assignee_member_id in (
            select member_id from app.step_pool(p_work_item_id, v_transition.to_step_id, v_next.participant_id))
        order by a.done_at desc, a.id desc limit 1;
      end if;

      -- Effects, in order.
      if v_item.document_number is null and v_transition.from_draft then
        select p.ordinal into v_raiser from participant p where p.id = v_item.raised_by_participant_id;
        v_prefix := concat_ws('-', v_item.project_code, v_item.type_code,
          lpad(v_raiser.ordinal::text, greatest(2, length(v_raiser.ordinal::text)), '0'));
        insert into numbering_counter as c (project_id, counter_key, last_value)
        values (v_item.project_id, v_prefix, 1)
        on conflict (project_id, counter_key) do update set last_value = c.last_value + 1
        returning last_value into v_seq;
        v_number := v_prefix || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
      end if;

      if v_next.outcome = 'terminal' then
        v_outcome := coalesce(v_transition.outcome, case when v_transition.kind = 'cancel' then 'cancelled' end);
        -- Publish-time validation requires one (workflow-engine.md §1, check 3); never guess it.
        if v_outcome is null then
          raise exception 'Transition % closes the item without an outcome', v_transition.key;
        end if;
      end if;
      -- The Internal Note stays inside the writer's Participant even when the
      -- Transition crosses to another (V5). It goes just before the Transition it
      -- is written with.
      if v_note is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'internal_note', v_member_id, v_me.participant_id, v_transition.id,
          jsonb_build_object('internal_note', v_note), 'internal', v_me.participant_id, v_at
        );
      end if;
      -- It leaves the acting Participant: handed to another, or closed (nobody holds it).
      v_crosses := v_next.participant_id is distinct from v_me.participant_id;
      -- Only what crosses is shared: a move inside one Participant stays its own,
      -- even from a Step that could issue a Code (V5, V14).
      v_audience := case
        when v_crosses or v_transition.kind in ('submit', 'close') then 'shared'
        else 'internal' end;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, created_at
      ) values (
        v_item.project_id, p_work_item_id,
        -- A Code is issued only where one is set; any other move from that Step is a plain Transition.
        case when v_transition.from_outcome_mode = 'issue_code' and v_outcome is not null then 'issue_code'
          else 'transition' end,
        v_member_id, v_me.participant_id, v_transition.id,
        v_item.current_step_id, v_transition.to_step_id,
        jsonb_strip_nulls(jsonb_build_object('reason', v_reason, 'document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then v_me.participant_id end,
        sha256(convert_to(jsonb_build_object('title', v_item.title, 'data', v_item.data)::text, 'UTF8')),
        v_at
      );

      update step_assignment set status = 'done', done_at = v_at, updated_at = v_at where id = v_assignment.id;

      update work_item set
        current_step_id = v_transition.to_step_id,
        current_stage_key = v_transition.to_stage_key,
        step_entered_at = v_at,
        participant_entered_at = case when v_crosses then v_at else participant_entered_at end,
        participant_entered_step_id = case when v_crosses then v_transition.to_step_id else participant_entered_step_id end,
        document_number = coalesce(document_number, v_number),
        outcome = v_outcome,
        closed_at = case when v_outcome is not null then v_at end,
        updated_at = v_at
      where id = p_work_item_id;

      if v_next.outcome = 'ok' then
        insert into step_assignment (
          project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at, updated_at
        ) values (
          v_item.project_id, p_work_item_id, v_transition.to_step_id, v_next.participant_id, v_holder,
          case when v_holder is null then 'pooled' else 'claimed' end,
          case when v_holder is null then null else v_at end, v_at, v_at
        );
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (p_work_item_id, v_item.project_id, v_next.participant_id, v_at, 'handling')
        on conflict do nothing;
      end if;

      -- Oversight (V2): Owners and Owner Representatives whose Visibility covers the Submitted item.
      if v_transition.kind = 'submit' then
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        select p_work_item_id, v_item.project_id, p.id, v_at, 'oversight'
        from participant p
        join project_role r on r.id = p.project_role_id
        where p.project_id = v_item.project_id and p.status = 'active'
          and r.base_role in ('owner', 'owner_representative')
          and app.participant_covers_item(p.id, p_work_item_id)
        on conflict do nothing;
      end if;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;

-- History ----------------------------------------------------------------------------

-- The item's history the acting Member may see, now with each 'answers_changed'
-- event's changes (otherwise as in the internal_note migration). RLS keeps them
-- to the raiser's Participant, like every internal event (V5).
drop function app.work_item_history(uuid);
create function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text, outcome text,
    internal_note text, changes jsonb
  )
  language sql stable security invoker
  set search_path = pg_catalog, public
  as $$
    select (row_number() over (order by e.seq))::integer, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
      tr.label, fs.name, ts.name, e.payload ->> 'reason', e.payload ->> 'document_number', e.payload ->> 'outcome',
      e.payload ->> 'internal_note', e.payload -> 'changes'
    from work_item_event e
    join work_item w on w.id = e.work_item_id
    left join app.work_item_companies(p_work_item_id) actor on actor.participant_id = e.actor_participant_id
    left join member m on m.id = e.actor_member_id
    left join workflow_transition tr on tr.id = e.transition_id
    left join workflow_step fs on fs.id = e.from_step_id
    left join workflow_step ts on ts.id = e.to_step_id
    where e.work_item_id = p_work_item_id
    order by e.seq
  $$;

revoke all on function
  app.answers_open(uuid),
  app.can_change_draft_documents(uuid),
  app.work_item_history(uuid)
  from public;
grant execute on function
  app.answers_open(uuid),
  app.work_item_history(uuid)
  to rabaed_app;
