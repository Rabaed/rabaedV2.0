-- RP-1155: the Participants pages (the owner's reference, gap rows 18 and 24; visibility.md V16).
--
-- 1. app.add_project_member gives the new Project Member "all" in every dimension, which for a
--    Member means all of their Participant's (data-model.md §3), so they start with all of their
--    Company's Visibility on the Project and never more (scenario RP-1155-3). The Authorized Person
--    narrows it after. A Member added again after a removal starts with "all" too, as the Add
--    dialog says; a Member already on the Project keeps theirs.
-- 2. app.participant_visibility_gap: the values a Participant covers that none of its active Project
--    Members do, for that Participant's own Authorized Person only (V16; scenario 33, RP-1155-2).
--    Only an active Member counts: one still invited sees nothing yet. Anyone else gets no rows.

-- From 20260928220000_participants.sql: the same, and then the added Member's "all" grants.
create or replace function app.add_project_member(p_participant_id uuid, p_member_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_at timestamptz := greatest(p_now, now());
      v_project_id uuid;
      v_project_member_id uuid;
    begin
      select project_id into v_project_id from participant
      where id = p_participant_id and company_id = v_company_id and status = 'active';
      if v_project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if not exists (
        select 1 from member where id = p_member_id and company_id = v_company_id and status in ('invited', 'active')
      ) then
        return 'member_not_found';
      end if;

      insert into project_member as pm (project_id, participant_id, member_id)
      values (v_project_id, p_participant_id, p_member_id)
      on conflict (participant_id, member_id) do update
        set status = 'active', removed_at = null, updated_at = v_at
        where pm.status = 'removed'
      returning pm.id into v_project_member_id;
      -- Not found: already on the Project, and their Visibility stays as it is.
      if v_project_member_id is null then
        return 'added';
      end if;
      -- All of the Participant's, in every dimension: a grant from before a removal is replaced.
      insert into visibility_grant as g (project_id, subject_kind, participant_id, project_member_id, dimension_id, is_all)
      select v_project_id, 'project_member', p_participant_id, v_project_member_id, d.id, true
      from visibility_dimension d
      where d.project_id = v_project_id
      on conflict on constraint visibility_grant_subject_dimension_key
        do update set is_all = true, updated_at = v_at;
      delete from visibility_grant_value
      where grant_id in (select id from visibility_grant where project_member_id = v_project_member_id);
      return 'added';
    end
  $$;

create function app.participant_visibility_gap(p_participant_id uuid)
  returns table (kind text, id uuid, parent_id uuid, depth smallint, code text, name jsonb, level_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name
        from participant p
        join visibility_dimension d on d.project_id = p.project_id
        cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
        join dimension_value v on v.id = c.id
        where p.id = p_participant_id and p.status = 'active'
          and p.company_id = app.current_authorized_company_id()
          and c.id not in (
            select mc.id
            from project_member pm
            join member m on m.id = pm.member_id
            cross join lateral app.values_covered_by_project_member(pm.id, d.id) as mc (id)
            where pm.participant_id = p.id and pm.status = 'active' and m.status = 'active'
          )
        order by d.kind, v.depth, v.sort, v.id;
    end
  $$;

revoke all on function app.participant_visibility_gap(uuid) from public;
grant execute on function app.participant_visibility_gap(uuid) to rabaed_app;
