-- RP-620 (spec RP-632; ADR 0023): the tracer of the Documental Record. A Work Item that
-- closes, at any outcome, gets a sealed PDF/A-3 made from its Record Data, which everyone
-- who sees the closed item downloads (workflow-engine.md §7; data-model.md §6; visibility.md
-- V7, the Documental Record row, scenario RP-23-1).
--
-- * The job: an outbox row of the new kind 'documental_record', written by a trigger on
--   work_item when closed_at is first set (app.take_transition and every other close),
--   in the closing transaction; never for a discarded Draft, which nobody sees again.
--   app.take_transition and app.transition_effects are unchanged. The worker runs it like
--   any outbox row: a failure is retried, then dead-lettered, and never rolls the closure
--   back. Its payload is the item's id only, under `closed_work_item_id`.
-- * app.documental_record_facts: what the worker reads to write the Record Data, as the
--   worker (no Member set): the item's Document Number, Revision, Subject, Type and
--   outcome, and every Transition taken on it, in order, with the Member's name, Positions
--   and Company, its time and the content hash (which only this owner read gives). The
--   worker leaves out the Returns and the work around them (recordPath, apps/worker).
--   Internal Notes, Recommended Codes and answers are never read here at all. Null once
--   the item has its record, so a retried row does nothing.
-- * app.save_documental_record: the worker's write, once the PDF is sealed and both files
--   are stored: one stored_file row for each (stored by Rabaed: no uploader) and the
--   documental_record row, published. A second save for the item does nothing.
-- * documental_record: one per item, never changed. Not granted to the app role: its
--   storage keys, fingerprints and verification hash are read only through the functions
--   here. app.documental_record_file gives a Member the PDF's storage key and its file
--   name for a closed item they see (the download's signed link, apps/api), and nothing
--   for any other item, so a hidden item's record is the plain 404.

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check
  check (kind in ('notification', 'email', 'digest', 'step_age_report', 'documental_record'));

create table documental_record (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  work_item_id uuid not null,
  pdf_file_id uuid not null references stored_file (id),
  record_data_file_id uuid not null references stored_file (id),
  layout_version text not null check (layout_version ~ '^[0-9]+$'),
  language text not null check (language in ('bilingual', 'ar', 'en')),
  outcome text not null,
  pdf_sha256 bytea not null check (length(pdf_sha256) = 32),
  sealed_at timestamptz not null,
  -- The SHA-256 of the verification page's long random link; the link itself is in the PDF.
  verification_token_hash bytea not null check (length(verification_token_hash) = 32),
  -- The short code printed on every page (RP-157 asks for it with the Document Number).
  verification_code text not null check (verification_code ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  status text not null default 'published' check (status in ('preparing', 'published', 'failed_checks')),
  created_at timestamptz not null default now(),
  constraint documental_record_one_per_item unique (work_item_id),
  constraint documental_record_token_key unique (verification_token_hash),
  constraint documental_record_code_key unique (verification_code),
  constraint documental_record_item_fk foreign key (work_item_id, project_id) references work_item (id, project_id)
);
alter table documental_record enable row level security;
revoke all on documental_record from rabaed_app;

-- Written once (RP-155's Re-produce will replace the PDF through its own function, keeping
-- the replaced one in documental_record_reproduction).
create function app.refuse_documental_record_change() returns trigger
  language plpgsql
  as $$
    begin
      raise exception 'documental_record is written once' using errcode = '42501';
    end
  $$;
revoke all on function app.refuse_documental_record_change() from public;
create trigger documental_record_written_once before update or delete on documental_record
  for each row execute function app.refuse_documental_record_change();

-- The record job, in the closing transaction: one outbox row for the item.
create function app.queue_documental_record() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into outbox (kind, project_id, payload)
      values ('documental_record', new.project_id, jsonb_build_object('closed_work_item_id', new.id));
      return null;
    end
  $$;
revoke all on function app.queue_documental_record() from public;
create trigger work_item_queues_documental_record after update of closed_at on work_item
  for each row
  when (old.closed_at is null and new.closed_at is not null and new.discarded_at is null)
  execute function app.queue_documental_record();

-- The item of a 'documental_record' outbox row, or null for any other row.
create function app.documental_record_item(p_outbox_id uuid) returns uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select (o.payload ->> 'closed_work_item_id')::uuid from outbox o
        where o.id = p_outbox_id and o.kind = 'documental_record'
      );
    end
  $$;
revoke all on function app.documental_record_item(uuid) from public;

-- What the Record Data is written from (see the header), as the worker; null when the row
-- is not a record job, the item is not closed, or it has its record already.
create function app.documental_record_facts(p_outbox_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item_id uuid;
      v_facts jsonb;
    begin
      perform app.require_worker();
      v_item_id := app.documental_record_item(p_outbox_id);
      if v_item_id is null or exists (select 1 from documental_record r where r.work_item_id = v_item_id) then
        return null;
      end if;
      select jsonb_build_object(
          'workItemId', w.id,
          'projectId', w.project_id,
          'projectName', pr.name,
          'type', jsonb_build_object('code', t.code, 'name', t.name),
          'documentNumber', w.document_number,
          'revisionNo', w.revision_no,
          'subject', w.title,
          'outcome', w.outcome,
          'closedAt', to_char(w.closed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'transitions', coalesce((
            -- The Owner's review writes one copy of a move for each side of it: one is enough.
            select jsonb_agg(x.fact order by x.seq)
            from (
              select distinct on (e.transition_id, e.created_at, e.actor_member_id) e.seq,
                jsonb_build_object(
                  'fromStepId', e.from_step_id,
                  'toStepId', e.to_step_id,
                  'label', tr.label,
                  'at', to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'memberName', m.full_name,
                  'positions', coalesce((
                    select jsonb_agg(po.name order by po.sort)
                    from project_member pm
                    join project_member_position pmp on pmp.project_member_id = pm.id
                    join position po on po.id = pmp.position_id
                    where pm.participant_id = e.actor_participant_id and pm.member_id = e.actor_member_id
                  ), '[]'::jsonb),
                  'companyName', c.legal_name,
                  'contentSha256', encode(e.content_sha256, 'hex')
                ) as fact
              from work_item_event e
              join workflow_transition tr on tr.id = e.transition_id
              join member m on m.id = e.actor_member_id
              join participant p on p.id = e.actor_participant_id
              join company c on c.id = p.company_id
              where e.work_item_id = w.id and e.type in ('transition', 'issue_code')
              order by e.transition_id, e.created_at, e.actor_member_id, e.seq
            ) x
          ), '[]'::jsonb)
        )
      into v_facts
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      where w.id = v_item_id and w.closed_at is not null and w.discarded_at is null;
      return v_facts;
    end
  $$;
revoke all on function app.documental_record_facts(uuid) from public;
grant execute on function app.documental_record_facts(uuid) to rabaed_app;

-- The worker's write of the sealed record (see the header). False when the item already
-- has one, or the row is not a record job.
create function app.save_documental_record(
  p_outbox_id uuid, p_pdf_storage_key text, p_pdf_sha256 bytea, p_pdf_size bigint,
  p_data_storage_key text, p_data_sha256 bytea, p_data_size bigint,
  p_layout_version text, p_language text, p_sealed_at timestamptz,
  p_verification_token_hash bytea, p_verification_code text
) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
      v_pdf uuid;
      v_data uuid;
    begin
      perform app.require_worker();
      select w.id, w.project_id, w.outcome into v_item
      from work_item w
      where w.id = app.documental_record_item(p_outbox_id) and w.closed_at is not null
      for update;
      if v_item.id is null or exists (select 1 from documental_record r where r.work_item_id = v_item.id) then
        return false;
      end if;
      insert into stored_file (storage_key, sha256, size, mime)
      values (p_pdf_storage_key, p_pdf_sha256, p_pdf_size, 'application/pdf') returning id into v_pdf;
      insert into stored_file (storage_key, sha256, size, mime)
      values (p_data_storage_key, p_data_sha256, p_data_size, 'application/xml') returning id into v_data;
      insert into documental_record (
        project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
        pdf_sha256, sealed_at, verification_token_hash, verification_code, status
      ) values (
        v_item.project_id, v_item.id, v_pdf, v_data, p_layout_version, p_language, v_item.outcome,
        p_pdf_sha256, p_sealed_at, p_verification_token_hash, p_verification_code, 'published'
      );
      return true;
    end
  $$;
revoke all on function app.save_documental_record(uuid, text, bytea, bigint, text, bytea, bigint, text, text, timestamptz, bytea, text) from public;
grant execute on function app.save_documental_record(uuid, text, bytea, bigint, text, bytea, bigint, text, text, timestamptz, bytea, text) to rabaed_app;

-- A closed item's published record, for its download: the PDF's storage key and the file
-- name it downloads as, for the calling Member when they see the item; no row otherwise,
-- the same for an item hidden from them, one without a record yet and a made-up id.
create function app.documental_record_file(p_work_item_id uuid)
  returns table (storage_key text, file_name text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if app.current_member_id() is null or not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        select f.storage_key,
          coalesce(w.document_number, t.code) || '.pdf'
        from documental_record r
        join stored_file f on f.id = r.pdf_file_id
        join work_item w on w.id = r.work_item_id
        join work_item_type t on t.id = w.work_item_type_id
        where r.work_item_id = p_work_item_id and r.status = 'published';
    end
  $$;
revoke all on function app.documental_record_file(uuid) from public;
grant execute on function app.documental_record_file(uuid) to rabaed_app;
