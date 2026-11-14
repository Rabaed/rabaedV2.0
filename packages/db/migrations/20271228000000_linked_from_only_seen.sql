-- RP-1301: Linked from lists only the linking items the viewer may see (owner's decision 2026-11-14,
-- RP-1301 comment 15885, reversing E3's "Document Number and Subject" of 2026-10-05). An item the
-- viewer can't see is left out silently: no Document Number, Subject or id, and no row to count.
-- This holds wherever the read is used, the Submittal Panel's Links and the Work Item page.
--
-- As in 20261110000000_sent_back_as_it_was.sql, with every check kept (the target seen, Submitted at
-- least once, not discarded, each Link as the viewer has it as arrived (V19), the chain rule) and
-- one added: app.sees_work_item on the linking item itself. So the id is always there now.
-- The signature is unchanged; no grant is added.
create or replace function app.work_item_linked_from(p_work_item_id uuid)
  returns table(document_number text, subject text, work_item_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select f.document_number, f.title, f.id
        from work_item f
        where f.id in (
            select l.from_id from work_item_link l
            where l.to_id = p_work_item_id and app.item_row_as_arrived(l.from_id, l.arrival, l.removed_at is not null))
          and f.submitted_at is not null
          and f.discarded_at is null
          and app.sees_work_item(p_work_item_id)
          and app.sees_work_item(f.id)
          and not app.chain_item_hidden(p_work_item_id, f.id)
        order by f.document_number, f.id;
    end
  $$;
