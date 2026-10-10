// Seam 1: no id tells when a Draft was started (RP-391; ADR 0015, visibility.md
// "Creation Date" and scenario 73). C1 starts a Draft with a Document and a Link,
// and Submits it; K1 then decodes every id it receives for the item, its Links,
// its Documents and the notification it reached K1 with, and, once C1 Submits a
// Revision of it, the Documents copied into that Revision. Each is a random
// UUIDv4: none carries a time, as a UUIDv7's first 48 bits did (the millisecond
// it was made).
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, NotificationList, WorkItemDetail, WorkItemLinks, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
// The worker delivers notifications; it connects as the app role, with no Member set.
const worker = createDb(testDatabaseUrls().app, { max: 2 });
afterAll(async () => {
  await api.close();
  await worker.destroy();
});

const DAY = 86_400_000;
/** A UUIDv4: version nibble 4, RFC 9562 variant. */
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** The time a UUIDv7 would carry: its first 48 bits, in milliseconds since 1970. */
const timeIn = (id: string) => parseInt(id.replaceAll("-", "").slice(0, 12), 16);

let c1: Company;
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Engineer: Caller;
let k1Manager: Caller;
let projectId = "";
let trade = "";
let location = "";

const documentsOf = async (by: Caller, id: string): Promise<DocumentList> => (await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json();

/** Each id is a UUIDv4 and, read as a UUIDv7, names no moment anywhere near when it was made. */
function expectRandom(ids: string[]) {
  const now = Date.now();
  for (const id of ids) {
    expect(id, id).toMatch(uuidV4);
    expect(Math.abs(timeIn(id) - now), id).toBeGreaterThan(DAY);
  }
}

async function draft(title: string): Promise<string> {
  const res = await ok(
    c1Engineer.post(`/v1/projects/${projectId}/work-items`, {
      type: "MAR",
      title,
      answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade, location },
    }),
    201,
  );
  const id = res.json().id as string;
  await attachDatasheet(c1Engineer, id);
  return id;
}

async function submit(id: string) {
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit");
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller, { code: "RID" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id;
  trade = await post("trades", { code: "EL", name: bilingual("Electrical") });
  location = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  const k1Company = await api.authorizedPerson();
  const k1 = await api.addParticipant(c1.caller, projectId, k1Company.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1}/visibility`, { trade: all, location: all }));
  c1Engineer = await projectMember(api, c1, own, ["engineer"]);
  c1Pm = await projectMember(api, c1, own, ["project_manager"]);
  k1Engineer = await projectMember(api, k1Company, k1, ["engineer"]);
  k1Manager = await projectMember(api, k1Company, k1, ["manager"]);
  // Anything earlier tests left in the outbox is not ours to judge.
  await drainOutbox(worker);
});

describe("ids K1 receives once C1 Submits (scenario 73)", () => {
  let item = "";
  let linked = "";

  beforeAll(async () => {
    linked = await draft("Switchboards");
    await submit(linked);
    item = await draft("Cable trays");
    await ok(c1Engineer.post(`/v1/work-items/${item}/links`, { workItemId: linked }), 201);
    await submit(item);
    await drainOutbox(worker);
  });

  it("are random: the Work Item's, its Links' and its Documents'", async () => {
    const list: WorkItemList = (await ok(k1Manager.get(`/v1/projects/${projectId}/work-items`), 200)).json();
    expect(list.items.map((i) => i.id).sort()).toEqual([item, linked].sort());
    const detail = (await ok(k1Manager.get(`/v1/work-items/${item}`), 200)).json();
    const links: WorkItemLinks = (await ok(k1Manager.get(`/v1/work-items/${item}/links`), 200)).json();
    const documents = await documentsOf(k1Manager, item);
    expect(links.links).toHaveLength(1);
    expect(links.links[0]!.workItemId).toBe(linked);
    expect(documents.documents).toHaveLength(1);

    const received = [detail.id, ...links.links.flatMap((l) => [l.id, l.workItemId!]), ...documents.documents.map((d) => d.id)];
    expect(received).toContain(item);
    expectRandom(received);
  });

  it("are random: the notification it reached K1 with", async () => {
    const bell: NotificationList = (await ok(k1Manager.get("/v1/notifications"), 200)).json();
    const about = bell.notifications.filter((n) => n.workItemId === item);
    expect(about.length).toBeGreaterThan(0);
    expectRandom(about.flatMap((n) => [n.id, n.workItemId]));
  });

  it("are random: the Documents copied into a Revision of it, once C1 Submits that", async () => {
    // K1 issues Code C, and C1 Submits a Revision with the Documents copied.
    const answers: WorkItemDetail["answers"] = (await ok(k1Engineer.get(`/v1/work-items/${item}`), 200)).json().answers;
    const verified = { ...answers, sample_checked: true, matches_specification: false, verification_note: "Below the specified size" };
    await ok(k1Engineer.request("PUT", `/v1/work-items/${item}/answers`, { answers: verified }));
    await ok(k1Manager.post(`/v1/work-items/${item}/pick-up`));
    await take(k1Manager, item, "revise_c", { remarks: "Resubmit with 400 mm trays" });
    const revision = (await ok(c1Engineer.post(`/v1/work-items/${item}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id as string;
    await submit(revision);

    const original = (await documentsOf(k1Manager, item)).documents.map((d) => d.id);
    const copied = (await documentsOf(k1Manager, revision)).documents.map((d) => d.id);
    expect(copied).toHaveLength(original.length);
    expect(copied).not.toEqual(expect.arrayContaining(original));
    expectRandom([revision, ...copied]);
  });
});
