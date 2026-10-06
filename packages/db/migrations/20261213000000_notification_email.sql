-- Immediate notification emails (RP-357, spec RP-344 "Email"; visibility.md the
-- Notifications row and scenarios 19 and 69; data-model.md §9).
--
-- * Delivery (app.deliver_notification, RP-355) stores on each notification how
--   it is emailed. One routed "immediately" gets an outbox row of kind 'email'
--   (a trigger on notification, so delivery itself is not redefined), which the
--   worker sends through the mailer: the outbox's attempts and dead letters apply.
-- * At send time, app.take_notification_email checks everything again and
--   returns nothing when the email must not go: the notification was withdrawn
--   (a colleague claimed the Step), its Step no longer waits, or a Vacancy was filled; the Project is
--   closed; the recipient's settings no longer email it at once (email paused,
--   the Project muted, the group's email changed, the outcome unticked); or, as
--   the recipient, the item is no longer visible (app.sees_work_item) or its
--   event no longer readable (V5).
-- * What it returns is what the recipient may see: the Document Number and
--   Subject, their own Step, and what happened, with the acting Company by name
--   only and, of another Company's people, only the signer of a final Code
--   (app.code_signer_name, V14). Never another Company's internal Steps,
--   Recommended Codes or Internal Notes: an event of theirs is not readable.
-- * The email's language is the Member's preferred language for email, else
--   their locale. It is marked emailed (emailed_at) in the same transaction, so a
--   failed send rolls it back and the retry sends it.

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check check (kind in ('notification', 'email'));

-- When the notification was emailed on its own (null: not, or not yet).
alter table notification add column emailed_at timestamptz;

-- A notification routed to email "immediately": an outbox row for the worker to send it.
create function app.outbox_notification_email() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into outbox (kind, project_id, payload)
      values ('email', new.project_id, jsonb_build_object('notification_id', new.id));
      return null;
    end
  $$;
create trigger notification_outbox_email after insert on notification
  for each row when (new.email = 'immediate')
  execute function app.outbox_notification_email();

-- The email for an outbox row of kind 'email', as its recipient may see it now,
-- marked emailed; no row when it must not be sent (see above). The worker only.
create function app.take_notification_email(p_outbox_id uuid)
  returns table (
    to_address text, language text, kind text, work_item_id uuid, document_number text, subject text,
    step_name jsonb, event_type text, transition_label jsonb, outcome text, company_name jsonb, signer_name jsonb
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
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
      select n.* into v_n from outbox o
      join notification n on n.id = (o.payload ->> 'notification_id')::uuid
      where o.id = p_outbox_id and o.kind = 'email'
      for update of n;
      if v_n.id is null or v_n.email <> 'immediate' or v_n.emailed_at is not null or v_n.withdrawn_at is not null then
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
          coalesce(e.payload ->> 'outcome', case when e.type = 'cancelled' then 'cancelled' end)
        into v_event_id, v_transition_id, v_actor_participant, v_audience, v_audience_participant, v_outcome
        from work_item_event e where e.id = v_n.work_item_event_id;
      end if;
      -- Their settings now: email paused, the Project muted, the group's email or ticks changed.
      select r.email into v_email from app.member_notification_route(v_n.member_id, v_n.project_id, v_n.kind, v_outcome) r;
      if v_email is distinct from 'immediate' then
        return;
      end if;

      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_n.member_id::text, true);
      v_sees := app.sees_work_item(v_n.work_item_id)
        and (v_event_id is null or v_audience = 'shared' or v_audience_participant in (select app.current_participant_ids()));
      if v_sees then
        update notification set emailed_at = now() where id = v_n.id;
        return query
          select m.email, coalesce(pref.preferred_language, m.locale), v_n.kind, w.id, w.document_number, w.title,
            s.name, v_n.event_type, tr.label, v_outcome,
            (select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = v_actor_participant),
            case when v_event_id is not null then app.code_signer_name(v_event_id) end
          from member m
          left join member_notification_preference pref on pref.member_id = m.id
          join work_item w on w.id = v_n.work_item_id
          left join workflow_step s on s.id = v_n.step_id
          left join workflow_transition tr on tr.id = v_transition_id
          where m.id = v_n.member_id;
      end if;
      perform set_config('app.member_id', '', true);
    end
  $$;

revoke all on function app.outbox_notification_email(), app.take_notification_email(uuid) from public;
-- The worker connects as the app role; app.require_worker refuses a Member's session.
grant execute on function app.take_notification_email(uuid) to rabaed_app;
