// Seam 2 for E1's record (RP-1087, story 57; visibility.md E1, V7, the Documental Record row,
// scenarios RP-1087-1 and RP-1087-2), as the app role: a Member who sees item X, which links to a
// closed item Y outside their Visibility, gets Y's record through the Link
// (app.linked_documental_record_file) and nothing else of Y: Y's own record read
// (app.documental_record_file) still gives them nothing. A removed Link, a Link of an item they
// don't see, a target that isn't closed and another Company's Member all get nothing.
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { buildSeamTwoTower, c2Draft, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower<{ otherProject: true }>;
/** K1's Engineer: sees X (C1's WIR they hold), never C2's items. */
let viewer = "";
/** X, which K1 sees. */
let x = "";
/** Y: C2's item, closed with its record; K1 doesn't see it. */
let y = "";
let yKey = "";
/** Z: C2's item, not closed, though a record row stands for it (a guard, not a real case). */
let z = "";
/** W: C2's own item, which K1 doesn't see, linking to Y too. */
let w = "";
let xToY = "";
let xToZ = "";
let wToY = "";

const sha = (s: string) => createHash("sha256").update(s).digest();

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** Gives item `id` a published record, as the worker saves one (the migrator stands in for it); returns its PDF's storage key. */
async function recordFor(id: string, code: string): Promise<string> {
  const key = `projects/${tower.projectId}/work-items/${id}/documental-record/record.pdf`;
  const file = (k: string, mime: string) =>
    one("insert into stored_file (storage_key, sha256, size, mime) values ($1, $2, 10, $3) returning id", [k, sha(k), mime]);
  const pdf = await file(key, "application/pdf");
  const data = await file(key.replace("record.pdf", "record-data.xml"), "application/xml");
  await migrator.query(
    `insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
       pdf_sha256, sealed_at, verification_token_hash, verification_code)
     values ($1, $2, $3, $4, '1', 'bilingual', 'A', $5, now(), $6, $7)`,
    [tower.projectId, id, pdf, data, sha("pdf"), sha(randomUUID()), code],
  );
  return key;
}

/** A free Link written as the owner (rabaed_app can't), as app.add_work_item_link would. */
const insertLink = (from: string, to: string, by: string) =>
  one("insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id) values ($1, $2, $3, 'related', $4) returning id", [
    tower.projectId,
    from,
    to,
    by,
  ]);

const viaLink = (memberId: string, itemId: string, linkId: string) =>
  withMember(app, memberId, (trx) =>
    sql<{ storage_key: string; file_name: string }>`select * from app.linked_documental_record_file(${itemId}::uuid, ${linkId}::uuid)`.execute(trx),
  ).then((r) => r.rows);

const ownRecord = (memberId: string, itemId: string) =>
  withMember(app, memberId, (trx) => sql<{ storage_key: string }>`select storage_key from app.documental_record_file(${itemId}::uuid)`.execute(trx)).then(
    (r) => r.rows,
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RLR", otherProject: true });
  viewer = tower.k1.members.engineer;
  x = await wirAtConsultant(tower, { type: "WIR", title: "Slab pour" });
  y = await c2Draft(tower, { type: "WIR", title: "Column pour" });
  z = await c2Draft(tower, { type: "WIR", title: "Beam pour" });
  w = await c2Draft(tower, { type: "WIR", title: "Wall pour" });
  await migrator.query("update work_item set document_number = 'RLR-WIR-01-0042' where id = $1", [y]);
  await migrator.query("update work_item set closed_at = now(), outcome = 'A' where id = $1", [y]);
  yKey = await recordFor(y, "RPAK-1087");
  await recordFor(z, "RPAK-1088");
  xToY = await insertLink(x, y, tower.c1.members.engineer);
  xToZ = await insertLink(x, z, tower.c1.members.engineer);
  wToY = await insertLink(w, y, tower.c2.members.engineer);
});

afterAll(async () => {
  await migrator.end();
  await app.destroy();
});

describe("scenario RP-1087-1: app.linked_documental_record_file", () => {
  it("gives a Member who sees X the record of closed Y through X's Link, its storage key and file name only", async () => {
    expect(await viaLink(viewer, x, xToY)).toEqual([{ storage_key: yKey, file_name: "RLR-WIR-01-0042.pdf" }]);
  });

  it("gives nothing more of Y: Y's own record read is still nothing to them, while C2, who sees Y, gets it", async () => {
    expect(await ownRecord(viewer, y)).toEqual([]);
    expect(await ownRecord(tower.c2.members.engineer, y)).toEqual([{ storage_key: yKey }]);
  });
});

describe("scenario RP-1087-2: app.linked_documental_record_file", () => {
  it("gives nothing through a Link to an item that isn't closed, even with a record row standing for it", async () => {
    expect(await viaLink(viewer, x, xToZ)).toEqual([]);
  });

  it("gives nothing through a Link of an item the Member doesn't see, nor for a Link id paired with another item", async () => {
    expect(await viaLink(viewer, w, wToY)).toEqual([]);
    expect(await viaLink(viewer, x, wToY)).toEqual([]);
    expect(await viaLink(viewer, x, randomUUID())).toEqual([]);
    // Positive control: C2, who sees W, gets Y's record through W's Link.
    expect(await viaLink(tower.c2.members.engineer, w, wToY)).toEqual([{ storage_key: yKey, file_name: "RLR-WIR-01-0042.pdf" }]);
  });

  it("gives nothing to a Member who doesn't see X: C2 on the same Project, and another Company's on another Project", async () => {
    expect(await viaLink(tower.c2.members.engineer, x, xToY)).toEqual([]);
    expect(await viaLink(tower.other.ap, x, xToY)).toEqual([]);
  });

  it("gives nothing once the Link is removed", async () => {
    // Put back afterwards, so no other test depends on running before this one.
    await migrator.query("update work_item_link set removed_at = now() where id = $1", [xToY]);
    try {
      expect(await viaLink(viewer, x, xToY)).toEqual([]);
    } finally {
      await migrator.query("update work_item_link set removed_at = null where id = $1", [xToY]);
    }
  });

  it("gives nothing with no Member set", async () => {
    const { rows } = await sql`select * from app.linked_documental_record_file(${w}::uuid, ${wToY}::uuid)`.execute(app);
    expect(rows).toEqual([]);
  });
});
