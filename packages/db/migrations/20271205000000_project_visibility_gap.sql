-- RP-1156: the Project Visibility page (the owner's reference, gap rows 25 and 26; visibility.md V16).
--
-- app.project_visibility_gap: the Project's Trades and Locations that no active Participant covers,
-- for the Project's Project Admins only (scenario RP-1156-1). It is worked out from Participant
-- grants alone: a Project Member's narrower grant never opens it (V16). Anyone else gets no rows.

create function app.project_visibility_gap(p_project_id uuid)
  returns table (kind text, id uuid, parent_id uuid, depth smallint, code text, name jsonb, level_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name
        from visibility_dimension d
        join dimension_value v on v.dimension_id = d.id
        where d.project_id = p_project_id
          and p_project_id in (select app.current_admin_project_ids())
          and v.id not in (
            select c.id
            from participant p
            cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
            where p.project_id = p_project_id and p.status = 'active'
          )
        order by d.kind, v.depth, v.sort, v.id;
    end
  $$;

revoke all on function app.project_visibility_gap(uuid) from public;
grant execute on function app.project_visibility_gap(uuid) to rabaed_app;
