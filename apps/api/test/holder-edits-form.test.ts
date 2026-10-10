// Seam 1 for who edits the raiser's Form (RP-514, spec RP-511 decision 4; ADR 0019;
// form-engine.md §4; visibility.md V1, scenario RP-514-1).
//
// Only the Member holding the current Step saves the raiser's answers, at a raiser
// Step the Workflow lets edit the Form (by default the Draft Step and the raiser's
// Steps held with its Function Permission), and only until the item's first Submit.
// A Send Back reopens it at the raiser's Step it comes back to, for its holder, until
// it is Submitted again (ADR 0014). Everyone else reads the Form: no Save.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workItemSearchParams, type HandoverStep, type WorkItemList } from "@rabaed/domain";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, detail, draft, memberOnProject, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const answersOf = async (by: Caller, id: string) => (await detail(by, id)).answers;
const save = async (by: Caller, id: string, changes: Record<string, unknown>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await answersOf(by, id)), ...changes } });
async function refusedToSave(by: Caller, id: string, changes: Record<string, unknown>) {
  const res = await save(by, id, changes);
  expect(res.statusCode, res.body).toBe(409);
  expect(res.json()).toMatchObject({ error: "not_editable" });
  expect((await detail(by, id)).actions.saveAnswers).toBe(false);
}

let c1: Company;
let at: Tower;
let hafiz: Caller; // C1 engineer: writes the Drafts.
let omar: Caller; // Another C1 engineer.
let omarId = "";
let ali: Caller; // C1 PM: Internal Review, then Submits.
let k1Manager: Caller;
let k1ParticipantId = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const projectId = (await api.createProject(c1.caller, { code: "HEF" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  const electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  const mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  const buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  hafiz = await projectMember(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Engineer" });
  ({ id: omarId, caller: omar } = await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Omar Engineer" }));
  ali = await projectMember(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  k1Manager = await projectMember(api, k1, k1ParticipantId, ["manager"], { name: "K1 Manager" });
  at = { projectId, c1ParticipantId, electrical, mechanical, buildingA, c1Engineer: hafiz, c1Pm: ali, k1Manager };
});

describe("only the holder edits the raiser's Form, on the Rabaed Default MAR (seam 1)", () => {
  it("Omar, of the same Company, reads Hafiz's Draft but can't save it; Hafiz can", async () => {
    const id = await draft(at, hafiz, "Hafiz's Draft");
    expect((await detail(omar, id)).answers.manufacturer).toBe("ACME Cables");
    await refusedToSave(omar, id, { manufacturer: "Omar Cables" });
    expect((await detail(hafiz, id)).actions.saveAnswers).toBe(true);
    await ok(save(hafiz, id, { manufacturer: "Hafiz Cables" }));
    expect((await answersOf(hafiz, id)).manufacturer).toBe("Hafiz Cables");
  });

  it("after Send for Review Hafiz can't save, and neither can Ali holding Internal Review", async () => {
    const id = await draft(at, hafiz, "Sent for review");
    await take(hafiz, id, "send_for_review");
    await refusedToSave(hafiz, id, { manufacturer: "Late change" });
    expect((await detail(ali, id)).heldBy?.memberName).toEqual(bilingual("Ali Sonour"));
    await refusedToSave(ali, id, { manufacturer: "PM change" });
    // Ali still Submits it: the Form was checked complete when it left the Draft.
    await take(ali, id, "submit");
  });

  it("a Return to the Draft reopens it for Hafiz, holding it again", async () => {
    const id = await draft(at, hafiz, "Returned");
    await take(hafiz, id, "send_for_review");
    await take(ali, id, "return", { reason: "Fix the description" });
    await refusedToSave(omar, id, { description: "Omar's fix" });
    await ok(save(hafiz, id, { description: "Fixed" }));
    expect((await answersOf(hafiz, id)).description).toBe("Fixed");
  });

  it("nobody saves after the Submit: not Hafiz, Ali or Omar, not K1", async () => {
    const id = await draft(at, hafiz, "Submitted");
    await take(hafiz, id, "send_for_review");
    await take(ali, id, "submit");
    for (const by of [hafiz, ali, omar]) await refusedToSave(by, id, { manufacturer: "After Submit" });
    // K1 never changes the raiser's answers. (MAR Form Version 4 still has K1 fill its
    // "Consultant verification" here, ADR 0013, until RP-516 moves it into K1's reply.)
    const byK1 = await save(k1Manager, id, { manufacturer: "After Submit" });
    expect(byK1.statusCode, byK1.body).toBe(409);
    expect(byK1.json()).toMatchObject({ error: "not_editable" });
    expect((await answersOf(k1Manager, id)).manufacturer).toBe("ACME Cables");
  });
});

describe("a Send Back reopens the raiser's Form for its holder until the next Submit (seam 1)", () => {
  const TYPE = "HEFSB";

  beforeAll(async () => {
    await addSendBackType(migrator, TYPE, bilingual("Holder edits (test)"), {
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
    });
  });

  const raise = async (model: string) =>
    (await ok(hafiz.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: at.electrical, location: at.buildingA } }), 201)).json()
      .id as string;
  // K1's only manager holds Consultant review at once (a pool of one).
  const k1 = () => k1Manager;

  it("Sent Back to the Draft, Hafiz holds and saves it; once Submitted again nobody does", async () => {
    const id = await raise("SB-1");
    await take(hafiz, id, "send_for_review");
    await take(ali, id, "submit");
    await refusedToSave(hafiz, id, { model: "SB-1a" });
    await take(k1(), id, "send_back_to_draft");
    await refusedToSave(omar, id, { model: "SB-1-omar" });
    await ok(save(hafiz, id, { model: "SB-1b" }));
    await take(hafiz, id, "send_for_review");
    await refusedToSave(ali, id, { model: "SB-1c" });
    await take(ali, id, "submit");
    for (const by of [hafiz, ali, k1()]) await refusedToSave(by, id, { model: "SB-1d" });
  });

  it("Sent Back to Contractor review, Ali holds it but can't save: that Step doesn't edit the Form", async () => {
    const id = await raise("SB-2");
    await take(hafiz, id, "send_for_review");
    await take(ali, id, "submit");
    await take(k1(), id, "send_back");
    await refusedToSave(ali, id, { model: "SB-2a" });
    await refusedToSave(hafiz, id, { model: "SB-2b" });
  });
});

describe("scenario RP-514-1: Drafts visible to the author only", () => {
  const TYPE = "HEFAO";
  const list = async (by: Caller): Promise<WorkItemList> =>
    (await ok(by.get(`/v1/projects/${at.projectId}/modules/submittals/work-items?${workItemSearchParams({})}`), 200)).json();
  const counted = async (by: Caller) => (await list(by)).stages.reduce((n, s) => n + s.count, 0);
  const listed = async (by: Caller, id: string) => (await list(by)).items.some((i) => i.id === id);
  const raise = async (by: Caller, model: string) =>
    (await ok(by.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: at.electrical, location: at.buildingA } }), 201)).json()
      .id as string;

  beforeAll(async () => {
    await addSendBackType(
      migrator,
      TYPE,
      bilingual("Author-only Drafts (test)"),
      {
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
      },
      { draftsVisibleTo: "author" },
    );
  });

  it("another TMC engineer, the PM, the Authorized Person and K1 get 404, and don't list or count it; Hafiz does", async () => {
    const before = { omar: await counted(omar), ali: await counted(ali), hafiz: await counted(hafiz) };
    const id = await raise(hafiz, "Author only");
    for (const by of [omar, ali, c1.caller, k1Manager]) {
      await expectHidden(by.get(`/v1/work-items/${id}`));
      expect(await listed(by, id)).toBe(false);
    }
    expect(await counted(omar)).toBe(before.omar);
    expect(await counted(ali)).toBe(before.ali);
    expect(await counted(hafiz)).toBe(before.hafiz + 1);
    expect(await listed(hafiz, id)).toBe(true);
    await ok(save(hafiz, id, { model: "Author only, edited" }));

    // Sent for Review it is no Draft: C1 reads it as any item in Internal Review; K1 still doesn't (V1).
    await take(hafiz, id, "send_for_review");
    for (const by of [omar, ali]) expect((await detail(by, id)).title).toBe("Author only");
    await expectHidden(k1Manager.get(`/v1/work-items/${id}`));
  });

  it("the Authorized Person hands over a Draft they don't see by its Step and Project; the new holder sees and edits it", async () => {
    const badr = await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Badr Engineer" });
    const id = await raise(badr.caller, "Badr's Draft");
    await expectHidden(c1.caller.get(`/v1/work-items/${id}`));

    const refused = await c1.caller.post(`/v1/members/${badr.id}/deactivate`, {});
    expect(refused.statusCode, refused.body).toBe(409);
    const steps = refused.json().handovers as HandoverStep[];
    const step = steps.find((s) => s.item === null);
    expect(step).toMatchObject({ project: { id: at.projectId }, step: expect.objectContaining({ en: "Draft" }), item: null });
    expect(refused.body).not.toContain(id);
    expect(refused.body).not.toContain("Badr's Draft");

    const picks = steps.map((s) => ({ assignmentId: s.assignmentId, toMemberId: omarId }));
    const done = await c1.caller.post(`/v1/members/${badr.id}/deactivate`, { handovers: picks });
    expect(done.statusCode, done.body).toBe(200);
    expect((await detail(omar, id)).title).toBe("Badr's Draft");
    await ok(save(omar, id, { model: "Omar's now" }));
    await expectHidden(hafiz.get(`/v1/work-items/${id}`));
  });
});
