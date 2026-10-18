-- Raised-from counts by Type (RP-624, SNAG-7; spec RP-619; workflow-engine.md §6;
-- visibility.md "Lists and counts", scenarios RP-624-1 and RP-624-2).
--
-- * app.work_item_raised_item_counts: the items raised from item `p_work_item_id`
--   (`raised_from`-linked to it) that the caller sees, never a discarded one, open and
--   closed, per Work Item Type: the Comments of a Code B, the Snags raised from an
--   inspection. No row for an item the caller doesn't see, none for a Type with no
--   raised item. app.work_item_comment_counts is unchanged: the "all Comments closed"
--   rule keeps reading Comments only.

create function app.work_item_raised_item_counts(p_work_item_id uuid)
  returns table (type_code text, type_name jsonb, open_count integer, closed_count integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        select t.code, t.name,
          (count(*) filter (where c.closed_at is null))::integer,
          (count(*) filter (where c.closed_at is not null))::integer
        from work_item_link l
        join work_item c on c.id = l.from_id
        join work_item_type t on t.id = c.work_item_type_id
        where l.to_id = p_work_item_id and l.kind = 'raised_from' and l.removed_at is null
          and c.discarded_at is null and app.sees_work_item(c.id)
        group by t.id, t.code, t.name
        order by t.code;
    end
  $$;
revoke all on function app.work_item_raised_item_counts(uuid) from public;
grant execute on function app.work_item_raised_item_counts(uuid) to rabaed_app;
