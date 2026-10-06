-- One definition each for rules the notification functions had copied
-- (RP-361 review; no change in behaviour):
--
-- * app.notify_member: delivering one notification row to one Member (as that
--   Member: sees the item, may read the event; their route; the insert).
--   app.deliver_notification's four paths now call it.
-- * app.project_member_holds_assign: whether a Project Member holds the `assign`
--   Function Permission. app.holds_assign_permission (who sees the "Weekly
--   report" setting) and the weekly report's queueing and send-time check use it.
-- * app.event_outcome: the outcome a watched event carries, for the routing rule
--   (its Code or Inspection Result, or `cancelled`). Delivery and the email
--   content use it.
--
-- Every function here that sets app.member_id restores what it found, as
-- app.work_item_watchers does, so a helper never clears a caller's Member.

-- The outcome of event `p_type` with `p_payload`, for the routing rule's ticks.
create function app.event_outcome(p_type text, p_payload jsonb) returns text
  language sql immutable
  as $$
    select coalesce(p_payload ->> 'outcome', case when p_type = 'cancelled' then 'cancelled' end)
  $$;

-- Whether Project Member `p_project_member_id` holds the `assign` Function
-- Permission through any of their Positions, in any Module.
create function app.project_member_holds_assign(p_project_member_id uuid) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from project_member_position mp
        join position_permission pp on pp.position_id = mp.position_id and pp.permission = 'assign'
        where mp.project_member_id = p_project_member_id
      );
    end
  $$;

-- Delivers outbox row `p_outbox_id` to Member `p_member_id` as a notification of
-- kind `p_kind`, if, as that Member, they see the item and may read the event
-- (`p_internal_to`: the Participant an internal event stays inside, V5; null
-- for none), and their settings route it in-app or by email. Returns 1 when a
-- row was written, else 0. Only app.deliver_notification calls it (never
-- granted to the app role); it leaves the session's Member as it found it.
create function app.notify_member(
  p_outbox_id uuid, p_member_id uuid, p_project_id uuid, p_work_item_id uuid, p_kind text, p_outcome text,
  p_step_id uuid, p_step_assignment_id uuid, p_work_item_event_id uuid, p_event_type text, p_internal_to uuid
) returns integer
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_saved text := current_setting('app.member_id', true);
      v_route record;
      v_inserted integer := 0;
    begin
      -- Exactly the visibility every read of this Member applies (layers 2-4).
      perform set_config('app.member_id', p_member_id::text, true);
      if app.sees_work_item(p_work_item_id)
        and (p_internal_to is null or p_internal_to in (select app.current_participant_ids())) then
        select * into v_route from app.member_notification_route(p_member_id, p_project_id, p_kind, p_outcome);
        if v_route.in_app or v_route.email <> 'none' then
          insert into notification (
            member_id, project_id, work_item_id, outbox_id, kind, step_id, step_assignment_id, work_item_event_id,
            event_type, in_app, email
          ) values (
            p_member_id, p_project_id, p_work_item_id, p_outbox_id, p_kind, p_step_id, p_step_assignment_id,
            p_work_item_event_id, p_event_type, v_route.in_app, v_route.email
          )
          on conflict (outbox_id, member_id) do nothing;
          get diagnostics v_inserted = row_count;
        end if;
      end if;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
      return v_inserted;
    end
  $$;

-- Delivers a notification row, to the Members who should hear of it then, each
-- only if they still see the item and through their settings (the routing rule):
-- * a Step reached: the open assignment's holder, or its Step Pool;
-- * a watched event: the chain's watchers who may read the event;
-- * a Send Back: the Members of the Participant it was sent back to;
-- * a Vacancy: the Authorized Person of the vacant Step's Company.
-- Never the Member whose move it was (but a Vacancy's: the Authorized Person who
-- removed its holder still has to fill it). Nothing of a Project that is no
-- longer active reaches anybody. Returns how many Members got it now.
create or replace function app.deliver_notification(p_outbox_id uuid) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_row record;
      v_assignment record;
      v_event record;
      v_actor uuid;
      v_recipient uuid;
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

      if v_row.payload ->> 'notification' = 'vacancy' then
        select a.*, co.authorized_person_id into v_assignment from step_assignment a
        join project p on p.id = a.project_id and p.status = 'active'
        join participant pa on pa.id = a.participant_id
        join company co on co.id = pa.company_id
        where a.id = (v_row.payload ->> 'step_assignment_id')::uuid
          and a.work_item_id = (v_row.payload ->> 'work_item_id')::uuid
          -- Filled again before delivery: nothing to name.
          and a.status = 'vacant';
        if v_assignment.id is null or v_assignment.authorized_person_id is null then
          return 0;
        end if;
        return app.notify_member(
          p_outbox_id, v_assignment.authorized_person_id, v_assignment.project_id, v_assignment.work_item_id, 'vacancy', null,
          v_assignment.step_id, v_assignment.id, null, null, null);
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
            and a.claimed_at = a.created_at
          union
          select p.member_id from step_assignment a
          cross join app.step_pool(a.work_item_id, a.step_id, a.participant_id) p
          where a.work_item_id = v_event.work_item_id and a.created_at = v_event.created_at
            and a.claimed_at is distinct from a.created_at);
        -- Those it was Sent Back to hear of it as "Sent Back" only.
        v_sent_back_to := case when v_event.transition_kind = 'send_back'
          then array(select s.member_id from app.sent_back_members(v_event.work_item_id, v_event.created_at) s)
          else '{}' end;
        -- Who watches the chain and still sees this item (scenario 68, V1); of
        -- them, V5: an internal event reaches only its own Participant's Members.
        foreach v_recipient in array array(select w.member_id from app.work_item_watchers(v_event.work_item_id) w) loop
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
        and a.status in ('pooled', 'claimed');
      -- The item moved on before delivery: it no longer waits for them.
      if v_assignment.id is null then
        return 0;
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
          select v_assignment.assignee_member_id as member_id where v_assignment.status = 'claimed'
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
  $$;

-- Whether the acting Member holds the Assign permission on any Project they are
-- on: the Weekly Step Age report's recipients (spec RP-344), who see its row.
create or replace function app.holds_assign_permission() returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from project_member pm
        where pm.member_id = app.current_member_id() and pm.status = 'active'
          and pm.project_id in (select app.current_project_ids())
          and app.project_member_holds_assign(pm.id)
      );
    end
  $$;

-- A notification's email content as its recipient may see it now, or no row
-- when it must not be emailed (see RP-357's migration and above), for email
-- p_email ('immediate' or 'digest'): the recipient's settings must still route
-- it there. Sets app.member_id to the recipient for the visibility checks and
-- restores what it found. Only from the worker's definer functions.
create or replace function app.notification_email_content(p_notification_id uuid, p_email text)
  returns table (
    to_address text, language text, kind text, project_id uuid, project_name jsonb, work_item_id uuid,
    document_number text, subject text, step_name jsonb, event_type text, transition_label jsonb, outcome text,
    company_name jsonb, signer_name jsonb, created_at timestamptz
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
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
        select 1 from step_assignment a where a.id = v_n.step_assignment_id and a.status in ('pooled', 'claimed')
      ) then
        return;
      end if;
      -- A Vacancy (RP-356): only while the Step is still vacant.
      if v_n.kind = 'vacancy' and not exists (
        select 1 from step_assignment a where a.id = v_n.step_assignment_id and a.status = 'vacant'
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
  $$;

-- One outbox row per recipient of the week's report. The worker only.
create or replace function app.enqueue_step_age_reports() returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_count integer;
    begin
      perform app.require_worker();
      insert into outbox (kind, project_id, payload)
      select distinct 'step_age_report', pm.project_id, jsonb_build_object('member_id', pm.member_id)
      from project_member pm
      join project p on p.id = pm.project_id and p.status = 'active'
      join member m on m.id = pm.member_id and m.status = 'active'
      where pm.status = 'active' and app.project_member_holds_assign(pm.id);
      get diagnostics v_count = row_count;
      return v_count;
    end
  $$;

-- The report of an outbox row of kind 'step_age_report', as its recipient may
-- see it now: one row per item, oldest at its Step first (the List's own
-- order), each with the recipient, their language, the Project and its open
-- Stages (for the link to the List). No rows when it must not be sent, or it
-- has no items. The worker only; it leaves the session's Member as it found it.
create or replace function app.take_step_age_report(p_outbox_id uuid)
  returns table (
    to_address text, language text, project_id uuid, project_name jsonb, open_stage_keys text[],
    work_item_id uuid, document_number text, subject text, stage_name jsonb,
    held_by_own boolean, step_name jsonb, holder_name jsonb, entered_at timestamptz
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_saved text := current_setting('app.member_id', true);
      v_project uuid;
      v_member uuid;
    begin
      perform app.require_worker();
      select o.project_id, (o.payload ->> 'member_id')::uuid into v_project, v_member
      from outbox o where o.id = p_outbox_id and o.kind = 'step_age_report' and o.processed_at is null;
      if v_member is null then
        return;
      end if;
      -- A closed Project goes quiet.
      if not exists (select 1 from project p where p.id = v_project and p.status = 'active') then
        return;
      end if;
      -- Still on the Project, holding Assign.
      if not exists (
        select 1 from project_member pm
        join member m on m.id = pm.member_id and m.status = 'active'
        where pm.project_id = v_project and pm.member_id = v_member and pm.status = 'active'
          and app.project_member_holds_assign(pm.id)
      ) then
        return;
      end if;
      -- Their settings now: the group's email off, email paused, the Project muted.
      -- "Immediately" and "daily digest" both send it: the report has its own time.
      if coalesce((select r.email from app.member_notification_route(v_member, v_project, 'weekly_report', null) r), 'none') = 'none' then
        return;
      end if;

      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_member::text, true);
      return query
        select m.email, coalesce(pref.preferred_language, m.locale), pr.id, pr.name,
          array(
            select s.key from stage s
            where s.module_key = 'submittals' and s.project_id is null and s.category in ('draft', 'in_progress')
            order by s.sort, s.key
          ),
          i.id, i.document_number, i.title, i.stage_name, i.held_by_own, i.step_name, i.holder_name, i.entered_at
        from member m
        left join member_notification_preference pref on pref.member_id = m.id
        join project pr on pr.id = v_project
        cross join lateral (
          select w.id, w.document_number, w.title, st.name as stage_name,
            coalesce(h.participant_id in (select app.current_participant_ids()), false) as held_by_own,
            s.name as step_name, hc.legal_name as holder_name, seen.entered_at
          from work_item w
          cross join lateral app.step_as_seen(w.id) seen
          join workflow_step s on s.id = seen.step_id
          join work_item_type t on t.id = w.work_item_type_id
          join stage st on st.module_key = t.module_key and st.key = seen.stage_key and st.project_id is null
          left join lateral (select * from app.work_item_holder(w.id) limit 1) h on true
          left join lateral (
            select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = h.participant_id
          ) hc on true
          where w.project_id = v_project and t.module_key = 'submittals'
            and st.category in ('draft', 'in_progress')
            and app.latest_visible_revision(w.id)
        ) i
        where m.id = v_member
        order by i.entered_at, i.id;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
    end
  $$;

-- Helpers of the worker's definer functions above: never the app role's.
revoke all on function
  app.event_outcome(text, jsonb),
  app.project_member_holds_assign(uuid),
  app.notify_member(uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, uuid)
  from public;
