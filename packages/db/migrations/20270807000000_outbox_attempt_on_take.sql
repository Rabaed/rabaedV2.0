-- RP-958: an outbox attempt is counted when the worker takes the row (workflow-engine.md §5).
--
-- The worker used to take a row and run its handler in one transaction, counting the
-- attempt only when the handler threw. A worker that died in the handler (out of memory,
-- killed) rolled all of it back: the attempt was never counted, the row was due again at
-- once, and the next worker died on it the same way, for ever.
-- * `app.take_outbox_row` now counts the attempt and pushes `available_at` back by the
--   attempt's backoff, in a transaction of its own that commits before the handler runs.
--   A worker that dies in the handler has spent that attempt; the row is due again once its
--   backoff has passed.
-- * A due row whose attempts are all spent had its last attempt taken and never recorded:
--   the take dead-letters it ("the worker stopped while running it; before that: " and the
--   earlier error) and hands it back marked `dead`, without running it.
-- * The handler runs in a second transaction that first locks the row
--   (`app.hold_outbox_row`), so no other worker takes it while it runs, however long it
--   takes; a row another worker took meanwhile (its attempts moved on) is left to that one.
-- * `attempts` still counts failed attempts: `app.outbox_processed` gives back the attempt
--   that succeeded, and `app.outbox_failed` no longer counts it again. While a handler runs,
--   or after a worker died in one, it includes the attempt in flight.
-- * `app.outbox_failed` records a failure only for the attempt that failed (`p_attempts`):
--   a late record never overwrites a later attempt another worker has taken.
-- The attempts and backoff are `processOutbox`'s (packages/db/src/outbox.ts), passed in;
-- the SQL keeps no copy of them.

drop function app.take_outbox_row();

-- The next due row, its attempt counted and its `available_at` pushed back by
-- p_retry_after_ms[that attempt] (one entry per attempt, p_max_attempts of them). The
-- caller commits this before running the row, so an attempt the worker dies in still
-- counts. Other workers skip a row taken and not yet committed. No row when nothing is due.
-- Both arguments are required; their null defaults only let a no-argument call reach
-- `app.require_worker`, so a Member's session is refused as before (a worker's is refused
-- for the missing arguments).
create function app.take_outbox_row(p_max_attempts integer default null, p_retry_after_ms integer[] default null)
  returns table (id uuid, kind text, payload jsonb, attempts integer, dead boolean)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_row outbox%rowtype;
    begin
      perform app.require_worker();
      if p_max_attempts is null or p_max_attempts < 1 or coalesce(cardinality(p_retry_after_ms), 0) < p_max_attempts
        or array_position(p_retry_after_ms, null) is not null then
        raise exception 'take_outbox_row needs the attempts and a backoff for each' using errcode = '22023';
      end if;
      select * into v_row from outbox o
      where o.processed_at is null and o.dead_at is null and o.available_at <= now()
      order by o.available_at, o.id
      limit 1
      for update skip locked;
      if not found then
        return;
      end if;
      if v_row.attempts >= p_max_attempts then
        -- Its last attempt was taken and never recorded: the worker stopped while running it.
        update outbox o set
          dead_at = now(),
          last_error = left('the worker stopped while running it' || coalesce('; before that: ' || o.last_error, ''), 500)
        where o.id = v_row.id;
        return query select v_row.id, v_row.kind, v_row.payload, v_row.attempts, true;
        return;
      end if;
      update outbox o set
        attempts = o.attempts + 1,
        available_at = now() + make_interval(secs => p_retry_after_ms[v_row.attempts + 1] / 1000.0)
      where o.id = v_row.id;
      return query select v_row.id, v_row.kind, v_row.payload, v_row.attempts + 1, false;
    end
  $$;

-- Locks a row taken for attempt p_attempts until the caller's transaction ends, so
-- no other worker takes it while its handler runs. False when it is no longer
-- that attempt's to run: processed, dead-lettered, or taken again by another worker.
create function app.hold_outbox_row(p_outbox_id uuid, p_attempts integer) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.require_worker();
      perform 1 from outbox o
      where o.id = p_outbox_id and o.attempts = p_attempts and o.processed_at is null and o.dead_at is null
      for update;
      return found;
    end
  $$;

-- The attempt counted at take succeeded: it is not a failed attempt.
create or replace function app.outbox_processed(p_outbox_id uuid) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.require_worker();
      update outbox set processed_at = now(), attempts = greatest(attempts - 1, 0)
      where id = p_outbox_id and processed_at is null and dead_at is null;
    end
  $$;

drop function app.outbox_failed(uuid, text, integer, integer);

-- Attempt p_attempts, counted at take, failed: records why, and retries the row after
-- p_retry_after_ms or, when that was its last attempt, dead-letters it. 'gone' when the
-- row is processed, dead-lettered, or taken again since (its attempts moved on): a late
-- record never overwrites a later attempt's.
create function app.outbox_failed(p_outbox_id uuid, p_attempts integer, p_error text, p_max_attempts integer, p_retry_after_ms integer)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_attempts integer;
    begin
      perform app.require_worker();
      update outbox set
        last_error = left(p_error, 500),
        available_at = now() + make_interval(secs => p_retry_after_ms / 1000.0),
        dead_at = case when attempts >= p_max_attempts then now() end
      where id = p_outbox_id and attempts = p_attempts and processed_at is null and dead_at is null
      returning attempts into v_attempts;
      return case when v_attempts is null then 'gone' when v_attempts >= p_max_attempts then 'dead' else 'retry' end;
    end
  $$;

revoke all on function
  app.take_outbox_row(integer, integer[]),
  app.hold_outbox_row(uuid, integer),
  app.outbox_failed(uuid, integer, text, integer, integer)
  from public;
grant execute on function
  app.take_outbox_row(integer, integer[]),
  app.hold_outbox_row(uuid, integer),
  app.outbox_failed(uuid, integer, text, integer, integer)
  to rabaed_app;
