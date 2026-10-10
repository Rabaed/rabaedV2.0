// Seam 1 for the work item query and the List (RP-345, spec RP-344;
// visibility.md V1, V3, V14, the Dashboard and Revisions channels, scenarios 17
// and 70). One row per Revision chain, the latest Revision the viewer sees, or
// every visible Revision; every filter and both sorts, combined; cursor paging
// with Stage counts from the same filtered, visible items; and "With" as V14
// has it: the Step and who picked it up inside the holding Company, its name only
// for everyone else.
import { randomUUID } from "node:crypto";
import { encodeWorkItemCursor, isOpenStageCategory, workItemSearchParams, type WorkItemList, type WorkItemQueryInput, type WorkItemRow } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

const WEEK = 7 * 86_400_000;

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
const loc = { tower1: "", buildingA: "", buildingB: "" };

const complete = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};

/** One page of the List as `by` reads it with `query`. */
async function list(by: Caller, query: WorkItemQueryInput = {}, project = projectId): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${project}/work-items?${workItemSearchParams(query)}`), 200)).json();
}

const ids = (l: WorkItemList) => l.items.map((i) => i.id);
const row = (l: WorkItemList, id: string): WorkItemRow | undefined => l.items.find((i) => i.id === id);
const total = (l: WorkItemList) => l.stages.reduce((sum, s) => sum + s.count, 0);

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
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit");
}

/** K1 verifies the submitted item and issues Code C. */
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
  await ok(k1ManagerA.post(`/v1/work-items/${id}/pick-up`));
  await take(k1ManagerA, id, "revise_c", { remarks: "Resubmit with 110 lm/W luminaires" });
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id;
  trade.electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  trade.mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  loc.tower1 = await post("locations", { code: "T1", name: bilingual("Tower 1"), parentId: null });
  loc.buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: loc.tower1 });
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
  k1ManagerA = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  k1ManagerB = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const stranger = await api.authorizedPerson();
  outsider = stranger.caller;
});

// First, on a Project of its own: the later tests move the clock, which spoils an upload's signature.
describe("cursor paging", () => {
  let pagingProject = "";
  let engineer: Caller;
  const created: string[] = [];
  beforeAll(async () => {
    pagingProject = (await api.createProject(c1.caller)).id;
    const tradeId = (await ok(c1.caller.post(`/v1/projects/${pagingProject}/trades`, { code: "EL", name: bilingual("Electrical") }), 201)).json().id;
    const locationId = (
      await ok(c1.caller.post(`/v1/projects/${pagingProject}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }), 201)
    ).json().id;
    const own = (await c1.caller.get(`/v1/projects/${pagingProject}/participants`))
      .json()
      .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
    await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
    engineer = await projectMember(api, c1, own, ["engineer"]);
    await projectMember(api, c1, own, ["project_manager"]); // holds the internal review
    for (let i = 0; i < 53; i++) {
      const answers = i < 3 ? { ...complete, trade: tradeId, location: locationId } : { trade: tradeId };
      const res = await ok(engineer.post(`/v1/projects/${pagingProject}/work-items`, { type: "MAR", title: `Item ${i}`, answers }), 201);
      created.push(res.json().id);
    }
    // A few leave Draft, so they get a Document Number; the rest have none yet, and
    // many share a Step entry time, so the id breaks the tie.
    for (const id of created.slice(0, 3)) {
      await attachDatasheet(engineer, id);
      await take(engineer, id, "send_for_review");
    }
  });

  for (const sort of ["stepAge", "documentNumber"] as const) {
    it(`returns 50 rows a page, with no duplicates or gaps (${sort})`, async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await list(engineer, { sort, ...(cursor ? { cursor } : {}) }, pagingProject);
        expect(total(page)).toBe(53);
        seen.push(...ids(page));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
        expect(page.items.length).toBe(cursor ? 50 : 3);
      } while (cursor);
      expect(pages).toBe(2);
      expect(new Set(seen).size).toBe(53);
      expect([...seen].sort()).toEqual([...created].sort());
    });
  }

  it("keeps the filters across pages", async () => {
    const first = await list(engineer, { stage: ["draft"] }, pagingProject);
    expect(total(first)).toBe(50);
    expect(first.nextCursor).toBeNull();
    expect(first.items.every((i) => i.stage.key === "draft")).toBe(true);
  });
});

describe("one row per Revision chain", () => {
  let original = "";
  let revision = "";
  beforeAll(async () => {
    original = await draft("Fixtures");
    await submit(original);
    await codeC(original);
    revision = (await ok(c1Engineer.post(`/v1/work-items/${original}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;
  });

  it("shows the raiser's Company its open Rev 1, and everyone else the original while Rev 1 is a Draft (V1)", async () => {
    const mine = await list(c1Engineer);
    expect(ids(mine)).toContain(revision);
    expect(ids(mine)).not.toContain(original);
    expect(row(mine, revision)).toMatchObject({ revisionNo: 1, stage: { key: "draft" }, outcome: null });
    const theirs = await list(k1ManagerB);
    expect(ids(theirs)).toContain(original);
    expect(ids(theirs)).not.toContain(revision);
    expect(row(theirs, original)).toMatchObject({ revisionNo: 0, outcome: "C", with: null });
  });

  it('lists every Revision the viewer may see with "Show all Revisions"', async () => {
    expect(ids(await list(c1Engineer, { allRevisions: true }))).toEqual(expect.arrayContaining([original, revision]));
    const theirs = ids(await list(k1ManagerB, { allRevisions: true }));
    expect(theirs).toContain(original);
    expect(theirs).not.toContain(revision);
  });

  it("moves K1 to Rev 1 once it is Submitted", async () => {
    await submit(revision);
    const theirs = await list(k1ManagerB);
    expect(ids(theirs)).toContain(revision);
    expect(ids(theirs)).not.toContain(original);
  });
});

describe('"With" (V14, scenario 70)', () => {
  let item = "";
  let k1Name = "";
  beforeAll(async () => {
    item = await draft("Cable trays");
    await submit(item);
  });

  it("shows the holding Company's own Members the Step, notPickedUp, and everyone else the Company's name only", async () => {
    const theirs = row(await list(k1ManagerA), item)!;
    expect(theirs.with).toMatchObject({ kind: "own", step: { key: "consultant_review" }, holder: null });
    const mine = row(await list(c1Engineer), item)!;
    expect(mine.with).toEqual({ kind: "company", companyName: expect.any(Object) });
    k1Name = theirs.with!.companyName.en;
    expect(mine.with!.companyName.en).toBe(k1Name);
  });

  it("names the holder to their own Company only, once one picks it up", async () => {
    await ok(k1ManagerA.post(`/v1/work-items/${item}/pick-up`));
    const holder = row(await list(k1ManagerA), item)!.with;
    expect(holder).toMatchObject({ kind: "own", holder: { isMe: true } });
    const colleague = row(await list(k1ManagerB), item)!.with;
    expect(colleague).toMatchObject({ kind: "own", holder: { isMe: false } });
    if (holder?.kind !== "own" || !holder.holder) throw new Error("expected K1's holder");
    const name = holder.holder.name;
    expect(colleague).toMatchObject({ holder: { name } });

    const c1List = await list(c1Engineer);
    expect(row(c1List, item)!.with).toEqual({ kind: "company", companyName: expect.objectContaining({ en: k1Name }) });
    expect(JSON.stringify(c1List)).not.toContain(name.en);
    expect(JSON.stringify(await list(c1Engineer, { with: [`company:${k1ParticipantId}`] }))).not.toContain(name.en);
  });

  it("filters by who has it: me, notPickedUp, a Step of my own, another Company", async () => {
    expect(ids(await list(k1ManagerA, { with: ["me"] }))).toContain(item);
    expect(ids(await list(k1ManagerB, { with: ["me"] }))).not.toContain(item);
    expect(ids(await list(k1ManagerB, { with: ["not_picked_up"] }))).not.toContain(item);
    expect(ids(await list(k1ManagerB, { with: ["step:consultant_review"] }))).toContain(item);
    const c1List = await list(c1Engineer, { with: [`company:${k1ParticipantId}`] });
    expect(ids(c1List)).toContain(item);
    // C1 doesn't see K1's Step as a Step of its own.
    expect(ids(await list(c1Engineer, { with: ["step:consultant_review"] }))).not.toContain(item);
  });

  it("offers the With values of the viewer's own visible items only", async () => {
    const { filters } = await list(c1Engineer);
    expect(filters.with.companies).toEqual([{ participantId: k1ParticipantId, name: expect.objectContaining({ en: k1Name }) }]);
    expect(filters.with.steps.map((s) => s.key)).not.toContain("consultant_review");
    expect((await list(k1ManagerB)).filters.with.steps.map((s) => s.key)).toContain("consultant_review");
  });
});

describe("filters and sorts, combined", () => {
  let mechanicalInB = "";
  let electricalInA = "";
  let submittedOld = "";
  beforeAll(async () => {
    mechanicalInB = await draft("Chillers", { trade: trade.mechanical, location: loc.buildingB });
    electricalInA = await draft("Switchboards");
    submittedOld = await draft("Busbars");
    await submit(submittedOld);
    await api.later(2 * WEEK + 86_400_000);
  });

  it("filters by Type, Stage, Trade and Location, a Location taking in the ones under it", async () => {
    expect(ids(await list(c1Engineer, { type: ["MAR"] }))).toEqual(expect.arrayContaining([mechanicalInB, electricalInA]));
    expect(ids(await list(c1Engineer, { type: ["SAR"] }))).toEqual([]);
    expect(ids(await list(c1Engineer, { trade: [trade.mechanical] }))).toEqual([mechanicalInB]);
    const inTower = ids(await list(c1Engineer, { location: [loc.tower1] }));
    expect(inTower).toContain(electricalInA);
    expect(inTower).not.toContain(mechanicalInB);
    const draftsInA = ids(await list(c1Engineer, { stage: ["draft"], location: [loc.buildingA] }));
    expect(draftsInA).toContain(electricalInA);
    expect(draftsInA).not.toContain(submittedOld);
    expect(draftsInA).not.toContain(mechanicalInB);
  });

  it("filters by Review Code", async () => {
    // The Code C original is no longer the latest of its chain: Rev 1 is.
    expect(ids(await list(k1ManagerB, { outcome: ["C"] }))).toEqual([]);
    const coded = await list(k1ManagerB, { outcome: ["C"], allRevisions: true });
    expect(coded.items.length).toBeGreaterThan(0);
    expect(coded.items.every((i) => i.outcome === "C")).toBe(true);
  });

  it("filters by Step Age: open items only, at least that many weeks at their Step", async () => {
    const aged = await list(c1Engineer, { stepAgeMin: 3 });
    // A Draft with no number has no Step Age, so no Step Age filter matches it (nobody sees when it was started).
    expect(ids(aged)).toContain(submittedOld);
    expect(ids(aged)).not.toContain(mechanicalInB);
    expect(ids(aged)).not.toContain(electricalInA);
    expect(aged.items.every((i) => (i.stepAgeWeeks === null || i.stepAgeWeeks >= 3) && ["draft", "in_progress"].includes(i.stage.category))).toBe(true);
    // A new Draft, without its datasheet: the moved clock spoils an upload's signature.
    const fresh = (
      await ok(
        c1Engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Lighting poles", answers: { trade: trade.electrical } }),
        201,
      )
    ).json().id;
    expect(ids(await list(c1Engineer, { stepAgeMin: 2 }))).not.toContain(fresh);
    expect(ids(await list(c1Engineer, { stepAgeMin: 2, trade: [trade.mechanical] }))).toEqual([]);
  });

  it("sorts by Step Age, the oldest first, closed items (which don't age) last", async () => {
    const { items } = await list(c1Engineer, { allRevisions: true });
    const open = items.filter((i) => isOpenStageCategory(i.stage.category));
    expect(open.length).toBeGreaterThan(0);
    expect(open.length).toBeLessThan(items.length);
    expect(items.slice(0, open.length)).toEqual(open);
    // A Draft with no number shows no Step Age (nor when it was started), so it has none to compare.
    const ages = open.flatMap((i) => (i.stepEnteredAt === null ? [] : [i.stepEnteredAt]));
    expect(ages).toEqual([...ages].sort());
    // Those with no Step Age come last of the open ones.
    const firstWithout = open.findIndex((i) => i.stepEnteredAt === null);
    expect(firstWithout).toBeGreaterThanOrEqual(0);
    expect(open.slice(firstWithout).every((i) => i.stepEnteredAt === null)).toBe(true);
  });

  it("sorts by Document Number, items with no number yet last", async () => {
    const numbers = (await list(c1Engineer, { sort: "documentNumber" })).items.map((i) => i.documentNumber);
    const numbered = numbers.filter((n): n is string => n !== null);
    expect(numbered.length).toBeGreaterThan(0);
    expect(numbers).toEqual([...[...numbered].sort(), ...numbers.filter((n) => n === null)]);
  });

  it("counts each Stage from the filtered rows", async () => {
    const drafts = await list(c1Engineer, { stage: ["draft"] });
    expect(total(drafts)).toBe(drafts.items.length);
    expect(drafts.stages.filter((s) => s.key !== "draft").every((s) => s.count === 0)).toBe(true);
  });
});

describe("a second Contractor (V3, scenario 17)", () => {
  let c2Item = "";
  beforeAll(async () => {
    const res = await ok(
      c2Engineer.post(`/v1/projects/${projectId}/work-items`, {
        type: "MAR",
        title: "C2 pumps",
        answers: { ...complete, trade: trade.mechanical, location: loc.buildingB },
      }),
      201,
    );
    c2Item = res.json().id;
  });

  it("never sees a C1 row, count or With value, whatever the filter", async () => {
    const queries: WorkItemQueryInput[] = [
      {},
      { allRevisions: true },
      { stage: ["draft"] },
      { stage: ["pending_approval"] },
      { outcome: ["C"] },
      { trade: [trade.electrical] },
      { location: [loc.tower1] },
      { with: ["not_picked_up", "me", "step:consultant_review", `company:${k1ParticipantId}`] },
      { stepAgeMin: 2 },
      { sort: "documentNumber", allRevisions: true },
    ];
    for (const query of queries) {
      const l = await list(c2Engineer, query);
      expect(l.items.every((i) => i.id === c2Item), JSON.stringify(query)).toBe(true);
      expect(total(l), JSON.stringify(query)).toBe(l.items.length);
      expect(l.filters.with.companies).toEqual([]);
    }
    expect(ids(await list(c2Engineer))).toEqual([c2Item]);
  });
});

describe("refusals", () => {
  it("answers a Member off the Project as if it didn't exist", async () => {
    await expectHidden(outsider.get(`/v1/projects/${projectId}/work-items`));
    await expectHidden(outsider.get(`/v1/projects/${projectId}/work-items?stage=draft`));
  });

  it("refuses a filter or cursor that isn't one", async () => {
    const tampered = encodeWorkItemCursor("stepAge", ["false", "not a time", "", randomUUID()]);
    for (const bad of ["stepAgeMin=9", "with=someone", "sort=title", "cursor=garbage", `cursor=${tampered}`, "trade=not-an-id"]) {
      expect((await c1Engineer.get(`/v1/projects/${projectId}/work-items?${bad}`)).statusCode, bad).toBe(400);
    }
  });
});
