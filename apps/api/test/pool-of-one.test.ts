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
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type WorkItemBoard, type WorkItemHistory, type WorkItemList, type WorkItemQueryInput } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, detail, inInternalReview, memberOnProject, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> =>
  (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
const list = async (by: Caller, projectId: string, query: WorkItemQueryInput = {}): Promise<WorkItemList> =>
  (await ok(by.get(`/v1/projects/${projectId}/work-items?${workItemSearchParams(query)}`), 200)).json();
const board = async (by: Caller, projectId: string): Promise<WorkItemBoard> =>
  (await ok(by.get(`/v1/projects/${projectId}/work-items/kanban`), 200)).json();
const row = async (by: Caller, projectId: string, id: string) => (await list(by, projectId)).items.find((i) => i.id === id);
const card = async (by: Caller, projectId: string, id: string) =>
  (await board(by, projectId)).columns.flatMap((c) => c.cards).find((c) => c.id === id);
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
    expect(events.map((e) => e.type).slice(-2)).toEqual(["transition", "assigned"]);

    expect(await needMyAction(at.c1Pm, at.projectId)).toContain(id);
    const notifications = (await ok(at.c1Pm.get("/v1/notifications"), 200)).json();
    expect(JSON.stringify(notifications)).toBeDefined();

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
      expect(d.heldBy?.pool).toEqual({ names: [bilingual("Ali Sonour"), bilingual("Khalid Bakr")], more: 0 });
    }
    expect((await detail(at.c1Pm, id)).actions.pickUp).toBe(true);
    expect((await history(at.c1Pm, id)).map((e) => e.type)).not.toContain("assigned");
    expect((await row(at.c1Pm, at.projectId, id))?.with).toMatchObject({ kind: "own", holder: null });

    // Picked up, it may go back to a pool of two.
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    expect((await detail(at.c1Pm, id)).actions.returnToPool).toBe(true);
    await ok(at.c1Pm.post(`/v1/work-items/${id}/return-to-pool`));

    // A Member joining later doesn't take a held Step away; four in the pool read three and "+1".
    await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Badr Alawi" });
    await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Zaid Harbi" });
    const four = await inInternalReview(at, at.c1Engineer, "Four PMs");
    expect((await detail(at.c1Engineer, four)).heldBy?.pool).toEqual({
      names: [bilingual("Ali Sonour"), bilingual("Badr Alawi"), bilingual("Khalid Bakr")],
      more: 1,
    });
    void khalid;
  });
});

describe("scenario RP-513-1: K1 never reads C1's pool or holder", () => {
  const TYPE = "POO";
  let at: Tower;
  let c1: Company;

  beforeAll(async () => {
    await addSendBackType(migrator, TYPE, { en: "Pool test", ar: "اختبار المجموعة" }, {
      sections: [
        {
          key: "classification",
          title: bilingual("Classification"),
          fields: [
            { key: "trade", type: "trade", label: bilingual("Trade") },
            { key: "location", type: "location", label: bilingual("Location") },
          ],
        },
      ],
    });
    ({ at, c1 } = await demoLike("PO2"));
    await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Khalid Bakr" });
  });

  async function sentBack(title: string): Promise<string> {
    const id = (await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { trade: at.electrical, location: at.buildingA } }), 201)).json()
      .id as string;
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit");
    await take(at.k1Manager, id, "send_back", { reason: "Wrong datasheet" });
    return id;
  }

  async function k1ReadsCompanyOnly(id: string) {
    const d = await detail(at.k1Manager, id);
    expect(d.heldBy).toEqual({ companyName: d.raisedBy.companyName, memberName: null, pool: null });
    expect(JSON.stringify(d)).not.toMatch(/Ali Sonour|Khalid Bakr|Omar Engineer/);
    const r = await row(at.k1Manager, at.projectId, id);
    expect(r?.with).toEqual({ kind: "company", companyName: d.raisedBy.companyName });
    const c = await card(at.k1Manager, at.projectId, id);
    expect(JSON.stringify(c)).not.toMatch(/Ali Sonour|Khalid Bakr/);
    const events = await history(at.k1Manager, id);
    expect(events.map((e) => e.type)).not.toContain("assigned");
    expect(events.map((e) => e.type)).not.toContain("picked_up");
    expect(JSON.stringify(events)).not.toMatch(/Ali Sonour|Khalid Bakr|Omar Engineer/);
    const feed = (await ok(at.k1Manager.get(`/v1/projects/${at.projectId}/activity`), 200)).json();
    expect(JSON.stringify(feed)).not.toMatch(/Ali Sonour|Khalid Bakr|Omar Engineer/);
  }

  it("while C1's pool waits, and once C1's PM picks it up", async () => {
    const id = await sentBack("Sent back to a pool");
    // C1 reads its pool by name.
    expect((await detail(at.c1Engineer, id)).heldBy?.pool?.names).toEqual([bilingual("Ali Sonour"), bilingual("Khalid Bakr")]);
    await k1ReadsCompanyOnly(id);
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    expect((await detail(at.c1Engineer, id)).heldBy?.memberName).toEqual(bilingual("Ali Sonour"));
    await k1ReadsCompanyOnly(id);
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
