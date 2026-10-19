-- RP-641: who sees a Package, and each viewer's counts (spec RP-616 "Visibility"; data-model.md
-- package; visibility.md scenarios RP-588-2, RP-588-3).
--
-- * app.sees_package widens beyond the owning Participant: a Member who sees (app.sees_work_item)
--   at least one of its items sees it too, once it is no longer Open. An Open Package holds only
--   items its owner has not Submitted, which nobody else sees; the status check says so outright,
--   so nothing outside the owner ever reads one (RP-588-1).
-- * app.owns_package: the owning Participant's Members, while the Package is not discarded. Every
--   write goes through app.package_for_write, which now asks it rather than app.sees_package: a
--   viewer who is not the owner changes nothing, and is answered 'not_found' as for a Package they
--   don't see. app.package_hides_unsubmitted (Submit Package's guard, RP-638) asks it too: only the
--   owner may Submit, and a viewer must not learn that an item they don't see is still to Submit.
-- * app.package_summary: the counts of the caller's visible items only (total, still open, and
--   closed by outcome, the Review Code), cancelled and discarded items left out; no row when they
--   don't see the Package. Nobody reads a total that includes an item they don't see.
-- * app.package_owner_name: the owning Participant's Company name (V14: a Company by its name,
--   never a person), for every viewer of the Package.

create function app.owns_package(p_package_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return exists (
        select 1 from package k
        where k.id = p_package_id and k.discarded_at is null
          and k.project_id in (select app.current_project_ids())
          and app.acts_for_participant(k.project_id, k.participant_id)
      );
    end
  $$;

-- Whether the acting Member sees Package p_package_id: its owner (app.owns_package), or, once it is
-- no longer Open, a Member who sees one of its items.
create or replace function app.sees_package(p_package_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return app.owns_package(p_package_id) or exists (
        select 1 from package k
        where k.id = p_package_id and k.discarded_at is null and k.status <> 'open'
          and k.project_id in (select app.current_project_ids())
          and exists (select 1 from work_item w where w.package_id = k.id and app.sees_work_item(w.id))
      );
    end
  $$;

-- Package p_package_id locked for a write by a Member of its owning Participant, with its Project's
-- status; no row for anyone else, whether or not they see it. A helper of the writes.
create or replace function app.package_for_write(p_package_id uuid)
  returns table (id uuid, project_id uuid, participant_id uuid, status text, project_status text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.owns_package(p_package_id) then
        return;
      end if;
      return query
        select k.id, k.project_id, k.participant_id, k.status, pr.status
        from package k join project pr on pr.id = k.project_id
        where k.id = p_package_id
        for update of k;
    end
  $$;

-- Whether Package p_package_id, which the acting Member owns, holds an item still to Submit (not
-- Submitted, not closed, not discarded) that they don't see. False for anyone but its owner.
create or replace function app.package_hides_unsubmitted(p_package_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.owns_package(p_package_id) and exists (
        select 1 from work_item w
        where w.package_id = p_package_id and w.submitted_at is null and w.closed_at is null and w.discarded_at is null
          and not app.sees_work_item(w.id)
      );
    end
  $$;

-- Package p_package_id's counts as the acting Member reads them, from the items they see only
-- (app.package_items): how many, how many still open, and how many closed with each outcome (the
-- Review Code), by its code. Cancelled and discarded items are left out. No row when they don't
-- see the Package.
create function app.package_summary(p_package_id uuid) returns table (total integer, open integer, codes jsonb)
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
          from app.package_items(p_package_id) i
          join work_item w on w.id = i
          where w.discarded_at is null and w.outcome is distinct from 'cancelled'
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

-- The owning Participant's Company name, for a Member who sees Package p_package_id; else null.
create function app.package_owner_name(p_package_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_package(p_package_id) then
        return null;
      end if;
      return (
        select co.legal_name from package k
        join participant p on p.id = k.participant_id
        join company co on co.id = p.company_id
        where k.id = p_package_id
      );
    end
  $$;

revoke all on function
  app.owns_package(uuid),
  app.package_summary(uuid),
  app.package_owner_name(uuid)
  from public;
grant execute on function
  app.owns_package(uuid),
  app.package_summary(uuid),
  app.package_owner_name(uuid)
  to rabaed_app;
