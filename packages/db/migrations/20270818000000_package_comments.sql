-- RP-647: the Comments on a Package's page (spec RP-616 story 35; data-model.md package;
-- visibility.md scenario RP-647-1).
--
-- * app.package_comments: the Comments (Type CMT, the Snag List's items Code B raises, RP-434)
--   raised from the Package's submittals, by their `raised_from` link, that the caller sees:
--   from the items app.package_items gives (a Package they see, its items they see), and each
--   Comment through app.sees_work_item, as app.work_item_comment_counts counts them. Never a
--   discarded one, never one of an item they don't see, and no row at all for a Package they
--   don't see. Each with the submittal it was raised from. For information only: a Comment has
--   no package_id, so it is never in the Package's items, counts or status.

create function app.package_comments(p_package_id uuid) returns table (work_item_id uuid, raised_from_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select c.id, l.to_id
        from app.package_items(p_package_id) i
        join work_item_link l on l.to_id = i and l.kind = 'raised_from' and l.removed_at is null
        join work_item c on c.id = l.from_id
        join work_item_type t on t.id = c.work_item_type_id
        where t.code = 'CMT' and c.discarded_at is null and app.sees_work_item(c.id);
    end
  $$;

revoke all on function app.package_comments(uuid) from public;
grant execute on function app.package_comments(uuid) to rabaed_app;
