// Seam 1 for the Positions the history read gives (RP-1091, spec RP-1054; visibility.md V5, V14, the
// "Work Item history" row; scenarios RP-1091-1 to RP-1091-3): `GET /v1/work-items/:id/history` names
// the reader's own people with their Positions (`by.positions`), another Company's actor with none,
// and the final Code's signer by name with none. Seam 2: packages/db/test/history-positions-rls.test.ts.
import type { WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, draft, memberOnProject, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

const C1_NAME = "Positions Constructions";
const K1_NAME = "Positions Consultants";
const C2_NAME = "Positions Second Contractor";
const SIGNER = "Rana Al-Otaibi";
/** The Rabaed Default Positions, as the read names them. */
const ENGINEER = { en: "Engineer", ar: "مهندس" };
const PROJECT_MANAGER = { en: "Project Manager", ar: "مدير المشروع" };
const MANAGER = { en: "Manager", ar: "مدير" };

let at: Tower;
let signer: Caller;
let c2: Company;
let c2Engineer: Caller;
let id = "";

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

const history = async (by: Caller, item: string): Promise<WorkItemHistory["events"]> => (await ok(by.get(`/v1/work-items/${item}/history`), 200)).json().events;

/** Each event as [type, Company, person, Positions]. */
const who = (events: WorkItemHistory["events"]) => events.map((e) => [e.type, e.by.companyName?.en ?? null, e.by.memberName !== null, e.by.positions]);

beforeAll(async () => {
  const c1 = await onboard(C1_NAME);
  await ok(c1.caller.patch(`/v1/members/${c1.company.authorizedPerson.id}`, { canCreateProjects: true }), 200);
  const k1 = await onboard(K1_NAME);
  at = await buildTower(api, { c1, k1 }, "HPO");
  signer = (await memberOnProject(api, k1, at.k1ParticipantId!, ["manager"], { name: SIGNER })).caller;
  c2 = await onboard(C2_NAME);
  const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  // C2's Engineer is its Project Manager too, so its own review is a pool of one.
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer", "project_manager"]);

  // C1 raises and Submits it; K1's manager picks it up and issues Code A.
  id = await draft(at, at.c1Engineer, "Busbar trunking");
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit");
  await ok(signer.post(`/v1/work-items/${id}/pick-up`));
  await take(signer, id, "approve_a");
});

describe("scenario RP-1091-1: C1 reads the history of its item K1 Coded", () => {
  it("names C1's people with their Position; K1 by its name only, its Code's signer by name with no Position or Step", async () => {
    const events = await history(at.c1Pm, id);
    expect(who(events)).toEqual([
      ["transition", C1_NAME, true, [ENGINEER]],
      // C1's PM is its review's one possible holder (a pool of one).
      ["assigned", C1_NAME, true, [PROJECT_MANAGER]],
      ["transition", C1_NAME, true, [PROJECT_MANAGER]],
      ["issue_code", K1_NAME, true, []],
    ]);
    expect(events.at(-1)).toMatchObject({ by: { memberName: bilingual(SIGNER), positions: [] }, fromStep: null, toStep: null });
    expect(JSON.stringify(events)).not.toContain(`"${MANAGER.en}"`);
  });
});

describe("scenario RP-1091-2: K1 reads the same history", () => {
  it("names K1's people with their Position, and C1's Submit by C1's name only, with no Position or Step", async () => {
    const events = await history(signer, id);
    expect(who(events)).toEqual([
      ["transition", C1_NAME, false, []],
      ["picked_up", K1_NAME, true, [MANAGER]],
      ["issue_code", K1_NAME, true, [MANAGER]],
    ]);
    expect(events[0]).toMatchObject({ fromStep: null, toStep: null });
    expect(JSON.stringify(events)).not.toContain(PROJECT_MANAGER.en);
  });
});

describe("scenario RP-1091-3: a Member of a third Company on the Project", () => {
  it("reads nothing of C1's item's history: the plain 404", async () => {
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/history`));
  });

  it("reads its own item's history, its own people with each of their Positions (the positive control)", async () => {
    const own = await draft(at, c2Engineer, "Cable ladders");
    await take(c2Engineer, own, "send_for_review");
    expect(who(await history(c2Engineer, own))).toEqual([
      ["transition", C2_NAME, true, [ENGINEER, PROJECT_MANAGER]],
      ["assigned", C2_NAME, true, [ENGINEER, PROJECT_MANAGER]],
    ]);
  });
});
