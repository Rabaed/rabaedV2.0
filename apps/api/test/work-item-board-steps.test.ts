// Seam 1 for a Stage's Steps on the Kanban (RP-519, spec RP-511 decision 9, ADR 0020;
// visibility.md V14, scenario RP-519-1). A column names the Steps of the Stage that the
// viewer's own Participant holds, each with its count ("Internal Review 7 · Contractor
// Engineer 3 · Contractor PM 4"); another Participant's Steps never show: a Stage that
// holds only another Company's items shows its Stage count and nothing more.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type WorkItemBoard, type WorkItemQueryInput } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "RBSTP";

let c1: Company;
let projectId = "";
let hafiz: Caller; // C1 engineer.
let ali: Caller; // C1 PM.
let k1Manager: Caller; // K1's only manager: holds Consultant review at once.

const board = async (by: Caller, query: WorkItemQueryInput = {}): Promise<WorkItemBoard> =>
  (await ok(by.get(`/v1/projects/${projectId}/work-items/kanban?${workItemSearchParams(query)}`), 200)).json();
const column = (b: WorkItemBoard, stageKey: string) => b.columns.find((c) => c.stageKey === stageKey)!;
const raise = async (by: Caller, model: string) =>
  (await ok(by.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade, location } }), 201)).json().id as string;

let trade = "";
let location = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "RBS" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  trade = await post("trades", { code: "EL", name: bilingual("Electrical") });
  location = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  hafiz = await projectMember(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Engineer" });
  ali = await projectMember(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  k1Manager = await projectMember(api, k1, k1ParticipantId, ["manager"], { name: "K1 Manager" });
  await addSendBackType(
    migrator,
    TYPE,
    bilingual("Board Steps (test)"),
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
    { engineerStep: true },
  );
  // Two items in C1's Internal Review at the PM's Step, one Returned to the Engineer's, and one Submitted to K1.
  for (const model of ["Tray A", "Tray B"]) await take(hafiz, await raise(hafiz, model), "send_for_review");
  const returned = await raise(hafiz, "Tray C");
  await take(hafiz, returned, "send_for_review");
  await ok(ali.post(`/v1/work-items/${returned}/pick-up`));
  await take(ali, returned, "return");
  const submitted = await raise(hafiz, "Tray D");
  await take(hafiz, submitted, "send_for_review");
  await ok(ali.post(`/v1/work-items/${submitted}/pick-up`));
  await take(ali, submitted, "submit");
});

describe("a Stage's Steps for the viewer's own Participant (RP-519)", () => {
  it("lists each own Step of the Stage with its count, in the Stage's column", async () => {
    const b = await board(hafiz);
    const internal = column(b, "internal_review");
    expect(internal.steps.map((s) => [s.key, s.count]).sort()).toEqual([
      ["contractor_engineer", 1],
      ["internal_review", 2],
    ]);
    expect(internal.steps.every((s) => s.count > 0)).toBe(true);
    expect(internal.shown).toBe(3);
    // The Steps' counts add up to what the column shows.
    expect(internal.steps.reduce((sum, s) => sum + s.count, 0)).toBe(internal.shown);
    expect(column(b, "draft").steps).toEqual([]);
  });

  it("follows the query's filters", async () => {
    const b = await board(hafiz, { with: ["step:contractor_engineer"] });
    expect(column(b, "internal_review").steps).toEqual([expect.objectContaining({ key: "contractor_engineer", count: 1 })]);
  });
});

describe("scenario RP-519-1: another Participant's Steps never show on the Kanban", () => {
  it("a Consultant sees no TMC Step name or per-Step count; C1's Stage count is all it has of C1's Steps", async () => {
    const theirs = await board(k1Manager);
    const json = JSON.stringify(theirs);
    for (const secret of ["contractor_engineer", "Contractor Engineer", "مهندس المقاول", "Contractor review", "مراجعة المقاول"]) {
      expect(json).not.toContain(secret);
    }
    // K1's own Step shows; the Stage C1's items wait in has no Steps of K1's to name.
    expect(column(theirs, "pending_approval").steps).toEqual([expect.objectContaining({ key: "consultant_review", count: 1 })]);
    const internal = column(theirs, "internal_review");
    expect(internal.steps).toEqual([]);
    expect(theirs.stages.find((s) => s.key === "internal_review")!.count).toBe(internal.shown);
    // C1 sees Consultant review as the Company lane only, no Step.
    const mine = await board(ali);
    expect(column(mine, "pending_approval").steps).toEqual([]);
    expect(JSON.stringify(mine)).not.toContain("consultant_review");
  });
});
