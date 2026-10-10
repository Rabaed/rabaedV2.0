-- Handover review fixes (spec RP-511: RP-108, RP-513; visibility.md scenarios RP-108-2,
-- RP-108-3; workflow-engine.md §9).
--
-- * The Handover list no longer sorts by an item's creation time (hidden, visibility.md
--   "Creation Date"): by Project, then Document Number and Subject, then the assignment.
-- * An item the one making the change doesn't see (app.sees_work_item) is listed by its
--   Step and Project only: no Subject, Document Number or item id (RP-108-2).
-- * Each Step names its holder, for a change that takes several Members out of pools.
-- * A Project Admin narrowing a whole Participant's Visibility (app.set_participant_visibility)
--   hands over the Steps of the Members it takes out of a pool, when the Admin's own
--   Company is that Participant's (p_member_id null: every Member of the Participant);
--   another Company's Admin reads only how many Steps need a new holder, and whose
--   (app.handovers_waiting, V14; RP-108-3).
-- * Pool names are no longer cut to three by English name: app.work_item_pool returns
--   them all, and the page orders them in the viewer's language.
-- * app.work_item_history no longer returns an `assigned` event's stored reason
--   ("only_member") as a Transition's reason text.
--
-- Rebuilt from their latest bodies (20270112000000_handover.sql, 20270111000000_pool_of_one.sql).

-- Whose Steps: a Member's, or (p_member_id null) every Member's of one Participant -------

-- The Participants whose Steps the change is about: with a Member, the Authorized Person's
-- Company's active Participants that Member (of that Company) is on, or only
-- `p_participant_id`; without one, `p_participant_id` when the caller is a Project Admin
-- of its Project and their own Company is its Company. Nothing for another Company's.
create or replace function app.handover_participants(p_member_id uuid, p_participant_id uuid)
  returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  declare
    v_company_id uuid;
  begin
    if p_member_id is null then
      return query
        select p.id from participant p
        where p.id = p_participant_id
          and p.id in (select app.current_participant_ids())
          and p.project_id in (select app.current_admin_project_ids());
      return;
    end if;
    v_company_id := app.require_authorized_company_id();
    return query
      select p.id from participant p
      join member m on m.id = p_member_id and m.company_id = v_company_id
      where p.company_id = v_company_id
        and (p_participant_id is null or p.id = p_participant_id)
        and exists (select 1 from project_member pm where pm.participant_id = p.id and pm.member_id = p_member_id);
  end
$$;

-- Before the change: the open pooled assignments of those Participants whose pool has the
-- Member in it (without a Member: has anyone in it), so that one the change leaves empty
-- is found after it.
create or replace function app.handover_pooled_before(p_member_id uuid, p_participant_id uuid)
  returns uuid[]
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  begin
    return array(
      select a.id from step_assignment a
      join project pr on pr.id = a.project_id and pr.status = 'active'
      where a.status = 'pooled'
        and a.participant_id in (select app.handover_participants(p_member_id, p_participant_id))
        and (case when p_member_id is null then exists (select 1 from app.assignment_pool(a.id))
          else p_member_id in (select x.member_id from app.assignment_pool(a.id) x) end)
      order by a.id);
  end
$$;

-- Which open Steps of `p_participant_ids` need a new holder after the change: one held by
-- the Member (any Member, without one) whose Step Pool no longer has them, and one of
-- `p_pooled_before` whose pool is now empty. Internal: call it from definer code that
-- has checked who may read them.
create function app.handover_assignments(p_member_id uuid, p_participant_ids uuid[], p_pooled_before uuid[])
  returns table (assignment_id uuid, from_member_id uuid)
  language sql stable
  set search_path = pg_catalog, public
as $$
  select a.id, a.assignee_member_id
  from step_assignment a
  join work_item w on w.id = a.work_item_id and w.closed_at is null
  join project pr on pr.id = a.project_id and pr.status = 'active'
  where a.participant_id = any (p_participant_ids)
    and (
      (a.status = 'picked_up' and (p_member_id is null or a.assignee_member_id = p_member_id)
        and a.assignee_member_id not in (select x.member_id from app.step_pool(a.work_item_id, a.step_id, a.participant_id) x))
      or (a.status = 'pooled' and a.id = any (p_pooled_before)
        and not exists (select 1 from app.assignment_pool(a.id)))
    )
$$;

revoke all on function app.handover_assignments(uuid, uuid[], uuid[]) from public;

-- After the change: each open Step that needs a new holder, as the one making the change
-- sees it, with its holder and the candidates from its pool without them. An item they
-- don't see (app.sees_work_item: not on the Project, or narrower Visibility) is its Step
-- and Project only (scenario RP-108-2). Ordered by Project, then the items they see by
-- Document Number and Subject, then the rest; never by when an item was made.
drop function app.handovers_needed(uuid, uuid, uuid[]);
create function app.handovers_needed(p_member_id uuid, p_participant_id uuid, p_pooled_before uuid[])
  returns table (
    assignment_id uuid, project_id uuid, project_name jsonb, step_name jsonb,
    work_item_id uuid, document_number text, title text,
    holder jsonb, candidates jsonb
  )
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  #variable_conflict use_column
  begin
    return query
      select a.id, pr.id, pr.name, s.name,
        case when x.sees then w.id end,
        case when x.sees then w.document_number end,
        case when x.sees then w.title end,
        (select jsonb_build_object('id', h.id, 'fullName', h.full_name) from member h where h.id = n.from_member_id),
        coalesce((
          -- A steady order; the dialog orders them in the viewer's language.
          select jsonb_agg(jsonb_build_object('id', m.id, 'fullName', m.full_name) order by m.full_name ->> 'en', m.id)
          from app.assignment_pool(a.id) c
          join member m on m.id = c.member_id
          where c.member_id is distinct from n.from_member_id
        ), '[]'::jsonb)
      from app.handover_assignments(
        p_member_id, array(select app.handover_participants(p_member_id, p_participant_id)), p_pooled_before) n
      join step_assignment a on a.id = n.assignment_id
      join work_item w on w.id = a.work_item_id
      join project pr on pr.id = a.project_id
      join workflow_step s on s.id = a.step_id
      cross join lateral (select app.sees_work_item(w.id) as sees) x
      order by pr.name ->> 'en', pr.id, x.sees desc,
        case when x.sees then w.document_number end nulls last,
        case when x.sees then w.title end,
        a.id;
  end
$$;

revoke all on function app.handovers_needed(uuid, uuid, uuid[]) from public;
grant execute on function app.handovers_needed(uuid, uuid, uuid[]) to rabaed_app;

-- A Project Admin of another Company narrowing Participant `p_participant_id`'s Visibility:
-- how many of its open Steps now need a new holder, and its Company's name; nothing else
-- of them (V14). No row for the Participant's own Company (it gets app.handovers_needed)
-- or for anyone who isn't a Project Admin of its Project.
create function app.handovers_waiting(p_participant_id uuid)
  returns table (steps integer, company_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  #variable_conflict use_column
  begin
    return query
      select (select count(*)::integer from app.handover_assignments(null, array[p.id], array(
          select a.id from step_assignment a where a.participant_id = p.id and a.status = 'pooled'))),
        c.legal_name
      from participant p
      join company c on c.id = p.company_id
      where p.id = p_participant_id and p.status = 'active'
        and p.project_id in (select app.current_admin_project_ids())
        and p.id not in (select app.current_participant_ids());
  end
$$;

revoke all on function app.handovers_waiting(uuid) from public;
grant execute on function app.handovers_waiting(uuid) to rabaed_app;

-- The one making the change hands Step assignment `p_assignment_id`, held by
-- `p_from_member_id`, to `p_to_member_id`, because the change `p_because` took the holder
-- out of its pool: 'handed_over', or 'not_offered' when it isn't one app.handovers_needed
-- lists with that candidate for them, whatever the reason. They are the Authorized
-- Person of the holding Participant's Company, or (a Participant's Visibility) a Project
-- Admin of that Company.
create or replace function app.hand_over_step(
  p_assignment_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_because text, p_now timestamptz
)
  returns text
  language plpgsql security definer
  set search_path = pg_catalog, public
as $$
  declare
    v_at timestamptz := greatest(p_now, now());
    v_a record;
  begin
    if p_because not in ('deactivated', 'removed', 'positions', 'visibility') then
      raise exception 'unknown Handover reason %', p_because;
    end if;
    select a.* into v_a from step_assignment a
    join participant p on p.id = a.participant_id
    join project pr on pr.id = a.project_id and pr.status = 'active'
    where a.id = p_assignment_id and a.status = 'picked_up' and a.assignee_member_id = p_from_member_id
      and (p.company_id = app.current_authorized_company_id()
        or (p_because = 'visibility' and p.id in (select app.current_participant_ids())
          and p.project_id in (select app.current_admin_project_ids())))
    for update of a;
    if v_a.id is null
      or p_to_member_id = p_from_member_id
      or p_from_member_id in (select x.member_id from app.step_pool(v_a.work_item_id, v_a.step_id, v_a.participant_id) x)
      or p_to_member_id not in (select x.member_id from app.assignment_pool(v_a.id) x) then
      return 'not_offered';
    end if;

    update step_assignment set assignee_member_id = p_to_member_id, picked_up_at = v_at, updated_at = v_at
    where id = v_a.id;
    -- What reached the old holder no longer waits for them.
    update notification set withdrawn_at = v_at
    where step_assignment_id = v_a.id and kind = 'step_reached' and read_at is null and withdrawn_at is null
      and member_id = p_from_member_id;
    -- "Handed over from Ali Sonour to Khalid Bakr: Ali Sonour deactivated": internal to the
    -- holding Participant, its actor the Member who made the change.
    insert into work_item_event (
      project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
      audience, audience_participant_id, created_at
    ) values (
      v_a.project_id, v_a.work_item_id, 'assigned', app.current_member_id(), v_a.participant_id, v_a.step_id,
      jsonb_build_object('handover', jsonb_build_object(
        'from_member_id', p_from_member_id, 'to_member_id', p_to_member_id, 'because', p_because)),
      'internal', v_a.participant_id, v_at
    );
    -- "Step reached" for the new holder (app.deliver_notification).
    insert into outbox (kind, project_id, payload, created_at, available_at)
    values ('notification', v_a.project_id,
      jsonb_build_object('work_item_id', v_a.work_item_id, 'step_assignment_id', v_a.id,
        'actor_member_id', app.current_member_id(), 'handed_over_to', p_to_member_id),
      v_at, now());
    return 'handed_over';
  end
$$;

-- Who it waits on: every name, for the page to order in the viewer's language ----------

-- While item `p_work_item_id` waits in a pool of the viewer's own Participant: the pool's
-- names. Nothing for anyone else, nor once someone holds it (V14).
drop function app.work_item_pool(uuid);
create function app.work_item_pool(p_work_item_id uuid)
  returns table (names jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_assignment_id uuid;
    begin
      select a.id into v_assignment_id from step_assignment a
      where a.work_item_id = p_work_item_id and a.status = 'pooled'
        and a.participant_id in (select app.current_participant_ids())
        and app.sees_work_item(p_work_item_id);
      if v_assignment_id is null then
        return;
      end if;
      return query
        -- A steady order; the page orders them in the viewer's language.
        select coalesce(jsonb_agg(m.full_name order by m.full_name ->> 'en', m.id), '[]'::jsonb)
        from app.assignment_pool(v_assignment_id) p
        join member m on m.id = p.member_id;
    end
  $$;

revoke all on function app.work_item_pool(uuid) from public;
grant execute on function app.work_item_pool(uuid) to rabaed_app;

-- The history: an `assigned` event's stored reason is not a reason text ------------------

create or replace function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text,
    outcome text, internal_note text, changes jsonb, remarks text, recommended_code text, handover jsonb
  )
  language sql stable
  set search_path = pg_catalog, public
as $$
  select (row_number() over (order by e.seq))::integer, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
    tr.label, fs.name, ts.name,
    -- A pool of one's `assigned` event stores why ("only_member"): its label says so.
    case when e.type <> 'assigned' then e.payload ->> 'reason' end,
    e.payload ->> 'document_number', e.payload ->> 'outcome',
    e.payload ->> 'internal_note', e.payload -> 'changes', e.payload ->> 'remarks', e.payload ->> 'recommended_code',
    -- A Handover is internal to the holding Participant (V5), so both are its own Members.
    case when e.payload ? 'handover' then jsonb_build_object(
      'from', hf.full_name, 'to', ht.full_name, 'because', e.payload -> 'handover' ->> 'because') end
  from work_item_event e
  join work_item w on w.id = e.work_item_id
  left join app.work_item_companies(p_work_item_id) actor on actor.participant_id = e.actor_participant_id
  left join member m on m.id = e.actor_member_id
  left join workflow_transition tr on tr.id = e.transition_id
  left join workflow_step fs on fs.id = e.from_step_id
  left join workflow_step ts on ts.id = e.to_step_id
  left join member hf on hf.id = (e.payload -> 'handover' ->> 'from_member_id')::uuid
  left join member ht on ht.id = (e.payload -> 'handover' ->> 'to_member_id')::uuid
  where e.work_item_id = p_work_item_id
  order by e.seq
$$;
