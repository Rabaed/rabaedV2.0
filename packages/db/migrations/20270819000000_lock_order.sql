-- RP-616 review fix 5: one lock order for every command over several items (data-model.md
-- "Lock order").
--
-- * A single Transition locks its item (app.take_transition's update), then its Package (the
--   status trigger, app.recompute_package_status). A command over several items (Submit Package,
--   a bulk Transition) now locks all its items first, in order of id, then the Package, so it and
--   a single Transition never wait on each other the other way round. Before, Submit Package
--   locked the Package first (app.begin_package_submit), and a bulk Transition locked item by
--   item with the Package's lock held after the first.
-- * app.lock_work_items: locks, in order of id, the items of `p_ids` the calling Member sees,
--   until the transaction ends. Security definer because the app role has no update grant on
--   work_item (row locks need one); it answers nothing, so it tells nobody about an item.
-- * Nothing here changes app.take_transition or the single Transition's path.

create function app.lock_work_items(p_ids uuid[]) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform 1 from work_item w
      where w.id = any (p_ids) and app.sees_work_item(w.id)
      order by w.id
      for update of w;
    end
  $$;

revoke all on function app.lock_work_items(uuid[]) from public;
grant execute on function app.lock_work_items(uuid[]) to rabaed_app;
