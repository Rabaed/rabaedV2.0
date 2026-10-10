-- The List's row commands (RP-409, the owner's design and decisions of 2026-10-10).
--
-- * Delete = discard the viewer's own Draft, every Draft (an original too, not only a
--   Revision): app.can_discard_draft / app.discard_draft. Only while it never left
--   Draft (no Document Number was issued), by an active Member of the raiser's
--   Participant. It closes as cancelled, is marked discarded, its assignment done and
--   its access rows removed, so nobody sees it again; the row stays, with when it was
--   started, for audit (GLOSSARY "Creation Date"). A discarded original frees nothing:
--   it had no number. As app.discard_revision does for a Revision, which stays as it is.
-- * Duplicate: the new Draft's own `duplicated` event, internal to the raiser's
--   Participant, names the item it was duplicated from (its Document Number as the
--   duplicating Member read it) and carries the request's idempotency key, so a repeated
--   request answers with the same Draft (app.record_duplicate, app.duplicate_of_key).
--   app.own_written_fields gives the fields of an item whose last writer is of the
--   acting Member's own Participant, so a Duplicate copies only those.
-- * Download: app.work_item_shared_answers gives a Submitted item's answers as they were
--   last shared (the answers as they arrived at the Participant holding it), never
--   anyone's in-progress answers, for every viewer, the holder's own Company included;
--   stripped as app.work_item_answers strips them (V14, V15).

alter table work_item drop constraint work_item_discarded_closed;
alter table work_item add constraint work_item_discarded_closed check (discarded_at is null or closed_at is not null);

alter table work_item_event drop constraint work_item_event_type_check;
alter table work_item_event add constraint work_item_event_type_check check (type in (
  'created', 'transition', 'recommend_code', 'issue_code', 'assigned', 'claimed', 'released', 'vacated',
  'admin_reassigned', 'admin_reset', 'internal_note', 'cancelled', 'answers_changed', 'duplicated'
));

-- One Draft per Duplicate request of a Member.
create unique index work_item_event_duplicate_key on work_item_event (actor_member_id, (payload ->> 'idempotency_key'))
  where type = 'duplicated';

-- Whether the acting Member may discard a visible Draft: never numbered, still at its
-- Draft Step, on an active Project, by an active Member of the raiser's Participant.
create function app.can_discard_draft(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.sees_work_item(p_work_item_id) and exists (
        select 1
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        join app.acting_project_member(w.id) me on me.participant_id = w.raised_by_participant_id
        where w.id = p_work_item_id
          and w.closed_at is null and w.document_number is null and app.is_draft_step(w.current_step_id)
      );
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

-- The Draft a Member already made for this Duplicate request, if one stands and they see it.
create function app.duplicate_of_key(p_idempotency_key uuid) returns uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select e.work_item_id from work_item_event e
        where e.type = 'duplicated' and e.actor_member_id = app.current_member_id()
          and e.payload ->> 'idempotency_key' = p_idempotency_key::text
          and app.sees_work_item(e.work_item_id)
        limit 1
      );
    end
  $$;

-- Records on a new Draft the item it was duplicated from: its own `duplicated` event,
-- internal to the raiser's Participant. 'recorded' or 'not_found'.
create function app.record_duplicate(p_work_item_id uuid, p_source_id uuid, p_idempotency_key uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
      v_me record;
      v_number text;
    begin
      if not app.sees_work_item(p_work_item_id) or not app.sees_work_item(p_source_id) then
        return 'not_found';
      end if;
      select * into v_item from work_item where id = p_work_item_id;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_me.participant_id is distinct from v_item.raised_by_participant_id then
        return 'not_found';
      end if;
      select document_number into v_number from work_item where id = p_source_id;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, from_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, p_work_item_id, 'duplicated', app.current_member_id(), v_me.participant_id, v_item.current_step_id,
        jsonb_build_object('document_number', v_number, 'idempotency_key', p_idempotency_key::text),
        'internal', v_item.raised_by_participant_id, greatest(p_now, now())
      );
      return 'recorded';
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

-- A Submitted item's answers as last shared: as they arrived at the Participant holding
-- it (`data_as_arrived`, kept from the holder's first save), else as stored, which then
-- nobody has changed since they arrived. Never in-progress answers, for any viewer, the
-- holder's own Company included. Null before the first Submit: nothing is shared yet.
-- Stripped as app.work_item_answers strips them.
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
        cross join lateral (select coalesce(w.data_as_arrived, app.work_item_full_answers(w.id)) as src) a
        where w.id = p_work_item_id and app.sees_work_item(w.id) and w.submitted_at is not null
      );
    end
  $$;

revoke all on function
  app.can_discard_draft(uuid),
  app.discard_draft(uuid, timestamptz),
  app.duplicate_of_key(uuid),
  app.record_duplicate(uuid, uuid, uuid, timestamptz),
  app.own_written_fields(uuid),
  app.work_item_shared_answers(uuid)
  from public;
grant execute on function
  app.can_discard_draft(uuid),
  app.discard_draft(uuid, timestamptz),
  app.duplicate_of_key(uuid),
  app.record_duplicate(uuid, uuid, uuid, timestamptz),
  app.own_written_fields(uuid),
  app.work_item_shared_answers(uuid)
  to rabaed_app;
