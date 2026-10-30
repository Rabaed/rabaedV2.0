// Seam 1 for E1's record (RP-1087, story 57; visibility.md E1, V7, the Links and Documental
// Record rows; scenarios RP-1087-1 and RP-1087-2). A Member who sees item X, which links to a
// closed item Y outside their Visibility, opens Y's Documental Record through X's Link
// (`GET /v1/work-items/X/links/L/documental-record`): the API sends the PDF itself, so neither
// Y's id nor its storage key (which holds Y's id) reaches them. Y's own URL stays 404 to them; a
// removed Link, a Link of an item they don't see, a target that isn't closed and another
// Company's Member get the same plain 404 as a made-up id.
import { createHash, randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemLinks } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFileStore, fileStoreSettingsFromEnv } from "../src/documents/file-store.ts";
import { createTestApi, expectHidden, readById, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, detail, draft, ok, only, projectMember, submitted, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const PDF = new TextEncoder().encode("%PDF-1.7 the record of RP-1087");
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest();

let at: Tower;
let k1: Company;
/** C1's Engineer who sees Mechanical only: sees X, never Y or Z. */
let viewer: Caller;
let x = "";
let y = "";
let yNumber = "";
let z = "";
let xToY = "";
let xToZ = "";
/** V: another Mechanical item the viewer sees, whose Link to Y the removal test removes, so no other test depends on it. */
let v = "";
let vToY = "";

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

/** Closes item `id` and gives it a published record whose PDF is `PDF`, as the worker would (the migrator stands in for it). */
async function closeWithRecord(id: string, code: string): Promise<void> {
  await sql`update work_item set closed_at = now(), outcome = 'A' where id = ${id}::uuid`.execute(migrator);
  const key = `projects/${at.projectId}/work-items/${id}/documental-record/record.pdf`;
  await createFileStore(fileStoreSettingsFromEnv()).put(key, PDF, "application/pdf");
  const file = async (k: string, mime: string) =>
    (await sql<{ id: string }>`insert into stored_file (storage_key, sha256, size, mime) values (${k}, ${sha(k)}, 10, ${mime}) returning id`.execute(migrator))
      .rows[0]!.id;
  const pdf = await file(key, "application/pdf");
  const data = await file(key.replace("record.pdf", "record-data.xml"), "application/xml");
  await sql`insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
      pdf_sha256, sealed_at, verification_token_hash, verification_code)
    values (${at.projectId}::uuid, ${id}::uuid, ${pdf}::uuid, ${data}::uuid, '1', 'bilingual', 'A', ${sha(PDF)}, now(), ${sha(randomUUID())}, ${code})`.execute(
    migrator,
  );
}

const addLink = async (from: string, to: string): Promise<string> => (await ok(at.c1Engineer.post(`/v1/work-items/${from}/links`, { workItemId: to }), 201)).json().id;
const viaLink = (by: Caller, item: string, link: string) => by.get(`/v1/work-items/${item}/links/${link}/documental-record`);

/** A record PDF read for expectHiddenFrom: `[{ id: Y }]` when the PDF comes, `[]` for the plain 404, anything else fails. */
const pdfRead = async (res: ReturnType<Caller["get"]>, path: string): Promise<{ id: string }[]> => {
  const got = await res;
  if (got.statusCode === 200) {
    expect(new Uint8Array(got.rawPayload), path).toEqual(PDF);
    return [{ id: y }];
  }
  await expectHidden(got, path);
  return [];
};

/** One read of a record through a Link: by whom, on which item, through which Link. */
type Call = { by: Caller; item: string; link: string; name: string };
const call = (by: Caller, item: string, link: string, name: string): Call => ({ by, item, link, name });
const through = (c: Call) => pdfRead(viaLink(c.by, c.item, c.link), `${c.name}: ${c.item}/links/${c.link}`);
/** Y's record comes through every call in `seenBy` and none in `hiddenFrom`. */
const yThrough = (seenBy: Call | Call[], hiddenFrom: Call | Call[]) => expectHiddenFrom({ read: through, target: y, name: (c) => c.name, seenBy, hiddenFrom });

beforeAll(async () => {
  const c1 = await api.projectCreator();
  k1 = await onboard("Linked Record Consultants");
  at = await buildTower(api, { c1, k1 }, "LRD");
  viewer = await projectMember(api, c1, at.c1ParticipantId, ["engineer"], { trade: only(at.mechanical) });
  y = await submitted(at, at.c1Engineer, at.c1Pm, "Approved busbars");
  z = await submitted(at, at.c1Engineer, at.c1Pm, "Busbar trunking");
  x = await draft(at, at.c1Engineer, "Cable trays", { trade: at.mechanical });
  xToY = await addLink(x, y);
  xToZ = await addLink(x, z);
  v = await draft(at, at.c1Engineer, "Ducts", { trade: at.mechanical });
  vToY = await addLink(v, y);
  yNumber = (await detail(at.c1Engineer, y)).documentNumber!;
  await closeWithRecord(y, "RPKB-1087");
});

describe("scenario RP-1087-1: a linked item's record, through the Link", () => {
  it("is X's Link to Y with no id for the viewer, and Y's own URL and record are 404 to them", async () => {
    const links: WorkItemLinks = (await ok(viewer.get(`/v1/work-items/${x}/links`), 200)).json();
    expect(links.links.find((l) => l.id === xToY)).toMatchObject({ workItemId: null });
    // C1's Engineer, who sees Y, opens it and gets its record from Y itself.
    const name = (by: Caller) => (by === viewer ? "the Mechanical viewer" : "C1's Engineer");
    await expectHiddenFrom({ read: readById(`/v1/work-items/${y}`), target: y, seenBy: at.c1Engineer, hiddenFrom: viewer, name });
    // Y's own record read answers its signed URL, which holds Y's id.
    const ownRecord = readById<{ url: string }>(`/v1/work-items/${y}/documental-record`);
    const recordOfY = async (by: Caller) => (await ownRecord(by)).map((r) => ({ id: r.url.includes(`/work-items/${y}/`) ? y : r.url }));
    await expectHiddenFrom({ read: recordOfY, target: y, seenBy: at.c1Engineer, hiddenFrom: viewer, name });
  });

  it("gives the viewer Y's PDF itself, named by its Document Number, and nothing that names Y", async () => {
    const res = await viaLink(viewer, x, xToY);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain(`filename="${yNumber}.pdf"`);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(new Uint8Array(res.rawPayload)).toEqual(PDF);
    expect(JSON.stringify(res.headers)).not.toContain(y); // not hidden-from: no header names Y's id, in the response the viewer does get
  });

  it("answers HEAD the same way with no body, so the Link's page knows the record is there", async () => {
    const res = await viewer.request("HEAD", `/v1/work-items/${x}/links/${xToY}/documental-record`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.length).toBe(0);
    const hidden = await viewer.request("HEAD", `/v1/work-items/${x}/links/${xToZ}/documental-record`);
    expect({ status: hidden.statusCode, body: hidden.body }).toEqual({ status: 404, body: "" });
  });
});

describe("scenario RP-1087-2: no record through the Link otherwise", () => {
  it("is 404 for a Link to an item that isn't closed, a made-up Link and another item's Link", async () => {
    // Any record at all is a failure (Z has none), so a 200 counts whatever PDF it sends.
    await yThrough(call(viewer, x, xToY, "X's Link to Y"), [
      call(viewer, x, xToZ, "X's Link to Z"),
      call(viewer, x, randomUUID(), "a made-up Link"),
      call(viewer, z, xToY, "X's Link on Z"),
      call(viewer, x, "not-a-uuid", "a Link id that isn't a uuid"),
    ]);
  });

  it("is 404 for a Member who doesn't see X: another Company's Manager", async () => {
    await yThrough(call(viewer, x, xToY, "the viewer"), [call(k1.caller, x, xToY, "K1's Authorized Person"), call(at.k1Manager, x, xToY, "K1's Manager")]);
  });

  it("is 404 once the Link is removed", async () => {
    await yThrough(call(viewer, v, vToY, "V's Link before the removal"), call(viewer, x, xToZ, "X's Link to Z"));
    await ok(at.c1Engineer.delete(`/v1/work-items/${v}/links/${vToY}`));
    // X's own Link to Y still brings Y's record; the removed one brings it to nobody.
    await yThrough(call(viewer, x, xToY, "X's Link to Y"), [
      call(viewer, v, vToY, "the viewer, through the removed Link"),
      call(at.c1Engineer, v, vToY, "C1's Engineer, through the removed Link"),
    ]);
  });
});
