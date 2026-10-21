// Seam 1 for Informed Participants (RP-625, SNAG-3; spec RP-619; workflow-engine.md §5.1;
// visibility.md layers 3 and 4, V2, V5, V14, V19 and scenarios RP-625-1 to RP-625-4).
//
// The Snag's Version 3 (apps/admin/workflows/SNG.json): its Raise informs the Consultant. C1
// raises a Snag on itself and holds every Step; K1, the Consultant covering it, reads it from
// the Raise as any Participant without the Step: its shared moves only, Open while C1 works it,
// aged from the Raise. It is offered nothing, a Transition it tries is refused, and Need My
// Action never counts it. C2, another Contractor, never reads it.
import type { DocumentList, WorkItemHistory, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, memberOnProject, ok, only, projectMember, take, tryTake, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let c2Engineer: Caller; // Another Contractor of the same Trade, covering Building B only (V3).
let buildingB = ""; // Covered by C2 and K2, with C1 and K1.
let buildingC = ""; // Covered by C1, K1 and K2; not by C2.
// K2: another Consultant, covering Buildings B and C only (RP-625-2, RP-625-3).
let k2: Company;
let k2Participant = "";
let k2Engineer: { id: string; caller: Caller };

const snags = async (by: Caller): Promise<WorkItemList> => (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items`), 200)).json();
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
/** The Transitions of item `id`'s history `by` reads, by their English label. */
const moves = async (by: Caller, id: string) => (await history(by, id)).flatMap((e) => (e.transition ? [e.transition.en] : []));
/** Need My Action as the Projects page counts it for `by`. */
const needMyAction = async (by: Caller): Promise<number> => (await ok(by.get(`/v1/projects/${at.projectId}`), 200)).json().needMyAction;

/** C1's PM's Draft Snag on `location` (Building A by default), Electrical. */
async function draftByC1(title: string, location = at.buildingA): Promise<string> {
  const answers = { description: `${title}: see the photos`, trade: at.electrical, location };
  return (await ok(at.c1Pm.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title, answers }), 201)).json().id as string;
}

/** C1's PM's Snag on `location` (Building A by default), Electrical, raised: Open, held by C1's PM. */
async function raisedByC1(title: string, location = at.buildingA): Promise<string> {
  const id = await draftByC1(title, location);
  await expectHidden(at.k1Manager.get(`/v1/work-items/${id}`), "a Draft");
  await move(id, "raise");
  return id;
}

/** Item `id`'s Documents as `by` reads them: id and whether frozen. */
const documents = async (by: Caller, id: string) =>
  ((await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json() as DocumentList).documents.map((d) => ({ id: d.id, frozen: d.frozen }));

/** C1's PM takes `transition` on `id` and holds the Step it leads to. */
async function move(id: string, transition: string, answers?: Record<string, unknown>) {
  await take(at.c1Pm, id, transition, answers ? { answers } : {});
  if ((await detail(at.c1Pm, id)).actions.pickUp) await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
}

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "INF");
  const location = async (code: string, name: string) =>
    (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code, name: bilingual(name), parentId: null }), 201)).json().id as string;
  buildingB = await location("BB", "Building B");
  buildingC = await location("BC", "Building C");
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  k2 = await api.authorizedPerson();
  k2Participant = await api.addParticipant(c1.caller, at.projectId, k2.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k2Participant}/visibility`, { trade: all, location: only(buildingB, buildingC) }));
  k2Engineer = await memberOnProject(api, k2, k2Participant, ["engineer"]);
});

describe("a Contractor's raised Snag informs the Consultant (seam 1)", () => {
  it("K1 reads it from the Raise, with its shared history only, and is offered nothing", async () => {
    const id = await raisedByC1("Exposed rebar");
    const read = await detail(at.k1Manager, id);
    expect(read.title).toBe("Exposed rebar");
    expect(read.stage.key).toBe("open");
    expect(read.actions.transitions).toEqual([]);
    expect(read.actions.pickUp).toBeFalsy();
    expect((await snags(at.k1Manager)).items.map((i) => i.id)).toContain(id);
    expect(await moves(at.k1Manager, id)).toEqual(["Raise"]);

    // C1's moves inside it stay its own (V5): K1 reads Open, aged from the Raise.
    await move(id, "start_work");
    await move(id, "put_on_hold_in_progress");
    expect((await detail(at.c1Pm, id)).stage.key).toBe("on_hold");
    const meanwhile = await detail(at.k1Manager, id);
    expect(meanwhile.stage.key).toBe("open");
    expect(meanwhile.stepEnteredAt).toBe(read.stepEnteredAt);
    expect(await moves(at.k1Manager, id)).toEqual(["Raise"]);
    expect((await moves(at.c1Pm, id)).length).toBeGreaterThan(1);
  });

  it("refuses a Transition K1 tries (409), and Need My Action never counts it", async () => {
    const before = await needMyAction(at.k1Manager);
    const id = await raisedByC1("Missing fire stopping");
    expect(await needMyAction(at.k1Manager)).toBe(before);
    const refused = await tryTake(at.k1Manager, id, "resolve", { answers: { resolution_note: "Not K1's to resolve" } });
    expect(refused.statusCode, refused.body).toBe(409);
    const list = (await ok(at.k1Manager.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items?needMyAction=true`), 200)).json() as WorkItemList;
    expect(list.items.map((i) => i.id)).not.toContain(id);
  });

  it("Step Age as K1 reads it counts from the Raise: its Stage moves on with C1's Resolve, never with its internal moves", async () => {
    const id = await raisedByC1("Loose cable ties");
    const raised = await detail(at.k1Manager, id);
    expect(raised.stepEnteredAt).toBe((await detail(at.c1Pm, id)).stepEnteredAt);
    await move(id, "start_work");
    await move(id, "resolve_in_progress", { resolution_note: "Tied" });
    const resolved = await detail(at.k1Manager, id);
    expect(resolved.stage.key).toBe("resolved");
    expect(Date.parse(resolved.stepEnteredAt!)).toBeGreaterThan(Date.parse(raised.stepEnteredAt!));
    expect(await moves(at.k1Manager, id)).toEqual(["Raise", "Resolve"]);
    expect(resolved.actions.transitions).toEqual([]);
    await take(at.c1Pm, id, "close");
    expect((await detail(at.k1Manager, id)).outcome).toBe("closed");
  });

  it("C2 never reads it, at any Step", async () => {
    const id = await raisedByC1("C1's own fault");
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}`));
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/history`));
    expect((await snags(c2Engineer)).items.map((i) => i.id)).not.toContain(id);
  });
});

describe("what an informed Consultant reads (scenarios RP-625-1 to RP-625-3)", () => {
  it("RP-625-1: K1 reads the Snag's Documents as they left C1 at the Raise: the Draft's photo, frozen, and nothing added after", async () => {
    const id = await draftByC1("Cracked tile");
    const before = await uploadDocument(at.c1Pm, id, { fieldKey: "photos", fileName: "before.jpg", contentType: "image/jpeg", body: jpegWithExif() });
    await expectHidden(at.k1Manager.get(`/v1/work-items/${id}/documents`), "a Draft");

    await move(id, "raise");
    expect(await documents(at.k1Manager, id)).toEqual([{ id: before, frozen: true }]);
    // Nobody adds to them once they have reached another Company (ADR 0020).
    const late = await at.c1Pm.post(`/v1/work-items/${id}/documents`, { fieldKey: "photos", fileName: "late.jpg", contentType: "image/jpeg", sizeBytes: 10 });
    expect({ status: late.statusCode, body: late.json() }).toEqual({ status: 409, body: { error: "not_editable" } });
    // Positive control: before the Raise, C1 added the photo through the same call.
    expect((await documents(at.c1Pm, id)).map((d) => d.id)).toEqual([before]);
    await move(id, "start_work");
    expect(await documents(at.k1Manager, id)).toEqual([{ id: before, frozen: true }]);
    expect(await documents(at.c1Pm, id)).toEqual([{ id: before, frozen: true }]);
  });

  it("RP-625-2: only Consultants covering the Snag are informed: K2 (Buildings B and C) not of one on Building A, both K1 and K2 of one on Building C", async () => {
    const onA = await raisedByC1("Loose cable on A");
    expect((await detail(at.k1Manager, onA)).id).toBe(onA);
    await expectHidden(k2Engineer.caller.get(`/v1/work-items/${onA}`));
    await expectHidden(k2Engineer.caller.get(`/v1/work-items/${onA}/history`));
    expect((await snags(k2Engineer.caller)).items.map((i) => i.id)).not.toContain(onA);

    const onC = await raisedByC1("Loose cable on C", buildingC);
    for (const consultant of [at.k1Manager, k2Engineer.caller]) {
      expect((await detail(consultant, onC)).stage.key).toBe("open");
      expect(await moves(consultant, onC)).toEqual(["Raise"]);
      expect((await snags(consultant)).items.map((i) => i.id)).toContain(onC);
    }
  });

  it("RP-625-3: narrowing K2's engineer off Building C hides the Snag there at once; widened again, it is read again", async () => {
    const id = await raisedByC1("Missing label on C", buildingC);
    const memberCovers = (location: typeof all) =>
      ok(k2.caller.request("PUT", `/v1/participants/${k2Participant}/members/${k2Engineer.id}/visibility`, { trade: all, location }));
    expect((await detail(k2Engineer.caller, id)).id).toBe(id);
    await memberCovers(only(buildingB));
    try {
      await expectHidden(k2Engineer.caller.get(`/v1/work-items/${id}`));
      await expectHidden(k2Engineer.caller.get(`/v1/work-items/${id}/history`));
      const list = await snags(k2Engineer.caller);
      expect(list.items.map((i) => i.id)).not.toContain(id);
      expect(JSON.stringify(list)).not.toContain(id);
      // K1 still reads it.
      expect((await detail(at.k1Manager, id)).id).toBe(id);
    } finally {
      await memberCovers(all);
    }
    // Its `informed` access was never taken away.
    expect((await detail(k2Engineer.caller, id)).stage.key).toBe("open");
    expect((await snags(k2Engineer.caller)).items.map((i) => i.id)).toContain(id);
  });
});
