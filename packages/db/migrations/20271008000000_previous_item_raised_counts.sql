-- RP-653 (INSP-6; spec RP-649; ADR 0025; workflow-engine.md §6; visibility.md "Lists and counts",
-- scenario RP-653-1): the follow-ups the previous item of a chain left.
--
-- * app.work_item_previous_raised_item_counts: for a Revision `p_work_item_id`, the items raised from
--   the item before it in its chain (`revision_of_id`), open and closed, per Work Item Type: the
--   Snags a WIR's Code C left, "Snags from Rev 0: 1 closed / 1 open". It is
--   app.work_item_raised_item_counts of that item, so only the follow-ups the caller sees, never a
--   discarded one; no row when the caller sees no Rev n-1 or the item is no Revision. Each row carries the
--   previous item's Revision number and Document Number (the caller sees the item, so its number),
--   which the page filters the Snag List by. Any Type, any Revision chain. Open follow-ups never block
--   a code: no rule reads these counts.

create function app.work_item_previous_raised_item_counts(p_work_item_id uuid)
  returns table (previous_revision_no integer, previous_document_number text, type_code text, type_name jsonb, open_count integer, closed_count integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_previous_id uuid;
      v_revision_no integer;
      v_document_number text;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      select prev.id, prev.revision_no, prev.document_number
        into v_previous_id, v_revision_no, v_document_number
        from work_item w
        join work_item prev on prev.id = w.revision_of_id
        where w.id = p_work_item_id and app.sees_work_item(prev.id);
      if v_previous_id is null then
        return;
      end if;
      return query
        select v_revision_no, v_document_number, c.type_code, c.type_name, c.open_count, c.closed_count
        from app.work_item_raised_item_counts(v_previous_id) c;
    end
  $$;
revoke all on function app.work_item_previous_raised_item_counts(uuid) from public;
grant execute on function app.work_item_previous_raised_item_counts(uuid) to rabaed_app;
