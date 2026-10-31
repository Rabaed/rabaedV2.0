-- RP-1042 (ADR 0026; visibility.md, the Verification page row; scenario RP-1042-1): the public
-- verification page says when a record was sealed with a test key.
--
-- On UAT the Records container seals with a test authority held as host secrets, never Rabaed's
-- own key (apps/worker/src/record/uat-signer.ts), and development seals with an in-memory test key
-- (signer.ts). Such a record is not a valid one, and its pages print "UAT" on UAT; the verification
-- page now says so too, so nobody takes it as genuine:
--
-- * documental_record_face.test_key: whether the record's seal was made with a test key, as the
--   worker knew it when it sealed (its signer's `test`). False for every face written before, which
--   are dev and UAT data only, until a Re-produce writes the face again.
-- * app.save_documental_record_face: writes it from the face's `testKey` (false when absent).
-- * app.documental_record_verification: answers `testKey: true` for such a record; for any other,
--   no `testKey` at all, so a real record's answer is exactly what it was.
--
-- Both are rebuilt from main's newest bodies (20271105000000_record_clean_up.sql and
-- 20270910000000_documental_record_verification.sql). Nothing new is granted.

alter table documental_record_face add column test_key boolean not null default false;

create or replace function app.save_documental_record_face(p_outbox_id uuid, p_face jsonb) returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_record_id uuid;
    begin
      perform app.require_worker();
      select r.id into v_record_id
      from outbox o
      join documental_record r on r.work_item_id = app.record_job_item(o.kind, o.payload)
      where o.id = p_outbox_id and o.kind = any (app.record_job_kinds());
      if v_record_id is null then
        return false;
      end if;
      insert into documental_record_face (documental_record_id, language, document_number, subject, project, outcome, signers, test_key)
      values (
        v_record_id, p_face ->> 'language', p_face ->> 'documentNumber', p_face ->> 'subject',
        p_face -> 'project', p_face -> 'outcome', p_face -> 'signers', coalesce((p_face ->> 'testKey')::boolean, false)
      )
      on conflict (documental_record_id) do update set
        language = excluded.language, document_number = excluded.document_number, subject = excluded.subject,
        project = excluded.project, outcome = excluded.outcome, signers = excluded.signers, test_key = excluded.test_key,
        written_at = now();
      return true;
    end
  $$;

create or replace function app.documental_record_verification(p_record_id uuid) returns jsonb
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
        end || case
          -- A test key's seal (RP-1042): said only then, so a real record's answer is unchanged.
          when f.test_key then jsonb_build_object('testKey', true)
          else '{}'::jsonb
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
