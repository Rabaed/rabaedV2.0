-- The Revision's notice lists the fields it lost (RP-311 review; form-engine.md
-- §7 "A Revision onto a newer Form version": "The new revision shows a notice
-- listing them"; workflow-engine.md §5.4).
--
-- * app.revision_dropped_fields(item): for a Revision the acting Member sees, the
--   fields of the Form Version of the item it revises that its own Form Version
--   doesn't have with the same type (dropped, or its key now another type), in
--   the order of that schema, each with its key and label. app.fill_revision copied
--   no answer for them. Layout fields hold no answer and are left out. Nothing
--   for an original, an item whose Version didn't change, or an item the caller
--   can't see. Only the schema is read, never the revised item's answers or ids,
--   so it says nothing of an item the caller may not see.

create function app.revision_dropped_fields(p_work_item_id uuid)
  returns table (field_key text, label jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select f ->> 'key', f -> 'label'
    from work_item w
    join work_item prev on prev.id = w.revision_of_id
    join form_version v on v.id = prev.form_version_id
    cross join lateral jsonb_array_elements(v.schema -> 'sections') with ordinality s (s, sn)
    cross join lateral jsonb_array_elements(s -> 'fields') with ordinality f (f, fn)
    where w.id = p_work_item_id and app.sees_work_item(w.id)
      and w.form_version_id <> prev.form_version_id
      and f ->> 'type' not in ('heading', 'instructions', 'divider')
      and app.form_field_type(w.form_version_id, f ->> 'key') is distinct from f ->> 'type'
    order by sn, fn
  $$;

revoke all on function app.revision_dropped_fields(uuid) from public;
grant execute on function app.revision_dropped_fields(uuid) to rabaed_app;
