// Seam 1 for Transition actions at run time (RP-431, WF-8; spec RP-423;
// workflow-engine.md §3.3, §5.1). "Assign to": the pop-up offers the Members of
// the taker's own Participant who may hold the next Step, never another Company's;
// the item lands with the one picked (their Need My Action), and a pick it
// couldn't have offered is refused alike. Set and copy write only fields the
// acting Participant fills at that Step, recorded like any answer change; an
// action outside them is refused alike (seam 2: transition-actions-rls.test.ts).
//
// The Type is test-only, on the test Workflow with actions (addActionsType).
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type WorkItemList } from "@rabaed/domain";
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

const TYPE = "ACTED";

type Person = { id: string; caller: Caller };
let engineer: Person; // C1 engineer: raises the items.
let pm: Person; // C1 PMs: hold Contractor review.
let pm2: Person;
let k1Engineer: Person;
let k1Manager: Person;
let projectId = "";
let electrical = "";
let buildingA = "";

async function newDraft(model: string): Promise<string> {
  const res = await ok(
    engineer.caller.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: electrical, location: buildingA } }),
    201,
  );
  return res.json().id as string;
}

const pickUp = (by: Caller, id: string) => ok(by.post(`/v1/work-items/${id}/pick-up`));
const transitionOf = async (by: Caller, id: string, key: string) => (await detail(by, id)).actions.transitions.find((t) => t.key === key);
const needMyAction = async (by: Caller) =>
  ((await ok(by.get(`/v1/projects/${projectId}/work-items?${workItemSearchParams({ needMyAction: true })}`), 200)).json() as WorkItemList).items.map(
    (i) => i.id,
  );
const history = async (by: Caller, id: string) =>
  ((await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events as { type: string }[]).map((e) => e.type);

/** Today's date in Riyadh, as a `date` field stores it. */
const riyadhToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

beforeAll(async () => {
  await addActionsType(migrator, TYPE);
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await memberOnProject(api, c1, own, ["engineer"], { name: "Engineer" });
  pm = await memberOnProject(api, c1, own, ["project_manager"], { name: "Amal" });
  pm2 = await memberOnProject(api, c1, own, ["project_manager"], { name: "Badr" });
  const k1 = await api.authorizedPerson();
  const k1Participant = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  k1Engineer = await memberOnProject(api, k1, k1Participant, ["engineer"]);
  k1Manager = await memberOnProject(api, k1, k1Participant, ["manager"]);
});

describe('"Assign to"', () => {
  it("offers the taker's own Members who may hold the next Step, by name, and lands the item with the one picked", async () => {
    const id = await newDraft("Assigned");
    const send = await transitionOf(engineer.caller, id, "send_for_review");
    expect(send?.assignTo).toEqual([
      { memberId: pm.id, name: bilingual("Amal") },
      { memberId: pm2.id, name: bilingual("Badr") },
    ]);
    await take(engineer.caller, id, "send_for_review", { assignTo: pm2.id });
    expect(await needMyAction(pm2.caller)).toContain(id);
    expect(await needMyAction(pm.caller)).not.toContain(id);
    // Theirs already: Submit is offered without a Pick up, and offers nobody (K1 holds the next Step).
    const submit = await transitionOf(pm2.caller, id, "submit");
    expect(submit).toBeDefined();
    expect(submit).not.toHaveProperty("assignTo");
    await take(pm2.caller, id, "submit");
  });

  it("refuses a pick it couldn't have offered with one answer, whoever it names, and moves nothing", async () => {
    const id = await newDraft("Wrong pick");
    const bodies = [];
    for (const pick of [k1Manager.id, engineer.id, randomUUID()]) {
      const res = await tryTake(engineer.caller, id, "send_for_review", { assignTo: pick });
      expect(res.statusCode, res.body).toBe(422);
      bodies.push(res.json());
    }
    expect(bodies).toEqual(Array(3).fill({ error: "assignee_not_offered" }));
    expect((await detail(engineer.caller, id)).step.key).toBe("draft");
  });

  it("never offers another Company's Members: K1's manager is offered K1's, from K1's own Step", async () => {
    const id = await newDraft("To K1");
    await take(engineer.caller, id, "send_for_review");
    await pickUp(pm.caller, id);
    await take(pm.caller, id, "submit");
    await pickUp(k1Engineer.caller, id);
    const send = await transitionOf(k1Engineer.caller, id, "send_to_manager");
    expect(send?.assignTo?.map((m) => m.memberId)).toEqual([k1Manager.id]);
  });
});

describe("set and copy", () => {
  it("sets a date to the day it's taken and copies a field, at the raiser's own Step", async () => {
    const id = await newDraft("Model X");
    await take(engineer.caller, id, "send_for_review");
    expect((await detail(pm.caller, id)).answers).toMatchObject({ model: "Model X", reference: "Model X", sent_on: riyadhToday() });
  });

  it("writes K1's Review at its own Step, on K1's record only, and copies the Remarks when the Code is issued", async () => {
    const id = await newDraft("Reviewed");
    await take(engineer.caller, id, "send_for_review");
    await pickUp(pm.caller, id);
    await take(pm.caller, id, "submit");
    await pickUp(k1Engineer.caller, id);
    await take(k1Engineer.caller, id, "send_to_manager", { assignTo: k1Manager.id });
    expect((await detail(k1Manager.caller, id)).answers).toMatchObject({ verdict: "Checked", reviewed_on: riyadhToday() });
    expect(await history(k1Manager.caller, id)).toContain("answers_changed");
    // C1 reads the Review as it arrived, and sees no change on the record (V19).
    expect((await detail(pm.caller, id)).answers).not.toHaveProperty("verdict");
    expect(await history(pm.caller, id)).not.toContain("answers_changed");

    await take(k1Manager.caller, id, "approve_a", { remarks: "Fine as built." });
    expect((await detail(pm.caller, id)).answers).toMatchObject({ verdict: "Checked", reviewer_note: "Fine as built." });
  });
});
