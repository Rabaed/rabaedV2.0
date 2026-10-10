// Seam 1 for an item Sent Back to its raiser (RP-309; ADR 0013, ADR 0014;
// visibility.md V1, V19, the Links, Linked from, Link search, Documents and
// Activity Feed channels, and scenarios 58, 59 and 60). Once Submitted, an item
// Sent Back to C1 stays with everyone who saw it: K1, the Owner Representative
// and the Owner go on seeing it, in their Link search and in the Linked from of
// the items it linked, as it was at the Send Back. What C1 adds, removes or
// changes while it holds the item (Documents, file-field uploads, photos,
// checklist items and photos, free Links and a link question's `relies_on`
// Links) stays inside C1's Participant until C1 Submits it again; then it is
// everyone's. C2, another Contractor, is never offered C1's item.
//
// The Type is test-only, on the test Workflow with a Send Back (addSendBackType).
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, LinkedFrom, LinkSearchResults, NotificationList, WorkItemHistory, WorkItemLinks } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller, type TestFile } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, detail, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([migrator.destroy(), worker.destroy()]);
});

const TYPE = "SBROW";
const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "datasheet", type: "attachments", label: bilingual("Datasheet"), contentTypes: ["application/pdf"] },
        { key: "sample_photos", type: "photos", label: bilingual("Sample photos") },
        {
          key: "pour_check",
          type: "checklist",
          label: bilingual("Pour check"),
          items: [{ key: "formwork", text: bilingual("Formwork"), answers: "pass_fail_na", comment: "optional", photo: "optional" }],
        },
        { key: "related", type: "work_item_ref", label: bilingual("Related submittals") },
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

let c1: Company;
let engineer: Caller; // C1 engineer: raises the items, and changes them while Sent Back.
let pm: Caller; // C1 PM: Submits.
let k1Engineer: Caller; // Holds Consultant review, and Sends Back.
let k1Pm: Caller; // Another K1 Member who sees the item, holding nothing.
let orEngineer: Caller; // Owner Representative (oversight).
let owner: Caller; // Owner (oversight).
let c2Engineer: Caller; // Another Contractor: never sees C1's items (V3).
let projectId = "";
let electrical = "";
let buildingA = "";

async function otherParticipant(role: "contractor" | "consultant" | "owner" | "owner_representative") {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return { company, participantId };
}

const save = async (id: string, changes: Record<string, unknown>) =>
  ok(engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await detail(engineer, id)).answers, ...changes } }));
const documentIds = async (by: Caller, id: string) =>
  ((await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json() as DocumentList).documents.map((d) => d.id).sort();
const links = async (by: Caller, id: string) =>
  ((await ok(by.get(`/v1/work-items/${id}/links`), 200)).json() as WorkItemLinks).links
    .map((l) => `${l.kind}:${l.workItemId}`)
    .sort();
const linkedFrom = async (by: Caller, id: string) =>
  ((await ok(by.get(`/v1/work-items/${id}/linked-from`), 200)).json() as LinkedFrom).items.map((i) => i.workItemId);
const linkSearch = async (by: Caller, q: string) =>
  (
    (await ok(by.get(`/v1/projects/${projectId}/work-items/link-search?${new URLSearchParams({ q })}`), 200)).json() as LinkSearchResults
  ).links.map((l) => l.id);
const history = async (by: Caller, id: string) => ((await ok(by.get(`/v1/work-items/${id}/history`), 200)).json() as WorkItemHistory).events;
const notificationsAbout = async (by: Caller, id: string) =>
  ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications.filter((n) => n.workItemId === id);

const pdf = (fileName: string): TestFile => ({ fieldKey: "datasheet", fileName, contentType: "application/pdf", body: `%PDF-1.7 ${fileName}` });
const photo = (fileName: string, itemKey?: string): TestFile => ({
  fieldKey: itemKey ? "pour_check" : "sample_photos",
  ...(itemKey ? { itemKey } : {}),
  fileName,
  contentType: "image/jpeg",
  body: jpegWithExif(),
});
const attachment = (fileName: string): TestFile => ({ fileName, contentType: "text/plain", body: `${fileName} (test)` });

async function draftOf(model: string, answers: Record<string, unknown> = {}): Promise<string> {
  const res = await ok(
    engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: electrical, location: buildingA, ...answers } }),
    201,
  );
  return res.json().id as string;
}

async function submit(id: string) {
  await take(engineer, id, "send_for_review");
  await ok(pm.post(`/v1/work-items/${id}/pick-up`));
  await take(pm, id, "submit");
}

async function submitted(model: string): Promise<string> {
  const id = await draftOf(model);
  await submit(id);
  return id;
}

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Sent Back rows submittal", ar: "اعتماد مُرجَع" }, schema);
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  const k1 = await otherParticipant("consultant");
  k1Engineer = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  k1Pm = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  const or = await otherParticipant("owner_representative");
  orEngineer = await projectMember(api, or.company, or.participantId, ["engineer"]);
  const ow = await otherParticipant("owner");
  owner = await projectMember(api, ow.company, ow.participantId, ["representative"]);
  const c2 = await otherParticipant("contractor");
  c2Engineer = await projectMember(api, c2.company, c2.participantId, ["engineer"]);
});

describe("C1 changes an item Sent Back to its Draft (scenarios 58, 59 and 71)", () => {
  // Linked by the item when it was Sent Back, and after it.
  let x = "";
  let y = "";
  let id = "";
  // What it had when it was Sent Back.
  let before: string[] = [];
  let freeToX = "";
  // What C1 adds while it holds it.
  let added: string[] = [];
  let k1Notified = 0;

  beforeAll(async () => {
    x = await submitted("SBR-X");
    y = await submitted("SBR-Y");
    id = await draftOf("SBR-1", { pour_check: { formwork: { answer: "pass" } }, related: [x] });
    before = [
      await uploadDocument(engineer, id, pdf("datasheet-1.pdf")),
      await uploadDocument(engineer, id, photo("sample-1.jpg")),
      await uploadDocument(engineer, id, photo("formwork-1.jpg", "formwork")),
      await uploadDocument(engineer, id, attachment("letter-1.txt")),
    ].sort();
    freeToX = (await ok(engineer.post(`/v1/work-items/${id}/links`, { workItemId: x }), 201)).json().id;
    await submit(id);
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Engineer, id, "send_back_to_draft");
    await drainOutbox(worker);
    k1Notified = (await notificationsAbout(k1Pm, id)).length;

    // C1, holding it in its Draft again.
    added = [
      await uploadDocument(engineer, id, pdf("datasheet-2.pdf")),
      await uploadDocument(engineer, id, photo("sample-2.jpg")),
      await uploadDocument(engineer, id, photo("formwork-2.jpg", "formwork")),
      await uploadDocument(engineer, id, attachment("letter-2.txt")),
    ];
    await save(id, { pour_check: { formwork: { answer: "fail", comment: "Bowed panel" } }, related: [y] });
    await ok(engineer.request("DELETE", `/v1/work-items/${id}/links/${freeToX}`));
    await ok(engineer.post(`/v1/work-items/${id}/links`, { workItemId: y }), 201);
    await take(engineer, id, "send_for_review");
    await drainOutbox(worker);
  });

  const asSentBack = () => [`related:${x}`, `relies_on:${x}`];
  const asResubmitted = () => [`related:${y}`, `relies_on:${y}`];

  it("still shows the item to K1, the Owner Representative and the Owner", async () => {
    for (const other of [k1Engineer, k1Pm, orEngineer, owner]) {
      expect((await detail(other, id)).documentNumber).not.toBeNull();
    }
  });

  it("shows them its Documents, photos and checklist photos as they were at the Send Back", async () => {
    for (const other of [k1Pm, orEngineer, owner]) expect(await documentIds(other, id)).toEqual(before);
  });

  it("never lets them download, or learn of, a Document C1 added since", async () => {
    for (const other of [k1Pm, orEngineer, owner]) {
      for (const document of added) await expectHidden(other.get(`/v1/work-items/${id}/documents/${document}/download`));
    }
  });

  it("shows them its checklist and link question as they were at the Send Back", async () => {
    for (const other of [k1Pm, orEngineer, owner]) {
      const { answers } = await detail(other, id);
      expect(answers.pour_check).toEqual({ formwork: { answer: "pass" } });
      expect(answers.related).toEqual([x]);
      const body = (await other.get(`/v1/work-items/${id}`)).body;
      expect(body).not.toContain("Bowed panel");
    }
  });

  it("shows them its free and link-question Links as they were at the Send Back", async () => {
    for (const other of [k1Pm, orEngineer, owner]) expect(await links(other, id)).toEqual(asSentBack().sort());
  });

  it("keeps it in X's Linked from, and out of Y's, until C1 Submits it again (scenario 59)", async () => {
    for (const other of [k1Pm, orEngineer, owner]) {
      expect(await linkedFrom(other, x)).toEqual([id]);
      expect(await linkedFrom(other, y)).toEqual([]);
    }
  });

  it("keeps it in their Link search, with the same Document Number and Subject (scenario 58)", async () => {
    for (const other of [k1Pm, orEngineer, owner]) expect(await linkSearch(other, "SBR-1")).toEqual([id]);
  });

  it("shows C1, holding it, everything as it is now", async () => {
    for (const c1Member of [engineer, pm]) {
      expect(await documentIds(c1Member, id)).toEqual([...before, ...added].sort());
      expect(await links(c1Member, id)).toEqual(asResubmitted().sort());
      expect(await linkedFrom(c1Member, x)).toEqual([]);
      expect(await linkedFrom(c1Member, y)).toEqual([id]);
      expect((await detail(c1Member, id)).answers.pour_check).toEqual({ formwork: { answer: "fail", comment: "Bowed panel" } });
    }
  });

  it("neither notifies them of, nor shows in their history, anything C1 changed", async () => {
    expect((await notificationsAbout(k1Pm, id)).length).toBe(k1Notified);
    for (const other of [k1Pm, orEngineer, owner]) {
      expect((await notificationsAbout(other, id)).length).toBeLessThanOrEqual(k1Notified);
      const events = await history(other, id);
      expect(events.filter((e) => e.type === "answers_changed")).toEqual([]);
      const body = JSON.stringify(events);
      for (const name of ["datasheet-2.pdf", "sample-2.jpg", "formwork-2.jpg", "letter-2.txt", "SBR-Y", "Bowed panel"]) {
        expect(body).not.toContain(name);
      }
    }
  });

  it("makes everything C1 changed everyone's once C1 Submits it again", async () => {
    await ok(pm.post(`/v1/work-items/${id}/pick-up`));
    await take(pm, id, "submit");
    for (const viewer of [engineer, k1Pm, orEngineer, owner]) {
      expect(await documentIds(viewer, id)).toEqual([...before, ...added].sort());
      expect(await links(viewer, id)).toEqual(asResubmitted().sort());
      expect(await linkedFrom(viewer, x)).toEqual([]);
      expect(await linkedFrom(viewer, y)).toEqual([id]);
      const { answers } = await detail(viewer, id);
      expect(answers.pour_check).toEqual({ formwork: { answer: "fail", comment: "Bowed panel" } });
      expect(answers.related).toEqual([y]);
    }
    for (const viewer of [k1Pm, orEngineer, owner]) {
      expect((await ok(viewer.get(`/v1/work-items/${id}/documents/${added[0]}/download`), 200)).json()).toHaveProperty("url");
    }
  });
});

describe("C2 searches for an item to link, before and after C1's item is Sent Back (scenario 60)", () => {
  it("is never offered C1's item, nor can it open it", async () => {
    const id = await submitted("SBR-60");
    expect(await linkSearch(c2Engineer, "SBR-60")).toEqual([]);
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Engineer, id, "send_back");
    expect(await linkSearch(c2Engineer, "SBR-60")).toEqual([]);
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}`));
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/documents`));
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/links`));
    // K1 still finds it.
    expect(await linkSearch(k1Pm, "SBR-60")).toEqual([id]);
  });
});

describe("an item that has never left C1", () => {
  it("is still in no one else's Link search, Linked from or reads (V1)", async () => {
    const target = await submitted("SBR-T");
    const id = await draftOf("SBR-D", { related: [target] });
    await take(engineer, id, "send_for_review");
    for (const other of [k1Pm, orEngineer, owner, c2Engineer]) {
      expect(await linkSearch(other, "SBR-D")).toEqual([]);
      await expectHidden(other.get(`/v1/work-items/${id}`));
      await expectHidden(other.get(`/v1/work-items/${id}/documents`));
    }
    for (const other of [k1Pm, orEngineer, owner]) expect(await linkedFrom(other, target)).toEqual([]);
  });
});
