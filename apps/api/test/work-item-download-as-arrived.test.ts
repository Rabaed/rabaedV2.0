// Seam 1 for the List's row menu Download of an item its holder is changing (RP-409,
// owner decision B; visibility.md V19 and scenario RP-409-2). Download is the item as
// it last arrived, the same for every viewer who sees it: the holder (here C1, which
// K1 Sent Back the item to) gets exactly what K1, the Owner Representative and the
// Owner get. Its Documents and Links are those it arrived with, never one the holder
// added since; its answers are those it arrived with; its Status is the one other
// Companies read; there is no Linked from. C2, another Contractor, gets nothing.
//
// The Type is test-only, on the test Workflow with a Send Back (addSendBackType).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { SharedWorkItem } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, uploadDocument, type Caller, type TestFile } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, detail, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "SBDL";
const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "datasheet", type: "attachments", label: bilingual("Datasheet"), contentTypes: ["application/pdf"] },
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
let engineer: Caller; // C1 engineer: raises the item, and changes it while it is Sent Back.
let pm: Caller; // C1 PM: Submits.
let k1Engineer: Caller; // Holds Consultant review, and Sends Back.
let k1Pm: Caller;
let orEngineer: Caller;
let owner: Caller;
let c2Engineer: Caller;
let projectId = "";
let electrical = "";
let mechanical = "";
let buildingA = "";
let x = "";
let y = "";
let id = "";
let before: string[] = [];

const pdf = (fileName: string): TestFile => ({ fieldKey: "datasheet", fileName, contentType: "application/pdf", body: `%PDF-1.7 ${fileName}` });
const attachment = (fileName: string): TestFile => ({ fileName, contentType: "text/plain", body: `${fileName} (test)` });
const shared = async (by: Caller, itemId: string): Promise<SharedWorkItem> => (await ok(by.get(`/v1/work-items/${itemId}/shared`), 200)).json();

async function otherParticipant(role: "contractor" | "consultant" | "owner" | "owner_representative") {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return { company, participantId };
}

async function draftOf(model: string, answers: Record<string, unknown> = {}): Promise<string> {
  const res = await ok(
    engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: electrical, location: buildingA, ...answers } }),
    201,
  );
  return res.json().id as string;
}

async function submit(itemId: string) {
  await take(engineer, itemId, "send_for_review");
  await ok(pm.post(`/v1/work-items/${itemId}/claim`));
  await take(pm, itemId, "submit");
}

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Download as arrived submittal", ar: "اعتماد كما وصل" }, schema);
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
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

  x = await draftOf("DLA-X");
  await submit(x);
  y = await draftOf("DLA-Y");
  await submit(y);
  id = await draftOf("DLA-1", { related: [x] });
  before = [await uploadDocument(engineer, id, pdf("datasheet-1.pdf")), await uploadDocument(engineer, id, attachment("letter-1.txt"))].sort();
  await ok(engineer.post(`/v1/work-items/${id}/links`, { workItemId: x }), 201);
  await submit(id);
  await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
  await take(k1Engineer, id, "send_back_to_draft");

  // C1, holding it in its Draft again, changes it: none of this has arrived anywhere yet.
  await uploadDocument(engineer, id, pdf("datasheet-2.pdf"));
  await uploadDocument(engineer, id, attachment("letter-2.txt"));
  await ok(
    engineer.request("PUT", `/v1/work-items/${id}/answers`, {
      answers: { ...(await detail(engineer, id)).answers, model: "DLA-1 changed", trade: mechanical, related: [y] },
    }),
  );
  await ok(engineer.post(`/v1/work-items/${id}/links`, { workItemId: y }), 201);
});

describe("scenario RP-409-2: Download is the item as it last arrived, whoever holds it", () => {
  it("gives the holder exactly what every other viewer gets", async () => {
    const theirs = await shared(k1Pm, id);
    for (const viewer of [engineer, pm, k1Engineer, orEngineer, owner]) expect(await shared(viewer, id)).toEqual(theirs);
  });

  it("holds the Documents it arrived with, never one the holder added since", async () => {
    for (const viewer of [engineer, k1Pm]) {
      const item = await shared(viewer, id);
      expect(item.documents.map((d) => d.id).sort()).toEqual(before);
      expect(JSON.stringify(item)).not.toMatch(/datasheet-2|letter-2/);
      expect(item.documents.every((d) => d.uploadedBy.memberName === null)).toBe(true);
    }
  });

  it("holds the Links and answers it arrived with, each linked item by number and Subject only", async () => {
    const item = await shared(engineer, id);
    const xNumber = (await detail(engineer, x)).documentNumber;
    expect(item.links.map((l) => `${l.kind}:${l.documentNumber}`).sort()).toEqual([`related:${xNumber}`, `relies_on:${xNumber}`]);
    expect(JSON.stringify(item)).not.toMatch(/DLA-Y|DLA-1 changed/);
    expect(JSON.stringify(item)).not.toContain(x);
    expect(item.answers).toMatchObject({ model: "DLA-1", trade: electrical });
    expect(item.trade.id).toBe(electrical);
  });

  it("shows the Status other Companies read, never the holder's own Step", async () => {
    const item = await shared(engineer, id);
    expect(item.stage).toEqual((await detail(k1Pm, id)).stage);
  });

  it("is nothing for another Contractor", async () => {
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/shared`));
  });
});
