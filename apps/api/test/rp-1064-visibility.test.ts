// Seam 1 for what the Submittal Panel's route strip (RP-1064) and its rail's Step list (RP-1093) draw
// from: the item's Workflow map read, `GET /v1/work-items/:id/workflow`, and its `position` (RP-438;
// visibility.md V14, V20, ADR 0022; scenarios RP-1064-1 and RP-1093-1). The panel makes no read of
// its own: while another Company holds the item, C1 reads that Company's role and name and no Step of
// it, so K1's move from its Engineer to its Manager reaches C1 as nothing; while C1 holds it, C1 reads
// its own Step (the positive control); at the Owner's review, "Owner review". Seam 2:
// packages/db/test/rp-1064-visibility-rls.test.ts.
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemMapPosition, WorkItemWorkflowMap } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, readById, type Caller } from "./support/harness.ts";
import { addInternalConsultantStepsType, INTERNAL_STEPS_TYPE } from "./support/internal-steps-type.ts";
import { addOwnerReviewType } from "./support/owner-review.ts";
import { all, approvedSupplier, bilingual, buildTower, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const CONSULTANT = "Design Consultants LLC";
/** What anyone but the Owner's review's holder and the recommending Consultant reads as its "With" (ADR 0022). */
const OWNER_REVIEW = { en: "Owner review", ar: "مراجعة المالك" };
const OWNER_TYPE = "RPSOW";
const ownerSchema = {
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
};

let at: Tower;
let k1Engineer: Caller; // K1's first Consultant Step.
let owPm: Caller; // Holds the Owner's review.
let supplier = "";
const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";

const map = async (by: Caller, id: string): Promise<WorkItemWorkflowMap> => (await ok(by.get(`/v1/work-items/${id}/workflow`), 200)).json();
/** The Step `by` is shown the item at, as a row for expectHiddenFrom: none unless it is their own Participant's. */
const ownStep = (id: string) => async (by: Caller) =>
  (await readById<WorkItemWorkflowMap>(`/v1/work-items/${id}/workflow`)(by)).flatMap((m) => (m.position?.kind === "own" ? [{ id: m.position.stepKey }] : []));

beforeAll(async () => {
  await addInternalConsultantStepsType(migrator);
  await addOwnerReviewType(migrator, OWNER_TYPE, ownerSchema);
  const c1 = await api.projectCreator();
  const onboard = async (legalName: string): Promise<Company> => {
    const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
    return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  };
  const k1 = await onboard(CONSULTANT);
  const ow = await onboard("Strip Owner Holding");
  at = await buildTower(api, { c1, k1 }, "RSP");
  k1Engineer = await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
  const owParticipant = await api.addParticipant(c1.caller, at.projectId, ow.company, "owner");
  await ok(c1.caller.request("PUT", `/v1/participants/${owParticipant}/visibility`, { trade: all, location: all }));
  owPm = await projectMember(api, ow, owParticipant, ["project_manager"]);
  supplier = await approvedSupplier(c1.caller, at.projectId, at.electrical);
  for (const [by, name] of [[at.c1Pm, "C1 PM"], [at.c1Engineer, "C1 engineer"], [k1Engineer, "K1 engineer"], [at.k1Manager, "K1 manager"], [owPm, "OW PM"]] as const) names.set(by, name);
});

describe("scenarios RP-1064-1 and RP-1093-1: C1 opens its Submitted MAR K1 sends to its Manager", () => {
  let id = "";
  let internal: WorkItemMapPosition | null;
  let atEngineer: WorkItemWorkflowMap;
  let atManager: WorkItemWorkflowMap;

  beforeAll(async () => {
    const res = await at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: INTERNAL_STEPS_TYPE,
      title: "Route strip fixtures",
      answers: { manufacturer: "Thorn", supplier, description: "LED panels", trade: at.electrical, location: at.buildingA },
    });
    expect(res.statusCode, res.body).toBe(201);
    id = res.json().id;
    await attachDatasheet(at.c1Engineer, id);
    await take(at.c1Engineer, id, "send_for_review");
    internal = (await map(at.c1Pm, id)).position;
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit");
    atEngineer = await map(at.c1Pm, id);
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Engineer, id, "send_to_manager");
    atManager = await map(at.c1Pm, id);
  });

  it("names C1's own Step while C1 holds it (the positive control)", () => {
    expect(internal).toEqual({ kind: "own", stepKey: "internal_review" });
  });

  it("marks K1's whole stop as with Design Consultants LLC, naming none of K1's Steps", () => {
    expect(atManager.position).toEqual({ kind: "company", role: "consultant", companyName: bilingual(CONSULTANT) });
    // K1's move from its Engineer to its Manager reaches C1 as nothing.
    expect(atManager).toEqual(atEngineer);
  });

  it("gives K1's current Step to K1 only", async () => {
    await expectHiddenFrom({
      read: ownStep(id),
      target: "consultant_manager",
      seenBy: [at.k1Manager, k1Engineer],
      hiddenFrom: [at.c1Pm, at.c1Engineer, owPm],
      name: named,
      label: "K1's current Step",
    });
  });

  it("lists K1's Steps in the map (V20), as the Step list's rows are drawn from them", () => {
    expect(atManager.definition.steps.map((s) => s.key)).toEqual(expect.arrayContaining(["internal_review", "consultant_engineer", "consultant_manager"]));
  });
});

describe("scenario RP-1064-1: later the item waits at the Owner's review", () => {
  let id = "";

  beforeAll(async () => {
    const answers = { model: "Strip at owner", trade: at.electrical, location: at.buildingA };
    id = (await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: OWNER_TYPE, title: "Strip at owner", answers }), 201)).json().id as string;
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit");
    await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(at.k1Manager, id, "recommend_b", { answers: { items_to_create: [{ comment: "Seal the entries" }] } });
  });

  it("reads to C1 as with Owner review, never as the Owner's Company or its Step", async () => {
    expect((await map(at.c1Pm, id)).position).toEqual({ kind: "company", role: "owner", companyName: OWNER_REVIEW });
    await expectHiddenFrom({ read: ownStep(id), target: "owner_review", seenBy: owPm, hiddenFrom: [at.c1Pm, at.k1Manager], name: named, label: "the Owner's Step" });
  });
});
