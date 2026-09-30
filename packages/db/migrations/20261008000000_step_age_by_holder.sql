-- Step Age follows the grouping (visibility.md V14, scenario 35; RP-255).
--
-- * work_item.participant_entered_at / participant_entered_step_id: when, and at
--   which Step, the item reached the Participant holding it (or was closed). A
--   Transition that hands it to another Participant, or closes it, sets them;
--   moves inside one Participant leave them alone.
-- * app.step_as_seen: the one place Step Age, the current Step and its Stage are
--   read. The holding Participant's own Members see its current internal Step and
--   when it entered it; every other Company sees the Step it arrived at and when,
--   so internal moves there never reset or reveal anything. The periodic ageing
--   report must read it from here too.
-- * rabaed_app no longer reads work_item's current Step, Stage, their times or
--   updated_at directly: RLS filters rows, not columns, and those would show
--   another Company's internal moves. A new work_item column must be granted
--   to rabaed_app explicitly.
-- * app.take_transition: a Transition is shared only when it leaves the acting
--   Participant (or is a Submit or a close). Before, any Transition out of a Step
--   that issues Codes was shared, so a Consultant's internal Return from such a
--   Step showed in the Contractor's history. Otherwise as in the internal_note
--   migration.

alter table work_item
  add column participant_entered_at timestamptz,
  add column participant_entered_step_id uuid;

-- Existing items reached their holder at their latest shared event, or were never
-- handed over (still with the raiser since creation).
update work_item w
set participant_entered_at = coalesce(e.created_at, w.step_entered_at),
  participant_entered_step_id = coalesce(e.to_step_id, w.current_step_id)
from work_item x
left join lateral (
  select created_at, to_step_id from work_item_event
  where work_item_id = x.id and to_step_id is not null and (type = 'created' or audience = 'shared')
  order by seq desc limit 1
) e on true
where x.id = w.id;

alter table work_item
  alter column participant_entered_at set not null,
  alter column participant_entered_step_id set not null,
  add constraint work_item_participant_entered_step_fk
    foreign key (participant_entered_step_id, workflow_version_id) references workflow_step (id, workflow_version_id);

-- A new item reaches its raiser at its first Step.
create function app.work_item_arrives() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    begin
      new.participant_entered_at := coalesce(new.participant_entered_at, new.step_entered_at);
      new.participant_entered_step_id := coalesce(new.participant_entered_step_id, new.current_step_id);
      return new;
    end
  $$;
create trigger work_item_arrives before insert on work_item
  for each row execute function app.work_item_arrives();

-- The item's current Step, its Stage, and when Step Age counts from, as the acting
-- Member may see them: their own Participant holds it, its current internal Step;
-- anyone else, the Step at which it reached the holder (V14). An item they can't
-- see answers nothing.
create function app.step_as_seen(p_work_item_id uuid)
  returns table (step_id uuid, stage_key text, entered_at timestamptz)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select s.id, s.stage_key, case when h.mine then w.step_entered_at else w.participant_entered_at end
    from work_item w
    cross join lateral (
      select exists (
        select 1 from step_assignment a
        where a.work_item_id = w.id and a.status in ('pooled', 'claimed', 'vacant')
          and a.participant_id in (select app.current_participant_ids())
      ) as mine
    ) h
    join workflow_step s on s.id = case when h.mine then w.current_step_id else w.participant_entered_step_id end
    where w.id = p_work_item_id and app.sees_work_item(w.id)
  $$;

revoke select on work_item from rabaed_app;
grant select (
  id, project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data,
  workflow_version_id, document_number, outcome, closed_at, created_at
) on work_item to rabaed_app;

-- Takes a Transition (§5.1) by its key, with the Member's Internal Note. Outcomes
-- and checks as in the internal_note migration; see the header for what changed.
create or replace function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_reason text, p_internal_note text, p_idempotency_key uuid,
  p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_me record;
      v_used record;
      v_assignment record;
      v_transition record;
      v_next record;
      v_raiser record;
      v_reason text := nullif(btrim(p_reason), '');
      v_note text := nullif(btrim(p_internal_note), '');
      v_holder uuid;
      v_number text;
      v_prefix text;
      v_seq integer;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      select w.*, t.module_key, t.code as type_code, pr.status as project_status, pr.code as project_code
      into v_item
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;

      select work_item_id, command into v_used from command_idempotency
      where member_id = v_member_id and key = p_idempotency_key;
      if v_used.work_item_id is not null then
        return case when v_used.work_item_id = p_work_item_id and v_used.command = 'transition:' || p_transition_key
          then 'applied' else 'idempotency_key_reused' end;
      end if;

      if v_item.closed_at is not null then
        return 'item_closed';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      select * into v_assignment from step_assignment
      where work_item_id = p_work_item_id and status in ('pooled', 'claimed', 'vacant');
      if v_assignment.status is distinct from 'claimed' or v_assignment.assignee_member_id <> v_member_id
        or v_assignment.participant_id <> v_me.participant_id
      then
        return 'not_holder';
      end if;

      select tr.*, target.stage_key as to_stage_key,
        source.outcome_mode as from_outcome_mode, app.is_draft_step(source.id) as from_draft
      into v_transition
      from workflow_transition tr
      join workflow_step target on target.id = tr.to_step_id
      join workflow_step source on source.id = tr.from_step_id
      where tr.workflow_version_id = v_item.workflow_version_id and tr.from_step_id = v_item.current_step_id
        and tr.key = p_transition_key;
      if v_transition.id is null then
        return 'transition_not_available';
      end if;
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, v_transition.permission) then
        return 'forbidden';
      end if;
      if v_transition.kind = 'return' and v_reason is null then
        return 'reason_required';
      end if;

      -- The next holder (§3): the Participant, then, coming back by Return, the
      -- person who held that Step before if still in its pool; otherwise the pool.
      select * into v_next from app.next_step_holder(p_work_item_id, v_transition.id);
      if v_next.outcome not in ('ok', 'terminal') then
        return v_next.outcome;
      end if;
      if v_transition.kind = 'return' then
        select a.assignee_member_id into v_holder from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_transition.to_step_id and a.status = 'done'
          and a.assignee_member_id in (
            select member_id from app.step_pool(p_work_item_id, v_transition.to_step_id, v_next.participant_id))
        order by a.done_at desc, a.id desc limit 1;
      end if;

      -- Effects, in order.
      if v_item.document_number is null and v_transition.from_draft then
        select p.ordinal into v_raiser from participant p where p.id = v_item.raised_by_participant_id;
        v_prefix := concat_ws('-', v_item.project_code, v_item.type_code,
          lpad(v_raiser.ordinal::text, greatest(2, length(v_raiser.ordinal::text)), '0'));
        insert into numbering_counter as c (project_id, counter_key, last_value)
        values (v_item.project_id, v_prefix, 1)
        on conflict (project_id, counter_key) do update set last_value = c.last_value + 1
        returning last_value into v_seq;
        v_number := v_prefix || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
      end if;

      if v_next.outcome = 'terminal' then
        v_outcome := coalesce(v_transition.outcome, case when v_transition.kind = 'cancel' then 'cancelled' end);
        -- Publish-time validation requires one (workflow-engine.md §1, check 3); never guess it.
        if v_outcome is null then
          raise exception 'Transition % closes the item without an outcome', v_transition.key;
        end if;
      end if;
      -- The Internal Note stays inside the writer's Participant even when the
      -- Transition crosses to another (V5). It goes just before the Transition it
      -- is written with.
      if v_note is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'internal_note', v_member_id, v_me.participant_id, v_transition.id,
          jsonb_build_object('internal_note', v_note), 'internal', v_me.participant_id, v_at
        );
      end if;
      -- It leaves the acting Participant: handed to another, or closed (nobody holds it).
      v_crosses := v_next.participant_id is distinct from v_me.participant_id;
      -- Only what crosses is shared: a move inside one Participant stays its own,
      -- even from a Step that could issue a Code (V5, V14).
      v_audience := case
        when v_crosses or v_transition.kind in ('submit', 'close') then 'shared'
        else 'internal' end;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, created_at
      ) values (
        v_item.project_id, p_work_item_id,
        -- A Code is issued only where one is set; any other move from that Step is a plain Transition.
        case when v_transition.from_outcome_mode = 'issue_code' and v_outcome is not null then 'issue_code'
          else 'transition' end,
        v_member_id, v_me.participant_id, v_transition.id,
        v_item.current_step_id, v_transition.to_step_id,
        jsonb_strip_nulls(jsonb_build_object('reason', v_reason, 'document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then v_me.participant_id end,
        sha256(convert_to(jsonb_build_object('title', v_item.title, 'data', v_item.data)::text, 'UTF8')),
        v_at
      );

      update step_assignment set status = 'done', done_at = v_at, updated_at = v_at where id = v_assignment.id;

      update work_item set
        current_step_id = v_transition.to_step_id,
        current_stage_key = v_transition.to_stage_key,
        step_entered_at = v_at,
        participant_entered_at = case when v_crosses then v_at else participant_entered_at end,
        participant_entered_step_id = case when v_crosses then v_transition.to_step_id else participant_entered_step_id end,
        document_number = coalesce(document_number, v_number),
        outcome = v_outcome,
        closed_at = case when v_outcome is not null then v_at end,
        updated_at = v_at
      where id = p_work_item_id;

      if v_next.outcome = 'ok' then
        insert into step_assignment (
          project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at, updated_at
        ) values (
          v_item.project_id, p_work_item_id, v_transition.to_step_id, v_next.participant_id, v_holder,
          case when v_holder is null then 'pooled' else 'claimed' end,
          case when v_holder is null then null else v_at end, v_at, v_at
        );
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (p_work_item_id, v_item.project_id, v_next.participant_id, v_at, 'handling')
        on conflict do nothing;
      end if;

      -- Oversight (V2): Owners and Owner Representatives whose Visibility covers the Submitted item.
      if v_transition.kind = 'submit' then
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        select p_work_item_id, v_item.project_id, p.id, v_at, 'oversight'
        from participant p
        join project_role r on r.id = p.project_role_id
        where p.project_id = v_item.project_id and p.status = 'active'
          and r.base_role in ('owner', 'owner_representative')
          and app.participant_covers_item(p.id, p_work_item_id)
        on conflict do nothing;
      end if;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;

revoke all on function app.work_item_arrives(), app.step_as_seen(uuid) from public;
grant execute on function app.step_as_seen(uuid) to rabaed_app;
