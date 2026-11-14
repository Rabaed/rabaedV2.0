-- RP-1300: a Revision Draft is found by its chain's base Document Number (owner's decision 2026-11-13,
-- UAT SUB-15). A Revision takes its own number (base " Rev n") only when it first leaves Draft
-- (workflow-engine.md §8), but the base number is known from the start, so the Draft's search text
-- holds it. Search answers only with items the caller sees (app.search_work_items checks
-- app.sees_work_item), so the Draft is found by the raiser's own Company only, as any Draft (V1).
--
-- As in 20270326000000_sent_back_built_ins.sql, plus the base number for a Revision not yet numbered.
-- Once numbered, the item's own number ("… Rev n") holds the base already.
create or replace function app.refresh_work_item_search(p_work_item_id uuid) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      insert into work_item_search (work_item_id, project_id, search_text)
      select w.id, w.project_id, concat_ws(' ',
          w.document_number,
          case when w.document_number is null and w.revision_no > 0 then
            (select o.document_number from work_item o where o.id = w.root_id and o.project_id = w.project_id)
          end,
          w.title,
          t.name ->> 'en', t.name ->> 'ar',
          co.legal_name ->> 'en', co.legal_name ->> 'ar',
          (select string_agg(concat_ws(' ', v.name ->> 'en', v.name ->> 'ar'), ' ' order by d.kind)
           from (
             select dv.dimension_id, dv.dimension_value_id from work_item_dimension_value dv
             where dv.work_item_id = w.id and w.built_ins_as_arrived is null
             union all
             select a.key::uuid, a.value::uuid from jsonb_each_text(w.built_ins_as_arrived -> 'dimensions') a
             where w.built_ins_as_arrived is not null
           ) dv
           join visibility_dimension d on d.id = dv.dimension_id
           join dimension_value v on v.id = dv.dimension_value_id
           where d.kind in ('trade', 'location')))
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join participant p on p.id = w.raised_by_participant_id
      join company co on co.id = p.company_id
      where w.id = p_work_item_id
      on conflict (work_item_id) do update set project_id = excluded.project_id, search_text = excluded.search_text;
    end
  $$;

-- The Revision Drafts made before this migration.
select app.refresh_work_item_search(w.id) from work_item w where w.document_number is null and w.revision_no > 0;
