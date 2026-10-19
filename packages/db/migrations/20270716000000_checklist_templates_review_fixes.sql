-- RP-651: checklist templates review fixes (form-engine.md §3.2, data-model.md "Checklist Templates").
--
-- * The database now decides which Version a new copy may take, as the API checks it: the
--   latest Version of an active template of the Project, for the item's Trade, read under a
--   share lock on the template, so an edit or a retirement committing meanwhile waits for the
--   copy, or the copy sees it (a lock per check-then-write). The one exception is a Revision's
--   pick, carried from the item it revises by app.fill_revision: it may copy the Version that
--   item holds, edited or retired since.
-- * A missing copy is filled in, after the first Submit too: an item whose pick has no copy
--   (a Revision Submitted without a save) gets the Version its answer names, which is no change
--   of the pick. Only replacing or deleting an existing copy is refused after the first Submit.
--   The API also copies a new Revision's pick when it creates it.

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
        insert into work_item_checklist (work_item_id, field_key, checklist_template_version_id, name, items, copied_at)
        values (p_work_item_id, v_key, v_version.id, v_version.name, v_version.items, greatest(p_now, now()))
        on conflict (work_item_id, field_key) do update
          set checklist_template_version_id = excluded.checklist_template_version_id, name = excluded.name,
              items = excluded.items, copied_at = excluded.copied_at;
      end loop;
      return 'synced';
    end
  $$;
