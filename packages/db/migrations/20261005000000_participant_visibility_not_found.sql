-- 404, never 403, when someone who isn't a Project Admin sets a Participant's
-- Visibility (RP-233; visibility.md "Direct URL or ID", V15, V16).
--
-- app.set_participant_visibility first found any active Participant on the
-- caller's Projects and only then refused a caller who isn't a Project Admin
-- (42501, a 403), while a made-up id answered 'not_found' (a 404). A Project
-- Member who isn't a Project Admin could so tell that another Company is a
-- Participant. It now answers 'not_found' to anyone but the Project's Project
-- Admins, whether the Participant exists or not, and never raises 42501.
--
-- The other app.* writes were checked for the same pattern, an existence check
-- before the permission check: each refuses with 42501 either before looking
-- anything up (app.require_authorized_company_id, app.create_project) or only
-- once the caller is known to see the object (the Project, for
-- app.add_participant, app.add_dimension_value and app.create_work_item; the
-- Work Item, for the Transition and claim functions).

-- A Project Admin sets a Participant's Visibility in one dimension: all of it,
-- or p_value_ids. Its Members' grants shrink to what it still covers (V4).
-- Outcome: 'set', 'not_found' (not a Participant of a Project the acting Member
-- is a Project Admin of, whether or not it exists), 'project_closed' or
-- 'value_not_found' (not a value of that dimension).
create or replace function app.set_participant_visibility(
  p_participant_id uuid, p_kind text, p_is_all boolean, p_value_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_values uuid[] := case when p_is_all then '{}' else coalesce(p_value_ids, '{}') end;
      v_project_id uuid;
      v_dimension_id uuid;
      v_grant_id uuid;
      v_member_grant record;
    begin
      -- Locked, so a Member's grant is never checked against a Participant grant
      -- that is changing at the same time (see app.set_member_visibility).
      select project_id into v_project_id from participant
      where id = p_participant_id and status = 'active' and project_id in (select app.current_admin_project_ids())
      for update;
      if v_project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      v_dimension_id := app.project_dimension_id(v_project_id, p_kind);
      if exists (select unnest(v_values) except select id from dimension_value where dimension_id = v_dimension_id) then
        return 'value_not_found';
      end if;

      insert into visibility_grant as g (project_id, subject_kind, participant_id, dimension_id, is_all)
      values (v_project_id, 'participant', p_participant_id, v_dimension_id, p_is_all)
      on conflict on constraint visibility_grant_subject_dimension_key
        do update set is_all = excluded.is_all, updated_at = v_at
      returning g.id into v_grant_id;
      perform app.replace_grant_values(v_grant_id, v_values);

      -- Each Member's grant becomes its intersection with what the Participant now covers, stored
      -- as the topmost values, so widening the Participant again doesn't widen them.
      -- A Member's "all" already means all of the Participant's.
      for v_member_grant in
        select id from visibility_grant
        where participant_id = p_participant_id and project_member_id is not null
          and dimension_id = v_dimension_id and not is_all
      loop
        perform app.replace_grant_values(v_member_grant.id, array(
          with kept as (
            select app.values_covered_by_grant(v_member_grant.id) as id
            intersect
            select app.values_covered_by_participant(p_participant_id, v_dimension_id)
          )
          select v.id from kept k join dimension_value v on v.id = k.id
          where v.parent_id is null or v.parent_id not in (select id from kept)
        ));
        update visibility_grant set updated_at = v_at where id = v_member_grant.id;
      end loop;
      return 'set';
    end
  $$;
