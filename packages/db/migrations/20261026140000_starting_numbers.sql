-- Starting numbers, and who reads counters (RP-315, spec RP-311; workflow-engine.md
-- §8 "Starting numbers", data-model.md numbering_counter, visibility.md scenario 55).
--
-- * A counter's values reveal a Company's volume: only the Project's Project
--   Admins read numbering_counter (Rabaed Engineers read it through Rabaed
--   Admin, RP-317). Everyone else reads no rows; the API answers them 404.
-- * A Project Admin creates a counter ahead with a starting number, for the
--   counter key the pattern in effect gives the values chosen, only while that
--   counter has issued nothing; then it is locked. The counter stores the
--   starting number and last_value = starting number - 1, so
--   app.issue_document_number, unchanged, issues the starting number next.

-- A counter created ahead keeps its starting number. It has issued nothing while
-- last_value is one below it. A counter created by its first number has none.
alter table numbering_counter add column starting_value integer check (starting_value >= 1);
alter table numbering_counter drop constraint numbering_counter_last_value_check;
alter table numbering_counter add constraint numbering_counter_last_value_check
  check (last_value >= coalesce(starting_value - 1, 1));

-- Project Admins read their Projects' counters; no other Member reads any.
create policy project_admin_reads_numbering_counters on numbering_counter for select to rabaed_app
  using (project_id in (select app.current_admin_project_ids()));

-- The counter a Work Item of the Type `p_type_code` raised by `p_participant_id`,
-- with that Trade and Location, would be numbered from at `p_at`, for a Project
-- Admin of the Project: its key and number prefix under the pattern in effect
-- (the Type's, else the Project's, else the Rabaed Default, as in
-- app.issue_document_number), the pattern's separator and digits, its
-- last_value (null when it doesn't exist yet) and whether it has issued a number.
-- Only the values the pattern counts by are required; one it only prints is
-- left out of the prefix when not given.
-- Outcome: 'found'; 'not_found' (not a Project the acting Member is a Project
-- Admin of, whether or not it exists); 'type_not_found'; 'participant_required',
-- 'trade_required' or 'location_required' (the pattern counts by it);
-- 'value_not_found' (not an active Participant, or a Trade or Location, of the Project).
create function app.numbering_counter(
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
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
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
        -- The Participant Code (participant.code, RP-314) when the column exists
        -- and is set; until then the ordinal stands in, as in app.document_numbering.
        select to_jsonb(p) into v_participant from participant p
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

-- A Project Admin sets the starting number of the counter app.numbering_counter
-- finds for these values: creates it ahead, or changes the starting number of
-- one created ahead, while it has issued nothing. The next number it issues is
-- `p_starting_value`, returned as `next_number`.
-- Outcome: 'set'; app.numbering_counter's refusals; 'project_closed'; or
-- 'counter_used' (it has issued a number: its starting number is locked).
create function app.set_numbering_counter_start(
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
      select * into v_counter from app.numbering_counter(
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

revoke all on function
  app.numbering_counter(uuid, text, uuid, uuid, uuid, timestamptz),
  app.set_numbering_counter_start(uuid, text, uuid, uuid, uuid, integer, timestamptz)
  from public;
grant execute on function
  app.numbering_counter(uuid, text, uuid, uuid, uuid, timestamptz),
  app.set_numbering_counter_start(uuid, text, uuid, uuid, uuid, integer, timestamptz)
  to rabaed_app;
