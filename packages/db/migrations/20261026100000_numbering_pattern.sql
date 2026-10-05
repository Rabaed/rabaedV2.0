-- Numbering Patterns (RP-312, spec RP-311; workflow-engine.md §8 "Settled
-- 2026-10-05 (Document numbering)"; data-model.md numbering_pattern,
-- numbering_counter; visibility.md, Document Numbers).
--
-- A prefactor: Document Numbers are built from a Numbering Pattern instead of a
-- fixed format. No Project has a pattern yet, so the Rabaed Default applies, and
-- it is the format so far: every number is still <project>-<type>-<ordinal>-0001,
-- counted under the same counter keys.
--
-- * numbering_pattern: per Project, optionally per Work Item Type, effective from
--   a moment. A change is a new row; old numbers stay as issued. Project Members
--   read their Project's patterns; nobody writes them yet (RP-313 adds that).
-- * app.document_numbering: the pure builder, the database's copy of
--   @rabaed/domain's documentNumbering (packages/domain/src/numbering.ts). The
--   two must agree; the seam-2 suite numbers items under several patterns.
-- * app.issue_document_number: resolves the pattern in effect (the Type's, else
--   the Project's, else the Rabaed Default), takes the next value of its counter
--   and returns the number. Gap-free: in the caller's transaction.
-- * app.take_transition calls it at the first exit from Draft; otherwise as in
--   the answers history migration.

-- Numbering Pattern -------------------------------------------------------------------

-- Whether `segments` is 1 to 6 known segments and `seq_scope` the positions (from
-- 0) of distinct segments among them. A Location segment names a level of the
-- Location tree (1 = Zone); fixed text is 1 to 10 capital letters or digits.
create function app.is_numbering_pattern(p_segments jsonb, p_seq_scope jsonb) returns boolean
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select jsonb_typeof(p_segments) = 'array'
      and jsonb_array_length(p_segments) between 1 and 6
      and not exists (
        select 1 from jsonb_array_elements(p_segments) s
        where jsonb_typeof(s) <> 'object' or not case s ->> 'kind'
          when 'project' then s = '{"kind": "project"}'
          when 'type' then s = '{"kind": "type"}'
          when 'trade' then s = '{"kind": "trade"}'
          when 'participant' then s = '{"kind": "participant"}'
          when 'location' then s - 'level' = '{"kind": "location"}' and s -> 'level' in ('1', '2', '3')
          when 'text' then s - 'text' = '{"kind": "text"}' and coalesce(s ->> 'text' ~ '^[A-Z0-9]{1,10}$', false)
          else false end
      )
      and jsonb_typeof(p_seq_scope) = 'array'
      and not exists (
        select 1 from jsonb_array_elements(p_seq_scope) i
        where jsonb_typeof(i) <> 'number' or i::text !~ '^[0-9]$' or i::text::integer >= jsonb_array_length(p_segments)
      )
      and (select count(distinct i) = count(*) from jsonb_array_elements(p_seq_scope) i)
  $$;

-- Whether the sequence counts separately for the Participant Code, so each
-- Company's numbers run without gaps from the others'.
create function app.counts_by_participant(p_segments jsonb, p_seq_scope jsonb) returns boolean
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1 from jsonb_array_elements(p_seq_scope) i
      where p_segments -> (i::text::integer) ->> 'kind' = 'participant'
    )
  $$;

create table numbering_pattern (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null references project (id),
  -- Null: the Project's pattern; set: this Work Item Type's, over the Project's.
  work_item_type_id uuid references work_item_type (id),
  segments jsonb not null,
  separator text not null check (separator in ('-', '/')),
  seq_digits smallint not null check (seq_digits between 3 and 7),
  -- The positions of the segments the sequence counts separately for.
  seq_scope jsonb not null,
  -- When the setter accepted that, without the Participant Code in seq_scope,
  -- each Company can tell the others' volume from the gaps (visibility.md).
  shared_counter_accepted_at timestamptz,
  -- Who set it: a Project Admin, or a Rabaed Engineer through Rabaed Admin.
  set_by_member_id uuid references member (id),
  admin_action_id uuid references admin_action (id),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint numbering_pattern_shape check (app.is_numbering_pattern(segments, seq_scope)),
  constraint numbering_pattern_shared_counter_accepted
    check (app.counts_by_participant(segments, seq_scope) or shared_counter_accepted_at is not null),
  constraint numbering_pattern_set_by check (num_nonnulls(set_by_member_id, admin_action_id) = 1)
);
create index numbering_pattern_project_idx on numbering_pattern (project_id, work_item_type_id, effective_from);

alter table numbering_pattern enable row level security;
-- Every Project Member reads the pattern (the Numbering page shows it read-only);
-- nobody writes it through the app role yet.
revoke insert, update, delete, truncate on numbering_pattern from rabaed_app;
create policy member_reads_numbering_patterns on numbering_pattern for select to rabaed_app
  using (project_id in (select app.current_project_ids()));
-- A pattern is history once in effect: a change is a new row.
revoke update, delete, truncate on numbering_pattern from rabaed_admin;

-- Building and issuing numbers --------------------------------------------------------

-- A Work Item's counter key and number prefix under a pattern, from its
-- attributes: project_code, type_code, trade_code, participant_code (null until
-- set: the ordinal, two digits at least, stands in), participant_ordinal, and
-- location_path, the codes of its Location and its parents from the Zone down.
-- A Location segment prints the item's Location at its level, or the item's own
-- when it sits above that level, and nothing without a Location. The key joins
-- the counted values with '-' whatever the separator.
create function app.document_numbering(
  p_segments jsonb, p_separator text, p_seq_scope jsonb, p_item jsonb
) returns table (counter_key text, prefix text)
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    with segment as (
      select s, (n - 1)::integer as i from jsonb_array_elements(p_segments) with ordinality as e (s, n)
    ),
    value as (
      select i, case s ->> 'kind'
        when 'project' then p_item ->> 'project_code'
        when 'type' then p_item ->> 'type_code'
        when 'trade' then p_item ->> 'trade_code'
        when 'participant' then coalesce(p_item ->> 'participant_code',
          lpad(p_item ->> 'participant_ordinal', greatest(2, length(p_item ->> 'participant_ordinal')), '0'))
        when 'location' then coalesce(
          p_item -> 'location_path' ->> ((s ->> 'level')::integer - 1), p_item -> 'location_path' ->> -1)
        when 'text' then s ->> 'text'
        end as v
      from segment
    )
    select
      coalesce(string_agg(v, '-' order by i) filter (where p_seq_scope @> to_jsonb(i)), ''),
      coalesce(string_agg(v, p_separator order by i), '')
    from value
  $$;

-- Issues the Document Number of a Work Item first leaving Draft at `p_at`: under
-- the Numbering Pattern in effect then (its Type's, else its Project's, else the
-- Rabaed Default), with the next value of that pattern's counter. Called only by
-- app.take_transition, in its transaction, so a number is never skipped or reused.
create function app.issue_document_number(p_work_item_id uuid, p_at timestamptz) returns text
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
      v_pattern record;
      v_attributes jsonb;
      v_numbering record;
      v_seq integer;
    begin
      select w.project_id, w.work_item_type_id, pr.code as project_code, t.code as type_code, p.ordinal
      into v_item
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      join participant p on p.id = w.raised_by_participant_id
      where w.id = p_work_item_id;

      select np.segments, np.separator, np.seq_digits, np.seq_scope into v_pattern
      from numbering_pattern np
      where np.project_id = v_item.project_id and np.effective_from <= p_at
        and (np.work_item_type_id = v_item.work_item_type_id or np.work_item_type_id is null)
      order by np.work_item_type_id is null, np.effective_from desc, np.id desc
      limit 1;
      if v_pattern.segments is null then
        -- The Rabaed Default: Project, Type, Participant Code, 4 digits, counted by all three.
        select '[{"kind": "project"}, {"kind": "type"}, {"kind": "participant"}]'::jsonb as segments,
          '-' as separator, 4::smallint as seq_digits, '[0, 1, 2]'::jsonb as seq_scope
        into v_pattern;
      end if;

      v_attributes := jsonb_build_object(
        'project_code', v_item.project_code,
        'type_code', v_item.type_code,
        'participant_ordinal', v_item.ordinal,
        'trade_code', (
          select v.code from work_item_dimension_value wv
          join visibility_dimension d on d.id = wv.dimension_id
          join dimension_value v on v.id = wv.dimension_value_id
          where wv.work_item_id = p_work_item_id and d.kind = 'trade'),
        'location_path', (
          with recursive up as (
            select v.id, v.parent_id, v.code, v.depth from work_item_dimension_value wv
            join visibility_dimension d on d.id = wv.dimension_id
            join dimension_value v on v.id = wv.dimension_value_id
            where wv.work_item_id = p_work_item_id and d.kind = 'location'
            union all
            select v.id, v.parent_id, v.code, v.depth from dimension_value v join up on v.id = up.parent_id
          )
          select coalesce(jsonb_agg(code order by depth), '[]'::jsonb) from up)
      );
      select * into v_numbering
      from app.document_numbering(v_pattern.segments, v_pattern.separator, v_pattern.seq_scope, v_attributes);

      insert into numbering_counter as c (project_id, counter_key, last_value)
      values (v_item.project_id, v_numbering.counter_key, 1)
      on conflict (project_id, counter_key) do update set last_value = c.last_value + 1
      returning last_value into v_seq;
      return v_numbering.prefix || v_pattern.separator
        || lpad(v_seq::text, greatest(v_pattern.seq_digits, length(v_seq::text)), '0');
    end
  $$;

revoke all on function
  app.is_numbering_pattern(jsonb, jsonb),
  app.counts_by_participant(jsonb, jsonb),
  app.document_numbering(jsonb, text, jsonb, jsonb),
  app.issue_document_number(uuid, timestamptz)
  from public;
-- Rabaed Admin writes patterns (RP-313); its inserts run the checks.
grant execute on function app.is_numbering_pattern(jsonb, jsonb), app.counts_by_participant(jsonb, jsonb)
  to rabaed_admin;

-- Transitions -------------------------------------------------------------------------

-- As in the answers history migration, but for the number: built by
-- app.issue_document_number from the pattern in effect.
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
      v_reason text := nullif(btrim(p_reason), '');
      v_note text := nullif(btrim(p_internal_note), '');
      v_holder uuid;
      v_number text;
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
        v_number := app.issue_document_number(p_work_item_id, v_at);
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
