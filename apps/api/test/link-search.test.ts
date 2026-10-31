// Seam 1: Link search (RP-290, spec RP-289; visibility.md "Link search" row and
// scenario 79). A Member looking for an item to link types part of a Document
// Number or Subject, and gets the matching items of that Project that they can
// see and that have been Submitted: never a Draft, never an item in internal
// review, never another Project's item, never another Participant's they can't
// see, and nothing that hints hidden matches exist.
//
// The Tower setup: C1 (Contractor, created the Project), C2 (a second
// Contractor) and K1 (the Consultant, covering the whole Project).
import { randomUUID } from "node:crypto";
import type { LinkSearchResults } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectHiddenFrom } from "@rabaed/db/test-support";
import { createTestApi, expectHidden, readById, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, draft, inInternalReview, ok, only, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let c1: Company;
let k1: Company;
let c2: Company;
let tower: Tower;
let elsewhere: Tower; // A second Project of C1's and K1's.
let c2Engineer: Caller;
let c2Pm: Caller;
let k1Mechanical: Caller; // A K1 manager covering Mechanical only.
let c1Outsider: Caller; // A C1 Member who isn't on the Project.

const searchUrl = (projectId: string, query: Record<string, string>) =>
  `/v1/projects/${projectId}/work-items/link-search?${new URLSearchParams(query).toString()}`;

async function search(by: Caller, q: string, extra: Record<string, string> = {}, projectId = tower.projectId): Promise<LinkSearchResults> {
  const res = await by.get(searchUrl(projectId, { q, ...extra }));
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const ids = (r: LinkSearchResults) => r.links.map((l) => l.id);
/** A Project's Link search as a read for expectHiddenFrom: the Project, once its search answers 200. */
const searchIn = (projectId: string) => ({
  read: readById<LinkSearchResults>(searchUrl(projectId, { q: "cable" })),
  target: projectId,
  idOf: () => projectId,
});
/** A caller as a failure names them. */
const named = (by: Caller) =>
  by === tower.c1Engineer ? "C1 engineer" : by === elsewhere.c1Engineer ? "C1 engineer of the other Project" : by === c1Outsider ? "C1 outsider" : by === c2Engineer ? "C2 engineer" : "someone";

const item = { c1Draft: "", c1Internal: "", c1Submitted: "", c1Approved: "", c1Mechanical: "", c2Submitted: "", elsewhere: "" };
let c1SubmittedNumber = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  const onboard = async (legalName: string): Promise<Company> => { // not hidden-from: names a Company to onboard
    const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) }); // not hidden-from: names a Company to onboard
    return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  };
  k1 = await onboard("Design Consultants LLC");
  c2 = await onboard("Second Contractor Co");
  tower = await buildTower(api, { c1, k1 }, "TWR");
  elsewhere = await buildTower(api, { c1, k1 }, "MAL");

  const c2ParticipantId = await api.addParticipant(c1.caller, tower.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  c2Pm = await projectMember(api, c2, c2ParticipantId, ["project_manager"]);
  const k1ParticipantId = (await tower.k1Manager.get(`/v1/projects/${tower.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  k1Mechanical = await projectMember(api, k1, k1ParticipantId, ["manager"], { trade: only(tower.mechanical) });
  c1Outsider = (await api.member(c1.caller)).caller;

  const { c1Engineer, c1Pm, k1Manager } = tower;
  item.c1Draft = await draft(tower, c1Engineer, "Cable trays, draft");
  item.c1Internal = await inInternalReview(tower, c1Engineer, "Cable trays, in internal review");
  item.c1Submitted = await submitted(tower, c1Engineer, c1Pm, "Cable trays, submitted");
  item.c1Approved = await submitted(tower, c1Engineer, c1Pm, "Cable trays, approved");
  await ok(k1Manager.post(`/v1/work-items/${item.c1Approved}/pick-up`));
  await take(k1Manager, item.c1Approved, "approve_a");
  item.c1Mechanical = await submitted(tower, c1Engineer, c1Pm, "Cable trays, mechanical", tower.mechanical);
  item.c2Submitted = await submitted(tower, c2Engineer, c2Pm, "Cable trays, second contractor");
  item.elsewhere = await submitted(elsewhere, elsewhere.c1Engineer, elsewhere.c1Pm, "Cable trays, another Project");
  c1SubmittedNumber = (await c1Engineer.get(`/v1/work-items/${item.c1Submitted}`)).json().documentNumber;
});

describe("Link search (scenario 79)", () => {
  it("offers C1 only its Submitted items of this Project: no Draft, no internal review, nothing of C2's or another Project", async () => {
    const r = await search(tower.c1Engineer, "cable trays");
    expect(ids(r).toSorted()).toEqual([item.c1Submitted, item.c1Approved, item.c1Mechanical].toSorted());
    expect(r.nextPage).toBeNull();
  });

  it("returns each item in the Link shape: id, Document Number and Subject, and nothing else", async () => {
    const r = await search(tower.c1Engineer, "cable trays, submitted");
    expect(r.links).toEqual([{ id: item.c1Submitted, documentNumber: c1SubmittedNumber, subject: "Cable trays, submitted" }]);
  });

  it("matches part of a Document Number or Subject, whatever the case", async () => {
    expect(ids(await search(tower.c1Engineer, c1SubmittedNumber.slice(-6).toLowerCase()))).toEqual([item.c1Submitted]);
    expect(ids(await search(tower.c1Engineer, "APPROVED"))).toEqual([item.c1Approved]);
    expect(ids(await search(tower.c1Engineer, "nothing like this"))).toEqual([]); // not hidden-from: nothing matches
  });

  it("treats % and _ as plain text, not wildcards", async () => {
    expect(ids(await search(tower.c1Engineer, "%"))).toEqual([]); // not hidden-from: nothing matches
    expect(ids(await search(tower.c1Engineer, "_"))).toEqual([]); // not hidden-from: nothing matches
  });

  it("offers K1 every Submitted item it sees, C2's too, but never C1's Draft or internal review", async () => {
    const r = await search(tower.k1Manager, "cable trays");
    expect(ids(r).toSorted()).toEqual([item.c1Submitted, item.c1Approved, item.c1Mechanical, item.c2Submitted].toSorted());
  });

  it("puts the latest Submitted first: by the Submission Date, which every caller reads, never when a Draft was started (RP-334)", async () => {
    const { c1Engineer, c1Pm, k1Manager } = tower;
    const startedFirst = await inInternalReview(tower, c1Engineer, "Ordering, started first");
    const submittedFirst = await submitted(tower, c1Engineer, c1Pm, "Ordering, submitted first");
    await ok(c1Pm.post(`/v1/work-items/${startedFirst}/pick-up`));
    await take(c1Pm, startedFirst, "submit");
    for (const by of [c1Engineer, k1Manager]) expect(ids(await search(by, "ordering"))).toEqual([startedFirst, submittedFirst]);
  });

  it("offers C2 only its own Submitted item", async () => {
    expect(ids(await search(c2Engineer, "cable trays"))).toEqual([item.c2Submitted]);
  });

  it("follows the Member's own Visibility: a K1 manager covering Mechanical only gets only the Mechanical item", async () => {
    expect(ids(await search(k1Mechanical, "cable trays"))).toEqual([item.c1Mechanical]);
  });

  it("searches the other Project on its own", async () => {
    const r = await search(elsewhere.c1Engineer, "cable trays", {}, elsewhere.projectId);
    expect(ids(r)).toEqual([item.elsewhere]);
  });

  it("pages with a fixed maximum, and never counts hidden matches", async () => {
    // K1's four, in the search's own order, then cut into pages.
    const k1Sees = ids(await search(tower.k1Manager, "cable trays"));
    expect(k1Sees.toSorted()).toEqual([item.c1Submitted, item.c1Approved, item.c1Mechanical, item.c2Submitted].toSorted());
    const first = await search(tower.k1Manager, "cable trays", { limit: "3" });
    expect(ids(first)).toEqual(k1Sees.slice(0, 3));
    expect(first.nextPage).toBe(2);
    const second = await search(tower.k1Manager, "cable trays", { limit: "3", page: "2" });
    expect(ids(second)).toEqual(k1Sees.slice(3));
    expect(second.nextPage).toBeNull();
    // C1 matches fewer items than K1 and pages as if the others didn't exist.
    const c1Only = await search(tower.c1Engineer, "cable trays", { limit: "3" });
    expect(ids(c1Only).toSorted()).toEqual([item.c1Submitted, item.c1Approved, item.c1Mechanical].toSorted());
    expect(c1Only.nextPage).toBeNull();
    expect(Object.keys(c1Only).toSorted()).toEqual(["links", "nextPage"]);
  });

  it("refuses a page larger than the maximum, and an empty search", async () => {
    expect((await tower.c1Engineer.get(searchUrl(tower.projectId, { q: "cable", limit: "21" }))).statusCode).toBe(400);
    expect((await tower.c1Engineer.get(searchUrl(tower.projectId, { q: "  " }))).statusCode).toBe(400);
  });

  it("answers a Project the caller isn't on exactly like one that doesn't exist (404)", async () => {
    await expectHiddenFrom({ ...searchIn(tower.projectId), seenBy: tower.c1Engineer, hiddenFrom: c1Outsider, name: named, label: "Tower" });
    await expectHiddenFrom({ ...searchIn(elsewhere.projectId), seenBy: elsewhere.c1Engineer, hiddenFrom: c2Engineer, name: named, label: "the other Project" });
    await expectHidden(tower.c1Engineer.get(searchUrl(randomUUID(), { q: "cable" }))); // not hidden-from: a made-up id
    await expectHidden(tower.c1Engineer.get(searchUrl("not-an-id", { q: "cable" }))); // not hidden-from: a made-up id
  });

  it("is for signed-in Members only", async () => {
    expect((await api.anonymous().get(searchUrl(tower.projectId, { q: "cable" }))).statusCode).toBe(401);
  });
});

