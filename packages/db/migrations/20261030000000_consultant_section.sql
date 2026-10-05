-- The Consultant fills its own Form Section, hidden until the item leaves it
-- (RP-304, spec RP-299; form-engine.md §4 "Settled 2026-10-05 (part 3)";
-- visibility.md V19, scenarios 47 and 50; ADR 0013).
--
-- * app.can_save_answers: as before for the raiser while its answers are open
--   (Draft and its internal Steps), or, once Submitted, any active Member who
--   sees the item, of the Participant holding its current Step, when a Form
--   Section names that Step in `editable_at` (app.answers_held). The raiser's
--   Participant never saves from Submit onwards (until a Return to Draft, as before).
-- * app.editable_section_keys: the sections the acting Member may change now,
--   as packages/domain editableSections works them out: a section's Steps are
--   its `editable_at`, or else the Steps of the Draft Step's role (only while
--   the answers are open to the raiser).
-- * app.save_work_item_answers refuses as a whole ('not_editable') a save that
--   changes, against what the saver reads, a field (not calculated) of a section
--   not editable now: the database's copy of the API's check (RP-301). The fields
--   of those sections keep their stored values, so a reference stripped from the
--   saver's reading (ADR 0012) is never lost; the Built-in Fields are neither
--   checked nor written when their section isn't editable. Each answers_changed
--   event is internal to the saver's Participant (before: always the raiser's).
-- * "As arrived" (ADR 0013): work_item.data_as_arrived keeps the full answers as
--   they were when the item arrived at the Participant holding it, taken by the
--   first save after it arrived. A trigger clears it whenever the item leaves
--   that Participant (participant_entered_* change) or closes, so the answers it
--   carries are everyone's again. Never granted to the app role.
-- * app.work_item_answers and app.work_item_named_answers read
--   app.work_item_answers_unstripped: the live answers to the holding
--   Participant, the answers as arrived to everyone else. Stripping (ADR 0012)
--   applies on top, as before. Hashes (answers_changed, the Transition event's
--   content hash) are still over the full, live answers.
-- * app.answers_sha256 answers to whoever may save now (before: while the
--   answers are open): the full answers to the raiser, as before; to another
--   holder, the answers as it reads them, so a hash never confirms a reference
--   stripped from it. The Transition check against it is the next migration.
-- * app.work_item_field_times returns only the stamps of the caller's own
--   Company's Members (V14): another Company's people are never identified, not
--   even by an id.
-- * app.start_document_upload refuses ('not_editable') a file for a field of a
--   section not editable now.

alter table work_item add column data_as_arrived jsonb
  check (data_as_arrived is null or jsonb_typeof(data_as_arrived) = 'object');

-- Whenever the item leaves the Participant holding it, or closes, its answers are shared.
create function app.share_answers_on_leaving() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    begin
      if new.participant_entered_at is distinct from old.participant_entered_at
        or new.participant_entered_step_id is distinct from old.participant_entered_step_id
        or (new.closed_at is not null and old.closed_at is null)
      then
        new.data_as_arrived := null;
      end if;
      return new;
    end
  $$;

create trigger work_item_share_answers_on_leaving
  before update on work_item
  for each row execute function app.share_answers_on_leaving();

-- Who holds the item ---------------------------------------------------------------

-- Whether the acting Member's Participant holds the item's current Step.
create function app.holds_work_item(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1 from step_assignment a
      where a.work_item_id = p_work_item_id and a.status in ('pooled', 'claimed', 'vacant')
        and a.participant_id in (select app.current_participant_ids())
    )
  $$;

-- The full answers the acting Member reads, before stripping: live to the
-- Participant holding the item, as they arrived there to everyone else (V19).
-- Only security definer functions call it.
create function app.work_item_answers_unstripped(p_work_item_id uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select case when w.data_as_arrived is not null and not app.holds_work_item(w.id) then w.data_as_arrived
      else app.work_item_full_answers(w.id) end
    from work_item w where w.id = p_work_item_id
  $$;

-- Who may save, and into what --------------------------------------------------------

-- Whether the acting Member may save a visible, Submitted item's answers at its
-- current Step as a Member of the Participant holding it (not the raiser's), a
-- Form Section naming that Step.
create function app.answers_held(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.sees_work_item(p_work_item_id) and exists (
      select 1 from work_item w
      join project pr on pr.id = w.project_id and pr.status = 'active'
      join workflow_step cur on cur.id = w.current_step_id
      join form_version v on v.id = w.form_version_id
      cross join lateral app.acting_project_member(w.id) me
      join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'claimed', 'vacant')
        and a.participant_id = me.participant_id
      where w.id = p_work_item_id and w.closed_at is null
        and not app.is_draft_step(w.participant_entered_step_id)
        and me.participant_id <> w.raised_by_participant_id
        and exists (select 1 from jsonb_array_elements(v.schema -> 'sections') s where (s -> 'editable_at') ? cur.key)
    )
  $$;

-- As in the answers_history migration (the raiser, while its answers are open),
-- or as app.answers_held.
create or replace function app.can_save_answers(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select (app.answers_open(p_work_item_id) and exists (
      select 1 from work_item w
      cross join lateral app.acting_project_member(w.id) me
      where w.id = p_work_item_id and me.participant_id = w.raised_by_participant_id
    )) or app.answers_held(p_work_item_id)
  $$;

-- The keys of the Form Sections the acting Member may change now (none unless
-- they may save): those whose Steps include the current one. A section without
-- `editable_at` is the raiser's, at the Steps of the Draft Step's role.
create function app.editable_section_keys(p_work_item_id uuid) returns setof text
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select s ->> 'key'
    from work_item w
    join form_version v on v.id = w.form_version_id
    join workflow_step cur on cur.id = w.current_step_id
    cross join lateral jsonb_array_elements(v.schema -> 'sections') s
    where w.id = p_work_item_id and app.can_save_answers(p_work_item_id)
      and case when s ? 'editable_at' then (s -> 'editable_at') ? cur.key
        else app.answers_open(w.id) and cur.actor_rule ->> 'base_role' = (
          select d.actor_rule ->> 'base_role' from workflow_step d
          where d.workflow_version_id = w.workflow_version_id and app.is_draft_step(d.id)
          limit 1)
      end
  $$;

-- The keys of the fields, calculated ones aside, of the sections the acting
-- Member may not change now: a save must bring them back as they read them.
create function app.locked_field_keys(p_work_item_id uuid) returns text[]
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select coalesce(array_agg(f ->> 'key'), '{}')
    from work_item w
    join form_version v on v.id = w.form_version_id
    cross join lateral jsonb_array_elements(v.schema -> 'sections') s
    cross join lateral jsonb_array_elements(s -> 'fields') f
    where w.id = p_work_item_id and f ->> 'type' <> 'calculated'
      and (s ->> 'key') not in (select app.editable_section_keys(p_work_item_id))
  $$;

-- An answer as two answers compare (packages/domain changedOutside): none when
-- unanswered (null, "", []), a list of plain values in any order, an object
-- without its unanswered members.
create function app.answer_canonical(p_value jsonb) returns jsonb
  language plpgsql immutable
  set search_path = pg_catalog, public
  as $$
    begin
      if p_value is null or p_value in ('null'::jsonb, '""'::jsonb, '[]'::jsonb) then
        return null;
      elsif jsonb_typeof(p_value) = 'array' then
        if exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) in ('object', 'array')) then
          return (select jsonb_agg(coalesce(app.answer_canonical(e), 'null'::jsonb) order by n)
            from jsonb_array_elements(p_value) with ordinality x (e, n));
        end if;
        return (select jsonb_agg(e order by e::text) from jsonb_array_elements(p_value) e);
      elsif jsonb_typeof(p_value) = 'object' then
        return coalesce((
          select jsonb_object_agg(k, c)
          from (select k, app.answer_canonical(v) as c from jsonb_each(p_value) x (k, v)) y
          where c is not null), '{}'::jsonb);
      end if;
      return p_value;
    end
  $$;

-- Reading the answers ---------------------------------------------------------------

-- As in the link_question migration, over app.work_item_answers_unstripped.
create or replace function app.work_item_answers(p_work_item_id uuid) returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, public
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
      select jsonb_object_agg(k, app.link_choices_as_seen(w.project_id, a.src -> k))
      from app.link_question_keys(w.form_version_id) k
      where jsonb_typeof(a.src -> k) = 'array'
    ), '{}')
    from work_item w
    cross join lateral (select app.work_item_answers_unstripped(w.id) as src) a
    where w.id = p_work_item_id and app.sees_work_item(w.id)
  $$;

-- As in the form_member_participant migration, over app.work_item_answers_unstripped.
create or replace function app.work_item_named_answers(p_work_item_id uuid)
  returns table (field_key text, field_type text, company_name jsonb, member_name jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    with answer as (
      select f ->> 'key' as field_key, f ->> 'type' as field_type, a.src ->> (f ->> 'key') as value, w.project_id
      from work_item w
      cross join lateral (select app.work_item_answers_unstripped(w.id) as src) a
      join form_version v on v.id = w.form_version_id
      cross join lateral jsonb_array_elements(v.schema -> 'sections') s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      where w.id = p_work_item_id and app.sees_work_item(p_work_item_id)
        and f ->> 'type' in ('member', 'participant')
        and jsonb_typeof(a.src -> (f ->> 'key')) = 'string'
    ),
    named as (
      -- The Participant each answer names: itself, or the Member's Company's on the Project.
      select a.field_key, a.field_type, a.project_id, p.id as participant_id, p.company_id, m.full_name
      from answer a
      left join member m on a.field_type = 'member' and m.id::text = a.value
      left join participant p on p.project_id = a.project_id and (
        (a.field_type = 'participant' and p.id::text = a.value)
        or (a.field_type = 'member' and p.company_id = m.company_id)
      )
    )
    select n.field_key, n.field_type,
      case when n.company_id = app.current_company_id()
        or n.company_id = (select pr.host_company_id from project pr where pr.id = n.project_id)
        or n.participant_id in (select c.participant_id from app.work_item_companies(p_work_item_id) c)
      then co.legal_name end,
      case when n.field_type = 'member' and n.company_id = app.current_company_id() then n.full_name end
    from named n
    left join company co on co.id = n.company_id
  $$;

-- As in the field_documents migration, to whoever may save now: the full answers
-- to the raiser while they are open, otherwise the answers as the saver reads them.
create or replace function app.answers_sha256(p_work_item_id uuid) returns bytea
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select sha256(convert_to(
      (case when app.answers_open(p_work_item_id) then app.work_item_full_answers(p_work_item_id)
        else app.work_item_answers(p_work_item_id) end)::text || coalesce((
      select string_agg(d.field_key || ':' || d.id::text, ',' order by d.field_key, d.id)
      from document d
      where d.work_item_id = p_work_item_id and d.field_key is not null
        and d.confirmed_at is not null and d.removed_at is null
    ), ''), 'UTF8'))
    where app.can_save_answers(p_work_item_id)
  $$;

-- As in the answers_field_times migration, with the stamps of the caller's own Company's Members only.
create or replace function app.work_item_field_times(p_work_item_id uuid, p_lock boolean default false) returns jsonb
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
        join member m on m.id = app.uuid_or_null(t.value -> 'by') and m.company_id = app.current_company_id()
      ), '{}'::jsonb);
    end
  $$;

-- Saving the answers -----------------------------------------------------------------

-- As in the link_question migration, now into the sections editable now only
-- (others kept as stored), by the Participant holding the Step, its changes
-- internal to it, and the answers as they arrived kept for everyone else.
create or replace function app.save_work_item_answers(
  p_work_item_id uuid, p_data jsonb, p_trade_id uuid, p_location_id uuid, p_scope_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_built_ins constant text[] := array['trade', 'location', 'scopes'];
      v_item record;
      v_me record;
      v_outcome text;
      v_locked text[];
      v_given jsonb;
      v_seen jsonb;
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

      -- A section not editable now comes back as the saver reads it, or nothing is saved.
      v_locked := app.locked_field_keys(p_work_item_id);
      v_seen := app.work_item_answers(p_work_item_id);
      v_given := coalesce(p_data, '{}') - v_built_ins || jsonb_strip_nulls(jsonb_build_object(
        'trade', p_trade_id, 'location', p_location_id,
        'scopes', case when cardinality(p_scope_ids) > 0 then to_jsonb(p_scope_ids) end));
      if exists (
        select 1 from unnest(v_locked) k
        where app.answer_canonical(v_given -> k) is distinct from app.answer_canonical(v_seen -> k)
      ) then
        return 'not_editable';
      end if;

      if not (v_locked && v_built_ins) then
        v_outcome := app.check_work_item_built_ins(
          p_work_item_id, v_item.project_id, v_me.project_member_id, p_trade_id, p_location_id, p_scope_ids);
        if v_outcome <> 'ok' then
          return v_outcome;
        end if;
      end if;
      v_before := app.work_item_full_answers(p_work_item_id);
      v_data := app.resolve_link_answers(
        p_work_item_id, v_item.project_id, v_item.form_version_id, v_before, coalesce(p_data, '{}') - v_built_ins - v_locked);
      if v_data is null then
        return 'target_not_found';
      end if;
      -- The locked fields as stored: what the saver read may lack a reference stripped from it.
      v_data := v_data || coalesce((
        select jsonb_object_agg(k, v_item.data -> k) from unnest(v_locked) k where v_item.data ? k), '{}');
      if not (v_locked && v_built_ins) then
        perform app.set_work_item_built_ins(p_work_item_id, v_item.project_id, p_trade_id, p_location_id, p_scope_ids);
      end if;
      update work_item set
        data = v_data,
        -- Everyone but the holder goes on reading the answers as they arrived (V19).
        data_as_arrived = coalesce(data_as_arrived, v_before),
        updated_at = v_at
      where id = p_work_item_id;
      perform app.sync_link_answers(p_work_item_id, v_item.project_id, v_item.form_version_id, v_data, v_at);

      -- Once it has left Draft, every change is on the record (a Draft it was
      -- Returned to included), inside the saver's Participant (V5, V19).
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
            jsonb_build_object('changes', v_changes), 'internal', v_me.participant_id,
            sha256(convert_to(v_after::text, 'UTF8')), v_at
          );
        end if;
      end if;
      return 'saved';
    end
  $$;

-- Files into a field ----------------------------------------------------------------

-- As in the checklist migration, and only into a field of a section editable now.
create or replace function app.start_document_upload(
  p_work_item_id uuid, p_file_name text, p_size_bytes bigint, p_content_type text, p_now timestamptz,
  p_field_key text default null, p_item_key text default null
) returns table (outcome text, document_id uuid, storage_key text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_id uuid := app.uuid_v7();
      v_key text;
      v_refusal text;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::uuid, null::text;
        return;
      end if;
      -- Locked, so a Transition out of Draft can't pass in between.
      select w.id, w.project_id into v_item from work_item w where w.id = p_work_item_id for update;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_me.project_member_id is null then
        return query select 'not_found'::text, null::uuid, null::text;
        return;
      end if;
      if not app.can_change_documents(p_work_item_id) then
        return query select app.documents_refusal(p_work_item_id), null::uuid, null::text;
        return;
      end if;
      if p_item_key is not null and p_field_key is null then
        return query select 'field_not_found'::text, null::uuid, null::text;
        return;
      end if;
      if p_field_key is not null then
        v_refusal := app.field_document_refusal(p_work_item_id, p_field_key, p_content_type, null, p_item_key);
        if v_refusal is null and p_field_key = any (app.locked_field_keys(p_work_item_id)) then
          v_refusal := 'not_editable';
        end if;
        if v_refusal is not null then
          return query select v_refusal, null::uuid, null::text;
          return;
        end if;
      end if;
      v_key := app.document_storage_key(v_item.project_id, v_item.id, v_id);
      insert into document (
        id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
        uploaded_by_member_id, uploaded_by_participant_id, created_at, field_key, item_key
      ) values (
        v_id, v_item.project_id, v_item.id, btrim(p_file_name), p_size_bytes, p_content_type, v_key,
        app.current_member_id(), v_me.participant_id, v_at, p_field_key, p_item_key
      );
      return query select 'started'::text, v_id, v_key;
    end
  $$;

revoke all on function
  app.share_answers_on_leaving(),
  app.holds_work_item(uuid),
  app.work_item_answers_unstripped(uuid),
  app.answers_held(uuid),
  app.editable_section_keys(uuid),
  app.locked_field_keys(uuid),
  app.answer_canonical(jsonb)
  from public;
