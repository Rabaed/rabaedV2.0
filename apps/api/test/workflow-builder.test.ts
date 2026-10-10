// Seam 1: the Workflow builder (RP-439, WF-16; spec RP-423; workflow-engine.md §11).
// The builder reads what it edits with (`GET /v1/workflows/:id/builder`: the draft,
// the Module's Stages, the Type's outcome set and the Positions), changes the draft
// through @rabaed/domain's edits, and saves, validates and publishes through WF-4's
// API (RP-427). The ticket's acceptance runs here end to end: a Project Admin
// duplicates the MAR, adds an Owner Representative approval Step with a Code
// Transition, validates, publishes Version 1 of the Project's copy and binds it
// (through WF-4's API: binding in Project Settings is RP-441), and a new MAR follows it.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import {
  addStep,
  connectSteps,
  updateStep,
  updateTransition,
  type WorkflowBuilderRead,
  type WorkflowDefinition,
  type WorkflowRead,
} from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, buildTower, detail, draft, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const ROUTE = { en: "Tower MAR with Owner Rep", ar: "اعتماد المواد مع ممثل المالك" };
/** A Position of the Owner Representative that may approve Submittals: the Rabaed Defaults give it only "view". */
const APPROVER = "builder_approver";

let c1: Company;
let at: Tower;
let k1Engineer: Caller;
let ownerRep: Caller;
let marTypeId = "";
let marDefault = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1: Company = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "WFB");
  const k1ParticipantId = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => !p.isOwnCompany).id;
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  await sql`
    insert into position (owner_kind, base_role, key, name, sort)
    values ('rabaed', 'owner_representative', ${APPROVER}, '{"en": "Approver (test)", "ar": "معتمد (اختبار)"}', 99)
    on conflict (base_role, key) do nothing
  `.execute(migrator);
  await sql`
    insert into position_permission (position_id, module_key, permission)
    select p.id, 'submittals', x from position p cross join unnest(array['view', 'approve']) x
    where p.base_role = 'owner_representative' and p.key = ${APPROVER}
    on conflict do nothing
  `.execute(migrator);
  const r1: Company = await api.authorizedPerson();
  const r1ParticipantId = await api.addParticipant(c1.caller, at.projectId, r1.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${r1ParticipantId}/visibility`, { trade: all, location: all }));
  ownerRep = await projectMember(api, r1, r1ParticipantId, [APPROVER]);
  const mar = await sql<{ id: string; workflow_definition_id: string }>`
    select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'
  `.execute(migrator);
  marTypeId = mar.rows[0]!.id;
  marDefault = mar.rows[0]!.workflow_definition_id;
});

const builder = async (by: Caller, id: string): Promise<WorkflowBuilderRead> => (await ok(by.get(`/v1/workflows/${id}/builder`), 200)).json();
const read = async (by: Caller, id: string): Promise<WorkflowRead> => (await ok(by.get(`/v1/workflows/${id}`), 200)).json();

describe("a Project Admin builds the Project's copy of the MAR", () => {
  let route = "";
  let edited: WorkflowDefinition;

  it("opens the builder on the duplicated draft, with the Module's Stages, the Type's outcome set and the Positions", async () => {
    const res = await c1.caller.post(`/v1/workflows/${marDefault}/duplicate`, { projectId: at.projectId, name: ROUTE });
    expect(res.statusCode, res.body).toBe(201);
    route = res.json().id;
    const read = await builder(c1.caller, route);
    expect(read.workflow).toMatchObject({ id: route, name: ROUTE, owner: "project", draft: { versionNo: 1 }, canAuthor: true });
    expect(read.type).toEqual({ code: "MAR", name: expect.objectContaining({ en: expect.any(String), ar: expect.any(String) }) });
    expect(read.stages.map((s) => s.key)).toEqual(expect.arrayContaining(["draft", "pending_approval", "approved", "cancelled"]));
    expect(read.stages.find((s) => s.key === "approved")).toMatchObject({ category: "closed_positive", name: { en: expect.any(String), ar: expect.any(String) } });
    expect(read.outcomes.map((o) => o.code)).toEqual(expect.arrayContaining(["A", "B", "C", "D"]));
    expect(read.outcomes.find((o) => o.code === "A")).toMatchObject({ closing: true, polarity: "positive" });
    expect(read.positions).toContainEqual({ role: "owner_representative", key: APPROVER, name: { en: "Approver (test)", ar: "معتمد (اختبار)" } });
    expect(read.positions).toContainEqual(expect.objectContaining({ role: "consultant", key: "manager" }));
  });

  it("adds an Owner Representative approval Step with a Code Transition, and validates it with no errors", async () => {
    const start = (await builder(c1.caller, route)).workflow.draft!.definition;
    const issuing = start.steps.find((s) => s.outcomeMode === "issue_outcome")!;
    const approved = start.steps.find((s) => s.stage === "approved")!;
    const added = addStep(start, {
      name: { en: "Owner Representative approval", ar: "اعتماد ممثل المالك" },
      stage: issuing.stage,
      actor: { role: "owner_representative", permission: "approve", positions: [APPROVER] },
    });
    let definition = updateStep(added.definition, added.key, { outcomeMode: "issue_outcome" });
    const toOwner = connectSteps(definition, issuing.key, added.key, { en: "Send to Owner Rep", ar: "إرسال لممثل المالك" });
    const code = connectSteps(toOwner.definition, added.key, approved.key, { en: "Owner Approve – Code A", ar: "اعتماد المالك – Code A" });
    definition = updateTransition(code.definition, code.key, { outcome: "A" });
    expect(definition.transitions.find((t) => t.key === toOwner.key)?.kind).toBe("submit");
    edited = definition;

    await ok(c1.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition }), 200);
    const checked = await ok(c1.caller.post(`/v1/workflows/${route}/validate`, { definition }), 200);
    expect(checked.json().issues).toEqual([]);
    expect(checked.json().problems.filter((p: { severity: string }) => p.severity === "error")).toEqual([]);
  });

  it("publishes it as Version 1 and binds the MAR to it; a new MAR follows the Owner Representative's approval to Code A", async () => {
    await ok(c1.caller.post(`/v1/workflows/${route}/publish`), 200);
    expect(await read(c1.caller, route)).toMatchObject({ publishedVersions: [1], published: { versionNo: 1, definition: edited }, draft: null });
    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: marTypeId, raisingParticipantId: null, workflowId: route }));

    const id = await draft(at, at.c1Engineer, "Follows the Owner Rep route");
    expect((await detail(at.c1Engineer, id)).workflow).toEqual({ name: ROUTE, versionNo: 1 });
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/claim`));
    await take(at.c1Pm, id, "submit");
    const answers = { ...(await detail(k1Engineer, id)).answers, sample_checked: true, matches_specification: true, verification_note: "As specified" };
    await ok(k1Engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers }));
    await ok(at.k1Manager.post(`/v1/work-items/${id}/claim`));
    await take(at.k1Manager, id, "send_to_owner_rep");
    expect((await detail(ownerRep, id)).step.name.en).toBe("Owner Representative approval");
    await ok(ownerRep.post(`/v1/work-items/${id}/claim`));
    await take(ownerRep, id, "owner_approve_code_a");
    expect(await detail(at.c1Engineer, id)).toMatchObject({ outcome: "A", step: { name: { en: "Approved" } } });
  });
});

describe("only the Workflow's authors open the builder", () => {
  it("a Project Member, a Rabaed Default and a made-up id are the same 404", async () => {
    const res = await c1.caller.post(`/v1/workflows/${marDefault}/duplicate`, { projectId: at.projectId, name: { en: "Kept", ar: "محفوظ" } });
    const id = res.json().id;
    await expectHidden(at.c1Engineer.get(`/v1/workflows/${id}/builder`));
    await expectHidden(k1Engineer.get(`/v1/workflows/${id}/builder`));
    await expectHidden(c1.caller.get(`/v1/workflows/${marDefault}/builder`));
    await expectHidden(c1.caller.get(`/v1/workflows/${crypto.randomUUID()}/builder`));
    await expectHidden(c1.caller.get(`/v1/workflows/not-an-id/builder`));
  });
});
