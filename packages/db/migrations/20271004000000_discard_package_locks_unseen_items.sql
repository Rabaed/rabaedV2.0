-- RP-973 review fix: deleting a Package locks every item in it, the ones the Member doesn't see
-- too (data-model.md "Lock order").
--
-- * 20271003000000_package_write_lock_order.sql had app.discard_package lock its items through
--   app.lock_work_items, which locks only the items the Member sees. Its update then takes out
--   every item in the Package, and a narrowed Member's Package can hold a colleague's items they
--   don't see: those were still locked after the Package, so a Submit of one could still
--   deadlock with the delete.
-- * Now it locks them all, in order of id, and only for an owner of the Package, so nobody else
--   locks its items. An item added between that read and the Package's lock is still locked after
--   the Package: only a Submit of that same item in that instant could then wait on it the other
--   way round.
-- * Otherwise unchanged from 20271003000000_package_write_lock_order.sql.

-- A Member of the owning Participant deletes (discards) Open Package p_package_id: its items stay
-- as they were, without a Package, and nobody sees it again. Outcome: 'discarded', 'not_found',
-- 'project_closed' or 'package_not_open'.
create or replace function app.discard_package(p_package_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_package record;
    begin
      if not app.owns_package(p_package_id) then
        return 'not_found';
      end if;
      -- Every item in it, seen or not: the update below takes them all out.
      perform 1 from work_item w where w.package_id = p_package_id order by w.id for update of w;
      select * into v_package from app.package_for_write(p_package_id);
      if v_package.id is null then
        return 'not_found';
      end if;
      if v_package.project_status <> 'active' then
        return 'project_closed';
      end if;
      if v_package.status <> 'open' then
        return 'package_not_open';
      end if;
      update work_item set package_id = null where package_id = p_package_id;
      update package set discarded_at = v_at where id = p_package_id;
      perform app.write_package_event(p_package_id, 'discarded', null, '{}', v_at);
      return 'discarded';
    end
  $$;
