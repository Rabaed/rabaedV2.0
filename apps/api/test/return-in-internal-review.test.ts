// Seam 1 for a Return that stays in Internal Review (RP-515, spec RP-511 decision 9;
// ADR 0020; workflow-engine.md §1, §3.3, §5.1, §10; visibility.md "Creation Date",
// scenario RP-515-1).
//
// The Contractor PM's Return goes to the Contractor Engineer Step in Internal Review,
// never back to the Draft: the item keeps its Document Number, isn't a Draft (no
// Discard, Cancel as before: until the first Submit), and the first time goes to its
// author, the Member who sent it from the Draft. There the holder changes the answers
// and adds, replaces and removes Documents: they freeze at the first Submit, not at
// Send for Review. A Draft has no Step Age, so the time it was started reaches nobody;
// a Returned item's counts from the Return.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type DocumentList, type WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, detail, memberOnProject, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "RIRET";
const WEEK = 7 * 24 * 3_600_000;

let c1: Company;
let projectId = "";
let c1ParticipantId = "";
let electrical = "";
let buildingA = "";
let hafiz: Caller; // C1 engineer: the author.
let omar: Caller; // Another C1 engineer, in the same Step Pool.
let ali: Caller; // C1 PM, the only one: holds Internal Review / Contractor PM at once.
let k1Manager: Caller; // K1's only manager: holds Consultant review at once.

const raise = async (by: Caller, model: string) =>
  (
    await ok(
      by.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: electrical, location: buildingA } }),
      201,
    )
  ).json().id as string;
const attach = (by: Caller, id: string, fileName: string) =>
  uploadDocument(by, id, { fileName, contentType: "application/pdf", body: `%PDF-1.7 ${fileName}` });
const documents = async (by: Caller, id: string): Promise<DocumentList> => (await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json();
const save = async (by: Caller, id: string, changes: Record<string, unknown>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await detail(by, id)).answers, ...changes } });
const list = async (by: Caller, query: Parameters<typeof workItemSearchParams>[0] = {}): Promise<WorkItemList> =>
  (await ok(by.get(`/v1/projects/${projectId}/modules/submittals/work-items?${workItemSearchParams(query)}`), 200)).json();
const transitionKeys = async (by: Caller, id: string) => (await detail(by, id)).actions.transitions.map((t) => t.key);
/** Moves when the item entered its current Step `weeks` back, as if it had waited there (as the migrator). */
const aged = (id: string, weeks: number) =>
  migrator.updateTable("work_item").set({ step_entered_at: new Date(Date.now() - weeks * WEEK) }).where("id", "=", id).execute();

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "RIR" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  hafiz = await projectMember(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Engineer" });
  omar = await projectMember(api, c1, c1ParticipantId, ["engineer"], { name: "Omar Engineer" });
  ali = await projectMember(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  k1Manager = await projectMember(api, k1, k1ParticipantId, ["manager"], { name: "K1 Manager" });

  await addSendBackType(
    migrator,
    TYPE,
    bilingual("Return in Internal Review (test)"),
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
    { engineerStep: true, withCancel: true },
  );
});

describe("a Return to the Contractor Engineer (seam 1)", () => {
  it("stays in Internal Review with its number, held by Hafiz, who replaces the Datasheet; it freezes at the Submit", async () => {
    const id = await raise(hafiz, "Cable tray");
    const first = await attach(hafiz, id, "datasheet.pdf");
    await take(hafiz, id, "send_for_review");
    const number = (await detail(ali, id)).documentNumber;
    expect(number).not.toBeNull();
    // Sent for Review, nobody changes the Documents, but they aren't frozen yet.
    expect(await documents(hafiz, id)).toMatchObject({ documents: [{ id: first, frozen: false }], canChange: false });
    expect((await hafiz.delete(`/v1/work-items/${id}/documents/${first}`)).json()).toEqual({ error: "not_editable" });

    await take(ali, id, "return");
    const returned = await detail(hafiz, id);
    expect(returned).toMatchObject({
      documentNumber: number,
      step: { key: "contractor_engineer" },
      stage: { key: "internal_review" },
      heldBy: { memberName: bilingual("Hafiz Engineer") },
    });
    // No Draft: no Discard; Cancel as before, until the first Submit.
    expect(returned.actions).toMatchObject({ saveAnswers: true, discardRevision: false });
    expect(await transitionKeys(hafiz, id)).toEqual(expect.arrayContaining(["send_for_review_again", "cancel_engineer"]));
    expect((await detail(omar, id)).actions.saveAnswers).toBe(false);

    // Hafiz replaces the Datasheet and changes an answer.
    await ok(hafiz.delete(`/v1/work-items/${id}/documents/${first}`));
    const second = await attach(hafiz, id, "datasheet rev 2.pdf");
    await ok(save(hafiz, id, { model: "Cable tray, corrected" }));
    expect((await omar.delete(`/v1/work-items/${id}/documents/${second}`)).json()).toEqual({ error: "not_editable" });

    await take(hafiz, id, "send_for_review_again");
    expect((await detail(ali, id)).documentNumber).toBe(number);
    expect(await documents(ali, id)).toMatchObject({ documents: [{ id: second, frozen: false }], canChange: false });
    await take(ali, id, "submit");

    expect(await documents(hafiz, id)).toMatchObject({ documents: [{ id: second, frozen: true }], canChange: false });
    expect(await documents(k1Manager, id)).toMatchObject({ documents: [{ id: second, fileName: "datasheet rev 2.pdf", frozen: true }] });
    expect((await detail(k1Manager, id)).answers.model).toBe("Cable tray, corrected");
    expect((await detail(k1Manager, id)).documentNumber).toBe(number);
  });

  it("goes the first time to its author, Omar, not to Hafiz; the second time to whoever held it", async () => {
    const id = await raise(omar, "Busbar");
    await take(omar, id, "send_for_review");
    await take(ali, id, "return");
    expect((await detail(omar, id)).heldBy).toMatchObject({ memberName: bilingual("Omar Engineer"), pool: null });

    // Omar hands it to Hafiz (Return to pool, Hafiz picks it up), who sends it again; the next Return is Hafiz's.
    await ok(omar.post(`/v1/work-items/${id}/return-to-pool`));
    await ok(hafiz.post(`/v1/work-items/${id}/pick-up`));
    await take(hafiz, id, "send_for_review_again");
    await take(ali, id, "return");
    expect((await detail(omar, id)).heldBy).toMatchObject({ memberName: bilingual("Hafiz Engineer") });
  });

  it("goes to the pool when the author has left it", async () => {
    const zaid = await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Zaid Engineer" });
    const id = await raise(zaid.caller, "Conduit");
    await take(zaid.caller, id, "send_for_review");
    await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/members/${zaid.id}/positions`, { positions: [] }));
    await take(ali, id, "return");
    const pooled = await detail(hafiz, id);
    expect(pooled.heldBy?.memberName).toBeNull();
    expect(pooled.heldBy?.pool?.names).toEqual(expect.arrayContaining([bilingual("Hafiz Engineer"), bilingual("Omar Engineer")]));
  });
});

describe("scenario RP-515-1: nobody receives a Draft's start time through Step Age", () => {
  it("a Draft started weeks ago has no Step Age for its author or anyone of its Company; Returned, it counts from the Return", async () => {
    const id = await raise(hafiz, "Old Draft");
    await aged(id, 3);
    for (const by of [hafiz, omar, ali]) {
      const seen = await detail(by, id);
      expect({ stepEnteredAt: seen.stepEnteredAt, stepAgeWeeks: seen.stepAgeWeeks }).toEqual({ stepEnteredAt: null, stepAgeWeeks: null });
      const row = (await list(by)).items.find((i) => i.id === id);
      expect(row).toMatchObject({ stepEnteredAt: null, stepAgeWeeks: null });
      expect((await list(by, { stepAgeMin: 1 })).items.map((i) => i.id)).not.toContain(id);
    }

    await take(hafiz, id, "send_for_review");
    const beforeReturn = Date.now();
    await take(ali, id, "return");
    const returned = await detail(hafiz, id);
    expect(returned.stepAgeWeeks).toBe(1);
    expect(Date.parse(returned.stepEnteredAt!)).toBeGreaterThanOrEqual(beforeReturn - 1000);
    await expectHidden(k1Manager.get(`/v1/work-items/${id}`));
  });
});
