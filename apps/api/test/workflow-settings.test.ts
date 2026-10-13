// Seam 1 for Project → Settings → Workflows (RP-441, WF-18; spec RP-423, RP-511; ADR 0016
// and 0019; visibility.md V15, V18, V20, scenario RP-441-1). A Project Admin reads which
// Workflow each Work Item Type runs (the Rabaed Default or the Project's copy, with its
// Version, and exceptions for one raising Participant), copies Workflows, binds them and
// publishes Screens; every other Member reads the same, minus the drafts, the Library and
// the exceptions that are not their own Participant's. Each published Workflow Version is
// read whole, and which Screen Version it pins.
import { createDb, readLatestPublishedDefinition, writeRabaedDefaultWorkflow } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { ScreenPins, WorkflowDefinition, WorkflowRead, WorkflowSettings, WorkflowVersionRead } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, buildTower, detail, draft, ok, projectMember, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const label = (en: string) => ({ en, ar: en });
const settings = async (by: Caller, projectId: string): Promise<WorkflowSettings> =>
  (await ok(by.get(`/v1/projects/${projectId}/workflow-settings`), 200)).json();
const marOf = (s: WorkflowSettings) => s.types.find((t) => t.code === "MAR")!;

let c1: Company;
let k1: Company;
let c2: Company;
let at: Tower;
let other: Tower;
let c2Engineer: Caller;
let c2ParticipantId = "";
let marTypeId = "";
let marWorkflowId = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  c2 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "WFS");
  other = await buildTower(api, { c1: await api.projectCreator(), k1: await api.authorizedPerson() }, "WFO");
  c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  const mar = await sql<{ id: string; workflow_definition_id: string }>`
    select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'
  `.execute(migrator);
  marTypeId = mar.rows[0]!.id;
  marWorkflowId = mar.rows[0]!.workflow_definition_id;
});

describe("which Workflow each Type runs", () => {
  it("is the Rabaed Default for every Member, the Project Admin told they may change it", async () => {
    const asAdmin = await settings(c1.caller, at.projectId);
    expect(asAdmin.canEdit).toBe(true);
    expect(marOf(asAdmin)).toMatchObject({
      code: "MAR",
      moduleKey: "submittals",
      workflow: { id: marWorkflowId, versionNo: 3, source: "rabaed_default" }, // MAR v3 since RP-437 (ADR 0020)
      exceptions: [],
      copies: [],
    });
    const asConsultant = await settings(at.k1Manager, at.projectId);
    expect(asConsultant.canEdit).toBe(false);
    expect(marOf(asConsultant).workflow).toEqual(marOf(asAdmin).workflow);
  });

  it("is the same 404 to anyone outside the Project and for a made-up id", async () => {
    await expectHidden(other.c1Engineer.get(`/v1/projects/${at.projectId}/workflow-settings`));
    await expectHidden(c1.caller.get("/v1/projects/00000000-0000-4000-8000-000000000000/workflow-settings"));
  });

  it("is the Project's copy once duplicated, published and bound; its draft is the Project Admins' alone", async () => {
    const copy = (await ok(c1.caller.post(`/v1/workflows/${marWorkflowId}/duplicate`, { projectId: at.projectId, name: label("Tower MARs") }), 201)).json().id;
    // Not published yet: the Project Admin lists it as a copy to finish; nobody else knows of it.
    expect(marOf(await settings(c1.caller, at.projectId)).copies).toEqual([
      { id: copy, name: label("Tower MARs"), versionNo: null, bound: false, hasDraft: true },
    ]);
    expect(marOf(await settings(at.k1Manager, at.projectId)).copies).toEqual([]);
    await ok(c1.caller.post(`/v1/workflows/${copy}/publish`), 200);
    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: marTypeId, raisingParticipantId: null, workflowId: copy }));
    for (const reader of [c1.caller, at.k1Manager, at.c1Engineer]) {
      expect(marOf(await settings(reader, at.projectId)).workflow).toEqual({ id: copy, name: label("Tower MARs"), versionNo: 1, source: "project_copy" });
    }
    expect(marOf(await settings(c1.caller, at.projectId)).copies).toEqual([{ id: copy, name: label("Tower MARs"), versionNo: 1, bound: true, hasDraft: false }]);
    // Another Project still runs the Rabaed Default.
    expect(marOf(await settings(other.c1Engineer, other.projectId)).workflow.source).toBe("rabaed_default");
  });

  it("shows an exception to its Participant's Members and the Project Admins only (scenario RP-441-1, V15)", async () => {
    const route = (await ok(c1.caller.post(`/v1/workflows/${marWorkflowId}/duplicate`, { projectId: at.projectId, name: label("MARs, short route") }), 201)).json().id;
    await ok(c1.caller.post(`/v1/workflows/${route}/publish`), 200);
    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: marTypeId, raisingParticipantId: c2ParticipantId, workflowId: route }));
    const c2Name = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants.find((p: { id: string }) => p.id === c2ParticipantId).company.legalName;
    const expected = { participantId: c2ParticipantId, companyName: c2Name, workflow: { id: route, name: label("MARs, short route"), versionNo: 1 } };
    expect(marOf(await settings(c1.caller, at.projectId)).exceptions).toEqual([expected]);
    expect(marOf(await settings(c2Engineer, at.projectId)).exceptions).toEqual([expected]);
    // K1 and C1's engineer learn of no exception (and so of no Participant).
    for (const reader of [at.k1Manager, at.c1Engineer]) {
      const read = await settings(reader, at.projectId);
      expect(marOf(read).exceptions).toEqual([]);
      expect(JSON.stringify(read)).not.toContain(c2ParticipantId);
    }
    // Taking it away: back to the binding.
    await ok(c1.caller.request("DELETE", `/v1/projects/${at.projectId}/workflow-bindings?workItemTypeId=${marTypeId}&raisingParticipantId=${c2ParticipantId}`));
    expect(marOf(await settings(c1.caller, at.projectId)).exceptions).toEqual([]);
  });

  it("offers a Project Admin their own Company's Library Workflows, never another Company's (V18)", async () => {
    const lib = (await ok(c1.caller.post(`/v1/workflows/${marWorkflowId}/duplicate`, { projectId: null, name: label("C1 library MAR") }), 201)).json().id;
    expect((await settings(c1.caller, at.projectId)).library).toEqual([]); // not published yet
    await ok(c1.caller.post(`/v1/workflows/${lib}/publish`), 200);
    expect((await settings(c1.caller, at.projectId)).library).toEqual([{ id: lib, name: label("C1 library MAR"), versionNo: 1, workItemTypeId: marTypeId }]);
    expect((await settings(at.k1Manager, at.projectId)).library).toEqual([]);
    expect((await settings(other.c1Engineer, other.projectId)).library).toEqual([]);
  });
});

describe("View versions", () => {
  let route = "";
  it("reads each published Version whole, as every Project Member may (V20)", async () => {
    const read = (await settings(c1.caller, at.projectId));
    route = marOf(read).workflow.id;
    const v1: WorkflowVersionRead = (await ok(at.k1Manager.get(`/v1/workflows/${route}/versions/1`), 200)).json();
    expect(v1).toMatchObject({ name: label("Tower MARs"), versionNo: 1, publishedVersions: [1] });
    expect(v1.definition.steps.length).toBeGreaterThan(3);
    expect(v1.stages.length).toBeGreaterThan(3);
    // A Rabaed Default's Versions too, with the Rabaed Stage set.
    const mar: WorkflowVersionRead = (await ok(at.k1Manager.get(`/v1/workflows/${marWorkflowId}/versions/1`), 200)).json();
    expect(mar.versionNo).toBe(1);
    expect(mar.publishedVersions).toEqual([1, 2, 3]);
  });

  it("is the plain 404 for a Version that isn't published, another Project's Workflow, and a made-up one", async () => {
    const draftCopy = (await ok(c1.caller.post(`/v1/workflows/${marWorkflowId}/duplicate`, { projectId: at.projectId, name: label("Only a draft") }), 201)).json().id;
    await expectHidden(c1.caller.get(`/v1/workflows/${draftCopy}/versions/1`));
    await expectHidden(c1.caller.get(`/v1/workflows/${route}/versions/9`));
    await expectHidden(other.c1Engineer.get(`/v1/workflows/${route}/versions/1`));
    await expectHidden(c1.caller.get("/v1/workflows/00000000-0000-4000-8000-000000000000/versions/1"));
  });
});

describe("which Screen Versions the Workflow Versions pin", () => {
  it("lists a Screen's pins; a new Screen Version never moves an earlier Workflow Version's pin", async () => {
    const schema = (text: string) => ({ sections: [{ key: "reply", title: label("Reply"), fields: [{ key: "remarks", type: "textarea", label: label(text) }] }] });
    const screen = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/screens`, { key: "pin_reply", name: label("Pin reply"), schema: schema("Remarks"), internalFields: [] }), 201)).json().id;
    await ok(c1.caller.post(`/v1/screens/${screen}/publish`), 200);

    const route = marOf(await settings(c1.caller, at.projectId)).workflow.id;
    const current: WorkflowRead = (await ok(c1.caller.get(`/v1/workflows/${route}`), 200)).json();
    const definition = current.published!.definition;
    const sendKey = definition.transitions.find((t) => t.kind === "send")!.key;
    const withScreen: WorkflowDefinition = {
      ...definition,
      transitions: definition.transitions.map((t) => (t.key === sendKey ? { ...t, actionForm: null, screen: "pin_reply" } : t)),
    };
    await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition: withScreen }), 200);
    await ok(c1.caller.post(`/v1/workflows/${route}/publish`), 200); // Workflow Version 2 pins Screen Version 1
    // A running item on Workflow Version 2, raised before the Screen changes.
    const running = await draft(at, at.c1Engineer, "Pinned while running", { type: "MAR" });
    const sendForm = async () => (await detail(at.c1Engineer, running)).actions.transitions.find((t) => t.key === sendKey)?.actionForm;
    expect(await sendForm()).toMatchObject(schema("Remarks"));

    await ok(c1.caller.request("PUT", `/v1/screens/${screen}/draft`, { schema: schema("Remarks (new)"), internalFields: [] }), 200);
    await ok(c1.caller.post(`/v1/screens/${screen}/publish`), 200); // Screen Version 2
    // The running item keeps its pinned Screen Version 1 (scenario RP-441-1).
    expect(await sendForm()).toMatchObject(schema("Remarks"));

    const pinsOf = async (by: Caller): Promise<ScreenPins["pins"]> => (await ok(by.get(`/v1/projects/${at.projectId}/screen-pins`), 200)).json().pins;
    for (const reader of [c1.caller, at.k1Manager]) {
      expect((await pinsOf(reader)).filter((p) => p.screenKey === "pin_reply")).toEqual([
        { screenId: screen, screenKey: "pin_reply", screenVersionNo: 1, workflowId: route, workflowName: label("Tower MARs"), workflowVersionNo: 2 },
      ]);
    }
    await expectHidden(other.c1Engineer.get(`/v1/projects/${at.projectId}/screen-pins`));
  });
});

describe("a Stage the Project Admin renames (scenario RP-441-1)", () => {
  it("reads renamed to everyone on the Project, in its Stages and its Workflow Versions; nobody else learns of it or may do it", async () => {
    const stagesOf = async (by: Caller, projectId: string) =>
      (await ok(by.get(`/v1/projects/${projectId}/modules/submittals/stages`), 200)).json().stages as { key: string; name: { en: string; ar: string } }[];
    const before = (await stagesOf(other.c1Engineer, other.projectId)).find((s) => s.key === "approved")!.name;

    // Only a Project Admin renames it; anyone else, on the Project or not, gets the plain 404.
    for (const by of [at.c1Engineer, at.k1Manager, other.c1Engineer]) {
      await expectHidden(by.request("PATCH", `/v1/projects/${at.projectId}/modules/submittals/stages/approved`, { name: label("Signed off") }));
    }
    await ok(c1.caller.request("PATCH", `/v1/projects/${at.projectId}/modules/submittals/stages/approved`, { name: label("Signed off") }));

    const route = marOf(await settings(c1.caller, at.projectId)).workflow.id;
    for (const reader of [c1.caller, at.c1Engineer, at.k1Manager, c2Engineer]) {
      expect((await stagesOf(reader, at.projectId)).find((s) => s.key === "approved")!.name).toEqual(label("Signed off"));
      const v1: WorkflowVersionRead = (await ok(reader.get(`/v1/workflows/${route}/versions/1`), 200)).json();
      expect(v1.stages.find((s) => s.key === "approved")!.name).toEqual(label("Signed off"));
    }
    // Another Project's set is its own: unchanged, and this one is hidden from its Members.
    expect((await stagesOf(other.c1Engineer, other.projectId)).find((s) => s.key === "approved")!.name).toEqual(before);
    await expectHidden(other.c1Engineer.get(`/v1/projects/${at.projectId}/modules/submittals/stages`));
  });
});

// RP-443-1 (Rabaed Admin -> Workflows): a new Rabaed Default Version is what new items start on,
// on every Project running the Default; items already raised keep theirs. Published as Rabaed
// Admin publishes it (writeRabaedDefaultWorkflow), on a test Rabaed Type of its own (MAR's Form
// and Workflow), so no other suite's Default changes under it.
describe("a new Rabaed Default Version (scenario RP-443-1)", () => {
  const TYPE = "RDV";
  let definitionId = "";

  beforeAll(async () => {
    const existing = await sql<{ workflow_definition_id: string }>`
      select workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = ${TYPE}
    `.execute(migrator);
    if (existing.rows[0]) {
      definitionId = existing.rows[0].workflow_definition_id;
      return;
    }
    const created = await sql<{ id: string }>`
      insert into workflow_definition (owner_kind, name) values ('rabaed', ${JSON.stringify(label("Default Version (test)"))}::jsonb) returning id
    `.execute(migrator);
    definitionId = created.rows[0]!.id;
    await sql`
      insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
      select 'rabaed', t.module_key, ${TYPE}, ${JSON.stringify(label("Default Version (test)"))}::jsonb, ${definitionId}::uuid, t.outcome_kind, t.form_definition_id
      from work_item_type t where t.owner_kind = 'rabaed' and t.code = 'MAR'
    `.execute(migrator);
    const mar = (await readLatestPublishedDefinition(migrator, marWorkflowId))!;
    expect(await writeRabaedDefaultWorkflow(migrator, TYPE, mar.definition, { publish: true })).toMatchObject({ ok: true });
  });

  const raise = async (title: string): Promise<string> => {
    const res = await at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: TYPE,
      title,
      answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: at.electrical, location: at.buildingA },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id;
  };

  it("is what a Project on the Default raises new items on; a raised item keeps its Version; Members read no draft", async () => {
    const before = (await readLatestPublishedDefinition(migrator, definitionId))!;
    const earlier = await raise("On the earlier Version");
    expect((await detail(at.c1Engineer, earlier)).workflow.versionNo).toBe(before.versionNo);

    const next: WorkflowDefinition = {
      ...before.definition,
      steps: before.definition.steps.map((s) => (s.key === "draft" ? { ...s, name: label(`Prepare v${before.versionNo + 1}`) } : s)),
    };
    // A draft first: no Member reads it, the Project Admin included.
    expect(await writeRabaedDefaultWorkflow(migrator, TYPE, next, { publish: false })).toMatchObject({ ok: true });
    for (const reader of [c1.caller, at.c1Engineer]) {
      const read: WorkflowRead = (await ok(reader.get(`/v1/workflows/${definitionId}`), 200)).json();
      expect(read).toMatchObject({ draft: null, canAuthor: false, publishedVersions: expect.not.arrayContaining([before.versionNo + 1]) });
    }
    expect(await writeRabaedDefaultWorkflow(migrator, TYPE, next, { publish: true })).toMatchObject({ ok: true, versionNo: before.versionNo + 1 });

    // The raiser reads its Drafts (nobody else sees an item before its Submit).
    const later = await raise("On the new Version");
    expect((await detail(at.c1Engineer, later)).workflow.versionNo).toBe(before.versionNo + 1);
    expect((await detail(at.c1Engineer, earlier)).workflow.versionNo).toBe(before.versionNo);
    for (const reader of [c1.caller, at.c1Engineer]) {
      const read: WorkflowRead = (await ok(reader.get(`/v1/workflows/${definitionId}`), 200)).json();
      expect(read).toMatchObject({ draft: null, published: { versionNo: before.versionNo + 1 } });
    }
    const type = (await settings(c1.caller, at.projectId)).types.find((t) => t.code === TYPE)!;
    expect(type.workflow).toMatchObject({ id: definitionId, versionNo: before.versionNo + 1, source: "rabaed_default" });
  });
});
