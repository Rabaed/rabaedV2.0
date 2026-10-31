-- RP-1162: Rabaed Admin reassigns a stuck Step (UAT ADM-10; workflow-engine.md §5.6, ADR 0018).
--
-- A Rabaed Engineer finds an item by its Project and Document Number, reads its current Step and
-- holder, and hands the Step to another Member of the same holding Participant's Step Pool, or
-- back to that pool, as a Handover does. Never to another Company, never a Transition: the Step,
-- Stage, Step Age and outcome stay as they are, and the Engineer has no path to `transition`,
-- `recommend_code` or `issue_code` events (data-model.md §10 rule 5). Two functions, for
-- rabaed_admin only; the Rabaed Admin service writes the admin_action with the reason (V9) in the
-- same transaction:
--
-- * app.work_item_step_for_engineer(project, document_number): the item, its open Step, the
--   holding Participant, the holder and the pool (app.assignment_pool, so "not the same person"
--   holds). No row for a number the Project never issued.
-- * app.reassign_step_by_engineer(item, to_member, engineer, admin_action, now): does it. The
--   same assignment, picked up by the new holder (or pooled again), one `admin_reassigned` event
--   internal to the holding Participant (V5) with the Engineer as its actor and no acting
--   Participant, so the history reads "by Rabaed" and names no Company and no person; the old
--   holder's unread "Step reached" withdrawn, and "Step reached" for the new holder (the
--   Handover's outbox row), or for the pool. The reason stays in admin_action, which the event
--   names (`payload.admin_action_id`); no Company reads it.
--   Results: reassigned, returned_to_pool, not_found, item_closed, project_closed, no_open_step
--   (a Vacancy waits for a replacement Participant, ADR 0028), draft_step, not_offered (anyone
--   outside the pool, another Company's Member or a made-up id alike, or the holder themself),
--   already_pooled, pool_of_one (a pool of one holds the Step at once, ADR 0018).
--
-- And no Member reads which Engineer it was: `work_item_event.actor_engineer_id` is no longer
-- granted to the app role (only Rabaed's audit reads it).

alter table admin_action drop constraint admin_action_action_check;
alter table admin_action add constraint admin_action_action_check
  check (action in (
    'onboard_company', 'read_onboarding_leads', 'invite_authorized_person', 'close_onboarding_lead',
    'create_option_list', 'add_option', 'rename_option', 'retire_option', 'restore_option',
    'read_numbering', 'set_numbering_pattern', 'set_participant_code', 'set_numbering_counter_start',
    'save_workflow_draft', 'publish_workflow',
    'duplicate_workflow', 'add_default_outcome', 'change_default_outcome', 'reorder_default_outcomes',
    'add_default_stage', 'rename_default_stage', 'reorder_default_stages',
    'refuse_workflow_publish',
    'reproduce_documental_record', 'read_documental_record_alerts',
    'read_register_import', 'preview_register_import', 'confirm_register_import',
    'read_record_jobs', 'retry_record_job', 'read_documental_record_history',
    'read_work_item_step', 'reassign_step'
  ));

revoke select (actor_engineer_id) on work_item_event from rabaed_app;

create function app.work_item_step_for_engineer(p_project_id uuid, p_document_number text)
  returns table (
    work_item_id uuid, document_number text, title text, type_name jsonb, closed boolean,
    step_name jsonb, stage_name jsonb, draft_step boolean, assignment_status text,
    participant_id uuid, company_name jsonb, role_name jsonb, holder_member_id uuid, pool jsonb
  )
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  #variable_conflict use_column
  begin
  return query
  select w.id, w.document_number, w.title, t.name, w.closed_at is not null,
    s.name, coalesce(ps.name, rs.name), coalesce(app.is_draft_step(a.step_id), false), a.status,
    a.participant_id, c.legal_name, r.name, a.assignee_member_id,
    coalesce((
      select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.full_name, 'email', m.email) order by m.full_name ->> 'en', m.email)
      from app.assignment_pool(a.id) x join member m on m.id = x.member_id
    ), '[]'::jsonb)
  from work_item w
  join work_item_type t on t.id = w.work_item_type_id
  left join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'picked_up') and w.closed_at is null
  left join workflow_step s on s.id = a.step_id
  left join stage ps on ps.owner_kind = 'project' and ps.project_id = w.project_id and ps.module_key = t.module_key and ps.key = s.stage_key
  left join stage rs on rs.owner_kind = 'rabaed' and rs.module_key = t.module_key and rs.key = s.stage_key
  left join participant p on p.id = a.participant_id
  left join company c on c.id = p.company_id
  left join project_role r on r.id = p.project_role_id
  where w.project_id = p_project_id
    and w.document_number is not null
    and upper(w.document_number) = upper(btrim(p_document_number))
    and w.discarded_at is null;
  end
$$;

create function app.reassign_step_by_engineer(
  p_work_item_id uuid, p_to_member_id uuid, p_engineer_id uuid, p_admin_action_id uuid, p_now timestamptz
)
  returns table (result text, from_member_id uuid, to_member_id uuid)
  language plpgsql security definer
  set search_path = pg_catalog, public
as $$
  declare
    v_at timestamptz := greatest(p_now, now());
    v_item record;
    v_a record;
  begin
    select w.id, w.project_id, w.closed_at, pr.status as project_status into v_item
    from work_item w join project pr on pr.id = w.project_id
    where w.id = p_work_item_id and w.discarded_at is null
    for update of w;
    if v_item.id is null then
      return query select 'not_found'::text, null::uuid, null::uuid;
      return;
    end if;
    if v_item.closed_at is not null then
      return query select 'item_closed'::text, null::uuid, null::uuid;
      return;
    end if;
    if v_item.project_status <> 'active' then
      return query select 'project_closed'::text, null::uuid, null::uuid;
      return;
    end if;
    select * into v_a from step_assignment
    where work_item_id = p_work_item_id and status in ('pooled', 'picked_up') for update;
    if v_a.id is null then
      return query select 'no_open_step'::text, null::uuid, null::uuid;
      return;
    end if;
    -- A Draft is its raiser's alone (V1, ADR 0019): its own Members hand it over.
    if app.is_draft_step(v_a.step_id) then
      return query select 'draft_step'::text, v_a.assignee_member_id, null::uuid;
      return;
    end if;

    if p_to_member_id is null then
      if v_a.status = 'pooled' then
        return query select 'already_pooled'::text, null::uuid, null::uuid;
        return;
      end if;
      -- Nobody else to give it back to: a pool of one holds it (§3.3 rule 4).
      if (select count(*) from app.assignment_pool(v_a.id)) < 2 then
        return query select 'pool_of_one'::text, v_a.assignee_member_id, null::uuid;
        return;
      end if;
      update step_assignment
      set status = 'pooled', assignee_member_id = null, picked_up_at = null, updated_at = v_at
      where id = v_a.id;
    else
      -- Only the holding Participant's own pool: never another Company's Member.
      if p_to_member_id is not distinct from v_a.assignee_member_id
        or p_to_member_id not in (select x.member_id from app.assignment_pool(v_a.id) x) then
        return query select 'not_offered'::text, v_a.assignee_member_id, null::uuid;
        return;
      end if;
      update step_assignment
      set status = 'picked_up', assignee_member_id = p_to_member_id, picked_up_at = v_at, updated_at = v_at
      where id = v_a.id;
    end if;

    if v_a.assignee_member_id is not null then
      -- What reached the old holder no longer waits for them.
      update notification set withdrawn_at = v_at
      where step_assignment_id = v_a.id and kind = 'step_reached' and read_at is null and withdrawn_at is null
        and member_id = v_a.assignee_member_id;
    end if;
    -- "Reassigned by Rabaed": internal to the holding Participant (V5), by no Member and no
    -- Participant, so no Company and no person is named (V14).
    insert into work_item_event (
      project_id, work_item_id, type, actor_engineer_id, actor_participant_id, from_step_id, to_step_id, payload,
      audience, audience_participant_id, created_at
    ) values (
      v_item.project_id, p_work_item_id, 'admin_reassigned', p_engineer_id, null, v_a.step_id, v_a.step_id,
      jsonb_build_object(
        'handover', jsonb_build_object('from_member_id', v_a.assignee_member_id, 'to_member_id', p_to_member_id, 'because', 'reassigned'),
        'admin_action_id', p_admin_action_id),
      'internal', v_a.participant_id, v_at
    );
    -- "Step reached" (app.deliver_notification): the new holder's, or the pool's. A pool Member
    -- handed the Step keeps the unread one that reached them in the pool, rather than a second.
    if p_to_member_id is null or not exists (
      select 1 from notification n
      where n.step_assignment_id = v_a.id and n.kind = 'step_reached' and n.member_id = p_to_member_id
        and n.read_at is null and n.withdrawn_at is null
    ) then
      insert into outbox (kind, project_id, payload, created_at, available_at)
      values ('notification', v_item.project_id,
        jsonb_build_object('work_item_id', p_work_item_id, 'step_assignment_id', v_a.id)
          || case when p_to_member_id is null then '{}'::jsonb else jsonb_build_object('handed_over_to', p_to_member_id) end,
        v_at, now());
    end if;
    return query select case when p_to_member_id is null then 'returned_to_pool' else 'reassigned' end, v_a.assignee_member_id, p_to_member_id;
  end
$$;

revoke all on function app.work_item_step_for_engineer(uuid, text) from public;
revoke all on function app.reassign_step_by_engineer(uuid, uuid, uuid, uuid, timestamptz) from public;
grant execute on function app.work_item_step_for_engineer(uuid, text) to rabaed_admin;
grant execute on function app.reassign_step_by_engineer(uuid, uuid, uuid, uuid, timestamptz) to rabaed_admin;
