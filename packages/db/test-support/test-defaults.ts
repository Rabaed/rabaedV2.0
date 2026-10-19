import pg from "pg";
import type { DatabaseUrls } from "../src/config.ts";

/**
 * What every seam test's Members and Companies have by default, as a real one must before
 * acting: installed into the test database only, once it is migrated (resetTestDatabase).
 *
 * - **A Signature** (RP-85: no Signature, no Transition). Every Member inserted, by any role
 *   and any route (the api's invitations, Rabaed Admin's onboarding, a seam-2 test's raw
 *   `insert into member`), gets an active `member_signature` row and its `stored_file`, so a
 *   test that takes a Transition needs nothing more. No image is stored. A test of the gate
 *   opts out: `withoutSignature(run, memberId)` (signature.ts), or the seam-1 harness's
 *   `api.withoutSignature(memberId)`.
 * - **A Stamp** (RP-617: no Stamp, no Transition). Every Company inserted, by any role and any
 *   route (Rabaed Admin's onboarding, a seam-2 test's raw `insert into company`), gets a
 *   `stored_file` its `stamp_file_id` points at, unless the insert names one. No logo (it is
 *   optional), and no image is stored. A test of the gate opts out: `withoutStamp(run, companyId)`
 *   (stamp.ts), or the seam-1 harness's `api.withoutStamp(companyId)`.
 *
 * In a schema of its own, `test_defaults`, which no migration and no role but the owner
 * uses; never in a real database.
 */
const sql = `
  create schema test_defaults;
  revoke all on schema test_defaults from public;

  create function test_defaults.member_signature() returns trigger
    language plpgsql security definer
    set search_path = pg_catalog, public
    as $$
      declare
        v_file_id uuid;
      begin
        insert into stored_file (storage_key, sha256, size, mime, uploaded_by_member_id)
        values ('members/' || new.id || '/signatures/test-default.png', sha256(convert_to(new.id::text, 'UTF8')), 68, 'image/png', new.id)
        returning id into v_file_id;
        insert into member_signature (member_id, file_id, method, active_from)
        values (new.id, v_file_id, 'drawn', now());
        return null;
      end
    $$;
  revoke all on function test_defaults.member_signature() from public;
  create trigger test_default_member_signature after insert on member
    for each row execute function test_defaults.member_signature();

  create function test_defaults.company_stamp() returns trigger
    language plpgsql security definer
    set search_path = pg_catalog, public
    as $$
      begin
        if new.stamp_file_id is null then
          insert into stored_file (storage_key, sha256, size, mime)
          values ('companies/' || new.id || '/stamp/test-default.png', sha256(convert_to('stamp/' || new.id, 'UTF8')), 68, 'image/png')
          returning id into new.stamp_file_id;
        end if;
        return new;
      end
    $$;
  revoke all on function test_defaults.company_stamp() from public;
  create trigger test_default_company_stamp before insert on company
    for each row execute function test_defaults.company_stamp();
`;

/** Installs the test defaults into the (just migrated) test database, as its owner. */
export async function installTestDefaults(urls: DatabaseUrls): Promise<void> {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
