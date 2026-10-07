// Seam 1 for the Kanban (RP-349, spec RP-344; visibility.md V1, V3, V14, the
// Lists/Kanban channel, scenario 17). Stages are its columns; inside a column,
// each Step of the viewer's own Company is a swimlane and another Company is one
// lane with its name only. A closed column holds the items closed in the last
// 30 days, its Stage count the "Show all" total. It is the work item query: the
// same filters, the same one card per Revision chain, the same visible items.
import { randomUUID } from "node:crypto";
import {
  closedColumnDays,
  isOpenStageCategory,
  workItemSearchParams,
  type WorkItemBoard,
  type WorkItemList,
  type WorkItemQueryInput,
  type WorkItemRow,
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
let c2Engineer: Caller; // A second Contractor (V3).
let k1Engineer: Caller; // Consultant: verifies.
let k1ManagerA: Caller; // Consultant: in the review Step's pool.
let k1ManagerB: Caller; // Consultant: in the same pool.
let outsider: Caller; // A Company on no Project of these.
let projectId = "";
let k1ParticipantId = "";
const trade = { electrical: "", mechanical: "" };
const loc = { buildingA: "", buildingB: "" };

const complete = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};

/** The board as `by` reads it with `query`. */
async function board(by: Caller, query: WorkItemQueryInput = {}): Promise<WorkItemBoard> {
  return (await ok(by.get(`/v1/projects/${projectId}/work-items/kanban?${workItemSearchParams(query)}`), 200)).json();
}

/** Every page of the List as `by` reads it with `query`. */
async function listAll(by: Caller, query: WorkItemQueryInput = {}): Promise<{ first: WorkItemList; items: WorkItemRow[] }> {
  const items: WorkItemRow[] = [];
  let first: WorkItemList | undefined;
  let cursor: string | undefined;
  do {
    const page: WorkItemList = (await ok(by.get(`/v1/projects/${projectId}/work-items?${workItemSearchParams({ ...query, cursor })}`), 200)).json();
    first ??= page;
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { first: first!, items };
}

const cards = (b: WorkItemBoard) => b.columns.flatMap((c) => c.lanes.flatMap((l) => l.cards));
const cardIds = (b: WorkItemBoard) => cards(b).map((c) => c.id);
const column = (b: WorkItemBoard, stageKey: string) => b.columns.find((c) => c.stageKey === stageKey)!;
const stage = (b: WorkItemBoard, key: string) => b.stages.find((s) => s.key === key)!;
const cardOf = (b: WorkItemBoard, id: string) => cards(b).find((c) => c.id === id);
const laneOf = (b: WorkItemBoard, id: string) => b.columns.flatMap((c) => c.lanes).find((l) => l.cards.some((c) => c.id === id));

/** Every column's and lane's count is of the cards it holds; every card sits in its own Stage's column. */
function expectCountsAddUp(b: WorkItemBoard, label?: string) {
  expect(b.columns.map((c) => c.stageKey), label).toEqual(b.stages.map((s) => s.key));
  for (const c of b.columns) {
    for (const lane of c.lanes) expect(lane.count, label).toBe(lane.cards.length);
    expect(c.shown, label).toBe(c.lanes.reduce((sum, l) => sum + l.count, 0));
    expect(c.lanes.every((l) => l.cards.every((card) => card.stage.key === c.stageKey)), label).toBe(true);
    const s = stage(b, c.stageKey);
    // An open column shows every matching item; a closed one at most its total.
    if (isOpenStageCategory(s.category)) expect(c.shown, label).toBe(s.count);
    else expect(c.shown, label).toBeLessThanOrEqual(s.count);
  }
}

/** A Draft MAR of C1's, complete, with its datasheet. */
async function draft(title: string, answers: Record<string, unknown> = {}): Promise<string> {
  const res = await ok(
    c1Engineer.post(`/v1/projects/${projectId}/work-items`, {
      type: "MAR",
      title,
      answers: { ...complete, trade: trade.electrical, location: loc.buildingA, ...answers },
    }),
    201,
  );
  const id = res.json().id as string;
  await attachDatasheet(c1Engineer, id);
  return id;
}

/** Sends a Draft for review and Submits it to K1, where it waits in the review Step's pool. */
async function submit(id: string) {
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/claim`));
  await take(c1Pm, id, "submit");
}

/** K1 verifies the submitted item and issues Code C, closing it. */
async function codeC(id: string) {
  await ok(
    k1Engineer.request("PUT", `/v1/work-items/${id}/answers`, {
      answers: {
        ...(await ok(k1Engineer.get(`/v1/work-items/${id}`), 200)).json().answers,
        sample_checked: true,
        matches_specification: false,
        verification_note: "Below the specified efficacy",
      },
    }),
  );
  await ok(k1ManagerA.post(`/v1/work-items/${id}/claim`));
  await take(k1ManagerA, id, "revise_c", { remarks: "Resubmit with 110 lm/W luminaires" });
}

// The items, made before the clock moves (it spoils an upload's signature).
let draftItem = "";
let withK1 = ""; // Submitted, claimed by K1 manager A.
let closedItem = ""; // Code C, no Revision.
let chainRoot = ""; // Code C, then Rev 1 in C1's Draft.
let revision = "";
let mechanical = "";
let c2Item = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id;
  trade.electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  trade.mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  loc.buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  loc.buildingB = await post("locations", { code: "BB", name: bilingual("Building B"), parentId: null });
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  const participant = async (role: "contractor" | "consultant") => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return { company, participantId };
  };
  c1Engineer = await projectMember(api, c1, own, ["engineer"]);
  c1Pm = await projectMember(api, c1, own, ["project_manager"]);
  const c2 = await participant("contractor");
  c2Engineer = await projectMember(api, c2.company, c2.participantId, ["engineer"]);
  const k1 = await participant("consultant");
  k1ParticipantId = k1.participantId;
  k1Engineer = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  // Named, so the test can tell that C1 never reads their name.
  const managerA = await api.inviteMember(k1.company.caller, { fullName: { en: "Hessa Al Otaibi", ar: "حصة العتيبي" } });
  k1ManagerA = await api.acceptInvitation(managerA.invitationToken);
  await api.addProjectMember(k1.company.caller, k1.participantId, managerA.id);
  await ok(k1.company.caller.request("PUT", `/v1/participants/${k1.participantId}/members/${managerA.id}/visibility`, { trade: all, location: all }));
  await ok(k1.company.caller.request("PUT", `/v1/participants/${k1.participantId}/members/${managerA.id}/positions`, { positions: ["manager"] }));
  k1ManagerB = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const stranger = await api.authorizedPerson();
  outsider = stranger.caller;

  draftItem = await draft("Fire alarm cables");
  mechanical = await draft("Chillers", { trade: trade.mechanical, location: loc.buildingB });
  withK1 = await draft("Cable trays");
  await submit(withK1);
  await ok(k1ManagerA.post(`/v1/work-items/${withK1}/claim`));
  closedItem = await draft("Busbars");
  await submit(closedItem);
  await codeC(closedItem);
  chainRoot = await draft("Fixtures");
  await submit(chainRoot);
  await codeC(chainRoot);
  revision = (await ok(c1Engineer.post(`/v1/work-items/${chainRoot}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;
  c2Item = (
    await ok(
      c2Engineer.post(`/v1/projects/${projectId}/work-items`, {
        type: "MAR",
        title: "C2 pumps",
        answers: { ...complete, trade: trade.mechanical, location: loc.buildingB },
      }),
      201,
    )
  ).json().id;
});

describe("columns and swimlanes (V14)", () => {
  it("has one column per Stage of the Module, in order, each counting the cards it holds", async () => {
    const b = await board(c1Engineer);
    const { first } = await listAll(c1Engineer);
    expect(b.stages).toEqual(first.stages);
    expectCountsAddUp(b);
    expect(cardOf(b, draftItem)?.stage.key).toBe("draft");
  });

  it("makes each of my own Company's Steps a lane", async () => {
    const b = await board(c1Engineer);
    expect(laneOf(b, draftItem)).toMatchObject({ kind: "step", step: { key: "draft" } });
    expect(laneOf(b, mechanical)).toBe(laneOf(b, draftItem));
    const theirs = await board(k1ManagerB);
    expect(laneOf(theirs, withK1)).toMatchObject({ kind: "step", step: { key: "consultant_review" } });
  });

  it("shows another Company's Steps as one lane with its name: no Step name or person", async () => {
    const theirs = await board(k1ManagerA);
    const k1Lane = laneOf(theirs, withK1);
    if (k1Lane?.kind !== "step") throw new Error("expected K1's own Step lane");
    const claimer = cardOf(theirs, withK1)!.with;
    if (claimer?.kind !== "own" || !claimer.claimer) throw new Error("expected K1's claimer");
    const k1Name = claimer.companyName.en;

    const mine = await board(c1Engineer);
    const lane = laneOf(mine, withK1)!;
    expect(lane).toMatchObject({ kind: "company", participantId: k1ParticipantId, companyName: expect.objectContaining({ en: k1Name }) });
    expect(Object.keys(lane).sort()).toEqual(["cards", "companyName", "count", "kind", "participantId"]);
    expect(cardOf(mine, withK1)!.with).toEqual({ kind: "company", companyName: expect.objectContaining({ en: k1Name }) });
    const json = JSON.stringify(mine);
    for (const secret of [claimer.claimer.name.en, claimer.claimer.name.ar, k1Lane.step.name.en, k1Lane.step.name.ar, "consultant_review"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("puts closed items, which nobody holds, in the closed lane", async () => {
    const b = await board(k1ManagerB);
    expect(laneOf(b, closedItem)).toMatchObject({ kind: "closed" });
  });
});

describe("one card per Revision chain, as in the List", () => {
  it("shows the raiser's Company its Rev 1, and K1 the original while Rev 1 is a Draft (V1)", async () => {
    const mine = cardIds(await board(c1Engineer));
    expect(mine).toContain(revision);
    expect(mine).not.toContain(chainRoot);
    const theirs = cardIds(await board(k1ManagerB));
    expect(theirs).toContain(chainRoot);
    expect(theirs).not.toContain(revision);
  });

  it('shows every Revision the viewer may see with "Show all Revisions"', async () => {
    expect(cardIds(await board(c1Engineer, { allRevisions: true }))).toEqual(expect.arrayContaining([chainRoot, revision]));
    expect(cardIds(await board(k1ManagerB, { allRevisions: true }))).not.toContain(revision);
  });
});

describe("filters apply to the board as to the List", () => {
  const queries: WorkItemQueryInput[] = [
    {},
    { allRevisions: true },
    { stage: ["draft"] },
    { trade: [trade.mechanical] },
    { location: [loc.buildingA] },
    { outcome: ["C"], allRevisions: true },
    { with: ["unclaimed"] },
    { with: ["step:draft"] },
    { needMyAction: true },
    { needMyAction: true, stage: ["pending_approval"] },
    { sort: "documentNumber" },
  ];

  for (const [i, query] of queries.entries()) {
    it(`shows the List's items, by Stage, for query ${i}`, async () => {
      for (const by of [c1Engineer, k1ManagerA, c2Engineer]) {
        const b = await board(by, query);
        const { first, items } = await listAll(by, query);
        const label = JSON.stringify(query);
        expect(b.stages, label).toEqual(first.stages);
        expectCountsAddUp(b, label);
        // Within the last 30 days, every item is on the board.
        expect(cardIds(b).sort(), label).toEqual(items.map((r) => r.id).sort());
        // Each card as its List row, in the List's order within a lane.
        for (const lane of b.columns.flatMap((c) => c.lanes)) {
          const order = items.map((r) => r.id).filter((id) => lane.cards.some((c) => c.id === id));
          expect(lane.cards.map((c) => c.id), label).toEqual(order);
          for (const c of lane.cards) expect(c, label).toEqual(items.find((r) => r.id === c.id));
        }
      }
    });
  }

  it("filters by who has it", async () => {
    expect(cardIds(await board(k1ManagerA, { with: ["me"] }))).toEqual([withK1]);
    expect(cardIds(await board(c1Engineer, { with: [`company:${k1ParticipantId}`] }))).toEqual([withK1]);
  });
});

describe("a second Contractor (V3, scenario 17)", () => {
  it("counts only C2's items, in every column and lane, whatever the filter", async () => {
    const queries: WorkItemQueryInput[] = [
      {},
      { allRevisions: true },
      { stage: ["pending_approval"] },
      { outcome: ["C"], allRevisions: true },
      { trade: [trade.electrical] },
      { with: ["unclaimed", "me", "step:consultant_review", `company:${k1ParticipantId}`] },
    ];
    for (const query of queries) {
      const b = await board(c2Engineer, query);
      const label = JSON.stringify(query);
      expectCountsAddUp(b, label);
      expect(cards(b).every((c) => c.id === c2Item), label).toBe(true);
      expect(b.stages.reduce((sum, s) => sum + s.count, 0), label).toBe(cards(b).length);
      expect(b.columns.flatMap((c) => c.lanes).every((l) => l.kind === "step"), label).toBe(true);
      expect(b.filters.with.companies, label).toEqual([]);
    }
    const b = await board(c2Engineer);
    expect(cardIds(b)).toEqual([c2Item]);
    expect(column(b, "draft").lanes).toEqual([expect.objectContaining({ kind: "step", count: 1 })]);
    expect(b.columns.filter((c) => c.stageKey !== "draft").every((c) => c.shown === 0 && c.lanes.length === 0)).toBe(true);
  });
});

describe("closed columns", () => {
  it(`hold the items closed in the last ${closedColumnDays} days only, the Stage count still counting all of them`, async () => {
    const before = await board(k1ManagerB);
    const closedStage = cardOf(before, closedItem)!.stage.key;
    const total = stage(before, closedStage).count;
    expect(column(before, closedStage).shown).toBe(total);

    await api.later((closedColumnDays - 1) * DAY);
    expect(cardIds(await board(k1ManagerB))).toContain(closedItem);

    await api.later(2 * DAY);
    const after = await board(k1ManagerB);
    expect(cardIds(after)).not.toContain(closedItem);
    expect(cardIds(after)).not.toContain(chainRoot);
    expect(column(after, closedStage).shown).toBe(0);
    expect(stage(after, closedStage).count).toBe(total);
    expectCountsAddUp(after);
    // Open items stay, however long they wait.
    expect(cardIds(after)).toContain(withK1);
    // The List behind "Show all" still has them.
    expect((await listAll(k1ManagerB, { stage: [closedStage] })).items.map((r) => r.id)).toEqual(expect.arrayContaining([closedItem, chainRoot]));
  });
});

describe("refusals", () => {
  it("answers a Member off the Project as if it didn't exist", async () => {
    await expectHidden(outsider.get(`/v1/projects/${projectId}/work-items/kanban`));
    await expectHidden(outsider.get(`/v1/projects/${projectId}/work-items/kanban?stage=draft`));
    await expectHidden(c1Engineer.get(`/v1/projects/${randomUUID()}/work-items/kanban`));
  });

  it("refuses a filter that isn't one", async () => {
    for (const bad of ["stepAgeMin=9", "with=someone", "sort=title", "trade=not-an-id"]) {
      expect((await c1Engineer.get(`/v1/projects/${projectId}/work-items/kanban?${bad}`)).statusCode, bad).toBe(400);
    }
  });
});
