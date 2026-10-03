-- Scopes and Sub-scopes (data-model.md §3; RP-263).
--
-- * A Project Admin defines Scopes under each Trade of the Project, and
--   Sub-scopes under each Scope, with English and Arabic names. They can be
--   renamed and deactivated (and reactivated), never deleted: a deactivated one
--   stays on the Work Items that already use it.
-- * Scopes are not a Visibility Dimension: they never grant or restrict access.
-- * Every Project Member reads the Project's Scopes. An Authorized Person who
--   isn't a Project Member reads only those of the Trades their Participant
--   covers, through app.participant_scopes (the line V16 draws for Trades).
-- * Anyone but the Project's Project Admins who tries to change them gets
--   'not_found', exactly like a made-up id, whether or not they are on the
--   Project (404, never 403).
--
-- As before, rabaed_app writes only through the SECURITY DEFINER functions below,
-- and a Closed Project answers 'project_closed'.
--
-- Deferred: codes, Rabaed default Scopes and the Company lists with "pull
-- updates" (owner_kind / owner_id, copied_from_id; Form engine part 5).

-- Lets a Scope prove its Trade is a value of its own Project.
alter table dimension_value add constraint dimension_value_id_project_key unique (id, project_id);

create table scope (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null,
  -- A Trade of the Project (app.add_scope checks it is a Trade, not a Location).
  trade_value_id uuid not null,
  -- Null for a Scope; its Scope for a Sub-scope.
  parent_id uuid,
  -- 1 Scope, 2 Sub-scope.
  depth smallint not null check (depth between 1 and 2),
  -- The depth its parent must have, so a Sub-scope is never under a Sub-scope.
  parent_depth smallint generated always as (depth - 1) stored,
  name jsonb not null check (app.is_bilingual(name)),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scope_trade_fk foreign key (trade_value_id, project_id) references dimension_value (id, project_id),
  constraint scope_id_trade_depth_key unique (id, trade_value_id, depth),
  -- A Sub-scope is under a Scope, in that Scope's Trade.
  constraint scope_parent_fk foreign key (parent_id, trade_value_id, parent_depth)
    references scope (id, trade_value_id, depth),
  check ((parent_id is null) = (depth = 1))
);
create index scope_project_id_idx on scope (project_id);
create index scope_trade_value_id_idx on scope (trade_value_id);
create index scope_parent_id_idx on scope (parent_id);

-- Access for rabaed_app ------------------------------------------------------

alter table scope enable row level security;
revoke insert, update, delete on scope from rabaed_app;

-- Like Trades and Locations, the Project's structure: every Project Member sees them.
create policy member_reads_project_scopes on scope for select to rabaed_app
  using (project_id in (select app.current_project_ids()));

-- The Scopes and Sub-scopes of the Trades a Participant covers, for the same
-- people as app.participant_covered_values: its own Company (its Authorized
-- Person even before they are a Project Member) and the Project's Project
-- Admins; no rows otherwise.
create function app.participant_scopes(p_participant_id uuid)
  returns table (id uuid, trade_value_id uuid, parent_id uuid, depth smallint, name jsonb, status text)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select s.id, s.trade_value_id, s.parent_id, s.depth, s.name, s.status
    from participant p
    join visibility_dimension d on d.project_id = p.project_id and d.kind = 'trade'
    cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
    join scope s on s.trade_value_id = c.id
    join dimension_value t on t.id = s.trade_value_id
    left join scope parent on parent.id = s.parent_id
    where p.id = p_participant_id and p.status = 'active'
      and (p.id in (select app.current_participant_ids()) or p.project_id in (select app.current_admin_project_ids()))
    -- As the Project's list (apps/api listScopes): by Trade, each Scope followed by its Sub-scopes.
    order by t.sort, t.id, coalesce(parent.sort, s.sort), coalesce(s.parent_id, s.id), s.depth, s.sort
  $$;

-- Writes -----------------------------------------------------------------------

-- A Project Admin adds a Scope under the Trade p_trade_id, or a Sub-scope under
-- the Scope p_parent_id (in that Trade). Outcome: 'added' (with the Scope),
-- 'not_found' (not a Project the acting Member is a Project Admin of, whether
-- or not it exists), 'project_closed', 'trade_not_found' (not a Trade of this
-- Project) or 'parent_not_found' (not an active Scope of that Trade; Sub-scopes
-- have none beneath them).
create function app.add_scope(p_project_id uuid, p_trade_id uuid, p_parent_id uuid, p_name jsonb)
  returns table (outcome text, scope_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_scope_id uuid;
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
      if p_parent_id is not null and not exists (
        select 1 from scope s
        where s.id = p_parent_id and s.trade_value_id = p_trade_id and s.depth = 1 and s.status = 'active'
      ) then
        return query select 'parent_not_found'::text, null::uuid;
        return;
      end if;

      insert into scope (project_id, trade_value_id, parent_id, depth, name, sort)
      select p_project_id, p_trade_id, p_parent_id, case when p_parent_id is null then 1 else 2 end, p_name,
        coalesce((
          select max(s.sort) from scope s
          where s.trade_value_id = p_trade_id and s.parent_id is not distinct from p_parent_id
        ), 0) + 1
      returning id into v_scope_id;
      return query select 'added'::text, v_scope_id;
    end
  $$;

-- A Project Admin renames a Scope or Sub-scope (p_name), deactivates or
-- reactivates it (p_active), or both; null leaves that part as it is.
-- Deactivating a Scope leaves its Sub-scopes as they are. Outcome: 'updated',
-- 'not_found' (not a Scope of a Project the acting Member is a Project Admin
-- of, whether or not it exists), 'project_closed' or 'parent_deactivated'
-- (reactivating a Sub-scope whose Scope is deactivated: reactivate the Scope first).
create function app.update_scope(p_scope_id uuid, p_name jsonb, p_active boolean, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_project_id uuid;
    begin
      select project_id into v_project_id from scope
      where id = p_scope_id and project_id in (select app.current_admin_project_ids())
      for update;
      if v_project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if p_active and exists (
        select 1 from scope s join scope parent on parent.id = s.parent_id
        where s.id = p_scope_id and parent.status = 'deactivated'
      ) then
        return 'parent_deactivated';
      end if;
      update scope set
        name = coalesce(p_name, name),
        status = case when p_active is null then status when p_active then 'active' else 'deactivated' end,
        updated_at = greatest(p_now, now())
      where id = p_scope_id;
      return 'updated';
    end
  $$;

revoke all on function
  app.participant_scopes(uuid),
  app.add_scope(uuid, uuid, uuid, jsonb),
  app.update_scope(uuid, jsonb, boolean, timestamptz)
  from public;
grant execute on function
  app.participant_scopes(uuid),
  app.add_scope(uuid, uuid, uuid, jsonb),
  app.update_scope(uuid, jsonb, boolean, timestamptz)
  to rabaed_app;
