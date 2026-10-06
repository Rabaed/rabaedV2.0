-- Watch (RP-354, spec RP-344; GLOSSARY "Watch"; visibility.md the Watch row and
-- scenario 67; data-model.md §9 work_item_watch).
--
-- * work_item_watch: one row per Member and Revision chain, keyed by the chain's
--   root (the original), so a Watch follows the item to its Revisions, and
--   unwatching any Revision unwatches the chain.
-- * Nobody sees who else watches an item, nor how many do: a Member reads only
--   their own rows (RLS), and never their root_id, which would name an earlier
--   Revision to someone who may see a later one but not it (the create_revision
--   migration keeps the chain's ids from the app role for the same reason). The
--   app role writes nothing directly: it watches, unwatches and asks through the
--   functions below, which act only on the caller's own row and only for an item
--   they see ('not_found' otherwise, like a made-up id).
-- * Auto-watch, in the same transaction as the command that causes it (triggers):
--   the Member who raises an item (a Revision too), and the Member who takes a
--   Submit out of the raiser's Participant. Nobody else.
-- * Items raised and Submitted before this migration are backfilled the same way.
-- * app.work_item_watchers(item): who watches the item's chain and still sees
--   the item, for notification delivery (RP-355). Never the app role's: only
--   another security definer function, run by the worker, calls it.

create table work_item_watch (
  member_id uuid not null references member (id),
  project_id uuid not null,
  -- The chain's original: one Watch covers every Revision.
  root_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (member_id, root_id),
  constraint work_item_watch_root_fk foreign key (root_id, project_id) references work_item (id, project_id)
);
create index work_item_watch_root_idx on work_item_watch (root_id);

alter table work_item_watch enable row level security;
-- Read through RLS, own rows only, and not the chain's id; written only through
-- the functions below.
revoke all on work_item_watch from rabaed_app;
grant select (member_id, project_id, created_at) on work_item_watch to rabaed_app;
create policy member_reads_own_watches on work_item_watch for select to rabaed_app
  using (member_id = app.current_member_id() and project_id in (select app.current_project_ids()));

-- Items raised and Submitted before Watch existed are watched as if it had.
insert into work_item_watch (member_id, project_id, root_id)
select w.created_by_member_id, w.project_id, w.root_id from work_item w
union
select e.actor_member_id, w.project_id, w.root_id
from work_item_event e
join work_item w on w.id = e.work_item_id
join workflow_transition tr on tr.id = e.transition_id and tr.kind = 'submit'
where e.type = 'transition' and e.actor_member_id is not null and e.actor_participant_id = w.raised_by_participant_id
on conflict do nothing;

-- Auto-watch --------------------------------------------------------------------------

-- The Member who raises an item watches its chain.
create function app.watch_on_raise() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into work_item_watch (member_id, project_id, root_id)
      values (new.created_by_member_id, new.project_id, new.root_id)
      on conflict do nothing;
      return null;
    end
  $$;
create trigger work_item_watch_raiser after insert on work_item
  for each row execute function app.watch_on_raise();

-- The Member who takes a Submit out of the raiser's Participant watches its chain.
create function app.watch_on_submit() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into work_item_watch (member_id, project_id, root_id)
      select new.actor_member_id, w.project_id, w.root_id
      from work_item w
      join workflow_transition tr on tr.id = new.transition_id and tr.kind = 'submit'
      where w.id = new.work_item_id and w.raised_by_participant_id = new.actor_participant_id
        and new.actor_member_id is not null
      on conflict do nothing;
      return null;
    end
  $$;
create trigger work_item_watch_submitter after insert on work_item_event
  for each row when (new.type = 'transition') execute function app.watch_on_submit();

-- The acting Member's own Watch ------------------------------------------------------

-- Watches the item's chain. 'watching', or 'not_found' for an item the caller
-- doesn't see.
create function app.watch_work_item(p_work_item_id uuid) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      insert into work_item_watch (member_id, project_id, root_id)
      select app.current_member_id(), w.project_id, w.root_id from work_item w where w.id = p_work_item_id
      on conflict do nothing;
      return 'watching';
    end
  $$;

-- Stops watching the item's chain, whichever Revision it is asked on.
-- 'not_watching', or 'not_found' for an item the caller doesn't see.
create function app.unwatch_work_item(p_work_item_id uuid) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      delete from work_item_watch
      where member_id = app.current_member_id()
        and root_id = (select w.root_id from work_item w where w.id = p_work_item_id);
      return 'not_watching';
    end
  $$;

-- Whether the acting Member watches the item's chain; null for an item they
-- don't see.
create function app.watching_work_item(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      return exists (
        select 1 from work_item_watch ww
        join work_item w on w.root_id = ww.root_id
        where w.id = p_work_item_id and ww.member_id = app.current_member_id()
      );
    end
  $$;

-- For delivery ----------------------------------------------------------------------

-- The Members who watch the item's chain and still see this item, by
-- app.sees_work_item, the rule every read uses: a watcher who lost sight of it,
-- or another Company's watcher of a Revision not yet Submitted (V1), is left
-- out. Only the worker's own functions call it (never granted to the app role);
-- it leaves the session's Member as it found it.
create function app.work_item_watchers(p_work_item_id uuid) returns table (member_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_saved text := current_setting('app.member_id', true);
      v_watcher uuid;
    begin
      perform app.require_worker();
      for v_watcher in
        select ww.member_id from work_item_watch ww
        join work_item w on w.root_id = ww.root_id
        where w.id = p_work_item_id
        order by ww.member_id
      loop
        perform set_config('app.member_id', v_watcher::text, true);
        if app.sees_work_item(p_work_item_id) then
          member_id := v_watcher;
          return next;
        end if;
      end loop;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
      return;
    end
  $$;

revoke all on function
  app.watch_on_raise(),
  app.watch_on_submit(),
  app.watch_work_item(uuid),
  app.unwatch_work_item(uuid),
  app.watching_work_item(uuid),
  app.work_item_watchers(uuid)
  from public;
grant execute on function
  app.watch_work_item(uuid),
  app.unwatch_work_item(uuid),
  app.watching_work_item(uuid)
  to rabaed_app;
