-- Random ids (UUIDv4) instead of UUIDv7 (RP-391; ADR 0015, visibility.md
-- "Creation Date" and scenario 73).
--
-- A UUIDv7 carries the millisecond it was made, so a Work Item's id told anyone
-- who saw the item when its Draft was started; so did the ids of its Links and of
-- the Documents copied into a Revision.
--
-- * Every column default that made a UUIDv7 now makes a random UUIDv4
--   (gen_random_uuid()). Existing rows keep their ids.
-- * The three functions that made one themselves are as in their newest
--   migrations, with gen_random_uuid() in its place:
--   app.add_participant (withdraw_invitation), app.start_document_upload
--   (consultant_section) and app.create_revision (create_revision).
-- * app.work_item_links is as in the sent_back_as_it_was migration, except that
--   Links made at the same time (those copied into a Revision) are ordered by the
--   linked item's Document Number, then id: ids no longer follow the order rows
--   were made in.
-- * app.uuid_v7() is dropped, so nothing can make one again. packages/db/test/id-defaults.test.ts
--   checks every table's id default on the live catalog.
do $$
  declare
    v_column record;
  begin
    for v_column in
      select c.oid::regclass as tbl, a.attname as col
      from pg_catalog.pg_attrdef d
      join pg_catalog.pg_class c on c.oid = d.adrelid
      join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where pg_get_expr(d.adbin, d.adrelid) = 'app.uuid_v7()'
    loop
      execute format('alter table %s alter column %I set default gen_random_uuid()', v_column.tbl, v_column.col);
    end loop;
  end
$$;

-- As in the withdraw_invitation migration, with a random id for a new invitation.
create or replace function app.add_participant(p_project_id uuid, p_cr_number text, p_base_role text, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_cr_number text := trim(p_cr_number);
      v_company_id uuid;
      v_role_id uuid;
      v_lead_id uuid;
      v_participant_id uuid;
    begin
      if not exists (select 1 from app.current_project_ids() x where x = p_project_id) then
        return 'not_found';
      end if;
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        raise exception 'only a Project Admin can invite Participants' using errcode = '42501';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      select id into v_role_id from project_role where owner_kind = 'rabaed' and base_role = p_base_role;
      if v_role_id is null then
        raise exception 'unknown base role %', p_base_role using errcode = '22023';
      end if;

      -- Onboarding the Company with this CR number converts its leads under the
      -- same lock, so a lead is never written after that conversion looked.
      perform app.lock_cr_number(v_cr_number);
      select id into v_company_id from company where cr_number = v_cr_number and status = 'active';
      if v_company_id is null then
        insert into onboarding_lead as l (cr_number, project_id, project_role_id, requested_by_member_id, created_at, updated_at)
        values (v_cr_number, p_project_id, v_role_id, app.current_member_id(), v_at, v_at)
        on conflict (project_id, cr_number) do update
          set project_role_id = excluded.project_role_id, requested_by_member_id = excluded.requested_by_member_id,
            withdrawn_at = null, withdrawn_by_member_id = null, closed_at = null, updated_at = v_at
          -- A converted lead is kept as it was, for audit.
          where l.converted_at is null;
        return 'invited';
      end if;

      if exists (
        select 1 from participant
        where project_id = p_project_id and company_id = v_company_id and status in ('active', 'withdrawn')
      ) then
        return 'already_participant';
      end if;
      -- A lead for this CR number that was never converted (withdrawn before
      -- Rabaed onboarded the Company): the new invitation takes its id, as a
      -- conversion would, so the Project Admin's row keeps its id (scenario 31).
      select l.id into v_lead_id from onboarding_lead l
      where l.project_id = p_project_id and l.cr_number = v_cr_number and l.converted_at is null
      for update;
      insert into participant as p
        (id, project_id, company_id, project_role_id, status, invited_by_member_id, invited_at, created_at, updated_at)
      values (
        coalesce(v_lead_id, gen_random_uuid()), p_project_id, v_company_id, v_role_id, 'invited', app.current_member_id(),
        v_at, v_at, v_at
      )
      on conflict (project_id, company_id) do update
        set status = 'invited', project_role_id = excluded.project_role_id,
          invited_by_member_id = excluded.invited_by_member_id, invited_at = v_at, responded_at = null,
          withdrawn_at = null, withdrawn_by_member_id = null, updated_at = v_at
        where p.status in ('invited', 'declined', 'invitation_withdrawn')
      returning p.id into v_participant_id;
      if v_lead_id is not null and v_participant_id = v_lead_id then
        update onboarding_lead set converted_at = v_at, participant_id = v_lead_id, updated_at = v_at
        where id = v_lead_id;
      end if;
      return 'invited';
    end
  $$;

-- As in the consultant_section migration, with a random id for the Document.
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
      v_id uuid := gen_random_uuid();
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

-- As in the create_revision migration, with random ids for the copied Documents.
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
        select gen_random_uuid() as new_id, d.*
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
          s.uploaded_by_member_id, s.uploaded_by_participant_id, v_at, v_at,
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

-- As in the sent_back_as_it_was migration; Links made at the same time by the
-- linked item's Document Number, then id.
create or replace function app.work_item_links(p_work_item_id uuid)
  returns table(id uuid, kind text, field_key text, document_number text, subject text, work_item_id uuid, created_at timestamp with time zone)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select l.id, l.kind, l.field_key, t.document_number, t.title,
          case when app.sees_work_item(t.id) then t.id end, l.created_at
        from work_item_link l
        join work_item t on t.id = l.to_id
        where l.from_id = p_work_item_id and app.sees_work_item(p_work_item_id)
          and app.item_row_seen(l.from_id, l.arrival, l.removed_at is not null)
          and not app.chain_item_hidden(p_work_item_id, t.id)
        order by l.created_at, t.document_number collate "C", l.id;
    end
  $$;

-- As in the sent_back_as_it_was migration; in app.work_item_links' order, so
-- Links made at the same time go by the linked item's Document Number, then id.
create or replace function app.free_links_record(p_work_item_id uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select coalesce(jsonb_agg(
      jsonb_build_object('documentNumber', t.document_number, 'subject', t.title)
      order by l.created_at, t.document_number collate "C", l.id), '[]')
    from work_item_link l
    join work_item t on t.id = l.to_id
    where l.from_id = p_work_item_id and l.kind = 'related' and l.removed_at is null
  $$;

drop function app.uuid_v7();
