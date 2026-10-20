// Seam 2 for the Documental Record (RP-620, spec RP-632; ADR 0023;
// migration 20270617000000_documental_record.sql), as the app role: the record
// table and its files' fingerprints are never read directly; a Member gets a
// record's storage key only for an item they see (app.documental_record_file),
// and only the worker, with no Member set, reads what the Record Data is
// written from and saves the record.
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { buildSeamTwoTower, c2Draft, testDatabaseUrls, wirAtConsultant } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let itemId = "";
let seer = "";
let other = "";
let storageKey = "";
/** An item `other` sees, with its own record: the positive control beside each refusal to `other`. */
let othersItemId = "";
let othersStorageKey = "";

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Gives item `id` of Project `projectId` a record, as the worker saves one (the migrator stands in for it here); returns its PDF's storage key. */
async function recordFor(projectId: string, id: string, code: string): Promise<string> {
  const key = `projects/${projectId}/work-items/${id}/documental-record/record.pdf`;
  const file = async (k: string, mime: string) =>
    (await migrator.query<{ id: string }>("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [k, sha(k), mime])).rows[0]!.id;
  const pdf = await file(key, "application/pdf");
  const data = await file(key.replace("record.pdf", "record-data.xml"), "application/xml");
  await migrator.query(
    `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
       pdf_sha256, sealed_at, verification_token_hash, verification_code)
     values ($1, $2, $3, $4, '1', 'bilingual', 'A', $5, now(), $6, $7)`,
    [projectId, id, pdf, data, sha("pdf"), sha(randomUUID()), code],
  );
  return key;
}

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
  // This file's own Tower (RP-995): C1's Submitted WIR, which K1's Engineer holds and sees, and C2's Engineer,
  // another Contractor of the same Trade, doesn't (V3). C2's own Draft is the positive control beside that refusal.
  const tower = await buildSeamTwoTower(app, migrator, { projectCode: "RDR" });
  itemId = await wirAtConsultant(tower, { type: "WIR", title: "Slab pour" });
  seer = tower.k1.members.engineer;
  other = tower.c2.members.engineer;
  othersItemId = await c2Draft(tower, { type: "WIR", title: "Column pour" });
  storageKey = await recordFor(tower.projectId, itemId, "ABCD-EF12");
  othersStorageKey = await recordFor(tower.projectId, othersItemId, "ABCD-EF13");
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

  it("nor is what each signer was when they acted (work_item_event_signer): only the record job reads it", async () => {
    expect(await failure(seer, sql`select * from work_item_event_signer`)).toBe("42501");
    expect(await failure(null, sql`select event_id from work_item_event_signer`)).toBe("42501");
  });

  it("is written once: the record can't be changed or removed, even by its owner", async () => {
    await expect(migrator.query("update documental_record set outcome = 'B' where work_item_id = $1", [itemId])).rejects.toMatchObject({ code: "42501" });
    await expect(migrator.query("delete from documental_record where work_item_id = $1", [itemId])).rejects.toMatchObject({ code: "42501" });
    // A published record never goes back.
    await expect(migrator.query("update documental_record set status = 'preparing' where work_item_id = $1", [itemId])).rejects.toMatchObject({ code: "42501" });
  });

  it("lets only its status move forward from preparing, for RP-155's checks: to published, or to failed_checks, which only a Re-produce then publishes", async () => {
    const status = (to: string, extra = "") => migrator.query(`update documental_record set status = $1${extra} where work_item_id = $2`, [to, itemId]);
    await migrator.query("begin");
    try {
      // The owner, bypassing the trigger for this setup only, puts it back to preparing.
      await migrator.query("alter table documental_record disable trigger documental_record_written_once");
      await status("preparing");
      await migrator.query("alter table documental_record enable trigger documental_record_written_once");
      const refused = async (to: string, extra = "") => {
        await migrator.query("savepoint refused");
        await expect(status(to, extra)).rejects.toMatchObject({ code: "42501" });
        await migrator.query("rollback to savepoint refused");
      };
      await refused("failed_checks", ", outcome = 'B'");
      // A failed record stays failed for the checks' own move: only a Re-produce publishes it (documental-record-checks-rls.test.ts).
      await status("failed_checks");
      await refused("published");
      await refused("preparing");
      await migrator.query("rollback");
      await migrator.query("begin");
      await migrator.query("alter table documental_record disable trigger documental_record_written_once");
      await status("preparing");
      await migrator.query("alter table documental_record enable trigger documental_record_written_once");
      await status("published");
      await refused("failed_checks");
      await refused("preparing");
    } finally {
      await migrator.query("rollback");
    }
  });
});

describe("app.documental_record_file", () => {
  it("gives a Member who sees the item its record's storage key and file name", async () => {
    expect(await recordFile(seer, itemId)).toEqual([{ storage_key: storageKey, file_name: expect.stringMatching(/\.pdf$/) }]);
  });

  it("gives nothing for an item the Member can't see, the same as for a made-up id", async () => {
    expect(await recordFile(other, itemId)).toEqual([]);
    expect(await recordFile(seer, randomUUID())).toEqual([]);
    // Positive controls: the refused Member gets the record of an item they see, and the seer gets nothing of C2's Draft.
    expect(await recordFile(other, othersItemId)).toEqual([{ storage_key: othersStorageKey, file_name: expect.stringMatching(/\.pdf$/) }]);
    expect(await recordFile(seer, othersItemId)).toEqual([]);
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
