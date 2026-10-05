-- Autosave in Draft, with per-field times (RP-302, spec RP-299; form-engine.md
-- §8, "Settled 2026-10-05 (part 3)").
--
-- * work_item.field_times holds, beside the answers (work_item.data and the
--   Built-in Fields), when each field was last changed and by whom:
--   { "<field key>": { "at": <timestamptz>, "by": <member id>, "h": <md5 of the value> } }.
--   `h` lets app.record_field_times tell a changed field from an unchanged one
--   without keeping the old answers. rabaed_app is granted no select on the
--   column: the times come out only through app.work_item_field_times, to a Member
--   who may save.
-- * app.work_item_field_times returns the item's field times (to a Member who may save) and, with p_lock, first locks the item (names
--   only for people of the saver's own Company, V14), so the API merges the
--   save against exactly the answers it is about to overwrite.
-- * app.record_field_times, called by the API in the same transaction after
--   app.save_work_item_answers (or app.create_work_item), stamps every field
--   whose value changed and forgets the removed ones. It is separate from
--   app.save_work_item_answers so that function stays as other tickets leave it.
-- * app.answers_autosave: whether the web autosaves this item now. Only in the
--   first Draft, where saves write no answers_changed events; a Draft it was
--   Returned to records every save, so only its button saves.

alter table work_item add column field_times jsonb not null default '{}'::jsonb
  check (jsonb_typeof(field_times) = 'object');

create function app.work_item_field_times(p_work_item_id uuid, p_lock boolean default false) returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_times jsonb;
    begin
      if not app.sees_work_item(p_work_item_id) or not app.can_save_answers(p_work_item_id) then
        return null;
      end if;
      if p_lock then
        select w.field_times into v_times from work_item w where w.id = p_work_item_id for update;
      else
        select w.field_times into v_times from work_item w where w.id = p_work_item_id;
      end if;
      return coalesce((
        select jsonb_object_agg(t.key, jsonb_build_object(
          'at', to_char(((t.value ->> 'at')::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'by', t.value ->> 'by',
          'name', m.full_name))
        from jsonb_each(v_times) t
        left join member m on m.id = app.uuid_or_null(t.value -> 'by') and m.company_id = app.current_company_id()
      ), '{}'::jsonb);
    end
  $$;

create function app.record_field_times(p_work_item_id uuid, p_now timestamptz) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_old jsonb;
      v_new jsonb;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      select w.field_times into v_old from work_item w where w.id = p_work_item_id for update;
      select coalesce(jsonb_object_agg(a.key,
        case when v_old -> a.key ->> 'h' = md5(a.value::text) then v_old -> a.key
        else jsonb_build_object('at', v_at, 'by', app.current_member_id(), 'h', md5(a.value::text)) end), '{}'::jsonb)
      into v_new
      from jsonb_each(app.work_item_full_answers(p_work_item_id)) a;
      update work_item set field_times = v_new where id = p_work_item_id;
    end
  $$;

create function app.answers_autosave(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.can_save_answers(p_work_item_id)
      and exists (select 1 from work_item w where w.id = p_work_item_id and app.is_draft_step(w.current_step_id))
      and not exists (
        select 1 from work_item_event e
        where e.work_item_id = p_work_item_id and e.type = 'transition' and app.is_draft_step(e.from_step_id)
      )
  $$;
