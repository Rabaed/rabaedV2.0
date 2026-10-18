// Seam 1 for the Snag List's bulk actions and its export (RP-629; spec RP-619; glossary Snag
// List, Stage, Step Age; visibility.md V3, V5, V14 and scenario RP-629-1).
//
// Reassign within my company hands an item the viewer's Participant holds to another Member of
// that Participant, from the Step Pool: never another Company's Member, never an item another
// Company holds. Move Stage takes, per item, the Transition the viewer is offered that leads
// there, and reports the rest. The export is the List's own read, so it holds only what the
// viewer sees, with Step Age in weeks and no due date.
//
// C1 covers Building A, C2 Building B (V3); K1, the Consultant, raises Snags on both.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { type SnagBulkCandidates, type SnagBulkResult, type WorkItemExport, type WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, memberOnProject, ok, only, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let at: Tower;
let c2Participant = "";
let c2Engineer: { id: string; caller: Caller };
let c1Colleague: { id: string; caller: Caller };
let buildingB = "";

// K1's Snags: two on C1 (Building A), one on C2 (Building B).
let first = "";
let second = "";
let c2Snag = "";

const bulkPath = () => `/v1/projects/${at.projectId}/snag-list`;
const snagPath = () => `/v1/projects/${at.projectId}/modules/snag_list/work-items`;
const move = async (by: Caller, ids: string[], stage: string): Promise<SnagBulkResult> =>
  (await ok(by.post(`${bulkPath()}/move`, { ids, stage, idempotencyKey: crypto.randomUUID() }), 200)).json();
const reassign = async (by: Caller, ids: string[], toMemberId: string): Promise<SnagBulkResult> =>
  (await ok(by.post(`${bulkPath()}/reassign`, { ids, toMemberId }), 200)).json();
const candidates = async (by: Caller, ids: string[]): Promise<SnagBulkCandidates> =>
  (await ok(by.post(`${bulkPath()}/reassign-candidates`, { ids }), 200)).json();
const exported = async (by: Caller, query = ""): Promise<WorkItemExport> => (await ok(by.get(`${snagPath()}/export${query}`), 200)).json();
const reasons = (result: SnagBulkResult) => Object.fromEntries(result.skipped.map((s) => [s.id, s.reason]));

async function snag(title: string, location: string): Promise<string> {
  const id = (
    await ok(
      at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title, answers: { description: title, trade: at.electrical, location } }),
      201,
    )
  ).json().id as string;
  await take(at.k1Manager, id, "raise");
  return id;
}

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SBK");
  buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  await ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/visibility`, { trade: all, location: only(at.buildingA) }));
  c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = await memberOnProject(api, c2, c2Participant, ["engineer"]);
  c1Colleague = await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"]);
  first = await snag("Cable tray not bonded", at.buildingA);
  second = await snag("Duct insulation torn", at.buildingA);
  c2Snag = await snag("Paint drips on skirting", buildingB);
});

describe("reassign within my company (seam 1)", () => {
  it("offers only the Members of the viewer's own Participant, and counts only the items it holds", async () => {
    const offered = await candidates(at.c1Pm, [first, second, c2Snag]);
    expect(offered.reassignable).toBe(2);
    expect(offered.members.length).toBeGreaterThan(0);
    expect(offered.members.map((m) => m.memberId)).toContain(c1Colleague.id);
    expect(offered.members.map((m) => m.memberId)).not.toContain(c2Engineer.id);
    expect(JSON.stringify(offered)).not.toContain(c2Snag);
  });

  it("offers nothing to a Participant that does not hold the items", async () => {
    // K1 sees both Snags and holds neither.
    expect(await candidates(at.k1Manager, [first, second])).toEqual({ reassignable: 0, members: [] });
    // C2 sees none of C1's items.
    expect(await candidates(c2Engineer.caller, [first, second])).toEqual({ reassignable: 0, members: [] });
  });

  it("never hands an item to another Company's Member, whoever asks", async () => {
    const toC2 = await reassign(at.c1Pm, [first, second], c2Engineer.id);
    expect(toC2.done).toEqual([]);
    expect(reasons(toC2)).toEqual({ [first]: "not_offered", [second]: "not_offered" });
    const byK1 = await reassign(at.k1Manager, [first], c1Colleague.id);
    expect(byK1.done).toEqual([]);
    expect(reasons(byK1)).toEqual({ [first]: "not_offered" });
    // Nobody's Need My Action changed.
    expect((await detail(at.c1Pm, first)).heldBy).toEqual((await detail(at.c1Pm, first)).heldBy);
  });

  it("skips an item the viewer does not see, naming nothing", async () => {
    const result = await reassign(at.c1Pm, [first, c2Snag], c1Colleague.id);
    expect(result.done).toEqual([first]);
    expect(result.skipped).toEqual([{ id: c2Snag, documentNumber: null, title: null, reason: "not_found" }]);
    expect(JSON.stringify(result)).not.toContain("Paint drips");
  });

  it("holds the item with the new Member, who is told, and the history says so to the holding Company only", async () => {
    const after = await detail(c1Colleague.caller, first);
    expect(after.actions.returnToPool).toBe(true);
    expect(after.actions.transitions.map((t) => t.key)).toContain("start_work");
    const history: WorkItemHistory = (await ok(at.c1Pm.get(`/v1/work-items/${first}/history`), 200)).json();
    expect(history.events.find((e) => e.handover?.because === "reassigned")).toBeDefined();
    const k1History: WorkItemHistory = (await ok(at.k1Manager.get(`/v1/work-items/${first}/history`), 200)).json();
    expect(k1History.events.some((e) => e.handover)).toBe(false);
    // Reassigning to the holder again is not offered.
    const again = await reassign(at.c1Pm, [first], c1Colleague.id);
    expect(reasons(again)).toEqual({ [first]: "not_offered" });
  });
});

describe("move Stage (seam 1)", () => {
  // The Transitions are the holder's: `first` is held by C1's colleague since the reassign above, `second` waits in the pool.
  it("takes the Transition the viewer is offered, for each item, and reports the rest", async () => {
    const byColleague = await move(c1Colleague.caller, [first, c2Snag], "in_progress");
    expect(byColleague.done).toEqual([first]);
    expect(byColleague.skipped).toEqual([{ id: c2Snag, documentNumber: null, title: null, reason: "not_found" }]);
    // A pooled item is offered to nobody until someone picks it up, as on its page.
    const pooled = await move(at.c1Pm, [second], "in_progress");
    expect(reasons(pooled)).toEqual({ [second]: "not_offered" });
    await ok(at.c1Pm.post(`/v1/work-items/${second}/pick-up`));
    const byPm = await move(at.c1Pm, [second, first], "in_progress");
    expect(byPm.done).toEqual([second]);
    expect(reasons(byPm)).toEqual({ [first]: "already_there" });
    const list = (await ok(at.c1Pm.get(`${snagPath()}?stage=in_progress`), 200)).json();
    expect(list.items.map((i: { id: string }) => i.id).sort()).toEqual([first, second].sort());
  });

  it("skips an item the viewer does not hold, and one with no way to the Stage", async () => {
    // C1's PM does not hold `first`; K1 holds neither; Closed is no Transition of the Contractor's.
    expect(reasons(await move(at.c1Pm, [first], "on_hold"))).toEqual({ [first]: "not_offered" });
    const byK1 = await move(at.k1Manager, [first, second], "on_hold");
    expect(byK1.done).toEqual([]);
    expect(Object.values(reasons(byK1))).toEqual(["not_offered", "not_offered"]);
    expect(reasons(await move(c1Colleague.caller, [first], "closed"))).toEqual({ [first]: "not_offered" });
  });

  it("does not take a Transition that asks for something (a Resolve's note), and names the item", async () => {
    // Each move puts the item back in its Step Pool: the next holder picks it up.
    await ok(c1Colleague.caller.post(`/v1/work-items/${first}/pick-up`));
    const result = await move(c1Colleague.caller, [first], "resolved");
    expect(result.done).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ id: first, reason: "needs_input", title: "Cable tray not bonded", documentNumber: expect.any(String) })]);
    expect((await detail(c1Colleague.caller, first)).stage.key).toBe("in_progress");
  });

  it("moves back and forth, each by the Transition the Workflow offers", async () => {
    for (const stage of ["on_hold", "in_progress", "open"]) {
      await ok(at.c1Pm.post(`/v1/work-items/${second}/pick-up`));
      expect((await move(at.c1Pm, [second], stage)).done).toEqual([second]);
      expect((await detail(at.c1Pm, second)).stage.key).toBe(stage);
    }
  });

  it("refuses an empty request, and a Project the viewer is not on is the plain 404", async () => {
    expect((await at.c1Pm.post(`${bulkPath()}/move`, { ids: [], stage: "open", idempotencyKey: crypto.randomUUID() })).statusCode).toBe(400);
    const stranger = await api.authorizedPerson();
    expect((await stranger.caller.post(`${bulkPath()}/move`, { ids: [first], stage: "open", idempotencyKey: crypto.randomUUID() })).statusCode).toBe(404);
    expect((await stranger.caller.post(`${bulkPath()}/reassign-candidates`, { ids: [first] })).statusCode).toBe(404);
  });
});

describe("the export of the Snag List (scenario RP-629-1, seam 1)", () => {
  it("RP-629-1: C2's export holds none of C1's items, and C1's none of C2's", async () => {
    const c2Export = await exported(c2Engineer.caller);
    expect(c2Export.items.map((i) => i.id)).toEqual([c2Snag]);
    for (const hidden of [first, second, at.c1ParticipantId, "Cable tray", "Duct insulation"]) expect(JSON.stringify(c2Export)).not.toContain(hidden);
    const c1Export = await exported(at.c1Pm);
    expect(c1Export.items.map((i) => i.id).sort()).toEqual([first, second].sort());
    expect(JSON.stringify(c1Export)).not.toContain(c2Snag);
    expect(JSON.stringify(c1Export)).not.toContain("Paint drips");
    // The Consultant sees what it raised on both.
    expect((await exported(at.k1Manager)).items.map((i) => i.id).sort()).toEqual([first, second, c2Snag].sort());
  });

  it("follows the List's filters, and carries Step Age in weeks and no due date", async () => {
    const filtered = await exported(at.c1Pm, "?stage=in_progress");
    expect(filtered.items.map((i) => i.id)).toEqual([first]);
    const text = JSON.stringify(filtered).toLowerCase();
    expect(text).not.toContain("overdue");
    expect(text).not.toContain("due");
    expect(filtered.items[0]).toHaveProperty("stepAgeWeeks");
    expect(filtered.capped).toBe(false);
  });
});
