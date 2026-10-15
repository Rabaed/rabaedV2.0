-- Review fixes for spec RP-598: app.sar_adds_supplier (20270405000000_sar_adds_supplier.sql),
-- unchanged but for its "not at Code A or B" condition, now in parentheses so it reads as it
-- runs (`and` binds before `or`). That migration has been applied on the spec's databases,
-- so it is redefined here rather than edited.
create or replace function app.sar_adds_supplier(p_work_item_id uuid, p_at timestamptz)
  returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
      v_trade_id uuid;
      v_scopes uuid[];
      v_en text;
      v_ar text;
    begin
      select w.project_id, w.outcome, w.data into v_item
      from work_item w join work_item_type t on t.id = w.work_item_type_id
      where w.id = p_work_item_id and t.adds_approved_supplier;
      if v_item.project_id is null or (v_item.outcome is distinct from 'A' and v_item.outcome is distinct from 'B') then
        return;
      end if;

      -- Its name, English and Arabic (RP-591); one language stands in for the other when only one is given.
      v_en := nullif(btrim(v_item.data ->> 'supplier_name_en'), '');
      v_ar := nullif(btrim(v_item.data ->> 'supplier_name_ar'), '');
      if v_en is null and v_ar is null then
        return;
      end if;

      select v.dimension_value_id into v_trade_id
      from work_item_dimension_value v join visibility_dimension d on d.id = v.dimension_id
      where v.work_item_id = p_work_item_id and d.kind = 'trade'
      limit 1;
      if v_trade_id is null then
        return;
      end if;
      -- Its Scope, when it names exactly one of the Trade's: with several, the whole Trade.
      select coalesce(array_agg(s.id), '{}') into v_scopes
      from work_item_scope ws join scope s on s.id = ws.scope_id
      where ws.work_item_id = p_work_item_id and s.trade_value_id = v_trade_id;

      perform pg_advisory_xact_lock(hashtextextended('approved_supplier/' || v_trade_id::text, 0));
      if app.approved_supplier_listed(v_trade_id, jsonb_build_object('en', coalesce(v_en, v_ar), 'ar', coalesce(v_ar, v_en))) then
        return;
      end if;
      insert into approved_supplier (project_id, name, trade_value_id, scope_id, source, source_work_item_id, added_at)
      values (
        v_item.project_id,
        jsonb_build_object('en', coalesce(v_en, v_ar), 'ar', coalesce(v_ar, v_en)),
        v_trade_id,
        case when cardinality(v_scopes) = 1 then v_scopes[1] end,
        'submittal', p_work_item_id, greatest(p_at, now())
      );
    end
  $$;
