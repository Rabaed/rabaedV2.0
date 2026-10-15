// Seam 1 for the eight Rabaed Default submittal Workflows (RP-596, spec RP-598; ADR 0022;
// workflow-engine.md §1 "Rabaed Defaults" and §5.3a; visibility.md V20, scenarios RP-596-1 and
// RP-596-2): the number of reviewers on each side (1 is the PM alone, 2 is Engineer then PM),
// each with and without the Owner's final review. A new Project's MAR and SAR run 2→2 and its
// DAR 1→1→1; all eight are read by every Member of a Project and bound, duplicated and edited
// as any Rabaed Default. The seam suites' global setup runs the demo seed, which publishes them.
import { rabaedDefaultTypes, rabaedWorkflowFile, submittalWorkflows } from "@rabaed/admin/services";
import { createDb, projectsLackingOutcomesAndStages, validateRabaedDefaultWorkflow } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { parseWorkflowDefinition, type WorkflowSettings } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const submittals = ["MAR", "SAR", "DAR"] as const;

let c1: Company;
let projectId = "";
let electrical = "";
let buildingA = "";
let hafiz: Caller; // C1 Contractor Engineer: raises the items.
let ali: Caller; // C1's only Project Manager: the Contractor PM.
let ahmed: Caller; // K1 Consultant Engineer.
let mohammed: Caller; // K1's only Manager: the Consultant PM.
let faisal: Caller; // OW's Project Manager: holds the Owner's review.
let outsider: Caller; // A Project Admin of a Project with no part in this one.

const settings = async (by: Caller, id = projectId): Promise<WorkflowSettings> => (await ok(by.get(`/v1/projects/${id}/workflow-settings`), 200)).json();
const typeOf = (s: WorkflowSettings, code: string) => s.types.find((t) => t.code === code)!;

/** The Workflow of `type` that publishes `key`'s document, as the Project reads it. */
const workflowOf = async (by: Caller, type: string, key: string) => {
  const found = submittalWorkflows.find((w) => w.key === key)!;
  const d = typeOf(await settings(by), type).rabaedDefaults.find((w) => w.name.en === found.name.en);
  expect(d, `${type} ${key}`).toBeTruthy();
  return d!;
};

const bind = async (type: string, key: string) => {
  const s = await settings(c1.caller);
  const workflow = await workflowOf(c1.caller, type, key);
  await ok(c1.caller.request("PUT", `/v1/projects/${projectId}/workflow-bindings`, { workItemTypeId: typeOf(s, type).id, raisingParticipantId: null, workflowId: workflow.id }));
};

const darAnswers = (title: string) => ({ document_type: "calculation", document_title: title, trade: electrical, location: buildingA });
const reviewReply = { sample_checked: true, matches_specification: true };
const comments = { items_to_create: [{ comment: "Seal the cable entries" }] };

/** A DAR drafted by Hafiz with its document. */
async function drafted(title: string): Promise<string> {
  const id = (await ok(hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "DAR", title, answers: darAnswers(title) }), 201)).json().id as string;
  await uploadDocument(hafiz, id, { fieldKey: "document", fileName: `${title}.pdf`, contentType: "application/pdf", body: `%PDF-1.7 ${title}` });
  return id;
}

/** A DAR raised by Hafiz and sent: Ali holds the Contractor PM Step at once. */
async function raised(title: string): Promise<string> {
  const id = await drafted(title);
  await take(hafiz, id, "send_for_review");
  return id;
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const ow = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "SWF" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  const participant = async (company: Company, role: "consultant" | "owner") => {
    const id = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
    return id;
  };
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await participant(k1, "consultant");
  const owParticipantId = await participant(ow, "owner");
  hafiz = await projectMember(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" });
  ali = await projectMember(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  ahmed = await projectMember(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  mohammed = await projectMember(api, k1, k1ParticipantId, ["manager"], { name: "Mohammed Al Shamsi" });
  faisal = await projectMember(api, ow, owParticipantId, ["project_manager"], { name: "Faisal Al Otaibi" });
  outsider = (await api.projectCreator()).caller;
});

describe("the eight documents pass every publish check, as each submittal Type's Rabaed Default", () => {
  it.each(submittals)("%s: each of the eight parses and is checked against the Type with no error", async (type) => {
    for (const { file, key } of submittalWorkflows) {
      const parsed = parseWorkflowDefinition(rabaedWorkflowFile(file));
      expect(parsed.ok, `${type} ${key}`).toBe(true);
      const checked = await validateRabaedDefaultWorkflow(migrator, type, rabaedWorkflowFile(file));
      expect(checked, `${type} ${key}`).toBeTruthy();
      expect(checked!.problems.filter((p) => p.severity === "error"), `${type} ${key}`).toEqual([]);
    }
  });

  it("the Types run MAR and SAR 2→2 and DAR 1→1 → Owner review; all eight are listed for each", () => {
    expect(rabaedDefaultTypes.filter((t) => t.variants !== null).map((t) => [t.type, t.workflow])).toEqual([
      ["MAR", "submittal-2-2.json"],
      ["SAR", "submittal-2-2.json"],
      ["DAR", "submittal-1-1-owner.json"],
    ]);
    expect(submittalWorkflows).toHaveLength(8);
    // Latin digits in both languages, the arrows of the language's own direction.
    for (const { name } of submittalWorkflows) {
      expect(name.en).toMatch(/^[12]→[12] Contractor /);
      expect(name.ar).toMatch(/^[12]→[12] /);
      expect(name.ar).not.toMatch(/[٠-٩]/);
    }
  });
});

describe("scenario RP-596-1: a new Project's Types run the Workflows the owner decided", () => {
  it("MAR and SAR run 2→2, DAR runs 1→1 → Owner review, each a Rabaed Default at its Version", async () => {
    const s = await settings(c1.caller);
    expect(typeOf(s, "MAR").workflow).toMatchObject({ source: "rabaed_default", name: { en: submittalWorkflows[3].name.en, ar: submittalWorkflows[3].name.ar } });
    expect(typeOf(s, "SAR").workflow).toMatchObject({ source: "rabaed_default", name: { en: submittalWorkflows[3].name.en } });
    expect(typeOf(s, "DAR").workflow).toMatchObject({ source: "rabaed_default", name: { en: submittalWorkflows[4].name.en, ar: submittalWorkflows[4].name.ar } });
  });

  it("each lists the eight, in the order 1→1, 1→2, 2→1, 2→2 and then the same with the Owner's review, the running one in use", async () => {
    for (const type of submittals) {
      const s = typeOf(await settings(c1.caller), type);
      expect(s.rabaedDefaults.map((d) => d.name.en)).toEqual(submittalWorkflows.map((w) => w.name.en));
      expect(s.rabaedDefaults.map((d) => d.name.ar)).toEqual(submittalWorkflows.map((w) => w.name.ar));
      expect(s.rabaedDefaults.filter((d) => d.bound).map((d) => d.id)).toEqual([s.workflow.id]);
      expect(s.rabaedDefaults.filter((d) => d.isTypeDefault).map((d) => d.id)).toEqual([s.workflow.id]);
      expect(s.rabaedDefaults.every((d) => d.versionNo !== null)).toBe(true);
    }
  });

  it("every Member reads them, and a Project Admin of another Project reads the same (Rabaed's own data, V20)", async () => {
    const asEngineer = typeOf(await settings(hafiz), "DAR");
    expect(asEngineer.rabaedDefaults).toHaveLength(8);
    const otherProject = (await api.createProject(outsider, { code: "SWO" })).id;
    expect(typeOf(await settings(outsider, otherProject), "DAR").rabaedDefaults.map((d) => d.name.en)).toEqual(submittalWorkflows.map((w) => w.name.en));
  });

  it("the types without several Rabaed Defaults list one", async () => {
    const s = await settings(c1.caller);
    for (const code of ["WIR", "CMT"]) expect(typeOf(s, code).rabaedDefaults.length).toBeLessThanOrEqual(1);
  });
});

describe("scenario RP-596-2: a DAR on 1→1 → Owner review", () => {
  it("runs Contractor PM → Consultant PM → Owner, and closes on the Owner's Confirm", async () => {
    const id = await raised("Cable sizing calculation");
    expect(await detail(ali, id)).toMatchObject({ stage: { key: "internal_review" }, workflow: { versionNo: 1 } });
    await take(ali, id, "submit", { answers: { cover_note: "Calculation for Level 2" } });
    expect((await detail(mohammed, id)).stage.key).toBe("pending_approval");
    // The Consultant PM Recommends B to the Owner: nothing closes.
    await take(mohammed, id, "recommend_b", { answers: { ...reviewReply, remarks: "B, with one comment", ...comments } });
    expect(await detail(ali, id)).toMatchObject({ outcome: null });
    expect((await detail(faisal, id)).actions.transitions.map((t) => t.label.en).sort()).toEqual(["Confirm", "Send Back"]);
    await ok(faisal.post(`/v1/work-items/${id}/pick-up`));
    await take(faisal, id, "confirm_b");
    for (const by of [ali, mohammed, faisal]) {
      const d = await detail(by, id);
      expect([d.outcome, d.stage.category]).toEqual(["B", "closed_positive"]);
    }
    expect((await detail(ali, id)).comments).toEqual({ open: 1, closed: 0 });
  });

  it("an Owner's Send Back returns it to the Consultant PM, who recommends another Code that the Owner confirms", async () => {
    const id = await raised("Panel schedule");
    await take(ali, id, "submit");
    await take(mohammed, id, "recommend_a", { answers: reviewReply });
    await ok(faisal.post(`/v1/work-items/${id}/pick-up`));
    await take(faisal, id, "owner_send_back", { reason: "Revise the load figures" });
    expect((await detail(mohammed, id)).actions.transitions.map((t) => t.key)).toEqual(expect.arrayContaining(["recommend_c"]));
    await take(mohammed, id, "recommend_c", { answers: { ...reviewReply, remarks: "Load figures to be revised" } });
    await ok(faisal.post(`/v1/work-items/${id}/pick-up`));
    await take(faisal, id, "confirm_c");
    expect(await detail(ali, id)).toMatchObject({ outcome: "C", stage: { key: "revise_resubmit" } });
  });
});

describe("a Project Admin binds another of the eight for a Type", () => {
  it("DAR bound to 1→1 closes on the Consultant PM's Code, without the Owner; items already raised keep their Version", async () => {
    const before = await raised("Raised before the change");
    await bind("DAR", "1-1");
    expect(typeOf(await settings(c1.caller), "DAR").workflow.name.en).toBe(submittalWorkflows[0].name.en);
    const id = await raised("Calculation without the Owner");
    await take(ali, id, "submit");
    await take(mohammed, id, "approve_a", { answers: reviewReply });
    expect(await detail(ali, id)).toMatchObject({ outcome: "A", stage: { key: "approved" } });
    // The item raised before was on 1→1 → Owner review and still is: the Consultant PM Recommends.
    await take(ali, before, "submit");
    expect((await detail(mohammed, before)).actions.transitions.map((t) => t.key)).toContain("recommend_a");
  });

  it("DAR bound to 2→2 → Owner review runs both Engineers' Steps and the Owner's review", async () => {
    await bind("DAR", "2-2-owner");
    const id = await raised("Full chain");
    // The Contractor PM Returns it to the Engineer, who sends it again.
    await take(ali, id, "return", { reason: "Add the cable schedule" });
    await take(hafiz, id, "send_for_review_again");
    await take(ali, id, "submit");
    // The Consultant Engineer replies and Recommends to the PM, who Recommends to the Owner.
    await take(ahmed, id, "send_to_manager", { answers: reviewReply, recommendedCode: "A", internalNote: "Engineer: checked" });
    await take(mohammed, id, "recommend_a", { answers: reviewReply });
    await ok(faisal.post(`/v1/work-items/${id}/pick-up`));
    await take(faisal, id, "confirm_a");
    expect(await detail(ali, id)).toMatchObject({ outcome: "A", stage: { key: "approved" } });
  });

  it("publishing a Rabaed Default the Type doesn't run counts only the Projects that bind it (RP-566's check)", async () => {
    const mar = typeOf(await settings(c1.caller), "MAR");
    const variant = mar.rabaedDefaults.find((d) => d.name.en === submittalWorkflows[0].name.en)!;
    const lacking = (id: string) => projectsLackingOutcomesAndStages(migrator, id, mar.id, { outcomes: ["ZZ"], stages: [] });
    // No Project has the outcome "ZZ": every Project running the Type's own Workflow lacks it, none running 1→1 does.
    expect((await lacking(mar.workflow.id)).projects).toBeGreaterThan(0);
    expect((await lacking(variant.id)).projects).toBe(0);
    await bind("MAR", "1-1");
    expect((await lacking(variant.id)).projects).toBeGreaterThan(0);
    await ok(c1.caller.request("DELETE", `/v1/projects/${projectId}/workflow-bindings?workItemTypeId=${mar.id}`));
    expect((await lacking(variant.id)).projects).toBe(0);
  });

  it("a Project Admin can duplicate a Rabaed Default of the Type into the Project, its own to edit", async () => {
    const dar = typeOf(await settings(c1.caller), "DAR");
    const source = dar.rabaedDefaults.find((d) => d.name.en === submittalWorkflows[2].name.en)!;
    const copy = await ok(c1.caller.post(`/v1/workflows/${source.id}/duplicate`, { projectId, name: bilingual("2→1 copy") }), 201);
    const id = copy.json().id as string;
    const after = typeOf(await settings(c1.caller), "DAR");
    expect(after.copies.map((c) => c.id)).toContain(id);
    // Back on the Type's Rabaed Default, for whatever runs after.
    await ok(c1.caller.request("DELETE", `/v1/projects/${projectId}/workflow-bindings?workItemTypeId=${dar.id}`));
  });
});
