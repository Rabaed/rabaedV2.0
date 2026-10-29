-- RP-1082 (epic review RP-676 of spec RP-649): Inspections clean-up. Nothing here reads more than before.
--
-- * work_item_checklist gets project_id, backfilled from its item and held to it by a composite key to
--   work_item (id, project_id), and its policy is keyed by it (CODING_STANDARDS "Row-level security on every
--   Project table, keyed by project_id"): a copy is read on a Project the reader is on, and only on an item
--   they see, as before. app.sync_work_item_checklists, its only writer, writes it.
-- * Four security definer helpers that check no access and that the app role can't run become security
--   invoker: they are called only from security definer functions, so they run as before, and they can no
--   longer run past row-level security for anyone who might one day be granted them.
--
-- Redefined from their newest bodies on main: the policy member_reads_work_item_checklists
-- (20271019000000_reads_at_scale.sql), app.sync_work_item_checklists
-- (20270716000000_checklist_templates_review_fixes.sql; only its insert changes). The helpers change by
-- `alter function` only: app.is_project_trade (20270630000000_checklist_templates.sql),
-- app.reply_checklist_item (20270827000000_reply_checklist.sql), app.reply_files_waiting and
-- app.reply_field_refusal (20270915000000_annotate_reply_photos.sql).

-- 1. work_item_checklist keyed by its Project ------------------------------------------------------------------

alter table work_item_checklist add column project_id uuid;
update work_item_checklist c set project_id = w.project_id from work_item w where w.id = c.work_item_id;
alter table work_item_checklist alter column project_id set not null;
alter table work_item_checklist add constraint work_item_checklist_item_fk
  foreign key (work_item_id, project_id) references work_item (id, project_id);
create index work_item_checklist_project_idx on work_item_checklist (project_id);
-- The Project the reader is on anyway, as work_item_link's.
grant select (project_id) on work_item_checklist to rabaed_app;

alter policy member_reads_work_item_checklists on work_item_checklist
  using (project_id in (select app.current_project_ids()) and app.sees_work_item(work_item_id));

create or replace function app.sync_work_item_checklists(p_work_item_id uuid, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item work_item;
      v_trade_id uuid;
      v_key text;
      v_answer text;
      v_held uuid;
      v_version checklist_template_version;
      v_offered boolean;
    begin
      if not app.sees_work_item(p_work_item_id) or not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;
      select * into v_item from work_item where id = p_work_item_id;
      select wdv.dimension_value_id into v_trade_id
      from work_item_dimension_value wdv join visibility_dimension d on d.id = wdv.dimension_id and d.kind = 'trade'
      where wdv.work_item_id = p_work_item_id;
      for v_key in
        select f ->> 'key'
        from form_version fv
        cross join lateral jsonb_array_elements(fv.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where fv.id = v_item.form_version_id and f ->> 'type' = 'checklist_template'
      loop
        v_answer := case when jsonb_typeof(v_item.data -> v_key) = 'string' then v_item.data ->> v_key end;
        v_held := null;
        select checklist_template_version_id into v_held from work_item_checklist where work_item_id = p_work_item_id and field_key = v_key;
        if v_answer is not distinct from v_held::text then
          continue;
        end if;
        -- After the first Submit an existing copy never changes; a missing one is only filled in.
        if v_item.submitted_at is not null and v_held is not null then
          return 'checklist_fixed';
        end if;
        if v_answer is null then
          delete from work_item_checklist where work_item_id = p_work_item_id and field_key = v_key;
          continue;
        end if;
        v_version := null;
        select * into v_version from checklist_template_version
        where id::text = v_answer and project_id = v_item.project_id and trade_value_id = v_trade_id;
        if v_version.id is null then
          return 'template_not_found';
        end if;
        -- The template's row, shared: its edit or retirement waits for this copy, or this sees it.
        select t.status = 'active' and t.version_no = v_version.version_no into v_offered
        from checklist_template t where t.id = v_version.checklist_template_id
        for share;
        if not v_offered and not exists (
          select 1 from work_item_checklist c
          where c.work_item_id = v_item.revision_of_id and c.field_key = v_key and c.checklist_template_version_id = v_version.id
        ) then
          return 'template_not_found';
        end if;
        insert into work_item_checklist (work_item_id, project_id, field_key, checklist_template_version_id, name, items, copied_at)
        values (p_work_item_id, v_item.project_id, v_key, v_version.id, v_version.name, v_version.items, greatest(p_now, now()))
        on conflict (work_item_id, field_key) do update
          set checklist_template_version_id = excluded.checklist_template_version_id, name = excluded.name,
              items = excluded.items, copied_at = excluded.copied_at;
      end loop;
      return 'synced';
    end
  $$;

-- 2. Helpers that run as their caller ----------------------------------------------------------------------------

alter function app.is_project_trade(uuid, uuid) security invoker;
alter function app.reply_checklist_item(uuid, jsonb, text) security invoker;
alter function app.reply_files_waiting(uuid, text, text, uuid) security invoker;
alter function app.reply_field_refusal(uuid, text, text, text, uuid) security invoker;
