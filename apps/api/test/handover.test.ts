// Seam 1 for Handover (RP-108, spec RP-511 decision 3; ADR 0018; workflow-engine.md §9;
// visibility.md scenario RP-108-1).
//
// Deactivating a Member, removing them from a Project, or a Position or Visibility
// change that takes them out of a Step Pool first lists every open Step they hold,
// their Drafts included; each needs a new holder from that Step's pool without them.
// The Authorized Person picks; one candidate is offered pre-filled; none refuses the
// change, which then isn't made. The change and its Handovers are saved together:
// an internal event of the holding Participant, and "Step reached" for the new holder.
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type HandoverStep, type NotificationList, type WorkItemHistory, type WorkItemList } from "@rabaed/domain";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, draft, inInternalReview, memberOnProject, ok, only, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
afterAll(async () => {
  await api.close();
  await worker.destroy();
});

const bell = async (by: Caller, id: string) =>
  ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications.filter((n) => n.workItemId === id);
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> =>
  (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
const needMyAction = async (by: Caller, projectId: string): Promise<string[]> =>
  ((await ok(by.get(`/v1/projects/${projectId}/modules/submittals/work-items?${workItemSearchParams({ needMyAction: true })}`), 200)).json() as WorkItemList).items.map(
    (i) => i.id,
  );
const memberStatus = async (company: Company, id: string) =>
  (await ok(company.caller.get("/v1/members"), 200)).json().members.find((m: { id: string }) => m.id === id)?.status;

type Picks = { assignmentId: string; toMemberId: string }[];
const deactivate = (company: Company, memberId: string, handovers?: Picks) =>
  company.caller.post(`/v1/members/${memberId}/deactivate`, handovers ? { handovers } : {});
const removeFromProject = (company: Company, participantId: string, memberId: string, handovers?: Picks) =>
  company.caller.request("DELETE", `/v1/participants/${participantId}/members/${memberId}`, handovers ? { handovers } : {});
const setPositions = (company: Company, participantId: string, memberId: string, positions: string[], handovers?: Picks) =>
  company.caller.request("PUT", `/v1/participants/${participantId}/members/${memberId}/positions`, { positions, ...(handovers ? { handovers } : {}) });

/** The Steps the refusal asks a new holder for. */
async function needed(res: Promise<{ statusCode: number; body: string; json(): { error: string; handovers: HandoverStep[] } }>): Promise<HandoverStep[]> {
  const r = await res;
  expect(r.statusCode, r.body).toBe(409);
  expect(r.json().error).toBe("handover_needed");
  return r.json().handovers;
}

/** A Tower: C1 with one engineer ("Omar Engineer") and one PM ("Ali Sonour"), K1 with one manager ("Hafiz Manager"). */
async function tower(code: string) {
  const c1: Company = await api.projectCreator();
  const k1: Company = await api.authorizedPerson();
  const projectId = (await api.createProject(c1.caller, { code })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  const electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  const mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  const buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  const engineer = await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Omar Engineer" });
  const ali = await memberOnProject(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  const hafiz = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Hafiz Manager" });
  const at: Tower = {
    projectId,
    c1ParticipantId,
    electrical,
    mechanical,
    buildingA,
    c1Engineer: engineer.caller,
    c1Pm: ali.caller,
    k1Manager: hafiz.caller,
  };
  return { at, c1, k1, k1ParticipantId, engineer, ali, hafiz };
}

describe("deactivating a Member who holds a Step (seam 1)", () => {
  let t: Awaited<ReturnType<typeof tower>>;
  let id: string;

  beforeAll(async () => {
    t = await tower("HO1");
    // Ali is the only PM: the item lands held by him (pool of one).
    id = await inInternalReview(t.at, t.at.c1Engineer, "Cable trays");
  });

  it("with nobody else to take it, is refused, naming the Step and Project, and Ali stays active", async () => {
    const res = await deactivate(t.c1, t.ali.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: "nobody_can_take", step: { en: "Contractor review" }, project: { en: expect.any(String) } });
    expect(await memberStatus(t.c1, t.ali.id)).toBe("active");
    expect((await detail(t.at.c1Pm, id)).heldBy?.memberName).toEqual(bilingual("Ali Sonour"));
  });

  it("with one other PM, lists the Step with that PM pre-filled; with two, asks which", async () => {
    const khalid = await memberOnProject(api, t.c1, t.at.c1ParticipantId, ["project_manager"], { name: "Khalid Bakr" });
    const one = await needed(deactivate(t.c1, t.ali.id));
    expect(one).toEqual([
      {
        assignmentId: expect.any(String),
        workItemId: id,
        project: { id: t.at.projectId, name: expect.anything() },
        documentNumber: expect.any(String),
        title: "Cable trays",
        step: expect.objectContaining({ en: "Contractor review" }),
        candidates: [{ id: khalid.id, fullName: bilingual("Khalid Bakr") }],
      },
    ]);
    expect(await memberStatus(t.c1, t.ali.id)).toBe("active");

    const badr = await memberOnProject(api, t.c1, t.at.c1ParticipantId, ["project_manager"], { name: "Badr Alawi" });
    const two = await needed(deactivate(t.c1, t.ali.id));
    expect(two[0]!.candidates).toEqual([
      { id: badr.id, fullName: bilingual("Badr Alawi") },
      { id: khalid.id, fullName: bilingual("Khalid Bakr") },
    ]);

    // A pick that isn't one of the candidates is no pick: the list again, nothing changed.
    for (const toMemberId of [t.ali.id, t.engineer.id, t.hafiz.id, randomUUID()]) {
      expect(await needed(deactivate(t.c1, t.ali.id, [{ assignmentId: two[0]!.assignmentId, toMemberId }]))).toHaveLength(1);
    }
    expect(await memberStatus(t.c1, t.ali.id)).toBe("active");

    // Picked: Ali is deactivated and Khalid holds the Step, in one go.
    const res = await deactivate(t.c1, t.ali.id, [{ assignmentId: two[0]!.assignmentId, toMemberId: khalid.id }]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe("deactivated");
    expect((await detail(khalid.caller, id)).heldBy?.memberName).toEqual(bilingual("Khalid Bakr"));
    expect(await needMyAction(khalid.caller, t.at.projectId)).toContain(id);

    // An internal event of C1: who handed it over, from whom, to whom, and why.
    const events = await history(khalid.caller, id);
    expect(events.at(-1)).toMatchObject({
      type: "assigned",
      audience: "internal",
      handover: { from: bilingual("Ali Sonour"), to: bilingual("Khalid Bakr"), because: "deactivated" },
    });
    // K1 never reads it (V5).
    expect(JSON.stringify(await bell(t.at.k1Manager, id))).not.toMatch(/Ali Sonour|Khalid Bakr/);

    // "Step reached" goes to Khalid.
    await drainOutbox(worker);
    expect((await bell(khalid.caller, id)).map((n) => n.kind)).toContain("step_reached");
    expect((await bell(badr.caller, id)).map((n) => n.kind)).not.toContain("step_reached");
  });
});


describe("removing a Member from a Project, and changing their Positions or Visibility (seam 1)", () => {
  it("removal: a Draft goes to another Member who may raise it, with no number yet", async () => {
    const t = await tower("HO2");
    const saad = await memberOnProject(api, t.c1, t.at.c1ParticipantId, ["engineer"], { name: "Saad Engineer" });
    const id = await draft(t.at, t.at.c1Engineer, "Draft trays");
    const [step] = await needed(removeFromProject(t.c1, t.at.c1ParticipantId, t.engineer.id));
    expect(step).toMatchObject({ workItemId: id, documentNumber: null, title: "Draft trays" });
    expect(step!.candidates.map((c) => c.id)).toContain(saad.id);

    const res = await removeFromProject(t.c1, t.at.c1ParticipantId, t.engineer.id, [{ assignmentId: step!.assignmentId, toMemberId: saad.id }]);
    expect(res.statusCode, res.body).toBe(204);
    // Saad holds the Draft now, and may send it on.
    expect((await detail(saad.caller, id)).actions.transitions.map((x) => x.key)).toContain("send_for_review");
    expect((await history(saad.caller, id)).at(-1)).toMatchObject({
      handover: { from: bilingual("Omar Engineer"), to: bilingual("Saad Engineer"), because: "removed" },
    });
  });

  it("Positions: a change that keeps Ali in the pool asks nothing; one that takes him out hands his Step over", async () => {
    const t = await tower("HO3");
    const khalid = await memberOnProject(api, t.c1, t.at.c1ParticipantId, ["project_manager"], { name: "Khalid Bakr" });
    const id = await inInternalReview(t.at, t.at.c1Engineer, "Positions");
    await ok(t.at.c1Pm.post(`/v1/work-items/${id}/pick-up`));

    await ok(setPositions(t.c1, t.at.c1ParticipantId, t.ali.id, ["project_manager", "engineer"]));
    const [step] = await needed(setPositions(t.c1, t.at.c1ParticipantId, t.ali.id, ["engineer"]));
    expect(step!.candidates).toEqual([{ id: khalid.id, fullName: bilingual("Khalid Bakr") }]);
    await ok(setPositions(t.c1, t.at.c1ParticipantId, t.ali.id, ["engineer"], [{ assignmentId: step!.assignmentId, toMemberId: khalid.id }]));
    expect((await detail(khalid.caller, id)).heldBy?.memberName).toEqual(bilingual("Khalid Bakr"));
    expect((await history(khalid.caller, id)).at(-1)).toMatchObject({ handover: { from: bilingual("Ali Sonour"), because: "positions" } });
  });

  it("Visibility: narrowed off the item's Trade, Ali hands his Step over", async () => {
    const t = await tower("HO4");
    const khalid = await memberOnProject(api, t.c1, t.at.c1ParticipantId, ["project_manager"], { name: "Khalid Bakr" });
    const id = await inInternalReview(t.at, t.at.c1Engineer, "Narrowed");
    await ok(t.at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    const path = `/v1/participants/${t.at.c1ParticipantId}/members/${t.ali.id}/visibility`;
    const narrowed = { trade: only(t.at.mechanical), location: all };

    const [step] = await needed(t.c1.caller.request("PUT", path, narrowed));
    expect(step).toMatchObject({ workItemId: id, candidates: [{ id: khalid.id }] });
    // Refused: Ali's Visibility is as it was.
    expect((await ok(t.c1.caller.get(path), 200)).json().visibility.trade.isAll).toBe(true);
    await ok(t.c1.caller.request("PUT", path, { ...narrowed, handovers: [{ assignmentId: step!.assignmentId, toMemberId: khalid.id }] }));
    expect((await history(khalid.caller, id)).at(-1)).toMatchObject({ handover: { because: "visibility" } });
  });

  it("a pooled Step the change would leave with nobody refuses it, though nobody holds it", async () => {
    const t = await tower("HO5");
    const khalid = await memberOnProject(api, t.c1, t.at.c1ParticipantId, ["project_manager"], { name: "Khalid Bakr" });
    const id = await inInternalReview(t.at, t.at.c1Engineer, "Emptied");
    expect((await detail(t.at.c1Pm, id)).heldBy?.pool?.names).toHaveLength(2);

    // Khalid leaving still leaves Ali; then Ali can't leave too.
    await ok(setPositions(t.c1, t.at.c1ParticipantId, khalid.id, ["engineer"]));
    const res = await deactivate(t.c1, t.ali.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: "nobody_can_take", step: { en: "Contractor review" } });
    expect(await memberStatus(t.c1, t.ali.id)).toBe("active");
    // Ali hasn't picked it up: still pooled.
    expect((await detail(t.at.c1Pm, id)).actions.pickUp).toBe(true);
  });
});

describe("scenario RP-108-1: the Handover never lists another Company's items or Members", () => {
  it("K1's Authorized Person reads only K1's Steps and Members; C1's only C1's", async () => {
    const t = await tower("HO6");
    // An item C1 raised, at K1's review: held by Hafiz, K1's only manager. Another K1 manager joins.
    const atK1 = await inInternalReview(t.at, t.at.c1Engineer, "Raised by C1");
    await take(t.at.c1Pm, atK1, "submit");
    const nadia = await memberOnProject(api, t.k1, t.k1ParticipantId, ["manager"], { name: "Nadia Reviewer" });
    // And one at C1's internal review, held by Ali.
    const atC1 = await inInternalReview(t.at, t.at.c1Engineer, "Still with C1");
    await memberOnProject(api, t.c1, t.at.c1ParticipantId, ["project_manager"], { name: "Khalid Bakr" });

    const k1Steps = await needed(deactivate(t.k1, t.hafiz.id));
    expect(k1Steps.map((s) => s.workItemId)).toEqual([atK1]);
    expect(k1Steps[0]!.candidates).toEqual([{ id: nadia.id, fullName: bilingual("Nadia Reviewer") }]);
    expect(JSON.stringify(k1Steps)).not.toMatch(/Ali Sonour|Khalid Bakr|Omar Engineer|Still with C1/);

    const c1Steps = await needed(deactivate(t.c1, t.ali.id));
    expect(c1Steps.map((s) => s.workItemId)).toEqual([atC1]);
    expect(JSON.stringify(c1Steps)).not.toMatch(/Hafiz Manager|Nadia Reviewer|Raised by C1/);

    // C1 can't hand K1's Step over, nor name K1's Members; K1's AP can't deactivate C1's Ali.
    expect(await needed(deactivate(t.c1, t.ali.id, [
      { assignmentId: c1Steps[0]!.assignmentId, toMemberId: nadia.id },
      { assignmentId: k1Steps[0]!.assignmentId, toMemberId: nadia.id },
    ]))).toHaveLength(1);
    expect((await deactivate(t.k1, t.ali.id)).statusCode).toBe(404);

    // With nobody left at K1, the refusal names K1's own Step and the Project only.
    await ok(setPositions(t.k1, t.k1ParticipantId, nadia.id, []));
    const refused = await deactivate(t.k1, t.hafiz.id);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toBe("nobody_can_take");
    expect(Object.keys(refused.json()).sort()).toEqual(["error", "project", "step"]);
    expect(refused.body).not.toMatch(/Ali Sonour|Khalid Bakr|Omar Engineer|Raised by C1|Still with C1/);
  });
});
