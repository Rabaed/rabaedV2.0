// Seam 1: publishing from the builder to the owner's reference (RP-555; spec RP-528).
// The publish dialog asks for a change note, which the Version keeps and the Versions
// history shows to the Workflow's authors; it says how many items keep an older Version,
// counting only the items the publishing Project Admin sees (scenario RP-555-1); and the
// publish checks refuse a Send that hands the item to another Participant ("use Submit").
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkflowBuilderRead, WorkflowDefinition, WorkflowVersionRead } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, buildTower, draft, ok, projectMember, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const ROUTE = { en: "Tower MAR, noted", ar: "اعتماد المواد، مع ملاحظة" };

let c1: Company;
let at: Tower;
let c2Engineer: Caller;
let marTypeId = "";
let route = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1: Company = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "WPN");
  const c2: Company = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  const mar = await sql<{ id: string; workflow_definition_id: string }>`
    select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'
  `.execute(migrator);
  marTypeId = mar.rows[0]!.id;
  const res = await c1.caller.post(`/v1/workflows/${mar.rows[0]!.workflow_definition_id}/duplicate`, { projectId: at.projectId, name: ROUTE });
  expect(res.statusCode, res.body).toBe(201);
  route = res.json().id;
});

const builder = async (by: Caller): Promise<WorkflowBuilderRead> => (await ok(by.get(`/v1/workflows/${route}/builder`), 200)).json();
const versions = async (by: Caller, n: number): Promise<WorkflowVersionRead> => (await ok(by.get(`/v1/workflows/${route}/versions/${n}`), 200)).json();
/** Opens a new draft of the route: its latest Version as it is. */
const newDraft = async (): Promise<WorkflowDefinition> => {
  const definition = (await builder(c1.caller)).workflow.published!.definition;
  await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition }), 200);
  return definition;
};

describe("the change note", () => {
  it("is kept with the Version it was published with, and the Versions history shows it to the Workflow's authors only", async () => {
    await ok(c1.caller.post(`/v1/workflows/${route}/publish`, { changeNote: "  Tower's own route for MARs.  " }), 200);
    const history = (await versions(c1.caller, 1)).history;
    expect(history).toEqual([{ versionNo: 1, publishedAt: expect.any(String), changeNote: "Tower's own route for MARs.", running: 0 }]);
    // Every Project Member reads the Version (V20), but not its Change Note: an exception's could name whom it is for (V15).
    expect((await versions(at.c1Engineer, 1)).history).toEqual([{ versionNo: 1, publishedAt: expect.any(String), changeNote: null, running: 0 }]);
  });

  it("is refused when blank, and nothing is published", async () => {
    await newDraft();
    expect((await c1.caller.post(`/v1/workflows/${route}/publish`, { changeNote: "   " })).statusCode).toBe(400);
    expect((await builder(c1.caller)).workflow.publishedVersions).toEqual([1]);
  });
});

describe("on an exception's Workflow", () => {
  // As its name (scenario RP-427-4): an exception's Change Note never names the Participant it is for (V15).
  const C3_LEGAL_NAME = { en: "Najd Facades Contracting", ar: "مقاولات واجهات نجد" };
  let exception = "";
  beforeAll(async () => {
    const c3Company = await api.onboardCompany({ legalName: C3_LEGAL_NAME });
    const c3: Company = { company: c3Company, caller: await api.acceptInvitation(c3Company.invitationToken) };
    const c3Participant = await api.addParticipant(c1.caller, at.projectId, c3.company, "contractor");
    const mar = await sql<{ workflow_definition_id: string }>`
      select workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'
    `.execute(migrator);
    const res = await c1.caller.post(`/v1/workflows/${mar.rows[0]!.workflow_definition_id}/duplicate`, { projectId: at.projectId, name: { en: "MARs, facade route", ar: "مسار الواجهات" } });
    expect(res.statusCode, res.body).toBe(201);
    exception = res.json().id;
    await ok(c1.caller.post(`/v1/workflows/${exception}/publish`, { changeNote: "First version of the facade route." }), 200);
    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: marTypeId, raisingParticipantId: c3Participant, workflowId: exception }));
  });

  it("is refused when it names the Participant the exception is for, and nothing is published", async () => {
    const definition = (await ok(c1.caller.get(`/v1/workflows/${exception}/builder`), 200)).json().workflow.published.definition;
    await ok(c1.caller.request("PUT", `/v1/workflows/${exception}/draft`, { definition }), 200);
    const refused = await c1.caller.post(`/v1/workflows/${exception}/publish`, { changeNote: `Shorter route for ${C3_LEGAL_NAME.en}.` });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({ error: "change_note_names_participant" });
    expect((await ok(c1.caller.get(`/v1/workflows/${exception}/builder`), 200)).json().workflow.publishedVersions).toEqual([1]);
    // Said without naming them, it publishes.
    await ok(c1.caller.post(`/v1/workflows/${exception}/publish`, { changeNote: "Shorter route for facade submittals." }), 200);
    expect((await ok(c1.caller.get(`/v1/workflows/${exception}/builder`), 200)).json().workflow.publishedVersions).toEqual([1, 2]);
  });
});

describe("items that keep their Version", () => {
  // Scenario RP-555-1.
  it("are counted as each reader sees them: the Project Admin counts no Draft it doesn't see", async () => {
    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: marTypeId, raisingParticipantId: null, workflowId: route }));
    const own = await draft(at, at.c1Engineer, "C1's MAR on the noted route");
    const other = await draft(at, c2Engineer, "C2's MAR on the noted route");
    // Two MARs run on Version 1, and the Project Admin (on no Participant's team) sees neither.
    for (const id of [own, other]) expect((await c1.caller.get(`/v1/work-items/${id}`)).statusCode).toBe(404);
    expect((await builder(c1.caller)).running).toEqual([]);
    // Each reader of the history counts only what they see: C1's engineer their own MAR, C2's engineer theirs.
    expect((await versions(at.c1Engineer, 1)).history[0]!.running).toBe(1);
    expect((await versions(c2Engineer, 1)).history[0]!.running).toBe(1);
  });
});

describe("a Send to another Participant", () => {
  it("is a publish problem: the author is told to use Submit, and the draft isn't published", async () => {
    const definition = await newDraft();
    const crossing = {
      ...definition,
      transitions: definition.transitions.map((t) => (t.kind === "submit" ? { ...t, kind: "send" as const } : t)),
    };
    await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition: crossing }), 200);
    const checked = (await ok(c1.caller.post(`/v1/workflows/${route}/validate`, {}), 200)).json();
    const found = checked.problems.filter((p: { code: string }) => p.code === "send_crosses_participants");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toMatchObject({ severity: "error", message: { en: expect.stringContaining("use Submit") } });
    const refused = await c1.caller.post(`/v1/workflows/${route}/publish`, { changeNote: "Sends across" });
    expect(refused.statusCode).toBe(422);
    expect((await builder(c1.caller)).workflow.publishedVersions).toEqual([1]);
  });
});
