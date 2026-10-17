// Seam 2 for the Documental Record (RP-620, spec RP-632; ADR 0023;
// migration 20270514000000_documental_record.sql), as the app role: the record
// table and its files' fingerprints are never read directly; a Member gets a
// record's storage key only for an item they see (app.documental_record_file),
// and only the worker, with no Member set, reads what the Record Data is
// written from and saves the record.
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let itemId = "";
let seer = "";
let other = "";
let storageKey = "";

const sha = (s: string) => createHash("sha256").update(s).digest();

/** The error code `query` fails with as Member `memberId` (or as the worker, with none), or null. */
async function failure(memberId: string | null, query: ReturnType<typeof sql>): Promise<string | null> {
  try {
    if (memberId) await withMember(app, memberId, (trx) => query.execute(trx));
    else await query.execute(app);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

const recordFile = (memberId: string, id: string) =>
  withMember(app, memberId, (trx) => sql<{ storage_key: string; file_name: string }>`select * from app.documental_record_file(${id}::uuid)`.execute(trx)).then(
    (r) => r.rows,
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  // A Submitted demo item, one Member who sees it and one active Member who doesn't.
  const { rows: items } = await migrator.query<{ id: string; project_id: string }>(
    "select id, project_id from work_item where submitted_at is not null and discarded_at is null order by id limit 1",
  );
  itemId = items[0]!.id;
  const { rows: members } = await migrator.query<{ id: string }>("select id from member where status = 'active' order by id");
  for (const { id } of members) {
    const sees = await withMember(app, id, (trx) => sql<{ sees: boolean }>`select app.sees_work_item(${itemId}::uuid) as sees`.execute(trx)).then((r) => r.rows[0]!.sees);
    if (sees && !seer) seer = id;
    if (!sees && !other) other = id;
    if (seer && other) break;
  }
  expect(seer && other).toBeTruthy();
  // Its record, as the worker saves one (the migrator stands in for it here).
  storageKey = `projects/${items[0]!.project_id}/work-items/${itemId}/documental-record/record.pdf`;
  const file = async (key: string, mime: string) =>
    (await migrator.query<{ id: string }>("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [key, sha(key), mime])).rows[0]!.id;
  const pdf = await file(storageKey, "application/pdf");
  const data = await file(storageKey.replace("record.pdf", "record-data.xml"), "application/xml");
  await migrator.query(
    `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
       pdf_sha256, sealed_at, verification_token_hash, verification_code)
     values ($1, $2, $3, $4, '1', 'bilingual', 'A', $5, now(), $6, 'ABCD-EF12')`,
    [items[0]!.project_id, itemId, pdf, data, sha("pdf"), sha(randomUUID())],
  );
});

afterAll(async () => {
  await migrator.end();
  await app.destroy();
});

describe("the documental_record table", () => {
  it("is not read by the app role at all: its keys, fingerprints and verification hash go through functions only", async () => {
    expect(await failure(seer, sql`select * from documental_record`)).toBe("42501");
    expect(await failure(seer, sql`select id from documental_record`)).toBe("42501");
    expect(await failure(null, sql`select id from documental_record`)).toBe("42501");
  });

  it("is written once: the record can't be changed or removed, even by its owner", async () => {
    await expect(migrator.query("update documental_record set outcome = 'B' where work_item_id = $1", [itemId])).rejects.toMatchObject({ code: "42501" });
    await expect(migrator.query("delete from documental_record where work_item_id = $1", [itemId])).rejects.toMatchObject({ code: "42501" });
  });
});

describe("app.documental_record_file", () => {
  it("gives a Member who sees the item its record's storage key and file name", async () => {
    expect(await recordFile(seer, itemId)).toEqual([{ storage_key: storageKey, file_name: expect.stringMatching(/\.pdf$/) }]);
  });

  it("gives nothing for an item the Member can't see, the same as for a made-up id", async () => {
    expect(await recordFile(other, itemId)).toEqual([]);
    expect(await recordFile(seer, randomUUID())).toEqual([]);
  });
});

describe("the worker's functions", () => {
  it("refuse a caller with a Member set", async () => {
    const outbox = randomUUID();
    expect(await failure(seer, sql`select app.documental_record_facts(${outbox}::uuid)`)).toBe("42501");
    expect(
      await failure(
        seer,
        sql`select app.save_documental_record(${outbox}::uuid, 'k', ${sha("a")}, 1, 'k2', ${sha("b")}, 1, '1', 'bilingual', now(), ${sha("c")}, 'ABCD-EF34')`,
      ),
    ).toBe("42501");
  });

  it("give nothing for an outbox row that isn't a record job", async () => {
    const { rows } = await sql<{ facts: unknown }>`select app.documental_record_facts(${randomUUID()}::uuid) as facts`.execute(app);
    expect(rows[0]!.facts).toBeNull();
  });
});
