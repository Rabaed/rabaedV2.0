-- RP-592: the Approved Supplier List (data-model.md §8, visibility.md V10; spec RP-598).
--
-- * A Project's register of suppliers and manufacturers that may be used, per
--   Trade, optionally narrowed to one of that Trade's Scopes or Sub-scopes.
-- * A Project Admin adds one by hand (`source` 'preloaded') or withdraws one; a
--   Supplier Approval Request closed at Code A or B adds its supplier
--   (`source` 'submittal', with `source_work_item_id`; RP-594 writes those).
-- * A withdrawn supplier stays on the items that already chose it, and can't be
--   chosen again (RP-595 enforces that on the MAR); adding it again by hand
--   makes a new entry. Entries are never deleted.
-- * V10: every Project Member of every Participant reads the supplier's name,
--   Trade, Scope and status, never the submittal that approved it. So the app
--   role reads those columns only: not `source`, `source_work_item_id`, nor who
--   added or withdrew it and when (another Company's people and the time a SAR
--   closed, V14 and V1).
-- * Anyone but the Project's Project Admins who tries to change it gets
--   'not_found', exactly like a made-up id (404, never 403).
--
-- rabaed_app writes only through the SECURITY DEFINER functions below, and a
-- Closed Project answers 'project_closed'.

-- Lets a supplier prove its Scope is one of its Trade's.
alter table scope add constraint scope_id_trade_key unique (id, trade_value_id);

create table approved_supplier (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id),
  name jsonb not null check (app.is_bilingual(name)),
  -- A Trade of the Project (app.add_approved_supplier checks it is a Trade, not a Location).
  trade_value_id uuid not null,
  -- Optional: a Scope or Sub-scope of that Trade.
  scope_id uuid,
  source text not null check (source in ('preloaded', 'submittal')),
  -- The SAR that approved it; never granted to the app role (V10).
  source_work_item_id uuid references work_item (id),
  status text not null default 'approved' check (status in ('approved', 'withdrawn')),
  -- Null for one a submittal added.
  added_by_member_id uuid references member (id),
  added_at timestamptz not null default now(),
  withdrawn_by_member_id uuid references member (id),
  withdrawn_at timestamptz,
  constraint approved_supplier_trade_fk foreign key (trade_value_id, project_id) references dimension_value (id, project_id),
  constraint approved_supplier_scope_fk foreign key (scope_id, trade_value_id) references scope (id, trade_value_id),
  check ((source = 'submittal') = (source_work_item_id is not null)),
  check ((source = 'preloaded') = (added_by_member_id is not null)),
  check ((status = 'withdrawn') = (withdrawn_at is not null))
);
create index approved_supplier_project_id_idx on approved_supplier (project_id);
create index approved_supplier_trade_value_id_idx on approved_supplier (trade_value_id);
create index approved_supplier_scope_id_idx on approved_supplier (scope_id);
create index approved_supplier_source_work_item_id_idx on approved_supplier (source_work_item_id);

-- Access for rabaed_app ------------------------------------------------------

alter table approved_supplier enable row level security;
-- Column by column: what every Project Member may read (V10); writes only through the functions below.
revoke all on approved_supplier from rabaed_app;
grant select (id, project_id, name, trade_value_id, scope_id, status) on approved_supplier to rabaed_app;

-- Like the Project's Trades and Scopes: every Project Member of every Participant reads it.
create policy member_reads_project_approved_suppliers on approved_supplier for select to rabaed_app
  using (project_id in (select app.current_project_ids()));

-- Writes -----------------------------------------------------------------------

-- Whether the Trade p_trade_id already lists an approved supplier of that name,
-- in English or Arabic, ignoring case and the spaces around it.
create function app.approved_supplier_listed(p_trade_id uuid, p_name jsonb)
  returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from approved_supplier s
        where s.trade_value_id = p_trade_id and s.status = 'approved'
          and (lower(btrim(s.name ->> 'en')) = lower(btrim(p_name ->> 'en'))
            or lower(btrim(s.name ->> 'ar')) = lower(btrim(p_name ->> 'ar')))
      );
    end
  $$;

-- A Project Admin adds a supplier to the Trade p_trade_id, optionally narrowed to
-- its Scope or Sub-scope p_scope_id. Outcome: 'added' (with the supplier),
-- 'not_found' (not a Project the acting Member is a Project Admin of, whether or
-- not it exists), 'project_closed', 'trade_not_found' (not a Trade of this
-- Project), 'scope_not_found' (not an active Scope of that Trade) or
-- 'supplier_exists' (the Trade already lists it, approved).
create function app.add_approved_supplier(p_project_id uuid, p_trade_id uuid, p_scope_id uuid, p_name jsonb, p_now timestamptz)
  returns table (outcome text, supplier_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_supplier_id uuid;
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if not exists (
        select 1 from dimension_value v join visibility_dimension d on d.id = v.dimension_id
        where v.id = p_trade_id and v.project_id = p_project_id and d.kind = 'trade'
      ) then
        return query select 'trade_not_found'::text, null::uuid;
        return;
      end if;
      if p_scope_id is not null and not exists (
        select 1 from scope s where s.id = p_scope_id and s.trade_value_id = p_trade_id and s.status = 'active'
      ) then
        return query select 'scope_not_found'::text, null::uuid;
        return;
      end if;
      -- The check and the insert below, one Trade at a time.
      perform pg_advisory_xact_lock(hashtextextended('approved_supplier/' || p_trade_id::text, 0));
      if app.approved_supplier_listed(p_trade_id, p_name) then
        return query select 'supplier_exists'::text, null::uuid;
        return;
      end if;

      insert into approved_supplier (project_id, name, trade_value_id, scope_id, source, added_by_member_id, added_at)
      values (
        p_project_id,
        jsonb_build_object('en', btrim(p_name ->> 'en'), 'ar', btrim(p_name ->> 'ar')),
        p_trade_id, p_scope_id, 'preloaded', app.current_member_id(), greatest(p_now, now())
      )
      returning id into v_supplier_id;
      return query select 'added'::text, v_supplier_id;
    end
  $$;

-- A Project Admin withdraws a supplier: it stays listed, withdrawn. Outcome:
-- 'withdrawn' (also when it already was), 'not_found' (not a supplier of a
-- Project the acting Member is a Project Admin of, whether or not it exists) or
-- 'project_closed'.
create function app.withdraw_approved_supplier(p_supplier_id uuid, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_project_id uuid;
    begin
      select project_id into v_project_id from approved_supplier
      where id = p_supplier_id and project_id in (select app.current_admin_project_ids())
      for update;
      if v_project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      update approved_supplier set
        status = 'withdrawn',
        withdrawn_by_member_id = app.current_member_id(),
        withdrawn_at = greatest(p_now, now())
      where id = p_supplier_id and status = 'approved';
      return 'withdrawn';
    end
  $$;

revoke all on function
  app.approved_supplier_listed(uuid, jsonb),
  app.add_approved_supplier(uuid, uuid, uuid, jsonb, timestamptz),
  app.withdraw_approved_supplier(uuid, timestamptz)
  from public;
-- app.approved_supplier_listed is a helper of the writes (and of RP-594's), not for the app role.
grant execute on function
  app.add_approved_supplier(uuid, uuid, uuid, jsonb, timestamptz),
  app.withdraw_approved_supplier(uuid, timestamptz)
  to rabaed_app;
