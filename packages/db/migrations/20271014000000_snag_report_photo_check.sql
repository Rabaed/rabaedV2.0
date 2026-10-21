-- RP-1003 (review RP-682 of spec RP-619; visibility.md, scenario RP-677-1): the database alone holds "a
-- photo only where row-level security shows it" for the Snag report (20270930000000_snag_report.sql).
--
-- * app.request_snag_report took the caller's content and checked only that each photo's storage key
--   was under the Project's prefix; the worker prints those keys as the owner role. It now accepts a
--   photo only when its key is a Document the calling Member reads: confirmed, not removed, on this
--   Project, at an arrival of an item they see (app.item_row_seen), the rule of the policy
--   member_reads_documents on document (20261110000000_sent_back_as_it_was.sql). So another
--   Company's photo, a waiting After photo (RP-623), a Documental Record's file or a made-up key is
--   refused, whoever calls it. An item photo with no storage key is refused too.
-- * app.snag_report_state takes the Project as well: a report is found under its own Project only,
--   so the api reads it scoped to the path's Project. The one-argument form is dropped.
-- Open (RP-1003, for the owner): whether a report may still be downloaded after its asker's
-- Visibility is narrowed; app.snag_report_state still checks only that they are on the Project.

create or replace function app.request_snag_report(p_project_id uuid, p_language text, p_content jsonb) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member uuid := app.current_member_id();
      v_report uuid := gen_random_uuid();
      v_outbox uuid;
    begin
      if v_member is null or p_language not in ('en', 'ar') or jsonb_typeof(p_content) is distinct from 'object'
        or not exists (select 1 from app.current_project_ids() x where x = p_project_id)
        -- A photo is printed by its storage key as the owner role: only a Document this Member reads,
        -- as member_reads_documents lets them.
        or exists (
          select 1 from jsonb_array_elements(coalesce(p_content -> 'items', '[]'::jsonb)) i
          where jsonb_typeof(i -> 'photo') = 'object'
            and not exists (
              select 1 from document d
              where d.storage_key = i -> 'photo' ->> 'storageKey' and d.project_id = p_project_id
                and d.confirmed_at is not null and d.removed_at is null
                and app.item_row_seen(d.work_item_id, d.arrival, false)
            )
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

drop function app.snag_report_state(uuid);

create function app.snag_report_state(p_project_id uuid, p_report_id uuid)
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
        select case when r.file_id is not null then 'ready' when o.dead_at is not null then 'failed' else 'preparing' end,
          f.storage_key,
          case when r.file_id is not null then 'snag-report.pdf' end
        from snag_report r
        left join outbox o on o.id = r.outbox_id
        left join stored_file f on f.id = r.file_id
        where r.id = p_report_id and r.project_id = p_project_id and r.member_id = app.current_member_id()
          and r.project_id in (select app.current_project_ids());
    end
  $$;
revoke all on function app.snag_report_state(uuid, uuid) from public;
grant execute on function app.snag_report_state(uuid, uuid) to rabaed_app;
