-- RP-1304: a "Whole Project" Location, for items that apply to the whole Project (UAT round 0, SUB-01; owner's
-- decisions of 2026-11-13 and 2026-11-14 on the ticket, comment 15861). Scenarios RP-1304-1 to RP-1304-7.
--
-- * dimension_value.whole_project: one Location of each Project, at the top level beside the Zones, sorted first
--   (sort 0; a Zone's starts at 1), with code WP and the names "Whole Project" / "المشروع كامل". It is an ordinary
--   Location to every reader, so an item's Location stays one dimension_value and every read of it works as before.
--   It carries the top level's name ("Zone"), so the List's Zone filter and column hold it beside the Zones.
--   Every Project gets one when it is created (app.create_project_dimensions); the Projects that exist get theirs here.
-- * Any Location covers it (comment 15861): a grant of all of the dimension, or of any Location, covers the Whole
--   Project Location (app.values_covered_by_grant, and app.sees_work_item's own walk). So within the Companies that
--   already see an item there, a Member whose Visibility covers any Location of the Project sees it; its Trade must
--   still be covered. A grant of no Location covers nothing, as before. Existing grants need no change.
-- * It is no value a grant lists: visibility_grant_value refers to it through (id, dimension_id, whole_project =
--   false), so no grant can name it; the grant functions refuse it as 'value_not_found'; narrowing a Participant
--   never leaves a Member's grant with it alone. app.participant_covered_values (what a grant editor chooses from)
--   leaves it out, and no Visibility Gap names it.
-- * It is built in: app.add_dimension_value takes no Location inside it ('parent_not_found') and
--   app.update_dimension_value neither renames nor deactivates it ('not_found', as for a value of another dimension).

-- The flag and its rules ---------------------------------------------------------------------------------------

alter table dimension_value
  add column whole_project boolean not null default false,
  -- At the top of the tree.
  add constraint dimension_value_whole_project_top check (not whole_project or parent_id is null);
-- One per dimension.
create unique index dimension_value_whole_project_key on dimension_value (dimension_id) where whole_project;
-- What a grant value's foreign key refers to.
alter table dimension_value add constraint dimension_value_id_dimension_whole_project_key unique (id, dimension_id, whole_project);

-- A grant value is never the Whole Project Location: its key names whole_project = false.
alter table visibility_grant_value
  add column value_whole_project boolean not null generated always as (false) stored;
alter table visibility_grant_value
  add constraint visibility_grant_value_not_whole_project_fk
    foreign key (dimension_value_id, dimension_id, value_whole_project)
    references dimension_value (id, dimension_id, whole_project);

-- The Projects that exist get theirs. Its code is WP, or the first free of WP1 to WP9 where a Zone of the Project
-- already has WP.
do $$
  declare
    v_dimension record;
    v_code text;
  begin
    for v_dimension in select id, project_id from visibility_dimension where kind = 'location' loop
      select c into v_code
      from unnest(array['WP', 'WP1', 'WP2', 'WP3', 'WP4', 'WP5', 'WP6', 'WP7', 'WP8', 'WP9']) with ordinality as x (c, n)
      where not exists (select 1 from dimension_value v where v.dimension_id = v_dimension.id and v.parent_id is null and v.code = x.c)
      order by x.n
      limit 1;
      if v_code is null then
        raise exception 'Project % has Zones WP and WP1 to WP9: give its Whole Project Location a code by hand', v_dimension.project_id;
      end if;
      insert into dimension_value (project_id, dimension_id, depth, level_name, code, name, sort, whole_project)
      values (v_dimension.project_id, v_dimension.id, 1, '{"en": "Zone", "ar": "المنطقة"}', v_code,
        '{"en": "Whole Project", "ar": "المشروع كامل"}', 0, true);
    end loop;
  end
$$;

-- Every new Project gets one -------------------------------------------------------------------------------------

-- From 20270914000000_site_observation_type_and_general_trade.sql: the location dimension's Whole Project Location.
create or replace function app.create_project_dimensions() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_trade uuid;
      v_location uuid;
    begin
      insert into visibility_dimension (project_id, kind, name, required_on_work_items) values
        (new.id, 'trade', '{"en": "Trade", "ar": "التخصص"}', true)
        returning id into v_trade;
      insert into visibility_dimension (project_id, kind, name, required_on_work_items) values
        (new.id, 'location', '{"en": "Location", "ar": "الموقع"}', false)
        returning id into v_location;
      insert into dimension_value (project_id, dimension_id, depth, code, name)
        values (new.id, v_trade, 1, 'GEN', '{"en": "General", "ar": "عام"}');
      insert into dimension_value (project_id, dimension_id, depth, level_name, code, name, sort, whole_project)
        values (new.id, v_location, 1, '{"en": "Zone", "ar": "المنطقة"}', 'WP', '{"en": "Whole Project", "ar": "المشروع كامل"}', 0, true);
      return new;
    end
  $$;

-- What a grant covers --------------------------------------------------------------------------------------------

-- From 20261108000000_plpgsql_definer_helpers.sql: a grant of some values also covers the Whole Project Location of
-- its dimension, once it lists any value (a grant of all of the dimension already covers it).
create or replace function app.values_covered_by_grant(p_grant_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
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
        union
        select v.id from dimension_value v join g on v.dimension_id = g.dimension_id
        where v.whole_project and not g.is_all and exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id);
    end
  $$;

-- From 20271019000000_reads_at_scale.sql: the Whole Project Location is covered by a grant of all of its dimension,
-- or of any value of it, as app.values_covered_by_grant has it.
create or replace function app.sees_work_item(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_member uuid := app.current_member_id();
      v_company uuid;
    begin
      -- app.current_company_id, and app.current_project_ids' own conditions on the Member and Company: an active
      -- Member of an active Company. The query's project_member and participant rows are the rest of them.
      select m.company_id into v_company
      from member m join company co on co.id = m.company_id
      where m.id = v_member and m.status = 'active' and co.status = 'active';
      if v_company is null then
        return false;
      end if;
      return (
        select exists (
          select 1
          from work_item w
          join project_member pm on pm.project_id = w.project_id
          join participant p on p.id = pm.participant_id
          join work_item_access a on a.work_item_id = w.id and a.participant_id = pm.participant_id
          join participant raiser on raiser.id = w.raised_by_participant_id
          join project_role raiser_role on raiser_role.id = raiser.project_role_id
          join workflow_step s on s.id = w.current_step_id
          -- Whether the reader's Participant holds it: then it reads the values as they are now.
          cross join lateral (
            select w.built_ins_as_arrived is null or exists (
              select 1 from step_assignment h
              where h.work_item_id = w.id and h.status in ('pooled', 'picked_up', 'vacant') and h.participant_id = pm.participant_id
            ) as live
          ) reads
          where w.id = p_work_item_id
            and pm.member_id = v_member and pm.status = 'active'
            and p.status = 'active' and p.company_id = v_company
            and (p.id = w.raised_by_participant_id or w.submitted_at is not null
              or app.actor_role(s.actor_rule, raiser_role.base_role) is distinct from raiser_role.base_role)
            and (w.document_number is not null or s.drafts_visible_to is distinct from 'author'
              or exists (
                select 1 from step_assignment h
                where h.work_item_id = w.id and h.status = 'picked_up' and h.assignee_member_id = pm.member_id))
            -- Each value it is read with (as it is now, or as it arrived) covered by the Member's grant and by
            -- their Participant's.
            and not exists (
              select 1
              from (
                select dv.dimension_id, dv.dimension_value_id as value_id
                from work_item_dimension_value dv
                where reads.live and dv.work_item_id = w.id
                union all
                select v.key::uuid, v.value::uuid
                from jsonb_each_text(w.built_ins_as_arrived -> 'dimensions') v
                where not reads.live
              ) d
              -- A grant of all of the dimension covers a value of it (a value's parent is of its dimension:
              -- dimension_value_parent_fk). A grant of some values covers each of them and every value under one,
              -- so a value it or a value above it is granted. A value that is no dimension_value is granted by none
              -- (visibility_grant_value_value_fk). The Whole Project Location is covered by a grant of any value
              -- of its dimension (RP-1304), and is no grant's value (visibility_grant_value_not_whole_project_fk).
              cross join lateral (
                select
                  exists (select 1 from dimension_value v where v.id = d.value_id and v.dimension_id = d.dimension_id) as in_dimension,
                  exists (
                    select 1 from dimension_value v where v.id = d.value_id and v.dimension_id = d.dimension_id and v.whole_project
                  ) as whole_project,
                  array(
                    with recursive up (id) as (
                      select d.value_id
                      union
                      select parent.id
                      from up cross join lateral (select v.parent_id as id from dimension_value v where v.id = up.id) parent
                      where parent.id is not null
                    )
                    select up.id from up
                  ) as ids
              ) value
              cross join lateral (
                select
                  exists (
                    select 1 from visibility_grant g
                    where g.project_member_id = pm.id and g.dimension_id = d.dimension_id
                      and case when g.is_all then value.in_dimension
                        when value.whole_project then exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id)
                        else exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id and gv.dimension_value_id = any(value.ids)) end
                  ) as by_member,
                  exists (
                    select 1 from visibility_grant g
                    where g.participant_id = pm.participant_id and g.project_member_id is null and g.dimension_id = d.dimension_id
                      and case when g.is_all then value.in_dimension
                        when value.whole_project then exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id)
                        else exists (select 1 from visibility_grant_value gv where gv.grant_id = g.id and gv.dimension_value_id = any(value.ids)) end
                  ) as by_participant
              ) covered
              where not (covered.by_member and covered.by_participant)
            )
        )
      );
    end
  $$;

-- Grants never list it -------------------------------------------------------------------------------------------

-- From 20271209000000_dimension_value_status.sql: the Whole Project Location is 'value_not_found', and narrowing a
-- Participant keeps it out of its Members' grants.
create or replace function app.set_participant_visibility(
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
      where id = p_participant_id and status = 'active' and project_id in (select app.current_admin_project_ids())
      for update;
      if v_project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      v_dimension_id := app.project_dimension_id(v_project_id, p_kind);
      if exists (select unnest(v_values) except select id from dimension_value where dimension_id = v_dimension_id and not whole_project) then
        return 'value_not_found';
      end if;
      if exists (
        select unnest(v_values)
        intersect select id from dimension_value where dimension_id = v_dimension_id and status = 'deactivated'
        except select app.values_covered_by_participant(p_participant_id, v_dimension_id)
      ) then
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
      -- A Member's "all" already means all of the Participant's. The Whole Project Location is in
      -- both whenever each lists a value, and is never stored: kept alone, it covers nothing.
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
          where (v.parent_id is null or v.parent_id not in (select id from kept)) and not v.whole_project
        ));
        update visibility_grant set updated_at = v_at where id = v_member_grant.id;
      end loop;
      return 'set';
    end
  $$;

-- From 20271209000000_dimension_value_status.sql: the Whole Project Location is 'value_not_found'.
create or replace function app.set_member_visibility(
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
      if exists (select unnest(v_values) except select id from dimension_value where dimension_id = v_dimension_id and not whole_project) then
        return 'value_not_found';
      end if;
      if exists (
        select unnest(v_values)
        intersect select id from dimension_value where dimension_id = v_dimension_id and status = 'deactivated'
        except select app.values_covered_by_project_member(v_project_member_id, v_dimension_id)
      ) then
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

-- From 20271209000000_dimension_value_status.sql: what a grant editor chooses from, without the Whole Project Location.
create or replace function app.participant_covered_values(p_participant_id uuid)
  returns table (kind text, id uuid, parent_id uuid, depth smallint, code text, name jsonb, level_name jsonb, status text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name, v.status
        from participant p
        join visibility_dimension d on d.project_id = p.project_id
        cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
        join dimension_value v on v.id = c.id
        where p.id = p_participant_id and p.status = 'active'
          and (p.id in (select app.current_participant_ids()) or p.project_id in (select app.current_admin_project_ids()))
          and not v.whole_project
        order by d.kind, v.depth, v.sort, v.id;
    end
  $$;

-- No Visibility Gap names it ---------------------------------------------------------------------------------------

-- From 20271213000000_gap_skips_discarded_drafts.sql.
create or replace function app.project_visibility_gap(p_project_id uuid)
  returns table (kind text, id uuid, parent_id uuid, depth smallint, code text, name jsonb, level_name jsonb, status text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name, v.status
        from visibility_dimension d
        join dimension_value v on v.dimension_id = d.id
        where d.project_id = p_project_id
          and p_project_id in (select app.current_admin_project_ids())
          and not v.whole_project
          and (
            v.status = 'active'
            or exists (
              select 1
              from work_item_dimension_value wv
              join work_item w on w.id = wv.work_item_id
              where wv.dimension_value_id = v.id and w.discarded_at is null
            )
          )
          and v.id not in (
            select c.id
            from participant p
            cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
            where p.project_id = p_project_id and p.status = 'active'
          )
        order by d.kind, v.depth, v.sort, v.id;
    end
  $$;

-- From 20271203000000_participants_pages.sql.
create or replace function app.participant_visibility_gap(p_participant_id uuid)
  returns table (kind text, id uuid, parent_id uuid, depth smallint, code text, name jsonb, level_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name
        from participant p
        join visibility_dimension d on d.project_id = p.project_id
        cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
        join dimension_value v on v.id = c.id
        where p.id = p_participant_id and p.status = 'active'
          and p.company_id = app.current_authorized_company_id()
          and not v.whole_project
          and c.id not in (
            select mc.id
            from project_member pm
            join member m on m.id = pm.member_id
            cross join lateral app.values_covered_by_project_member(pm.id, d.id) as mc (id)
            where pm.participant_id = p.id and pm.status = 'active' and m.status = 'active'
          )
        order by d.kind, v.depth, v.sort, v.id;
    end
  $$;

-- It is built in -----------------------------------------------------------------------------------------------------

-- From 20260928230000_visibility.sql: no Location goes inside the Whole Project one ('parent_not_found').
create or replace function app.add_dimension_value(p_project_id uuid, p_kind text, p_parent_id uuid, p_code text, p_name jsonb)
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
        where v.id = p_parent_id and v.dimension_id = v_dimension_id and p_kind = 'location' and not v.whole_project;
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

-- From 20271209000000_dimension_value_status.sql: the Whole Project Location is neither renamed nor deactivated
-- ('not_found', as a value of the other dimension is).
create or replace function app.update_dimension_value(p_value_id uuid, p_kind text, p_name jsonb, p_active boolean, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_value record;
      v_at timestamptz := greatest(p_now, now());
    begin
      select v.id, v.project_id, v.parent_id, v.code into v_value
      from dimension_value v
      join visibility_dimension d on d.id = v.dimension_id and d.kind = p_kind
      where v.id = p_value_id and v.project_id in (select app.current_admin_project_ids()) and not v.whole_project
      for update of v;
      if v_value.id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_value.project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if p_active is false and p_kind = 'trade' and v_value.code = 'GEN' then
        return 'general_trade';
      end if;
      if p_active and exists (select 1 from dimension_value parent where parent.id = v_value.parent_id and parent.status = 'deactivated') then
        return 'parent_deactivated';
      end if;

      update dimension_value set
        name = coalesce(p_name, name),
        status = case when p_active is null then status when p_active then 'active' else 'deactivated' end,
        updated_at = v_at
      where id = p_value_id;
      if p_active is false then
        -- Every Location below it (Trades have none).
        with recursive below (id) as (
          select c.id from dimension_value c where c.parent_id = p_value_id
          union all
          select c.id from dimension_value c join below b on c.parent_id = b.id
        )
        update dimension_value set status = 'deactivated', updated_at = v_at
        where id in (select id from below) and status <> 'deactivated';
      end if;
      return 'updated';
    end
  $$;
