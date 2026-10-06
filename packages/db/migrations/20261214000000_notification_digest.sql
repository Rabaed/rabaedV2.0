-- The daily email digest (RP-358, spec RP-344 "Email"; visibility.md the
-- Notifications row; data-model.md §9), and the worker's scheduled jobs.
--
-- * Scheduled jobs: the worker decides when a job is due (a pure schedule in
--   @rabaed/domain) and claims that run time here (app.claim_scheduled_run), in
--   the transaction the job runs in. A run time is claimed once, however many
--   workers poll; a job that fails rolls its claim back and runs again.
-- * Collection: delivery (app.deliver_notification) already stores how each
--   notification is emailed; one routed "daily digest" waits (digested_at null).
-- * The job, at 07:00 Riyadh Sunday to Thursday, writes one outbox row of kind
--   'digest' per Member with notifications waiting (app.enqueue_notification_digests).
--   Friday's and Saturday's wait for Sunday's.
-- * At send time, app.take_notification_digest takes every waiting notification
--   of the Member, marks it digested and returns those that may still be
--   emailed, each checked exactly as an immediate email is
--   (app.notification_email_content, now shared with app.take_notification_email):
--   not withdrawn, the Project active, the Step still waiting or the Vacancy
--   still vacant, the recipient's settings still routing it to the digest (so
--   paused email and a muted Project are left out), and, as the recipient, the
--   item visible and its event readable (V5). What is left out is dropped, not
--   carried to the next digest. No rows: no email.
-- * The outbox's project_id becomes optional: a digest spans the Member's Projects.

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check check (kind in ('notification', 'email', 'digest', 'step_age_report'));
alter table outbox alter column project_id drop not null;

-- When a digest took the notification: emailed in it, or left out at send time.
alter table notification add column digested_at timestamptz;
create index notification_digest_waiting_idx on notification (member_id)
  where email = 'digest' and digested_at is null and emailed_at is null and withdrawn_at is null;

-- The latest run time each scheduled job has run for. The worker's functions only.
create table scheduled_job_run (
  job text primary key check (job ~ '^[a-z0-9_-]{1,100}$'),
  run_at timestamptz not null,
  ran_at timestamptz not null default now()
);
alter table scheduled_job_run enable row level security;
revoke all on scheduled_job_run from rabaed_app;

-- Claims run time p_run_at of job p_job: true when it had not run for it (nor a
-- later one), so the caller runs it now, in this transaction. Two workers at
-- once: the second waits for the first's transaction, then gets false.
create function app.claim_scheduled_run(p_job text, p_run_at timestamptz) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_claimed boolean;
    begin
      perform app.require_worker();
      insert into scheduled_job_run as r (job, run_at) values (p_job, p_run_at)
      on conflict (job) do update set run_at = excluded.run_at, ran_at = now()
        where r.run_at < excluded.run_at
      returning true into v_claimed;
      return coalesce(v_claimed, false);
    end
  $$;

-- A notification's email content as its recipient may see it now, or no row
-- when it must not be emailed (see RP-357's migration and above), for email
-- p_email ('immediate' or 'digest'): the recipient's settings must still route
-- it there. Sets app.member_id to the recipient for the visibility checks and
-- clears it again. Only from the worker's definer functions below.
create function app.notification_email_content(p_notification_id uuid, p_email text)
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
          coalesce(e.payload ->> 'outcome', case when e.type = 'cancelled' then 'cancelled' end)
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
      perform set_config('app.member_id', '', true);
    end
  $$;

-- RP-357's immediate email, now through the shared checks (same signature and result).
create or replace function app.take_notification_email(p_outbox_id uuid)
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
    begin
      perform app.require_worker();
      select n.* into v_n from outbox o
      join notification n on n.id = (o.payload ->> 'notification_id')::uuid
      where o.id = p_outbox_id and o.kind = 'email'
      for update of n;
      if v_n.id is null or v_n.email <> 'immediate' or v_n.emailed_at is not null then
        return;
      end if;
      return query
        select c.to_address, c.language, c.kind, c.work_item_id, c.document_number, c.subject, c.step_name, c.event_type,
          c.transition_label, c.outcome, c.company_name, c.signer_name
        from app.notification_email_content(v_n.id, 'immediate') c;
      if found then
        update notification set emailed_at = now() where id = v_n.id;
      end if;
    end
  $$;

-- The daily digest job: one outbox row per Member with notifications waiting for
-- a digest, unless one is already waiting to be sent. Returns how many.
create function app.enqueue_notification_digests() returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_count integer;
    begin
      perform app.require_worker();
      insert into outbox (kind, project_id, payload)
      select 'digest', null, jsonb_build_object('member_id', waiting.member_id)
      from (
        select distinct n.member_id from notification n
        where n.email = 'digest' and n.digested_at is null and n.emailed_at is null and n.withdrawn_at is null
      ) waiting
      where not exists (
        select 1 from outbox o
        where o.kind = 'digest' and o.processed_at is null and o.dead_at is null
          and o.payload ->> 'member_id' = waiting.member_id::text
      );
      get diagnostics v_count = row_count;
      return v_count;
    end
  $$;

-- The digest for an outbox row of kind 'digest': every notification of its
-- Member waiting for one is marked digested, and those that may still be
-- emailed are returned, as the recipient may see them now, oldest first. No
-- rows: send nothing. A failed send rolls the marks back, so the retry has them.
create function app.take_notification_digest(p_outbox_id uuid)
  returns table (
    to_address text, language text, kind text, project_id uuid, project_name jsonb, work_item_id uuid,
    document_number text, subject text, step_name jsonb, event_type text, transition_label jsonb, outcome text,
    company_name jsonb, signer_name jsonb, created_at timestamptz
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member_id uuid;
      v_id uuid;
    begin
      perform app.require_worker();
      select (o.payload ->> 'member_id')::uuid into v_member_id from outbox o where o.id = p_outbox_id and o.kind = 'digest';
      if v_member_id is null then
        return;
      end if;
      for v_id in
        select n.id from notification n
        where n.member_id = v_member_id and n.email = 'digest'
          and n.digested_at is null and n.emailed_at is null and n.withdrawn_at is null
        order by n.created_at, n.id
        for update
      loop
        update notification set digested_at = now() where id = v_id;
        return query select * from app.notification_email_content(v_id, 'digest');
      end loop;
    end
  $$;

revoke all on function
  app.claim_scheduled_run(text, timestamptz),
  app.notification_email_content(uuid, text),
  app.enqueue_notification_digests(),
  app.take_notification_digest(uuid)
  from public;
-- The worker connects as the app role; app.require_worker refuses a Member's session.
grant execute on function
  app.claim_scheduled_run(text, timestamptz),
  app.enqueue_notification_digests(),
  app.take_notification_digest(uuid)
  to rabaed_app;
