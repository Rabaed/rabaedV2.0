-- Documents: the Attachments System Field (form-engine.md §2; RP-269, spec RP-261).
--
-- * A Document is a file attached to a Work Item. Its row belongs to the item and
--   its Project, and is read under the item's own row-level security: whoever
--   can't see the item can't see its Documents, or even that they exist.
-- * The file itself is in object storage under its storage key, prefixed by the
--   Project (ADR 0007): projects/<project>/work-items/<item>/documents/<document>.
--   The database writes the key; the api signs short-lived URLs for it, and is
--   the only signer.
-- * Upload is three steps: app.start_document_upload writes a pending row (seen
--   by nobody), the browser uploads the file with a signed URL, and
--   app.confirm_document_upload makes it a Document once the api has found the
--   file in storage as declared.
-- * The raiser's Participant, with the Attach permission, adds and removes
--   Documents while the item is in Draft (app.can_change_documents). When the
--   item leaves Draft (its first Send or Submit), its Documents are frozen: a
--   trigger stamps frozen_at, and a frozen Document never changes again, not even
--   for its owner. A Document is removed by marking it, never by deleting it.

-- Where a Document's file is stored: under its Project first (ADR 0007).
create function app.document_storage_key(p_project_id uuid, p_work_item_id uuid, p_document_id uuid) returns text
  language sql immutable
  set search_path = pg_catalog
  as $$ select 'projects/' || p_project_id || '/work-items/' || p_work_item_id || '/documents/' || p_document_id $$;

create table document (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null references project (id),
  work_item_id uuid not null,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  size_bytes bigint not null check (size_bytes > 0),
  content_type text not null check (content_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  storage_key text not null unique,
  uploaded_by_member_id uuid not null references member (id),
  uploaded_by_participant_id uuid not null,
  created_at timestamptz not null default now(),
  -- Set when the api found the file in storage: until then nobody sees the row.
  confirmed_at timestamptz,
  removed_at timestamptz,
  removed_by_member_id uuid references member (id),
  frozen_at timestamptz,
  constraint document_item_fk foreign key (work_item_id, project_id) references work_item (id, project_id),
  constraint document_participant_fk
    foreign key (uploaded_by_participant_id, project_id) references participant (id, project_id),
  check (storage_key = app.document_storage_key(project_id, work_item_id, id)),
  check ((removed_at is null) = (removed_by_member_id is null)),
  check (removed_at is null or confirmed_at is not null),
  check (frozen_at is null or (confirmed_at is not null and removed_at is null))
);
create index document_work_item_id_idx on document (work_item_id);

-- A frozen Document never changes or goes, whoever asks.
create function app.refuse_frozen_document_change() returns trigger
  language plpgsql
  as $$
    begin
      if old.frozen_at is not null then
        raise exception 'a frozen document never changes' using errcode = '42501';
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end
  $$;
create trigger document_frozen before update or delete on document
  for each row execute function app.refuse_frozen_document_change();

alter table document enable row level security;
revoke insert, update, delete, truncate on document from rabaed_app;

-- Confirmed, not removed, on an item the Member sees (the subquery is itself filtered).
create policy member_reads_documents on document for select to rabaed_app
  using (
    confirmed_at is not null and removed_at is null
    and project_id in (select app.current_project_ids())
    and work_item_id in (select id from work_item)
  );

-- Freezing ------------------------------------------------------------------------

-- The item leaves Draft: its Documents are frozen. Pending uploads can't be
-- confirmed any more, since the item isn't in Draft.
create function app.freeze_documents_leaving_draft() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if app.is_draft_step(old.current_step_id) and not app.is_draft_step(new.current_step_id) then
        update document set frozen_at = new.updated_at
        where work_item_id = new.id and confirmed_at is not null and removed_at is null and frozen_at is null;
      end if;
      return null;
    end
  $$;
create trigger work_item_freezes_documents after update of current_step_id on work_item
  for each row when (old.current_step_id is distinct from new.current_step_id)
  execute function app.freeze_documents_leaving_draft();

-- Who may change them ----------------------------------------------------------------

-- Whether the acting Member may add or remove a visible item's Documents now:
-- they may save its answers (the raiser's Participant, in Draft, on an active
-- Project) and hold the Attach permission. The one rule the commands and the
-- Attachments section follow.
create function app.can_change_documents(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.can_save_answers(p_work_item_id) and exists (
      select 1 from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      cross join lateral app.acting_project_member(w.id) me
      where w.id = p_work_item_id
        and app.project_member_has_permission(me.project_member_id, t.module_key, 'attach')
    )
  $$;

-- The outcome for an item the Member sees but whose Documents they can't change now.
create function app.documents_refusal(p_work_item_id uuid) returns text
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select case
      when exists (select 1 from work_item w join project pr on pr.id = w.project_id
        where w.id = p_work_item_id and pr.status <> 'active') then 'project_closed'
      when app.can_save_answers(p_work_item_id) then 'forbidden'
      else 'not_editable'
    end
  $$;

-- Upload ------------------------------------------------------------------------------

-- Step 1: the acting Member declares a file for a visible item. The api has
-- checked its size and content type against the configured limits. Outcome
-- 'started' with the new row and its storage key, or 'not_found',
-- 'project_closed', 'forbidden' (no Attach permission) or 'not_editable'.
create function app.start_document_upload(
  p_work_item_id uuid, p_file_name text, p_size_bytes bigint, p_content_type text, p_now timestamptz
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
      v_key := app.document_storage_key(v_item.project_id, v_item.id, v_id);
      insert into document (
        id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
        uploaded_by_member_id, uploaded_by_participant_id, created_at
      ) values (
        v_id, v_item.project_id, v_item.id, btrim(p_file_name), p_size_bytes, p_content_type, v_key,
        app.current_member_id(), v_me.participant_id, v_at
      );
      return query select 'started'::text, v_id, v_key;
    end
  $$;

-- The storage key of the acting Member's own pending upload on a visible item,
-- for the api to find the file before confirming it. Null for anyone else's.
create function app.pending_document_upload(p_work_item_id uuid, p_document_id uuid) returns text
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select d.storage_key from document d
    where d.id = p_document_id and d.work_item_id = p_work_item_id
      and d.uploaded_by_member_id = app.current_member_id()
      and d.confirmed_at is null and d.removed_at is null
      and app.sees_work_item(p_work_item_id)
  $$;

-- Step 3: the api found the file in storage with p_size_bytes and
-- p_content_type. Outcome 'confirmed' (also when it already was), 'not_found',
-- 'upload_mismatch' (not the declared file), or as for starting it.
create function app.confirm_document_upload(
  p_work_item_id uuid, p_document_id uuid, p_size_bytes bigint, p_content_type text, p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_doc record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      perform 1 from work_item where id = p_work_item_id for update;
      select * into v_doc from document
      where id = p_document_id and work_item_id = p_work_item_id
        and uploaded_by_member_id = app.current_member_id() and removed_at is null;
      if v_doc.id is null then
        return 'not_found';
      end if;
      if v_doc.confirmed_at is not null then
        return 'confirmed';
      end if;
      if not app.can_change_documents(p_work_item_id) then
        return app.documents_refusal(p_work_item_id);
      end if;
      if p_size_bytes is distinct from v_doc.size_bytes or p_content_type is distinct from v_doc.content_type then
        return 'upload_mismatch';
      end if;
      update document set confirmed_at = v_at where id = p_document_id;
      return 'confirmed';
    end
  $$;

-- Removing ---------------------------------------------------------------------------

-- The acting Member removes a visible Document while they may change the item's
-- Documents. Outcome 'removed', 'not_found', 'document_frozen' (the item has
-- been sent or submitted), or as for starting an upload.
create function app.remove_document(p_work_item_id uuid, p_document_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_doc record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      perform 1 from work_item where id = p_work_item_id for update;
      select * into v_doc from document
      where id = p_document_id and work_item_id = p_work_item_id
        and confirmed_at is not null and removed_at is null;
      if v_doc.id is null then
        return 'not_found';
      end if;
      if v_doc.frozen_at is not null then
        return 'document_frozen';
      end if;
      if not app.can_change_documents(p_work_item_id) then
        return app.documents_refusal(p_work_item_id);
      end if;
      update document set removed_at = v_at, removed_by_member_id = app.current_member_id() where id = p_document_id;
      return 'removed';
    end
  $$;

revoke all on function
  app.document_storage_key(uuid, uuid, uuid),
  app.refuse_frozen_document_change(),
  app.freeze_documents_leaving_draft(),
  app.can_change_documents(uuid),
  app.documents_refusal(uuid),
  app.start_document_upload(uuid, text, bigint, text, timestamptz),
  app.pending_document_upload(uuid, uuid),
  app.confirm_document_upload(uuid, uuid, bigint, text, timestamptz),
  app.remove_document(uuid, uuid, timestamptz)
  from public;
grant execute on function
  app.can_change_documents(uuid),
  app.start_document_upload(uuid, text, bigint, text, timestamptz),
  app.pending_document_upload(uuid, uuid),
  app.confirm_document_upload(uuid, uuid, bigint, text, timestamptz),
  app.remove_document(uuid, uuid, timestamptz)
  to rabaed_app;
