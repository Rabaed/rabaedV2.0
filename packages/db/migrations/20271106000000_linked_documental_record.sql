-- RP-1087 (story 57; visibility.md E1, V7, the Documental Record row; scenarios RP-1087-1 and
-- RP-1087-2): a Member who sees item X opens the Documental Record of an item X links to, through
-- the Link, even when the linked item is outside their Visibility (E1, settled 2026-10-16).
--
-- * app.linked_documental_record_file(item, link): what app.documental_record_file gives for the
--   linked item (its PDF's storage key and its file name, the Document Number and `.pdf`), and
--   only when the Member sees X, the Link is one X's Links read gives them (app.work_item_links,
--   so every rule of that read holds here too), the Link is not removed, its target is closed and
--   its record is published. Anything else gives nothing, the plain 404 (apps/api). Never the
--   target's id, answers, events or history.
-- * app.documental_record_file is unchanged: the linked item's own record read is still nothing
--   to a Member who doesn't see it.

create function app.linked_documental_record_file(p_work_item_id uuid, p_link_id uuid)
  returns table (storage_key text, file_name text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if app.current_member_id() is null or not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        select f.storage_key,
          coalesce(t.document_number, ty.code) || '.pdf'
        from app.work_item_links(p_work_item_id) seen
        join work_item_link l on l.id = seen.id and l.from_id = p_work_item_id and l.removed_at is null
        join work_item t on t.id = l.to_id and t.closed_at is not null
        join work_item_type ty on ty.id = t.work_item_type_id
        join documental_record r on r.work_item_id = t.id and r.status = 'published'
        join stored_file f on f.id = r.pdf_file_id
        where seen.id = p_link_id;
    end
  $$;
revoke all on function app.linked_documental_record_file(uuid, uuid) from public;
grant execute on function app.linked_documental_record_file(uuid, uuid) to rabaed_app;
