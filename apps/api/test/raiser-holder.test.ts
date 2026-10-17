// Seam 1 for the raiser as a Step holder (RP-622, SNAG-2; spec RP-619; workflow-engine.md
// §3.1; visibility.md V1, V3 and scenarios RP-622-1, RP-622-2).
//
// The Snag's Version 2 (apps/admin/workflows/SNG.json) holds Draft and Verify by the raiser.
// A Contractor raises a Snag on itself: Open is of its own role, so it holds every Step,
// works the Snag and closes it, and nothing of it reaches another Company (until SNAG-3
// informs the Consultant). The Consultant raises one on the Contractor and verifies it on the
// same Version. An item started on a Version whose Steps name roles finishes on it after a
// raiser Version is published.
import { sql } from "kysely";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkflowDefinition, WorkflowRead, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, only, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company;
let at: Tower;
let c2Engineer: Caller; // Another Contractor of the same Trade, covering Building B only (V3).

const snags = async (by: Caller): Promise<WorkItemList> => (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items`), 200)).json();

/** `by`'s Draft Snag on Building A, Electrical. */
async function draftSnag(by: Caller, title: string): Promise<string> {
  const answers = { description: `${title}: see the photos`, trade: at.electrical, location: at.buildingA };
  return (await ok(by.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title, answers }), 201)).json().id as string;
}

/** `by` takes `transition` on `id` and holds the Step it leads to, picking it up from its Participant's Step Pool. */
async function move(by: Caller, id: string, transition: string, options: Parameters<typeof take>[3] = {}) {
  await take(by, id, transition, options);
  if ((await detail(by, id)).actions.pickUp) await ok(by.post(`/v1/work-items/${id}/pick-up`));
}

const offered = async (by: Caller, id: string) => (await detail(by, id)).actions.transitions.map((t) => t.key);

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RSH");
  const buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
});

describe("a Contractor's Snag on itself (seam 1)", () => {
  it("C1 raises it, moves it In Progress, resolves it, verifies and closes it: C1 holds every Step", async () => {
    const id = await draftSnag(at.c1Pm, "Missing fire stopping");
    expect((await detail(at.c1Pm, id)).step.key).toBe("draft");
    await move(at.c1Pm, id, "raise");
    const open = await detail(at.c1Pm, id);
    expect(open.step.key).toBe("open");
    expect(open.documentNumber).toMatch(/-SNG-/);
    expect(open.workflow.versionNo).toBe(1);

    await move(at.c1Pm, id, "start_work");
    expect((await detail(at.c1Pm, id)).stage.key).toBe("in_progress");
    await move(at.c1Pm, id, "resolve_in_progress", { answers: { resolution_note: "Sealed with intumescent mastic" } });
    const verify = await detail(at.c1Pm, id);
    expect(verify.step.key).toBe("verify");
    expect(verify.stage.key).toBe("resolved");
    // The raiser verifies: Close, or Return to Open (to C1 itself).
    expect(verify.actions.transitions.map((t) => t.key)).toEqual(expect.arrayContaining(["close", "return_to_open"]));

    await take(at.c1Pm, id, "close");
    const closed = await detail(at.c1Pm, id);
    expect(closed.outcome).toBe("closed");
    expect(closed.stage.key).toBe("closed");
  });

  it("C1's Engineer raises it too, and a Return to Open from Verify comes back to C1", async () => {
    const id = await draftSnag(at.c1Engineer, "Loose cable ties");
    await move(at.c1Engineer, id, "raise");
    await move(at.c1Engineer, id, "resolve", { answers: { resolution_note: "Tied" } });
    await move(at.c1Engineer, id, "return_to_open", { reason: "Two are still loose" });
    const back = await detail(at.c1Engineer, id);
    expect(back.step.key).toBe("open");
    expect(back.actions.transitions.map((t) => t.key)).toContain("resolve");
  });

  it("RP-622-1: its Draft and its whole journey reach no other Company: not K1, not C2, in no list or by id", async () => {
    const id = await draftSnag(at.c1Pm, "C1's own fault");
    const hidden = async (step: string) => {
      for (const other of [at.k1Manager, c2Engineer]) {
        await expectHidden(other.get(`/v1/work-items/${id}`), step);
        await expectHidden(other.get(`/v1/work-items/${id}/history`), step);
        await expectHidden(other.get(`/v1/work-items/${id}/workflow`), step);
        expect((await snags(other)).items.map((i) => i.id), step).not.toContain(id);
      }
    };
    await hidden("draft");
    await move(at.c1Pm, id, "raise");
    await hidden("open");
    await move(at.c1Pm, id, "put_on_hold");
    await hidden("on_hold");
    await move(at.c1Pm, id, "resolve_on_hold", { answers: { resolution_note: "Done" } });
    await hidden("verify");
    await take(at.c1Pm, id, "close");
    await hidden("closed");
  });

  it("its Workflow map shows every Step as C1's, folding none", async () => {
    const id = await draftSnag(at.c1Pm, "Map of a self-raised Snag");
    await move(at.c1Pm, id, "raise");
    const map = (await ok(at.c1Pm.get(`/v1/work-items/${id}/workflow`), 200)).json();
    const holders = new Map(map.definition.steps.map((s: WorkflowDefinition["steps"][number]) => [s.key, s.actor]));
    expect(holders.get("draft")).toEqual({ role: "contractor", permission: "create" });
    expect(holders.get("verify")).toEqual({ role: "contractor", permission: "close" });
    expect(map.position).toEqual({ kind: "own", stepKey: "open" });
  });
});

describe("a Consultant's Snag on the Contractor, on the same Version (seam 1)", () => {
  it("K1 raises it on C1, C1 resolves it, K1 verifies and closes it; the map names K1's Steps as the Consultant's", async () => {
    const id = await draftSnag(at.k1Manager, "Cable tray not bonded");
    await take(at.k1Manager, id, "raise");
    const open = await detail(at.c1Pm, id);
    expect(open.step.key).toBe("open");
    expect(open.workflow.versionNo).toBe(1);
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Bonded" } });

    const map = (await ok(at.c1Pm.get(`/v1/work-items/${id}/workflow`), 200)).json();
    expect(map.position).toMatchObject({ kind: "company", role: "consultant" });
    expect(await offered(at.c1Pm, id)).toEqual([]);

    expect(await offered(at.k1Manager, id)).toEqual(expect.arrayContaining(["close", "return_to_open"]));
    await take(at.k1Manager, id, "close");
    expect((await detail(at.c1Pm, id)).outcome).toBe("closed");
  });
});

describe("a Snag started on a Version whose Steps name roles (seam 1)", () => {
  const readWorkflow = async (id: string): Promise<WorkflowRead> => (await ok(c1.caller.get(`/v1/workflows/${id}`), 200)).json();
  let workflowId = "";
  let typeId = "";
  let raiserHeld: WorkflowDefinition;

  /** The Version 2 definition with its raiser's Steps held by the Consultant, as Version 1 had them. */
  const roleHeld = (definition: WorkflowDefinition): WorkflowDefinition => ({
    ...definition,
    steps: definition.steps.map((s) => (s.actor && "raiser" in s.actor ? { ...s, actor: { role: "consultant", permission: s.actor.permission } } : s)),
  });
  const publish = async (definition: WorkflowDefinition) => {
    await ok(c1.caller.request("PUT", `/v1/workflows/${workflowId}/draft`, { definition }), 200);
    const published = await c1.caller.post(`/v1/workflows/${workflowId}/publish`);
    expect(published.statusCode, published.body).toBe(200);
  };

  beforeAll(async () => {
    const type = await sql<{ id: string; workflow_definition_id: string }>`
      select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'SNG'
    `.execute(migrator);
    typeId = type.rows[0]!.id;
    const copied = await c1.caller.post(`/v1/workflows/${type.rows[0]!.workflow_definition_id}/duplicate`, {
      projectId: at.projectId,
      name: bilingual("Snags, Project copy"),
    });
    expect(copied.statusCode, copied.body).toBe(201);
    workflowId = copied.json().id;
    raiserHeld = (await readWorkflow(workflowId)).draft!.definition;
    await publish(roleHeld(raiserHeld));
    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: typeId, raisingParticipantId: null, workflowId }));
  });

  afterAll(async () => {
    await ok(c1.caller.request("DELETE", `/v1/projects/${at.projectId}/workflow-bindings?workItemTypeId=${typeId}`));
  });

  it("finishes on it once a Version with the raiser as a holder is published; a new Snag starts on the new Version", async () => {
    const id = await draftSnag(at.k1Manager, "Raised on Version 1");
    await take(at.k1Manager, id, "raise");
    await publish(raiserHeld);
    expect((await readWorkflow(workflowId)).published!.versionNo).toBe(2);

    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Fixed" } });
    await take(at.k1Manager, id, "close");
    const closed = await detail(at.k1Manager, id);
    expect(closed.workflow.versionNo).toBe(1);
    expect(closed.outcome).toBe("closed");

    // On Version 2 the raiser holds Draft and Verify: C1 raises one on itself and closes it.
    const own = await draftSnag(at.c1Pm, "Raised on Version 2");
    expect((await detail(at.c1Pm, own)).workflow.versionNo).toBe(2);
    await move(at.c1Pm, own, "raise");
    await move(at.c1Pm, own, "resolve", { answers: { resolution_note: "Fixed" } });
    await take(at.c1Pm, own, "close");
    expect((await detail(at.c1Pm, own)).outcome).toBe("closed");
  });

  it("a Send Back into a Step held by the raiser goes to the raiser: C1 sends K1's Snag back to its Draft, and K1 holds it", async () => {
    const askRaiser = {
      key: "ask_raiser",
      label: bilingual("Ask the raiser"),
      kind: "send_back" as const,
      from: "open",
      to: "draft",
      outcome: null,
      permission: "submit" as const,
      actionForm: null,
    };
    await publish({ ...raiserHeld, transitions: [...raiserHeld.transitions, askRaiser] });
    const id = await draftSnag(at.k1Manager, "Which riser?");
    await take(at.k1Manager, id, "raise");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "ask_raiser");
    const back = await detail(at.k1Manager, id);
    expect(back.step.key).toBe("draft");
    expect(back.workflow.versionNo).toBe(3);
    expect(back.actions.transitions.map((t) => t.key)).toContain("raise");
    expect(await offered(at.c1Pm, id)).toEqual([]);
  });
});
