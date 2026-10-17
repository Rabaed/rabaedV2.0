// Seam 1 for the Project setting "Show Inspections in the Submittals tab" (RP-652, INSP-7; spec
// RP-649; visibility.md V3, V14, scenario RP-652-1). Off by default. On, the Submittals List and
// Kanban also list the Inspections Module's items (the WIRs the viewer sees), with their Type as a
// chip and the Inspections Stages as groups of their own (`inspections:<key>`); the Submittals'
// own Stage keys, the Need My Action counts, the item pages and the Inspections List itself stay
// as they are, and nobody reads a WIR they could not read before.
import { LEGACY_MAR } from "@rabaed/db/test-support";
import { workItemSearchParams, type ProjectSummary, type WorkItemBoard, type WorkItemList, type WorkItemQueryInput } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { buildTower, draft, ok, projectMember, take, all, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let tower: Tower;
let admin: Caller; // C1's Authorized Person: the Project Admin.
let c1Engineer: Caller;
let k1Manager: Caller; // K1, the Consultant: inspects.
let c2Engineer: Caller; // C2, a second Contractor covering Mechanical only (V3).
let projectId = "";
let marId = "";
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

  // A Draft legacy MAR (Submittals) and a WIR C1 has Submitted to the Consultant (Inspections, Pending Inspection).
  marId = await draft(tower, c1Engineer, "Cable tray");
  wirId = (
    await ok(
      c1Engineer.post(`/v1/projects/${projectId}/work-items`, {
        type: "WIR",
        title: "Rebar Level 2",
        answers: { description: "Slab rebar, Level 2", trade: tower.electrical, location: tower.buildingA },
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
    expect(ids(list)).toEqual([marId]);
    expect(list.filters.types.map((t) => t.code)).not.toContain("WIR");
    expect(list.stages.some((s) => s.key.includes(":"))).toBe(false);
    expect(ids(await inspections(c1Engineer))).toEqual([wirId]);
  });

  it("is set by a Project Admin only; anyone else is told 404, like a made-up Project", async () => {
    await expectHidden(setting(c1Engineer, true));
    await expectHidden(setting(k1Manager, true));
    await expectHidden(setting(c2Engineer, true));
    await expectHidden(setting(admin, true, "00000000-0000-4000-8000-000000000000"));
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
    for (const by of [admin, c1Engineer, k1Manager, c2Engineer]) {
      const project = await summary(by);
      expect(project.showInspectionsInSubmittals).toBe(true);
      // The Module itself is still the Project's: only where it shows changes.
      expect(project.modules).toContain("inspections");
    }
  });

  it("lists the WIR the viewer sees with its Type as a chip and the Inspections Stages as groups of their own", async () => {
    const list = await submittals(c1Engineer);
    expect(ids(list)).toEqual([marId, wirId].sort());
    expect(list.items.find((i) => i.id === wirId)).toMatchObject({ type: { code: "WIR" }, stage: { key: "inspections:pending_inspection" } });
    expect(list.items.find((i) => i.id === marId)).toMatchObject({ type: { code: LEGACY_MAR }, stage: { key: "draft" } });
    // The Type filter offers both, and filters.
    expect(list.filters.types.map((t) => t.code)).toEqual(expect.arrayContaining([LEGACY_MAR, "WIR"]));
    expect(ids(await submittals(c1Engineer, { type: ["WIR"] }))).toEqual([wirId]);
    expect(ids(await submittals(c1Engineer, { type: [LEGACY_MAR] }))).toEqual([marId]);
    // The Submittals' Stages keep their keys; Inspections' come after them, named after their Module, so "Draft" is not two groups of one name.
    const own = list.stages.filter((s) => !s.key.includes(":")).map((s) => s.key);
    const theirs = list.stages.filter((s) => s.key.startsWith("inspections:"));
    expect(own).toContain("draft");
    expect(theirs.map((s) => s.key)).toEqual(expect.arrayContaining(["inspections:draft", "inspections:pending_inspection", "inspections:passed", "inspections:failed"]));
    expect(theirs.find((s) => s.key === "inspections:draft")!.name).toEqual({ en: "Inspections · Draft", ar: "الفحوصات · مسودة" });
    expect(list.stages.indexOf(theirs[0]!)).toBeGreaterThan(list.stages.indexOf(list.stages.find((s) => s.key === own.at(-1))!));
    // Counts follow the rows, group by group.
    expect(stageCount(list, "draft")).toBe(1);
    expect(stageCount(list, "inspections:pending_inspection")).toBe(1);
    expect(stageCount(list, "inspections:draft")).toBe(0);
    expect(ids(await submittals(c1Engineer, { stage: ["inspections:pending_inspection"] }))).toEqual([wirId]);
    expect(ids(await submittals(c1Engineer, { stage: ["draft"] }))).toEqual([marId]);
  });

  it("is the same on the Kanban: the WIR sits in the Inspections' column, the MAR in the Submittals'", async () => {
    const board = await kanban(c1Engineer);
    const cardsOf = (stageKey: string) => board.columns.find((c) => c.stageKey === stageKey)!.lanes.flatMap((l) => l.cards.map((c) => c.id));
    expect(board.stages.map((s) => s.key)).toContain("inspections:pending_inspection");
    expect(cardsOf("inspections:pending_inspection")).toEqual([wirId]);
    expect(cardsOf("draft")).toEqual([marId]);
  });

  it("changes nothing else: the Inspections List, the item page, its Document Number and the Need My Action count stay the Inspections Module's", async () => {
    const listed = await inspections(c1Engineer);
    expect(ids(listed)).toEqual([wirId]);
    expect(listed.items[0]!.stage.key).toBe("pending_inspection");
    const detail = (await ok(c1Engineer.get(`/v1/work-items/${wirId}`), 200)).json();
    expect(detail).toMatchObject({ id: wirId, type: { code: "WIR" }, stage: { key: "pending_inspection" } });
    expect(detail.documentNumber).toMatch(/WIR/);
    expect((await submittals(c1Engineer)).items.find((i) => i.id === wirId)!.documentNumber).toBe(detail.documentNumber);
  });

  it("counts them in the Projects page's Submittals count, and Need My Action is the same as with it off", async () => {
    const withIt = { submittals: await cardCount(c1Engineer), consultant: (await summary(k1Manager)).needMyAction, c1: (await summary(c1Engineer)).needMyAction };
    expect((await setting(admin, false)).statusCode).toBe(204);
    const without = { submittals: await cardCount(c1Engineer), consultant: (await summary(k1Manager)).needMyAction, c1: (await summary(c1Engineer)).needMyAction };
    expect((await setting(admin, true)).statusCode).toBe(204);
    expect(withIt.submittals).toBe(without.submittals + 1);
    expect(withIt.consultant).toBe(without.consultant);
    expect(withIt.c1).toBe(without.c1);
    // The Consultant is waiting on the WIR, and the toggle includes it in the Submittals List too.
    expect(without.consultant).toBeGreaterThan(0);
    expect(ids(await submittals(k1Manager, { needMyAction: true }))).toContain(wirId);
  });

  it("shows another Contractor none of C1's WIRs: not in the list, the Stage counts, the Kanban, the filters or the card (V3, scenario RP-652-1)", async () => {
    const list = await submittals(c2Engineer);
    expect(list.items).toEqual([]);
    expect(list.stages.reduce((sum, s) => sum + s.count, 0)).toBe(0);
    expect(ids(await submittals(c2Engineer, { type: ["WIR"] }))).toEqual([]);
    expect(ids(await submittals(c2Engineer, { q: "Rebar" }))).toEqual([]);
    const board = await kanban(c2Engineer);
    expect(board.columns.flatMap((c) => c.lanes.flatMap((l) => l.cards))).toEqual([]);
    expect(board.columns.reduce((sum, c) => sum + c.shown, 0)).toBe(0);
    expect(await cardCount(c2Engineer)).toBe(0);
    expect((await summary(c2Engineer)).needMyAction).toBe(0);
    await expectHidden(c2Engineer.get(`/v1/work-items/${wirId}`));
  });

  it("turned off again, the Submittals List is as before", async () => {
    expect((await setting(admin, false)).statusCode).toBe(204);
    const list = await submittals(c1Engineer);
    expect(ids(list)).toEqual([marId]);
    expect(list.stages.some((s) => s.key.includes(":"))).toBe(false);
    expect((await summary(c1Engineer)).showInspectionsInSubmittals).toBe(false);
    expect((await setting(admin, true)).statusCode).toBe(204);
  });
});
