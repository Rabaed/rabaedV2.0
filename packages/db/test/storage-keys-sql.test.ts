// Seam 2: the keys the database builds for what the api stores stay inside the IAM key patterns the
// infrastructure grants the api (packages/infra app stack, RP-1104). The api's task role may write
// only Documents and register imports under projects/, so a key built anywhere else would be refused
// in AWS while working locally, where the file store checks no IAM.
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.ts";
import { DOCUMENT_OBJECTS, REGISTER_IMPORT_OBJECTS } from "../src/storage-keys.ts";
import { iamPatternMatches } from "../test-support/iam-pattern.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(() => migrator.destroy());

const [project, item, document, upload, file] = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];

describe("the Project files keys the database builds (RP-1104)", () => {
  it("a Document's key is inside DOCUMENT_OBJECTS", async () => {
    const { rows } = await sql<{ key: string }>`select app.document_storage_key(${project}::uuid, ${item}::uuid, ${document}::uuid) as key`.execute(migrator);
    expect(rows[0]!.key).toBe(`projects/${project}/work-items/${item}/documents/${document}`);
    expect(iamPatternMatches(DOCUMENT_OBJECTS, rows[0]!.key)).toBe(true);
  });

  it("a register import file's key is inside REGISTER_IMPORT_OBJECTS", async () => {
    const { rows } = await sql<{ key: string }>`select app.register_import_file_key(${project}::uuid, ${upload}::uuid, ${file}::uuid) as key`.execute(migrator);
    expect(rows[0]!.key).toBe(`projects/${project}/register-imports/${upload}/${file}`);
    expect(iamPatternMatches(REGISTER_IMPORT_OBJECTS, rows[0]!.key)).toBe(true);
  });

  it("are built by those two functions only: a new one needs its own grant (packages/infra/test/iam-grants.test.ts)", async () => {
    // Every function in the live catalog that spells out a Project files key. request_snag_report only checks that
    // a photo's key (a Document's) is under the Project.
    const { rows } = await sql<{ name: string }>`
      select distinct p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'public') and p.prosrc like ${"%'projects/'%"}
      order by 1`.execute(migrator);
    expect(rows.map((r) => r.name)).toEqual(["document_storage_key", "register_import_file_key", "request_snag_report"]);
  });
});
