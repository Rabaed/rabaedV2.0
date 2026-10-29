-- RP-1078 (review RP-682 of spec RP-619; visibility.md, scenarios RP-577-1 and RP-677-1): two Snag List
-- reads hold their rule in the database on their own. Neither leaks today.
--
-- * app.raised_from_check_item (20270922000000_snags_from_failed_check_items.sql) gave the source
--   Inspection's check item text to whoever sees the Snag. That was safe only because the Snag copies
--   the Inspection's readers, Trade, Location and Scopes, and a `raised_from` Link is never taken away.
--   It now also needs the reader to see the Inspection (app.sees_work_item), and reads only a Link not
--   removed.
-- * app.request_snag_report (20271014000000_snag_report_photo_check.sql) checked each photo as the
--   Member but stored the printed rows as given, so a caller with the app role could store a report of
--   made-up rows, such as another Company's Subjects. Each row now names its item (`id`), and the row
--   must be exactly what the Snag List shows the asker for that item, as app.work_items_seen gives it:
--   Document Number, Subject, Type, Trade, Location, Stage, who it is with (V14) and Step Age. The
--   Project's name must be the Project's. It takes the api's `p_now`, as the engine's functions do, so
--   Step Age is checked at the time the api read the List. The three-argument form is dropped.

-- The check item a Snag was raised from -------------------------------------------------------

-- As in 20270922000000_snags_from_failed_check_items.sql, but the reader must see the source too, and
-- the Link must not be removed: the text is the Inspection's content.
create or replace function app.raised_from_check_item(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      return (
        select jsonb_build_object('key', i ->> 'key', 'text', i -> 'text')
        from work_item_link l
        join work_item_checklist c on c.work_item_id = l.to_id and c.field_key = l.checklist_key
        cross join lateral jsonb_array_elements(c.items) i
        where l.from_id = p_work_item_id and l.kind = 'raised_from' and l.removed_at is null
          and i ->> 'key' = l.item_key and app.sees_work_item(l.to_id)
        order by l.id
        limit 1
      );
    end
  $$;

-- A Snag report's request ---------------------------------------------------------------------

drop function app.request_snag_report(uuid, text, jsonb);

-- As in 20271014000000_snag_report_photo_check.sql, and each row is checked against its item.
create function app.request_snag_report(p_project_id uuid, p_language text, p_content jsonb, p_now timestamptz) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member uuid := app.current_member_id();
      v_items jsonb := p_content -> 'items';
      v_ids uuid[];
      v_report uuid := gen_random_uuid();
      v_outbox uuid;
    begin
      if v_member is null or p_now is null or p_language not in ('en', 'ar') or jsonb_typeof(p_content) is distinct from 'object'
        or jsonb_typeof(v_items) is distinct from 'array' or jsonb_typeof(p_content -> 'capped') is distinct from 'boolean'
        or not exists (select 1 from app.current_project_ids() x where x = p_project_id)
        or p_content -> 'projectName' is distinct from (select p.name from project p where p.id = p_project_id)
        -- Every row names its item by id.
        or exists (
          select 1 from jsonb_array_elements(v_items) i
          where jsonb_typeof(i) is distinct from 'object'
            or coalesce(i ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )
      then
        return null;
      end if;
      v_ids := array(select (i ->> 'id')::uuid from jsonb_array_elements(v_items) i);
      if exists (
          -- A photo is printed by its storage key as the owner role: only a Document this Member reads,
          -- as member_reads_documents lets them.
          select 1 from jsonb_array_elements(v_items) i
          where jsonb_typeof(i -> 'photo') = 'object'
            and not exists (
              select 1 from document d
              where d.storage_key = i -> 'photo' ->> 'storageKey' and d.project_id = p_project_id
                and d.confirmed_at is not null and d.removed_at is null
                and app.item_row_seen(d.work_item_id, d.arrival, false)
            )
        )
        -- Each row, but its photo, is exactly what the Snag List shows this Member for its item (the
        -- api's visibleRows and toRow in apps/api/src/work-items/query.ts, and askForSnagReport): an
        -- item they do not see has no row here, so it is refused.
        or exists (
          with seen as (
            select w.id, jsonb_build_object(
                'documentNumber', w.document_number,
                'subject', w.title,
                'type', t.name,
                'trade', tv.name,
                'location', lv.name,
                'stage', st.name,
                -- Who it is with (V14): none once closed; "Owner review" for those it gives; the
                -- Member's own person holding it, else their Company; another Company by name only.
                'with', case
                  when st.category not in ('draft', 'in_progress') then null
                  when w.owner_review is not null then w.owner_review
                  when w.holder_company_name is null then null
                  when w.holder_participant_id in (select app.current_participant_ids()) then coalesce(m.full_name, w.holder_company_name)
                  else w.holder_company_name
                end,
                -- Weeks at the Step it is seen at (stepAgeWeeks): none once closed, nor for a Draft with no number.
                -- To the millisecond, as the api reads the time, so a week's edge falls the same on both sides.
                'stepAgeWeeks', case
                  when st.category in ('draft', 'in_progress') and w.document_number is not null
                    then greatest(0, floor(extract(epoch from p_now - date_trunc('milliseconds', w.entered_at)) / 604800))::integer + 1
                end
              ) as printed
            from app.work_items_seen(p_project_id, array['snag_list'], true, v_ids) w
            join work_item_type t on t.id = w.work_item_type_id
            join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = w.stage_key
            join visibility_dimension td on td.project_id = w.project_id and td.kind = 'trade'
            join lateral unnest(w.dimension_ids, w.dimension_value_ids) as tdv (dimension_id, value_id) on tdv.dimension_id = td.id
            join dimension_value tv on tv.id = tdv.value_id
            join visibility_dimension ld on ld.project_id = w.project_id and ld.kind = 'location'
            left join lateral unnest(w.dimension_ids, w.dimension_value_ids) as ldv (dimension_id, value_id) on ldv.dimension_id = ld.id
            left join dimension_value lv on lv.id = ldv.value_id
            left join member m on m.id = w.holder_member_id
          )
          select 1 from jsonb_array_elements(v_items) i
          where not exists (select 1 from seen s where s.id = (i ->> 'id')::uuid and i - 'id' - 'photo' = s.printed)
        )
      then
        return null;
      end if;
      insert into outbox (kind, project_id, payload)
      values ('snag_report', p_project_id, jsonb_build_object('snag_report_id', v_report))
      returning id into v_outbox;
      insert into snag_report (id, project_id, member_id, language, content, outbox_id)
      values (v_report, p_project_id, v_member, p_language, p_content, v_outbox);
      return v_report;
    end
  $$;

revoke all on function app.request_snag_report(uuid, text, jsonb, timestamptz) from public;
grant execute on function app.request_snag_report(uuid, text, jsonb, timestamptz) to rabaed_app;
