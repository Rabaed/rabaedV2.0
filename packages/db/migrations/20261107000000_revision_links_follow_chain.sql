-- Links follow the Revision drop-down (RP-311 review; workflow-engine.md §5.4,
-- visibility.md the Revisions, Links and Linked from channels, V1, V2, E1, E3).
--
-- The engine's `related` Link from a revised item to its Revision (added at the
-- Revision's first Submit, create_revision migration) showed the Revision's
-- Document Number and Subject to a reader who sees the revised item but not the
-- Revision (Rev 1 moved to a Location they don't cover), while
-- app.revision_chain leaves it out. Settled with the user: hide it. Every Link
-- read now leaves out an item of the reading item's own chain that the reader
-- can't see, so the Links and the drop-down agree. Items of other chains keep E1
-- and E3 (number and Subject without the id).
--
-- * app.chain_item_hidden(item, other): `other` is another item of `item`'s
--   chain (same root_id) and the acting Member can't see it.
-- * app.work_item_links (the Links System Field and every link question's Links)
--   and app.work_item_linked_from leave such an item out. Linked from also
--   leaves out a discarded Revision explicitly (one never leaves Draft, so it
--   was already left out as a Draft).
-- * app.work_item_answers reads each link question through
--   app.link_choices_as_seen(item, project, ids), which leaves such an item out
--   (instead of giving its number and Subject); the two-argument version goes.
-- * app.resolve_link_answers: a saver who can't see such an item never sends it
--   back, so it is kept where the answer held it rather than removed.

create function app.chain_item_hidden(p_work_item_id uuid, p_other_id uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1 from work_item w
      join work_item o on o.root_id = w.root_id and o.project_id = w.project_id
      where w.id = p_work_item_id and o.id = p_other_id and o.id <> w.id
    ) and not app.sees_work_item(p_other_id)
  $$;

-- As in the work_item_links migration, without a hidden item of the same chain.
create or replace function app.work_item_links(p_work_item_id uuid)
  returns table (
    id uuid, kind text, field_key text, document_number text, subject text, work_item_id uuid, created_at timestamptz
  )
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select l.id, l.kind, l.field_key, t.document_number, t.title,
      case when app.sees_work_item(t.id) then t.id end, l.created_at
    from work_item_link l
    join work_item t on t.id = l.to_id
    where l.from_id = p_work_item_id and app.sees_work_item(p_work_item_id)
      and not app.chain_item_hidden(p_work_item_id, t.id)
    order by l.created_at, l.id
  $$;

-- As in the linked_from migration, without a hidden item of the same chain or a
-- discarded Revision.
create or replace function app.work_item_linked_from(p_work_item_id uuid)
  returns table (document_number text, subject text, work_item_id uuid)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select f.document_number, f.title, case when app.sees_work_item(f.id) then f.id end
    from work_item f
    where f.id in (select l.from_id from work_item_link l where l.to_id = p_work_item_id)
      and not app.is_draft_step(f.participant_entered_step_id)
      and f.discarded_at is null
      and app.sees_work_item(p_work_item_id)
      and not app.chain_item_hidden(p_work_item_id, f.id)
    order by f.document_number, f.id
  $$;

-- As the two-argument version (link_question migration), read from item
-- `p_work_item_id`: a hidden item of its own chain is left out.
create function app.link_choices_as_seen(p_work_item_id uuid, p_project_id uuid, p_ids jsonb) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select coalesce(jsonb_agg(
      case when app.sees_work_item(t.id) then to_jsonb(t.id)
        else jsonb_build_object('document_number', t.document_number, 'subject', t.title) end
      order by e.n), '[]')
    from jsonb_array_elements(p_ids) with ordinality e (v, n)
    join work_item t on t.id = app.uuid_or_null(e.v) and t.project_id = p_project_id
    where not app.chain_item_hidden(p_work_item_id, t.id)
  $$;

-- As in the consultant_section migration, with the three-argument
-- app.link_choices_as_seen; jit off as the answer_permission_speed migration set it.
create or replace function app.work_item_answers(p_work_item_id uuid) returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, public
  set jit = off
  as $$
    select (a.src - array(
      select f ->> 'key'
      from form_version v
      cross join lateral jsonb_array_elements(v.schema -> 'sections') s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      where v.id = w.form_version_id
        and f ->> 'type' in ('member', 'participant')
        and a.src ? (f ->> 'key')
        and not case f ->> 'type'
          when 'member' then exists (
            select 1 from member m
            where m.id::text = a.src ->> (f ->> 'key') and jsonb_typeof(a.src -> (f ->> 'key')) = 'string'
              and m.company_id = app.current_company_id())
          when 'participant' then exists (
            select 1 from participant p
            join project pr on pr.id = p.project_id
            where p.id::text = a.src ->> (f ->> 'key') and jsonb_typeof(a.src -> (f ->> 'key')) = 'string'
              and p.project_id = w.project_id
              and (p.company_id = app.current_company_id() or p.company_id = pr.host_company_id
                or p.id in (select c.participant_id from app.work_item_companies(w.id) c)))
        end
    ) - array(select app.link_question_keys(w.form_version_id)))
    || coalesce((
      select jsonb_object_agg(k, app.link_choices_as_seen(w.id, w.project_id, a.src -> k))
      from app.link_question_keys(w.form_version_id) k
      where jsonb_typeof(a.src -> k) = 'array'
    ), '{}')
    from work_item w
    cross join lateral (select app.work_item_answers_unstripped(w.id) as src) a
    where w.id = p_work_item_id and app.sees_work_item(w.id)
  $$;

drop function app.link_choices_as_seen(uuid, jsonb);

-- As in the link_question_kept_choices migration, except that a held item of the
-- item's own chain the saver can't see (which their read left out) is kept at
-- its place in the answer.
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
      v_n bigint;
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
        -- The chain's items the saver couldn't read, back where they were.
        for v_id, v_n in
          select app.uuid_or_null(h.v), h.n from jsonb_array_elements(v_held) with ordinality h (v, n)
          where app.chain_item_hidden(p_work_item_id, app.uuid_or_null(h.v))
          order by h.n
        loop
          continue when v_id = any (v_ids);
          v_ids := v_ids[1:v_n - 1] || v_id || v_ids[v_n:];
        end loop;
        v_data := jsonb_set(v_data, array[v_key], to_jsonb(v_ids));
      end loop;
      return v_data;
    end
  $$;

revoke all on function
  app.chain_item_hidden(uuid, uuid),
  app.link_choices_as_seen(uuid, uuid, jsonb)
  from public;
