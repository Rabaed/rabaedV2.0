-- A link question keeps the items it already holds (RP-293 review, spec RP-289;
-- form-engine.md part 2b).
--
-- As 20261023000000_link_question.sql, except that an id the answer already
-- holds in that field (`p_before`) stays acceptable on re-save while the saver
-- still sees it and it is in the Project, even if it has since gone back to a
-- Draft. A new choice still needs Link search's rule (app.work_item_submitted).
-- So Save draft never fails on an earlier choice its target's raiser has taken
-- back. Anything else is refused as before, alike: `target_not_found`.
--
-- Hidden choices are unchanged: an item the saver can't see comes back only as
-- {document_number, subject}, matched among the items the answer holds; its id,
-- even one held, is refused like a made-up one.

create or replace function app.resolve_link_answers(
  p_work_item_id uuid, p_project_id uuid, p_form_version_id uuid, p_before jsonb, p_data jsonb
) returns jsonb
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_key text;
      v_held jsonb;
      v_choice jsonb;
      v_id uuid;
      v_ids uuid[];
      v_data jsonb := p_data;
    begin
      for v_key in select app.link_question_keys(p_form_version_id) loop
        continue when not (p_data ? v_key);
        if jsonb_typeof(p_data -> v_key) <> 'array' then
          return null;
        end if;
        v_held := case when jsonb_typeof(p_before -> v_key) = 'array' then p_before -> v_key else '[]' end;
        v_ids := '{}';
        for v_choice in select e from jsonb_array_elements(p_data -> v_key) e loop
          v_id := null;
          if jsonb_typeof(v_choice) = 'string' then
            v_id := app.uuid_or_null(v_choice);
            if v_id = p_work_item_id
              or not exists (select 1 from work_item t where t.id = v_id and t.project_id = p_project_id)
              or not (app.work_item_submitted(v_id) or (app.sees_work_item(v_id)
                and exists (select 1 from jsonb_array_elements(v_held) h where app.uuid_or_null(h) = v_id)))
            then
              v_id := null;
            end if;
          elsif jsonb_typeof(v_choice) = 'object' and jsonb_typeof(v_choice -> 'document_number') = 'string' then
            select t.id into v_id
            from jsonb_array_elements(v_held) h
            join work_item t on t.id = app.uuid_or_null(h)
            where t.project_id = p_project_id and t.document_number = v_choice ->> 'document_number'
              and not app.sees_work_item(t.id);
          end if;
          if v_id is null or v_id = any (v_ids) then
            return null;
          end if;
          v_ids := v_ids || v_id;
        end loop;
        v_data := jsonb_set(v_data, array[v_key], to_jsonb(v_ids));
      end loop;
      return v_data;
    end
  $$;

revoke all on function app.resolve_link_answers(uuid, uuid, uuid, jsonb, jsonb) from public;
