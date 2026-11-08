// Seam 1 for withdrawing a Participant (RP-952, ADR 0028; visibility.md "A Participant's withdrawal";
// workflow-engine.md §9; scenarios RP-952-1 to RP-952-5). Only the Host Company's Project Admin reads
// the counts-only preview and withdraws, never the Host Company itself. The withdrawn Company's items
// that left Draft are Cancelled by Rabaed, its Drafts too (with no Record), and its Steps on other
// Companies' items become Vacancies that every reader reads as "Waiting for a new ‹role›", never its
// Company. Its Authorized Person and Project Members are told, in the bell and by email, naming the
// Host Company; nobody else is. Its Members lose the Project. PR 2 (RP-952-6, RP-952-7): the Vacancies
// list names each Vacancy's Step, and only the Host Company's Project Admin reads the withdrawn Participants.
//
// The describes run in order on one Project: the refusals, then C2's withdrawal, then K1's.
// The Type is test-only, on the test Workflow with a Send Back and a Cancel (addSendBackType).
import { createDb, participantWithdrawnHandler, processOutbox } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import {
  workItemSearchParams,
  type NotificationList,
  type ParticipantWithdrawnEmail,
  type ProjectParticipants,
  type ProjectVacancies,
  type WorkItemBoard,
  type WorkItemDetail,
  type WorkItemList,
  type WorkItemQueryInput,
} from "@rabaed/domain";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, readById, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, memberOnProject, ok, only, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi();
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });

/** Every withdrawal email the worker sent. */
const sent: ParticipantWithdrawnEmail[] = [];
const handler = participantWithdrawnHandler(async (email) => void sent.push(email));
async function drain() {
  for (;;) {
    const run = await processOutbox(worker, { handlers: { participant_withdrawn: handler }, kinds: ["participant_withdrawn"] });
    if (run.processed + run.failed + run.dead === 0) return;
  }
}
afterAll(async () => {
  await drain();
  await api.close();
  await worker.destroy();
});

const TYPE = "WDPS";
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
let k1Engineer: Caller;
let k1Manager: { id: string; caller: Caller; email: string };
let c2: Company;
let c2Engineer: Caller;
let c2Pm: Caller;
let otherAdmin: Caller; // The Project Admin of another Project.
let projectId = "";
let electrical = "";
let buildingA = "";
const participant = { c1: "", k1: "", c2: "" };
let vacantItem = ""; // C1's item K1 held when it was withdrawn (RP-952-3, read again by RP-952-5).

const names = new Map<Caller, string>();
const nameOf = (by: Caller) => names.get(by) ?? "a caller";

const preview = (by: Caller, id: string) => by.get(`/v1/participants/${id}/withdrawal`);
const withdraw = (by: Caller, id: string) => by.post(`/v1/participants/${id}/withdraw`);

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
  await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

const itemById = (by: Caller, id: string) => readById<WorkItemDetail>(`/v1/work-items/${id}`)(by);
async function list(by: Caller, query: WorkItemQueryInput = {}): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${projectId}/work-items?${workItemSearchParams(query)}`), 200)).json();
}
async function board(by: Caller): Promise<WorkItemBoard> {
  return (await ok(by.get(`/v1/projects/${projectId}/work-items/kanban`), 200)).json();
}
const notices = async (by: Caller) =>
  ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications.filter((n) => n.kind === "participant_withdrawn" && n.project.id === projectId);

beforeAll(async () => {
  const migrator = createDb(urls.migrator, { max: 1 });
  await addSendBackType(migrator, TYPE, { en: "Withdraw a Participant", ar: "سحب مشارك" }, schema, { withCancel: true });
  await migrator.destroy();
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
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
  k1Manager = await memberOnProject(api, k1, participant.k1, ["manager"]);
  const c = await join("contractor");
  c2 = c.company;
  participant.c2 = c.id;
  c2Engineer = await projectMember(api, c2, participant.c2, ["engineer"]);
  c2Pm = await projectMember(api, c2, participant.c2, ["project_manager"]);
  const elsewhere = await api.projectCreator();
  await api.createProject(elsewhere.caller);
  otherAdmin = elsewhere.caller;
  for (const [by, name] of [
    [c1.caller, "C1's Project Admin"],
    [c1Engineer, "the C1 engineer"],
    [c1Pm, "the C1 PM"],
    [k1.caller, "K1's Authorized Person"],
    [k1Engineer, "the K1 engineer"],
    [k1Manager.caller, "the K1 manager"],
    [c2.caller, "C2's Authorized Person"],
    [c2Engineer, "the C2 engineer"],
    [c2Pm, "the C2 PM"],
    [otherAdmin, "another Project's Project Admin"],
  ] as const)
    names.set(by, name);
});

describe("scenario RP-952-2: only the Host Company's Project Admin previews or withdraws, never the Host Company itself", () => {
  it("answers everyone else with the plain 404, as for an id that does not exist", async () => {
    const refused = [c1Engineer, c1Pm, k1.caller, c2.caller, otherAdmin];
    await expectHiddenFrom({
      read: readById(`/v1/participants/${participant.c2}/withdrawal`),
      idOf: () => participant.c2,
      target: participant.c2,
      seenBy: c1.caller,
      hiddenFrom: refused,
      name: nameOf,
      label: "the preview",
    });
    for (const by of refused) {
      await expectHidden(withdraw(by, participant.c2), `${nameOf(by)}'s withdrawal`); // not hidden-from: a refused command, not a read; C1's own withdrawal of C2 is RP-952-1's
    }
    await expectHidden(preview(c1.caller, randomUUID()), "a made-up id's preview"); // not hidden-from: an id that does not exist, the 404 the others must match
    await expectHidden(withdraw(c1.caller, randomUUID()), "a made-up id's withdrawal"); // not hidden-from: an id that does not exist, the 404 the others must match
    // The C2 engineer still reads the Project: nothing changed.
    expect((await c2Engineer.get(`/v1/projects/${projectId}`)).statusCode).toBe(200);
  });

  it("refuses the Host Company itself with 409 host_company", async () => {
    for (const res of [await preview(c1.caller, participant.c1), await withdraw(c1.caller, participant.c1)]) {
      expect({ status: res.statusCode, error: res.json().error }).toEqual({ status: 409, error: "host_company" });
    }
  });
});

describe("scenario RP-952-1: C1's Project Admin withdraws C2, which has an item with K1 and a Draft", () => {
  let submitted = "";
  let c2Draft = "";

  beforeAll(async () => {
    submitted = await atK1(c2Engineer, c2Pm, "WDPS-S");
    c2Draft = await draftOf(c2Engineer, "WDPS-D");
  });

  it("the preview gives the Project Admin counts only, never the Draft", async () => {
    const res = await ok(preview(c1.caller, participant.c2), 200);
    expect(res.json()).toEqual({ itemsToCancel: 1, stepsToVacate: 0 });
  });

  it("C2's Draft was never read by C1 or K1", async () => {
    await expectHiddenFrom({ read: readById(`/v1/work-items/${c2Draft}`), target: c2Draft, seenBy: c2Engineer, hiddenFrom: [c1.caller, c1Engineer, k1Engineer], name: nameOf });
  });

  it("Cancels the item that left Draft by Rabaed: K1, which held it, reads it Cancelled, in a Cancelled Stage", async () => {
    await ok(withdraw(c1.caller, participant.c2));
    await expectHiddenFrom({
      read: async (by) => (await itemById(by, submitted)).filter((d) => d.outcome === "cancelled" && d.closedAt !== null && d.stage.category === "cancelled"),
      target: submitted,
      seenBy: [k1Engineer, k1Manager.caller],
      hiddenFrom: [c1Engineer, c2Engineer],
      name: nameOf,
      label: "the Cancelled item",
    });
    const history = await ok(k1Engineer.get(`/v1/work-items/${submitted}/history`), 200);
    expect(history.body).toContain("cancelled");
  });

  it("leaves C2's Members with neither item, and nobody else with the Draft", async () => {
    const c2s = [c2Engineer, c2Pm, c2.caller];
    await expectHiddenFrom({ read: readById(`/v1/work-items/${submitted}`), target: submitted, seenBy: k1Engineer, hiddenFrom: c2s, name: nameOf, label: "the Cancelled item" });
    await expectHiddenFrom({ read: readById(`/v1/projects/${projectId}`), target: projectId, seenBy: c1Engineer, hiddenFrom: c2s, name: nameOf, label: "the Project" });
    for (const by of [c1.caller, c1Engineer, k1Engineer, c2Engineer]) {
      await expectHidden(by.get(`/v1/work-items/${c2Draft}`), `${nameOf(by)}: the Draft`); // not hidden-from: nobody may read a withdrawn Company's Draft any more; the test above read it as C2 before
    }
  });
});

describe("scenario RP-952-3: C1's Project Admin withdraws K1 while K1 holds C1's item: a Participant-level Vacancy", () => {
  let item = "";
  let stepEnteredAt: string | null = null;

  beforeAll(async () => {
    item = await atK1(c1Engineer, c1Pm, "WDPS-V");
    vacantItem = item;
    // K1 Sends it Back once, so a move of K1's stays in C1's history; C1 Submits it again and K1 picks it up.
    await take(k1Engineer, item, "send_back");
    await take(c1Pm, item, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${item}/pick-up`));
    stepEnteredAt = (await itemById(c1Engineer, item))[0]!.stepEnteredAt;
  });

  it("the preview counts the Step that becomes a Vacancy, and no item", async () => {
    expect((await ok(preview(c1.caller, participant.k1), 200)).json()).toEqual({ itemsToCancel: 0, stepsToVacate: 1 });
  });

  it("before: the List's With filter finds it with K1", async () => {
    expect((await list(c1Engineer, { with: [`company:${participant.k1}`] })).items.map((i) => i.id)).toContain(item);
  });

  it("after: every reader reads 'Waiting for a new Consultant', never K1, in the List, the Kanban and the item", async () => {
    await ok(withdraw(c1.caller, participant.k1));
    for (const by of [c1.caller, c1Engineer, c1Pm]) {
      const row = (await list(by)).items.find((i) => i.id === item)!;
      expect({ with: row.with, vacancy: row.vacancy?.projectRole.baseRole }, `${nameOf(by)}'s row`).toEqual({ with: null, vacancy: "consultant" });
      const card = (await board(by)).columns.flatMap((c) => c.lanes.flatMap((l) => l.cards)).find((c) => c.id === item)!;
      expect(card.vacancy?.projectRole.baseRole, `${nameOf(by)}'s card`).toBe("consultant");
      const [d] = await itemById(by, item);
      expect({ heldBy: d!.heldBy, vacancy: d!.vacancy?.projectRole.baseRole }, `${nameOf(by)}'s item`).toEqual({ heldBy: null, vacancy: "consultant" });
      // Step Age keeps counting from when it reached K1.
      expect(d!.stepEnteredAt).toBe(stepEnteredAt);
      // Every test Company has the same legal name, so the check is that nothing reads K1 as its holder: no K1 id either.
      expect(JSON.stringify({ row, card, d }), `${nameOf(by)}: K1's Participant`).not.toContain(participant.k1); // not hidden-from: the rows were read above; this checks they hold no K1 id
    }
    // The With filter by K1 finds nothing now, for anyone; the test before found the item there.
    expect((await list(c1Engineer, { with: [`company:${participant.k1}`] })).items.map((i) => i.id)).not.toContain(item); // not hidden-from: the same read found it before the withdrawal
  });

  it("lists the Vacancy, with its item, for C1's Project Admin only", async () => {
    const vacancies = readById<ProjectVacancies>(`/v1/projects/${projectId}/vacancies`);
    const read = async (by: Caller) => (await vacancies(by)).flatMap((v) => v.vacancies.map((x) => ({ ...x, id: x.item?.id ?? x.id })));
    const [row] = (await read(c1.caller)).filter((v) => v.id === item);
    expect(row).toMatchObject({ item: { id: item }, projectRole: { baseRole: "consultant" } });
    await expectHiddenFrom({ read, target: item, seenBy: c1.caller, hiddenFrom: [c1Engineer, c1Pm, k1.caller, otherAdmin], name: nameOf, label: "the Vacancies list" });
  });
});

describe("scenario RP-952-4: the withdrawal's notices reach K1's Authorized Person and Project Members only", () => {
  it("gives each of them one in-app notice naming the Host Company and the Project", async () => {
    for (const by of [k1.caller, k1Engineer, k1Manager.caller]) {
      const found = await notices(by);
      expect(found, nameOf(by)).toHaveLength(1); // not hidden-from: one notice delivered, the positive side
      expect(found[0], nameOf(by)).toMatchObject({ workItemId: null, project: { id: projectId }, hostCompany: { legalName: expect.any(Object) } }); // not hidden-from: what the notice names
    }
  });

  it("emails each of them once, naming the Host Company and the Project, never the person", async () => {
    await drain();
    const toK1 = sent.filter((e) => [k1.company.authorizedPerson.email, k1Manager.email].includes(e.to));
    expect(toK1).toHaveLength(2); // not hidden-from: one email each, the positive side
    for (const email of toK1) expect(Object.keys(email).sort()).toEqual(["hostCompanyName", "language", "projectName", "to"]);
  });

  it("gives nobody else a withdrawal notice", async () => {
    for (const by of [c1.caller, c1Engineer, c1Pm]) {
      expect(await notices(by), nameOf(by)).toEqual([]); // not hidden-from: no notice is made for them; K1's notices above prove the delivery ran
    }
    // C2's Members hold only the notice of C2's own withdrawal, none of K1's.
    for (const by of [c2.caller, c2Engineer]) expect(await notices(by), nameOf(by)).toHaveLength(1); // not hidden-from: only their own withdrawal's notice
  });
});

describe("scenario RP-952-5: after the withdrawal, K1's Members lose the Project, and what K1 did stays", () => {
  it("K1's Members no longer read the Project or its items", async () => {
    await expectHiddenFrom({ read: readById(`/v1/work-items/${vacantItem}`), target: vacantItem, seenBy: [c1Engineer, c1Pm], hiddenFrom: [k1Engineer, k1Manager.caller, k1.caller], name: nameOf, label: "the item" });
    await expectHiddenFrom({ read: readById(`/v1/projects/${projectId}`), target: projectId, seenBy: [c1Engineer, c1.caller], hiddenFrom: [k1Engineer, k1Manager.caller, k1.caller], name: nameOf, label: "the Project" });
  });

  it("C1 still reads K1's Send Back in the item's history", async () => {
    const history = (await ok(c1Engineer.get(`/v1/work-items/${vacantItem}/history`), 200)).json() as { events: { transition: { en: string } | null }[] };
    expect(history.events.map((e) => e.transition?.en)).toContain("Send Back");
  });

  it("refuses a second withdrawal as for an id that does not exist", async () => {
    await expectHidden(withdraw(c1.caller, participant.k1)); // not hidden-from: a refused command; the first withdrawal of K1 is RP-952-3's
    await expectHidden(preview(c1.caller, participant.k1)); // not hidden-from: nobody may preview a withdrawn Participant; C1 previewed K1 in RP-952-3
  });
});

describe("scenario RP-952-6: the Vacancies list names each Vacancy's Step, and nothing more of an item the Admin doesn't see", () => {
  const steps = async (by: Caller) =>
    (await readById<ProjectVacancies>(`/v1/projects/${projectId}/vacancies`)(by)).flatMap((v) => v.vacancies.map((x) => ({ ...x, id: `${x.id}:${x.step.name.en}` })));
  const theRow = async (by: Caller) => (await ok(by.get(`/v1/projects/${projectId}/vacancies`), 200)).json() as ProjectVacancies;

  it("gives C1's Project Admin the Step it waits at, and nobody else", async () => {
    const [row] = (await theRow(c1.caller)).vacancies;
    expect(row!.step.name.en).toBe("Consultant review");
    await expectHiddenFrom({
      read: steps,
      target: `${row!.id}:${row!.step.name.en}`,
      seenBy: c1.caller,
      hiddenFrom: [c1Engineer, c1Pm, c2.caller, k1.caller, otherAdmin],
      name: nameOf,
      label: "the Vacancy's Step",
    });
  });

  it("to the Admin once they don't see the item: its Step and role only, never its id, Document Number, Subject or a Company", async () => {
    // C1's Project Admin narrows their own Visibility to a Location the item is not at; then puts it back.
    const elsewhere = (await ok(c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BZ", name: bilingual("Building Z"), parentId: null }), 201)).json().id as string;
    const mine = `/v1/participants/${participant.c1}/members/${c1.company.authorizedPerson.id}/visibility`;
    const seen = (await theRow(c1.caller)).vacancies.find((v) => v.item?.id === vacantItem)!;
    await ok(c1.caller.request("PUT", mine, { trade: all, location: only(elsewhere) }));
    try {
      const unseen = (await theRow(c1.caller)).vacancies.find((v) => v.id === seen.id)!;
      expect(unseen).toEqual({ id: seen.id, item: null, projectRole: seen.projectRole, step: seen.step, vacantSince: seen.vacantSince });
      expect(JSON.stringify(unseen)).not.toContain(vacantItem); // not hidden-from: the same Admin read the item's id in this row a moment ago (`seen`)
    } finally {
      await ok(c1.caller.request("PUT", mine, { trade: all, location: all }));
    }
  });
});

describe("scenario RP-952-7: only the Host Company's Project Admin reads the withdrawn Participants", () => {
  const participants = (by: Caller) => readById<ProjectParticipants>(`/v1/projects/${projectId}/participants`)(by);

  it("lists C2 and K1 as withdrawn, with their Company and Project Role, to C1's Project Admin and nobody else", async () => {
    const [list] = await participants(c1.caller);
    expect(list!.canWithdraw).toBe(true);
    expect(list!.withdrawn.map((w) => [w.id, w.projectRole.baseRole]).sort()).toEqual(
      [
        [participant.c2, "contractor"],
        [participant.k1, "consultant"],
      ].sort(),
    );
    for (const w of list!.withdrawn) expect(w.withdrawnAt).toEqual(expect.any(String));
    for (const p of [participant.c2, participant.k1]) {
      await expectHiddenFrom({
        read: async (by) => (await participants(by)).flatMap((l) => l.withdrawn),
        target: p,
        seenBy: c1.caller,
        hiddenFrom: [c1Engineer, c1Pm],
        name: nameOf,
        label: "the withdrawn Participants",
      });
    }
    // The withdrawn Companies and another Project's Admin read no list of the Project at all.
    await expectHiddenFrom({ read: participants, idOf: () => projectId, target: projectId, seenBy: c1Engineer, hiddenFrom: [c2.caller, k1.caller, otherAdmin], name: nameOf, label: "the Participants" });
  });

  it("never lists them among the active Participants, and tells only the Host Company's Project Admin they may withdraw", async () => {
    const [admin] = await participants(c1.caller);
    // Positive control: the active list holds C1 itself.
    expect(admin!.participants.map((p) => p.id)).toEqual([participant.c1]);
    for (const by of [c1Engineer, c1Pm]) {
      const [list] = await participants(by);
      expect(list!.canWithdraw, nameOf(by)).toBe(false);
    }
  });
});
