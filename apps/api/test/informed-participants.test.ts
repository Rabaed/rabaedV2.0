// Seam 1 for Informed Participants (RP-625, SNAG-3; spec RP-619; workflow-engine.md §5.1;
// visibility.md layer 3, V2, V5, V14 and scenarios RP-625-1 to RP-625-4).
//
// The Snag's Version 3 (apps/admin/workflows/SNG.json): its Raise informs the Consultant. C1
// raises a Snag on itself and holds every Step; K1, the Consultant covering it, reads it from
// the Raise as any Participant without the Step: its shared moves only, Open while C1 works it,
// aged from the Raise. It is offered nothing, a Transition it tries is refused, and Need My
// Action never counts it. C2, another Contractor, never reads it.
import type { WorkItemHistory, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, only, projectMember, take, tryTake, type Tower } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

let at: Tower;
let c2Engineer: Caller; // Another Contractor of the same Trade, covering Building B only (V3).

const snags = async (by: Caller): Promise<WorkItemList> => (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items`), 200)).json();
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
/** The Transitions of item `id`'s history `by` reads, by their English label. */
const moves = async (by: Caller, id: string) => (await history(by, id)).flatMap((e) => (e.transition ? [e.transition.en] : []));
/** Need My Action as the Projects page counts it for `by`. */
const needMyAction = async (by: Caller): Promise<number> => (await ok(by.get(`/v1/projects/${at.projectId}`), 200)).json().needMyAction;

/** C1's PM's Snag on Building A, Electrical, raised: Open, held by C1's PM. */
async function raisedByC1(title: string): Promise<string> {
  const answers = { description: `${title}: see the photos`, trade: at.electrical, location: at.buildingA };
  const id = (await ok(at.c1Pm.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title, answers }), 201)).json().id as string;
  await expectHidden(at.k1Manager.get(`/v1/work-items/${id}`), "a Draft");
  await move(id, "raise");
  return id;
}

/** C1's PM takes `transition` on `id` and holds the Step it leads to. */
async function move(id: string, transition: string, answers?: Record<string, unknown>) {
  await take(at.c1Pm, id, transition, answers ? { answers } : {});
  if ((await detail(at.c1Pm, id)).actions.pickUp) await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
}

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "INF");
  const buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
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
