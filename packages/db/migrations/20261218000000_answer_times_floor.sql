-- Answer times never earlier than the Creation Date once an item is numbered (RP-392;
-- visibility.md "Creation Date" and scenarios 61 and 75).
--
-- Answers are stamped when the Draft is created and at each save that changes
-- them, so an answer nobody changed kept the Draft-started time, which
-- work_item.numbered_at (the Creation Date) is meant to hide once the item has its number.
--
-- * app.work_item_field_times, the only read that hands out answer times (the
--   API's fieldTimes, and so "Saved <time>" and the autosave merge), is as in the
--   consultant_section migration, except that once the item is numbered any time
--   earlier than its own numbered_at reads as numbered_at. A Revision is its own
--   item, so it is judged against its own Creation Date; a Send Back keeps
--   numbered_at, so the floor holds from then on.
-- * While the item is a Draft (numbered_at is null) nothing changes, so co-editors
--   see real times.
-- * work_item.field_times keeps the stored times for audit; the app role still has no
--   column grant on it.
create or replace function app.work_item_field_times(p_work_item_id uuid, p_lock boolean default false) returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_times jsonb;
      v_numbered_at timestamptz;
    begin
      if not app.sees_work_item(p_work_item_id) or not app.can_save_answers(p_work_item_id) then
        return null;
      end if;
      if p_lock then
        select w.field_times, w.numbered_at into v_times, v_numbered_at from work_item w where w.id = p_work_item_id for update;
      else
        select w.field_times, w.numbered_at into v_times, v_numbered_at from work_item w where w.id = p_work_item_id;
      end if;
      return coalesce((
        select jsonb_object_agg(t.key, jsonb_build_object(
          'at', to_char((greatest((t.value ->> 'at')::timestamptz, v_numbered_at)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'by', t.value ->> 'by',
          'name', m.full_name))
        from jsonb_each(v_times) t
        join member m on m.id = app.uuid_or_null(t.value -> 'by') and m.company_id = app.current_company_id()
      ), '{}'::jsonb);
    end
  $$;
