-- RP-1051: every Member of a Participant reads Company Projects (visibility.md V15, scenario RP-1051-1).
--
-- app.company_participants refused anyone but the Authorized Person, so a plain Member's Company Projects page was a
-- 403. It now lists the acting Member's own Company's Participants they may look into, app.current_participant_ids,
-- the rule app.participation and the project_member policy already follow: the Authorized Person every one of the
-- Company's (as before), any other Member those on the Projects they are a Project Member of. Writes stay with the
-- Authorized Person (app.add_project_member and the rest are unchanged), and so do the Company's invitations.

-- From 20260928220000_participants.sql: read through app.current_participant_ids, refusing nobody.
create or replace function app.company_participants()
  returns table (participant_id uuid, project_id uuid, project_number integer, code text, name jsonb, base_role text, role_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select p.id, pr.id, pr.project_number, pr.code, pr.name, r.base_role, r.name
        from participant p
        join project pr on pr.id = p.project_id
        join project_role r on r.id = p.project_role_id
        where p.id in (select app.current_participant_ids())
        order by p.created_at desc, p.id desc;
    end
  $$;
