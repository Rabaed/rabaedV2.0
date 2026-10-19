-- RP-642: when a Package is Done (spec RP-616 "Status", stories 21–23, 26–28; data-model.md package).
--
-- * Status from all its items, never per viewer: Open until any item has `submitted_at`; then Done
--   when, leaving out cancelled and discarded items, it holds at least one item and the latest
--   Revision of each of its chains (over the whole chain) is closed at an outcome that offers no
--   Revision (Code A, B or D in the Rabaed Defaults; read from the Type's outcome set,
--   app.outcome_offers, never a fixed code); otherwise In Progress. A Done Package goes back to In
--   Progress when an open item joins it (a replacement of a Code D item, an item added). Never back
--   to Open (RP-638).
-- * Recomputed in the same transaction as the change, by the trigger on work_item, now also on an
--   item closing (`outcome`, `closed_at`, whoever writes them: app.take_transition's closing path, a
--   cancel), discarded (`discarded_at`) and created in a Package (a Revision). Nothing here changes
--   app.take_transition or app.transition_effects.
-- * A Revision joins the Package of the item it follows (a trigger before insert on work_item, from
--   `revision_of_id`); a replacement the Package of the item it replaces (a trigger after insert of
--   its `replaces` link, which app.create_replacement writes in the same transaction).
--   app.create_revision and app.create_replacement are not redefined.
-- * work_item.package_id stays ungranted to the app role.

-- The Package's status from all its items. Locks the Package row first, so two items closing at
-- once in two transactions are counted one after the other. A helper of the triggers below, not
-- for the app role.
create or replace function app.recompute_package_status(p_package_id uuid) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_status text;
      v_new text;
    begin
      select k.status into v_status from package k where k.id = p_package_id for update;
      if v_status is null
        or not exists (select 1 from work_item w where w.package_id = p_package_id and w.submitted_at is not null) then
        return;
      end if;
      with chains as (
        select distinct w.root_id from work_item w
        where w.package_id = p_package_id and w.discarded_at is null and w.outcome is distinct from 'cancelled'
      ), latest as (
        select distinct on (c.root_id) l.*
        from chains c
        join work_item l on l.root_id = c.root_id and l.discarded_at is null and l.outcome is distinct from 'cancelled'
        order by c.root_id, l.revision_no desc
      )
      select case
          when exists (select 1 from latest)
            and not exists (
              select 1 from latest l
              where l.closed_at is null or l.outcome is null
                or app.outcome_offers(l.project_id, l.work_item_type_id, l.outcome, 'offer_revision')
            )
          then 'done' else 'in_progress' end
        into v_new;
      if v_new <> v_status then
        update package k set status = v_new where k.id = p_package_id;
      end if;
    end
  $$;

-- After an item of a Package is Submitted, closed, cancelled, discarded, created or moved into it.
create or replace function app.package_status_on_item_change() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if new.package_id is not null then
        perform app.recompute_package_status(new.package_id);
      end if;
      if tg_op = 'UPDATE' and old.package_id is not null and old.package_id is distinct from new.package_id then
        perform app.recompute_package_status(old.package_id);
      end if;
      return null;
    end
  $$;
drop trigger work_item_package_status on work_item;
create trigger work_item_package_status after update of submitted_at, package_id, outcome, closed_at, discarded_at on work_item
  for each row when (new.package_id is not null or old.package_id is not null)
  execute function app.package_status_on_item_change();

create trigger work_item_package_status_on_insert after insert on work_item
  for each row when (new.package_id is not null)
  execute function app.package_status_on_item_change();

-- A Revision joins the Package of the item it follows, whoever creates it (app.create_revision).
create function app.revision_joins_package() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      select w.package_id into new.package_id from work_item w where w.id = new.revision_of_id;
      return new;
    end
  $$;
create trigger work_item_revision_joins_package before insert on work_item
  for each row when (new.revision_of_id is not null and new.package_id is null)
  execute function app.revision_joins_package();

-- A replacement joins the Package of the item it replaces: its `replaces` link is written with it,
-- in the same transaction (app.create_replacement). The update recomputes the Package's status.
create function app.replacement_joins_package() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      update work_item r set package_id = s.package_id
      from work_item s
      where r.id = new.from_id and s.id = new.to_id and s.package_id is not null and r.package_id is null;
      return null;
    end
  $$;
create trigger work_item_link_replacement_joins_package after insert on work_item_link
  for each row when (new.kind = 'replaces')
  execute function app.replacement_joins_package();

revoke all on function
  app.recompute_package_status(uuid),
  app.package_status_on_item_change(),
  app.revision_joins_package(),
  app.replacement_joins_package()
  from public;
