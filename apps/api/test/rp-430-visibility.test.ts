// Seam 1 for scenarios RP-430-1, RP-430-2 and RP-430-3 (docs/visibility/scenarios/RP-430.md;
// spec RP-423; workflow-engine.md §4, §5.1; visibility.md "Refusals of a Transition", V5, V14).
// Transition rules ("not the same person as took X", "has been through C1's Contractor review",
// "all Comments closed") never leak another Participant's internal route or hidden items: a
// Transition a rule withholds is refused exactly like one that isn't there (seam 2:
// transition-rules-rls.test.ts).
//
// The Type is test-only, on the test Workflow with rules (addRulesType). RP-430-2's K1 rule on C1's
// Contractor review is one publishing refuses, so at seam 1 it is refused at publish, and no Version
// holds it (every published Version passes every publish check: workflow-definition.test.ts); the
// engine's answer to such a rule, had one been stored, is seam 2's (transition-rules-rls.test.ts).
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import { addRule, type WorkflowRead, type WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { addRulesType } from "./support/rules.ts";
import { all, bilingual, detail, memberOnProject, ok, take, tryTake } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "VISRUL";

type Person = { id: string; caller: Caller; who: string };
let engineer: Person; // C1 engineer: raises the items.
let pm: Person; // C1 PMs: Contractor review.
let pm2: Person;
let k1Engineer: Person;
let k1Manager: Person;
let k1Manager2: Person;
let projectId = "";
let electrical = "";
let buildingA = "";
let admin: Caller; // C1's Project Admin, who authors the Project's own Workflows.

async function newDraft(by: Person, model: string): Promise<string> {
  const res = await ok(by.caller.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: electrical, location: buildingA } }), 201);
  return res.json().id as string;
}

const offered = async (by: Person, id: string) => (await detail(by.caller, id)).actions.transitions.map((t) => t.key);
const pickUp = (by: Person, id: string) => ok(by.caller.post(`/v1/work-items/${id}/pick-up`));
const returnToPool = (by: Person, id: string) => ok(by.caller.post(`/v1/work-items/${id}/return-to-pool`));

/** At C1's Contractor review, picked up by the C1 PM. */
async function inReview(model: string): Promise<string> {
  const id = await newDraft(engineer, model);
  await take(engineer.caller, id, "send_for_review");
  await pickUp(pm, id);
  return id;
}

/** Submitted to K1, picked up by `holder`. */
async function atConsultant(model: string, holder: Person): Promise<string> {
  const id = await inReview(model);
  await take(pm.caller, id, "submit");
  await pickUp(holder, id);
  return id;
}

/** K1's `sender` sent it to the Manager; picked up by `holder`. */
async function atApproval(model: string, sender: Person, holder: Person): Promise<string> {
  const id = await atConsultant(model, sender);
  await take(sender.caller, id, "send_to_manager");
  await pickUp(holder, id);
  return id;
}

/** Refused exactly like a Transition that isn't there: the same status and body as a made-up key. */
async function expectRefusedLikeNone(by: Person, id: string, transition: string) {
  const ruled = await tryTake(by.caller, id, transition);
  const madeUp = await tryTake(by.caller, id, "made_up");
  expect(ruled.statusCode, ruled.body).toBe(409);
  expect({ status: ruled.statusCode, body: ruled.body }).toEqual({ status: madeUp.statusCode, body: madeUp.body });
  expect(ruled.json()).toEqual({ error: "transition_not_available" });
}

/** The item's history events `match` picks, as one row `${id}/${what}` when `by` reads any; `[]` when not, or for the plain 404. */
const eventsRead = (id: string, what: string, match: (e: WorkItemHistory["events"][number]) => boolean) => async (by: Person) =>
  (await readById<WorkItemHistory>(`/v1/work-items/${id}/history`)(by.caller))
    .flatMap((h) => h.events)
    .filter(match)
    .slice(0, 1)
    .map(() => ({ id: `${id}/${what}` }));

const who = (p: Person) => p.who;

beforeAll(async () => {
  await addRulesType(migrator, TYPE);
  const c1 = await api.projectCreator();
  admin = c1.caller;
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })).json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  const k1 = await api.authorizedPerson();
  const k1Participant = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  const person = async (company: Parameters<typeof memberOnProject>[1], participant: string, positions: string[], name: string): Promise<Person> => ({
    ...(await memberOnProject(api, company, participant, positions, { name })),
    who: name,
  });
  engineer = await person(c1, own, ["engineer"], "C1 engineer");
  pm = await person(c1, own, ["project_manager"], "C1 PM");
  pm2 = await person(c1, own, ["project_manager"], "C1 PM 2");
  k1Engineer = await person(k1, k1Participant, ["engineer"], "K1 engineer");
  k1Manager = await person(k1, k1Participant, ["manager"], "K1 manager");
  k1Manager2 = await person(k1, k1Participant, ["manager"], "K1 manager 2");
});

describe("RP-430-1: not the same person (seam 1)", () => {
  it("K1's manager who took Send to Manager is neither offered Approve nor may take it, refused like a Transition that isn't there; another manager approves", async () => {
    const id = await atApproval("Separation", k1Manager, k1Manager);
    expect(await offered(k1Manager, id)).not.toContain("approve_a"); // not hidden-from: a Transition not offered, a button and not a row
    await expectRefusedLikeNone(k1Manager, id, "approve_a");
    await returnToPool(k1Manager, id);
    await pickUp(k1Manager2, id);
    expect(await offered(k1Manager2, id)).toContain("approve_a");
    await take(k1Manager2.caller, id, "approve_a");
    expect((await detail(pm.caller, id)).outcome).not.toBeNull();
  });

  it("the move the rule reads is K1's own, internal to K1: C1 reads nothing of it", async () => {
    const id = await atApproval("Separation, internal", k1Manager, k1Manager2);
    await expectHiddenFrom({
      read: eventsRead(id, "send_to_manager", (e) => e.transition?.en === "Send to Manager"),
      target: `${id}/send_to_manager`,
      seenBy: [k1Manager, k1Manager2, k1Engineer],
      hiddenFrom: [pm, pm2, engineer],
      name: who,
      label: "K1's Send to Manager",
    });
  });

  it("a C1 PM who raised and sent the Draft is not offered the second-pair-of-eyes Submit, refused alike; the other PM takes it", async () => {
    const id = await newDraft(pm, "Second pair of eyes");
    await take(pm.caller, id, "send_for_review");
    await pickUp(pm, id);
    expect(await offered(pm, id)).not.toContain("submit_separate"); // not hidden-from: a Transition not offered, a button and not a row
    await expectRefusedLikeNone(pm, id, "submit_separate");
    await returnToPool(pm, id);
    await pickUp(pm2, id);
    expect(await offered(pm2, id)).toContain("submit_separate");
    await take(pm2.caller, id, "submit_separate");
  });

  it("the Member the rule names is left out of the next Step's pool and of Assign to; with nobody left, the uniform next_step_unavailable", async () => {
    /** Back at K1's review, held by its engineer: K1's manager sent it to the Manager, `returner` returned it. */
    const backAtReview = async (model: string, returner: Person) => {
      const id = await atApproval(model, k1Manager, returner);
      await take(returner.caller, id, "return_to_engineer");
      await returnToPool(k1Manager, id);
      await pickUp(k1Engineer, id);
      return id;
    };
    const id = await backAtReview("Fresh eyes", k1Manager);
    const fresh = (await detail(k1Engineer.caller, id)).actions.transitions.find((t) => t.key === "fresh_eyes");
    expect(fresh?.assignTo?.map((m) => m.memberId)).toEqual([k1Manager2.id]);
    const picked = await tryTake(k1Engineer.caller, id, "fresh_eyes", { assignTo: k1Manager.id });
    expect(picked.statusCode, picked.body).toBe(422);
    expect(picked.json()).toEqual({ error: "assignee_not_offered" });
    await take(k1Engineer.caller, id, "fresh_eyes");
    const refused = await k1Manager.caller.post(`/v1/work-items/${id}/pick-up`);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toEqual({ error: "already_picked_up" });

    const none = await backAtReview("No fresh eyes", k1Manager2);
    expect(await offered(k1Engineer, none)).not.toContain("fresh_eyes"); // not hidden-from: a Transition not offered, a button and not a row
    const res = await tryTake(k1Engineer.caller, none, "fresh_eyes");
    expect(res.statusCode, res.body).toBe(409);
    expect(res.body).toBe(JSON.stringify({ error: "next_step_unavailable" }));
  });
});

describe("RP-430-2: has been through C1's Contractor review (seam 1)", () => {
  it("is refused at publish, so no Version a K1 Transition runs on asks it; K1 reads nothing of C1's internal route", async () => {
    // The Project's own copy of the rules Workflow, with the rule on K1's Send to Manager.
    const rules = (await sql<{ id: string }>`select workflow_definition_id as id from work_item_type where code = ${TYPE}`.execute(migrator)).rows[0]!.id;
    const copy = (await ok(admin.post(`/v1/workflows/${rules}/duplicate`, { projectId, name: bilingual("Rules, Project copy (RP-430-2)") }), 201)).json().id as string;
    const draft = ((await ok(admin.get(`/v1/workflows/${copy}`), 200)).json() as WorkflowRead).draft!.definition;
    const asked = addRule(draft, "send_to_manager", { group: "restrict", rule: { type: "been_through", step: "internal_review" } });
    await ok(admin.request("PUT", `/v1/workflows/${copy}/draft`, { definition: asked }), 200);
    const refused = await admin.post(`/v1/workflows/${copy}/publish`);
    expect(refused.statusCode, refused.body).toBe(422);
    // By its code: the test Workflow's own old Return to the Draft is a problem too (ADR 0020), so a 422 alone proves nothing.
    expect(refused.json().problems).toContainEqual(expect.objectContaining({ code: "been_through_other_participant", transition: "send_to_manager" }));
    expect(((await ok(admin.get(`/v1/workflows/${copy}`), 200)).json() as WorkflowRead).publishedVersions).toEqual([]); // not hidden-from: the refused publish made no Version, read by the Project Admin who authors it

    // What such a rule would read is C1's internal route, which K1 never reads.
    const id = await atConsultant("Contractor route", k1Manager);
    await expectHiddenFrom({
      read: eventsRead(id, "send_for_review", (e) => e.transition?.en === "Send for Review"),
      target: `${id}/send_for_review`,
      seenBy: [pm, engineer],
      hiddenFrom: [k1Manager, k1Engineer],
      name: who,
      label: "C1's Send for Review",
    });
    await expectHiddenFrom({
      read: eventsRead(id, "from_contractor_review", (e) => e.fromStep?.en === "Contractor review"),
      target: `${id}/from_contractor_review`,
      seenBy: [pm, engineer],
      hiddenFrom: [k1Manager, k1Engineer],
      name: who,
      label: "the Step C1's Submit left",
    });
    expect((await detail(k1Manager.caller, id)).step.key).toBe("consultant_review");
  });

  it("a C1 rule on its own Contractor review holds once the item has been there", async () => {
    const id = await newDraft(pm, "Own route");
    expect(await offered(pm, id)).not.toContain("submit_direct"); // not hidden-from: a Transition not offered, a button and not a row
    await expectRefusedLikeNone(pm, id, "submit_direct");
    await take(pm.caller, id, "send_for_review");
    await pickUp(pm2, id);
    await take(pm2.caller, id, "return");
    expect(await offered(pm, id)).toContain("submit_direct");
    await take(pm.caller, id, "submit_direct");
  });
});

describe("RP-430-3: all Comments closed (seam 1)", () => {
  it("while the Comment is C1's Draft, hidden from K1, Reject is offered as if it weren't there; once K1 sees it open, Reject is refused like a Transition that isn't there", async () => {
    const id = await atApproval("Commented", k1Engineer, k1Manager);
    const comment = await newDraft(engineer, "Comment on it");
    await sql`insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id)
      select project_id, ${comment}::uuid, id, 'raised_from', ${engineer.id}::uuid from work_item where id = ${id}::uuid`.execute(migrator);
    await expectHiddenFrom({ read: (by: Person) => readById(`/v1/work-items/${comment}`)(by.caller), target: comment, seenBy: [engineer, pm], hiddenFrom: [k1Manager, k1Engineer], name: who, label: "C1's Draft Comment" });
    expect(await offered(k1Manager, id)).toContain("reject_d");

    // Submitted, K1 sees it open: Reject is no longer offered.
    await take(engineer.caller, comment, "send_for_review");
    await pickUp(pm, comment);
    await take(pm.caller, comment, "submit");
    expect((await readById(`/v1/work-items/${comment}`)(k1Manager.caller)).map((r) => r.id)).toEqual([comment]);
    expect(await offered(k1Manager, id)).not.toContain("reject_d"); // not hidden-from: a Transition not offered, a button and not a row
    // Refused like a Transition that isn't there: the same body as a made-up key, naming no item.
    await expectRefusedLikeNone(k1Manager, id, "reject_d");
    expect((await detail(k1Manager.caller, id)).step.key).toBe("consultant_approval");
  });
});
