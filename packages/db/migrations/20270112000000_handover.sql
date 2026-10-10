-- Handover, never a member Vacancy (RP-108, spec RP-511 decision 3; ADR 0018;
-- workflow-engine.md §9; visibility.md scenario RP-108-1).
--
-- Deactivating a Member, removing them from a Project, or changing their Positions or
-- Visibility so that they leave a Step Pool first gives every open Step they hold a new
-- holder from that Step's pool without them. The API makes the change and its
-- Handovers in one transaction (apps/api/src/identity/handover.ts):
-- * app.handover_pooled_before: before the change, the pooled assignments whose pool
--   (app.assignment_pool) has the Member in it;
-- * the change itself (app.deactivate_member, app.remove_project_member,
--   app.set_project_member_positions, app.set_member_visibility: unchanged);
-- * app.handovers_needed: after it, each Step the Member holds whose pool
--   (app.step_pool) no longer has them, with the candidates (app.assignment_pool without
--   them), and each pooled Step from before whose pool is now empty (no candidates: the
--   change is refused and rolled back);
-- * app.hand_over_step: the Authorized Person's pick holds the Step from now on, with
--   an internal event of the holding Participant (type 'assigned', payload
--   {"handover": {"from_member_id", "to_member_id", "because"}}) and "Step reached"
--   for the new holder.
-- All of it only for the Authorized Person's own Company: its Participants' Steps and
-- its Members, never another Company's (scenario RP-108-1).
--
-- The member-level Vacancy goes: nothing made an assignment 'vacant' for a Member, and
-- the RP-356 notification (app.outbox_vacancy, its trigger, the 'vacancy' notification
-- kind and the "Vacancy in my Company" setting) is dropped. The status 'vacant' stays,
-- for the Participant-level Vacancy (a Participant withdrawn, §9).
--
-- Rebuilt from their latest bodies (20270110000000_pick_up_rename.sql):
-- app.deliver_notification (no Vacancy; a Handover's "Step reached") and
-- app.notification_email_content (no Vacancy); app.work_item_history (from
-- 20260929000000 onwards, last 20261224000000) gains the `handover` column.

-- The member-level Vacancy goes ----------------------------------------------------------

drop trigger step_assignment_outbox_vacancy on step_assignment;
drop function app.outbox_vacancy();

delete from notification where kind = 'vacancy';
alter table notification drop constraint notification_vacancy;
alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check
  check (kind in ('step_reached', 'watched_event', 'sent_back'));

delete from notification_setting where notification_group = 'vacancy';
alter table notification_setting drop constraint notification_setting_notification_group_check;
alter table notification_setting add constraint notification_setting_notification_group_check
  check (notification_group in ('step_reached', 'watched', 'sent_back', 'weekly_report'));

-- Handover ------------------------------------------------------------------------------

-- The Authorized Person's Company's active Participants Member `p_member_id` (of that
-- Company) is on, or only `p_participant_id` when given; nothing for another Company's.
create function app.handover_participants(p_member_id uuid, p_participant_id uuid)
  returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  declare
    v_company_id uuid := app.require_authorized_company_id();
  begin
    return query
      select p.id from participant p
      join member m on m.id = p_member_id and m.company_id = v_company_id
      where p.company_id = v_company_id
        and (p_participant_id is null or p.id = p_participant_id)
        and exists (select 1 from project_member pm where pm.participant_id = p.id and pm.member_id = p_member_id);
  end
$$;

-- Before the change: the open pooled assignments of the Member's Participants whose pool
-- has them in it, so that one the change leaves empty is found after it.
create function app.handover_pooled_before(p_member_id uuid, p_participant_id uuid)
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
        and p_member_id in (select x.member_id from app.assignment_pool(a.id) x)
      order by a.id);
  end
$$;

-- After the change: each open Step of the Member's Participants that needs a new holder,
-- as their Company sees it: one they hold whose Step Pool no longer has them (a Draft
-- included), with the candidates from its pool without them, by English name; and one
-- of `p_pooled_before` whose pool is now empty, with none. A closed Project's items
-- wait for nobody, so they are left out.
create function app.handovers_needed(p_member_id uuid, p_participant_id uuid, p_pooled_before uuid[])
  returns table (
    assignment_id uuid, work_item_id uuid, project_id uuid, project_name jsonb, document_number text,
    title text, step_name jsonb, candidates jsonb
  )
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  #variable_conflict use_column
  begin
    return query
      select a.id, w.id, pr.id, pr.name, w.document_number, w.title, s.name,
        coalesce((
          select jsonb_agg(jsonb_build_object('id', m.id, 'fullName', m.full_name) order by m.full_name ->> 'en', m.id)
          from app.assignment_pool(a.id) x
          join member m on m.id = x.member_id
          where x.member_id <> p_member_id
        ), '[]'::jsonb)
      from step_assignment a
      join work_item w on w.id = a.work_item_id and w.closed_at is null
      join project pr on pr.id = a.project_id and pr.status = 'active'
      join workflow_step s on s.id = a.step_id
      where a.participant_id in (select app.handover_participants(p_member_id, p_participant_id))
        and (
          (a.status = 'picked_up' and a.assignee_member_id = p_member_id
            and p_member_id not in (select x.member_id from app.step_pool(a.work_item_id, a.step_id, a.participant_id) x))
          or (a.status = 'pooled' and a.id = any (p_pooled_before)
            and not exists (select 1 from app.assignment_pool(a.id)))
        )
      order by pr.name ->> 'en', w.document_number nulls last, w.created_at, a.id;
  end
$$;

-- The Authorized Person hands Step assignment `p_assignment_id`, held by `p_from_member_id`,
-- to `p_to_member_id`, because the change `p_because` took the holder out of its pool:
-- 'handed_over', or 'not_offered' when it isn't one app.handovers_needed lists with that
-- candidate (another Company's, not held by them, still in their pool, or a Member not
-- in the pool), whatever the reason.
create function app.hand_over_step(
  p_assignment_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_because text, p_now timestamptz
)
  returns text
  language plpgsql security definer
  set search_path = pg_catalog, public
as $$
  declare
    v_company_id uuid := app.require_authorized_company_id();
    v_at timestamptz := greatest(p_now, now());
    v_a record;
  begin
    if p_because not in ('deactivated', 'removed', 'positions', 'visibility') then
      raise exception 'unknown Handover reason %', p_because;
    end if;
    select a.* into v_a from step_assignment a
    join participant p on p.id = a.participant_id and p.company_id = v_company_id
    join project pr on pr.id = a.project_id and pr.status = 'active'
    where a.id = p_assignment_id and a.status = 'picked_up' and a.assignee_member_id = p_from_member_id
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
    -- holding Participant, its actor the Authorized Person who made the change.
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

revoke all on function app.handover_participants(uuid, uuid) from public;
revoke all on function app.handover_pooled_before(uuid, uuid) from public;
grant execute on function app.handover_pooled_before(uuid, uuid) to rabaed_app;
revoke all on function app.handovers_needed(uuid, uuid, uuid[]) from public;
grant execute on function app.handovers_needed(uuid, uuid, uuid[]) to rabaed_app;
revoke all on function app.hand_over_step(uuid, uuid, uuid, text, timestamptz) from public;
grant execute on function app.hand_over_step(uuid, uuid, uuid, text, timestamptz) to rabaed_app;

-- The history names a Handover's two Members, for the holding Participant only --------

drop function app.work_item_history(uuid);
create function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text,
    outcome text, internal_note text, changes jsonb, remarks text, recommended_code text, handover jsonb
  )
  language sql stable
  set search_path = pg_catalog, public
as $$
  select (row_number() over (order by e.seq))::integer, e.type, e.created_at, e.audience, actor.legal_name, coalesce(m.full_name, app.code_signer_name(e.id)),
    tr.label, fs.name, ts.name, e.payload ->> 'reason', e.payload ->> 'document_number', e.payload ->> 'outcome',
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

revoke all on function app.work_item_history(uuid) from public;
grant execute on function app.work_item_history(uuid) to rabaed_app;

-- No Vacancy; a Handover's "Step reached" goes to its new holder ------------------------

CREATE OR REPLACE FUNCTION app.deliver_notification(p_outbox_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    declare
      v_row record;
      v_assignment record;
      v_event record;
      v_actor uuid;
      v_recipient uuid;
      v_recipients uuid[];
      v_waiting uuid[];
      v_sent_back_to uuid[];
      v_count integer := 0;
    begin
      perform app.require_worker();
      select * into v_row from outbox where id = p_outbox_id;
      v_actor := (v_row.payload ->> 'actor_member_id')::uuid;

      -- A closed Project goes quiet: what was still in the outbox reaches nobody.
      if not exists (
        select 1 from work_item w join project p on p.id = w.project_id and p.status = 'active'
        where w.id = (v_row.payload ->> 'work_item_id')::uuid
      ) then
        return 0;
      end if;

      if v_row.payload ->> 'notification' = 'sent_back' then
        select e.* into v_event from work_item_event e
        join project p on p.id = e.project_id and p.status = 'active'
        where e.id = (v_row.payload ->> 'work_item_event_id')::uuid
          and e.work_item_id = (v_row.payload ->> 'work_item_id')::uuid;
        if v_event.id is null then
          return 0;
        end if;
        foreach v_recipient in array array(select s.member_id from app.sent_back_members(v_event.work_item_id, v_event.created_at) s) loop
          continue when v_recipient = v_actor;
          v_count := v_count + app.notify_member(
            p_outbox_id, v_recipient, v_event.project_id, v_event.work_item_id, 'sent_back', null,
            null, null, v_event.id, 'transition', null);
        end loop;
        return v_count;
      end if;

      if v_row.payload ? 'work_item_event_id' then
        select e.*, w.revision_no, tr.kind as transition_kind into v_event from work_item_event e
        join work_item w on w.id = e.work_item_id
        left join workflow_transition tr on tr.id = e.transition_id
        where e.id = (v_row.payload ->> 'work_item_event_id')::uuid
          and e.work_item_id = (v_row.payload ->> 'work_item_id')::uuid;
        if v_event.id is null then
          return 0;
        end if;
        -- Those the event made it wait on hear of it as "Step reached", not twice.
        -- (Its holder when it was handed to one, otherwise its Step Pool.)
        v_waiting := array(
          select a.assignee_member_id from step_assignment a
          where a.work_item_id = v_event.work_item_id and a.created_at = v_event.created_at
            and a.picked_up_at = a.created_at
          union
          select p.member_id from step_assignment a
          cross join app.step_pool(a.work_item_id, a.step_id, a.participant_id) p
          where a.work_item_id = v_event.work_item_id and a.created_at = v_event.created_at
            and a.picked_up_at is distinct from a.created_at);
        -- Those it was Sent Back to hear of it as "Sent Back" only.
        v_sent_back_to := case when v_event.transition_kind = 'send_back'
          then array(select s.member_id from app.sent_back_members(v_event.work_item_id, v_event.created_at) s)
          else '{}' end;
        -- Who watches the chain and still sees this item (scenario 68, V1), and the
        -- raiser or Position Members its Transition names; each is checked again, as
        -- that Member, in app.notify_member. Of them, V5: an internal event reaches
        -- only its own Participant's Members.
        v_recipients := array(
          select w.member_id from app.work_item_watchers(v_event.work_item_id) w
          union
          select t.member_id from app.transition_notice_members(v_event.id) t);
        foreach v_recipient in array v_recipients loop
          continue when v_recipient = v_actor or v_recipient = any (v_waiting) or v_recipient = any (v_sent_back_to);
          v_count := v_count + app.notify_member(
            p_outbox_id, v_recipient, v_event.project_id, v_event.work_item_id, 'watched_event',
            app.event_outcome(v_event.type, v_event.payload), null, null, v_event.id,
            case v_event.type when 'created' then 'revision_created' else v_event.type end,
            v_event.audience_participant_id);
        end loop;
        return v_count;
      end if;

      select a.* into v_assignment from step_assignment a
      where a.id = (v_row.payload ->> 'step_assignment_id')::uuid
        and a.work_item_id = (v_row.payload ->> 'work_item_id')::uuid
        and a.status in ('pooled', 'picked_up');
      -- The item moved on before delivery: it no longer waits for them.
      if v_assignment.id is null then
        return 0;
      end if;
      -- A Handover (RP-108): "Step reached" for its new holder only, while it is still theirs.
      if v_row.payload ? 'handed_over_to' then
        if v_assignment.status <> 'picked_up'
          or v_assignment.assignee_member_id is distinct from (v_row.payload ->> 'handed_over_to')::uuid
          or v_assignment.assignee_member_id = v_actor then
          return 0;
        end if;
        return app.notify_member(
          p_outbox_id, v_assignment.assignee_member_id, v_assignment.project_id, v_assignment.work_item_id, 'step_reached', null,
          v_assignment.step_id, v_assignment.id, null, null, null);
      end if;
      -- A Step a Send Back gave back: its Participant hears of it as "Sent Back".
      if exists (
        select 1 from work_item_event e join workflow_transition tr on tr.id = e.transition_id
        where e.work_item_id = v_assignment.work_item_id and e.created_at = v_assignment.created_at
          and e.type = 'transition' and tr.kind = 'send_back'
      ) then
        return 0;
      end if;

      for v_recipient in
        select r.member_id from (
          select v_assignment.assignee_member_id as member_id where v_assignment.status = 'picked_up'
          union
          select p.member_id
          from app.step_pool(v_assignment.work_item_id, v_assignment.step_id, v_assignment.participant_id) p
          where v_assignment.status = 'pooled'
        ) r
        -- Never the Member whose move it was.
        where r.member_id is distinct from v_actor
      loop
        v_count := v_count + app.notify_member(
          p_outbox_id, v_recipient, v_assignment.project_id, v_assignment.work_item_id, 'step_reached', null,
          v_assignment.step_id, v_assignment.id, null, null, null);
      end loop;
      return v_count;
    end
  $function$;

-- No Vacancy e-mail either ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.notification_email_content(p_notification_id uuid, p_email text)
 RETURNS TABLE(to_address text, language text, kind text, project_id uuid, project_name jsonb, work_item_id uuid, document_number text, subject text, step_name jsonb, event_type text, transition_label jsonb, outcome text, company_name jsonb, signer_name jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    #variable_conflict use_column
    declare
      v_saved text := current_setting('app.member_id', true);
      v_n record;
      v_event_id uuid;
      v_transition_id uuid;
      v_actor_participant uuid;
      v_audience text;
      v_audience_participant uuid;
      v_outcome text;
      v_email text;
      v_sees boolean;
    begin
      perform app.require_worker();
      select n.* into v_n from notification n where n.id = p_notification_id;
      if v_n.id is null or v_n.withdrawn_at is not null then
        return;
      end if;
      -- A closed Project goes quiet.
      if not exists (select 1 from project p where p.id = v_n.project_id and p.status = 'active') then
        return;
      end if;
      -- A Step reached them: only while it still waits.
      if v_n.kind = 'step_reached' and not exists (
        select 1 from step_assignment a where a.id = v_n.step_assignment_id and a.status in ('pooled', 'picked_up')
      ) then
        return;
      end if;
      if v_n.work_item_event_id is not null then
        select e.id, e.transition_id, e.actor_participant_id, e.audience, e.audience_participant_id,
          app.event_outcome(e.type, e.payload)
        into v_event_id, v_transition_id, v_actor_participant, v_audience, v_audience_participant, v_outcome
        from work_item_event e where e.id = v_n.work_item_event_id;
      end if;
      -- Their settings now: email paused, the Project muted, the group's email or ticks changed.
      select r.email into v_email from app.member_notification_route(v_n.member_id, v_n.project_id, v_n.kind, v_outcome) r;
      if v_email is distinct from p_email then
        return;
      end if;

      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_n.member_id::text, true);
      v_sees := app.sees_work_item(v_n.work_item_id)
        and (v_event_id is null or v_audience = 'shared' or v_audience_participant in (select app.current_participant_ids()));
      if v_sees then
        return query
          select m.email, coalesce(pref.preferred_language, m.locale), v_n.kind, p.id, p.name, w.id, w.document_number, w.title,
            s.name, v_n.event_type, tr.label, v_outcome,
            (select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = v_actor_participant),
            case when v_event_id is not null then app.code_signer_name(v_event_id) end,
            v_n.created_at
          from member m
          left join member_notification_preference pref on pref.member_id = m.id
          join work_item w on w.id = v_n.work_item_id
          join project p on p.id = v_n.project_id
          left join workflow_step s on s.id = v_n.step_id
          left join workflow_transition tr on tr.id = v_transition_id
          where m.id = v_n.member_id;
      end if;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
    end
  $function$;

