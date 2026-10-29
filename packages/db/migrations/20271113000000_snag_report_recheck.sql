-- RP-1110 (decision RP-1077, 2026-10-30; visibility.md, Snag report, scenarios RP-1110-n): a stored Snag
-- report no longer serves items its asker no longer sees. This settles the open note of RP-1003
-- (20271014000000_snag_report_photo_check.sql): narrowing a Member's Visibility hides items at once
-- everywhere (layer 4), the report too.
--
-- * app.snag_report_state checks the report against its asker every time it is read, which is every time
--   the api makes a download link: still on the Project (as before), still seeing every item it holds
--   (app.sees_work_item for each row's `id`), and still reading each photo it printed as a Document (the
--   rule app.request_snag_report checks when the report is asked for). When a check fails, the asker's own
--   report reads `gone`, with no file key; it never says which item or why. Anyone else, and a made-up id,
--   still read nothing.

create or replace function app.snag_report_state(p_project_id uuid, p_report_id uuid)
  returns table (status text, storage_key text, file_name text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if app.current_member_id() is null then
        return;
      end if;
      return query
        select case when not v.seen then 'gone' when r.file_id is not null then 'ready' when o.dead_at is not null then 'failed' else 'preparing' end,
          case when v.seen then f.storage_key end,
          case when v.seen and r.file_id is not null then 'snag-report.pdf' end
        from snag_report r
        left join outbox o on o.id = r.outbox_id
        left join stored_file f on f.id = r.file_id
        cross join lateral (
          select not exists (
            select 1 from jsonb_array_elements(coalesce(r.content -> 'items', '[]'::jsonb)) i
            where
              -- Every item it holds, by its id (a row with none is seen by no one).
              case when coalesce(i ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
                else not app.sees_work_item((i ->> 'id')::uuid) end
              -- Each photo it printed, as member_reads_documents lets the asker read it.
              or (jsonb_typeof(i -> 'photo') = 'object'
                and not exists (
                  select 1 from document d
                  where d.storage_key = i -> 'photo' ->> 'storageKey' and d.project_id = r.project_id
                    and d.confirmed_at is not null and d.removed_at is null
                    and app.item_row_seen(d.work_item_id, d.arrival, false)
                ))
          ) as seen
        ) v
        where r.id = p_report_id and r.project_id = p_project_id and r.member_id = app.current_member_id()
          and r.project_id in (select app.current_project_ids());
    end
  $$;
