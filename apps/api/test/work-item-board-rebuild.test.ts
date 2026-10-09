// Seam 1 for the rebuilt Kanban and its filter panel (RP-410, spec RP-447;
// visibility.md V5, V14, "Creation Date", the Lists/Kanban and "Search and
// filters" channels, scenario RP-410-1). The List and the Kanban share one
// filter: several values per field, any of them; fields together, all of them.
// The new fields read nothing the viewer couldn't already see on a card: Owner
// names only my own Company's people, Role only my own Company's Steps, Created
// date the date the card shows. And each Member keeps their own Card view layout.
import { randomUUID } from "node:crypto";
import {
  defaultBoardCardLayout,
  workItemSearchParams,
  type WorkItemBoard,
  type WorkItemList,
  type WorkItemQueryInput,
} from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

const DAY = 86_400_000;

let c1: Company; // Contractor; its Authorized Person created the Project.
let c1Engineer: Caller;
let c1Pm: Caller;
let c1PmId = "";
let k1Engineer: Caller; // Consultant.
let k1Manager: Caller;
let k1ManagerId = "";
let k1ParticipantId = "";
let outsider: Caller;
let projectId = "";
const trade = { electrical: "", mechanical: "" };
const loc = { zoneA: "", zoneB: "", a1: "", a2: "", a1f1: "" };

const complete = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};

async function board(by: Caller, query: WorkItemQueryInput = {}): Promise<WorkItemBoard> {
  return (await ok(by.get(`/v1/projects/${projectId}/work-items/kanban?${workItemSearchParams(query)}`), 200)).json();
}
async function list(by: Caller, query: WorkItemQueryInput = {}): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${projectId}/work-items?${workItemSearchParams(query)}`), 200)).json();
}
const cardIds = (b: WorkItemBoard) => b.columns.flatMap((c) => c.lanes.flatMap((l) => l.cards.map((card) => card.id))).sort();
const ids = (...items: string[]) => [...items].sort();

async function draft(title: string, answers: Record<string, unknown> = {}): Promise<string> {
  const res = await ok(
    c1Engineer.post(`/v1/projects/${projectId}/work-items`, {
      type: "MAR",
      title,
      answers: { ...complete, trade: trade.electrical, location: loc.a1f1, ...answers },
    }),
    201,
  );
  const id = res.json().id as string;
  await attachDatasheet(c1Engineer, id);
  return id;
}

/** Sends a Draft for review, where C1's PM claims it. */
async function inReview(id: string) {
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/claim`));
}

let atA1f1 = ""; // In review, claimed by C1's PM; Electrical; Zone A › A1 › Floor 1.
let atA2 = ""; // Draft; Mechanical; Zone A › A2.
let atZoneB = ""; // In review, unclaimed; Electrical; Zone B.
let withK1 = ""; // Submitted, claimed by K1's manager.
let late = ""; // Numbered now, Submitted 20 days later.

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id;
  trade.electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  trade.mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  loc.zoneA = await post("locations", { code: "ZA", name: bilingual("Zone A"), parentId: null });
  loc.zoneB = await post("locations", { code: "ZB", name: bilingual("Zone B"), parentId: null });
  loc.a1 = await post("locations", { code: "A1", name: bilingual("Building 1"), parentId: loc.zoneA });
  loc.a2 = await post("locations", { code: "A2", name: bilingual("Building 2"), parentId: loc.zoneA });
  loc.a1f1 = await post("locations", { code: "A1F1", name: bilingual("Floor 1"), parentId: loc.a1 });
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  c1Engineer = await projectMember(api, c1, own, ["engineer"]);
  const pm = await api.inviteMember(c1.caller, { fullName: { en: "Ali Sonour", ar: "علي سنور" } });
  c1Pm = await api.acceptInvitation(pm.invitationToken);
  c1PmId = pm.id;
  await api.addProjectMember(c1.caller, own, pm.id);
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/members/${pm.id}/visibility`, { trade: all, location: all }));
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/members/${pm.id}/positions`, { positions: ["project_manager"] }));

  const k1 = await api.authorizedPerson();
  k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  const manager = await api.inviteMember(k1.caller, { fullName: { en: "Hessa Al Otaibi", ar: "حصة العتيبي" } });
  k1Manager = await api.acceptInvitation(manager.invitationToken);
  k1ManagerId = manager.id;
  await api.addProjectMember(k1.caller, k1ParticipantId, manager.id);
  await ok(k1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/members/${manager.id}/visibility`, { trade: all, location: all }));
  await ok(k1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/members/${manager.id}/positions`, { positions: ["manager"] }));
  outsider = (await api.authorizedPerson()).caller;

  atA1f1 = await draft("Cable trays");
  await inReview(atA1f1);
  atA2 = await draft("Chillers", { trade: trade.mechanical, location: loc.a2 });
  atZoneB = await draft("Busbars", { location: loc.zoneB });
  await take(c1Engineer, atZoneB, "send_for_review");
  withK1 = await draft("Fixtures", { location: loc.zoneB });
  await inReview(withK1);
  await take(c1Pm, withK1, "submit");
  await ok(k1Manager.post(`/v1/work-items/${withK1}/claim`));
  late = await draft("Pumps", { trade: trade.mechanical, location: loc.zoneB });
  await inReview(late);
});

describe("several values per filter (RP-410)", () => {
  it("shows any of a field's values, on the List and the Kanban alike", async () => {
    const both = { trade: [trade.electrical, trade.mechanical] };
    expect(cardIds(await board(c1Engineer, both))).toEqual(ids(atA1f1, atA2, atZoneB, withK1, late));
    const stages = { stage: ["draft", "pending_approval"] };
    expect(cardIds(await board(c1Engineer, stages))).toEqual(ids(atA2, withK1));
    expect((await list(c1Engineer, stages)).items.map((i) => i.id).sort()).toEqual(ids(atA2, withK1));
  });

  it("needs every field chosen: Mechanical and in review", async () => {
    expect(cardIds(await board(c1Engineer, { trade: [trade.mechanical], stage: ["internal_review"] }))).toEqual([late]);
  });

  it("reads the Location levels as one tree: any Zone chosen, and inside it the Floor chosen", async () => {
    expect(cardIds(await board(c1Engineer, { location: [loc.zoneA, loc.zoneB] }))).toEqual(ids(atA1f1, atA2, atZoneB, withK1, late));
    expect(cardIds(await board(c1Engineer, { location: [loc.zoneA] }))).toEqual(ids(atA1f1, atA2));
    expect(cardIds(await board(c1Engineer, { location: [loc.zoneA, loc.a1f1] }))).toEqual([atA1f1]);
    expect(cardIds(await board(c1Engineer, { location: [loc.zoneB, loc.a2] }))).toEqual([]);
    const { locations } = (await board(c1Engineer)).filters;
    expect(locations.find((l) => l.id === loc.a1f1)).toMatchObject({ depth: 3, parentId: loc.a1, levelName: { en: "Floor" } });
  });
});

describe("Owner and Role (scenario RP-410-1, V5, V14)", () => {
  it("offers my own Company's people who hold items, never another Company's", async () => {
    const { owners, with: w } = (await board(c1Engineer)).filters;
    // C1's PM, and its engineer, who holds their own Draft.
    expect(owners).toHaveLength(2);
    expect(owners).toContainEqual({ memberId: c1PmId, name: { en: "Ali Sonour", ar: "علي سنور" } });
    expect(owners.map((o) => o.memberId)).not.toContain(k1ManagerId);
    expect(w.companies.map((c) => c.participantId)).toEqual([k1ParticipantId]);
    expect(JSON.stringify(await board(c1Engineer))).not.toContain("Hessa");
    // K1 is offered its own manager, and C1 by name only.
    const k1 = (await board(k1Engineer)).filters;
    expect(k1.owners.map((o) => o.memberId)).toEqual([k1ManagerId]);
    expect(JSON.stringify(await board(k1Engineer))).not.toContain("Ali Sonour");
  });

  it("filters by my people, my unclaimed pool or another Company, any of them", async () => {
    expect(cardIds(await board(c1Engineer, { owner: [`member:${c1PmId}`] }))).toEqual(ids(atA1f1, late));
    expect(cardIds(await board(c1Engineer, { owner: ["unclaimed"] }))).toEqual([atZoneB]);
    expect(cardIds(await board(c1Engineer, { owner: [`company:${k1ParticipantId}`, "unclaimed"] }))).toEqual(ids(atZoneB, withK1));
  });

  it("matches nothing for another Company's person, though they hold one of my items", async () => {
    expect(cardIds(await board(c1Engineer, { owner: [`member:${k1ManagerId}`] }))).toEqual([]);
    expect((await list(c1Engineer, { owner: [`member:${k1ManagerId}`] })).stages.every((s) => s.count === 0)).toBe(true);
    // K1's own filter finds it.
    expect(cardIds(await board(k1Engineer, { owner: [`member:${k1ManagerId}`] }))).toEqual([withK1]);
  });

  it("offers and filters by my own Company's Steps only: another Company is one lane, never its roles", async () => {
    const steps = (await board(c1Engineer)).filters.with.steps.map((s) => s.key).sort();
    expect(steps).toEqual(["draft", "internal_review"]);
    expect(cardIds(await board(c1Engineer, { role: ["internal_review"] }))).toEqual(ids(atA1f1, atZoneB, late));
    // K1's review Step holds one of C1's items, yet C1 can't pick it out by that role.
    expect(cardIds(await board(c1Engineer, { role: ["consultant_review"] }))).toEqual([]);
    expect(cardIds(await board(k1Engineer, { role: ["consultant_review"] }))).toEqual([withK1]);
    // K1 sees C1's items by C1's name only, and can't reach C1's roles either.
    expect(cardIds(await board(k1Engineer, { role: ["internal_review"] }))).toEqual([]);
  });
});

describe("search on this board (RP-410, V14)", () => {
  it("finds the owner as the viewer reads them: my own person, another Company by name only", async () => {
    expect(cardIds(await board(c1Engineer, { q: "Sonour" }))).toEqual(ids(atA1f1, late));
    // K1 never reads C1's PM, so can't find by them.
    expect(cardIds(await board(k1Engineer, { q: "Sonour" }))).toEqual([]);
    // C1 never reads K1's manager, though she holds C1's item.
    expect(cardIds(await board(c1Engineer, { q: "Hessa" }))).toEqual([]);
    expect(cardIds(await board(k1Engineer, { q: "Hessa" }))).toEqual([withK1]);
  });

  it("finds the items in a Zone, Building or Floor, under it too", async () => {
    expect(cardIds(await board(c1Engineer, { q: "Zone A" }))).toEqual(ids(atA1f1, atA2));
    expect(cardIds(await board(c1Engineer, { q: "Building 1" }))).toEqual([atA1f1]);
    expect((await list(c1Engineer, { q: "Building 1" })).items.map((i) => i.id)).toEqual([atA1f1]);
  });
});

describe("the card's Contractor name", () => {
  it("is the raising Company's, for everyone who sees the item", async () => {
    // C1's name, as C1 reads it on the item C1 holds.
    const own = (await board(c1Engineer)).columns.flatMap((c) => c.lanes.flatMap((l) => l.cards)).find((c) => c.id === atA1f1)!;
    const c1Name = own.with?.companyName.en;
    expect(c1Name).toBeTruthy();
    expect(own.raiserCompanyName?.en).toBe(c1Name);
    const card = (await board(k1Engineer)).columns.flatMap((c) => c.lanes.flatMap((l) => l.cards)).find((c) => c.id === withK1)!;
    expect(card.raiserCompanyName?.en).toBe(c1Name);
  });
});

describe("Card view layout (RP-410)", () => {
  const path = () => `/v1/projects/${projectId}/work-items/kanban/layout`;

  it("is the default until the Member changes it, and then theirs alone", async () => {
    expect((await board(c1Engineer)).layout).toEqual(defaultBoardCardLayout);
    const changed = (await ok(c1Engineer.request("PUT", path(), { contractorName: true }), 200)).json();
    expect(changed).toEqual({ ...defaultBoardCardLayout, contractorName: true });
    expect((await board(c1Engineer)).layout).toEqual({ ...defaultBoardCardLayout, contractorName: true });
    await ok(c1Engineer.request("PUT", path(), { location: false }), 200);
    expect((await board(c1Engineer)).layout).toEqual({ contractorName: true, location: false, creationDate: true });
    // Not my colleague's, nor another Company's.
    expect((await board(c1Pm)).layout).toEqual(defaultBoardCardLayout);
    expect((await board(k1Engineer)).layout).toEqual(defaultBoardCardLayout);
    // Per board: the Module tab's path keeps the same layout.
    expect((await ok(c1Engineer.get(`/v1/projects/${projectId}/modules/submittals/work-items/kanban`), 200)).json().layout.contractorName).toBe(true);
  });

  it("answers a Member off the Project as if it didn't exist, and refuses what isn't a switch", async () => {
    await expectHidden(outsider.request("PUT", path(), { contractorName: true }));
    await expectHidden(c1Engineer.request("PUT", `/v1/projects/${randomUUID()}/work-items/kanban/layout`, { contractorName: true }));
    expect((await c1Engineer.request("PUT", path(), { colour: "red" })).statusCode).toBe(400);
    expect((await c1Engineer.request("PUT", path(), { contractorName: "yes" })).statusCode).toBe(400);
  });
});

// Last: it moves the clock.
describe("Created date (visibility.md Creation Date)", () => {
  it("is the Creation Date for the raiser's Company and the Submission Date for anyone else", async () => {
    await api.later(20 * DAY);
    await take(c1Pm, late, "submit");
    await api.later(2 * DAY);
    // Numbered 22 days ago: outside C1's last 7 days, inside its last 30.
    expect(cardIds(await board(c1Engineer, { createdWithin: 7 }))).not.toContain(late);
    expect(cardIds(await board(c1Engineer, { createdWithin: 30 }))).toContain(late);
    // K1 sees it from its Submission Date, 2 days ago, and nothing of how long C1 worked on it.
    expect(cardIds(await board(k1Engineer, { createdWithin: 7 }))).toEqual([late]);
    const card = (await board(k1Engineer)).columns.flatMap((c) => c.lanes.flatMap((l) => l.cards)).find((c) => c.id === late)!;
    expect(card.creationDate).toBeNull();
  });
});
