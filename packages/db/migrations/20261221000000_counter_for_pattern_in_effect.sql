-- One SQL definition of the pattern in effect (RP-380, found by the RP-311 epic
-- review): app.numbering_counter_for had its own copy of the query and of the
-- Rabaed Default literal. It now reads app.numbering_pattern_in_effect, the only
-- place holding both, so the counter a preview or a starting number keys can't
-- drift from the one app.take_transition increments.
--
-- As the numbering_admin migration left it (same signature, outcomes and grants),
-- except for the pattern lookup. app.start_numbering_counter is unchanged: it
-- already reads the pattern through app.numbering_pattern_in_effect.

create or replace function app.numbering_counter_for(
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

      select p.* into v_pattern from app.numbering_pattern_in_effect(p_project_id, v_type.id, p_at) p;
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
