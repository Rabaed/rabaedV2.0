-- RP-973: package write lock order. An Open Package's own writes now take the one lock order
-- (data-model.md "Lock order"): the item(s) first, then the Package.
--
-- * Before, app.add_package_item, app.remove_package_item and app.discard_package locked the
--   Package first (app.package_for_write), then the item. A single Submit locks the item, then
--   the Package (the status trigger, app.recompute_package_status), and Submit Package locks its
--   items, then the Package, so removing an item or deleting the Package while that item was
--   being Submitted could deadlock (40P01).
-- * Each now calls app.lock_work_items first: the one item, or every item in the Package. An item
--   added to the Package after that read waits on the Package's lock held here, so it is never
--   locked in the other order.
-- * Each body is otherwise unchanged from 20270812000000_open_package.sql.

create or replace function app.add_package_item(p_package_id uuid, p_work_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_package record;
      v_item record;
    begin
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

create or replace function app.discard_package(p_package_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_package record;
    begin
      perform app.lock_work_items(array(select w.id from work_item w where w.package_id = p_package_id));
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
