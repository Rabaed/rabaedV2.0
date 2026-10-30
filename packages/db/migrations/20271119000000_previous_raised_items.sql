-- RP-655 (INSP-9; the owner's answer to the Screen Board's "Snags from Rev 0"; spec RP-649; ADR 0025;
-- visibility.md "Lists and counts", scenario RP-655-1): the follow-ups the previous item of a chain
-- left, one row each, beside app.work_item_previous_raised_item_counts (RP-653).
--
-- * app.work_item_previous_raised_items: for a Revision `p_work_item_id`, the items raised from the item
--   before it in its chain (`revision_of_id`) that the caller sees, never a discarded one: each one's Type,
--   Document Number, Subject and whether it is closed, as the counts count them. No row when the caller
--   sees no Rev n-1 or the item is no Revision. The Snag List's `raisedFrom` filter can't list them: it
--   matches a Document Number, which every Revision of a chain shares, so it also finds Rev 1's own
--   follow-ups. Open follow-ups never block a code: no rule reads these rows.

create function app.work_item_previous_raised_items(p_work_item_id uuid)
  returns table (work_item_id uuid, type_code text, document_number text, title text, closed boolean)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_previous_id uuid;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      select prev.id
        into v_previous_id
        from work_item w
        join work_item prev on prev.id = w.revision_of_id
        where w.id = p_work_item_id and app.sees_work_item(prev.id);
      if v_previous_id is null then
        return;
      end if;
      return query
        select c.id, t.code, c.document_number, c.title, c.closed_at is not null
        from work_item_link l
        join work_item c on c.id = l.from_id
        join work_item_type t on t.id = c.work_item_type_id
        where l.to_id = v_previous_id and l.kind = 'raised_from' and l.removed_at is null
          and c.discarded_at is null and app.sees_work_item(c.id)
        order by t.code, c.document_number, c.id;
    end
  $$;
revoke all on function app.work_item_previous_raised_items(uuid) from public;
grant execute on function app.work_item_previous_raised_items(uuid) to rabaed_app;
