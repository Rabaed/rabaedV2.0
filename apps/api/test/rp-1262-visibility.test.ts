// Seam 1 for passing a withdrawn Participant's Vacancies to the replacement Participant's Step Pool
// (RP-1262; ADR 0028; GLOSSARY › Vacancy; workflow-engine.md §9; visibility.md "A Participant's
// withdrawal"; scenarios RP-1262-1 to RP-1262-7). C1's Project Admin withdraws K1 while K1 holds C1's
// item, then invites K2 as the new Consultant. K2 accepts, and the Vacancy passes to its Step Pool once
// its Visibility covers the item: only K2 gains the item, C1 reads it as held by K2 with no "Waiting for
// a new Consultant", the Vacancies card lists it no more, and K1, which left, reads nothing.
//
// The describes run in order on one Project. The Type is test-only, on the test Workflow (addSendBackType).
import { createDb } from "@rabaed/db";
import { drainOutbox, expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import {
  workItemSearchParams,
  type NotificationList,
  type ParticipantVisibility,
  type ProjectVacancies,
  type WorkItemDetail,
  type WorkItemList,
  type WorkItemQueryInput,
} from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, memberOnProject, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi();
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
afterAll(async () => {
  await api.close();
  await worker.destroy();
});

const TYPE = "VHPS";
const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "datasheet", type: "attachments", label: bilingual("Datasheet"), contentTypes: ["application/pdf"] },
      ],
    },
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

let c1: Company; // The Host Company; its Authorized Person is the Project Admin, on the Project too.
let c1Engineer: Caller;
let c1Pm: Caller;
let k1: Company; // The Consultant withdrawn while it holds C1's item.
let k1Engineer: Caller;
let k1Manager: Caller;
let c2: Company; // A Contractor, on the Project throughout.
let c2Engineer: Caller;
let k2: Company; // The replacement Consultant.
let k2Engineer: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";
let buildingB = "";
const participant = { c1: "", k1: "", c2: "", k2: "" };
let item = ""; // C1's item K1 held when it was withdrawn.

const names = new Map<Caller, string>();
const nameOf = (by: Caller) => names.get(by) ?? "a caller";

/** A Consultant C1 invites, which accepts, with one engineer and (unless `covering` is false) every Visibility. */
type Joined = { company: Company; id: string; engineer: Caller };
async function consultant(name: string, covering = true): Promise<Joined> {
  const company = await api.authorizedPerson();
  const id = await api.addParticipant(c1.caller, projectId, company.company, "consultant");
  const engineer = await projectMember(api, company, id, ["engineer"]);
  if (covering) await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
  names.set(company.caller, `${name}'s Authorized Person`);
  names.set(engineer, `the ${name} engineer`);
  return { company, id, engineer };
}
let k3: Joined; // RP-1262-4: overlaps K4, then holds C1's items, then is withdrawn (RP-1262-5).
let k4: Joined; // RP-1262-4: narrowed; RP-1262-5: given Building A only; RP-1262-6: withdrawn.
let k5: Joined; // RP-1262-6: takes K4's items; RP-1262-7: withdrawn, then invited again.
let items: string[] = []; // C1's two items at Building A (RP-1262-4 on).

const itemById = (id: string) => readById<WorkItemDetail>(`/v1/work-items/${id}`);
async function list(by: Caller, query: WorkItemQueryInput = {}): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${projectId}/work-items?${workItemSearchParams(query)}`), 200)).json();
}
/** The List's rows; none for a caller not on the Project (404, as for a Project that does not exist). */
const listed = (query: WorkItemQueryInput = {}) => async (by: Caller) => {
  const res = await by.get(`/v1/projects/${projectId}/work-items?${workItemSearchParams(query)}`);
  if (res.statusCode === 404) return [];
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as WorkItemList).items;
};
const vacancies = (by: Caller) => readById<ProjectVacancies>(`/v1/projects/${projectId}/vacancies`)(by);
const vacancyItems = async (by: Caller) => (await vacancies(by)).flatMap((v) => v.vacancies.map((x) => ({ id: x.item?.id ?? x.id })));
const bell = async (by: Caller) =>
  ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications.filter((n) => n.workItemId === item).map((n) => n.kind);

beforeAll(async () => {
  const migrator = createDb(urls.migrator, { max: 1 });
  await addSendBackType(migrator, TYPE, { en: "Pass a Vacancy", ar: "نقل الشاغر" }, schema, { withCancel: true });
  await migrator.destroy();
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  buildingB = await post("locations", { code: "BB", name: bilingual("Building B"), parentId: null });
  participant.c1 = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${participant.c1}/visibility`, { trade: all, location: all }));
  // The Project Admin is on the Project and sees every item, so the Vacancies list names the item to them.
  await api.addProjectMember(c1.caller, participant.c1, c1.company.authorizedPerson.id);
  await ok(c1.caller.request("PUT", `/v1/participants/${participant.c1}/members/${c1.company.authorizedPerson.id}/visibility`, { trade: all, location: all }));
  c1Engineer = await projectMember(api, c1, participant.c1, ["engineer"]);
  c1Pm = await projectMember(api, c1, participant.c1, ["project_manager"]);
  const join = async (role: "contractor" | "consultant") => {
    const company = await api.authorizedPerson();
    const id = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
    return { company, id };
  };
  const k = await join("consultant");
  k1 = k.company;
  participant.k1 = k.id;
  k1Engineer = await projectMember(api, k1, participant.k1, ["engineer"]);
  k1Manager = (await memberOnProject(api, k1, participant.k1, ["manager"])).caller;
  const c = await join("contractor");
  c2 = c.company;
  participant.c2 = c.id;
  c2Engineer = await projectMember(api, c2, participant.c2, ["engineer"]);
  for (const [by, name] of [
    [c1.caller, "C1's Project Admin"],
    [c1Engineer, "the C1 engineer"],
    [c1Pm, "the C1 PM"],
    [k1.caller, "K1's Authorized Person"],
    [k1Engineer, "the K1 engineer"],
    [k1Manager, "the K1 manager"],
    [c2.caller, "C2's Authorized Person"],
    [c2Engineer, "the C2 engineer"],
  ] as const)
    names.set(by, name);

  // C1's item, at K1's review, picked up by K1's engineer; then K1 is withdrawn.
  const created = await ok(c1Engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Cable tray", answers: { model: "Cable tray", trade: electrical, location: buildingA } }), 201);
  item = created.json().id as string;
  await take(c1Engineer, item, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${item}/pick-up`));
  await take(c1Pm, item, "submit");
  await ok(k1Engineer.post(`/v1/work-items/${item}/pick-up`));
  await ok(c1.caller.post(`/v1/participants/${participant.k1}/withdraw`));
  await drainOutbox(worker);
});

describe("scenario RP-1262-1: the Vacancy passes to the replacement's Step Pool, and shows there and nowhere else", () => {
  let stepEnteredAt = "";

  it("waits while K2 is accepted with no Visibility: still 'Waiting for a new Consultant', and K2 reads nothing", async () => {
    k2 = await api.authorizedPerson();
    participant.k2 = await api.addParticipant(c1.caller, projectId, k2.company, "consultant");
    k2Engineer = await projectMember(api, k2, participant.k2, ["engineer"]);
    names.set(k2.caller, "K2's Authorized Person");
    names.set(k2Engineer, "the K2 engineer");
    const [d] = await itemById(item)(c1Engineer);
    expect(d!.vacancy?.projectRole.baseRole).toBe("consultant");
    stepEnteredAt = d!.stepEnteredAt!;
    expect((await vacancyItems(c1.caller)).map((v) => v.id)).toContain(item);
    await expectHiddenFrom({ read: itemById(item), target: item, seenBy: c1Engineer, hiddenFrom: [k2.caller, k2Engineer], name: nameOf, label: "before K2 covers it" });
  });

  it("passes once C1's Project Admin gives K2 Visibility of the item: K2's engineer holds it and is told", async () => {
    await api.later(60_000);
    await ok(c1.caller.request("PUT", `/v1/participants/${participant.k2}/visibility`, { trade: all, location: all }));
    await drainOutbox(worker);
    const [d] = await itemById(item)(k2Engineer);
    expect(d!.heldBy?.memberName).not.toBeNull();
    expect(d!.vacancy ?? null).toBeNull();
    // Need My Action: the Step is K2's engineer's own now.
    expect((await list(k2Engineer, { needMyAction: true })).items.map((i) => i.id)).toContain(item);
    expect(await bell(k2Engineer)).toEqual(["step_reached"]);
  });

  it("reads to C1 as held by K2, with no Vacancy, and Step Age counts from the hand-off", async () => {
    for (const by of [c1.caller, c1Engineer, c1Pm]) {
      const [d] = await itemById(item)(by);
      // Held by another Company: its name only, never its person (V14).
      expect({ held: d!.heldBy !== null, member: d!.heldBy?.memberName ?? null, vacancy: d!.vacancy ?? null }, nameOf(by)).toEqual({ held: true, member: null, vacancy: null });
      expect(d!.stepEnteredAt, nameOf(by)).not.toBe(stepEnteredAt);
      const row = (await list(by)).items.find((i) => i.id === item)!;
      expect({ with: row.with?.kind, vacancy: row.vacancy ?? null }, `${nameOf(by)}'s row`).toEqual({ with: "company", vacancy: null });
    }
    // The "With" filter finds it with K2, by K2's Participant id.
    await expectHiddenFrom({ read: listed({ with: [`company:${participant.k2}`] }), target: item, seenBy: [c1Engineer, c1Pm], hiddenFrom: [c2Engineer], name: nameOf, label: "With K2" });
  });

  it("leaves the Vacancies card, for C1's Project Admin", async () => {
    expect((await vacancies(c1.caller))[0]!.vacancies).toEqual([]); // not hidden-from: the same Admin's list held the item before the hand-off (first test)
  });

  it("writes one shared 'Passed on by Rabaed' event, with no Member, that C1 reads", async () => {
    const history = (await ok(c1Engineer.get(`/v1/work-items/${item}/history`), 200)).json() as { events: { type: string; audience: string; by: { memberName: unknown } }[] };
    // C1's own pool-of-one events are internal to C1; the hand-off is the one shared `assigned` event.
    expect(history.events.filter((e) => e.type === "assigned" && e.audience === "shared").map((e) => ({ audience: e.audience, member: e.by.memberName }))).toEqual([{ audience: "shared", member: null }]);
  });
});

describe("scenario RP-1262-2: no other Participant gains the item", () => {
  it("leaves it hidden from C2, which never held it, while K2 and C1 read it", async () => {
    await expectHiddenFrom({ read: itemById(item), target: item, seenBy: [k2Engineer, c1Engineer], hiddenFrom: [c2.caller, c2Engineer], name: nameOf, label: "the item" });
    await expectHiddenFrom({ read: listed(), target: item, seenBy: [k2Engineer, c1Engineer], hiddenFrom: [c2.caller, c2Engineer], name: nameOf, label: "the List" });
  });
});

describe("scenario RP-1262-3: the withdrawn Company reads nothing new", () => {
  it("leaves K1's Members without the item or the Project, and without a notice of it", async () => {
    const k1s = [k1.caller, k1Engineer, k1Manager];
    await expectHiddenFrom({ read: itemById(item), target: item, seenBy: k2Engineer, hiddenFrom: k1s, name: nameOf, label: "the item" });
    await expectHiddenFrom({ read: readById(`/v1/projects/${projectId}`), target: projectId, seenBy: k2Engineer, hiddenFrom: k1s, name: nameOf, label: "the Project" });
    for (const by of k1s) expect(await bell(by), nameOf(by)).not.toContain("step_reached"); // not hidden-from: K2's engineer's bell above holds the item's "Step reached"
  });
});

describe("scenario RP-1262-4: with two covering Consultants nobody is picked; narrowing one passes the Vacancies to the other", () => {
  it("keeps both Vacancies while K3 and K4 cover the items, then gives them to K3 once K4 is narrowed", async () => {
    // A second item of C1's, which only K2 covers when it is Submitted, so it reaches K2.
    const created = await ok(c1Engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Busbar", answers: { model: "Busbar", trade: electrical, location: buildingA } }), 201);
    const second = created.json().id as string;
    await take(c1Engineer, second, "send_for_review");
    await ok(c1Pm.post(`/v1/work-items/${second}/pick-up`));
    await take(c1Pm, second, "submit");
    k3 = await consultant("K3");
    k4 = await consultant("K4");
    await ok(c1.caller.post(`/v1/participants/${participant.k2}/withdraw`));
    items = [item, second];
    expect((await vacancyItems(c1.caller)).map((v) => v.id).sort()).toEqual([...items].sort());
    // Under the Overlap, neither covering Consultant gains either item.
    for (const id of items) {
      await expectHiddenFrom({ read: itemById(id), target: id, seenBy: c1Engineer, hiddenFrom: [k3.company.caller, k3.engineer, k4.company.caller, k4.engineer], name: nameOf, label: "under the Overlap" });
    }
    // C1's Project Admin narrows K4 to no Trade: K3 is the one Consultant covering them.
    await ok(c1.caller.request("PUT", `/v1/participants/${k4.id}/visibility`, { trade: { isAll: false, valueIds: [] }, location: all }));
    for (const id of items) {
      const [d] = await itemById(id)(k3.engineer);
      expect(d!.heldBy?.memberName, "K3's pool of one holds it").not.toBeNull();
      await expectHiddenFrom({ read: itemById(id), target: id, seenBy: [k3.engineer, c1Engineer], hiddenFrom: [k4.company.caller, k4.engineer, k2Engineer, c2Engineer], name: nameOf, label: "after K4 is narrowed" });
    }
    expect((await vacancies(c1.caller))[0]!.vacancies).toEqual([]); // not hidden-from: the same Admin's list held both items above
  });
});

let third = ""; // C1's item at Building B, held by K3 when it is withdrawn (RP-1262-5).

describe("scenario RP-1262-5: a Visibility change of several values that passes a Vacancy is saved in full", () => {
  it("saves K4's new Trade and Location together, passing the Building A items and not Building B's", async () => {
    const created = await ok(c1Engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Conduit", answers: { model: "Conduit", trade: electrical, location: buildingB } }), 201);
    third = created.json().id as string;
    await take(c1Engineer, third, "send_for_review");
    await ok(c1Pm.post(`/v1/work-items/${third}/pick-up`));
    await take(c1Pm, third, "submit");
    await ok(c1.caller.post(`/v1/participants/${k3.id}/withdraw`));
    expect((await vacancyItems(c1.caller)).map((v) => v.id).sort()).toEqual([...items, third].sort());
    // Saved Trade first, the change would cover Building B's item with K4's old every-Location, and its
    // Step, once passed, would refuse the Location that follows. The whole change is judged instead.
    const visibility = `/v1/participants/${k4.id}/visibility`;
    await ok(c1.caller.request("PUT", visibility, { trade: { isAll: false, valueIds: [electrical] }, location: { isAll: false, valueIds: [buildingA] } }));
    const saved = (await ok(c1.caller.get(visibility), 200)).json() as ParticipantVisibility;
    expect(saved.visibility).toEqual({ trade: { isAll: false, valueIds: [electrical] }, location: { isAll: false, valueIds: [buildingA] } });
    for (const id of items) {
      const [d] = await itemById(id)(k4.engineer);
      expect(d!.heldBy?.memberName, "K4's pool of one holds it").not.toBeNull();
    }
    const [d] = await itemById(third)(c1Engineer);
    expect(d!.vacancy?.projectRole.baseRole, "Building B is not K4's").toBe("consultant");
    await expectHiddenFrom({ read: itemById(third), target: third, seenBy: c1Engineer, hiddenFrom: [k4.company.caller, k4.engineer], name: nameOf, label: "Building B's item" });
  });
});

describe("scenario RP-1262-6: a withdrawal passes a Vacancy at once to the one other Participant of the role covering it", () => {
  it("gives K4's items to K5 as K4 is withdrawn, and nobody else gains them", async () => {
    k5 = await consultant("K5");
    // Building B's Vacancy was K5's alone to cover: it passed as K5 was given Visibility.
    expect((await itemById(third)(k5.engineer))[0]!.heldBy?.memberName).not.toBeNull();
    await ok(c1.caller.post(`/v1/participants/${k4.id}/withdraw`));
    for (const id of items) {
      const [d] = await itemById(id)(k5.engineer);
      expect(d!.heldBy?.memberName, "K5's pool of one holds it at once").not.toBeNull();
      await expectHiddenFrom({
        read: itemById(id),
        target: id,
        seenBy: [k5.engineer, c1Engineer],
        hiddenFrom: [k4.company.caller, k4.engineer, k3.engineer, k2Engineer, c2Engineer],
        name: nameOf,
        label: "after K4's withdrawal",
      });
    }
    expect((await vacancies(c1.caller))[0]!.vacancies).toEqual([]); // not hidden-from: the same Admin's list held three Vacancies in RP-1262-5
  });
});

describe("scenario RP-1262-7: a withdrawn Company invited again never takes back its own old Vacancies", () => {
  it("leaves K5's Steps vacant when K5 comes back as a fresh Consultant covering every item, the only one", async () => {
    await ok(c1.caller.post(`/v1/participants/${k5.id}/withdraw`));
    // RP-1261: invited again and accepting, K5 is a new Participant of the same Company, given every Visibility.
    const again = await api.addParticipant(c1.caller, projectId, k5.company.company, "consultant");
    expect(again).not.toBe(k5.id);
    const engineer = await projectMember(api, k5.company, again, ["engineer"]);
    names.set(engineer, "K5's new engineer");
    await ok(c1.caller.request("PUT", `/v1/participants/${again}/visibility`, { trade: all, location: all }));
    const all3 = [...items, third];
    expect((await vacancyItems(c1.caller)).map((v) => v.id).sort()).toEqual([...all3].sort());
    for (const id of all3) {
      const [d] = await itemById(id)(c1Engineer);
      expect(d!.vacancy?.projectRole.baseRole, "still Waiting for a new Consultant").toBe("consultant");
      await expectHiddenFrom({ read: itemById(id), target: id, seenBy: c1Engineer, hiddenFrom: [k5.company.caller, k5.engineer, engineer], name: nameOf, label: "K5 invited again" });
    }
  });
});
