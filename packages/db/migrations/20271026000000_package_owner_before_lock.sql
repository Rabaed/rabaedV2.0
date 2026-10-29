-- RP-1075: a Package's writes check its owner before any lock (epic review RP-680, spec RP-616).
--
-- * app.add_package_item and app.remove_package_item locked the item (app.lock_work_items)
--   before app.package_for_write, the ownership check. K1, who sees C1's Submitted item, could
--   call either on C1's Package and hold a lock on C1's item until its transaction ended, then
--   get 'not_found'. Each now checks app.owns_package first, as app.discard_package does
--   (20271004000000_discard_package_locks_unseen_items.sql), and returns the same 'not_found'.
--   The owner still locks the item, then the Package (RP-973's order).
-- * app.package_items_to_submit answers the owner only, the guard app.package_hides_unsubmitted
--   has. Today it was safe only because another Company never sees an item not yet Submitted.
-- * Each body is otherwise unchanged from 20271003000000_package_write_lock_order.sql and
--   20271009000000_package_one_definition.sql. The grants stay as they are.

create or replace function app.add_package_item(p_package_id uuid, p_work_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_package record;
      v_item record;
    begin
      if not app.owns_package(p_package_id) then
        return 'not_found';
      end if;
      perform app.lock_work_items(array[p_work_item_id]);
      select * into v_package from app.package_for_write(p_package_id);
      if v_package.id is null then
        return 'not_found';
      end if;
      if v_package.project_status <> 'active' then
        return 'project_closed';
      end if;
      if not app.sees_work_item(p_work_item_id) then
        return 'item_not_offered';
      end if;
      select w.id, w.package_id, w.document_number into v_item
      from work_item w join work_item_type t on t.id = w.work_item_type_id
      where w.id = p_work_item_id and w.project_id = v_package.project_id
        and w.raised_by_participant_id = v_package.participant_id
        and t.module_key = 'submittals' and w.discarded_at is null
      for update of w;
      if v_item.id is null then
        return 'item_not_offered';
      end if;
      if v_item.package_id = p_package_id then
        return 'added';
      end if;
      if v_item.package_id is not null then
        return 'in_another_package';
      end if;
      -- A Draft: never sent, no Document Number (GLOSSARY.md Draft).
      if v_item.document_number is null and not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;
      update work_item set package_id = p_package_id where id = p_work_item_id;
      perform app.write_package_event(p_package_id, 'item_added', p_work_item_id, '{}', v_at);
      return 'added';
    end
  $$;

create or replace function app.remove_package_item(p_package_id uuid, p_work_item_id uuid, p_now timestamptz) returns text
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
      perform app.lock_work_items(array[p_work_item_id]);
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
      if not app.sees_work_item(p_work_item_id)
        or not exists (select 1 from work_item where id = p_work_item_id and package_id = p_package_id) then
        return 'item_not_in_package';
      end if;
      update work_item set package_id = null where id = p_work_item_id;
      perform app.write_package_event(p_package_id, 'item_removed', p_work_item_id, '{}', v_at);
      return 'removed';
    end
  $$;

-- The items of Package p_package_id still to Submit that the acting Member sees (app.package_items),
-- for the Package's owner only.
create or replace function app.package_items_to_submit(p_package_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.owns_package(p_package_id) then
        return;
      end if;
      return query
        select u from app.package_unsubmitted(p_package_id) u
        where u in (select app.package_items(p_package_id));
    end
  $$;
