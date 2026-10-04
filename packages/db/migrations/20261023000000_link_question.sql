-- The link question, `work_item_ref` (RP-293, spec RP-289; form-engine.md part
-- 2b; ADR 0012 as amended 2026-10-05; visibility.md E1 and scenario 31).
--
-- * Its answer is a list of Work Item ids, stored in the answers (so in the
--   hash). Each is also a `relies_on` Link carrying the field's key: on every
--   answer save, app.save_work_item_answers makes the field's Links match the
--   answer exactly, in the same transaction (added in the order chosen, removed
--   when no longer chosen, all of them when the field is cleared). Links change
--   with the answers, so only until Submit (app.can_save_answers).
-- * A newly chosen item must be one Link search could have offered the saver
--   (app.work_item_submitted: visible to them, Submitted), in the same Project,
--   never the item itself. Anything else is refused alike: `target_not_found`,
--   the free Links' answer, with nothing changed.
-- * app.work_item_answers gains the `work_item_ref` rule: a chosen item the
--   caller sees stays as its id; one they can't see is replaced by
--   {document_number, subject}, never its id, and never dropped (E1). An id that
--   names no item of the Project is dropped. `member` and `participant`
--   references are stripped as before.
-- * Saved back as it was read, an answer keeps the hidden items it held: each
--   {document_number, subject} is matched to the item it stands for among those
--   the answer already holds, and the caller can't see. One that matches none is
--   refused like any other. So a filler who can't see a chosen item may keep or
--   remove it, but never learn its id, nor choose it anew.
-- * Field-level history (after Draft) records a link question's old and new
--   items as Document Number and Subject, never ids, like the free Links' `$links`.

-- A JSON string holding a uuid, as that uuid; null for anything else.
create function app.uuid_or_null(p_value jsonb) returns uuid
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select case when jsonb_typeof(p_value) = 'string' and pg_input_is_valid(p_value #>> '{}', 'uuid')
      then (p_value #>> '{}')::uuid end
  $$;

-- The keys of a Form Version's link questions, in every section, shown or not.
create function app.link_question_keys(p_form_version_id uuid) returns setof text
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select f ->> 'key'
    from form_version v
    cross join lateral jsonb_array_elements(v.schema -> 'sections') s
    cross join lateral jsonb_array_elements(s -> 'fields') f
    where v.id = p_form_version_id and f ->> 'type' = 'work_item_ref'
  $$;

-- A link question's stored ids as the acting Member may read them: an item they
-- see by its id, any other by its Document Number and Subject, in the order
-- chosen. Anything that names no item of the Project is left out.
create function app.link_choices_as_seen(p_project_id uuid, p_ids jsonb) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select coalesce(jsonb_agg(
      case when app.sees_work_item(t.id) then to_jsonb(t.id)
        else jsonb_build_object('document_number', t.document_number, 'subject', t.title) end
      order by e.n), '[]')
    from jsonb_array_elements(p_ids) with ordinality e (v, n)
    join work_item t on t.id = app.uuid_or_null(e.v) and t.project_id = p_project_id
  $$;

-- A link question's stored ids as its history records them: Document Number and
-- Subject, in the order chosen, never an id.
create function app.link_choices_record(p_ids jsonb) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select coalesce(jsonb_agg(jsonb_build_object('documentNumber', t.document_number, 'subject', t.title) order by e.n), '[]')
    from jsonb_array_elements(p_ids) with ordinality e (v, n)
    join work_item t on t.id = app.uuid_or_null(e.v)
  $$;

-- Answers with each link question's ids as history records them.
create function app.link_answers_recorded(p_form_version_id uuid, p_answers jsonb) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select p_answers || coalesce(jsonb_object_agg(k, app.link_choices_record(p_answers -> k)), '{}')
    from app.link_question_keys(p_form_version_id) k
    where jsonb_typeof(p_answers -> k) = 'array'
  $$;

-- The answers to save, `p_data`, with each link question's items as ids: an id
-- the acting Member could have found with Link search (Submitted, visible, same
-- Project, not the item itself), or {document_number, subject} standing for an
-- item the answer already holds (`p_before`) and the Member can't see. Null when
-- any item is neither, or chosen twice.
create function app.resolve_link_answers(
  p_work_item_id uuid, p_project_id uuid, p_form_version_id uuid, p_before jsonb, p_data jsonb
) returns jsonb
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_key text;
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
        v_ids := '{}';
        for v_choice in select e from jsonb_array_elements(p_data -> v_key) e loop
          v_id := null;
          if jsonb_typeof(v_choice) = 'string' then
            v_id := app.uuid_or_null(v_choice);
            if v_id = p_work_item_id or not app.work_item_submitted(v_id)
              or not exists (select 1 from work_item t where t.id = v_id and t.project_id = p_project_id)
            then
              v_id := null;
            end if;
          elsif jsonb_typeof(v_choice) = 'object' and jsonb_typeof(v_choice -> 'document_number') = 'string' then
            select t.id into v_id
            from jsonb_array_elements(case when jsonb_typeof(p_before -> v_key) = 'array' then p_before -> v_key else '[]' end) h
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

-- Each item chosen in the link questions of resolved answers `p_data`: its
-- field key, its id and its place in the answer.
create function app.link_answer_choices(p_form_version_id uuid, p_data jsonb)
  returns table (field_key text, to_id uuid, n bigint)
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select k, app.uuid_or_null(e.v), e.n
    from app.link_question_keys(p_form_version_id) k
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p_data -> k) = 'array' then p_data -> k else '[]' end) with ordinality e (v, n)
  $$;

-- Makes the item's `relies_on` Links equal to its link questions' answers in
-- `p_data` (resolved): one per (field key, item), new ones in the order chosen.
create function app.sync_link_answers(p_work_item_id uuid, p_project_id uuid, p_form_version_id uuid, p_data jsonb, p_at timestamptz)
  returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    begin
      delete from work_item_link l
      where l.from_id = p_work_item_id and l.kind = 'relies_on' and not exists (
        select 1 from app.link_answer_choices(p_form_version_id, p_data) c
        where c.field_key = l.field_key and c.to_id = l.to_id);
      insert into work_item_link (project_id, from_id, to_id, kind, field_key, created_by_member_id, created_at)
      select p_project_id, p_work_item_id, c.to_id, 'relies_on', c.field_key, app.current_member_id(), p_at
      from app.link_answer_choices(p_form_version_id, p_data) c
      where not exists (
        select 1 from work_item_link l
        where l.from_id = p_work_item_id and l.kind = 'relies_on' and l.field_key = c.field_key and l.to_id = c.to_id)
      order by c.field_key, c.n;
    end
  $$;

-- As in the answers stripping migration, plus the `work_item_ref` rule: each
-- link question's items as app.link_choices_as_seen gives them.
create or replace function app.work_item_answers(p_work_item_id uuid) returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select (app.work_item_full_answers(w.id) - array(
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
    ) - array(select app.link_question_keys(w.form_version_id)))
    || coalesce((
      select jsonb_object_agg(k, app.link_choices_as_seen(w.project_id, w.data -> k))
      from app.link_question_keys(w.form_version_id) k
      where jsonb_typeof(w.data -> k) = 'array'
    ), '{}')
    from work_item w
    where w.id = p_work_item_id and app.sees_work_item(w.id)
  $$;

-- As in the answers stripping migration, with the link questions: their items
-- resolved and checked (app.resolve_link_answers; 'target_not_found' otherwise),
-- their Links made to match, and their history recorded as Document Number and
-- Subject.
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
      v_data jsonb;
      v_before jsonb;
      v_after jsonb;
      v_recorded_before jsonb;
      v_recorded_after jsonb;
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
      v_data := app.resolve_link_answers(
        p_work_item_id, v_item.project_id, v_item.form_version_id, v_before, coalesce(p_data, '{}') - array['trade', 'location', 'scopes']);
      if v_data is null then
        return 'target_not_found';
      end if;
      perform app.set_work_item_built_ins(p_work_item_id, v_item.project_id, p_trade_id, p_location_id, p_scope_ids);
      update work_item set data = v_data, updated_at = v_at
      where id = p_work_item_id;
      perform app.sync_link_answers(p_work_item_id, v_item.project_id, v_item.form_version_id, v_data, v_at);

      -- Once it has left Draft, every change is on the record (a Draft it was
      -- Returned to included), inside the raiser (V5).
      if exists (
        select 1 from work_item_event e
        where e.work_item_id = p_work_item_id and e.type = 'transition' and app.is_draft_step(e.from_step_id)
      ) then
        v_after := app.work_item_full_answers(p_work_item_id);
        v_recorded_before := app.link_answers_recorded(v_item.form_version_id, v_before);
        v_recorded_after := app.link_answers_recorded(v_item.form_version_id, v_after);
        select jsonb_agg(jsonb_build_object('field', k, 'old', v_recorded_before -> k, 'new', v_recorded_after -> k) order by k)
        into v_changes
        from (select jsonb_object_keys(v_before) union select jsonb_object_keys(v_after)) as keys (k)
        where (v_recorded_before -> k) is distinct from (v_recorded_after -> k);
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

revoke all on function
  app.uuid_or_null(jsonb),
  app.link_answer_choices(uuid, jsonb),
  app.link_question_keys(uuid),
  app.link_choices_as_seen(uuid, jsonb),
  app.link_choices_record(jsonb),
  app.link_answers_recorded(uuid, jsonb),
  app.resolve_link_answers(uuid, uuid, uuid, jsonb, jsonb),
  app.sync_link_answers(uuid, uuid, uuid, jsonb, timestamptz)
  from public;
