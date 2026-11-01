// Seam 1 for scenario RP-431-2 (docs/visibility/scenarios/RP-431.md; spec RP-423;
// workflow-engine.md §3.3, §5.1; visibility.md V14). "Assign to" offers the Members of the
// taker's own Participant who may hold the next Step: C1's engineer is offered C1's PMs only,
// never K1's Members or a C1 Member without the Position; C1's PM is offered nobody, since K1
// holds the next Step. A pick it couldn't have offered (a K1 Member, a C1 Member who can't hold
// the Step, a made-up id) is refused with one answer, and nothing moves (seam 2:
// transition-actions-rls.test.ts).
//
// The Type is test-only, on the test Workflow with actions (addActionsType).
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addActionsType } from "./support/rules.ts";
import { all, bilingual, detail, memberOnProject, ok, take, tryTake } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "VISACT";

type Person = { id: string; caller: Caller };
let engineer: Person; // C1 engineer: raises and sends for review.
let pm: Person; // C1 PMs: hold Contractor review.
let pm2: Person;
let noPosition: Person; // A C1 Member on the Project with no Position: can't hold Contractor review.
let k1Engineer: Person;
let k1Manager: Person;
let projectId = "";
let electrical = "";
let buildingA = "";

async function newDraft(model: string): Promise<string> {
  const res = await ok(engineer.caller.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: electrical, location: buildingA } }), 201);
  return res.json().id as string;
}

const pickUp = (by: Person, id: string) => ok(by.caller.post(`/v1/work-items/${id}/pick-up`));
const transitionOf = async (by: Person, id: string, key: string) => (await detail(by.caller, id)).actions.transitions.find((t) => t.key === key);
/** The Members `by`'s pop-up for `key` on `id` offers in "Assign to", by id. */
const offeredIds = async (by: Person, id: string, key: string) => ((await transitionOf(by, id, key))?.assignTo ?? []).map((m) => ({ id: m.memberId }));
const history = async (by: Person, id: string): Promise<WorkItemHistory["events"]> => (await ok(by.caller.get(`/v1/work-items/${id}/history`), 200)).json().events;

beforeAll(async () => {
  await addActionsType(migrator, TYPE);
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })).json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await memberOnProject(api, c1, own, ["engineer"], { name: "Engineer" });
  pm = await memberOnProject(api, c1, own, ["project_manager"], { name: "Amal" });
  pm2 = await memberOnProject(api, c1, own, ["project_manager"], { name: "Badr" });
  noPosition = await memberOnProject(api, c1, own, [], { name: "Nasser" });
  const k1 = await api.authorizedPerson();
  const k1Participant = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  k1Engineer = await memberOnProject(api, k1, k1Participant, ["engineer"]);
  k1Manager = await memberOnProject(api, k1, k1Participant, ["manager"]);
});

describe('RP-431-2: "Assign to" offers the taker\'s own Members only (seam 1)', () => {
  it("offers C1's engineer C1's PMs only, and C1's PM nobody (K1 holds the next Step); K1's manager is offered to K1's engineer alone", async () => {
    const id = await newDraft("Offered");
    expect((await offeredIds(engineer, id, "send_for_review")).map((m) => m.id).sort()).toEqual([pm.id, pm2.id].sort());

    await take(engineer.caller, id, "send_for_review");
    await pickUp(pm, id);
    const submit = await transitionOf(pm, id, "submit");
    expect(submit).toBeDefined();
    expect(submit).not.toHaveProperty("assignTo");

    // K1's manager is offered in K1's own pop-up, from K1's own Step, and never in C1's.
    const atK1 = await newDraft("At K1");
    await take(engineer.caller, atK1, "send_for_review");
    await pickUp(pm2, atK1);
    await take(pm2.caller, atK1, "submit");
    await pickUp(k1Engineer, atK1);
    type Pop = { who: string; offers: () => Promise<{ id: string }[]> };
    const k1Send: Pop = { who: "K1 engineer's Send to Manager", offers: () => offeredIds(k1Engineer, atK1, "send_to_manager") };
    const c1Send: Pop = { who: "C1 engineer's Send for Review", offers: async () => offeredIds(engineer, await newDraft("Another"), "send_for_review") };
    const c1Submit: Pop = { who: "C1 PM's Submit", offers: () => offeredIds(pm, id, "submit") };
    await expectHiddenFrom({ read: (pop: Pop) => pop.offers(), target: k1Manager.id, seenBy: k1Send, hiddenFrom: [c1Send, c1Submit], name: (pop) => pop.who, label: "K1's manager in Assign to" });
    // Nor a C1 Member without the Position, whom no pop-up offers: C1's engineer's offer is the two PMs exactly (above).
  });

  it("refuses a K1 Member, a C1 Member who can't hold the Step or a made-up id with one answer, and moves nothing", async () => {
    const id = await newDraft("Wrong pick");
    const before = await history(engineer, id);
    const bodies = [];
    for (const pick of [k1Manager.id, k1Engineer.id, noPosition.id, engineer.id, randomUUID()]) {
      const res = await tryTake(engineer.caller, id, "send_for_review", { assignTo: pick });
      bodies.push({ status: res.statusCode, body: res.json() });
    }
    expect(bodies).toEqual(Array(5).fill({ status: 422, body: { error: "assignee_not_offered" } }));
    expect((await detail(engineer.caller, id)).step?.key).toBe("draft");
    expect(await history(engineer, id)).toEqual(before);

    // At Submit, whose next Step is K1's, any pick is refused alike.
    await take(engineer.caller, id, "send_for_review");
    await pickUp(pm, id);
    const atReview = await history(pm, id);
    const picks = [];
    for (const pick of [k1Manager.id, pm2.id, randomUUID()]) {
      const res = await tryTake(pm.caller, id, "submit", { assignTo: pick });
      picks.push({ status: res.statusCode, body: res.json() });
    }
    expect(picks).toEqual(Array(3).fill({ status: 422, body: { error: "assignee_not_offered" } }));
    expect((await detail(pm.caller, id)).step?.key).toBe("internal_review");
    expect(await history(pm, id)).toEqual(atReview);
  });
});
