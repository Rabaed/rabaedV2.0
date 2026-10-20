-- RP-976 (epic review RP-680 of spec RP-616): two Package rules written once each.
--
-- * "The latest Revision of each chain": app.latest_revisions(items), of the given items not
--   discarded, the latest Revision of each chain (`root_id`, highest `revision_no`) leaving out
--   cancelled ones; a chain of only cancelled ones gives its latest, `counted` false. Both readers
--   pass their own items: app.package_latest_items those the caller sees (per viewer, as before),
--   app.recompute_package_status every item in the Package (never per viewer, as before). Done now
--   reads the Package's own items, as its counts do; a Revision joins its item's Package by itself
--   (app.revision_joins_package), so a chain's latest is in the Package.
-- * "Still to Submit": app.package_unsubmitted(package), every item in the Package not Submitted,
--   not closed, not discarded. app.package_hides_unsubmitted asks it for one the caller doesn't
--   see; app.package_items_to_submit gives the api those the caller sees (Submit Package and its
--   readiness), so the api no longer writes the rule again.
--
-- app.latest_revisions and app.package_unsubmitted are not granted to the app role: they read
-- items whatever the caller sees.

create function app.latest_revisions(p_items uuid[]) returns table (work_item_id uuid, counted boolean)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select distinct on (w.root_id) w.id, w.outcome is distinct from 'cancelled'
        from work_item w
        where w.id = any (p_items) and w.discarded_at is null
        order by w.root_id, (w.outcome is distinct from 'cancelled') desc, w.revision_no desc;
    end
  $$;

create or replace function app.package_latest_items(p_package_id uuid) returns table (work_item_id uuid, counted boolean)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query select l.work_item_id, l.counted from app.latest_revisions(array(select app.package_items(p_package_id))) l;
    end
  $$;

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
      with latest as (
        select w.* from app.latest_revisions(array(select w.id from work_item w where w.package_id = p_package_id)) l
        join work_item w on w.id = l.work_item_id
        where l.counted
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

create function app.package_unsubmitted(p_package_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select w.id from work_item w
        where w.package_id = p_package_id and w.submitted_at is null and w.closed_at is null and w.discarded_at is null;
    end
  $$;

create or replace function app.package_hides_unsubmitted(p_package_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.owns_package(p_package_id) and exists (
        select 1 from app.package_unsubmitted(p_package_id) u where not app.sees_work_item(u)
      );
    end
  $$;

-- The items of Package p_package_id still to Submit that the acting Member sees (app.package_items).
create function app.package_items_to_submit(p_package_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select u from app.package_unsubmitted(p_package_id) u
        where u in (select app.package_items(p_package_id));
    end
  $$;

revoke all on function
  app.latest_revisions(uuid[]),
  app.package_unsubmitted(uuid),
  app.package_items_to_submit(uuid)
  from public;
grant execute on function app.package_items_to_submit(uuid) to rabaed_app;
