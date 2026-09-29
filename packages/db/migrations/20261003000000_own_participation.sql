-- Each Company sees only its own Participation and the Host Company (RP-223;
-- visibility.md V15, scenarios 28 and 29).
--
-- RP-190 let every Project Member see every Participant of the Project, with its
-- Company's name and Project Role. V15 narrows that:
-- * a Member sees only their own Company's Participant, and the Host Company's
--   name (app.project_host_company_name);
-- * the Project's Project Admins see every Participant, because they add and
--   manage them;
-- * another Company's name still appears on the Work Items the viewer can
--   access, where the item was raised by, is or was "With", or was acted on by
--   that Company (V14), through app.work_item_companies. Never its people.

-- participant: your own Company's (see app.current_participant_ids), and every
-- Participant of the Projects you are a Project Admin of.
drop policy member_reads_project_participants on participant;
create policy member_reads_own_or_administered_participants on participant for select to rabaed_app
  using (id in (select app.current_participant_ids()) or project_id in (select app.current_admin_project_ids()));

-- The Participants of one of the acting Member's Projects they may list: all of
-- them for its Project Admins, otherwise only their own Company's. Each with its
-- Company's name (and nothing else of the Company: its CR and VAT numbers stay
-- private). No rows for a Project they are not on.
create or replace function app.project_participants(p_project_id uuid)
  returns table (participant_id uuid, company_id uuid, legal_name jsonb, base_role text, role_name jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select p.id, co.id, co.legal_name, r.base_role, r.name
    from participant p
    join company co on co.id = p.company_id
    join project_role r on r.id = p.project_role_id
    where p.project_id = p_project_id and p.status = 'active'
      and p_project_id in (select app.current_project_ids())
      and (
        p.company_id = app.current_company_id()
        or p_project_id in (select app.current_admin_project_ids())
      )
    order by p.created_at, p.id
  $$;

-- The Host Company's name, for a Project one of the acting Member's own
-- Company's Participants they may look into is on (see
-- app.current_participant_ids): its Project Members, and its Authorized Person
-- before they are on it. Null for anyone else.
create function app.project_host_company_name(p_project_id uuid) returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select co.legal_name
    from project pr
    join company co on co.id = pr.host_company_id
    where pr.id = p_project_id
      and exists (
        select 1 from participant p
        where p.project_id = pr.id and p.id in (select app.current_participant_ids())
      )
  $$;

-- The Companies that appear on a Work Item the acting Member sees: the one that
-- raised it, those it is or was "With" (its Step assignments) and the actors of
-- its events the Member sees (shared ones, and their own Participant's internal
-- ones), each with its name (V14). No rows for an item they can't see.
create function app.work_item_companies(p_work_item_id uuid)
  returns table (participant_id uuid, legal_name jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select p.id, co.legal_name
    from participant p
    join company co on co.id = p.company_id
    where app.sees_work_item(p_work_item_id)
      and p.id in (
        select w.raised_by_participant_id from work_item w where w.id = p_work_item_id
        union
        select a.participant_id from step_assignment a where a.work_item_id = p_work_item_id
        union
        select e.actor_participant_id from work_item_event e
        where e.work_item_id = p_work_item_id
          and (e.audience = 'shared' or e.audience_participant_id in (select app.current_participant_ids()))
      )
  $$;

-- History names each actor's Company through the item, no longer through the
-- Project's Participants (otherwise as in the submit_and_codes migration).
create or replace function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text, outcome text
  )
  language sql stable security invoker
  set search_path = pg_catalog, public
  as $$
    select e.seq, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
      tr.label, fs.name, ts.name, e.payload ->> 'reason', e.payload ->> 'document_number', e.payload ->> 'outcome'
    from work_item_event e
    join work_item w on w.id = e.work_item_id
    left join app.work_item_companies(p_work_item_id) actor on actor.participant_id = e.actor_participant_id
    left join member m on m.id = e.actor_member_id
    left join workflow_transition tr on tr.id = e.transition_id
    left join workflow_step fs on fs.id = e.from_step_id
    left join workflow_step ts on ts.id = e.to_step_id
    where e.work_item_id = p_work_item_id
    order by e.seq
  $$;

revoke all on function app.project_host_company_name(uuid), app.work_item_companies(uuid) from public;
grant execute on function app.project_host_company_name(uuid), app.work_item_companies(uuid) to rabaed_app;
