-- RP-616 review fix 18 (spec story 30, as the product owner settled it on 2026-10-19): a
-- Package's counts and its page's items are of the latest Revision of each chain only, the same
-- way its Done status reads them (20270623000000_package_done.sql). A Code C and its open R1 count
-- "open 1, total 1".
--
-- * app.package_latest_items(package): of the items the caller sees (app.package_items), not
--   discarded, the latest Revision of each chain (`root_id`, highest `revision_no`) leaving out
--   cancelled ones, so a cancelled R1 gives the Code C back; a chain whose every item the caller
--   sees is cancelled gives its latest, `counted` false. Per viewer: a Revision the caller doesn't
--   see (another Company's Draft R1) never counts for them, nor tells them it exists.
-- * app.package_summary counts the `counted` ones. The api's Package page lists them all.

create function app.package_latest_items(p_package_id uuid) returns table (work_item_id uuid, counted boolean)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select distinct on (w.root_id) w.id, w.outcome is distinct from 'cancelled'
        from app.package_items(p_package_id) i
        join work_item w on w.id = i
        where w.discarded_at is null
        order by w.root_id, (w.outcome is distinct from 'cancelled') desc, w.revision_no desc;
    end
  $$;

create or replace function app.package_summary(p_package_id uuid) returns table (total integer, open integer, codes jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_package(p_package_id) then
        return;
      end if;
      return query
        with seen as (
          select w.closed_at is null as open, w.outcome
          from app.package_latest_items(p_package_id) l
          join work_item w on w.id = l.work_item_id
          where l.counted
        )
        select
          (select count(*)::integer from seen),
          (select count(*)::integer from seen where seen.open),
          coalesce((
            select jsonb_object_agg(c.outcome, c.n order by c.outcome)
            from (select s.outcome, count(*)::integer as n from seen s where not s.open and s.outcome is not null group by s.outcome) c
          ), '{}'::jsonb);
    end
  $$;

revoke all on function app.package_latest_items(uuid) from public;
grant execute on function app.package_latest_items(uuid) to rabaed_app;
