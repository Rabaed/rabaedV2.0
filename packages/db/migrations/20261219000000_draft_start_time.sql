-- No Draft-started time in three more channels (RP-393; RP-373 grilling,
-- visibility.md the "Creation Date" row, scenarios 75 and 76). When a Draft was
-- started stays for audit; once the item is numbered it reaches nobody.
--
-- * The weekly Step Age report leaves out an un-numbered Draft: it has no Step
--   Age (as in the List, RP-348).
-- * `revision_created` is sent when the Revision gets its Document Number, not
--   when its Draft is created, and is dated then: its Creation Date. Who gets it
--   doesn't change (the chain's watchers who see it, never its raiser). A
--   notification row for it is never written while it has no number, nor dated
--   other than its Creation Date.
-- * A Revision's copied Documents keep the source's upload times (`created_at`,
--   `confirmed_at`, read as `uploadedAt`), never the Revision's start.
-- Rows written before this migration are brought in line at the end.

-- The report ---------------------------------------------------------------------

-- As in 20261216100000_notification_helpers.sql, but with no un-numbered Draft.
create or replace function app.take_step_age_report(p_outbox_id uuid)
  returns table (
    to_address text, language text, project_id uuid, project_name jsonb, open_stage_keys text[],
    work_item_id uuid, document_number text, subject text, stage_name jsonb,
    held_by_own boolean, step_name jsonb, holder_name jsonb, entered_at timestamptz
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_saved text := current_setting('app.member_id', true);
      v_project uuid;
      v_member uuid;
    begin
      perform app.require_worker();
      select o.project_id, (o.payload ->> 'member_id')::uuid into v_project, v_member
      from outbox o where o.id = p_outbox_id and o.kind = 'step_age_report' and o.processed_at is null;
      if v_member is null then
        return;
      end if;
      -- A closed Project goes quiet.
      if not exists (select 1 from project p where p.id = v_project and p.status = 'active') then
        return;
      end if;
      -- Still on the Project, holding Assign.
      if not exists (
        select 1 from project_member pm
        join member m on m.id = pm.member_id and m.status = 'active'
        where pm.project_id = v_project and pm.member_id = v_member and pm.status = 'active'
          and app.project_member_holds_assign(pm.id)
      ) then
        return;
      end if;
      -- Their settings now: the group's email off, email paused, the Project muted.
      -- "Immediately" and "daily digest" both send it: the report has its own time.
      if coalesce((select r.email from app.member_notification_route(v_member, v_project, 'weekly_report', null) r), 'none') = 'none' then
        return;
      end if;

      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_member::text, true);
      return query
        select m.email, coalesce(pref.preferred_language, m.locale), pr.id, pr.name,
          array(
            select s.key from stage s
            where s.module_key = 'submittals' and s.project_id is null and s.category in ('draft', 'in_progress')
            order by s.sort, s.key
          ),
          i.id, i.document_number, i.title, i.stage_name, i.held_by_own, i.step_name, i.holder_name, i.entered_at
        from member m
        left join member_notification_preference pref on pref.member_id = m.id
        join project pr on pr.id = v_project
        cross join lateral (
          select w.id, w.document_number, w.title, st.name as stage_name,
            coalesce(h.participant_id in (select app.current_participant_ids()), false) as held_by_own,
            s.name as step_name, hc.legal_name as holder_name, seen.entered_at
          from work_item w
          cross join lateral app.step_as_seen(w.id) seen
          join workflow_step s on s.id = seen.step_id
          join work_item_type t on t.id = w.work_item_type_id
          join stage st on st.module_key = t.module_key and st.key = seen.stage_key and st.project_id is null
          left join lateral (select * from app.work_item_holder(w.id) limit 1) h on true
          left join lateral (
            select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = h.participant_id
          ) hc on true
          where w.project_id = v_project and t.module_key = 'submittals'
            and st.category in ('draft', 'in_progress')
            -- An un-numbered Draft has no Step Age (scenario 76).
            and w.document_number is not null
            and app.latest_visible_revision(w.id)
        ) i
        where m.id = v_member
        order by i.entered_at, i.id;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
    end
  $$;

-- revision_created ---------------------------------------------------------------

-- As in 20261211000000_notification_settings.sql, but a new Revision's `created`
-- event no longer goes out here (its trigger no longer fires for `created`):
-- app.outbox_revision_numbered sends it when the Revision is numbered.
create or replace function app.outbox_watched_event() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if exists (
          select 1 from work_item_watch ww join work_item w on w.root_id = ww.root_id
          where w.id = new.work_item_id and ww.member_id is distinct from new.actor_member_id
        )
      then
        insert into outbox (kind, project_id, payload, created_at, available_at)
        values ('notification', new.project_id,
          jsonb_strip_nulls(jsonb_build_object('work_item_id', new.work_item_id, 'work_item_event_id', new.id,
            'actor_member_id', new.actor_member_id)),
          new.created_at, now());
      end if;
      return null;
    end
  $$;
drop trigger work_item_event_outbox_watched on work_item_event;
create trigger work_item_event_outbox_watched after insert on work_item_event
  for each row when (new.type in ('transition', 'issue_code', 'cancelled'))
  execute function app.outbox_watched_event();

-- A Revision got its Document Number: its `created` event goes out to the
-- chain's watchers other than its raiser (the event's actor, as before), dated
-- its Creation Date.
create function app.outbox_revision_numbered() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_event record;
    begin
      select e.id, e.actor_member_id into v_event from work_item_event e
      where e.work_item_id = new.id and e.type = 'created';
      if v_event.id is not null and exists (
        select 1 from work_item_watch ww
        where ww.root_id = new.root_id and ww.member_id is distinct from v_event.actor_member_id
      ) then
        insert into outbox (kind, project_id, payload, created_at, available_at)
        values ('notification', new.project_id,
          jsonb_strip_nulls(jsonb_build_object('work_item_id', new.id, 'work_item_event_id', v_event.id,
            'actor_member_id', v_event.actor_member_id)),
          new.numbered_at, now());
      end if;
      return null;
    end
  $$;
create trigger work_item_revision_numbered after update of numbered_at on work_item
  for each row when (old.numbered_at is null and new.numbered_at is not null and new.revision_no > 0)
  execute function app.outbox_revision_numbered();

-- Every revision_created notification is dated its Revision's Creation Date, in
-- the bell and the email digest alike, and none is written while it has none.
create function app.revision_created_once_numbered() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_numbered_at timestamptz;
    begin
      select w.numbered_at into v_numbered_at from work_item w where w.id = new.work_item_id;
      if v_numbered_at is null then
        return null;
      end if;
      new.created_at := v_numbered_at;
      return new;
    end
  $$;
create trigger notification_revision_created before insert on notification
  for each row when (new.event_type = 'revision_created')
  execute function app.revision_created_once_numbered();

revoke all on function app.outbox_revision_numbered(), app.revision_created_once_numbered() from public;

-- Copied Documents ---------------------------------------------------------------

-- As in 20261105000000_create_revision.sql, but each copied Document keeps the
-- source's created_at and confirmed_at.
create or replace function app.create_revision(p_work_item_id uuid, p_idempotency_key uuid, p_now timestamptz)
  returns table (outcome text, work_item_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_me record;
      v_used record;
      v_draft record;
      v_form_version_id uuid;
      v_id uuid;
      v_kept text[];
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      -- The chain's original, locked: one Revision of a chain at a time.
      perform 1 from work_item r
      where r.id = (select w.root_id from work_item w where w.id = p_work_item_id)
      for update;
      select w.*, t.code as type_code, pr.status as project_status into v_item
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join project pr on pr.id = w.project_id
      where w.id = p_work_item_id;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;

      select c.work_item_id, c.command into v_used from command_idempotency c
      where c.member_id = v_member_id and c.key = p_idempotency_key;
      if v_used.work_item_id is not null then
        return query select
          case when v_used.command = 'create_revision:' || p_work_item_id then 'applied' else 'idempotency_key_reused' end,
          case when v_used.command = 'create_revision:' || p_work_item_id then v_used.work_item_id end;
        return;
      end if;
      if v_item.project_status <> 'active' then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if not app.can_create_revision(p_work_item_id) then
        return query select 'revision_not_allowed'::text, null::uuid;
        return;
      end if;

      select * into v_draft from app.latest_draft_step(v_item.work_item_type_id);
      v_form_version_id := app.latest_form_version(v_item.type_code);
      insert into work_item (
        project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data,
        workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at,
        revision_no, revision_of_id, root_id, created_at, updated_at
      ) values (
        v_item.project_id, v_item.work_item_type_id, v_item.raised_by_participant_id, v_member_id, v_item.title, '{}',
        v_draft.workflow_version_id, v_form_version_id, v_draft.step_id, v_draft.stage_key, v_at,
        v_item.revision_no + 1, v_item.id, v_item.root_id, v_at, v_at
      ) returning id into v_id;

      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (v_id, v_item.project_id, v_item.raised_by_participant_id, v_at, 'raised');
      insert into step_assignment (project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at)
      values (v_item.project_id, v_id, v_draft.step_id, v_item.raised_by_participant_id, v_member_id, 'claimed', v_at, v_at);
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, v_id, 'created', v_member_id, v_item.raised_by_participant_id, v_draft.step_id,
        jsonb_build_object('title', v_item.title, 'revision_no', v_item.revision_no + 1),
        'internal', v_item.raised_by_participant_id, v_at
      );

      -- The answers (RP-305: never another Participant's sections).
      if app.fill_revision(v_id, p_work_item_id, v_at) <> 'filled' then
        raise exception 'fill_revision refused a new Revision';
      end if;

      -- The Documents, as new unfrozen rows: of the Attachments System Field, and of
      -- the fields the Revision still has.
      v_kept := array(
        select f ->> 'key'
        from form_version v
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where v.id = v_form_version_id
          and app.form_field_type(v_item.form_version_id, f ->> 'key') = f ->> 'type'
        except select unnest(app.revision_dropped_keys(v_id)));
      with source as materialized (
        select app.uuid_v7() as new_id, d.*
        from (
          select d.* from document d
          where d.work_item_id = p_work_item_id and d.confirmed_at is not null and d.removed_at is null
            and (d.field_key is null or d.field_key = any (v_kept))
          order by d.confirmed_at, d.id
        ) d
      ), copied as (
        insert into document (
          id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
          uploaded_by_member_id, uploaded_by_participant_id, created_at, confirmed_at,
          field_key, item_key, taken_at, taken_latitude, taken_longitude
        )
        select s.new_id, s.project_id, v_id, s.file_name, s.size_bytes, s.content_type,
          app.document_storage_key(s.project_id, v_id, s.new_id),
          s.uploaded_by_member_id, s.uploaded_by_participant_id, s.created_at, s.confirmed_at,
          s.field_key, s.item_key, s.taken_at, s.taken_latitude, s.taken_longitude
        from source s
        returning document.id
      )
      insert into document_copy (document_id, copied_from_id)
      select s.new_id, s.id from source s join copied c on c.id = s.new_id;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, v_id, 'create_revision:' || p_work_item_id, v_at);
      return query select 'created'::text, v_id;
    end
  $$;

-- Rows written before this migration ----------------------------------------------

-- Copies made so far: the times of the Document first uploaded, through any
-- copy of a copy. A Submitted Revision's copies are frozen, and a frozen
-- Document never changes: the trigger is off for this one correction, which
-- touches only these two times of copies, never a file, name or owner.
alter table document disable trigger document_frozen;
with recursive origin as (
  select c.document_id, c.copied_from_id as source_id from document_copy c
  union all
  select o.document_id, c.copied_from_id from origin o join document_copy c on c.document_id = o.source_id
)
update document d set created_at = s.created_at, confirmed_at = s.confirmed_at
from origin o
join document s on s.id = o.source_id
where d.id = o.document_id
  and not exists (select 1 from document_copy c where c.document_id = o.source_id);
alter table document enable trigger document_frozen;

-- revision_created sent so far: dated the Creation Date, or withdrawn while the
-- Revision has none (it is sent again when it gets its number).
update notification n set created_at = w.numbered_at
from work_item w
where w.id = n.work_item_id and n.event_type = 'revision_created' and w.numbered_at is not null;
update notification n set withdrawn_at = now()
from work_item w
where w.id = n.work_item_id and n.event_type = 'revision_created' and w.numbered_at is null and n.withdrawn_at is null;

-- Still waiting in the outbox for a Revision with no number yet: dropped, since
-- app.outbox_revision_numbered sends it when the number comes.
update outbox o set processed_at = now()
from work_item_event e
join work_item w on w.id = e.work_item_id
where o.kind = 'notification' and o.processed_at is null
  and e.id = (o.payload ->> 'work_item_event_id')::uuid and e.type = 'created' and w.numbered_at is null;
