-- RP-952 PR 2 (the withdrawal's UI; ADR 0028; visibility.md "A Participant's withdrawal";
-- scenarios RP-952-6 and RP-952-7):
--
-- * The Vacancies list (app.project_vacancies) gives each Vacancy's Step, by its name. The owner's
--   answer to Q3 (RP-952 comment 15714): for an item the Host Company's Project Admin can't see, the
--   list shows only the Step, the Project and the role, never its number, title or a Company. Its
--   return type changes, so it is dropped and made again, from its newest body (20271215000000).
-- * app.project_withdrawn_participants: the Project's withdrawn Participants (Company, Project Role,
--   when), for the Host Company's Project Admins alone, so the Participants card can show a
--   Participant as withdrawn. Anyone else reads no row, as for a Project that is not theirs.

drop function app.project_vacancies(uuid);

create function app.project_vacancies(p_project_id uuid)
  returns table (
    step_assignment_id uuid,
    work_item_id uuid,
    document_number text,
    title text,
    base_role text,
    role_name jsonb,
    vacant_since timestamptz,
    step_name jsonb
  )
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.is_host_admin(p_project_id) then
        return;
      end if;
      return query
        select a.id, seen.id, seen.document_number, seen.title, r.base_role, r.name, p.withdrawn_at, s.name
        from step_assignment a
        join work_item w on w.id = a.work_item_id and w.project_id = p_project_id and w.closed_at is null
        join participant p on p.id = a.participant_id
        join project_role r on r.id = p.project_role_id
        join workflow_step s on s.id = a.step_id
        left join lateral (select w.id, w.document_number, w.title where app.sees_work_item(w.id)) seen on true
        where a.status = 'vacant'
        order by p.withdrawn_at, seen.document_number nulls last, a.id;
    end
  $$;
revoke all on function app.project_vacancies(uuid) from public;
grant execute on function app.project_vacancies(uuid) to rabaed_app;

create function app.project_withdrawn_participants(p_project_id uuid)
  returns table (participant_id uuid, legal_name jsonb, base_role text, role_name jsonb, withdrawn_at timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.is_host_admin(p_project_id) then
        return;
      end if;
      return query
        select p.id, co.legal_name, r.base_role, r.name, p.withdrawn_at
        from participant p
        join company co on co.id = p.company_id
        join project_role r on r.id = p.project_role_id
        where p.project_id = p_project_id and p.status = 'withdrawn'
        order by p.withdrawn_at, p.id;
    end
  $$;
revoke all on function app.project_withdrawn_participants(uuid) from public;
grant execute on function app.project_withdrawn_participants(uuid) to rabaed_app;
