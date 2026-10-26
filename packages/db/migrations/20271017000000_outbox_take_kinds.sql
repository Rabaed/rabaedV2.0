-- RP-1039: `app.take_outbox_row` takes only the kinds its caller handles (ADR 0026).
--
-- On Vercel the api's cron pass delivers the outbox rows it can (in-app notifications,
-- emails, digests, Step Age reports, record-ready notices), and the Documental Record kinds
-- stay for the Records container. A pass that took a row it has no handler for would spend
-- its attempts and dead-letter it, and two consumers would take each other's rows.
-- * `p_kinds` is an include list: only due rows of those kinds are taken. Null, its default,
--   takes every kind, as before: a call with two arguments (a worker still running the old
--   code during a deploy) works unchanged. An empty list takes nothing.
-- * Everything else is the newest body (20270829000000_outbox_attempt_on_take.sql), and so
--   are the grants: the app role only.

drop function app.take_outbox_row(integer, integer[]);

-- The next due row of one of p_kinds (any kind when null), its attempt counted and its
-- `available_at` pushed back by p_retry_after_ms[that attempt] (one entry per attempt,
-- p_max_attempts of them). The caller commits this before running the row, so an attempt
-- the worker dies in still counts. Other workers skip a row taken and not yet committed.
-- No row when nothing is due. The attempts and backoff are required; their null defaults
-- only let a no-argument call reach `app.require_worker`, so a Member's session is refused
-- as before (a worker's is refused for the missing arguments).
create function app.take_outbox_row(p_max_attempts integer default null, p_retry_after_ms integer[] default null, p_kinds text[] default null)
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
        and (p_kinds is null or o.kind = any(p_kinds))
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

revoke all on function app.take_outbox_row(integer, integer[], text[]) from public;
grant execute on function app.take_outbox_row(integer, integer[], text[]) to rabaed_app;
