-- The List's row commands (RP-409, the owner's design and decisions of 2026-10-10).
--
-- * Delete = discard a Draft, every Draft (an original too, not only a Revision):
--   app.can_discard_draft / app.discard_draft. Only while it never left Draft (no
--   Document Number was issued), and only by a Member who may edit it now: the same
--   rule as saving its answers (app.can_save_answers), so whoever may not change a
--   Draft may not delete it either. It closes as cancelled, is marked discarded, its
--   assignment done and its access rows removed, so nobody sees it again; the row
--   stays, with when it was started, for audit (GLOSSARY "Creation Date"). A
--   discarded original frees nothing: it had no number. As app.discard_revision does
--   for a Revision, which stays as it is.
-- * Duplicate: the new Draft keeps the item it was duplicated from
--   (`duplicated_from_id`), and the duplicating Member's request key, so a repeated
--   request, or two at once, answer with the same Draft (app.record_duplicate,
--   app.duplicate_of_key). Not an event: nothing about it has a time, so it can never
--   tell when the Draft was started (visibility.md "Creation Date", scenario 61), and
--   nothing reaches the Activity Feed. app.work_item_duplicated_from names the source
--   to the raiser's Participant only. A discarded Draft frees its key: the same request
--   again makes a new Draft. app.own_written_fields gives the fields of an item whose
--   last writer is of the acting Member's own Participant, so a Duplicate copies only
--   those, the Built-in Fields too.
-- * Download (owner decision B): the item as shared, the same for every viewer, the
--   holder's own Company and the raiser included. app.work_item_shared_answers: the
--   answers as they last arrived (never anyone's in-progress answers), a `participant`
--   answer only when it names a Company everyone who sees the item may read (the
--   host's, or one the item involves), a link question by number and Subject only.
--   app.work_item_shared_named_answers names those Companies.
--   app.work_item_shared_stage: the Status every Company but the holder reads (the
--   Step the holding Participant entered at, never an internal one).
--   app.work_item_shared_documents and app.work_item_shared_links: the Documents and
--   Links as of the last arrival, as everyone but the holder reads them
--   (app.item_row_as_arrived), never one the holder added since. Linked from is not
--   part of it: it differs between viewers.

alter table work_item drop constraint work_item_discarded_closed;
alter table work_item add constraint work_item_discarded_closed check (discarded_at is null or closed_at is not null);

-- Where a Draft was duplicated from, and the request that made it. Not granted to
-- the app role: read through app.work_item_duplicated_from and app.duplicate_of_key.
alter table work_item
  add column duplicated_from_id uuid references work_item (id),
  add column duplicate_member_id uuid references member (id),
  add column duplicate_key uuid,
  add constraint work_item_duplicate_request check ((duplicate_key is null) = (duplicate_member_id is null)),
  add constraint work_item_duplicate_source check (duplicate_key is null or duplicated_from_id is not null);

-- One live Draft per Duplicate request of a Member; a discarded one frees its key.
create unique index work_item_duplicate_key on work_item (duplicate_member_id, duplicate_key)
  where duplicate_key is not null and discarded_at is null;

-- Whether the acting Member may discard a visible Draft: never numbered, still at its
-- Draft Step, on an active Project, and they may edit it now (app.can_save_answers).
create function app.can_discard_draft(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.sees_work_item(p_work_item_id) and exists (
        select 1
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        where w.id = p_work_item_id
          and w.closed_at is null and w.document_number is null and app.is_draft_step(w.current_step_id)
      ) and app.can_save_answers(p_work_item_id);
    end
  $$;

-- Discards a Draft: 'discarded', 'not_found', 'project_closed' or 'not_discardable'.
create function app.discard_draft(p_work_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
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
      if not app.can_discard_draft(p_work_item_id) then
        return 'not_discardable';
      end if;

      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, from_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, p_work_item_id, 'cancelled', app.current_member_id(), v_me.participant_id, v_item.current_step_id,
        jsonb_build_object('draft_discarded', true), 'internal', v_item.raised_by_participant_id, v_at
      );
      update step_assignment set status = 'done', done_at = v_at, updated_at = v_at
      where work_item_id = p_work_item_id and status in ('pooled', 'claimed', 'vacant');
      update work_item set outcome = 'cancelled', closed_at = v_at, discarded_at = v_at, updated_at = v_at
      where id = p_work_item_id;
      -- Nobody sees it again; it never left the raiser's Participant.
      delete from work_item_access where work_item_id = p_work_item_id;
      return 'discarded';
    end
  $$;

-- The live Draft the acting Member already made for this Duplicate request, if any.
create function app.duplicate_of_key(p_idempotency_key uuid) returns uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select w.id from work_item w
        where w.duplicate_member_id = app.current_member_id() and w.duplicate_key = p_idempotency_key
          and w.discarded_at is null and app.sees_work_item(w.id)
        limit 1
      );
    end
  $$;

-- Records on a new Draft the item it was duplicated from and the request that made
-- it: 'recorded' or 'not_found'. Only for a Draft of the acting Member's own
-- Participant that has no source yet. A second live Draft for the same request
-- breaks work_item_duplicate_key: the caller reads the first (app.duplicate_of_key).
create function app.record_duplicate(p_work_item_id uuid, p_source_id uuid, p_idempotency_key uuid) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) or not app.sees_work_item(p_source_id) then
        return 'not_found';
      end if;
      update work_item w set
        duplicated_from_id = p_source_id, duplicate_member_id = app.current_member_id(), duplicate_key = p_idempotency_key
      where w.id = p_work_item_id and w.duplicated_from_id is null and w.document_number is null
        and w.raised_by_participant_id in (select app.current_participant_ids());
      if not found then
        return 'not_found';
      end if;
      return 'recorded';
    end
  $$;

-- The item a visible item was duplicated from, for the raiser's Participant only, and
-- only while they see it: its Document Number (null for a Draft) and Subject. No time.
create function app.work_item_duplicated_from(p_work_item_id uuid)
  returns table (work_item_id uuid, document_number text, subject text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select s.id, s.document_number, s.title
        from work_item w
        join work_item s on s.id = w.duplicated_from_id
        where w.id = p_work_item_id and app.sees_work_item(w.id) and app.sees_work_item(s.id)
          and w.raised_by_participant_id in (select app.current_participant_ids());
    end
  $$;

-- The fields of a visible item whose last writer is a Member of the acting Member's own
-- Participant on its Project (work_item.field_times, never granted). Nothing else of
-- the times or writers leaves the database.
create function app.own_written_fields(p_work_item_id uuid) returns setof text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select t.key
        from work_item w
        cross join lateral jsonb_each(w.field_times) t
        join project_member pm on pm.project_id = w.project_id and pm.member_id = app.uuid_or_null(t.value -> 'by')
        where w.id = p_work_item_id and app.sees_work_item(w.id)
          and pm.participant_id in (select app.current_participant_ids());
    end
  $$;

-- Whether a Company is one everyone who sees item `p_work_item_id` may read by name:
-- the host's, or one the item involves (app.work_item_companies).
create function app.shared_company(p_work_item_id uuid, p_participant_id uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1 from participant p
      join project pr on pr.id = p.project_id
      join work_item w on w.id = p_work_item_id and w.project_id = p.project_id
      where p.id = p_participant_id
        and (p.company_id = pr.host_company_id
          or p.id in (select c.participant_id from app.work_item_companies(w.id) c))
    )
  $$;

-- Whether item `p_other_id` is one of item `p_work_item_id`'s own chain that was
-- never shared (a Draft or internal Revision): left out of what is shared.
create function app.chain_item_unshared(p_work_item_id uuid, p_other_id uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1 from work_item w
      join work_item o on o.root_id = w.root_id and o.project_id = w.project_id
      where w.id = p_work_item_id and o.id = p_other_id and o.id <> w.id
        and (o.submitted_at is null or o.discarded_at is not null)
    )
  $$;

-- A visible Submitted item's answers as they last arrived: as they arrived at the
-- Participant holding it (`data_as_arrived`, kept from the holder's first save), else
-- as stored, which then nobody has changed since they arrived. The same for every
-- viewer: never a `member` answer (no person), a `participant` answer only for a
-- Company everyone who sees the item reads (app.shared_company), a link question's
-- items by Document Number and Subject only, never an id (whose item not every
-- viewer sees), leaving out an unshared item of its own chain. Null before the first
-- Submit: nothing is shared yet.
create function app.work_item_shared_answers(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  set jit = off
  as $$
    #variable_conflict use_column
    begin
      return (
        select (a.src - array(
          select f ->> 'key'
          from form_version v
          cross join lateral jsonb_array_elements(v.schema -> 'sections') s
          cross join lateral jsonb_array_elements(s -> 'fields') f
          where v.id = w.form_version_id
            and a.src ? (f ->> 'key')
            and (f ->> 'type' = 'member'
              or (f ->> 'type' = 'participant' and not (
                jsonb_typeof(a.src -> (f ->> 'key')) = 'string'
                and app.shared_company(w.id, app.uuid_or_null(a.src -> (f ->> 'key'))))))
        ) - array(select app.link_question_keys(w.form_version_id)))
        || coalesce((
          select jsonb_object_agg(k, (
            select coalesce(jsonb_agg(jsonb_build_object('document_number', t.document_number, 'subject', t.title) order by e.n), '[]')
            from jsonb_array_elements(a.src -> k) with ordinality e (v, n)
            join work_item t on t.id = app.uuid_or_null(e.v) and t.project_id = w.project_id
            where not app.chain_item_unshared(w.id, t.id)
          ))
          from app.link_question_keys(w.form_version_id) k
          where jsonb_typeof(a.src -> k) = 'array'
        ), '{}')
        from work_item w
        cross join lateral (select coalesce(w.data_as_arrived, app.work_item_full_answers(w.id)) as src) a
        where w.id = p_work_item_id and app.sees_work_item(w.id) and w.submitted_at is not null
      );
    end
  $$;

-- The Company each shared `participant` answer names (app.work_item_shared_answers).
create function app.work_item_shared_named_answers(p_work_item_id uuid) returns table (field_key text, company_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select f ->> 'key', co.legal_name
        from work_item w
        cross join lateral (select app.work_item_shared_answers(w.id) as src) a
        join form_version v on v.id = w.form_version_id
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        join participant p on p.id = app.uuid_or_null(a.src -> (f ->> 'key')) and p.project_id = w.project_id
        join company co on co.id = p.company_id
        where w.id = p_work_item_id and f ->> 'type' = 'participant' and jsonb_typeof(a.src -> (f ->> 'key')) = 'string';
    end
  $$;

-- The Stage of a visible Submitted item as every Company but its holder reads it:
-- the Step the holding Participant entered at (app.step_as_seen), never an internal one.
create function app.work_item_shared_stage(p_work_item_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select s.stage_key from work_item w
        join workflow_step s on s.id = w.participant_entered_step_id
        where w.id = p_work_item_id and app.sees_work_item(w.id) and w.submitted_at is not null
      );
    end
  $$;

-- A visible Submitted item's Documents as of its last arrival: those everyone but its
-- holder reads (app.item_row_as_arrived), never one added since.
create function app.work_item_shared_documents(p_work_item_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select d.id from document d
        join work_item w on w.id = d.work_item_id
        where d.work_item_id = p_work_item_id and app.sees_work_item(w.id) and w.submitted_at is not null
          and d.confirmed_at is not null and d.removed_at is null
          and (d.arrival < w.arrivals or w.closed_at is not null);
    end
  $$;

-- A visible Submitted item's Links as of its last arrival, as everyone but its holder
-- reads them (app.item_row_as_arrived: one removed since included, one added since
-- not), by the linked item's Document Number and Subject only, leaving out an unshared
-- item of its own chain.
create function app.work_item_shared_links(p_work_item_id uuid)
  returns table (id uuid, kind text, field_key text, document_number text, subject text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select l.id, l.kind, l.field_key, t.document_number, t.title
        from work_item_link l
        join work_item f on f.id = l.from_id
        join work_item t on t.id = l.to_id
        where l.from_id = p_work_item_id and app.sees_work_item(f.id) and f.submitted_at is not null
          and (l.arrival < f.arrivals or f.closed_at is not null)
          and not app.chain_item_unshared(f.id, t.id)
        order by l.created_at, t.document_number collate "C", l.id;
    end
  $$;

revoke all on function
  app.shared_company(uuid, uuid),
  app.chain_item_unshared(uuid, uuid)
  from public;
revoke all on function
  app.can_discard_draft(uuid),
  app.discard_draft(uuid, timestamptz),
  app.duplicate_of_key(uuid),
  app.record_duplicate(uuid, uuid, uuid),
  app.work_item_duplicated_from(uuid),
  app.own_written_fields(uuid),
  app.work_item_shared_answers(uuid),
  app.work_item_shared_named_answers(uuid),
  app.work_item_shared_stage(uuid),
  app.work_item_shared_documents(uuid),
  app.work_item_shared_links(uuid)
  from public;
grant execute on function
  app.can_discard_draft(uuid),
  app.discard_draft(uuid, timestamptz),
  app.duplicate_of_key(uuid),
  app.record_duplicate(uuid, uuid, uuid),
  app.work_item_duplicated_from(uuid),
  app.own_written_fields(uuid),
  app.work_item_shared_answers(uuid),
  app.work_item_shared_named_answers(uuid),
  app.work_item_shared_stage(uuid),
  app.work_item_shared_documents(uuid),
  app.work_item_shared_links(uuid)
  to rabaed_app;
