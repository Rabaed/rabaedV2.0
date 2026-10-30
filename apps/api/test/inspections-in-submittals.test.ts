// Seam 1 for the Project setting "Show Inspections in the Submittals tab" (RP-652, INSP-7; spec
// RP-649; visibility.md V3, V14, scenario RP-652-1). Off by default. On, the Submittals List and
// Kanban also list the Inspections Module's items (the WIRs the viewer sees), with their Type as a
// chip. Since ADR 0025 (RP-673) the Inspections use the Submittals' Stage keys, so a WIR sits in the
// same column and List group as a submittal at the same Stage, matched by key (RP-674); the Need My
// Action counts, the item pages and the Inspections List itself stay as they are, and nobody reads
// a WIR they could not read before.
import { expectHiddenFrom, LEGACY_MAR } from "@rabaed/db/test-support";
import { workItemSearchParams, type ProjectSummary, type WorkItemBoard, type WorkItemList, type WorkItemQueryInput } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checklistTemplate } from "./support/checklist-template.ts";
import { createTestApi, expectHidden, readById, type Caller } from "./support/harness.ts";
import { buildTower, draft, ok, projectMember, submitted, take, all, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let tower: Tower;
let admin: Caller; // C1's Authorized Person: the Project Admin.
let c1Engineer: Caller;
let k1Manager: Caller; // K1, the Consultant: its Manager.
let k1Engineer: Caller; // K1's Consultant Engineer: holds the WIR's inspection Step once it is Submitted.
let c2Engineer: Caller; // C2, a second Contractor covering Mechanical only (V3).
let projectId = "";
let marId = "";
let marPendingId = ""; // A MAR Submitted to the Consultant: at Pending Approval beside the WIR.
let wirId = "";

const setting = (by: Caller, show: boolean, project = projectId) =>
  by.request("PUT", `/v1/projects/${project}/settings/show-inspections-in-submittals`, { show });
const summary = async (by: Caller, project = projectId): Promise<ProjectSummary> => (await ok(by.get(`/v1/projects/${project}`), 200)).json();
const submittals = async (by: Caller, query: WorkItemQueryInput = {}, project = projectId): Promise<WorkItemList> =>
  (await ok(by.get(`/v1/projects/${project}/modules/submittals/work-items?${workItemSearchParams(query)}`), 200)).json();
const inspections = async (by: Caller, query: WorkItemQueryInput = {}): Promise<WorkItemList> =>
  (await ok(by.get(`/v1/projects/${projectId}/modules/inspections/work-items?${workItemSearchParams(query)}`), 200)).json();
const kanban = async (by: Caller): Promise<WorkItemBoard> => (await ok(by.get(`/v1/projects/${projectId}/modules/submittals/work-items/kanban`), 200)).json();
const ids = (list: WorkItemList) => list.items.map((i) => i.id).sort();
/** The Project's card on the Projects page: its Submittals count. */
const cardCount = async (by: Caller): Promise<number> => (await ok(by.get("/v1/projects"), 200)).json().submittals[projectId];
const stageCount = (list: WorkItemList, key: string) => list.stages.find((s) => s.key === key)?.count;
const named = (by: Caller) => (by === c1Engineer ? "C1 engineer" : by === c2Engineer ? "C2 engineer" : "someone");
/** C1's engineer reads each of `targets` first, by id, and C2's engineer none of them. */
async function hiddenFromC2(read: (by: Caller) => Promise<readonly { id: string }[]>, targets: string[], label: string) {
  for (const target of targets) await expectHiddenFrom({ read, target, seenBy: c1Engineer, hiddenFrom: c2Engineer, name: named, label });
}

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  tower = await buildTower(api, { c1, k1 }, "IIS");
  projectId = tower.projectId;
  admin = c1.caller;
  c1Engineer = tower.c1Engineer;
  k1Manager = tower.k1Manager;
  // C2 covers Mechanical only, so it never sees C1's Electrical items (V3).
  const c2ParticipantId = await api.addParticipant(admin, projectId, c2.company, "contractor");
  await ok(admin.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: { isAll: false, valueIds: [tower.mechanical] }, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  // The Tower's K1 has a Manager only; the WIR's Consultant Step is held by its Engineers (WIR Workflow Version 2).
  const k1ParticipantId = (await ok(k1Manager.get(`/v1/projects/${projectId}/participants`), 200))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);

  // A Draft legacy MAR (Submittals) and a WIR C1 has Submitted to the Consultant (Inspections, Pending Approval).
  marId = await draft(tower, c1Engineer, "Cable tray");
  marPendingId = await submitted(tower, c1Engineer, tower.c1Pm, "Cable tray 2");
  wirId = (
    await ok(
      c1Engineer.post(`/v1/projects/${projectId}/work-items`, {
        type: "WIR",
        title: "Rebar Level 2",
        // WIR Form Version 2 asks when the work will be ready (a value only); Version 3 for a Checklist Template (RP-651).
        answers: {
          description: "Slab rebar, Level 2",
          requested_for: "2026-11-02T05:30:00.000Z",
          trade: tower.electrical,
          location: tower.buildingA,
          checklist_template: await checklistTemplate(admin, projectId, tower.electrical),
        },
      }),
      201,
    )
  ).json().id as string;
  await take(c1Engineer, wirId, "send_for_review");
  await ok(tower.c1Pm.post(`/v1/work-items/${wirId}/pick-up`));
  await take(tower.c1Pm, wirId, "submit", { answers: { cover_note: "Ready on site from 09:00" } });
});

describe("Show Inspections in the Submittals tab: off, as today", () => {
  it("is off by default: the Inspections tab is there and the Submittals List holds Submittals only", async () => {
    const project = await summary(c1Engineer);
    expect(project.showInspectionsInSubmittals).toBe(false);
    expect(project.modules).toContain("inspections");
    const list = await submittals(c1Engineer);
    expect(ids(list)).toEqual([marId, marPendingId].sort());
    expect(list.filters.types.map((t) => t.code)).not.toContain("WIR"); // not hidden-from: with the setting off, the filter offers no WIR to C1 either
    expect(list.stages.some((s) => s.key.includes(":"))).toBe(false);
    expect(ids(await inspections(c1Engineer))).toEqual([wirId]);
  });

  it("reads a made-up Stage key as no group, and a `<module>:<key>` one (RP-652's form) as a bad request", async () => {
    expect(ids(await submittals(c1Engineer, { stage: ["nonsense"] }))).toEqual([]); // not hidden-from: no Stage has that key
    expect((await c1Engineer.get(`/v1/projects/${projectId}/modules/submittals/work-items?stage=inspections:pending_approval`)).statusCode).toBe(400);
    expect(ids(await inspections(c1Engineer, { stage: ["pending_approval"] }))).toEqual([wirId]);
  });

  it("is set by a Project Admin only; anyone else is told 404, like a made-up Project", async () => {
    // A write by a Member who isn't its Project Admin is told 404, like a made-up Project.
    await expectHidden(setting(c1Engineer, true)); // not hidden-from: a refused write
    await expectHidden(setting(k1Manager, true)); // not hidden-from: a refused write
    await expectHidden(setting(c2Engineer, true)); // not hidden-from: a refused write
    await expectHidden(setting(admin, true, "00000000-0000-4000-8000-000000000000")); // not hidden-from: no such Project
    expect((await summary(c1Engineer)).showInspectionsInSubmittals).toBe(false);
  });
});

describe("Show Inspections in the Submittals tab: on", () => {
  beforeAll(async () => {
    expect((await setting(admin, true)).statusCode).toBe(204);
  });
  afterAll(async () => {
    expect((await setting(admin, false)).statusCode).toBe(204);
  });

  it("every Member of the Project reads the setting, and the Inspections tab is left out of the tabs they get", async () => {
    for (const by of [admin, c1Engineer, k1Manager, k1Engineer, c2Engineer]) {
      const project = await summary(by);
      expect(project.showInspectionsInSubmittals).toBe(true);
      // The Module itself is still the Project's: only where it shows changes.
      expect(project.modules).toContain("inspections");
    }
  });

  it("lists the WIR the viewer sees with its Type as a chip, in the Submittals' Stage groups (RP-674)", async () => {
    const list = await submittals(c1Engineer);
    expect(ids(list)).toEqual([marId, marPendingId, wirId].sort());
    expect(list.items.find((i) => i.id === wirId)).toMatchObject({ type: { code: "WIR" }, stage: { key: "pending_approval" } });
    expect(list.items.find((i) => i.id === marPendingId)).toMatchObject({ type: { code: LEGACY_MAR }, stage: { key: "pending_approval" } });
    expect(list.items.find((i) => i.id === marId)).toMatchObject({ type: { code: LEGACY_MAR }, stage: { key: "draft" } });
    // The Type filter offers both, and filters.
    expect(list.filters.types.map((t) => t.code)).toEqual(expect.arrayContaining([LEGACY_MAR, "WIR"]));
    expect(ids(await submittals(c1Engineer, { type: ["WIR"] }))).toEqual([wirId]);
    expect(ids(await submittals(c1Engineer, { type: [LEGACY_MAR] }))).toEqual([marId, marPendingId].sort());
    // One group per Stage, the Submittals' own: no "Inspections ·" group, no key of another Module.
    expect(list.stages.some((s) => s.key.includes(":") || s.name.en.includes("Inspections"))).toBe(false); // not hidden-from: how the groups are named
    expect(list.stages.filter((s) => s.key === "pending_approval")).toHaveLength(1); // not hidden-from: one group per Stage key
    // Counts follow the rows, each WIR once, in its Stage.
    expect(stageCount(list, "draft")).toBe(1);
    expect(stageCount(list, "pending_approval")).toBe(2);
    expect(list.stages.reduce((sum, s) => sum + s.count, 0)).toBe(3);
    // The Stage filter returns both a MAR and a WIR at Pending Approval.
    expect(ids(await submittals(c1Engineer, { stage: ["pending_approval"] }))).toEqual([marPendingId, wirId].sort());
    expect(ids(await submittals(c1Engineer, { stage: ["draft"] }))).toEqual([marId]);
  });

  it("is the same on the Kanban: a MAR and the WIR at Pending Approval sit in one Pending Approval column", async () => {
    const board = await kanban(c1Engineer);
    const cardsOf = (stageKey: string) => board.columns.find((c) => c.stageKey === stageKey)!.lanes.flatMap((l) => l.cards.map((c) => c.id));
    expect(board.stages.some((s) => s.key.includes(":") || s.name.en.includes("Inspections"))).toBe(false); // not hidden-from: how the columns are named
    expect(board.columns.filter((c) => c.stageKey === "pending_approval")).toHaveLength(1); // not hidden-from: one column per Stage key
    expect(cardsOf("pending_approval").sort()).toEqual([marPendingId, wirId].sort());
    expect(cardsOf("draft")).toEqual([marId]);
    expect(board.columns.reduce((sum, c) => sum + c.shown, 0)).toBe(3);
  });

  it("changes nothing else: the Inspections List, the item page, its Document Number and the Need My Action count stay the Inspections Module's", async () => {
    const listed = await inspections(c1Engineer);
    expect(ids(listed)).toEqual([wirId]);
    expect(listed.items[0]!.stage.key).toBe("pending_approval");
    const detail = (await ok(c1Engineer.get(`/v1/work-items/${wirId}`), 200)).json();
    expect(detail).toMatchObject({ id: wirId, type: { code: "WIR" }, stage: { key: "pending_approval" } });
    expect(detail.documentNumber).toMatch(/WIR/);
    expect((await submittals(c1Engineer)).items.find((i) => i.id === wirId)!.documentNumber).toBe(detail.documentNumber);
  });

  it("counts them in the Projects page's Submittals count, and Need My Action is the same as with it off", async () => {
    const withIt = { submittals: await cardCount(c1Engineer), consultant: (await summary(k1Engineer)).needMyAction, c1: (await summary(c1Engineer)).needMyAction };
    expect((await setting(admin, false)).statusCode).toBe(204);
    const without = { submittals: await cardCount(c1Engineer), consultant: (await summary(k1Engineer)).needMyAction, c1: (await summary(c1Engineer)).needMyAction };
    expect((await setting(admin, true)).statusCode).toBe(204);
    expect(withIt.submittals).toBe(without.submittals + 1);
    expect(withIt.consultant).toBe(without.consultant);
    expect(withIt.c1).toBe(without.c1);
    // The Consultant is waiting on the WIR, and the toggle includes it in the Submittals List too.
    expect(without.consultant).toBeGreaterThan(0);
    expect(ids(await submittals(k1Engineer, { needMyAction: true }))).toContain(wirId);
  });

  it("exports the same rows as the List, WIRs included, and none of another Contractor's", async () => {
    const exported = async (by: Caller) =>
      ((await ok(by.get(`/v1/projects/${projectId}/modules/submittals/work-items/export?${workItemSearchParams({})}`), 200)).json() as { items: { id: string }[] }).items
        .map((i) => i.id)
        .sort();
    expect(await exported(c1Engineer)).toEqual(ids(await submittals(c1Engineer)));
    expect(await exported(c1Engineer)).toContain(wirId);
    await hiddenFromC2(async (by) => (await exported(by)).map((id) => ({ id })), [marId, marPendingId, wirId], "the export");
  });

  it("shows another Contractor none of C1's WIRs: not in the list, the Stage counts, the Kanban, the filters or the card (V3, scenario RP-652-1)", async () => {
    const rows = (query: WorkItemQueryInput) => async (by: Caller) => (await submittals(by, query)).items;
    await hiddenFromC2(rows({}), [marId, marPendingId, wirId], "the Submittals List");
    const list = await submittals(c2Engineer);
    expect(list.stages.reduce((sum, s) => sum + s.count, 0)).toBe(0);
    await hiddenFromC2(rows({ type: ["WIR"] }), [wirId], "filtered by Type");
    await hiddenFromC2(rows({ q: "Rebar" }), [wirId], "searched");
    // The shared Pending Approval group holds none of C1's WIRs for C2: not as a row, not in its count.
    await hiddenFromC2(rows({ stage: ["pending_approval"] }), [marPendingId, wirId], "the Pending Approval group");
    expect(stageCount(list, "pending_approval")).toBe(0);
    await hiddenFromC2(async (by) => (await kanban(by)).columns.flatMap((c) => c.lanes.flatMap((l) => l.cards)), [marId, marPendingId, wirId], "the Kanban");
    const board = await kanban(c2Engineer);
    expect(board.columns.reduce((sum, c) => sum + c.shown, 0)).toBe(0);
    expect(await cardCount(c2Engineer)).toBe(0);
    expect((await summary(c2Engineer)).needMyAction).toBe(0);
    await hiddenFromC2(readById(`/v1/work-items/${wirId}`), [wirId], "the WIR's page");
  });

  it("turned off again, the Submittals List is as before", async () => {
    expect((await setting(admin, false)).statusCode).toBe(204);
    const list = await submittals(c1Engineer);
    expect(ids(list)).toEqual([marId, marPendingId].sort());
    expect(list.stages.some((s) => s.key.includes(":"))).toBe(false);
    expect((await summary(c1Engineer)).showInspectionsInSubmittals).toBe(false);
    expect((await setting(admin, true)).statusCode).toBe(204);
  });
});
