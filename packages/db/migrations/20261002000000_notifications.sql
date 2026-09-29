-- In-app notifications through the outbox and worker (workflow-engine.md §5,
-- §5.1 effect 7; data-model.md §9; visibility.md "Notifications and emails"; RP-195).
--
-- * When a Work Item reaches someone (a new open Step assignment), an outbox row
--   is written by a trigger in the same transaction as the Transition: a rolled
--   back Transition leaves none. A Step taken by the acting Member themselves
--   (their own new Draft) notifies nobody. The row holds ids only, never
--   customer text.
-- * The worker (the app role, with no Member set) takes one due row at a time
--   (FOR UPDATE SKIP LOCKED), delivers it and marks it processed, or records the
--   failure: the row is retried later and, after its last attempt,
--   dead-lettered. Other rows are never held up.
-- * Delivery decides the recipients then, not when the row was written: the
--   assignment must still be open; a claimed Step notifies its holder, a pooled
--   one its Step Pool; and each recipient must still see the item by
--   app.sees_work_item, the very rule every read uses (scenario 12). Each
--   Member gets one notification per row, however often it is delivered.
-- * A notification stores ids only. Its item's number and title are read
--   through RLS when it is shown, so they are always what the recipient may see
--   now; an item they no longer see drops out of their list and count.
--
-- Skeleton limits: in-app only (no email, no preferences), no notifications on
-- closing, no Transition-level notification rules (workflow_transition.notifications).

create table outbox (
  id uuid primary key default app.uuid_v7(),
  kind text not null check (kind in ('notification')),
  project_id uuid not null references project (id),
  -- Ids only: never customer text, so the worker can log a row safely.
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  -- When it is next due; pushed later after a failed attempt.
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  processed_at timestamptz,
  -- Dead-lettered: no more attempts.
  dead_at timestamptz,
  check (processed_at is null or dead_at is null)
);
create index outbox_due_idx on outbox (available_at, id) where processed_at is null and dead_at is null;

create table notification (
  id uuid primary key default app.uuid_v7(),
  member_id uuid not null references member (id),
  project_id uuid not null,
  work_item_id uuid not null,
  outbox_id uuid not null references outbox (id),
  kind text not null check (kind in ('step_reached')),
  -- The Step it reached them at.
  step_id uuid not null references workflow_step (id),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notification_item_fk foreign key (work_item_id, project_id) references work_item (id, project_id),
  constraint notification_outbox_member_key unique (outbox_id, member_id)
);
create index notification_member_idx on notification (member_id, created_at desc);

alter table outbox enable row level security;
alter table notification enable row level security;
revoke insert, update, delete on outbox, notification from rabaed_app;
-- The outbox has no read policy: only the worker's functions below touch it.
-- A Member reads their own notifications, and only of items they still see.
create policy member_reads_own_notifications on notification for select to rabaed_app
  using (member_id = app.current_member_id() and work_item_id in (select id from work_item));

-- Writing ------------------------------------------------------------------------------

-- A Work Item reached someone: a new open assignment that isn't the acting
-- Member's own.
create function app.outbox_step_reached() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if new.status in ('pooled', 'claimed') and new.assignee_member_id is distinct from app.current_member_id() then
        insert into outbox (kind, project_id, payload, created_at, available_at)
        values ('notification', new.project_id,
          jsonb_build_object('reason', 'step_reached', 'work_item_id', new.work_item_id, 'step_assignment_id', new.id),
          new.created_at, now());
      end if;
      return new;
    end
  $$;
create trigger step_assignment_outbox after insert on step_assignment
  for each row execute function app.outbox_step_reached();

-- The worker ---------------------------------------------------------------------------

-- The worker connects as the app role with no Member set; a Member's session is
-- refused, so the API can never process or read the outbox.
create function app.require_worker() returns void
  language plpgsql stable
  as $$
    begin
      if app.current_member_id() is not null then
        raise exception 'only the worker processes the outbox' using errcode = '42501';
      end if;
    end
  $$;

-- The next due row, locked until the caller's transaction ends; other workers
-- skip it. No row when nothing is due.
create function app.take_outbox_row()
  returns table (id uuid, kind text, payload jsonb, attempts integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      perform app.require_worker();
      return query
        select o.id, o.kind, o.payload, o.attempts from outbox o
        where o.processed_at is null and o.dead_at is null and o.available_at <= now()
        order by o.available_at, o.id
        limit 1
        for update skip locked;
    end
  $$;

-- Delivers a notification row: to the open assignment's holder, or its Step Pool,
-- each only if they still see the item. Returns how many Members got it now.
create function app.deliver_notification(p_outbox_id uuid) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_row record;
      v_assignment record;
      v_recipient uuid;
      v_count integer := 0;
      v_inserted integer;
    begin
      perform app.require_worker();
      select * into v_row from outbox where id = p_outbox_id;
      select a.* into v_assignment from step_assignment a
      where a.id = (v_row.payload ->> 'step_assignment_id')::uuid
        and a.work_item_id = (v_row.payload ->> 'work_item_id')::uuid
        and a.status in ('pooled', 'claimed');
      -- The item moved on before delivery: it no longer waits for them.
      if v_assignment.id is null then
        return 0;
      end if;

      for v_recipient in
        select v_assignment.assignee_member_id where v_assignment.status = 'claimed'
        union
        select p.member_id
        from app.step_pool(v_assignment.work_item_id, v_assignment.step_id, v_assignment.participant_id) p
        where v_assignment.status = 'pooled'
      loop
        -- Exactly the visibility every read of this Member applies (layers 2-4).
        perform set_config('app.member_id', v_recipient::text, true);
        if app.sees_work_item(v_assignment.work_item_id) then
          insert into notification (member_id, project_id, work_item_id, outbox_id, kind, step_id)
          values (v_recipient, v_assignment.project_id, v_assignment.work_item_id, p_outbox_id, 'step_reached',
            v_assignment.step_id)
          on conflict (outbox_id, member_id) do nothing;
          get diagnostics v_inserted = row_count;
          v_count := v_count + v_inserted;
        end if;
        perform set_config('app.member_id', '', true);
      end loop;
      return v_count;
    end
  $$;

create function app.outbox_processed(p_outbox_id uuid) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.require_worker();
      update outbox set processed_at = now() where id = p_outbox_id and processed_at is null and dead_at is null;
    end
  $$;

-- Records a failed attempt: due again p_retry_after_ms from now, or
-- dead-lettered once it has had p_max_attempts. Returns 'retry' or 'dead'.
create function app.outbox_failed(p_outbox_id uuid, p_error text, p_max_attempts integer, p_retry_after_ms integer)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_attempts integer;
    begin
      perform app.require_worker();
      update outbox set
        attempts = attempts + 1,
        last_error = left(p_error, 500),
        available_at = now() + make_interval(secs => p_retry_after_ms / 1000.0),
        dead_at = case when attempts + 1 >= p_max_attempts then now() end
      where id = p_outbox_id and processed_at is null and dead_at is null
      returning attempts into v_attempts;
      return case when v_attempts >= p_max_attempts then 'dead' else 'retry' end;
    end
  $$;

-- For the worker's log and the outbox alarms: rows still to process (dead ones
-- excluded) and the age of the oldest, 0 when there are none.
create function app.outbox_stats() returns table (backlog integer, oldest_age_seconds integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.require_worker();
      return query
        select count(*)::integer, coalesce(extract(epoch from now() - min(created_at)), 0)::integer
        from outbox where processed_at is null and dead_at is null;
    end
  $$;

-- Reading ------------------------------------------------------------------------------

-- Marks the acting Member's notifications read: those in p_ids, or all when null.
create function app.mark_notifications_read(p_ids uuid[], p_now timestamptz) returns void
  language sql volatile security definer
  set search_path = pg_catalog, public
  as $$
    update notification set read_at = greatest(p_now, now())
    where member_id = app.current_member_id() and read_at is null and (p_ids is null or id = any (p_ids))
  $$;

revoke all on function
  app.outbox_step_reached(),
  app.require_worker(),
  app.take_outbox_row(),
  app.deliver_notification(uuid),
  app.outbox_processed(uuid),
  app.outbox_failed(uuid, text, integer, integer),
  app.outbox_stats(),
  app.mark_notifications_read(uuid[], timestamptz)
  from public;
grant execute on function
  app.take_outbox_row(),
  app.deliver_notification(uuid),
  app.outbox_processed(uuid),
  app.outbox_failed(uuid, text, integer, integer),
  app.outbox_stats(),
  app.mark_notifications_read(uuid[], timestamptz)
  to rabaed_app;
