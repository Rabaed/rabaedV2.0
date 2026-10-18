-- RP-629: Snag List bulk reassign (spec RP-619; workflow-engine.md §3.3 rule 2, "Assign to").
--
-- A Member moves an item their own Participant holds to another Member of the same Participant,
-- from the Step Pool of the Step it is at, without taking a Transition. Two functions, both
-- security definer and both reading the acting Member (app.current_member_id):
--
-- * app.reassign_candidates(item): the Members the acting Member could hand the item to now: the
--   open assignment's pool (app.assignment_pool, so "not the same person" holds) without the
--   current holder. Nobody unless the acting Member's Participant holds the assignment and the
--   acting Member holds it, or may pick it up from its pool.
-- * app.reassign_step(item, to_member, now): does it. The same assignment, picked up by the new
--   holder, one `assigned` event internal to the holding Participant (V5), the old holder's unread
--   "Step reached" withdrawn, and "Step reached" for the new holder (the Handover's outbox row).
--   Outcomes: reassigned, not_found, item_closed, project_closed, forbidden, not_offered.
--
-- A Member of another Participant, or one who cannot hold or pick up the Step, is refused
-- `forbidden`; a target the pool does not hold (another Company's Member, a made-up id, the
-- holder themself) is `not_offered`, whoever it names.

create function app.reassign_candidates(p_work_item_id uuid)
  returns table (member_id uuid, full_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  #variable_conflict use_column
  declare
    v_a record;
    v_me record;
  begin
    if not app.sees_work_item(p_work_item_id) then
      return;
    end if;
    select * into v_me from app.acting_project_member(p_work_item_id);
    select a.* into v_a from step_assignment a
    join work_item w on w.id = a.work_item_id and w.closed_at is null
    join project pr on pr.id = w.project_id and pr.status = 'active'
    where a.work_item_id = p_work_item_id and a.status in ('pooled', 'picked_up')
      and a.participant_id = v_me.participant_id
      and not app.is_draft_step(a.step_id);
    if v_a.id is null or not (
      v_a.assignee_member_id = app.current_member_id()
      or v_me.project_member_id in (select x.project_member_id from app.step_pool(p_work_item_id, v_a.step_id, v_a.participant_id) x)
    ) then
      return;
    end if;
    return query
      select m.id, m.full_name
      from app.assignment_pool(v_a.id) x
      join member m on m.id = x.member_id
      where x.member_id is distinct from v_a.assignee_member_id;
  end
$$;

create function app.reassign_step(p_work_item_id uuid, p_to_member_id uuid, p_now timestamptz)
  returns text
  language plpgsql security definer
  set search_path = pg_catalog, public
as $$
  declare
    v_at timestamptz := greatest(p_now, now());
    v_item record;
    v_me record;
    v_a record;
  begin
    if not app.sees_work_item(p_work_item_id) then
      return 'not_found';
    end if;
    select w.id, w.project_id, w.closed_at, pr.status as project_status into v_item
    from work_item w join project pr on pr.id = w.project_id
    where w.id = p_work_item_id
    for update of w;
    select * into v_me from app.acting_project_member(p_work_item_id);
    if v_item.id is null or v_me.project_member_id is null then
      return 'not_found';
    end if;
    if v_item.closed_at is not null then
      return 'item_closed';
    end if;
    if v_item.project_status <> 'active' then
      return 'project_closed';
    end if;
    select * into v_a from step_assignment
    where work_item_id = p_work_item_id and status in ('pooled', 'picked_up') for update;
    -- Another Participant's Step, or a Draft: nothing of mine to hand over (V14).
    if v_a.id is null or v_a.participant_id is distinct from v_me.participant_id or app.is_draft_step(v_a.step_id) then
      return 'forbidden';
    end if;
    if not (
      v_a.assignee_member_id = app.current_member_id()
      or v_me.project_member_id in (select x.project_member_id from app.step_pool(p_work_item_id, v_a.step_id, v_a.participant_id) x)
    ) then
      return 'forbidden';
    end if;
    if p_to_member_id is not distinct from v_a.assignee_member_id
      or p_to_member_id not in (select x.member_id from app.assignment_pool(v_a.id) x) then
      return 'not_offered';
    end if;

    update step_assignment
    set status = 'picked_up', assignee_member_id = p_to_member_id, picked_up_at = v_at, updated_at = v_at
    where id = v_a.id;
    if v_a.assignee_member_id is not null then
      -- What reached the old holder no longer waits for them.
      update notification set withdrawn_at = v_at
      where step_assignment_id = v_a.id and kind = 'step_reached' and read_at is null and withdrawn_at is null
        and member_id = v_a.assignee_member_id;
    end if;
    -- "Reassigned from Ali Sonour to Khalid Bakr": internal to the holding Participant (V5).
    insert into work_item_event (
      project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
      audience, audience_participant_id, created_at
    ) values (
      v_item.project_id, p_work_item_id, 'assigned', app.current_member_id(), v_me.participant_id, v_a.step_id,
      jsonb_build_object('handover', jsonb_build_object(
        'from_member_id', v_a.assignee_member_id, 'to_member_id', p_to_member_id, 'because', 'reassigned')),
      'internal', v_me.participant_id, v_at
    );
    -- "Step reached" for the new holder (app.deliver_notification), unless they did it themself.
    if p_to_member_id <> app.current_member_id() then
      insert into outbox (kind, project_id, payload, created_at, available_at)
      values ('notification', v_item.project_id,
        jsonb_build_object('work_item_id', p_work_item_id, 'step_assignment_id', v_a.id,
          'actor_member_id', app.current_member_id(), 'handed_over_to', p_to_member_id),
        v_at, now());
    end if;
    return 'reassigned';
  end
$$;

revoke all on function app.reassign_candidates(uuid) from public;
revoke all on function app.reassign_step(uuid, uuid, timestamptz) from public;
grant execute on function app.reassign_candidates(uuid) to rabaed_app;
grant execute on function app.reassign_step(uuid, uuid, timestamptz) to rabaed_app;
