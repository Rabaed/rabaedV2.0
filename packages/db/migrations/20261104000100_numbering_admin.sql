-- Numbering from Rabaed Admin (RP-317, spec RP-311; workflow-engine.md §8 "Who sets
-- the pattern"; ADR 0010; visibility.md V9).
--
-- A Rabaed Engineer sets a Project's Numbering Pattern, Participant Codes and
-- starting numbers during onboarding, with the same rules as the Project Admin's
-- (RP-313, RP-314, RP-315). The admin service connects as rabaed_admin, which has
-- no Member and so none of the app.current_* context those functions check. To keep
-- one copy of each rule, the rule is moved into a core function that the Member's
-- function and Rabaed Admin both call:
--
-- * app.apply_numbering_pattern, app.assign_participant_code,
--   app.numbering_counter_for and app.start_numbering_counter hold the rules (the
--   checks, the writes). They check no caller: they are granted to rabaed_admin
--   alone, and the app role reaches them only through the Member's functions below,
--   which are unchanged for it (same signatures, same outcomes) and still check that
--   the acting Member is a Project Admin first.
-- * Each Rabaed Admin edit is an admin_action (asEngineer, with its reason). A pattern
--   row then names that action (numbering_pattern.admin_action_id, set_by_member_id
--   null), which is also the record of the Engineer accepting the shared-counter
--   warning. The row is written before its admin_action in the same transaction, so
--   the reference is checked at commit.

alter table numbering_pattern alter constraint numbering_pattern_admin_action_id_fkey deferrable initially deferred;

alter table admin_action drop constraint admin_action_action_check;
alter table admin_action add constraint admin_action_action_check
  check (action in (
    'onboard_company', 'read_onboarding_leads', 'invite_authorized_person', 'close_onboarding_lead',
    'create_option_list', 'add_option', 'rename_option', 'retire_option', 'restore_option',
    'read_numbering', 'set_numbering_pattern', 'set_participant_code', 'set_numbering_counter_start'
  ));

-- Numbering Pattern -------------------------------------------------------------------

-- Outcome: 'saved'; 'not_found' (no such Project); 'project_closed'; 'type_not_found';
-- 'invalid_pattern'; 'shared_counter_not_accepted' (as app.set_numbering_pattern).
create function app.apply_numbering_pattern(
  p_project_id uuid, p_work_item_type_id uuid, p_segments jsonb, p_separator text, p_seq_digits integer,
  p_seq_scope jsonb, p_shared_counter_accepted boolean, p_now timestamptz,
  p_set_by_member_id uuid, p_admin_action_id uuid
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
    begin
      if not exists (select 1 from project where id = p_project_id) then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if p_work_item_type_id is not null and not exists (
        select 1 from work_item_type t
        where t.id = p_work_item_type_id and (t.project_id is null or t.project_id = p_project_id)
      ) then
        return 'type_not_found';
      end if;
      if p_separator is null or p_separator not in ('-', '/') or p_seq_digits is null or p_seq_digits not between 3 and 7
        or not coalesce(app.is_numbering_pattern(p_segments, p_seq_scope), false)
      then
        return 'invalid_pattern';
      end if;
      if not app.counts_by_participant(p_segments, p_seq_scope) and not coalesce(p_shared_counter_accepted, false) then
        return 'shared_counter_not_accepted';
      end if;

      insert into numbering_pattern (
        project_id, work_item_type_id, segments, separator, seq_digits, seq_scope,
        shared_counter_accepted_at, set_by_member_id, admin_action_id, effective_from, created_at
      ) values (
        p_project_id, p_work_item_type_id, p_segments, p_separator, p_seq_digits, p_seq_scope,
        -- Recorded only where the warning applies.
        case when not app.counts_by_participant(p_segments, p_seq_scope) then v_at end,
        p_set_by_member_id, p_admin_action_id, v_at, v_at
      );
      return 'saved';
    end
  $$;

-- As RP-313 defined it: only a Project Admin of the Project; anyone else gets 'not_found'.
create or replace function app.set_numbering_pattern(
  p_project_id uuid, p_work_item_type_id uuid, p_segments jsonb, p_separator text, p_seq_digits integer,
  p_seq_scope jsonb, p_shared_counter_accepted boolean, p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return 'not_found';
      end if;
      return app.apply_numbering_pattern(
        p_project_id, p_work_item_type_id, p_segments, p_separator, p_seq_digits, p_seq_scope,
        p_shared_counter_accepted, p_now, app.current_member_id(), null);
    end
  $$;

-- Participant Code --------------------------------------------------------------------

-- Outcomes: 'set'; 'not_found' (no such active Participant); 'project_closed';
-- 'invalid_code'; 'duplicate_code'; 'code_in_use' (as app.set_participant_code).
create function app.assign_participant_code(p_participant_id uuid, p_code text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_participant record;
      v_code text := upper(btrim(p_code));
    begin
      select p.project_id, p.status into v_participant from participant p where p.id = p_participant_id;
      if v_participant.project_id is null or v_participant.status <> 'active' then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_participant.project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if v_code is null or v_code !~ '^[A-Z0-9]{2,6}$' or v_code !~ '[A-Z]' then
        return 'invalid_code';
      end if;

      -- Queues with app.issue_document_number, which fixes the code it builds a number with.
      perform 1 from participant where id = p_participant_id for update;
      if exists (select 1 from participant where id = p_participant_id and code = v_code) then
        return 'set';
      end if;
      if exists (select 1 from participant where id = p_participant_id and code_locked_at is not null) then
        return 'code_in_use';
      end if;
      update participant set code = v_code, updated_at = now() where id = p_participant_id;
      return 'set';
    exception when unique_violation then
      return 'duplicate_code';
    end
  $$;

-- As RP-314 defined it: who may see the Participant, and only a Project Admin may set it.
create or replace function app.set_participant_code(p_participant_id uuid, p_code text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_participant record;
    begin
      select p.project_id, p.company_id, p.status into v_participant
      from participant p where p.id = p_participant_id;
      -- What the Member may see: any Participant of a Project they administer, else their own Company's.
      if v_participant.project_id is null
        or v_participant.status <> 'active'
        or v_participant.project_id not in (select app.current_project_ids())
        or not (
          v_participant.company_id = app.current_company_id()
          or v_participant.project_id in (select app.current_admin_project_ids())
        )
      then
        return 'not_found';
      end if;
      if v_participant.project_id not in (select app.current_admin_project_ids()) then
        raise exception 'only a Project Admin can set a Participant Code' using errcode = '42501';
      end if;
      return app.assign_participant_code(p_participant_id, p_code);
    end
  $$;

-- Counters ----------------------------------------------------------------------------

-- app.numbering_counter (RP-315) without the caller check: the counter a Work Item of
-- the Type `p_type_code` raised by `p_participant_id`, with that Trade and Location,
-- would be numbered from at `p_at`. Outcomes: 'found'; 'not_found' (no such Project);
-- 'type_not_found'; 'participant_required', 'trade_required' or 'location_required';
-- 'value_not_found'.
create function app.numbering_counter_for(
  p_project_id uuid, p_type_code text, p_participant_id uuid, p_trade_id uuid, p_location_id uuid, p_at timestamptz
) returns table (
  outcome text, counter_key text, prefix text, separator text, seq_digits smallint, last_value integer, issued boolean
)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_type record;
      v_pattern record;
      v_participant jsonb;
      v_trade text;
      v_location_path jsonb := '[]'::jsonb;
      v_counted text[];
      v_numbering record;
      v_counter record;
    begin
      if not exists (select 1 from project where id = p_project_id) then
        return query select 'not_found'::text, null::text, null::text, null::text, null::smallint, null::integer, null::boolean;
        return;
      end if;
      select t.id, t.code into v_type from work_item_type t
      where t.code = p_type_code and (t.project_id = p_project_id or t.project_id is null)
      order by t.project_id nulls last limit 1;
      if v_type.id is null then
        return query select 'type_not_found'::text, null::text, null::text, null::text, null::smallint, null::integer, null::boolean;
        return;
      end if;

      select np.segments, np.separator, np.seq_digits, np.seq_scope into v_pattern
      from numbering_pattern np
      where np.project_id = p_project_id and np.effective_from <= p_at
        and (np.work_item_type_id = v_type.id or np.work_item_type_id is null)
      order by np.work_item_type_id is null, np.effective_from desc, np.id desc
      limit 1;
      if v_pattern.segments is null then
        select '[{"kind": "project"}, {"kind": "type"}, {"kind": "participant"}]'::jsonb as segments,
          '-' as separator, 4::smallint as seq_digits, '[0, 1, 2]'::jsonb as seq_scope
        into v_pattern;
      end if;
      select array_agg(v_pattern.segments -> (i::text::integer) ->> 'kind') into v_counted
      from jsonb_array_elements(v_pattern.seq_scope) i;

      -- Each value: required when counted by, refused when not the Project's.
      if p_participant_id is null and 'participant' = any (v_counted) then
        return query select 'participant_required'::text, null::text, null::text, null::text, null::smallint, null::integer, null::boolean;
        return;
      end if;
      if p_trade_id is null and 'trade' = any (v_counted) then
        return query select 'trade_required'::text, null::text, null::text, null::text, null::smallint, null::integer, null::boolean;
        return;
      end if;
      if p_location_id is null and 'location' = any (v_counted) then
        return query select 'location_required'::text, null::text, null::text, null::text, null::smallint, null::integer, null::boolean;
        return;
      end if;
      if p_participant_id is not null then
        -- Its Participant Code (RP-314); while it has none, the ordinal stands in,
        -- as in app.document_numbering.
        select jsonb_build_object('code', p.code, 'ordinal', p.ordinal) into v_participant from participant p
        where p.id = p_participant_id and p.project_id = p_project_id and p.status = 'active';
        if v_participant is null then
          return query select 'value_not_found'::text, null::text, null::text, null::text, null::smallint, null::integer, null::boolean;
          return;
        end if;
      end if;
      if p_trade_id is not null then
        select v.code into v_trade from dimension_value v join visibility_dimension d on d.id = v.dimension_id
        where v.id = p_trade_id and v.project_id = p_project_id and d.kind = 'trade';
        if v_trade is null then
          return query select 'value_not_found'::text, null::text, null::text, null::text, null::smallint, null::integer, null::boolean;
          return;
        end if;
      end if;
      if p_location_id is not null then
        with recursive up as (
          select v.id, v.parent_id, v.code, v.depth from dimension_value v
          join visibility_dimension d on d.id = v.dimension_id
          where v.id = p_location_id and v.project_id = p_project_id and d.kind = 'location'
          union all
          select v.id, v.parent_id, v.code, v.depth from dimension_value v join up on v.id = up.parent_id
        )
        select coalesce(jsonb_agg(code order by depth), '[]'::jsonb) into v_location_path from up;
        if jsonb_array_length(v_location_path) = 0 then
          return query select 'value_not_found'::text, null::text, null::text, null::text, null::smallint, null::integer, null::boolean;
          return;
        end if;
      end if;

      select * into v_numbering from app.document_numbering(
        v_pattern.segments, v_pattern.separator, v_pattern.seq_scope,
        jsonb_strip_nulls(jsonb_build_object(
          'project_code', (select code from project where id = p_project_id),
          'type_code', v_type.code,
          'trade_code', v_trade,
          'participant_code', v_participant ->> 'code',
          'participant_ordinal', v_participant ->> 'ordinal',
          'location_path', v_location_path)));
      select c.last_value, c.starting_value into v_counter from numbering_counter c
      where c.project_id = p_project_id and c.counter_key = v_numbering.counter_key;
      return query select 'found'::text, v_numbering.counter_key, v_numbering.prefix, v_pattern.separator,
        v_pattern.seq_digits, v_counter.last_value,
        v_counter.last_value is not null and v_counter.last_value is distinct from v_counter.starting_value - 1;
    end
  $$;

-- As RP-315 defined it: only a Project Admin of the Project; anyone else gets 'not_found'.
create or replace function app.numbering_counter(
  p_project_id uuid, p_type_code text, p_participant_id uuid, p_trade_id uuid, p_location_id uuid, p_at timestamptz
) returns table (
  outcome text, counter_key text, prefix text, separator text, seq_digits smallint, last_value integer, issued boolean
)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return query select 'not_found'::text, null::text, null::text, null::text, null::smallint, null::integer, null::boolean;
        return;
      end if;
      return query select * from app.numbering_counter_for(
        p_project_id, p_type_code, p_participant_id, p_trade_id, p_location_id, p_at);
    end
  $$;

-- app.set_numbering_counter_start (RP-315) without the caller check. Outcome: 'set';
-- app.numbering_counter_for's refusals; 'project_closed'; 'counter_used'.
create function app.start_numbering_counter(
  p_project_id uuid, p_type_code text, p_participant_id uuid, p_trade_id uuid, p_location_id uuid,
  p_starting_value integer, p_now timestamptz
) returns table (outcome text, counter_key text, next_number text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_counter record;
    begin
      select * into v_counter from app.numbering_counter_for(
        p_project_id, p_type_code, p_participant_id, p_trade_id, p_location_id, greatest(p_now, now()));
      if v_counter.outcome <> 'found' then
        return query select v_counter.outcome, null::text, null::text;
        return;
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::text, null::text;
        return;
      end if;
      -- Atomic against a first number issued at the same moment: the update only
      -- applies while the counter has issued nothing.
      insert into numbering_counter as c (project_id, counter_key, last_value, starting_value)
      values (p_project_id, v_counter.counter_key, p_starting_value - 1, p_starting_value)
      on conflict (project_id, counter_key) do update
        set last_value = excluded.last_value, starting_value = excluded.starting_value
        where c.starting_value is not null and c.last_value = c.starting_value - 1;
      if not found then
        return query select 'counter_used'::text, null::text, null::text;
        return;
      end if;
      return query select 'set'::text, v_counter.counter_key,
        v_counter.prefix || v_counter.separator
          || lpad(p_starting_value::text, greatest(v_counter.seq_digits, length(p_starting_value::text)), '0');
    end
  $$;

-- As RP-315 defined it: only a Project Admin of the Project; anyone else gets 'not_found'.
create or replace function app.set_numbering_counter_start(
  p_project_id uuid, p_type_code text, p_participant_id uuid, p_trade_id uuid, p_location_id uuid,
  p_starting_value integer, p_now timestamptz
) returns table (outcome text, counter_key text, next_number text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return query select 'not_found'::text, null::text, null::text;
        return;
      end if;
      return query select * from app.start_numbering_counter(
        p_project_id, p_type_code, p_participant_id, p_trade_id, p_location_id, p_starting_value, p_now);
    end
  $$;

revoke all on function
  app.apply_numbering_pattern(uuid, uuid, jsonb, text, integer, jsonb, boolean, timestamptz, uuid, uuid),
  app.assign_participant_code(uuid, text),
  app.numbering_counter_for(uuid, text, uuid, uuid, uuid, timestamptz),
  app.start_numbering_counter(uuid, text, uuid, uuid, uuid, integer, timestamptz)
  from public;
-- Rabaed Admin only; the app role reaches them through the Member's functions above.
grant execute on function
  app.apply_numbering_pattern(uuid, uuid, jsonb, text, integer, jsonb, boolean, timestamptz, uuid, uuid),
  app.assign_participant_code(uuid, text),
  app.numbering_counter_for(uuid, text, uuid, uuid, uuid, timestamptz),
  app.start_numbering_counter(uuid, text, uuid, uuid, uuid, integer, timestamptz)
  to rabaed_admin;
