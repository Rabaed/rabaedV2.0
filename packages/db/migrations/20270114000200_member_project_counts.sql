-- Projects per Member on the Members page (RP-413): how many active Projects each
-- Member of the acting Member's own Company is on, for every Member of that
-- Company and not only their Authorized Person (the Company's own Project Members
-- are theirs to know, V15). Only the count: never which Projects, and never a
-- Member or Project of another Company. No rows for a caller who isn't an active
-- Member. Closed Projects and removed or withdrawn rows don't count.
create function app.member_project_counts()
  returns table (member_id uuid, project_count integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select pm.member_id, count(*)::integer
        from project_member pm
        join participant p on p.id = pm.participant_id
        join project pr on pr.id = pm.project_id
        join member m on m.id = pm.member_id
        where app.current_company_id() is not null
          and m.company_id = app.current_company_id()
          and p.company_id = app.current_company_id()
          and pm.status = 'active' and p.status = 'active' and pr.status = 'active'
        group by pm.member_id;
    end
  $$;

revoke all on function app.member_project_counts() from public;
grant execute on function app.member_project_counts() to rabaed_app;
