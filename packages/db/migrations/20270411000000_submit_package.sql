-- RP-638: Submit Package and the Package's In Progress status (spec RP-616; data-model.md package).
--
-- * Submit Package is a command of the api over the existing engine: for each item of the Package
--   without `submitted_at`, the caller's Submit Transition through app.take_transition, all in one
--   transaction, all or nothing. The database gives it its start (app.begin_package_submit: the
--   Package locked, a replay of the same key) and its record in the Package's trail
--   (app.record_package_submit). Nothing here changes app.take_transition or its helpers.
-- * Status: a Package is Open until any item in it has `submitted_at`, then In Progress. Recomputed
--   in the same transaction as the change, by a trigger on work_item: an item Submitted (whoever
--   takes the Submit, alone or with the Package), or an already-Submitted item added. From then on
--   app.remove_package_item and app.discard_package refuse ('package_not_open'). RP-642 adds Done
--   to app.recompute_package_status.
-- * app.package_hides_unsubmitted: whether the Package holds an item still to Submit that the caller
--   doesn't see. Such an item can't be Submitted by them, so Submit Package is not offered and is
--   refused, without naming it (visibility.md: a Package's list is only the items the viewer sees).

-- The Package's status from its items: In Progress once any item has been Submitted. Never back to
-- Open: an In Progress Package keeps its items. A helper of the trigger below, not for the app role.
create function app.recompute_package_status(p_package_id uuid) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      update package k set status = 'in_progress'
      where k.id = p_package_id and k.status = 'open'
        and exists (select 1 from work_item w where w.package_id = k.id and w.submitted_at is not null);
    end
  $$;

create function app.package_status_on_item_change() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.recompute_package_status(new.package_id);
      return null;
    end
  $$;
create trigger work_item_package_status after update of submitted_at, package_id on work_item
  for each row when (new.package_id is not null and new.submitted_at is not null)
  execute function app.package_status_on_item_change();

-- Whether Package p_package_id, which the acting Member sees, holds an item still to Submit (not
-- Submitted, not closed, not discarded) that they don't see. False when they don't see the Package.
create function app.package_hides_unsubmitted(p_package_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.sees_package(p_package_id) and exists (
        select 1 from work_item w
        where w.package_id = p_package_id and w.submitted_at is null and w.closed_at is null and w.discarded_at is null
          and not app.sees_work_item(w.id)
      );
    end
  $$;

-- The start of a Submit Package by the acting Member with key p_idempotency_key: Package
-- p_package_id locked until the transaction ends. Outcome: 'ready'; 'replayed' with the items that
-- key Submitted before (the same request again applies nothing); 'not_found' (a Package they don't
-- see, whether or not it exists) or 'project_closed'.
create function app.begin_package_submit(p_package_id uuid, p_idempotency_key uuid)
  returns table (outcome text, work_item_ids uuid[])
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_package record;
      v_items jsonb;
    begin
      select * into v_package from app.package_for_write(p_package_id);
      if v_package.id is null then
        return query select 'not_found'::text, null::uuid[];
        return;
      end if;
      select e.payload -> 'work_item_ids' into v_items from package_event e
      where e.package_id = p_package_id and e.type = 'submitted'
        and e.actor_member_id = app.current_member_id()
        and e.payload ->> 'idempotency_key' = p_idempotency_key::text;
      if v_items is not null then
        return query select 'replayed'::text, array(select x::uuid from jsonb_array_elements_text(v_items) x);
        return;
      end if;
      if v_package.project_status <> 'active' then
        return query select 'project_closed'::text, null::uuid[];
        return;
      end if;
      return query select 'ready'::text, null::uuid[];
    end
  $$;

-- The acting Member's Submit Package of items p_work_item_ids, in the Package's trail, once each
-- has been Submitted in this transaction. Outcome: 'recorded', 'not_found' or 'item_not_submitted'
-- (one of them not in the Package, or not Submitted).
create function app.record_package_submit(p_package_id uuid, p_work_item_ids uuid[], p_idempotency_key uuid, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_package record;
    begin
      select * into v_package from app.package_for_write(p_package_id);
      if v_package.id is null then
        return 'not_found';
      end if;
      if cardinality(p_work_item_ids) = 0 or exists (
        select 1 from unnest(p_work_item_ids) i
        where not exists (
          select 1 from work_item w where w.id = i and w.package_id = p_package_id and w.submitted_at is not null
        )
      ) then
        return 'item_not_submitted';
      end if;
      perform app.write_package_event(
        p_package_id, 'submitted', null,
        jsonb_build_object('work_item_ids', to_jsonb(p_work_item_ids), 'idempotency_key', p_idempotency_key),
        greatest(p_now, now()));
      return 'recorded';
    end
  $$;

revoke all on function
  app.recompute_package_status(uuid),
  app.package_status_on_item_change(),
  app.package_hides_unsubmitted(uuid),
  app.begin_package_submit(uuid, uuid),
  app.record_package_submit(uuid, uuid[], uuid, timestamptz)
  from public;
grant execute on function
  app.package_hides_unsubmitted(uuid),
  app.begin_package_submit(uuid, uuid),
  app.record_package_submit(uuid, uuid[], uuid, timestamptz)
  to rabaed_app;
