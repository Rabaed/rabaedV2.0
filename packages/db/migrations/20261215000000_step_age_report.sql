-- The weekly Step Age report (RP-359, spec RP-344; visibility.md the Step Age
-- reports row and scenario 21; workflow-engine.md §10).
--
-- * Every Sunday at 07:00 Riyadh time the worker plans the week's reports
--   (app.plan_step_age_reports): one row per active Project and active Member
--   holding the `assign` Function Permission there (in any Module, as
--   app.holds_assign_permission, which shows them the "Weekly report" setting).
--   Planning a due time a second time does nothing, so the worker can plan on
--   every poll of that Sunday.
-- * The worker then sends them one at a time (app.take_step_age_report, a
--   queue of its own, not the outbox): at send time it checks again and skips
--   the report when the Project is no longer active, the Member left it or no
--   longer holds Assign, or their settings don't email the "Weekly report"
--   group (its email off, email paused, the Project muted).
-- * The items (app.step_age_report_items) are read as the recipient, exactly as
--   the List reads them (apps/api work-items/query.ts): their visible open items
--   of the Module, the latest Revision of each chain they see
--   (app.latest_visible_revision), with the Step, Stage and Step Age of
--   app.step_as_seen, so another Company's item counts from when it reached that
--   Company and its internal moves stay its own (V14). For a Contractor or
--   Consultant that is their Participant's items; for an Owner or Owner
--   Representative, the items they oversee. "With" names another Company only.
--   An empty report is not sent.
-- * Nothing here is readable by a Member: the app role has no grant on the
--   tables, and every function refuses a Member's session (app.require_worker).

create table step_age_report_plan (
  -- The Sunday 07:00 a week's reports were planned for.
  due_at timestamptz primary key,
  planned_at timestamptz not null default now()
);

create table step_age_report (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null references project (id),
  member_id uuid not null references member (id),
  due_at timestamptz not null,
  -- When it may be taken: now, or after a failed send, its retry time.
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  item_count integer,
  -- Not sent, and why: the recipient no longer gets it, or it had no items.
  skipped_at timestamptz,
  skipped_reason text check (skipped_reason in ('project_closed', 'not_recipient', 'opted_out', 'empty')),
  dead_at timestamptz,
  constraint step_age_report_once unique (member_id, project_id, due_at),
  constraint step_age_report_skipped check ((skipped_at is null) = (skipped_reason is null))
);
create index step_age_report_due_idx on step_age_report (available_at)
  where sent_at is null and skipped_at is null and dead_at is null;

-- Out of the app role's reach: only the definer functions below read or write them.
alter table step_age_report_plan enable row level security;
alter table step_age_report enable row level security;
revoke all on step_age_report_plan, step_age_report from rabaed_app;

-- Plans the reports due at p_due_at; the number planned, 0 when already planned. The worker only.
create function app.plan_step_age_reports(p_due_at timestamptz) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_count integer;
    begin
      perform app.require_worker();
      insert into step_age_report_plan (due_at) values (p_due_at) on conflict do nothing;
      if not found then
        return 0;
      end if;
      insert into step_age_report (project_id, member_id, due_at)
      select distinct pm.project_id, pm.member_id, p_due_at
      from project_member pm
      join project p on p.id = pm.project_id and p.status = 'active'
      join member m on m.id = pm.member_id and m.status = 'active'
      join project_member_position mp on mp.project_member_id = pm.id
      join position_permission pp on pp.position_id = mp.position_id and pp.permission = 'assign'
      where pm.status = 'active'
      on conflict do nothing;
      get diagnostics v_count = row_count;
      return v_count;
    end
  $$;

-- The next report due, locked for this transaction, with its recipient and
-- Project; a report that must no longer go is marked skipped and passed over.
-- No row when none is due. The worker only.
create function app.take_step_age_report()
  returns table (report_id uuid, attempts integer, to_address text, language text, project_id uuid, project_name jsonb, open_stage_keys text[])
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_r record;
      v_skip text;
    begin
      perform app.require_worker();
      loop
        select r.id, r.project_id, r.member_id, r.attempts into v_r
        from step_age_report r
        where r.sent_at is null and r.skipped_at is null and r.dead_at is null and r.available_at <= now()
        order by r.available_at, r.id
        limit 1
        for update skip locked;
        if v_r.id is null then
          return;
        end if;
        v_skip := case
          -- A closed Project goes quiet.
          when not exists (select 1 from project p where p.id = v_r.project_id and p.status = 'active') then 'project_closed'
          when not exists (
            select 1 from project_member pm
            join member m on m.id = pm.member_id and m.status = 'active'
            join project_member_position mp on mp.project_member_id = pm.id
            join position_permission pp on pp.position_id = mp.position_id and pp.permission = 'assign'
            where pm.project_id = v_r.project_id and pm.member_id = v_r.member_id and pm.status = 'active'
          ) then 'not_recipient'
          -- Emailed either way: the report has its own time, so "immediately" and "digest" both send it.
          when coalesce((
            select rt.email from app.member_notification_route(v_r.member_id, v_r.project_id, 'weekly_report', null) rt
          ), 'none') = 'none' then 'opted_out'
        end;
        if v_skip is null then
          return query
            select v_r.id, v_r.attempts, m.email, coalesce(pref.preferred_language, m.locale), p.id, p.name,
              array(
                select s.key from stage s
                where s.module_key = 'submittals' and s.project_id is null and s.category in ('draft', 'in_progress')
                order by s.sort, s.key
              )
            from member m
            left join member_notification_preference pref on pref.member_id = m.id
            join project p on p.id = v_r.project_id
            where m.id = v_r.member_id;
          return;
        end if;
        update step_age_report set skipped_at = now(), skipped_reason = v_skip where id = v_r.id;
      end loop;
    end
  $$;

-- The report's items, as its recipient sees them now (see above), oldest at
-- their Step first: the List's own order. The worker only, for a report it has taken.
create function app.step_age_report_items(p_report_id uuid)
  returns table (
    work_item_id uuid, document_number text, subject text, stage_name jsonb,
    held_by_own boolean, step_name jsonb, holder_name jsonb, entered_at timestamptz
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_r record;
    begin
      perform app.require_worker();
      select r.project_id, r.member_id into v_r
      from step_age_report r
      where r.id = p_report_id and r.sent_at is null and r.skipped_at is null and r.dead_at is null;
      if v_r.member_id is null then
        return;
      end if;
      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_r.member_id::text, true);
      return query
        select w.id, w.document_number, w.title, st.name,
          coalesce(h.participant_id in (select app.current_participant_ids()), false),
          s.name, hc.legal_name, seen.entered_at
        from work_item w
        cross join lateral app.step_as_seen(w.id) seen
        join workflow_step s on s.id = seen.step_id
        join work_item_type t on t.id = w.work_item_type_id
        join stage st on st.module_key = t.module_key and st.key = seen.stage_key and st.project_id is null
        left join lateral (select * from app.work_item_holder(w.id) limit 1) h on true
        left join lateral (
          select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = h.participant_id
        ) hc on true
        where w.project_id = v_r.project_id and t.module_key = 'submittals'
          and st.category in ('draft', 'in_progress')
          and app.latest_visible_revision(w.id)
        order by seen.entered_at, w.id;
      perform set_config('app.member_id', '', true);
    end
  $$;

-- Marks a taken report sent with p_item_count items, or skipped when it had none. The worker only.
create function app.step_age_report_done(p_report_id uuid, p_item_count integer) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.require_worker();
      if p_item_count > 0 then
        update step_age_report set sent_at = now(), item_count = p_item_count where id = p_report_id and sent_at is null;
      else
        update step_age_report set skipped_at = now(), skipped_reason = 'empty', item_count = 0
        where id = p_report_id and sent_at is null and skipped_at is null;
      end if;
    end
  $$;

-- Records a failed send: retried after p_retry_after_ms, or dead after
-- p_max_attempts. 'retry', 'dead', or 'gone' (no such unsent report). The worker only.
create function app.step_age_report_failed(p_report_id uuid, p_error text, p_max_attempts integer, p_retry_after_ms integer)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_attempts integer;
    begin
      perform app.require_worker();
      update step_age_report
      set attempts = attempts + 1,
        last_error = left(p_error, 500),
        available_at = now() + make_interval(secs => p_retry_after_ms / 1000.0),
        dead_at = case when attempts + 1 >= p_max_attempts then now() end
      where id = p_report_id and sent_at is null and skipped_at is null and dead_at is null
      returning attempts into v_attempts;
      if v_attempts is null then
        return 'gone';
      end if;
      return case when v_attempts >= p_max_attempts then 'dead' else 'retry' end;
    end
  $$;

revoke all on function
  app.plan_step_age_reports(timestamptz),
  app.take_step_age_report(),
  app.step_age_report_items(uuid),
  app.step_age_report_done(uuid, integer),
  app.step_age_report_failed(uuid, text, integer, integer)
  from public;
-- The worker connects as the app role; app.require_worker refuses a Member's session.
grant execute on function
  app.plan_step_age_reports(timestamptz),
  app.take_step_age_report(),
  app.step_age_report_items(uuid),
  app.step_age_report_done(uuid, integer),
  app.step_age_report_failed(uuid, text, integer, integer)
  to rabaed_app;
