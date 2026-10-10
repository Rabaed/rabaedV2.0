// Seam 1: Step Age follows the grouping (RP-255; visibility.md V14, scenario 35).
// Inside the Company holding the item, Step Age counts from its current internal
// Step. Every other Company counts it from when the item reached that Company, so
// the holder's internal moves never reset or reveal anything.
//
// The seeded MAR has one Consultant Step, so this file uses a test-only Work Item
// Type whose Workflow has two (support/internal-steps-type.ts).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemDetail, WorkItemSummary } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller, type OnboardedCompany } from "./support/harness.ts";
import { addInternalConsultantStepsType, INTERNAL_STEPS_TYPE as TYPE, MANAGER_STEP } from "./support/internal-steps-type.ts";
import { projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

type Company = { company: OnboardedCompany; caller: Caller };
type Coverage = { isAll: boolean; valueIds: string[] };

const DAY = 86_400_000;
const CONSULTANT = "Internal Steps Consultants";
const RETURN_REASON = "Check the cable schedule";

const bilingual = (text: string) => ({ en: text, ar: text });
const all: Coverage = { isAll: true, valueIds: [] };

let projectId = "";
let electrical = "";
let buildingA = "";

let engineer: Caller; // C1 Engineer.
let pm: Caller; // C1 Project Manager: submits.
let k1Engineer: Caller; // K1 Engineer: holds the first Consultant Step.
let k1Manager: Caller; // K1 Manager (the Consultant's PM): holds the second.
let owner: Caller; // Owner, covering the whole Project: oversight.

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

/** Everything a caller learns of the item: its list row, detail and history. */
async function seenBy(by: Caller, id: string) {
  const list = await by.get(`/v1/projects/${projectId}/work-items`);
  const res = await by.get(`/v1/work-items/${id}`);
  const hist = await by.get(`/v1/work-items/${id}/history`);
  for (const r of [list, res, hist]) expect(r.statusCode, r.body).toBe(200);
  return {
    row: list.json().items.find((i: WorkItemSummary) => i.id === id) as WorkItemSummary,
    detail: res.json() as WorkItemDetail,
    history: hist.json().events as unknown[],
    body: [list.body, res.body, hist.body].join("\n"),
  };
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
  const ow = await participant(c1, "owner", "Test Owner");
  owner = await projectMember(api, ow.company, ow.participantId, ["representative"]);
});

describe("K1 moves the Submitted item internally (scenario 35)", () => {
  let id = "";
  let submittedAt = "";
  type Seen = Record<"pm" | "owner", Awaited<ReturnType<typeof seenBy>>>;
  let atSubmit: Seen;
  let withManager: Seen; // While the K1 Manager holds it.

  beforeAll(async () => {
    const res = await engineer.post(`/v1/projects/${projectId}/work-items`, {
      type: TYPE,
      title: "Cable trays",
      answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: electrical, location: buildingA },
    });
    expect(res.statusCode, res.body).toBe(201);
    id = res.json().id;
    await attachDatasheet(engineer, id);
    await ok(tryTake(engineer, id, "send_for_review"));
    await ok(pm.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(pm, id, "submit"));
    atSubmit = { pm: await seenBy(pm, id), owner: await seenBy(owner, id) };
    submittedAt = atSubmit.pm.detail.stepEnteredAt!;

    // Two weeks later the K1 Engineer sends it to the K1 Manager…
    await api.later(15 * DAY);
    await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Engineer, id, "send_to_manager"));
    withManager = { pm: await seenBy(pm, id), owner: await seenBy(owner, id) };
    // …who, a week later, Returns it to the Engineer.
    await api.later(8 * DAY);
    await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Manager, id, "return_to_engineer", { reason: RETURN_REASON }));
  });

  it("shows the C1 PM and the Owner Step Age counted from the Submit: no reset", async () => {
    for (const caller of [pm, owner]) {
      const { row, detail } = await seenBy(caller, id);
      // 23 days after the Submit: its fourth week.
      expect(row).toMatchObject({ stepEnteredAt: submittedAt, stepAgeWeeks: 4 });
      expect(detail).toMatchObject({ stepEnteredAt: submittedAt, stepAgeWeeks: 4 });
    }
  });

  it("shows the C1 PM and the Owner nothing of the internal moves: only the age changed", async () => {
    for (const who of ["pm", "owner"] as const) {
      const caller = who === "pm" ? pm : owner;
      const before = atSubmit[who];
      for (const now of [withManager[who], await seenBy(caller, id)]) {
        expect({ ...now.detail, stepAgeWeeks: 1 }).toEqual({ ...before.detail, stepAgeWeeks: 1 });
        expect({ ...now.row, stepAgeWeeks: 1 }).toEqual({ ...before.row, stepAgeWeeks: 1 });
        expect(now.history).toEqual(before.history);
        for (const secret of [MANAGER_STEP, RETURN_REASON, "Send to Manager"]) expect(now.body).not.toContain(secret);
      }
    }
  });

  it("shows K1's own Members Step Age counted from the current internal Step", async () => {
    for (const caller of [k1Engineer, k1Manager]) {
      const { row, detail } = await seenBy(caller, id);
      expect(row.stepAgeWeeks).toBe(1);
      expect(detail).toMatchObject({ step: { key: "consultant_engineer" }, stage: { key: "pending_approval" }, stepAgeWeeks: 1 });
      expect(Date.parse(detail.stepEnteredAt!)).toBeGreaterThan(Date.parse(submittedAt) + 22 * DAY);
    }
  });

  it("keeps K1's own history of the internal moves", async () => {
    const { history } = await seenBy(k1Engineer, id);
    expect(JSON.stringify(history)).toContain(RETURN_REASON);
  });

  it("counts again from the Code for everyone once K1 closes the item", async () => {
    await ok(tryTake(k1Engineer, id, "send_to_manager"));
    await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Manager, id, "approve_a"));
    for (const caller of [pm, owner, k1Engineer, k1Manager]) {
      const { detail } = await seenBy(caller, id);
      expect(detail).toMatchObject({ outcome: "A", stepAgeWeeks: 1 });
      expect(Date.parse(detail.stepEnteredAt!)).toBeGreaterThan(Date.parse(submittedAt) + 22 * DAY);
    }
  });
});
