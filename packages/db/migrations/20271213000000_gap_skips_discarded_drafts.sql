-- RP-1252: the Visibility Gap counts no discarded Draft as a use of a deactivated Trade or Location
-- (scenario RP-1252-1). As 20271209000000's body; only the use check changes: a Work Item counts
-- unless it is discarded (`discarded_at`), so a live or closed item still keeps the value in the gap.
create or replace function app.project_visibility_gap(p_project_id uuid)
  returns table (kind text, id uuid, parent_id uuid, depth smallint, code text, name jsonb, level_name jsonb, status text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name, v.status
        from visibility_dimension d
        join dimension_value v on v.dimension_id = d.id
        where d.project_id = p_project_id
          and p_project_id in (select app.current_admin_project_ids())
          and (
            v.status = 'active'
            or exists (
              select 1
              from work_item_dimension_value wv
              join work_item w on w.id = wv.work_item_id
              where wv.dimension_value_id = v.id and w.discarded_at is null
            )
          )
          and v.id not in (
            select c.id
            from participant p
            cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
            where p.project_id = p_project_id and p.status = 'active'
          )
        order by d.kind, v.depth, v.sort, v.id;
    end
  $$;
revoke execute on function app.project_visibility_gap(uuid) from public;
grant execute on function app.project_visibility_gap(uuid) to rabaed_app;
