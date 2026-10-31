// Seam 2 for a record sealed with a test key (RP-1042, ADR 0026; visibility.md, the Verification page
// row; scenario RP-1042-1; migration 20271125000000_record_test_key.sql), as the app role with no
// Member set: the worker writes the face through app.save_documental_record_face, and the public
// route reads it through app.verify_documental_record_by_token. A test key's record answers
// `testKey: true`; any other answers exactly what it did before, with no `testKey` at all.
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, testDatabaseUrls, wirAtConsultant } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;

const sha = (s: string) => createHash("sha256").update(s).digest();
const FIELDS = ["documentNumber", "fingerprints", "outcome", "project", "sealedAt", "signers", "status", "subject"];
const face = (testKey?: boolean) => ({
  language: "en",
  documentNumber: "placeholder",
  subject: "Printed subject",
  project: { en: "Printed Project" },
  outcome: { code: "A", name: { en: "Approved" } },
  signers: [{ name: { en: "Printed Signer" }, positions: [{ en: "Engineer" }], company: { en: "Printed Company" } }],
  ...(testKey === undefined ? {} : { testKey }),
});

/** A published record of a new WIR, with its record job's outbox row: its token and that row's id. */
let made: (title: string) => Promise<{ token: string; outboxId: string; documentNumber: string }>;

const byToken = (token: string) =>
  sql<{ v: Record<string, unknown> | null }>`select app.verify_documental_record_by_token(${sha(token)}) as v`.execute(app).then((r) => r.rows[0]!.v);
/** The worker's write of the face, as the app role with no Member set. */
const save = (outboxId: string, body: Record<string, unknown>) =>
  sql<{ saved: boolean }>`select app.save_documental_record_face(${outboxId}::uuid, ${JSON.stringify(body)}::jsonb) as saved`.execute(app).then((r) => r.rows[0]!.saved);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const tower = await buildSeamTwoTower(app, migrator, { projectCode: "RTK" });
  made = async (title) => {
    const id = await wirAtConsultant(tower, { type: "WIR", title });
    const item = (await migrator.query<{ project_id: string; document_number: string }>("select project_id, document_number from work_item where id = $1", [id])).rows[0]!;
    const key = `projects/${item.project_id}/work-items/${id}/documental-record/rp1042`;
    const file = async (name: string, mime: string) =>
      (await migrator.query<{ id: string }>("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [`${key}/${name}`, sha(`${title} ${name}`), mime])).rows[0]!.id;
    const token = randomUUID();
    await migrator.query(
      `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
         pdf_sha256, sealed_at, verification_token_hash, verification_code, status)
       values ($1, $2, $3, $4, '2', 'en', 'A', $5, now(), $6, $7, 'published')`,
      [item.project_id, id, await file("record.pdf", "application/pdf"), await file("record-data.xml", "application/xml"), sha(`pdf ${title}`), sha(token), `RP10-42${title.length}X`],
    );
    // The record job's row, as the close writes it (the migrator stands in for it), already done, so no drain takes it.
    const outboxId = (
      await migrator.query<{ id: string }>(
        "insert into outbox (kind, project_id, payload, processed_at) values ('documental_record', $1, jsonb_build_object('closed_work_item_id', $2::text), now()) returning id",
        [item.project_id, id],
      )
    ).rows[0]!.id;
    return { token, outboxId, documentNumber: item.document_number };
  };
});

afterAll(async () => {
  await migrator.end();
  await app.destroy();
});

describe("scenario RP-1042-1: a record sealed with a test key, at the verification functions", () => {
  it("is answered as a test record: the page's fields and testKey true, nothing more", async () => {
    const record = await made("Slab pour test key");
    expect(await save(record.outboxId, { ...face(true), documentNumber: record.documentNumber })).toBe(true);
    const v = await byToken(record.token);
    expect(Object.keys(v!).sort()).toEqual([...FIELDS, "testKey"].sort());
    expect(v).toMatchObject({ status: "genuine", testKey: true, subject: "Printed subject" });
  });

  it("a record sealed with Rabaed's own key, or a face from before (no testKey), answers exactly as before", async () => {
    for (const [title, body] of [["Slab pour own key", face(false)], ["Slab pour older face", face()]] as const) {
      const record = await made(title);
      expect(await save(record.outboxId, { ...body, documentNumber: record.documentNumber })).toBe(true);
      const v = await byToken(record.token);
      expect(Object.keys(v!).sort(), title).toEqual([...FIELDS].sort());
    }
  });

  it("a Re-produce's face replaces the flag with its own", async () => {
    const record = await made("Slab pour written twice");
    await save(record.outboxId, { ...face(true), documentNumber: record.documentNumber });
    await save(record.outboxId, { ...face(false), documentNumber: record.documentNumber });
    expect("testKey" in (await byToken(record.token))!).toBe(false);
  });
});
