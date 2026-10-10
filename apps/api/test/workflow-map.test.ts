// Seam 1: a Work Item's Workflow map (RP-438, WF-15; visibility.md V14, V20, scenario
// RP-438-1). Everyone who sees the item reads the Workflow Version it is pinned to,
// whole. Where the item is on it follows V14: inside the viewer's own Participant, its
// current Step; with another Participant, only that Participant's role and Company
// name, never which of its internal Steps holds the item, so its internal moves change
// nothing another Company reads.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemDetail, WorkItemWorkflowMap } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller, type OnboardedCompany } from "./support/harness.ts";
import { addInternalConsultantStepsType, INTERNAL_STEPS_TYPE } from "./support/internal-steps-type.ts";
import { projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

type Company = { company: OnboardedCompany; caller: Caller };

const CONSULTANT = "Design Consultants LLC";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

let projectId = "";
let electrical = "";
let buildingA = "";
let engineer: Caller; // C1 Engineer.
let pm: Caller; // C1 Project Manager: submits.
let k1Engineer: Caller; // K1 Engineer: the first Consultant Step.
let k1Manager: Caller; // K1 Manager: the second.
let owner: Caller; // Owner, covering the whole Project.
let stranger: Caller; // A Company on no Project of these.

async function ok(res: Promise<{ statusCode: number; body: string }>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
}

async function participant(c1: Company, role: "consultant" | "owner", legalName: string) {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  const company = { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  const participantId = await api.addParticipant(c1.caller, projectId, onboarded, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return { company, participantId };
}

async function map(by: Caller, id: string): Promise<WorkItemWorkflowMap> {
  const res = await by.get(`/v1/work-items/${id}/workflow`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

beforeAll(async () => {
  await addInternalConsultantStepsType(migrator);
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });

  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, c1ParticipantId, ["engineer"]);
  pm = await projectMember(api, c1, c1ParticipantId, ["project_manager"]);

  const k1 = await participant(c1, "consultant", CONSULTANT);
  k1Engineer = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  k1Manager = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const ow = await participant(c1, "owner", "Map Test Owner");
  owner = await projectMember(api, ow.company, ow.participantId, ["representative"]);
  const other = await api.onboardCompany({ legalName: bilingual("Unrelated Contracting") });
  stranger = await api.acceptInvitation(other.invitationToken);
});

describe("the map of an item moving through C1 and K1", () => {
  let id = "";
  let detail: WorkItemDetail;
  let inInternalReview: WorkItemWorkflowMap;
  let atK1Engineer: Record<"pm" | "owner", WorkItemWorkflowMap>;
  let atK1Manager: Record<"pm" | "owner" | "k1Engineer" | "k1Manager", WorkItemWorkflowMap>;
  let closed: Record<"pm" | "k1Manager", WorkItemWorkflowMap>;

  beforeAll(async () => {
    const res = await engineer.post(`/v1/projects/${projectId}/work-items`, {
      type: INTERNAL_STEPS_TYPE,
      title: "Lighting fixtures",
      answers: { manufacturer: "Thorn", description: "LED panels", trade: electrical, location: buildingA },
    });
    expect(res.statusCode, res.body).toBe(201);
    id = res.json().id;
    await attachDatasheet(engineer, id);
    await ok(tryTake(engineer, id, "send_for_review"));
    inInternalReview = await map(pm, id);
    await ok(pm.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(pm, id, "submit"));
    atK1Engineer = { pm: await map(pm, id), owner: await map(owner, id) };
    await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Engineer, id, "send_to_manager"));
    atK1Manager = { pm: await map(pm, id), owner: await map(owner, id), k1Engineer: await map(k1Engineer, id), k1Manager: await map(k1Manager, id) };
    detail = (await pm.get(`/v1/work-items/${id}`)).json();
    await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Manager, id, "approve_a"));
    closed = { pm: await map(pm, id), k1Manager: await map(k1Manager, id) };
  });

  it("gives the Version the item is pinned to, whole, the same to every Participant (V20)", () => {
    const m = atK1Manager.pm;
    expect({ name: m.name, versionNo: m.versionNo }).toEqual(detail.workflow);
    expect(m.latestVersionNo).toBe(m.versionNo);
    expect(m.definition.steps.map((s) => s.key).toSorted()).toEqual(["approved", "consultant_engineer", "consultant_manager", "draft", "internal_review"]);
    expect(m.definition.transitions.map((t) => t.key)).toContain("return_to_engineer");
    for (const other of [atK1Manager.owner, atK1Manager.k1Manager]) expect(other.definition).toEqual(m.definition);
    expect(m.stages.map((s) => s.key)).toEqual(expect.arrayContaining(["draft", "internal_review", "pending_approval", "approved"]));
  });

  it("names each viewer's own Participant role", () => {
    expect(atK1Manager.pm.viewerRole).toBe("contractor");
    expect(atK1Manager.k1Manager.viewerRole).toBe("consultant");
    expect(atK1Manager.owner.viewerRole).toBe("owner");
  });

  it("shows C1 its own current Step while C1 holds the item", () => {
    expect(inInternalReview.position).toEqual({ kind: "own", stepKey: "internal_review" });
  });

  it("shows K1's Members the Step K1 holds it at", () => {
    expect(atK1Manager.k1Engineer.position).toEqual({ kind: "own", stepKey: "consultant_manager" });
    expect(atK1Manager.k1Manager.position).toEqual({ kind: "own", stepKey: "consultant_manager" });
  });

  // Scenario RP-438-1.
  it("shows a Contractor an item at the Consultant's Manager Step as with Design Consultants LLC, not which internal Step", () => {
    expect(atK1Manager.pm.position).toEqual({ kind: "company", role: "consultant", companyName: bilingual(CONSULTANT) });
    expect(atK1Manager.owner.position).toEqual(atK1Manager.pm.position);
    // K1's move from its Engineer to its Manager changes nothing C1 or the Owner read.
    expect(atK1Manager.pm).toEqual(atK1Engineer.pm);
    expect(atK1Manager.owner).toEqual(atK1Engineer.owner);
  });

  it("shows everyone the terminal Step a closed item reached", () => {
    expect(closed.pm.position).toEqual({ kind: "closed", stepKey: "approved" });
    expect(closed.k1Manager.position).toEqual({ kind: "closed", stepKey: "approved" });
  });

  it("answers anyone who doesn't see the item, and a made-up id, with the plain 404", async () => {
    for (const path of [`/v1/work-items/${id}/workflow`, `/v1/work-items/${crypto.randomUUID()}/workflow`, "/v1/work-items/nope/workflow"]) {
      const res = await stranger.get(path);
      expect(res.statusCode, res.body).toBe(404);
    }
  });
});
