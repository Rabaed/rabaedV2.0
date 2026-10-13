// Seam 1 for what the raiser may change after a Send Back (RP-580; ADR 0021, ADR 0014;
// workflow-engine.md §1; form-engine.md §4; visibility.md V19, scenarios 71 and RP-580-1).
//
// The raiser's Step a Send Back leads to says "Comment only" or "Edit the Form". At
// "Comment only" the raiser's holder changes nothing of the Form (answers, checklist,
// Documents, Links, Trade, Location, Scopes) and only replies and Submits again; the
// item page says why. At "Edit the Form", and on a Version published before the setting
// (null), the Form reopens until the next Submit, as ADR 0014 built it. The setting of
// the Step the Send Back led to holds until the next Submit, wherever the raiser moves
// the item inside its Participant.
//
// The Types are test-only, on the test Workflow with a Send Back (addSendBackType).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, WorkflowDefinition, WorkflowRead, WorkItemLinks } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uploadDocument, type Caller, type TestFile } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, detail, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const COMMENT = "ASBCO";
const EDIT = "ASBED";
const BEFORE = "ASBNU";
const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "datasheet", type: "attachments", label: bilingual("Datasheet"), contentTypes: ["application/pdf"] },
        {
          key: "pour_check",
          type: "checklist",
          label: bilingual("Pour check"),
          items: [{ key: "formwork", text: bilingual("Formwork"), answers: "pass_fail_na", comment: "optional", photo: "optional" }],
        },
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
let engineer: Caller; // C1 engineer: raises the items.
let pm: Caller; // C1 PM: Contractor review, Submits.
let k1Engineer: Caller; // Holds Consultant review, and Sends Back.
let k1Pm: Caller; // Another K1 Member who sees the item, holding nothing.
let projectId = "";
let electrical = "";
let mechanical = "";
let buildingA = "";
let buildingB = "";

const pdf = (fileName: string): TestFile => ({ fieldKey: "datasheet", fileName, contentType: "application/pdf", body: `%PDF-1.7 ${fileName}` });
const documents = async (by: Caller, id: string) => (await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json() as DocumentList;
const linkIds = async (by: Caller, id: string) =>
  ((await ok(by.get(`/v1/work-items/${id}/links`), 200)).json() as WorkItemLinks).links.map((l) => l.workItemId);
const save = async (by: Caller, id: string, changes: Record<string, unknown>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await detail(by, id)).answers, ...changes } });
async function refused(response: Promise<{ statusCode: number; body: string; json(): unknown }>) {
  const res = await response;
  expect(res.statusCode, res.body).toBe(409);
  expect(res.json()).toMatchObject({ error: "not_editable" });
}

async function raise(type: string, model: string): Promise<string> {
  const answers = { model, trade: electrical, location: buildingA, pour_check: { formwork: { answer: "pass" } } };
  return (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type, title: model, answers }), 201)).json().id as string;
}

async function submit(id: string) {
  await take(engineer, id, "send_for_review");
  await ok(pm.post(`/v1/work-items/${id}/pick-up`));
  await take(pm, id, "submit");
}

/** An item of `type` with a Datasheet and a Link, Submitted, then Sent Back by K1 with `transition`. */
async function sentBack(type: string, model: string, transition: "send_back" | "send_back_to_draft") {
  // A Draft is never linked: the other item is Submitted first.
  const other = await raise(type, `${model}-other`);
  await submit(other);
  const id = await raise(type, model);
  const datasheet = await uploadDocument(engineer, id, pdf(`${model}.pdf`));
  await ok(engineer.post(`/v1/work-items/${id}/links`, { workItemId: other }), 201);
  await submit(id);
  await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Engineer, id, transition, { internalNote: "K1's own note" });
  return { id, other, datasheet };
}

beforeAll(async () => {
  await addSendBackType(migrator, COMMENT, bilingual("Comment only (test)"), schema, {
    afterSendBack: { draft: "comment", internal_review: "comment" },
  });
  await addSendBackType(migrator, EDIT, bilingual("Edit the Form (test)"), schema, {
    afterSendBack: { draft: "edit_form", internal_review: "edit_form" },
  });
  // A Version published before the setting: its Steps say nothing (null).
  await addSendBackType(migrator, BEFORE, bilingual("Published before (test)"), schema);
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  buildingB = await post("locations", { code: "BB", name: bilingual("Building B"), parentId: null });
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  const k1 = await api.authorizedPerson();
  const k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  k1Pm = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
});

describe("scenario RP-580-1: an item Sent Back to a \"Comment only\" Step", () => {
  let id = "";
  let other = "";
  let datasheet = "";
  let k1Before: unknown;

  beforeAll(async () => {
    ({ id, other, datasheet } = await sentBack(COMMENT, "CMT-1", "send_back_to_draft"));
    k1Before = { detail: await detail(k1Pm, id), documents: await documents(k1Pm, id), links: await linkIds(k1Pm, id) };
  });

  it("is held by the engineer again, read-only, and the page says why to C1 only", async () => {
    const mine = await detail(engineer, id);
    expect(mine.step.key).toBe("draft");
    expect(mine.heldBy?.companyName).toBeDefined();
    expect(mine.actions.saveAnswers).toBe(false);
    expect(mine.sentBackForComment).toBe(true);
    expect((await detail(pm, id)).sentBackForComment).toBe(true);
    for (const k1Member of [k1Engineer, k1Pm]) expect((await detail(k1Member, id)).sentBackForComment).toBe(false);
  });

  it("refuses the engineer saving answers, the checklist, Trade, Location and Scopes", async () => {
    await refused(save(engineer, id, { model: "CMT-1a" }));
    await refused(save(engineer, id, { pour_check: { formwork: { answer: "fail", comment: "Bowed panel" } } }));
    await refused(save(engineer, id, { trade: mechanical }));
    await refused(save(engineer, id, { location: buildingB }));
    expect((await detail(engineer, id)).answers).toMatchObject({ model: "CMT-1", trade: electrical, location: buildingA });
  });

  it("refuses adding or removing a Document, and changing the Links", async () => {
    expect((await documents(engineer, id)).canChange).toBe(false);
    await refused(engineer.post(`/v1/work-items/${id}/documents`, { ...pdf("CMT-1-new.pdf"), body: undefined, sizeBytes: 20 }));
    const removed = await engineer.delete(`/v1/work-items/${id}/documents/${datasheet}`);
    expect(removed.statusCode, removed.body).toBe(409);
    await refused(engineer.post(`/v1/work-items/${id}/links`, { workItemId: other }));
    expect((await documents(engineer, id)).documents.map((d) => d.id)).toEqual([datasheet]);
  });

  it("lets the engineer reply with an Internal Note and Submit it again; K1 sees nothing new", async () => {
    await take(engineer, id, "send_for_review", { internalNote: "Replied: the datasheet is the current one" });
    await ok(pm.post(`/v1/work-items/${id}/pick-up`));
    await take(pm, id, "submit", { internalNote: "Submitted again unchanged" });
    const now = await detail(k1Pm, id);
    expect(now.step.key).toBe("consultant_review");
    const was = k1Before as { detail: typeof now; documents: DocumentList; links: string[] };
    expect(now.answers).toEqual(was.detail.answers);
    expect(now.scopes).toEqual(was.detail.scopes);
    expect((await documents(k1Pm, id)).documents).toEqual(was.documents.documents);
    expect(await linkIds(k1Pm, id)).toEqual(was.links);
    expect((await detail(engineer, id)).sentBackForComment).toBe(false);
  });
});

describe("the \"Comment only\" of the Step the Send Back led to holds until the next Submit", () => {
  it("Sent Back to Contractor review, the PM Returns it to the Draft, and the engineer still can't save", async () => {
    const { id } = await sentBack(COMMENT, "CMT-2", "send_back");
    await ok(pm.post(`/v1/work-items/${id}/pick-up`));
    expect((await detail(pm, id)).sentBackForComment).toBe(true);
    await take(pm, id, "return");
    expect((await detail(engineer, id)).step.key).toBe("draft");
    expect((await detail(engineer, id)).actions.saveAnswers).toBe(false);
    await refused(save(engineer, id, { model: "CMT-2a" }));
  });
});

describe("an item Sent Back to an \"Edit the Form\" Step (scenario 71's behaviour)", () => {
  it("lets the engineer change answers, Trade and Documents, and K1 sees them only once it is Submitted again", async () => {
    const { id } = await sentBack(EDIT, "EDT-1", "send_back_to_draft");
    const mine = await detail(engineer, id);
    expect(mine.actions.saveAnswers).toBe(true);
    expect(mine.sentBackForComment).toBe(false);
    await ok(save(engineer, id, { model: "EDT-1a", trade: mechanical }));
    const added = await uploadDocument(engineer, id, pdf("EDT-1-new.pdf"));
    expect((await detail(k1Pm, id)).answers.model).toBe("EDT-1");
    expect((await documents(k1Pm, id)).documents.map((d) => d.id)).not.toContain(added);
    await submit(id);
    expect((await detail(k1Pm, id)).answers).toMatchObject({ model: "EDT-1a", trade: mechanical });
    expect((await documents(k1Pm, id)).documents.map((d) => d.id)).toContain(added);
  });

  it("the Return inside C1 keeps the Form open, as the Step the Send Back led to says", async () => {
    const { id } = await sentBack(EDIT, "EDT-2", "send_back");
    await ok(pm.post(`/v1/work-items/${id}/pick-up`));
    await take(pm, id, "return");
    await ok(save(engineer, id, { model: "EDT-2a" }));
  });
});

describe("an item on a Version published before the setting keeps editing after a Send Back", () => {
  it("reads the Steps' null as \"Edit the Form\"", async () => {
    const { id } = await sentBack(BEFORE, "NUL-1", "send_back_to_draft");
    expect((await detail(engineer, id)).actions.saveAnswers).toBe(true);
    expect((await detail(engineer, id)).sentBackForComment).toBe(false);
    await ok(save(engineer, id, { model: "NUL-1a" }));
    expect((await detail(engineer, id)).answers.model).toBe("NUL-1a");
  });
});

describe("an edited Workflow says \"Comment only\" where a Send Back leads, unless set (workflow-engine.md §1)", () => {
  const readWorkflow = async (id: string): Promise<WorkflowRead> => (await ok(c1.caller.get(`/v1/workflows/${id}`), 200)).json();
  const settings = (definition: WorkflowDefinition) => Object.fromEntries(definition.steps.map((s) => [s.key, s.afterSendBack ?? null]));
  let routeId = "";

  beforeAll(async () => {
    const type = await sql<{ workflow_definition_id: string }>`
      select workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = ${BEFORE}
    `.execute(migrator);
    const copied = await c1.caller.post(`/v1/workflows/${type.rows[0]!.workflow_definition_id}/duplicate`, {
      projectId,
      name: bilingual("Sent Back route"),
    });
    expect(copied.statusCode, copied.body).toBe(201);
    routeId = copied.json().id;
  });

  it("a copy keeps what its Version said; saving it sets \"Comment only\" on the raiser's Steps a Send Back leads to", async () => {
    const copy = (await readWorkflow(routeId)).draft!.definition;
    expect(Object.values(settings(copy)).every((s) => s === null)).toBe(true);
    await ok(c1.caller.request("PUT", `/v1/workflows/${routeId}/draft`, { definition: copy }), 200);
    expect(settings((await readWorkflow(routeId)).draft!.definition)).toMatchObject({
      draft: "comment",
      internal_review: "comment",
      consultant_review: null,
      consultant_approval: null,
    });
  });

  it("keeps \"Edit the Form\" where set, and refuses publishing it on a Step no Send Back leads to", async () => {
    const definition = (await readWorkflow(routeId)).draft!.definition;
    const set = (keys: Record<string, "edit_form">) => ({
      ...definition,
      steps: definition.steps.map((s) => (keys[s.key] ? { ...s, afterSendBack: keys[s.key] } : s)),
    });
    await ok(c1.caller.request("PUT", `/v1/workflows/${routeId}/draft`, { definition: set({ draft: "edit_form", consultant_review: "edit_form" }) }), 200);
    expect(settings((await readWorkflow(routeId)).draft!.definition)).toMatchObject({ draft: "edit_form", consultant_review: "edit_form" });
    const refusedPublish = await c1.caller.post(`/v1/workflows/${routeId}/publish`);
    expect(refusedPublish.statusCode, refusedPublish.body).toBe(422);
    expect(refusedPublish.json().problems).toContainEqual(expect.objectContaining({ code: "edit_form_not_after_send_back", step: "consultant_review" }));
    await ok(c1.caller.request("PUT", `/v1/workflows/${routeId}/draft`, { definition: set({ draft: "edit_form" }) }), 200);
    const published = await c1.caller.post(`/v1/workflows/${routeId}/publish`);
    expect(published.statusCode, published.body).toBe(200);
    expect(settings((await readWorkflow(routeId)).published!.definition)).toMatchObject({ draft: "edit_form", internal_review: "comment" });
  });
});

describe("before the first Submit nothing changes", () => {
  it("the engineer edits the Draft of a \"Comment only\" Workflow", async () => {
    const id = await raise(COMMENT, "CMT-3");
    expect((await detail(engineer, id)).actions.saveAnswers).toBe(true);
    expect((await detail(engineer, id)).sentBackForComment).toBe(false);
    await ok(save(engineer, id, { model: "CMT-3a" }));
  });
});
