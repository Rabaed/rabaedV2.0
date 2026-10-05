-- The Revision drop-down (RP-318, spec RP-311; workflow-engine.md §5.4 "The item
-- page shows the chain", visibility.md the Revisions channel, V1, scenarios 51
-- and 52).
--
-- * app.revision_chain(item): the Revisions of the item's chain that the acting
--   Member sees, the original first, each with its id, Document Number (null
--   while it has none) and Rev number. V1 applies to each Revision on its own,
--   so a Contractor's Draft Revision never reaches K1 or the Owner, and a
--   discarded Revision reaches nobody. Nothing at all for an item the caller
--   doesn't see. The app role never reads the chain's ids (create_revision
--   migration), so the chain is read only through this function.

create function app.revision_chain(p_work_item_id uuid)
  returns table (work_item_id uuid, document_number text, revision_no integer)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select o.id, o.document_number, o.revision_no
    from work_item w
    join work_item o on o.root_id = w.root_id and o.project_id = w.project_id
    where w.id = p_work_item_id and app.sees_work_item(w.id)
      and o.discarded_at is null and app.sees_work_item(o.id)
    order by o.revision_no
  $$;

revoke all on function app.revision_chain(uuid) from public;
grant execute on function app.revision_chain(uuid) to rabaed_app;
