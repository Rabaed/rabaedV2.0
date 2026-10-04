-- Linked from (RP-292, spec RP-289; form-engine.md part 2b; visibility.md E3,
-- the Linked from row and scenarios 27 and 28).
--
-- * app.work_item_linked_from: for an item the acting Member sees, every
--   Submitted item that links to it (any kind: free Links and link questions
--   alike), once each, by Document Number. Each comes back as its Document
--   Number and Subject, and its id only when the Member sees it too; nothing
--   else (no Stage, Code or Company), so a hidden one can't be opened or asked
--   about (E3). Submitted is the linking item's own state, not the caller's view
--   of it: it has left its raiser (participant_entered_step_id is no longer a
--   Draft Step), as app.work_item_submitted, so a Draft or an item in its
--   raiser's internal review never appears, whoever asks. An item the Member
--   can't see has no Linked from. The app role can't read a Link's target
--   (work_item_link.to_id), so this function is the only way in.

create function app.work_item_linked_from(p_work_item_id uuid)
  returns table (document_number text, subject text, work_item_id uuid)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select f.document_number, f.title, case when app.sees_work_item(f.id) then f.id end
    from work_item f
    where f.id in (select l.from_id from work_item_link l where l.to_id = p_work_item_id)
      and not app.is_draft_step(f.participant_entered_step_id)
      and app.sees_work_item(p_work_item_id)
    order by f.document_number, f.id
  $$;

revoke all on function app.work_item_linked_from(uuid) from public;
grant execute on function app.work_item_linked_from(uuid) to rabaed_app;
