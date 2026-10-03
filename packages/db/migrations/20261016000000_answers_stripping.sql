-- Form answers are read only through one function that strips every reference
-- the reader may not see (ADR 0012, RP-275; visibility.md "Form answers", V14, V15).
--
-- * The app role loses work_item.data: RLS works on whole rows, so once another
--   Company sees an item it could read the ids its answers hold.
-- * app.work_item_answers, the one reading function, is now security definer.
--   It re-checks that the caller sees the item (null otherwise) and returns the
--   answers with the Built-in Fields, as before, less every reference the caller
--   may not see, found by the item's pinned Form Version schema (every field of
--   every section, shown or hidden by a condition):
--   - a `member` answer naming anyone but a Member of the caller's own Company;
--   - a `participant` answer naming a Participant other than the caller's own,
--     the Host Company's or one on the item (app.work_item_companies).
--   An answer that names nobody is stripped too. `table` columns hold no references.
-- * app.work_item_full_answers keeps the full answers for the functions that need
--   them (never granted): app.answers_sha256 and app.take_transition still hash
--   the unstripped document, so hashes and the hash chain are unchanged.
-- * A new field type that stores an id adds its strip rule here, with a seam-2
--   test (ADR 0012, Consequences).

revoke select (data) on work_item from rabaed_app;

-- The full answers, Built-in Fields included, exactly as app.work_item_answers
-- returned them before. Only security definer functions call it.
create function app.work_item_full_answers(p_work_item_id uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select (w.data - array['trade', 'location', 'scopes']) || jsonb_strip_nulls(jsonb_build_object(
      'trade', (
        select dv.dimension_value_id from work_item_dimension_value dv
        join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'trade'
        where dv.work_item_id = w.id),
      'location', (
        select dv.dimension_value_id from work_item_dimension_value dv
        join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'location'
        where dv.work_item_id = w.id),
      'scopes', (select jsonb_agg(s.scope_id order by s.scope_id) from work_item_scope s where s.work_item_id = w.id)
    ))
    from work_item w where w.id = p_work_item_id
  $$;

-- A visible item's answers as the acting Member may read them: the full answers
-- less every `member` and `participant` answer naming someone they may not see.
-- Null for an item they can't see.
create or replace function app.work_item_answers(p_work_item_id uuid) returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.work_item_full_answers(w.id) - array(
      select f ->> 'key'
      from form_version v
      cross join lateral jsonb_array_elements(v.schema -> 'sections') s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      where v.id = w.form_version_id
        and f ->> 'type' in ('member', 'participant')
        and w.data ? (f ->> 'key')
        and not case f ->> 'type'
          when 'member' then exists (
            select 1 from member m
            where m.id::text = w.data ->> (f ->> 'key') and jsonb_typeof(w.data -> (f ->> 'key')) = 'string'
              and m.company_id = app.current_company_id())
          when 'participant' then exists (
            select 1 from participant p
            join project pr on pr.id = p.project_id
            where p.id::text = w.data ->> (f ->> 'key') and jsonb_typeof(w.data -> (f ->> 'key')) = 'string'
              and p.project_id = w.project_id
              and (p.company_id = app.current_company_id() or p.company_id = pr.host_company_id
                or p.id in (select c.participant_id from app.work_item_companies(w.id) c)))
        end
    )
    from work_item w
    where w.id = p_work_item_id and app.sees_work_item(w.id)
  $$;

-- As before (the full answers), and only for an item the caller sees.
create or replace function app.answers_sha256(p_work_item_id uuid) returns bytea
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select sha256(convert_to(app.work_item_full_answers(p_work_item_id)::text, 'UTF8'))
    where app.sees_work_item(p_work_item_id)
  $$;

-- As in the answers_history migration, diffing and hashing the full answers
-- (the diff stays internal to the raiser, V5), not the saver's stripped reading.
create or replace function app.save_work_item_answers(
  p_work_item_id uuid, p_data jsonb, p_trade_id uuid, p_location_id uuid, p_scope_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_outcome text;
      v_before jsonb;
      v_after jsonb;
      v_changes jsonb;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- Locked, so a Transition onwards checks exactly the answers it moves with.
      select w.*, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      if not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;
      v_outcome := app.check_work_item_built_ins(
        p_work_item_id, v_item.project_id, v_me.project_member_id, p_trade_id, p_location_id, p_scope_ids);
      if v_outcome <> 'ok' then
        return v_outcome;
      end if;
      v_before := app.work_item_full_answers(p_work_item_id);
      perform app.set_work_item_built_ins(p_work_item_id, v_item.project_id, p_trade_id, p_location_id, p_scope_ids);
      update work_item set data = coalesce(p_data, '{}') - array['trade', 'location', 'scopes'], updated_at = v_at
      where id = p_work_item_id;

      -- Once it has left Draft, every change is on the record (a Draft it was
      -- Returned to included), inside the raiser (V5).
      if exists (
        select 1 from work_item_event e
        where e.work_item_id = p_work_item_id and e.type = 'transition' and app.is_draft_step(e.from_step_id)
      ) then
        v_after := app.work_item_full_answers(p_work_item_id);
        select jsonb_agg(jsonb_build_object('field', k, 'old', v_before -> k, 'new', v_after -> k) order by k)
        into v_changes
        from (select jsonb_object_keys(v_before) union select jsonb_object_keys(v_after)) as keys (k)
        where (v_before -> k) is distinct from (v_after -> k);
        if v_changes is not null then
          insert into work_item_event (
            project_id, work_item_id, type, actor_member_id, actor_participant_id, payload,
            audience, audience_participant_id, content_sha256, created_at
          ) values (
            v_item.project_id, p_work_item_id, 'answers_changed', app.current_member_id(), v_me.participant_id,
            jsonb_build_object('changes', v_changes), 'internal', v_item.raised_by_participant_id,
            sha256(convert_to(v_after::text, 'UTF8')), v_at
          );
        end if;
      end if;
      return 'saved';
    end
  $$;

revoke all on function app.work_item_full_answers(uuid) from public;
revoke all on function app.answers_sha256(uuid) from public;
grant execute on function app.answers_sha256(uuid) to rabaed_app;
