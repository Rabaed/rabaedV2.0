// Seam 1 for a pool of one (RP-513, spec RP-511 decision 1; ADR 0018;
// workflow-engine.md §3.3 rule 4, §3.4, §5.2; visibility.md V14, scenario RP-513-1).
//
// When the Step Pool for the Transition (after "not the same person") has exactly one
// Member as the item arrives, they hold it at once, with no Pick up: an internal event
// of the holding Participant says so, "Step reached" and Need My Action are theirs,
// and "Return to pool" is neither offered nor taken. With two or more it is pooled,
// and the holding Participant's own Members read who it waits on, up to three names
// then "+n". Every other Participant reads the holding Company's name only.
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type NotificationList, type WorkItemBoard, type WorkItemHistory, type WorkItemList, type WorkItemQueryInput } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, detail, inInternalReview, memberOnProject, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const bell = async (by: Caller, id: string) =>
  ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications.filter((n) => n.workItemId === id);

const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> =>
  (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
const list = async (by: Caller, projectId: string, query: WorkItemQueryInput = {}, module = "submittals"): Promise<WorkItemList> =>
  (await ok(by.get(`/v1/projects/${projectId}/modules/${module}/work-items?${workItemSearchParams(query)}`), 200)).json();
const board = async (by: Caller, projectId: string, module = "submittals"): Promise<WorkItemBoard> =>
  (await ok(by.get(`/v1/projects/${projectId}/modules/${module}/work-items/kanban`), 200)).json();
const row = async (by: Caller, projectId: string, id: string, module = "submittals") => (await list(by, projectId, {}, module)).items.find((i) => i.id === id);
const card = async (by: Caller, projectId: string, id: string, module = "submittals") =>
  (await board(by, projectId, module)).columns.flatMap((c) => c.lanes.map((l) => ({ lane: l, card: l.cards.find((x) => x.id === id) }))).find((x) => x.card);
const needMyAction = async (by: Caller, projectId: string) => (await list(by, projectId, { needMyAction: true })).items.map((i) => i.id);

/** A Tower like the demo: C1 with one engineer and one PM ("Ali Sonour"), K1 with one manager. */
async function demoLike(code: string) {
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
  const at: Tower = {
    projectId,
    c1ParticipantId,
    electrical,
    mechanical,
    buildingA,
    c1Engineer: await projectMember(api, c1, c1ParticipantId, ["engineer"], { name: "Omar Engineer" }),
    c1Pm: await projectMember(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" }),
    k1Manager: await projectMember(api, k1, k1ParticipantId, ["manager"], { name: "Hafiz Manager" }),
  };
  return { at, c1, k1, k1ParticipantId };
}

describe("a pool of one holds the Step at once (seam 1)", () => {
  let at: Tower;
  let c1: Company;

  beforeAll(async () => {
    ({ at, c1 } = await demoLike("PO1"));
  });

  it("Send for Review lands held by the only PM: no Pick up, an internal event, Need My Action, Return to pool refused", async () => {
    const id = await inInternalReview(at, at.c1Engineer, "One PM");

    const d = await detail(at.c1Pm, id);
    expect(d.heldBy).toEqual({ companyName: expect.anything(), memberName: bilingual("Ali Sonour"), pool: null });
    expect(d.actions.pickUp).toBe(false);
    expect(d.actions.returnToPool).toBe(false);
    // The raiser's own colleague reads who holds it, too.
    expect((await detail(at.c1Engineer, id)).heldBy?.memberName).toEqual(bilingual("Ali Sonour"));

    // The holding Participant's history says why, after the Transition that brought it.
    const events = await history(at.c1Pm, id);
    const assigned = events.find((e) => e.type === "assigned");
    expect(assigned).toMatchObject({ audience: "internal", by: { memberName: bilingual("Ali Sonour") }, toStep: expect.anything() });
    // Its stored reason ("only_member") is the label's, never shown as a Transition's reason text.
    expect(assigned?.reason).toBeNull();
    expect(events.map((e) => e.type).slice(-2)).toEqual(["transition", "assigned"]);

    expect(await needMyAction(at.c1Pm, at.projectId)).toContain(id);
    expect(await needMyAction(at.c1Engineer, at.projectId)).not.toContain(id);
    // "Step reached" goes to Ali by name, once.
    await drainOutbox(worker);
    expect((await bell(at.c1Pm, id)).map((n) => n.kind)).toEqual(["step_reached"]);

    // Nobody to give it back to.
    const refused = await at.c1Pm.post(`/v1/work-items/${id}/return-to-pool`);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toBe("pool_of_one");
    expect((await detail(at.c1Pm, id)).heldBy?.memberName).toEqual(bilingual("Ali Sonour"));

    // And the PM takes the Submit straight away.
    await take(at.c1Pm, id, "submit");
    // K1's only manager holds it at once too; C1 reads K1's name only (V14).
    const k1 = await detail(at.k1Manager, id);
    expect(k1.heldBy?.memberName).toEqual(bilingual("Hafiz Manager"));
    expect((await detail(at.c1Pm, id)).heldBy).toEqual({ companyName: k1.heldBy!.companyName, memberName: null, pool: null });
    void c1;
  });

  it("with two PMs it is pooled, and C1 reads who it waits on; a third and a fourth show as +n", async () => {
    const khalid = await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Khalid Bakr" });
    const id = await inInternalReview(at, at.c1Engineer, "Two PMs");

    for (const by of [at.c1Pm, at.c1Engineer]) {
      const d = await detail(by, id);
      expect(d.heldBy?.memberName).toBeNull();
      expect(d.heldBy?.pool).toEqual({ names: [bilingual("Ali Sonour"), bilingual("Khalid Bakr")] });
    }
    expect((await detail(at.c1Pm, id)).actions.pickUp).toBe(true);
    expect((await history(at.c1Pm, id)).map((e) => e.type)).not.toContain("assigned");
    expect((await row(at.c1Pm, at.projectId, id))?.with).toMatchObject({ kind: "own", holder: null });

    // Picked up, it may go back to a pool of two.
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    expect((await detail(at.c1Pm, id)).actions.returnToPool).toBe(true);
    await ok(at.c1Pm.post(`/v1/work-items/${id}/return-to-pool`));

    // A Member joining later doesn't take a held Step away; four in the pool are all named
    // (the page shows three in the viewer's language, then "+1").
    await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Badr Alawi" });
    await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Zaid Harbi" });
    const four = await inInternalReview(at, at.c1Engineer, "Four PMs");
    expect((await detail(at.c1Engineer, four)).heldBy?.pool?.names).toHaveLength(4);
    void khalid;
  });
});

describe("scenario RP-513-1: K1 never reads C1's pool or holder", () => {
  const TYPE = "POO";
  let at: Tower;
  let c1: Company;
  let c1Name: { en: string; ar?: string };
  const schema = {
    sections: [
        { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
        {
          key: "classification",
          title: bilingual("Classification"),
          fields: [
            { key: "trade", type: "trade", label: bilingual("Trade") },
            { key: "location", type: "location", label: bilingual("Location") },
            { key: "scopes", type: "scopes", label: bilingual("Scopes") },
          ],
        },
      ],
  };

  beforeAll(async () => {
    await addSendBackType(migrator, TYPE, { en: "Pool test", ar: "اختبار المجموعة" }, schema, { withApproveB: true });
    ({ at, c1 } = await demoLike("PO2"));
    await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Khalid Bakr" });
    c1Name = (await detail(at.c1Engineer, await atK1("Name"))).raisedBy.companyName;
  });

  async function atK1(title: string): Promise<string> {
    const id = (await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: title, trade: at.electrical, location: at.buildingA } }), 201)).json()
      .id as string;
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit");
    return id;
  }

  async function k1ReadsCompanyOnly(id: string, module = "submittals") {
    const d = await detail(at.k1Manager, id);
    expect(d.heldBy).toEqual({ companyName: c1Name, memberName: null, pool: null });
    expect(JSON.stringify(d)).not.toMatch(/Ali Sonour|Khalid Bakr|Omar Engineer/);
    const r = await row(at.k1Manager, at.projectId, id, module);
    expect(r?.with).toEqual({ kind: "company", companyName: c1Name });
    const c = await card(at.k1Manager, at.projectId, id, module);
    expect(c?.lane).toMatchObject({ kind: "company", companyName: c1Name });
    expect(JSON.stringify(await board(at.k1Manager, at.projectId, module))).not.toMatch(/Ali Sonour|Khalid Bakr|Omar Engineer/);
    await drainOutbox(worker);
    expect(JSON.stringify(await bell(at.k1Manager, id))).not.toMatch(/Ali Sonour|Khalid Bakr|Omar Engineer/);
    const events = await history(at.k1Manager, id);
    // Only K1's own: its only manager holding the review (V5).
    expect(events.filter((e) => e.type === "assigned" || e.type === "picked_up").map((e) => e.by.memberName)).toEqual(
      events.filter((e) => e.type === "assigned" || e.type === "picked_up").map(() => bilingual("Hafiz Manager")),
    );
    expect(JSON.stringify(events)).not.toMatch(/Ali Sonour|Khalid Bakr|Omar Engineer/);
    const feed = (await ok(at.k1Manager.get(`/v1/projects/${at.projectId}/activity`), 200)).json();
    expect(JSON.stringify(feed)).not.toMatch(/Ali Sonour|Khalid Bakr|Omar Engineer/);
  }

  it("a Send Back held by the PM who Submitted it: K1 reads C1's name only", async () => {
    const id = await atK1("Sent back");
    await take(at.k1Manager, id, "send_back");
    expect((await detail(at.c1Engineer, id)).heldBy?.memberName).toEqual(bilingual("Ali Sonour"));
    await k1ReadsCompanyOnly(id);
  });

  it("Code B's Comments waiting in C1's pool, and once C1's PM picks one up: K1 reads C1's name only", async () => {
    const id = await atK1("Commented");
    await take(at.k1Manager, id, "send_to_manager");
    await take(at.k1Manager, id, "approve_b", { answers: { remarks: "See comments", items_to_create: [{ comment: "Pool comment" }] } });
    const comment = (await list(at.c1Pm, at.projectId, {}, "snag_list")).items.find((i) => i.title === "Pool comment")!.id;
    // C1 reads its pool by name.
    const pool = (await detail(at.c1Engineer, comment)).heldBy?.pool;
    expect(pool?.names.length).toBeGreaterThan(1);
    expect(pool?.names).toContainEqual(bilingual("Ali Sonour"));
    await k1ReadsCompanyOnly(comment, "snag_list");
    await ok(at.c1Pm.post(`/v1/work-items/${comment}/pick-up`));
    expect((await detail(at.c1Engineer, comment)).heldBy?.memberName).toEqual(bilingual("Ali Sonour"));
    await k1ReadsCompanyOnly(comment, "snag_list");
  });

  it("C1 reads K1's only manager holding it by K1's name only", async () => {
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Submitted to one manager");
    const k1 = await detail(at.k1Manager, id);
    expect(k1.heldBy?.memberName).toEqual(bilingual("Hafiz Manager"));
    for (const by of [at.c1Pm, at.c1Engineer]) {
      const d = await detail(by, id);
      expect(d.heldBy).toEqual({ companyName: k1.heldBy!.companyName, memberName: null, pool: null });
      expect((await history(by, id)).map((e) => e.type)).not.toContain("assigned");
      expect(JSON.stringify(await history(by, id))).not.toMatch(/Hafiz Manager/);
      expect((await row(by, at.projectId, id))?.with).toEqual({ kind: "company", companyName: k1.heldBy!.companyName });
    }
  });
});
