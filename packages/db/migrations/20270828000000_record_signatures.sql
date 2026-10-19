-- RP-650 (spec RP-632; ADR 0017, ADR 0022, ADR 0023; form-engine.md §6, elements 10 to 14): the
-- Documental Record's pages after page 1. The Signature cards, the Stamps, the Review Comments,
-- the endings, the Form's Disclaimer and review duration, and the Companies' logos.
--
-- * app.documental_record_facts (rebuilt from 20270720000000_record_page_one.sql) also gives:
--   - each Transition's Signature as its event recorded it (work_item_event.signature_id: the one
--     in force when the Member acted, never their current one), its Action Form as the Workflow
--     Version pinned it, and, when its event is shared, the answers of the Action Form's shared
--     fields (never an internal_answers event, an Internal Note or a Recommended Code; a move inside
--     one Participant and the Owner's review's Recommendation and Send Back, which are internal to
--     the two, give none);
--   - each Company's logo and Stamp in force when the item closed: the last one stored under its
--     key before the close (a new upload is a new stored_file row, so a later one never prints);
--   - the raiser's Participant (a Code C's Revision is theirs);
--   - the Comments the issued Code raised (made in its closing, `raised_from` and created when it
--     closed), each with its Document Number, comment, reference and who raised it as they were
--     then (the Raise event's work_item_event_signer row), in the reply's row order (their Document
--     Numbers, issued row by row from one counter);
--   - the Form Version's `pdf` block (its Disclaimer and show_review_duration);
--   - when Rabaed cancelled the item because a Company left the Project (a `cancelled` event with
--     no Member, payload `left_participant_id`; workflow-engine.md §9, not built yet), that Company.
--   Still never read here: Returns' reasons, Internal Notes, Recommended Codes, Chat, in-progress
--   answers, the Draft-started time (V7). A Code the Owner sent back is read with the rest of the
--   Transitions only so the worker can leave it out (recordPath): it is off the path, and so are
--   its Remarks, its Comments table and its Recommendation.
-- * app.documental_record_reproduction_source (rebuilt from 20270805000000_record_checks.sql, RP-155)
--   also lists `marks`: the files of the Signatures the item's events recorded, and every logo and
--   Stamp of the Project's Companies stored up to its close, each with its fingerprint, so a
--   Re-produce finds again by fingerprint the logos, Signatures and Stamps the record printed.
--   Worker only, as before.
-- app.take_transition, app.transition_effects, app.save_documental_record and
-- app.documental_record_file are not touched.

create or replace function app.documental_record_facts(p_outbox_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item_id uuid;
      v_answers jsonb;
      v_facts jsonb;
    begin
      perform app.require_worker();
      v_item_id := app.documental_record_item(p_outbox_id);
      if v_item_id is null or exists (select 1 from documental_record r where r.work_item_id = v_item_id) then
        return null;
      end if;
      v_answers := coalesce(app.shared_answers_of(v_item_id), '{}'::jsonb);
      select jsonb_build_object(
          'workItemId', w.id,
          'projectId', w.project_id,
          'projectName', pr.name,
          'recordLanguage', pr.record_language,
          'hijriDates', pr.record_hijri_dates,
          'type', jsonb_build_object('code', t.code, 'name', t.name),
          'documentNumber', w.document_number,
          'revisionNo', w.revision_no,
          'revisionOf', (
            select jsonb_build_object('documentNumber', o.document_number, 'closedAt', app.iso_utc(o.closed_at), 'outcome', o.outcome)
            from work_item o
            where o.id = w.revision_of_id and o.closed_at is not null and o.document_number is not null
          ),
          'subject', w.title,
          'outcome', w.outcome,
          'closedAt', app.iso_utc(w.closed_at),
          'submittedAt', app.iso_utc(w.submitted_at),
          'raiserParticipantId', w.raised_by_participant_id,
          'pdf', fv.schema -> 'pdf',
          'outcomes', coalesce((
            select jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name, 'polarity', o.polarity, 'actions', o.actions) order by o.sort, o.code)
            from outcome o
            where o.project_id = w.project_id and o.work_item_type_id = w.work_item_type_id and o.closing
          ), '[]'::jsonb),
          -- The Owner, and every Company on the item (the raiser, the Companies a Step was given to and
          -- every Company whose Member took a Transition), each with its Project Role, and its logo and
          -- Stamp in force when the item closed.
          'companies', coalesce((
            select jsonb_agg(jsonb_build_object(
                'participantId', p.id, 'name', co.legal_name, 'roleName', r.name, 'baseRole', r.base_role,
                'logo', app.company_image_at(co.id, 'logo', w.closed_at),
                'stamp', app.company_image_at(co.id, 'stamp', w.closed_at))
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
                  where e.work_item_id = w.id and e.type in ('transition', 'issue_code') and e.actor_participant_id is not null)
              )
          ), '[]'::jsonb),
          'trades', coalesce((
            select jsonb_agg(jsonb_build_object('name', dv.name, 'selected', dv.id = it.dimension_value_id) order by dv.sort, dv.id)
            from dimension_value dv
            join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'trade' and d.project_id = w.project_id
            left join (
              select x.dimension_value_id from work_item_dimension_value x
              join visibility_dimension xd on xd.id = x.dimension_id and xd.kind = 'trade'
              where x.work_item_id = w.id
            ) it on true
            where dv.parent_id is null
          ), '[]'::jsonb),
          -- The Location as the path from its first level down.
          'location', (
            with recursive up (id, parent_id, name, depth) as (
              select dv.id, dv.parent_id, dv.name, dv.depth
              from work_item_dimension_value x
              join visibility_dimension xd on xd.id = x.dimension_id and xd.kind = 'location'
              join dimension_value dv on dv.id = x.dimension_value_id
              where x.work_item_id = w.id
              union all
              select dv.id, dv.parent_id, dv.name, dv.depth from dimension_value dv join up on dv.id = up.parent_id
            )
            select jsonb_agg(up.name order by up.depth) from up
          ),
          'scopes', coalesce((
            select jsonb_agg(s.name order by s.depth, s.sort, s.id)
            from work_item_scope ws join scope s on s.id = ws.scope_id
            where ws.work_item_id = w.id
          ), '[]'::jsonb),
          'reviewComments', (
            select count(*) from work_item_link l
            join work_item c on c.id = l.from_id and c.discarded_at is null
            where l.to_id = w.id and l.kind = 'raised_from'
          ),
          -- The Comments the issued Code raised, in the order its reply listed them: made by its
          -- closing (created when it closed), each with who raised it as they were then.
          'comments', coalesce((
            select jsonb_agg(jsonb_build_object(
                'documentNumber', c.document_number,
                'comment', coalesce(nullif(btrim(c.data ->> 'comment'), ''), c.title),
                'reference', nullif(btrim(c.data ->> 'reference'), ''),
                'at', app.iso_utc(c.created_at),
                'memberName', coalesce(s.member_name, m.full_name),
                'positions', coalesce(s.positions, '[]'::jsonb),
                'companyName', coalesce(s.company_name, co.legal_name),
                'roleName', r.name,
                'participantId', e.actor_participant_id)
              -- The reply's row order: its rows took their Document Numbers from one counter, in order.
              order by length(c.document_number), c.document_number, c.id)
            from work_item_link l
            join work_item c on c.id = l.from_id and c.discarded_at is null
            join work_item_event e on e.work_item_id = c.id and e.type = 'transition'
            join member m on m.id = e.actor_member_id
            join participant p on p.id = e.actor_participant_id
            join company co on co.id = p.company_id
            join project_role r on r.id = p.project_role_id
            left join work_item_event_signer s on s.event_id = e.id
            where l.to_id = w.id and l.kind = 'raised_from' and c.created_at = w.closed_at
              -- Its Raise: the Comment's first Transition.
              and e.seq = (select min(x.seq) from work_item_event x where x.work_item_id = c.id and x.type = 'transition')
          ), '[]'::jsonb),
          -- Rabaed's own cancel when a Company left the Project (workflow-engine.md §9): no Member took it.
          'cancelledByRabaed', (
            select jsonb_build_object('companyName', co.legal_name)
            from work_item_event e
            join participant p on p.id = app.uuid_or_null(e.payload -> 'left_participant_id')
            join company co on co.id = p.company_id
            where e.work_item_id = w.id and e.type = 'cancelled' and e.actor_member_id is null and w.outcome = 'cancelled'
            order by e.seq desc
            limit 1
          ),
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
          -- The Documents everyone who reads the closed item reads, in the order they were added.
          'documents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'fileName', d.file_name, 'contentType', d.content_type, 'size', d.size_bytes::bigint, 'storageKey', d.storage_key,
              'fieldKey', d.field_key, 'itemKey', d.item_key, 'takenAt', app.iso_utc(d.taken_at)
            ) order by d.created_at, d.id) -- hidden-sort-key: the order they were added is what app.document_times (seq) already tells every reader, never the times
            from document d
            where d.work_item_id = w.id and d.confirmed_at is not null and d.removed_at is null
          ), '[]'::jsonb),
          'transitions', coalesce((
            -- The Owner's review writes one copy of a move for each side of it: one is enough.
            select jsonb_agg(x.fact order by x.seq)
            from (
              select distinct on (e.transition_id, e.created_at, e.actor_member_id) e.seq,
                jsonb_build_object(
                  'fromStepId', e.from_step_id,
                  'toStepId', e.to_step_id,
                  'kind', tr.kind,
                  'outcomeMode', fs.outcome_mode,
                  'label', tr.label,
                  'at', app.iso_utc(e.created_at),
                  -- As the event's signer row kept them when it was written; an event written
                  -- before it has none, and is read as the Member is now.
                  'memberName', coalesce(s.member_name, m.full_name),
                  'positions', coalesce(s.positions, (
                    select jsonb_agg(po.name order by po.sort)
                    from project_member pm
                    join project_member_position pmp on pmp.project_member_id = pm.id
                    join position po on po.id = pmp.position_id
                    where pm.participant_id = e.actor_participant_id and pm.member_id = e.actor_member_id
                  ), '[]'::jsonb),
                  'companyName', coalesce(s.company_name, c.legal_name),
                  -- The Code's Remarks, from its own shared event only: never a Recommended Code (V7). Which Transition
                  -- is the issued Code is the worker's to say, from the path (recordPath).
                  'remarks', case when e.type = 'issue_code' and e.audience = 'shared' then e.payload ->> 'remarks' end,
                  -- What the shared Action Form holds, from a shared event only (V5): the payload keeps the
                  -- shared fields' answers (internal ones are their own internal_answers event), less what
                  -- the engine writes.
                  'answers', case when e.audience = 'shared' then nullif(e.payload - 'document_number' - 'outcome', '{}'::jsonb) end,
                  'actionForm', tr.action_form,
                  -- The Signature in force when the Member acted, as the event recorded it.
                  'signature', (
                    select jsonb_build_object('storageKey', f.storage_key, 'contentType', f.mime)
                    from member_signature ms join stored_file f on f.id = ms.file_id
                    where ms.id = e.signature_id
                  ),
                  'participantId', e.actor_participant_id,
                  'roleName', pr2.name,
                  'contentSha256', encode(e.content_sha256, 'hex')
                ) as fact
              from work_item_event e
              join workflow_transition tr on tr.id = e.transition_id
              join workflow_step fs on fs.id = e.from_step_id
              join member m on m.id = e.actor_member_id
              join participant p on p.id = e.actor_participant_id
              join project_role pr2 on pr2.id = p.project_role_id
              join company c on c.id = p.company_id
              left join work_item_event_signer s on s.event_id = e.id
              where e.work_item_id = w.id and e.type in ('transition', 'issue_code')
              order by e.transition_id, e.created_at, e.actor_member_id, e.seq
            ) x
          ), '[]'::jsonb)
        )
      into v_facts
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      join form_version fv on fv.id = w.form_version_id
      where w.id = v_item_id and w.closed_at is not null and w.discarded_at is null;
      return v_facts;
    end
  $$;

-- Prefix searches on storage keys (the database's collation is not C, so the unique index can't serve them).
create index stored_file_storage_key_prefix on stored_file (storage_key text_pattern_ops);

-- Where a Company's logos or Stamps (`p_kind`) are stored: `companies/<id>/<kind>/`, one object per
-- upload (the api's companyImagePrefix, @rabaed/domain, is the same).
create function app.company_image_prefix(p_company_id uuid, p_kind text) returns text
  language plpgsql immutable
  set search_path = pg_catalog, public
  as $$
    begin
      if p_kind is null or p_kind not in ('logo', 'stamp') then
        raise exception 'A Company image is its logo or its Stamp' using errcode = '22023';
      end if;
      return 'companies/' || p_company_id::text || '/' || p_kind || '/';
    end
  $$;
revoke all on function app.company_image_prefix(uuid, text) from public;

-- A Company's logo or Stamp (`p_kind`) in force at `p_at`. The company row keeps only the one in
-- force now (logo_file_id, stamp_file_id), and every upload is its own stored_file row under the
-- Company's prefix, so the history is those rows: the last created at or before then, so a later
-- upload never changes a record. Null without one. For the record job's facts only (owner read).
create function app.company_image_at(p_company_id uuid, p_kind text, p_at timestamptz) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select jsonb_build_object('storageKey', f.storage_key, 'contentType', f.mime)
    from stored_file f
    -- The keys under the prefix, as a byte-wise range the index above serves even for a prefix known
    -- only at run time: from the prefix up to it with its last character, '/', moved on to '0'.
    where f.storage_key ~>=~ app.company_image_prefix(p_company_id, p_kind)
      and f.storage_key ~<~ (rtrim(app.company_image_prefix(p_company_id, p_kind), '/') || '0')
      and f.created_at <= p_at
    order by f.created_at desc, f.id desc -- hidden-sort-key: Rabaed's own file rows, to find the one in force; never an item's time shown to anyone
    limit 1
  $$;
revoke all on function app.company_image_at(uuid, text, timestamptz) from public;

-- What a 'documental_record_reproduce' job needs (20270805000000_record_checks.sql), and the files a
-- logo, Signature or Stamp the record printed may be found among by its fingerprint (see the header).
create or replace function app.documental_record_reproduction_source(p_outbox_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.require_worker();
      return (
        select jsonb_build_object(
          'workItemId', r.work_item_id,
          'projectId', r.project_id,
          'status', r.status,
          'pdfKey', f.storage_key,
          'recordDataKey', d.storage_key,
          'pdfSha256', encode(r.pdf_sha256, 'hex'),
          'sealedAt', app.iso_utc(r.sealed_at),
          -- The Documents the record was made with, to find a Form photo's image again by name and time.
          'documents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'fileName', d.file_name, 'contentType', d.content_type, 'size', d.size_bytes::bigint, 'storageKey', d.storage_key,
              'takenAt', app.iso_utc(d.taken_at), 'sha256', encode(d.file_sha256, 'hex')
            ) order by d.created_at, d.id) -- hidden-sort-key: the order they were added, as the record job read them
            from document d
            where d.work_item_id = r.work_item_id and d.confirmed_at is not null and d.removed_at is null
          ), '[]'::jsonb),
          -- The Signatures the item's events recorded, and the logos and Stamps of the Project's Companies up to the close.
          'marks', coalesce((
            select jsonb_agg(jsonb_build_object(
              'storageKey', m.storage_key, 'contentType', m.mime, 'size', m.size, 'sha256', encode(m.sha256, 'hex')
            ) order by m.storage_key) -- hidden-sort-key: Rabaed's own file keys, a fixed order for the worker; never shown
            from (
              select sf.storage_key, sf.mime, sf.size, sf.sha256
              from work_item_event e
              join member_signature ms on ms.id = e.signature_id
              join stored_file sf on sf.id = ms.file_id
              where e.work_item_id = r.work_item_id
              union
              select sf.storage_key, sf.mime, sf.size, sf.sha256
              from work_item w
              join participant p on p.project_id = w.project_id
              cross join (values ('logo'), ('stamp')) k (kind)
              join stored_file sf
                on sf.storage_key ~>=~ app.company_image_prefix(p.company_id, k.kind)
                and sf.storage_key ~<~ (rtrim(app.company_image_prefix(p.company_id, k.kind), '/') || '0')
                and sf.created_at <= w.closed_at
              where w.id = r.work_item_id
            ) m
          ), '[]'::jsonb))
        from outbox o
        join documental_record r on r.work_item_id = (o.payload ->> 'work_item_id')::uuid
        join stored_file f on f.id = r.pdf_file_id
        join stored_file d on d.id = r.record_data_file_id
        where o.id = p_outbox_id and o.kind = 'documental_record_reproduce'
          and r.status in ('published', 'failed_checks')
          and not exists (
            select 1 from documental_record_reproduction x
            where x.admin_action_id = (o.payload ->> 'admin_action_id')::uuid)
      );
    end
  $$;
revoke all on function app.documental_record_reproduction_source(uuid) from public;
grant execute on function app.documental_record_reproduction_source(uuid) to rabaed_app;
