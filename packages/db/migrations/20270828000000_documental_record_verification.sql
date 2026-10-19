-- RP-157 (spec RP-632; ADR 0023; workflow-engine.md §7; data-model.md §6; visibility.md, the
-- Verification page row, scenario RP-23-4): the public verification of a Documental Record.
--
-- Anyone holding a record checks it without signing in, through the customer api's public route,
-- which connects as rabaed_app with no Member set. Nothing new is granted on any table: the two
-- functions below are the only way in, and each gives exactly what the record's first page already
-- prints, for a published record only.
--
-- * app.verify_documental_record_by_token(token hash): the QR's long link. The api hashes the
--   token (SHA-256, as the record job stored it in documental_record.verification_token_hash).
-- * app.verify_documental_record_by_code(code, Document Number, visitor, now, limit, window): the
--   short Verification Code typed with the item's Document Number. Every call is an attempt of the
--   visitor's (the SHA-256 of their address, from the api), kept in verification_attempt for the
--   window; past the limit it answers 'too_many_attempts' whatever the pair. A code alone, a wrong
--   pair, and a record that is still 'preparing' or 'failed_checks' are all 'not_found', the answer
--   a record that doesn't exist gets.
-- * app.documental_record_verification(record): what both answer (not granted): genuine, or
--   replaced by a corrected copy on the date of the latest Re-produce that replaced a published PDF;
--   the Document Number, Subject, Project, outcome and sealed date; each signer on the path to the
--   outcome with their name, Positions and Company as the event's signer row kept them
--   (work_item_event_signer; an event written before it is read as the Member is now, as
--   app.documental_record_facts does); and the fingerprints: documental_record.pdf_sha256 (the
--   current PDF) and documental_record_reproduction.replaced_sha256 of each replaced published PDF,
--   never stored_file.sha256, which keeps the first PDF's. Never a Document, a Form answer or
--   anything of the live item.
-- * app.record_path_signers(item): the signers of the record's path, the same path the worker
--   prints (recordPath, apps/worker/src/record/record-data.ts): in order, a Transition from a Step
--   the path already left cuts the path back to it, and a Return or a Send Back is never on it.
--
-- app.take_transition and app.transition_effects are not touched.

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

-- The signers of the item's record, in the order of its path to the outcome (see the header).
create function app.record_path_signers(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_event record;
      v_from uuid[] := '{}';
      v_kind text[] := '{}';
      v_signer jsonb[] := '{}';
      v_back integer;
      v_signers jsonb := '[]'::jsonb;
    begin
      for v_event in
        select x.from_step_id, x.kind, x.signer
        from (
          -- The Owner's review writes one copy of a move for each side of it: one is enough.
          select distinct on (e.transition_id, e.created_at, e.actor_member_id) e.seq, e.from_step_id, tr.kind,
            jsonb_build_object(
              'name', coalesce(s.member_name, m.full_name),
              'positions', coalesce(s.positions, (
                select jsonb_agg(po.name order by po.sort)
                from project_member pm
                join project_member_position pmp on pmp.project_member_id = pm.id
                join position po on po.id = pmp.position_id
                where pm.participant_id = e.actor_participant_id and pm.member_id = e.actor_member_id
              ), '[]'::jsonb),
              'company', coalesce(s.company_name, c.legal_name)
            ) as signer
          from work_item_event e
          join workflow_transition tr on tr.id = e.transition_id
          join member m on m.id = e.actor_member_id
          join participant p on p.id = e.actor_participant_id
          join company c on c.id = p.company_id
          left join work_item_event_signer s on s.event_id = e.id
          where e.work_item_id = p_work_item_id and e.type in ('transition', 'issue_code')
          order by e.transition_id, e.created_at, e.actor_member_id, e.seq
        ) x
        order by x.seq
      loop
        v_back := array_position(v_from, v_event.from_step_id);
        if v_back is not null then
          v_from := v_from[1:v_back - 1];
          v_kind := v_kind[1:v_back - 1];
          v_signer := v_signer[1:v_back - 1];
        end if;
        v_from := v_from || v_event.from_step_id;
        v_kind := v_kind || v_event.kind;
        v_signer := v_signer || v_event.signer;
      end loop;
      for i in 1 .. coalesce(array_length(v_from, 1), 0) loop
        if v_kind[i] not in ('return', 'send_back') then
          v_signers := v_signers || jsonb_build_array(v_signer[i]);
        end if;
      end loop;
      return v_signers;
    end
  $$;
revoke all on function app.record_path_signers(uuid) from public;

-- What the verification page shows of a published record (see the header); null for any other.
create function app.documental_record_verification(p_record_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_result jsonb;
    begin
      select jsonb_build_object(
          'status', case when rp.replaced = '[]'::jsonb then 'genuine' else 'replaced' end,
          'replacedAt', rp.replaced -> -1 ->> 'replacedAt',
          'documentNumber', w.document_number,
          'subject', w.title,
          'project', pr.name,
          'outcome', jsonb_build_object(
            'code', r.outcome,
            'name', case
              when r.outcome = 'cancelled' then jsonb_build_object('ar', 'ملغى', 'en', 'Cancelled')
              else coalesce((
                select o.name from outcome o
                where o.project_id = w.project_id and o.work_item_type_id = w.work_item_type_id and o.closing and o.code = r.outcome
              ), jsonb_build_object('ar', r.outcome, 'en', r.outcome))
            end
          ),
          'sealedAt', app.iso_utc(r.sealed_at),
          'signers', app.record_path_signers(w.id),
          'fingerprints', jsonb_build_object('current', encode(r.pdf_sha256, 'hex'), 'replaced', rp.replaced)
        )
      into v_result
      from documental_record r
      join work_item w on w.id = r.work_item_id
      join project pr on pr.id = r.project_id
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

-- A typed Verification Code with its Document Number, counted against the visitor (see the header).
-- Outcome: 'found' with the record, 'not_found', or 'too_many_attempts' once the visitor has made
-- p_limit attempts within p_window (this one not counted then).
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
        join work_item w on w.id = r.work_item_id
        where r.verification_code = p_code
          and w.document_number is not null
          and upper(w.document_number) = upper(btrim(coalesce(p_document_number, '')))
      ));
      return query select case when v_verification is null then 'not_found' else 'found' end, v_verification;
    end
  $$;
revoke all on function app.verify_documental_record_by_code(text, text, bytea, timestamptz, integer, interval) from public;
grant execute on function app.verify_documental_record_by_code(text, text, bytea, timestamptz, integer, interval) to rabaed_app;
