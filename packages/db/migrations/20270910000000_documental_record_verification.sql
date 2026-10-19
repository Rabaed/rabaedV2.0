-- RP-157 (spec RP-632; ADR 0023; workflow-engine.md §7; data-model.md §6; visibility.md, the
-- Verification page row, scenario RP-23-4): the public verification of a Documental Record.
--
-- Anyone holding a record checks it without signing in, through the customer api's public route,
-- which connects as rabaed_app with no Member set. Nothing new is granted on any table: the two
-- functions below are the only way in, and each gives exactly what the record's first page printed,
-- for a published record only. Never the live item: no work_item, project or outcome row is read.
--
-- * documental_record_face: the record's printed face, as the worker took it from the Record Data
--   it had just written (apps/worker/src/record/face.ts): the language(s) printed, the Document
--   Number, Subject, Project, outcome, and each signer on the path to the outcome (name, Positions,
--   Company), in path order, each text only in the language(s) the record printed. Written by
--   app.save_documental_record_face (the worker, at the record job and again at a Re-produce that
--   passes); admin-only (no grant to the app role). A record made before RP-157 has none, and
--   answers as a record that doesn't exist (no backfill: spec RP-632, Out of Scope).
-- * app.verify_documental_record_by_token(token hash): the QR's long link. The api hashes the
--   token (SHA-256, as the record job stored it in documental_record.verification_token_hash).
-- * app.verify_documental_record_by_code(code, Document Number, visitor, now, limit, window): the
--   short Verification Code typed with the record's printed Document Number. Every call is an
--   attempt of the visitor's (the SHA-256 of their address, from the api), kept in
--   verification_attempt for the window; past the limit it answers 'too_many_attempts' whatever
--   the pair. A code alone, a wrong pair, and a record that is still 'preparing' or
--   'failed_checks', or has no face, are all 'not_found', the answer a record that doesn't exist gets.
-- * app.documental_record_verification(record) (not granted): what both answer. The face, the sealed
--   date and the fingerprints: documental_record.pdf_sha256 (the current PDF) and
--   documental_record_reproduction.replaced_sha256 of each replaced PDF that was published, never
--   stored_file.sha256, which keeps the first PDF's; genuine, or replaced on the date of the latest
--   such Re-produce.
--
-- app.take_transition, app.transition_effects and app.save_documental_record are not touched.

-- The printed face of each record (see the header).
create table documental_record_face (
  documental_record_id uuid primary key references documental_record (id),
  language text not null check (language in ('bilingual', 'ar', 'en')),
  -- Null only for an item Cancelled before it was ever numbered, as the record printed it.
  document_number text,
  subject text not null,
  -- Text objects with only the printed language(s): {"ar": …, "en": …}.
  project jsonb not null check (jsonb_typeof(project) = 'object'),
  outcome jsonb not null check (jsonb_typeof(outcome) = 'object'),
  signers jsonb not null check (jsonb_typeof(signers) = 'array'),
  written_at timestamptz not null default now()
);
create index documental_record_face_number_idx on documental_record_face (upper(document_number));
alter table documental_record_face enable row level security;
revoke all on documental_record_face from rabaed_app;
revoke insert, update, delete, truncate on documental_record_face from rabaed_admin;

-- The worker's write of a record's face, for the record of a 'documental_record' or
-- 'documental_record_reproduce' outbox row: the face replaces any it had (a Re-produce prints the same
-- Record Data). False when the row names no record.
create function app.save_documental_record_face(p_outbox_id uuid, p_face jsonb) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_record_id uuid;
    begin
      perform app.require_worker();
      select r.id into v_record_id
      from outbox o
      join documental_record r on r.work_item_id = coalesce(o.payload ->> 'closed_work_item_id', o.payload ->> 'work_item_id')::uuid
      where o.id = p_outbox_id and o.kind in ('documental_record', 'documental_record_reproduce');
      if v_record_id is null then
        return false;
      end if;
      insert into documental_record_face (documental_record_id, language, document_number, subject, project, outcome, signers)
      values (
        v_record_id, p_face ->> 'language', p_face ->> 'documentNumber', p_face ->> 'subject',
        p_face -> 'project', p_face -> 'outcome', p_face -> 'signers'
      )
      on conflict (documental_record_id) do update set
        language = excluded.language, document_number = excluded.document_number, subject = excluded.subject,
        project = excluded.project, outcome = excluded.outcome, signers = excluded.signers, written_at = now();
      return true;
    end
  $$;
revoke all on function app.save_documental_record_face(uuid, jsonb) from public;
grant execute on function app.save_documental_record_face(uuid, jsonb) to rabaed_app;

-- One row per typed-code attempt, for the window only: the visitor is the SHA-256 of their address,
-- never the address. Not granted to the app role; written and pruned by the function below.
create table verification_attempt (
  visitor_sha256 bytea not null check (length(visitor_sha256) = 32),
  attempted_at timestamptz not null
);
create index verification_attempt_visitor_idx on verification_attempt (visitor_sha256, attempted_at);
create index verification_attempt_at_idx on verification_attempt (attempted_at);
alter table verification_attempt enable row level security;
revoke all on verification_attempt from rabaed_app;
revoke all on verification_attempt from rabaed_admin;

-- What the verification page shows of a published record with a face (see the header); null for any other.
create function app.documental_record_verification(p_record_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_result jsonb;
    begin
      select jsonb_build_object(
          'documentNumber', f.document_number,
          'subject', f.subject,
          'project', f.project,
          'outcome', f.outcome,
          'sealedAt', app.iso_utc(r.sealed_at),
          'signers', f.signers,
          'fingerprints', jsonb_build_object('current', encode(r.pdf_sha256, 'hex'), 'replaced', rp.replaced)
        ) || case
          when rp.replaced = '[]'::jsonb then jsonb_build_object('status', 'genuine')
          else jsonb_build_object('status', 'replaced', 'replacedAt', rp.replaced -> -1 ->> 'replacedAt')
        end
      into v_result
      from documental_record r
      join documental_record_face f on f.documental_record_id = r.id
      cross join lateral (
        -- A PDF a Re-produce replaced while the record was published: one a customer may hold. One that
        -- failed its checks was never given to anyone.
        select coalesce(jsonb_agg(jsonb_build_object('sha256', encode(x.replaced_sha256, 'hex'), 'replacedAt', app.iso_utc(x.created_at))
          order by x.created_at, x.id), '[]'::jsonb) as replaced -- hidden-sort-key: Rabaed's own Re-produce history, whose dates the page shows anyway
        from documental_record_reproduction x
        where x.documental_record_id = r.id and x.previous_status = 'published'
      ) rp
      where r.id = p_record_id and r.status = 'published';
      return v_result;
    end
  $$;
revoke all on function app.documental_record_verification(uuid) from public;

-- The QR's long link: the record whose token hashes to p_token_hash, published; null otherwise.
create function app.verify_documental_record_by_token(p_token_hash bytea) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.documental_record_verification(
        (select r.id from documental_record r where r.verification_token_hash = p_token_hash)
      );
    end
  $$;
revoke all on function app.verify_documental_record_by_token(bytea) from public;
grant execute on function app.verify_documental_record_by_token(bytea) to rabaed_app;

-- A typed Verification Code with its printed Document Number, counted against the visitor (see the
-- header). Outcome: 'found' with the record, 'not_found', or 'too_many_attempts' once the visitor has
-- made p_limit attempts within p_window (this one not counted then).
create function app.verify_documental_record_by_code(
  p_code text, p_document_number text, p_visitor_sha256 bytea, p_now timestamptz, p_limit integer, p_window interval
) returns table (outcome text, verification jsonb)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_verification jsonb;
    begin
      if p_visitor_sha256 is null or length(p_visitor_sha256) <> 32 or p_now is null or p_limit is null or p_limit < 1 or p_window is null then
        raise exception 'a visitor, the time and a limit are required' using errcode = '22023';
      end if;
      -- One visitor's attempts are counted one at a time, so a burst cannot slip past the limit.
      perform pg_advisory_xact_lock(hashtextextended('verification_attempt:' || encode(p_visitor_sha256, 'hex'), 0));
      delete from verification_attempt a where a.attempted_at <= p_now - p_window;
      if (select count(*) from verification_attempt a where a.visitor_sha256 = p_visitor_sha256 and a.attempted_at > p_now - p_window) >= p_limit then
        return query select 'too_many_attempts'::text, null::jsonb;
        return;
      end if;
      insert into verification_attempt (visitor_sha256, attempted_at) values (p_visitor_sha256, p_now);
      v_verification := app.documental_record_verification((
        select r.id
        from documental_record r
        join documental_record_face f on f.documental_record_id = r.id
        where r.verification_code = p_code
          and f.document_number is not null
          and upper(f.document_number) = upper(btrim(coalesce(p_document_number, '')))
      ));
      return query select case when v_verification is null then 'not_found' else 'found' end, v_verification;
    end
  $$;
revoke all on function app.verify_documental_record_by_code(text, text, bytea, timestamptz, integer, interval) from public;
grant execute on function app.verify_documental_record_by_code(text, text, bytea, timestamptz, integer, interval) to rabaed_app;
