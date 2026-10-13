-- RP-581 (ADR 0021): a Trade or Location the Document Number uses never changes
-- once the item is numbered. To change it, cancel the item and raise a new one.
--
-- app.number_fixed_fields reads the pattern Version the item was numbered under
-- (numbered_at), not the Project's current one, and says which Built-in Fields
-- its segments hold. app.check_work_item_built_ins (rebuilt from its only
-- definition, 20261012000000) refuses a change to one of them: number_part_fixed.

create function app.number_fixed_fields(p_work_item_id uuid) returns text[]
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return coalesce((
        select array_agg(distinct k.f)
        from work_item w
        cross join lateral app.numbering_pattern_in_effect(w.project_id, w.work_item_type_id, w.numbered_at) np
        cross join lateral jsonb_array_elements(np.segments) s
        cross join lateral (select case s ->> 'kind' when 'trade' then 'trade' when 'location' then 'location' end) k (f)
        where w.id = p_work_item_id and w.document_number is not null and w.numbered_at is not null
          and k.f is not null
      ), '{}'::text[]);
    end
  $$;

create or replace function app.check_work_item_built_ins(
  p_work_item_id uuid, p_project_id uuid, p_project_member_id uuid,
  p_trade_id uuid, p_location_id uuid, p_scope_ids uuid[]
) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_trade_dimension uuid := app.project_dimension_id(p_project_id, 'trade');
      v_location_dimension uuid := app.project_dimension_id(p_project_id, 'location');
      v_scope_ids uuid[] := array(select distinct x from unnest(coalesce(p_scope_ids, '{}')) x where x is not null);
      v_fixed text[] := case when p_work_item_id is null then '{}'::text[] else app.number_fixed_fields(p_work_item_id) end;
    begin
      if p_trade_id is null then
        return 'trade_required';
      end if;
      if 'trade' = any (v_fixed) and p_trade_id is distinct from (
        select wv.dimension_value_id from work_item_dimension_value wv
        where wv.work_item_id = p_work_item_id and wv.dimension_id = v_trade_dimension)
      or 'location' = any (v_fixed) and p_location_id is distinct from (
        select wv.dimension_value_id from work_item_dimension_value wv
        where wv.work_item_id = p_work_item_id and wv.dimension_id = v_location_dimension)
      then
        return 'number_part_fixed';
      end if;
      if not exists (select 1 from dimension_value where id = p_trade_id and dimension_id = v_trade_dimension)
        or (p_location_id is not null
          and not exists (select 1 from dimension_value where id = p_location_id and dimension_id = v_location_dimension))
        or exists (
          select 1 from unnest(v_scope_ids) chosen (id)
          where not exists (
            select 1 from scope s
            where s.id = chosen.id and s.project_id = p_project_id and s.trade_value_id = p_trade_id
              and (s.parent_id is null or s.parent_id = any (v_scope_ids))
              and (s.status = 'active' or exists (
                select 1 from work_item_scope ws where ws.work_item_id = p_work_item_id and ws.scope_id = s.id))
          ))
      then
        return 'value_not_found';
      end if;
      if p_trade_id not in (select app.values_covered_by_project_member(p_project_member_id, v_trade_dimension))
        or (p_location_id is not null
          and p_location_id not in (select app.values_covered_by_project_member(p_project_member_id, v_location_dimension)))
      then
        return 'outside_visibility';
      end if;
      return 'ok';
    end
  $$;

-- The api reads it for the item's Form (fixedByNumber), only for an item the
-- caller sees (V1); the helper and the check stay internal.
create function app.work_item_fixed_fields(p_work_item_id uuid) returns text[]
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) then
        return '{}'::text[];
      end if;
      return app.number_fixed_fields(p_work_item_id);
    end
  $$;

revoke all on function app.number_fixed_fields(uuid), app.work_item_fixed_fields(uuid) from public;
grant execute on function app.work_item_fixed_fields(uuid) to rabaed_app;
