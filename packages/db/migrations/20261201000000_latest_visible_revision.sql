-- The work item query's Revision chains (RP-345, spec RP-344; visibility.md the
-- Revisions and Dashboard channels, V1).
--
-- * app.latest_visible_revision(item): whether the item is the latest Revision of
--   its chain that the acting Member sees. The List shows one row per chain, this
--   one. V1 applies to each Revision on its own, so while the raiser's Rev 1 is in
--   Draft or internal review another Company's latest is still the original, and a
--   discarded Revision is nobody's. False for an item the caller doesn't see. The
--   app role never reads the chain's ids (create_revision migration), so the
--   chain is grouped only through this function, which answers for one item and
--   names no other.

create function app.latest_visible_revision(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(w.id) and not exists (
          select 1 from work_item o
          where o.root_id = w.root_id and o.project_id = w.project_id
            and o.revision_no > w.revision_no and o.discarded_at is null
            and app.sees_work_item(o.id)
        )
        from work_item w
        where w.id = p_work_item_id
      );
    end
  $$;

revoke all on function app.latest_visible_revision(uuid) from public;
grant execute on function app.latest_visible_revision(uuid) to rabaed_app;
