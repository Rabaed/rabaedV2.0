// Seam 1 for RP-1314 (owner's decision 2026-11-20, RP-1314 comment 15985; ADR 0030; visibility.md V1;
// docs/visibility/scenarios/RP-1314.md). Before its own first Submit a Revision reads its chain's base number with
// where it stands: "<base> Rev 1 · Draft" while it never left Draft, "<base> Rev 1 · Internal Review" once it has.
// The item, its List row and Kanban card carry `baseState` beside `baseNumber`; the Handover dialog's rows, the
// Activity Feed's entries, a Package's items and the notifications carry the same as `revisionBase`. All of it comes
// through app.revision_chain and app.work_item_creation_date, which answer only for a reader who sees the Revision,
// so no other Company reads any of it.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { drainOutbox, expectHiddenFrom, LEGACY_MAR, testDatabaseUrls } from "@rabaed/db/test-support";
import type { ActivityFeed, HandoverStep, Notification, NotificationList, PackageDetail, WorkItemBoard, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, memberOnProject, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
afterAll(async () => {
  await api.close();
  await worker.destroy();
});

let c1: Company;
let own = ""; // C1's Participant.
let engineer: { id: string; caller: Caller }; // C1 engineer: raises the MARs and their Revisions.
let pm: { id: string; caller: Caller }; // C1 PM: Submits, and picks up the Revision in Internal Review.
let k1Company: Company;
let k1Participant = "";
let k1Manager: { id: string; caller: Caller }; // K1: issues the Codes.
let projectId = "";
let electrical = "";
let buildingA = "";
const bases: Record<"draft" | "review", string> = { draft: "", review: "" };
const revisions: Record<"draft" | "review", string> = { draft: "", review: "" }; // Rev 1 of each: one a Draft, one in Internal Review.

const complete = { manufacturer: "Philips", description: "LED fixtures", items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }] };

async function submit(id: string) {
  await take(engineer.caller, id, "send_for_review");
  await ok(pm.caller.post(`/v1/work-items/${id}/pick-up`));
  await take(pm.caller, id, "submit");
}

const draftLabel = () => ({ baseNumber: bases.draft, revisionNo: 1, state: "draft" });
const reviewLabel = () => ({ baseNumber: bases.review, revisionNo: 1, state: "internal_review" });
const list = async (by: Caller) => ((await ok(by.get(`/v1/projects/${projectId}/work-items`), 200)).json() as WorkItemList).items;
const cards = async (by: Caller) =>
  ((await ok(by.get(`/v1/projects/${projectId}/work-items/kanban`), 200)).json() as WorkItemBoard).columns.flatMap((c) => c.lanes.flatMap((l) => l.cards));
const feed = async (by: Caller) => ((await ok(by.get(`/v1/projects/${projectId}/activity`), 200)).json() as ActivityFeed).entries;
const notifications = async (by: Caller): Promise<Notification[]> => ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications;
const itemOf = (n: Notification) => ("workItemId" in n && n.workItemId !== null ? n : null);

/** The Steps a removal from C1's Participant asks a new holder for (409 handover_needed), the removal left undone. */
async function handovers(by: Caller, participantId: string, memberId: string): Promise<HandoverStep[]> {
  const res = await by.request("DELETE", `/v1/participants/${participantId}/members/${memberId}`, {});
  expect(res.statusCode, res.body).toBe(409);
  return (res.json() as { handovers: HandoverStep[] }).handovers;
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })).json().id;
  own = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  // C1's Authorized Person, who removes Members, on the Project too: it sees the items it hands over (RP-108).
  await api.addProjectMember(c1.caller, own, c1.company.authorizedPerson.id);
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/members/${c1.company.authorizedPerson.id}/visibility`, { trade: all, location: all }));
  k1Company = await api.authorizedPerson();
  k1Participant = await api.addParticipant(c1.caller, projectId, k1Company.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  engineer = await memberOnProject(api, c1, own, ["engineer"]);
  pm = await memberOnProject(api, c1, own, ["project_manager"]);
  // Someone to hand each Step to, so a removal asks for a Handover rather than refusing.
  await projectMember(api, c1, own, ["engineer"]);
  await projectMember(api, c1, own, ["project_manager"]);
  k1Manager = await memberOnProject(api, k1Company, k1Participant, ["manager"]);

  // Two MARs, each closed at Code C and revised: one Revision stays a Draft, the other goes to Internal Review.
  for (const [key, title] of [["draft", "Cable trays"], ["review", "Switchgear"]] as const) {
    const id = (await ok(engineer.caller.post(`/v1/projects/${projectId}/work-items`, { type: LEGACY_MAR, title, answers: { ...complete, trade: electrical, location: buildingA } }), 201)).json().id as string;
    await attachDatasheet(engineer.caller, id);
    await submit(id);
    await ok(k1Manager.caller.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Manager.caller, id, "revise_c", { remarks: "Resubmit" });
    bases[key] = (await detail(engineer.caller, id)).documentNumber!;
    revisions[key] = (await ok(engineer.caller.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;
  }
  await drainOutbox(worker);
  await take(engineer.caller, revisions.review, "send_for_review");
  await ok(pm.caller.post(`/v1/work-items/${revisions.review}/pick-up`));
  await drainOutbox(worker);
});

describe("the item, its List row and Kanban card (RP-1314-1)", () => {
  it("read where a Revision not yet Submitted stands: Draft, or Internal Review once it left Draft", async () => {
    for (const by of [engineer.caller, pm.caller]) {
      expect(await detail(by, revisions.draft)).toMatchObject({ documentNumber: null, baseNumber: bases.draft, revisionNo: 1, baseState: "draft" });
      expect(await detail(by, revisions.review)).toMatchObject({ documentNumber: null, baseNumber: bases.review, revisionNo: 1, baseState: "internal_review" });
    }
    const rows = await list(engineer.caller);
    expect(rows.find((r) => r.id === revisions.draft)).toMatchObject({ baseNumber: bases.draft, baseState: "draft" });
    expect(rows.find((r) => r.id === revisions.review)).toMatchObject({ baseNumber: bases.review, baseState: "internal_review" });
    const board = await cards(engineer.caller);
    expect(board.find((c) => c.id === revisions.draft)).toMatchObject({ baseNumber: bases.draft, baseState: "draft" });
    expect(board.find((c) => c.id === revisions.review)).toMatchObject({ baseNumber: bases.review, baseState: "internal_review" });
  });

  it("is on no item with a number of its own", async () => {
    for (const r of (await list(engineer.caller)).filter((x) => x.documentNumber !== null)) expect(r.baseState, r.title).toBeUndefined(); // not hidden-from: a field of rows C1 reads
  });
});

describe("the Activity Feed (RP-1314-2)", () => {
  it("names the Revision in Internal Review by its base number and state, for C1", async () => {
    const entries = (await feed(engineer.caller)).filter((e) => e.workItem.id === revisions.review);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.workItem).toMatchObject({ documentNumber: null, revisionBase: reviewLabel() });
    for (const e of (await feed(engineer.caller)).filter((x) => x.workItem.id === revisions.draft)) expect(e.workItem.revisionBase).toEqual(draftLabel());
  });

  it("gives K1 nothing of either Revision, and no base number on any entry (V1)", async () => {
    await expectHiddenFrom({
      read: async (by) => (await feed(by)).map((e) => ({ id: e.workItem.id })),
      target: revisions.review,
      seenBy: [engineer.caller],
      hiddenFrom: [k1Manager.caller],
      label: "the Activity Feed",
    });
    // not hidden-from: a field, on the entries K1 does read (the originals' Submit and Code)
    expect((await feed(k1Manager.caller)).some((e) => e.workItem.revisionBase !== undefined)).toBe(false);
  });
});

describe("the Handover dialog (RP-1314-2)", () => {
  it("names each Revision by its base number and state when its holder is removed", async () => {
    const byEngineer = await handovers(c1.caller, own, engineer.id);
    expect(byEngineer.find((s) => s.item?.id === revisions.draft)?.item).toMatchObject({ documentNumber: null, revisionBase: draftLabel() });
    const byPm = await handovers(c1.caller, own, pm.id);
    expect(byPm.find((s) => s.item?.id === revisions.review)?.item).toMatchObject({ documentNumber: null, revisionBase: reviewLabel() });
  });
});

describe("a Package's items (RP-1314-1)", () => {
  it("carry the List row's base number and state, which the bulk pop-up reads", async () => {
    const pkg = (await ok(pm.caller.post(`/v1/projects/${projectId}/packages`, { name: bilingual("Revisions") }), 201)).json() as { id: string };
    await ok(pm.caller.post(`/v1/packages/${pkg.id}/items`, { workItemId: revisions.review }));
    const items = ((await ok(pm.caller.get(`/v1/packages/${pkg.id}`), 200)).json() as PackageDetail).items;
    expect(items.find((i) => i.id === revisions.review)).toMatchObject({ documentNumber: null, baseNumber: bases.review, baseState: "internal_review" });
  });
});

describe("the notifications (RP-1314-2)", () => {
  it("name a new Revision in Internal Review by its base number and state (revision_created)", async () => {
    const created = (await notifications(pm.caller)).filter((n) => itemOf(n)?.workItemId === revisions.review && n.event?.type === "revision_created");
    expect(created.length).toBe(1);
    expect(created[0]).toMatchObject({ documentNumber: null, revisionBase: reviewLabel() });
  });

  it("give K1 none of it (V1)", async () => {
    await expectHiddenFrom({
      read: async (by) => (await notifications(by)).flatMap((n) => (itemOf(n) ? [{ id: itemOf(n)!.workItemId! }] : [])),
      target: revisions.review,
      seenBy: [pm.caller],
      hiddenFrom: [k1Manager.caller],
      label: "the notifications",
    });
    // not hidden-from: a field, on the notifications K1 does read (the originals')
    expect((await notifications(k1Manager.caller)).some((n) => "revisionBase" in n && n.revisionBase !== undefined)).toBe(false);
  });
});

describe("once Submitted (RP-1314-3)", () => {
  beforeAll(async () => {
    await take(pm.caller, revisions.review, "submit");
    await drainOutbox(worker);
  });

  it("reads its own number, with no base number or state beside it, everywhere", async () => {
    const d = await detail(engineer.caller, revisions.review);
    expect(d.documentNumber).toBe(`${bases.review} Rev 1`);
    expect(d.baseState).toBeUndefined(); // not hidden-from: a field of an item C1 reads, which now has its own number
    for (const e of (await feed(engineer.caller)).filter((x) => x.workItem.id === revisions.review)) expect(e.workItem.revisionBase).toBeUndefined();
    for (const n of (await notifications(pm.caller)).filter((x) => itemOf(x)?.workItemId === revisions.review)) expect(n).not.toHaveProperty("revisionBase");
  });
});
