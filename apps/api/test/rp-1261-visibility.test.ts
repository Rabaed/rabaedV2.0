// Seam 1 for inviting a withdrawn Company again (RP-1261, ADR 0028: "A withdrawn Company comes back
// only through a new Invitation"; visibility.md "A Participant's withdrawal"; scenarios RP-1261-1 to
// RP-1261-3). A new Invitation accepted by a withdrawn Company makes a fresh Participant, with a new
// id; the withdrawn one stays as it was, with its Cancelled items and its Vacancies. The Company's
// Members read what any new Participant reads: nothing of the earlier participation reopens, and
// their link to the withdrawn Participant counts for nothing. E2 (Signatory Access) is RP-614's, not
// built yet, so "plus E2" adds nothing here.
//
// The describes run in order on one Project. Setup: C1 the Host Company, K1 the Consultant, C2 and C3
// Contractors. C2's and C3's items at K1 are Cancelled by their withdrawals; C1's item at K1 becomes
// a Vacancy by K1's. Then C2 and K1 are invited again in their roles and accept; C3 is not.
// The Type is test-only, on the test Workflow with a Send Back and a Cancel (addSendBackType).
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import {
  workItemSearchParams,
  type DimensionValues,
  type NotificationSettingsView,
  type ProjectParticipants,
  type ProjectVacancies,
  type WorkItemDetail,
  type WorkItemList,
  type WorkItemQueryInput,
} from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, readById, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, memberOnProject, ok, only, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi();
const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });

const TYPE = "RIWA";
// A test-only Position holding Assign (no seeded one does), removed again at the end: Positions are shared.
const LEAD = "reinvite_lead_api";
afterAll(async () => {
  await sql`delete from project_member_position where position_id in (select id from position where key = ${LEAD})`.execute(migrator);
  await sql`delete from position_permission where position_id in (select id from position where key = ${LEAD})`.execute(migrator);
  await sql`delete from position where key = ${LEAD}`.execute(migrator);
  await api.close();
  await migrator.destroy();
});

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
let k1: Company;
let k1Engineer: { id: string; caller: Caller };
let k1Lead: { id: string; caller: Caller }; // On the withdrawn K1 with Assign and every Location; on the new K1 without Assign, at Building A only.
let c2: Company;
let c2Engineer: { id: string; caller: Caller };
let c2Pm: { id: string; caller: Caller };
let c3: Company;
let c3Engineer: Caller;
let c3Pm: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";
let buildingB = "";
let c1Participant = "";
const old = { k1: "", c2: "", c3: "" }; // The withdrawn Participants.
const fresh = { k1: "", c2: "" }; // The Participants the new Invitations made.
let vacantItem = ""; // C1's item K1 held when it was withdrawn: a Vacancy.
let c2Cancelled = ""; // C2's item at K1, Cancelled by C2's withdrawal.
let c2Draft = ""; // C2's Draft, Cancelled with no Record.
let c3Cancelled = ""; // C3's item at K1, Cancelled by C3's withdrawal.
let c1New = ""; // C1's item at the K1 that is back (RP-1261-1).
let c2New = ""; // C2's item, raised by the C2 that is back, at the K1 that is back (RP-1261-1).

const names = new Map<Caller, string>();
const nameOf = (by: Caller) => names.get(by) ?? "a caller";

async function draftOf(by: Caller, model: string): Promise<string> {
  const res = await ok(by.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: electrical, location: buildingA } }), 201);
  return res.json().id as string;
}

/** `engineer` sends the Draft for review, `pm` Submits it, and K1's engineer picks it up. */
async function atK1(engineer: Caller, pm: Caller, model: string): Promise<string> {
  const id = await draftOf(engineer, model);
  await take(engineer, id, "send_for_review");
  await ok(pm.post(`/v1/work-items/${id}/pick-up`));
  await take(pm, id, "submit");
  await ok(k1Engineer.caller.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

const itemById = (by: Caller, id: string) => readById<WorkItemDetail>(`/v1/work-items/${id}`)(by);
async function list(by: Caller, query: WorkItemQueryInput = {}): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${projectId}/work-items?${workItemSearchParams(query)}`), 200)).json();
}
const participants = (by: Caller) => readById<ProjectParticipants>(`/v1/projects/${projectId}/participants`)(by);
const withdraw = (id: string) => ok(c1.caller.post(`/v1/participants/${id}/withdraw`));
const invite = (company: Company, role: "contractor" | "consultant") => c1.caller.post(`/v1/projects/${projectId}/participants`, { crNumber: company.company.crNumber, role });
const invitations = async (company: Company) =>
  ((await ok(company.caller.get("/v1/participant-invitations"), 200)).json() as { invitations: { id: string }[] }).invitations;

/** Its Authorized Person puts `memberId` on Participant `participantId` again, with `positions`, every Trade, and every Location or only `location`. */
async function again(company: Company, participantId: string, memberId: string, positions: string[], location: string | null = null) {
  await api.addProjectMember(company.caller, participantId, memberId);
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${memberId}/visibility`, { trade: all, location: location === null ? all : only(location) }));
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${memberId}/positions`, { positions }));
}

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Invite again", ar: "دعوة مجددا" }, schema, { withCancel: true });
  await sql`
    insert into position (owner_kind, base_role, key, name, sort)
    select 'rabaed', r, ${LEAD}, '{"en": "Lead (test)", "ar": "قائد (اختبار)"}', 99
    from unnest(array['contractor', 'consultant', 'owner', 'owner_representative']) r
    on conflict (base_role, key) do nothing
  `.execute(migrator);
  await sql`
    insert into position_permission (position_id, module_key, permission)
    select p.id, 'submittals', x from position p cross join unnest(array['view', 'assign']) x
    where p.key = ${LEAD}
    on conflict do nothing
  `.execute(migrator);
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  buildingB = await post("locations", { code: "BB", name: bilingual("Building B"), parentId: null });
  c1Participant = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1Participant}/visibility`, { trade: all, location: all }));
  // The Project Admin is on the Project and sees every item, so the Vacancies list names the item to them.
  await api.addProjectMember(c1.caller, c1Participant, c1.company.authorizedPerson.id);
  await ok(c1.caller.request("PUT", `/v1/participants/${c1Participant}/members/${c1.company.authorizedPerson.id}/visibility`, { trade: all, location: all }));
  c1Engineer = await projectMember(api, c1, c1Participant, ["engineer"]);
  c1Pm = await projectMember(api, c1, c1Participant, ["project_manager"]);
  const join = async (role: "contractor" | "consultant") => {
    const company = await api.authorizedPerson();
    const id = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
    return { company, id };
  };
  ({ company: k1, id: old.k1 } = await join("consultant"));
  k1Engineer = await memberOnProject(api, k1, old.k1, ["engineer"]);
  k1Lead = await memberOnProject(api, k1, old.k1, ["manager", LEAD]);
  ({ company: c2, id: old.c2 } = await join("contractor"));
  c2Engineer = await memberOnProject(api, c2, old.c2, ["engineer"]);
  c2Pm = await memberOnProject(api, c2, old.c2, ["project_manager"]);
  ({ company: c3, id: old.c3 } = await join("contractor"));
  c3Engineer = await projectMember(api, c3, old.c3, ["engineer"]);
  c3Pm = await projectMember(api, c3, old.c3, ["project_manager"]);
  for (const [by, name] of [
    [c1.caller, "C1's Project Admin"],
    [c1Engineer, "the C1 engineer"],
    [c1Pm, "the C1 PM"],
    [k1.caller, "K1's Authorized Person"],
    [k1Engineer.caller, "the K1 engineer"],
    [k1Lead.caller, "the K1 lead"],
    [c2.caller, "C2's Authorized Person"],
    [c2Engineer.caller, "the C2 engineer"],
    [c2Pm.caller, "the C2 PM"],
    [c3.caller, "C3's Authorized Person"],
    [c3Engineer, "the C3 engineer"],
    [c3Pm, "the C3 PM"],
  ] as const)
    names.set(by, name);

  c2Cancelled = await atK1(c2Engineer.caller, c2Pm.caller, "RIWA-C2");
  c2Draft = await draftOf(c2Engineer.caller, "RIWA-D");
  c3Cancelled = await atK1(c3Engineer, c3Pm, "RIWA-C3");
  vacantItem = await atK1(c1Engineer, c1Pm, "RIWA-V");
  // The Consultant read the Contractors' items before they left (C2's engineer its Draft): they exist.
  for (const id of [c2Cancelled, c3Cancelled]) expect((await itemById(k1Engineer.caller, id)).map((d) => d.id)).toEqual([id]);
  expect((await itemById(c2Engineer.caller, c2Draft)).map((d) => d.id)).toEqual([c2Draft]);
  for (const id of [old.c2, old.c3, old.k1]) await withdraw(id);
});

describe("scenario RP-1261-1: a withdrawn Company invited again and accepting is a fresh Participant", () => {
  it("is invited again as any Company is: 202, a new pending invitation with a new id, while it reads nothing", async () => {
    expect((await invite(k1, "consultant")).statusCode).toBe(202);
    const [pending] = await invitations(k1);
    fresh.k1 = pending!.id;
    expect(fresh.k1).not.toBe(old.k1);
    // Invited, not yet back: its Members still read no Project.
    await expectHiddenFrom({
      read: readById(`/v1/projects/${projectId}`),
      target: projectId,
      seenBy: c1Engineer,
      hiddenFrom: [k1Engineer.caller, k1Lead.caller],
      name: nameOf,
      label: "the Project while K1 is invited",
    });
  });

  it("accepting makes a fresh Participant, listed active to C1's Project Admin, with the withdrawn one still withdrawn", async () => {
    expect((await k1.caller.post(`/v1/participant-invitations/${fresh.k1}/accept`)).statusCode).toBe(204);
    fresh.c2 = await api.addParticipant(c1.caller, projectId, c2.company, "contractor");
    expect(fresh.c2).not.toBe(old.c2);
    const [admin] = await participants(c1.caller);
    expect(admin!.participants.map((p) => p.id).sort()).toEqual([c1Participant, fresh.k1, fresh.c2].sort());
    expect(admin!.withdrawn.map((w) => w.id).sort()).toEqual([old.k1, old.c2, old.c3].sort());
    // Back on the Project, a Company is invited no more than once.
    const res = await invite(k1, "consultant");
    expect({ status: res.statusCode, error: res.json().error }).toEqual({ status: 409, error: "already_participant" });
  });

  it("its Members read what any new Participant reads: only the items that reach it now", async () => {
    for (const id of [fresh.k1, fresh.c2]) await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
    // Its Authorized Person adds its Members again, as a new Participant's would; the lead now at Building A only, without Assign.
    await again(k1, fresh.k1, k1Engineer.id, ["engineer"]);
    await again(k1, fresh.k1, k1Lead.id, ["engineer"], buildingA);
    await again(c2, fresh.c2, c2Engineer.id, ["engineer"]);
    await again(c2, fresh.c2, c2Pm.id, ["project_manager"]);
    c1New = await atK1(c1Engineer, c1Pm, "RIWA-N1");
    c2New = await atK1(c2Engineer.caller, c2Pm.caller, "RIWA-N2");
    for (const by of [k1Engineer.caller, k1Lead.caller]) {
      expect((await list(by)).items.map((i) => i.id).sort(), nameOf(by)).toEqual([c1New, c2New].sort());
    }
    for (const by of [c2Engineer.caller, c2Pm.caller]) expect((await list(by)).items.map((i) => i.id), nameOf(by)).toEqual([c2New]);
    // The new K1 holds C1's new item, and C1 reads it with K1.
    expect((await list(c1Engineer, { with: [`company:${fresh.k1}`] })).items.map((i) => i.id)).toContain(c1New);
  });
});

describe("scenario RP-1261-2: nothing of the earlier participation reopens to the Company that is back", () => {
  // Its Members on the Project. Each old item is checked against the Members who read it in the earlier participation.
  const k1s = () => [k1Engineer.caller, k1Lead.caller];
  const c2s = () => [c2Engineer.caller, c2Pm.caller];
  const members = () => [...k1s(), ...c2s()];

  it("its Members read neither the old items it held nor the ones it raised: the Vacancy, the Cancelled items, the Draft", async () => {
    // K1's Members held C1's item until K1 left; C1's still read it.
    await expectHiddenFrom({ read: readById(`/v1/work-items/${vacantItem}`), target: vacantItem, seenBy: [c1Engineer, c1Pm], hiddenFrom: k1s(), name: nameOf, label: "the Vacancy's item" });
    for (const [id, readBefore] of [
      [c2Cancelled, members()], // C2 raised it, K1 held it
      [c3Cancelled, k1s()], // K1 held it
      [c2Draft, c2s()], // C2's own Draft
    ] as const) {
      for (const by of readBefore) {
        await expectHidden(by.get(`/v1/work-items/${id}`), `${nameOf(by)}: an item of the earlier participation`); // not hidden-from: nobody active reads it since its Companies left; these Members read it in the setup
      }
    }
  });

  it("the Vacancy stays where it was: 'Waiting for a new Consultant', with no holder, though a Consultant is back", async () => {
    for (const by of [c1.caller, c1Engineer, c1Pm]) {
      const row = (await list(by)).items.find((i) => i.id === vacantItem)!;
      expect({ with: row.with, vacancy: row.vacancy?.projectRole.baseRole }, `${nameOf(by)}'s row`).toEqual({ with: null, vacancy: "consultant" });
      const [d] = await itemById(by, vacantItem);
      expect({ heldBy: d!.heldBy, vacancy: d!.vacancy?.projectRole.baseRole }, `${nameOf(by)}'s item`).toEqual({ heldBy: null, vacancy: "consultant" });
      expect(JSON.stringify({ row, d }), `${nameOf(by)}: the new K1`).not.toContain(fresh.k1); // not hidden-from: the rows were read above; this checks the K1 that is back holds nothing of it
    }
    const vacancies = readById<ProjectVacancies>(`/v1/projects/${projectId}/vacancies`);
    const read = async (by: Caller) => (await vacancies(by)).flatMap((v) => v.vacancies.map((x) => ({ ...x, id: x.item?.id ?? x.id })));
    const [row] = (await read(c1.caller)).filter((v) => v.id === vacantItem);
    expect(row).toMatchObject({ item: { id: vacantItem }, projectRole: { baseRole: "consultant" } });
    await expectHiddenFrom({ read, target: vacantItem, seenBy: c1.caller, hiddenFrom: [...members(), k1.caller, c2.caller], name: nameOf, label: "the Vacancies list" });
  });

  it("the List's 'With' filter by the withdrawn K1 finds nothing, for C1 and for the Members back", async () => {
    for (const by of [c1Engineer, ...members()]) {
      expect((await list(by, { with: [`company:${old.k1}`] })).items, `${nameOf(by)}: With the withdrawn K1`).toEqual([]); // not hidden-from: the same filter by K1 found C1's item before K1 left (RP-952-3); the List itself is checked above
    }
    for (const by of members()) {
      const ids = (await list(by)).items.map((i) => i.id);
      for (const id of [vacantItem, c2Cancelled, c3Cancelled, c2Draft]) expect(ids, `${nameOf(by)}'s List`).not.toContain(id); // not hidden-from: each item checked by id above; this is the List's read
    }
  });

  it("their link to the withdrawn K1 counts for nothing: Visibility and the weekly report come from the new one", async () => {
    const mine = (await ok(k1Lead.caller.get(`/v1/projects/${projectId}/visibility`), 200)).json() as DimensionValues;
    // With the Project's Whole Project Location first, which any Location covers (RP-1304).
    const wholeProject = ((await ok(c1.caller.get(`/v1/projects/${projectId}/dimensions`), 200)).json() as DimensionValues).location.find((l) => l.wholeProject)!.id;
    expect(mine.location.map((v) => v.id)).toEqual([wholeProject, buildingA]);
    expect(mine.location.map((v) => v.id)).not.toContain(buildingB); // not hidden-from: the lead's own grant, read just above
    const settings = (await ok(k1Lead.caller.get("/v1/notification-settings"), 200)).json() as NotificationSettingsView;
    expect(settings.receivesWeeklyReport).toBe(false);
    // "Positions on my Projects": the new link's only.
    expect(settings.projects.find((p) => p.id === projectId)?.positions.map((p) => p.en)).toEqual(["Engineer"]);
  });
});

describe("scenario RP-1261-3: a withdrawn Company never invited again still reads nothing", () => {
  // C3's Project Members: each read the Project, its Participants, its Locations and C3's own item while C3 was on it.
  const c3s = () => [c3Engineer, c3Pm];

  it("reads no Project, nothing added to it since, and no item of its own", async () => {
    await expectHiddenFrom({ read: readById(`/v1/projects/${projectId}`), target: projectId, seenBy: [c1Engineer, k1Engineer.caller], hiddenFrom: c3s(), name: nameOf, label: "the Project" });
    await expectHiddenFrom({ read: readById(`/v1/projects/${projectId}/participants`), idOf: () => projectId, target: projectId, seenBy: [c1.caller, k1Engineer.caller], hiddenFrom: c3s(), name: nameOf, label: "the Participants" });
    // A Location added after the others came back: every Project Member reads the Project's Locations.
    const buildingC = (await ok(c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BC", name: bilingual("Building C"), parentId: null }), 201)).json().id as string;
    const locations = async (by: Caller) => (await readById<DimensionValues>(`/v1/projects/${projectId}/dimensions`)(by)).flatMap((d) => d.location);
    await expectHiddenFrom({ read: locations, target: buildingC, seenBy: [c1Engineer, k1Engineer.caller], hiddenFrom: c3s(), name: nameOf, label: "a new Location" });
    for (const by of c3s()) await expectHidden(by.get(`/v1/work-items/${c3Cancelled}`), `${nameOf(by)}: its own Cancelled item`); // not hidden-from: nobody active reads it since C3 left; C3's and K1's Members read it in the setup
  });

  it("has no invitation", async () => {
    expect(await invitations(c3)).toEqual([]); // not hidden-from: nothing was sent to hide
  });
});
