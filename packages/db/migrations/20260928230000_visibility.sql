-- Trades, Locations and Visibility grants (data-model.md §3; RP-191).
--
-- * Every Project gets two Visibility Dimensions when it is created: trade (a
--   flat list) and location (a Zone → Building → Floor tree, three levels).
-- * A Project Admin adds their values, and grants each Participant Visibility:
--   per dimension, either "all" or a list of values. Granting a Location covers
--   its whole subtree, including Locations added under it later.
-- * A Participant's Authorized Person narrows it for each of its Project Members.
--   A Member's "all" means all of their Participant's. A Member never covers more
--   than their Participant (visibility.md V4): a wider grant is rejected, and
--   narrowing a Participant narrows its Members' grants to match.
-- * Nothing is covered until it is granted.
-- * A Participant's grant is seen by its own Company and the Project's Project
--   Admins; a Member's grant only by the Participant's own Company (V14).
--
-- As before, rabaed_app writes only through the SECURITY DEFINER functions below,
-- and a Closed Project answers 'project_closed'.
--
-- Deferred: the Rabaed default Trade list (copied_from_id), custom dimensions,
-- required_on_work_items for custom ones, and the Visibility Gap warning.

create table visibility_dimension (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null references project (id),
  kind text not null check (kind in ('trade', 'location', 'custom')),
  name jsonb not null check (app.is_bilingual(name)),
  required_on_work_items boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visibility_dimension_id_project_key unique (id, project_id)
);
create unique index visibility_dimension_project_kind_key on visibility_dimension (project_id, kind)
  where kind <> 'custom';

create table dimension_value (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null,
  dimension_id uuid not null,
  -- Location tree only; Trades are flat.
  parent_id uuid,
  depth smallint not null check (depth between 1 and 3),
  -- "Zone", "Building", "Floor" for Locations; null for Trades.
  level_name jsonb check (level_name is null or app.is_bilingual(level_name)),
  -- Used in Document Numbers.
  code text not null check (code ~ '^[A-Z0-9]{2,6}$'),
  name jsonb not null check (app.is_bilingual(name)),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dimension_value_dimension_fk
    foreign key (dimension_id, project_id) references visibility_dimension (id, project_id),
  constraint dimension_value_id_dimension_key unique (id, dimension_id),
  -- A parent is in the same dimension.
  constraint dimension_value_parent_fk foreign key (parent_id, dimension_id) references dimension_value (id, dimension_id),
  -- Codes are unique among siblings: every Building can have its own "F1".
  constraint dimension_value_sibling_code_key unique nulls not distinct (dimension_id, parent_id, code),
  check ((parent_id is null) = (depth = 1))
);
create index dimension_value_parent_id_idx on dimension_value (parent_id);

-- Lets a Visibility grant prove its Project Member belongs to its Participant.
alter table project_member add constraint project_member_id_participant_key unique (id, participant_id);

create table visibility_grant (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null,
  subject_kind text not null check (subject_kind in ('participant', 'project_member')),
  -- The Participant, for a Project Member's grant too: the grant it must stay within.
  participant_id uuid not null,
  project_member_id uuid,
  dimension_id uuid not null,
  is_all boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((subject_kind = 'project_member') = (project_member_id is not null)),
  constraint visibility_grant_participant_fk
    foreign key (participant_id, project_id) references participant (id, project_id),
  constraint visibility_grant_project_member_fk
    foreign key (project_member_id, participant_id) references project_member (id, participant_id),
  constraint visibility_grant_dimension_fk
    foreign key (dimension_id, project_id) references visibility_dimension (id, project_id),
  constraint visibility_grant_subject_dimension_key unique nulls not distinct (participant_id, project_member_id, dimension_id),
  constraint visibility_grant_id_dimension_project_key unique (id, dimension_id, project_id)
);

create table visibility_grant_value (
  grant_id uuid not null,
  project_id uuid not null,
  dimension_id uuid not null,
  dimension_value_id uuid not null,
  primary key (grant_id, dimension_value_id),
  constraint visibility_grant_value_grant_fk
    foreign key (grant_id, dimension_id, project_id) references visibility_grant (id, dimension_id, project_id)
    on delete cascade,
  constraint visibility_grant_value_value_fk
    foreign key (dimension_value_id, dimension_id) references dimension_value (id, dimension_id)
);

-- Every Project gets its trade and location dimensions when it is created ---------

create function app.create_project_dimensions() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into visibility_dimension (project_id, kind, name, required_on_work_items) values
        (new.id, 'trade', '{"en": "Trade", "ar": "التخصص"}', true),
        (new.id, 'location', '{"en": "Location", "ar": "الموقع"}', false);
      return new;
    end
  $$;
create trigger project_dimensions after insert on project
  for each row execute function app.create_project_dimensions();

-- Projects created before this migration.
insert into visibility_dimension (project_id, kind, name, required_on_work_items)
select p.id, d.kind, d.name::jsonb, d.required
from project p
cross join (values
  ('trade', '{"en": "Trade", "ar": "التخصص"}', true),
  ('location', '{"en": "Location", "ar": "الموقع"}', false)
) as d (kind, name, required);

-- Access for rabaed_app ------------------------------------------------------

alter table visibility_dimension enable row level security;
alter table dimension_value enable row level security;
alter table visibility_grant enable row level security;
alter table visibility_grant_value enable row level security;
revoke insert, update, delete on visibility_dimension, dimension_value, visibility_grant, visibility_grant_value
  from rabaed_app;

-- The Projects the acting Member is a Project Admin of (and still a Project Member of).
create function app.current_admin_project_ids() returns setof uuid
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select pa.project_id from project_admin pa
    where pa.member_id = app.current_member_id()
      and pa.project_id in (select app.current_project_ids())
  $$;

-- Trades and Locations are the Project's structure: every Project Member sees them.
create policy member_reads_project_dimensions on visibility_dimension for select to rabaed_app
  using (project_id in (select app.current_project_ids()));
create policy member_reads_project_dimension_values on dimension_value for select to rabaed_app
  using (project_id in (select app.current_project_ids()));

-- A grant: its Participant's own Company (see app.current_participant_ids), and,
-- for a Participant's grant only, the Project's Project Admins.
create policy member_reads_visibility_grants on visibility_grant for select to rabaed_app
  using (
    participant_id in (select app.current_participant_ids())
    or (project_member_id is null and project_id in (select app.current_admin_project_ids()))
  );
-- Its values by the same rule: the subquery is itself filtered by the policy above.
create policy member_reads_visibility_grant_values on visibility_grant_value for select to rabaed_app
  using (grant_id in (select id from visibility_grant));

-- What a grant covers -------------------------------------------------------------------

-- The values a grant covers: all of its dimension's when is_all, otherwise the
-- granted values and everything beneath them.
create function app.values_covered_by_grant(p_grant_id uuid) returns setof uuid
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    with recursive g as (
      select id, dimension_id, is_all from visibility_grant where id = p_grant_id
    ), covered (id) as (
      select v.id from dimension_value v join g on v.dimension_id = g.dimension_id where g.is_all
      union
      select gv.dimension_value_id from visibility_grant_value gv join g on gv.grant_id = g.id where not g.is_all
      union
      select v.id from dimension_value v join covered c on v.parent_id = c.id
    )
    select id from covered
  $$;

-- What a Participant covers in one dimension; nothing without a grant.
create function app.values_covered_by_participant(p_participant_id uuid, p_dimension_id uuid) returns setof uuid
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select c.id from visibility_grant g cross join lateral app.values_covered_by_grant(g.id) as c (id)
    where g.participant_id = p_participant_id and g.project_member_id is null and g.dimension_id = p_dimension_id
  $$;

-- What a Project Member covers in one dimension: their own grant, within their
-- Participant's (V4). Nothing without a grant.
create function app.values_covered_by_project_member(p_project_member_id uuid, p_dimension_id uuid) returns setof uuid
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select c.id from visibility_grant g cross join lateral app.values_covered_by_grant(g.id) as c (id)
    where g.project_member_id = p_project_member_id and g.dimension_id = p_dimension_id
    intersect
    select c.id from project_member pm cross join lateral app.values_covered_by_participant(pm.participant_id, p_dimension_id) as c (id)
    where pm.id = p_project_member_id
  $$;

-- The acting Member's own Visibility on one of their Projects: every value they
-- cover, per dimension. What later tickets check Work Items against (layer 4).
create function app.my_visibility(p_project_id uuid) returns table (kind text, value_id uuid)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select d.kind, c.id
    from project_member pm
    join visibility_dimension d on d.project_id = pm.project_id
    cross join lateral app.values_covered_by_project_member(pm.id, d.id) as c (id)
    where pm.project_id = p_project_id and pm.member_id = app.current_member_id() and pm.status = 'active'
      and p_project_id in (select app.current_project_ids())
  $$;

-- Reads for the Visibility screens ----------------------------------------------

-- A Participant's grant per dimension (is_all false and no values when there is
-- none), for its own Company and the Project's Project Admins; no rows otherwise.
create function app.participant_grants(p_participant_id uuid)
  returns table (kind text, is_all boolean, value_ids uuid[])
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select d.kind, coalesce(g.is_all, false),
      array(select gv.dimension_value_id from visibility_grant_value gv where gv.grant_id = g.id order by 1)
    from participant p
    join visibility_dimension d on d.project_id = p.project_id
    left join visibility_grant g on g.participant_id = p.id and g.project_member_id is null and g.dimension_id = d.id
    where p.id = p_participant_id and p.status = 'active'
      and (p.id in (select app.current_participant_ids()) or p.project_id in (select app.current_admin_project_ids()))
    order by d.kind
  $$;

-- The values a Participant covers, with what the screens show of them, for the
-- same people as app.participant_grants. Its Authorized Person needs these to
-- narrow its Members' Visibility even before they are on the Project (V15).
create function app.participant_covered_values(p_participant_id uuid)
  returns table (kind text, id uuid, parent_id uuid, depth smallint, code text, name jsonb, level_name jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select d.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name
    from participant p
    join visibility_dimension d on d.project_id = p.project_id
    cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
    join dimension_value v on v.id = c.id
    where p.id = p_participant_id and p.status = 'active'
      and (p.id in (select app.current_participant_ids()) or p.project_id in (select app.current_admin_project_ids()))
    order by d.kind, v.depth, v.sort, v.id
  $$;

-- A Project Member's grant per dimension, for their Participant's own Company
-- only; no rows otherwise (or when they are not on the Project through it).
create function app.member_grants(p_participant_id uuid, p_member_id uuid)
  returns table (kind text, is_all boolean, value_ids uuid[])
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select d.kind, coalesce(g.is_all, false),
      array(select gv.dimension_value_id from visibility_grant_value gv where gv.grant_id = g.id order by 1)
    from project_member pm
    join visibility_dimension d on d.project_id = pm.project_id
    left join visibility_grant g on g.project_member_id = pm.id and g.dimension_id = d.id
    where pm.participant_id = p_participant_id and pm.member_id = p_member_id and pm.status = 'active'
      and p_participant_id in (select app.current_participant_ids())
    order by d.kind
  $$;

-- Writes -----------------------------------------------------------------------

-- The Project's trade or location dimension; any other kind is a bug in the caller (22023).
create function app.project_dimension_id(p_project_id uuid, p_kind text) returns uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_id uuid;
    begin
      select id into v_id from visibility_dimension
      where project_id = p_project_id and kind = p_kind and kind in ('trade', 'location');
      if v_id is null then
        raise exception 'unknown dimension %', p_kind using errcode = '22023';
      end if;
      return v_id;
    end
  $$;

-- A Project Admin adds a Trade, or a Location under p_parent_id (null: a Zone).
-- Outcome: 'added' (with the value), 'not_found' (not one of the acting Member's
-- Projects), 'project_closed', 'parent_not_found' (not a Location of this
-- Project; Trades have no parent), 'too_deep' (below a Floor) or
-- 'duplicate_code' (a sibling has the code). A Project Member who is not a
-- Project Admin is refused (42501).
create function app.add_dimension_value(p_project_id uuid, p_kind text, p_parent_id uuid, p_code text, p_name jsonb)
  returns table (outcome text, value_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_dimension_id uuid;
      v_depth smallint := 1;
      v_value_id uuid;
    begin
      if not exists (select 1 from app.current_project_ids() x where x = p_project_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        raise exception 'only a Project Admin can change Trades and Locations' using errcode = '42501';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      v_dimension_id := app.project_dimension_id(p_project_id, p_kind);

      if p_parent_id is not null then
        select v.depth + 1 into v_depth from dimension_value v
        where v.id = p_parent_id and v.dimension_id = v_dimension_id and p_kind = 'location';
        if not found then
          return query select 'parent_not_found'::text, null::uuid;
          return;
        end if;
        if v_depth > 3 then
          return query select 'too_deep'::text, null::uuid;
          return;
        end if;
      end if;

      insert into dimension_value (project_id, dimension_id, parent_id, depth, level_name, code, name, sort)
      select p_project_id, v_dimension_id, p_parent_id, v_depth,
        case when p_kind = 'location' then
          (array[
            '{"en": "Zone", "ar": "المنطقة"}',
            '{"en": "Building", "ar": "المبنى"}',
            '{"en": "Floor", "ar": "الطابق"}'
          ])[v_depth]::jsonb
        end,
        p_code, p_name,
        coalesce((
          select max(s.sort) from dimension_value s
          where s.dimension_id = v_dimension_id and s.parent_id is not distinct from p_parent_id
        ), 0) + 1
      on conflict on constraint dimension_value_sibling_code_key do nothing
      returning id into v_value_id;
      if v_value_id is null then
        return query select 'duplicate_code'::text, null::uuid;
        return;
      end if;
      return query select 'added'::text, v_value_id;
    end
  $$;

-- Replaces a grant's values with p_value_ids (none when p_is_all).
create function app.replace_grant_values(p_grant_id uuid, p_value_ids uuid[]) returns void
  language sql volatile security definer
  set search_path = pg_catalog, public
  as $$
    delete from visibility_grant_value where grant_id = p_grant_id;
    insert into visibility_grant_value (grant_id, project_id, dimension_id, dimension_value_id)
    select g.id, g.project_id, g.dimension_id, v.id
    from visibility_grant g cross join (select distinct unnest(p_value_ids) as id) v
    where g.id = p_grant_id and not g.is_all;
  $$;

-- A Project Admin sets a Participant's Visibility in one dimension: all of it,
-- or p_value_ids. Its Members' grants shrink to what it still covers (V4).
-- Outcome: 'set', 'not_found' (not a Participant of one of the acting Member's
-- Projects), 'project_closed' or 'value_not_found' (not a value of that
-- dimension). A Project Member who is not a Project Admin is refused (42501).
create function app.set_participant_visibility(
  p_participant_id uuid, p_kind text, p_is_all boolean, p_value_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_values uuid[] := case when p_is_all then '{}' else coalesce(p_value_ids, '{}') end;
      v_project_id uuid;
      v_dimension_id uuid;
      v_grant_id uuid;
      v_member_grant record;
    begin
      -- Locked, so a Member's grant is never checked against a Participant grant
      -- that is changing at the same time (see app.set_member_visibility).
      select project_id into v_project_id from participant
      where id = p_participant_id and status = 'active' and project_id in (select app.current_project_ids())
      for update;
      if v_project_id is null then
        return 'not_found';
      end if;
      if not exists (select 1 from app.current_admin_project_ids() x where x = v_project_id) then
        raise exception 'only a Project Admin can set a Participant''s Visibility' using errcode = '42501';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      v_dimension_id := app.project_dimension_id(v_project_id, p_kind);
      if exists (select unnest(v_values) except select id from dimension_value where dimension_id = v_dimension_id) then
        return 'value_not_found';
      end if;

      insert into visibility_grant as g (project_id, subject_kind, participant_id, dimension_id, is_all)
      values (v_project_id, 'participant', p_participant_id, v_dimension_id, p_is_all)
      on conflict on constraint visibility_grant_subject_dimension_key
        do update set is_all = excluded.is_all, updated_at = v_at
      returning g.id into v_grant_id;
      perform app.replace_grant_values(v_grant_id, v_values);

      -- Each Member's grant becomes its intersection with what the Participant now covers, stored
      -- as the topmost values, so widening the Participant again doesn't widen them.
      -- A Member's "all" already means all of the Participant's.
      for v_member_grant in
        select id from visibility_grant
        where participant_id = p_participant_id and project_member_id is not null
          and dimension_id = v_dimension_id and not is_all
      loop
        perform app.replace_grant_values(v_member_grant.id, array(
          with kept as (
            select app.values_covered_by_grant(v_member_grant.id) as id
            intersect
            select app.values_covered_by_participant(p_participant_id, v_dimension_id)
          )
          select v.id from kept k join dimension_value v on v.id = k.id
          where v.parent_id is null or v.parent_id not in (select id from kept)
        ));
        update visibility_grant set updated_at = v_at where id = v_member_grant.id;
      end loop;
      return 'set';
    end
  $$;

-- The Participant's Authorized Person sets a Project Member's Visibility in one
-- dimension: all of the Participant's, or p_value_ids within it. Outcome: 'set',
-- 'not_found' (not one of their Company's Participants), 'project_closed',
-- 'member_not_found' (not on the Project through it), 'value_not_found' or
-- 'exceeds_participant' (a value the Participant doesn't cover, V4). Anyone but
-- an Authorized Person is refused (42501).
create function app.set_member_visibility(
  p_participant_id uuid, p_member_id uuid, p_kind text, p_is_all boolean, p_value_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_at timestamptz := greatest(p_now, now());
      v_values uuid[] := case when p_is_all then '{}' else coalesce(p_value_ids, '{}') end;
      v_project_id uuid;
      v_project_member_id uuid;
      v_dimension_id uuid;
      v_grant_id uuid;
    begin
      -- Locked, so the Participant's grant can't narrow between the check below and the write.
      select project_id into v_project_id from participant
      where id = p_participant_id and company_id = v_company_id and status = 'active'
      for update;
      if v_project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      select id into v_project_member_id from project_member
      where participant_id = p_participant_id and member_id = p_member_id and status = 'active';
      if v_project_member_id is null then
        return 'member_not_found';
      end if;
      v_dimension_id := app.project_dimension_id(v_project_id, p_kind);
      if exists (select unnest(v_values) except select id from dimension_value where dimension_id = v_dimension_id) then
        return 'value_not_found';
      end if;
      if exists (select unnest(v_values) except select app.values_covered_by_participant(p_participant_id, v_dimension_id)) then
        return 'exceeds_participant';
      end if;

      insert into visibility_grant as g
        (project_id, subject_kind, participant_id, project_member_id, dimension_id, is_all)
      values (v_project_id, 'project_member', p_participant_id, v_project_member_id, v_dimension_id, p_is_all)
      on conflict on constraint visibility_grant_subject_dimension_key
        do update set is_all = excluded.is_all, updated_at = v_at
      returning g.id into v_grant_id;
      perform app.replace_grant_values(v_grant_id, v_values);
      return 'set';
    end
  $$;

-- Internal helpers stay out of rabaed_app's reach; it calls only the entry points.
revoke all on function
  app.create_project_dimensions(),
  app.current_admin_project_ids(),
  app.project_dimension_id(uuid, text),
  app.values_covered_by_grant(uuid),
  app.values_covered_by_participant(uuid, uuid),
  app.values_covered_by_project_member(uuid, uuid),
  app.replace_grant_values(uuid, uuid[]),
  app.my_visibility(uuid),
  app.participant_grants(uuid),
  app.participant_covered_values(uuid),
  app.member_grants(uuid, uuid),
  app.add_dimension_value(uuid, text, uuid, text, jsonb),
  app.set_participant_visibility(uuid, text, boolean, uuid[], timestamptz),
  app.set_member_visibility(uuid, uuid, text, boolean, uuid[], timestamptz)
  from public;
grant execute on function
  app.current_admin_project_ids(),
  app.my_visibility(uuid),
  app.participant_grants(uuid),
  app.participant_covered_values(uuid),
  app.member_grants(uuid, uuid),
  app.add_dimension_value(uuid, text, uuid, text, jsonb),
  app.set_participant_visibility(uuid, text, boolean, uuid[], timestamptz),
  app.set_member_visibility(uuid, uuid, text, boolean, uuid[], timestamptz)
  to rabaed_app;
