// Seam 1 for an item's Trade, Location and Scopes while it is Sent Back to its raiser (RP-582;
// ADR 0021, ADR 0014; visibility.md V12, V19, layer 4, scenarios RP-582-1 and RP-582-2).
//
// C1's Daily Report at Tower 1 is Sent Back to a Step that says "Edit the Form" (RP-580), and
// C1 moves it to Building A and changes its Scope. Until C1 Submits it again, the Owner
// Representative's Tower 1 engineer still has it, at Tower 1 with its old Scope, in the List,
// a Location filter, the Kanban, search and the item; the Building A engineer has nothing of
// it, not even a 404's worth. C1 sees Building A. At the Submit the new values apply (V12):
// the Tower 1 engineer loses it, the Building A engineer gains it.
//
// The Type is test-only, on the test Workflow with a Send Back (addSendBackType).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type WorkItemBoard, type WorkItemDetail, type WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, detail, ok, only, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "SBBIN";
const schema = {
  sections: [
    {
      key: "report",
      title: bilingual("Report"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

let c1: Company;
let engineer: Caller; // C1 engineer: raises the report, moves it while it is Sent Back.
let pm: Caller; // C1 PM: Submits.
let k1Engineer: Caller; // Sends it Back.
let orTower1: Caller; // Owner Representative engineer covering Tower 1 only.
let orBuildingA: Caller; // Owner Representative engineer covering Building A only.
let projectId = "";
let electrical = "";
let tower1 = "";
let buildingA = "";
let lighting = "";
let power = "";

const list = async (by: Caller, query: Parameters<typeof workItemSearchParams>[0] = {}) =>
  ((await ok(by.get(`/v1/projects/${projectId}/modules/submittals/work-items?${workItemSearchParams(query)}`), 200)).json() as WorkItemList).items;
const row = async (by: Caller, id: string, query: Parameters<typeof workItemSearchParams>[0] = {}) => (await list(by, query)).find((r) => r.id === id);
const cards = async (by: Caller) =>
  ((await ok(by.get(`/v1/projects/${projectId}/modules/submittals/work-items/kanban`), 200)).json() as WorkItemBoard).columns.flatMap((c) =>
    c.lanes.flatMap((l) => l.cards),
  );
const scopeIds = (d: WorkItemDetail) => d.scopes.map((s) => s.id);

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, bilingual("Daily report (test)"), schema, { afterSendBack: { draft: "edit_form" } });
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  tower1 = await post("locations", { code: "T1", name: bilingual("Tower One"), parentId: null });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building Alpha"), parentId: null });
  lighting = await post("scopes", { tradeId: electrical, name: bilingual("Lighting") });
  power = await post("scopes", { tradeId: electrical, name: bilingual("Power") });
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  const k1 = await api.authorizedPerson();
  const k1Participant = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  k1Engineer = await projectMember(api, k1, k1Participant, ["engineer"]);
  const or = await api.authorizedPerson();
  const orParticipant = await api.addParticipant(c1.caller, projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipant}/visibility`, { trade: all, location: all }));
  // Each engineer's own Visibility: one Location.
  const orMember = async (location: string) => {
    const member = await api.inviteMember(or.caller, {});
    const caller = await api.acceptInvitation(member.invitationToken);
    await api.addProjectMember(or.caller, orParticipant, member.id);
    await ok(or.caller.request("PUT", `/v1/participants/${orParticipant}/members/${member.id}/visibility`, { trade: all, location: only(location) }));
    await ok(or.caller.request("PUT", `/v1/participants/${orParticipant}/members/${member.id}/positions`, { positions: ["engineer"] }));
    return caller;
  };
  orTower1 = await orMember(tower1);
  orBuildingA = await orMember(buildingA);
});

describe("scenario RP-582-1: C1 moves a report Sent Back to an \"Edit the Form\" Step from Tower 1 to Building A", () => {
  let id = "";

  beforeAll(async () => {
    const answers = { model: "Daily report", trade: electrical, location: tower1, scopes: [lighting] };
    id = (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Daily report", answers }), 201)).json().id as string;
    await take(engineer, id, "send_for_review");
    await ok(pm.post(`/v1/work-items/${id}/pick-up`));
    await take(pm, id, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Engineer, id, "send_back_to_draft");
    const now = (await detail(engineer, id)).answers;
    await ok(engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...now, location: buildingA, scopes: [power] } }));
  });

  it("shows C1 the report as it is now: Building Alpha, Power", async () => {
    for (const c1Member of [engineer, pm]) {
      const d = await detail(c1Member, id);
      expect(d.location?.id).toBe(buildingA);
      expect(scopeIds(d)).toEqual([power]);
      expect((await row(c1Member, id))?.location?.id).toBe(buildingA);
    }
  });

  it("keeps it with the Tower 1 engineer, at Tower One with Lighting: List, Location filter, Kanban, search, item", async () => {
    const d = await detail(orTower1, id);
    expect(d.location?.id).toBe(tower1);
    expect(d.answers.location).toBe(tower1);
    expect(scopeIds(d)).toEqual([lighting]);
    expect((await row(orTower1, id))?.location?.id).toBe(tower1);
    expect(await row(orTower1, id, { location: [tower1] })).toBeDefined();
    expect(await row(orTower1, id, { location: [buildingA] })).toBeUndefined();
    expect((await cards(orTower1)).find((c) => c.id === id)?.location?.id).toBe(tower1);
    expect(await row(orTower1, id, { q: "Tower One" })).toBeDefined();
    // Nothing tells it where C1 moved the report.
    expect(await row(orTower1, id, { q: "Alpha" })).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain(buildingA);
  });

  it("keeps K1 on Lighting, as it was at the Send Back (a Scope change: rows only, Scopes grant nothing)", async () => {
    const d = await detail(k1Engineer, id);
    expect(d.location?.id).toBe(tower1);
    expect(scopeIds(d)).toEqual([lighting]);
  });

  it("gives the Building A engineer nothing of it", async () => {
    await expectHidden(orBuildingA.get(`/v1/work-items/${id}`));
    expect(await row(orBuildingA, id)).toBeUndefined();
    expect(await row(orBuildingA, id, { q: "Daily" })).toBeUndefined();
    expect((await cards(orBuildingA)).find((c) => c.id === id)).toBeUndefined();
  });

  describe("scenario RP-582-2: once C1 Submits it again (V12)", () => {
    beforeAll(async () => {
      await take(engineer, id, "send_for_review");
      await ok(pm.post(`/v1/work-items/${id}/pick-up`));
      await take(pm, id, "submit");
    });

    it("the Tower 1 engineer loses it", async () => {
      await expectHidden(orTower1.get(`/v1/work-items/${id}`));
      expect(await row(orTower1, id)).toBeUndefined();
      expect(await row(orTower1, id, { q: "Tower One" })).toBeUndefined();
    });

    it("the Building A engineer gains it, at Building Alpha with Power", async () => {
      const d = await detail(orBuildingA, id);
      expect(d.location?.id).toBe(buildingA);
      expect(scopeIds(d)).toEqual([power]);
      expect((await row(orBuildingA, id, { q: "Alpha" }))?.location?.id).toBe(buildingA);
      expect((await cards(orBuildingA)).find((c) => c.id === id)).toBeDefined();
      expect(scopeIds(await detail(k1Engineer, id))).toEqual([power]);
    });
  });
});
