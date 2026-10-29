-- RP-1079: a reply Document goes no further than the event that took it (V5, V19; the Documental Record row).
--
-- A Transition whose Screen has reply fields takes the files waiting in them (`document.reply_event_id`,
-- app.attach_reply_files_to_transition). Every reader shared a Document by its arrival alone, so a
-- Recommendation into the Owner's review (ADR 0022), whose events are internal to the Consultant and the
-- Participant holding the review, let everyone who sees the item read the files it took: the Contractor
-- during the review, after an Owner Send Back, after the Confirm, in the Working Copy and in the record.
--
-- Now one rule, on top of the arrival rule, wherever Documents are read:
--   - app.reply_event_seen(item, event): what a Member reads (the documents policy, app.document_times, so
--     the api's list and download too): a Document no Transition took, or one taken by an event the Member
--     reads (shared, or internal to one of its Participants; the Owner's review writes the Transition once for
--     each side, so either copy counts).
--   - app.reply_event_shared(item, event): what one content shows every reader (app.work_item_shared_documents,
--     app.working_copy_content, app.documents_shared_before_close): a Document no Transition took, or one taken
--     by a shared event.
-- The Participant holding the item is not exempt: after an Owner Send Back and a Consultant Send Back the
-- Contractor holds it again, and the Recommendation's files are still not its to read.

create function app.reply_event_seen(p_work_item_id uuid, p_reply_event_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return p_reply_event_id is null or app.sees_work_item(p_work_item_id) and exists (
        select 1 from work_item_event t
        join work_item_event e on e.work_item_id = t.work_item_id and e.transition_id = t.transition_id
          and e.created_at = t.created_at and e.type in ('transition', 'issue_code')
        where t.id = p_reply_event_id and t.work_item_id = p_work_item_id
          and (e.audience = 'shared' or e.audience_participant_id in (select app.current_participant_ids())));
    end
  $$;
revoke all on function app.reply_event_seen(uuid, uuid) from public;
grant execute on function app.reply_event_seen(uuid, uuid) to rabaed_app;

create function app.reply_event_shared(p_work_item_id uuid, p_reply_event_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return p_reply_event_id is null or exists (
        select 1 from work_item_event e
        where e.id = p_reply_event_id and e.work_item_id = p_work_item_id and e.audience = 'shared');
    end
  $$;
revoke all on function app.reply_event_shared(uuid, uuid) from public;

alter policy member_reads_documents on document
  using (confirmed_at is not null and removed_at is null
    and project_id in (select app.current_project_ids())
    and app.sees_work_item(work_item_id)
    and app.item_row_seen(work_item_id, arrival, false)
    and app.reply_event_seen(work_item_id, reply_event_id));

-- As in 20261222000000_draft_row_times_floor.sql, with the event that took a reply Document.
create or replace function app.document_times(p_work_item_id uuid)
  returns table (document_id uuid, uploaded_at timestamptz, seq integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        with recursive visible as (
          -- The rows the documents policy shows the acting Member.
          select d.id, d.confirmed_at, d.file_name from document d
          where d.work_item_id = p_work_item_id and d.confirmed_at is not null and d.removed_at is null
            and app.item_row_seen(d.work_item_id, d.arrival, false)
            and app.reply_event_seen(d.work_item_id, d.reply_event_id)
        ), origin as (
          -- Each Document back to the one first uploaded, through any copy of a copy.
          select v.id as document_id, v.id as source_id from visible v
          union all
          select o.document_id, c.copied_from_id from origin o join document_copy c on c.document_id = o.source_id
        )
        select v.id, greatest(v.confirmed_at, w.numbered_at),
          (row_number() over (order by v.confirmed_at, v.file_name, v.id))::integer
        from visible v
        join origin o on o.document_id = v.id
          and not exists (select 1 from document_copy c where c.document_id = o.source_id)
        join document s on s.id = o.source_id
        join work_item w on w.id = s.work_item_id
        order by 3;
    end
  $$;

-- As in 20270117000400_list_row_commands.sql, never a reply Document only an internal event took.
create or replace function app.work_item_shared_documents(p_work_item_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select d.id from document d
        join work_item w on w.id = d.work_item_id
        where d.work_item_id = p_work_item_id and app.sees_work_item(w.id) and w.submitted_at is not null
          and d.confirmed_at is not null and d.removed_at is null
          and (d.arrival < w.arrivals or w.closed_at is not null)
          and app.reply_event_shared(d.work_item_id, d.reply_event_id);
    end
  $$;

-- As in 20271015000000_record_reply_checklist.sql, never a reply Document only an internal event took.
create or replace function app.documents_shared_before_close(p_work_item_id uuid) returns setof document
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select d.* from document d
        join work_item w on w.id = d.work_item_id
        where d.work_item_id = p_work_item_id and w.closed_at is not null and w.submitted_at is not null
          and d.confirmed_at is not null and d.removed_at is null
          -- Never a reply Document only an internal event took (the Owner's review, RP-1079).
          and app.reply_event_shared(d.work_item_id, d.reply_event_id)
          -- A reply Screen's file or checklist photo a shared event took counts whatever its arrival.
          and (d.arrival < w.arrivals - 1 or d.reply_event_id is not null);
    end
  $$;

-- As in 20270928000000_working_copy.sql, never a reply Document only an internal event took.
create or replace function app.working_copy_content(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_answers jsonb;
      v_content jsonb;
    begin
      v_answers := coalesce(app.shared_answers_of(p_work_item_id), app.working_copy_draft_answers(p_work_item_id), '{}'::jsonb);
      select jsonb_build_object(
          'workItemId', w.id,
          'projectId', w.project_id,
          'projectName', pr.name,
          'recordLanguage', pr.record_language,
          'hijriDates', pr.record_hijri_dates,
          'watermark', pr.working_copy_watermark,
          'type', jsonb_build_object('code', t.code, 'name', t.name),
          'documentNumber', w.document_number,
          'revisionNo', w.revision_no,
          -- The item it revises, once that one closed, and only when it was shared (as the chain's links are read).
          'revisionOf', (
            select jsonb_build_object('documentNumber', o.document_number, 'closedAt', app.iso_utc(o.closed_at), 'outcome', o.outcome)
            from work_item o
            where o.id = w.revision_of_id and o.closed_at is not null and o.document_number is not null
              and not app.chain_item_unshared(w.id, o.id)
          ),
          'subject', w.title,
          'submittedAt', app.iso_utc(w.submitted_at),
          -- The Stage every Company but the holder reads: where the item reached its holder; a Draft's own.
          'stage', (
            select st.name from stage st
            where st.project_id = w.project_id and st.module_key = t.module_key
              and st.key = case when w.submitted_at is null then w.current_stage_key else (
                select s.stage_key from workflow_step s where s.id = w.participant_entered_step_id) end
          ),
          'outcomes', coalesce((
            select jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name, 'polarity', o.polarity, 'actions', o.actions) order by o.sort, o.code)
            from outcome o
            where o.project_id = w.project_id and o.work_item_type_id = w.work_item_type_id and o.closing
          ), '[]'::jsonb),
          -- The Owner, the raiser, every Company the item was given to and every Company that took a shared move, each
          -- with its Project Role: the Companies app.work_item_companies names to every reader, and the Owner, whom the
          -- record's Parties box always names.
          'companies', coalesce((
            select jsonb_agg(jsonb_build_object('participantId', p.id, 'name', co.legal_name, 'roleName', r.name, 'baseRole', r.base_role)
              order by case r.base_role when 'owner' then 1 when 'owner_representative' then 2 when 'consultant' then 3 else 4 end, p.ordinal, p.id)
            from participant p
            join company co on co.id = p.company_id
            join project_role r on r.id = p.project_role_id
            where p.project_id = w.project_id
              and (
                (r.base_role = 'owner' and p.status = 'active')
                or p.id = w.raised_by_participant_id
                or p.id in (select a.participant_id from step_assignment a where a.work_item_id = w.id)
                or p.id in (
                  select e.actor_participant_id from work_item_event e
                  where e.work_item_id = w.id and e.audience = 'shared' and e.type in ('transition', 'issue_code') and e.actor_participant_id is not null)
              )
          ), '[]'::jsonb),
          -- The Built-in Fields as the answers give them (V19: as they last arrived).
          'trades', coalesce((
            select jsonb_agg(jsonb_build_object('name', dv.name, 'selected', dv.id = app.uuid_or_null(v_answers -> 'trade')) order by dv.sort, dv.id)
            from dimension_value dv
            join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'trade' and d.project_id = w.project_id
            where dv.parent_id is null
          ), '[]'::jsonb),
          'location', (
            with recursive up (id, parent_id, name, depth) as (
              select dv.id, dv.parent_id, dv.name, dv.depth
              from dimension_value dv
              join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'location' and d.project_id = w.project_id
              where dv.id = app.uuid_or_null(v_answers -> 'location')
              union all
              select dv.id, dv.parent_id, dv.name, dv.depth from dimension_value dv join up on dv.id = up.parent_id
            )
            select jsonb_agg(up.name order by up.depth) from up
          ),
          'scopes', coalesce((
            select jsonb_agg(s.name order by s.depth, s.sort, s.id)
            from scope s
            where s.project_id = w.project_id and jsonb_typeof(v_answers -> 'scopes') = 'array'
              and s.id in (select app.uuid_or_null(x) from jsonb_array_elements(v_answers -> 'scopes') x)
          ), '[]'::jsonb),
          'form', jsonb_build_object(
            'sections', fv.schema -> 'sections',
            'answers', v_answers,
            'optionLists', coalesce((
              select jsonb_agg(jsonb_build_object('id', ol.id, 'name', ol.name) order by ol.created_at, ol.id)
              from option_list ol where position(ol.id::text in fv.schema::text) > 0
            ), '[]'::jsonb),
            'options', coalesce((
              select jsonb_agg(jsonb_build_object('id', op.id, 'optionListId', op.option_list_id, 'parentId', op.parent_id,
                'value', op.value, 'label', op.label, 'retired', op.retired) order by op.created_at, op.id) -- hidden-sort-key: an Option List's own options, Rabaed's rows, never an item's time
              from option op join option_list ol on ol.id = op.option_list_id
              where position(ol.id::text in fv.schema::text) > 0
            ), '[]'::jsonb),
            'suppliers', coalesce((
              select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name))
              from approved_supplier s
              where s.project_id = w.project_id and s.id in (
                select app.uuid_or_null(v_answers -> (f ->> 'key'))
                from jsonb_array_elements(fv.schema -> 'sections') sec
                cross join lateral jsonb_array_elements(sec -> 'fields') f
                where f ->> 'type' = 'approved_supplier')
            ), '[]'::jsonb),
            'companyNames', coalesce((
              select jsonb_object_agg(p.id, co.legal_name)
              from participant p join company co on co.id = p.company_id
              where p.project_id = w.project_id and p.id in (
                select app.uuid_or_null(v_answers -> (f ->> 'key'))
                from jsonb_array_elements(fv.schema -> 'sections') sec
                cross join lateral jsonb_array_elements(sec -> 'fields') f
                where f ->> 'type' = 'participant')
            ), '{}'::jsonb)
          ),
          -- The Documents as of the last arrival (never one the holder added since, V19); a Draft's all. Never a
          -- reply Document only an internal event took (the Owner's review, RP-1079): one content for every reader.
          'documents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'fileName', d.file_name, 'contentType', d.content_type, 'size', d.size_bytes::bigint, 'storageKey', d.storage_key,
              'fieldKey', d.field_key, 'itemKey', d.item_key, 'takenAt', app.iso_utc(d.taken_at)
            ) order by d.created_at, d.id) -- hidden-sort-key: the order they were added is what app.document_times (seq) already tells every reader, never the times
            from document d
            where d.work_item_id = w.id and d.confirmed_at is not null and d.removed_at is null
              and (w.submitted_at is null or d.arrival < w.arrivals)
              and app.reply_event_shared(d.work_item_id, d.reply_event_id)
          ), '[]'::jsonb),
          -- The Links not tied to a link question (those print with the Form), as of the last arrival; a Draft's
          -- all. A linked item by its number and Subject only, never one of the chain no reader is shown.
          'links', coalesce((
            select jsonb_agg(jsonb_build_object('documentNumber', t.document_number, 'subject', t.title)
              order by l.created_at, t.document_number collate "C", l.id) -- hidden-sort-key: the order app.work_item_shared_links lists them in, never the times
            from work_item_link l
            join work_item t on t.id = l.to_id
            where l.from_id = w.id and l.field_key is null and t.document_number is not null
              and not app.chain_item_unshared(w.id, t.id)
              and (w.submitted_at is null or l.arrival < w.arrivals)
          ), '[]'::jsonb),
          -- The shared moves, each by its Company only. The Owner's review writes one copy of a move for each side of it: one is enough.
          'moves', coalesce((
            select jsonb_agg(x.move order by x.seq)
            from (
              select distinct on (e.transition_id, e.created_at, e.actor_participant_id) e.seq,
                jsonb_build_object(
                  'kind', tr.kind,
                  'label', tr.label,
                  'at', app.iso_utc(e.created_at),
                  'participantId', e.actor_participant_id,
                  'companyName', c.legal_name,
                  'roleName', r.name
                ) as move
              from work_item_event e
              join workflow_transition tr on tr.id = e.transition_id
              join participant p on p.id = e.actor_participant_id
              join project_role r on r.id = p.project_role_id
              join company c on c.id = p.company_id
              where e.work_item_id = w.id and e.audience = 'shared' and e.type in ('transition', 'issue_code')
              order by e.transition_id, e.created_at, e.actor_participant_id, e.seq
            ) x
          ), '[]'::jsonb)
        )
      into v_content
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      join form_version fv on fv.id = w.form_version_id
      where w.id = p_work_item_id and w.closed_at is null and w.discarded_at is null;
      return v_content;
    end
  $$;
