// Seam 1: a Contractor creates a Draft MAR that only their own Company sees
// (RP-192; visibility.md V1, V3, V4 and scenarios 1, 5, 8, 9 of the spec).
// Lists, Stage counts and direct links all answer from the same visible items.
import { randomUUID } from "node:crypto";
import type { WorkItemDetail, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, DEFAULT_PASSWORD, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

const DAY = 86_400_000;
type Company = { company: OnboardedCompany; caller: Caller };

let c1: Company; // Contractor (Electrical); its Authorized Person created the Project.
let c1Engineer: Caller;
let c1EngineerEmail = "";
let c1Narrow: Caller; // A C1 engineer who covers Building B only.
let c1Outsider: Caller; // A C1 Member who is not on the Project.
let c2Engineer: Caller; // Second Contractor, Electrical too (V3).
let k1Engineer: Caller; // Consultant.
let orEngineer: Caller; // Owner Representative.
let projectId = "";
const trade = { electrical: "", mechanical: "" };
const loc = { tower1: "", buildingA: "", buildingB: "" };

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };
const only = (...valueIds: string[]) => ({ isAll: false, valueIds });

async function created(res: Promise<{ statusCode: number; body: string; json(): { id: string } }>) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id;
}

async function ok(res: Promise<{ statusCode: number; body: string }>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
}

/**
 * `company` on the Project in `role` (C1 is already on it), covering Electrical
 * everywhere, with a signed-in engineer covering all of it.
 */
async function participantWithEngineer(company: Company, role: "contractor" | "consultant" | "owner_representative") {
  const participantId =
    company === c1
      ? (await c1.caller.get(`/v1/projects/${projectId}/participants`))
          .json()
          .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id
      : await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: only(trade.electrical), location: all }));
  const { member, caller } = await api.member(company.caller);
  await api.addProjectMember(company.caller, participantId, member.id);
  await ok(
    company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/visibility`, {
      trade: all,
      location: all,
    }),
  );
  return { participantId, email: member.email, caller };
}

/** A Draft MAR; `answers` replace the defaults key by key (Trade and Location are answers too). */
const createDraft = (by: Caller, { answers, ...body }: Record<string, unknown> & { answers?: Record<string, unknown> } = {}) =>
  by.post(`/v1/projects/${projectId}/work-items`, {
    type: "MAR",
    title: "Cable trays",
    answers: {
      manufacturer: "ACME Cables",
      description: "Galvanised, 300 mm",
      trade: trade.electrical,
      location: loc.buildingA,
      ...answers,
    },
    ...body,
  });

const list = async (by: Caller): Promise<WorkItemList> => {
  const res = await by.get(`/v1/projects/${projectId}/work-items`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

const counts = (l: WorkItemList) => Object.fromEntries(l.stages.map((s) => [s.key, s.count]));

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  trade.electrical = await created(c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") }));
  trade.mechanical = await created(c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "ME", name: bilingual("Mechanical") }));
  loc.tower1 = await created(c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "T1", name: bilingual("Tower 1") }));
  loc.buildingA = await created(
    c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: loc.tower1 }),
  );
  loc.buildingB = await created(
    c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: loc.tower1 }),
  );

  const own = await participantWithEngineer(c1, "contractor");
  c1Engineer = own.caller;
  c1EngineerEmail = own.email;
  const narrow = await api.member(c1.caller);
  await api.addProjectMember(c1.caller, own.participantId, narrow.member.id);
  await ok(
    c1.caller.request("PUT", `/v1/participants/${own.participantId}/members/${narrow.member.id}/visibility`, {
      trade: all,
      location: only(loc.buildingB),
    }),
  );
  c1Narrow = narrow.caller;
  c1Outsider = (await api.member(c1.caller)).caller;
  c2Engineer = (await participantWithEngineer(await api.authorizedPerson(), "contractor")).caller;
  k1Engineer = (await participantWithEngineer(await api.authorizedPerson(), "consultant")).caller;
  orEngineer = (await participantWithEngineer(await api.authorizedPerson(), "owner_representative")).caller;
});

describe("a Contractor engineer's Draft MAR", () => {
  let draftId = "";

  beforeAll(async () => {
    draftId = await created(createDraft(c1Engineer));
  });

  it("is listed to them under Drafts, with the Stage counts", async () => {
    const l = await list(c1Engineer);
    expect(l.items.map((i) => i.id)).toEqual([draftId]);
    expect(l.items[0]).toMatchObject({
      type: { code: "MAR" },
      title: "Cable trays",
      documentNumber: null,
      stage: { key: "draft", name: { en: "Drafts" }, category: "draft" },
      trade: { id: trade.electrical, code: "EL" },
      location: { id: loc.buildingA, code: "BA" },
      // A Draft with no number: its Step began when it was started, which nobody sees.
      stepEnteredAt: null,
      stepAgeWeeks: null,
    });
    expect(counts(l)).toEqual({ draft: 1, internal_review: 0, pending_approval: 0, approved: 0, revise_resubmit: 0, cancelled: 0 });
  });

  it("opens for them, held by its creator, with Step Age in weeks", async () => {
    const res = await c1Engineer.get(`/v1/work-items/${draftId}`);
    expect(res.statusCode, res.body).toBe(200);
    const detail: WorkItemDetail = res.json();
    expect(detail).toMatchObject({
      id: draftId,
      title: "Cable trays",
      answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: trade.electrical, location: loc.buildingA },
      scopes: [],
      stage: { key: "draft" },
      step: { key: "draft", name: { en: "Draft" } },
      trade: { code: "EL", name: bilingual("Electrical") },
      location: { code: "BA" },
      raisedBy: { companyName: { en: "Test Constructions" } },
      heldBy: { companyName: { en: "Test Constructions" }, memberName: { en: "Test Member" } },
      // A Draft with no number: its Step began when it was started, which nobody sees.
      stepEnteredAt: null,
      stepAgeWeeks: null,
    });
  });

  it("is not seen by their Company's Project Admin until their own Visibility covers it", async () => {
    // c1's Authorized Person has no Member Visibility of their own yet: nothing is covered until granted.
    expect((await list(c1.caller)).items).toEqual([]);
  });

  it("is not seen by the second Contractor on the same Trade: not listed, not counted, 404 (V3)", async () => {
    const l = await list(c2Engineer);
    expect(l.items).toEqual([]);
    expect(Object.values(counts(l)).every((n) => n === 0)).toBe(true);
    const res = await c2Engineer.get(`/v1/work-items/${draftId}`);
    await expectHidden(res);
  });

  it("is not seen by the Consultant or the Owner Representative (V1)", async () => {
    for (const caller of [k1Engineer, orEngineer]) {
      const l = await list(caller);
      expect(l.items).toEqual([]);
      expect(Object.values(counts(l)).every((n) => n === 0)).toBe(true);
      await expectHidden(caller.get(`/v1/work-items/${draftId}`));
    }
  });

  it("is not seen by a Member of their own Company whose Visibility excludes its Location (V4)", async () => {
    const l = await list(c1Narrow);
    expect(l.items).toEqual([]);
    expect(counts(l).draft).toBe(0);
    await expectHidden(c1Narrow.get(`/v1/work-items/${draftId}`));
  });

  it("is not found by a Member who is not on the Project, nor is the Project's list", async () => {
    await expectHidden(c1Outsider.get(`/v1/work-items/${draftId}`));
    await expectHidden(c1Outsider.get(`/v1/projects/${projectId}/work-items`));
  });
});

describe("creating a Draft", () => {
  it("is refused to a Participant whose role doesn't raise MARs", async () => {
    expect((await createDraft(k1Engineer)).statusCode).toBe(403);
  });

  it("stays within the creator's Visibility", async () => {
    const res = await createDraft(c1Engineer, { answers: { trade: trade.mechanical } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "outside_visibility" });
    expect((await createDraft(c1Narrow)).json()).toEqual({ error: "outside_visibility" });
  });

  it("needs a Subject, and a Trade of the Project even in a Draft", async () => {
    expect((await createDraft(c1Engineer, { title: "  " })).statusCode).toBe(400);
    const noTrade = await createDraft(c1Engineer, { answers: { trade: undefined } });
    expect(noTrade.statusCode).toBe(422);
    expect(noTrade.json()).toEqual({ error: "invalid_answers", fields: [{ key: "trade", code: "required" }] });
    expect((await createDraft(c1Engineer, { answers: { trade: loc.buildingA } })).json()).toEqual({ error: "value_not_found" });
  });

  it("allows a Draft without a Location", async () => {
    const id = await created(createDraft(c1Engineer, { title: "Conduits", answers: { location: undefined } }));
    expect((await c1Engineer.get(`/v1/work-items/${id}`)).json().location).toBeNull();
    // Without a Location, only the Trade decides: the narrow engineer sees this one.
    expect((await list(c1Narrow)).items.map((i) => i.id)).toEqual([id]);
  });

  it("is not found on a Project the Member is not on, or of an unknown Type", async () => {
    await expectHidden(createDraft(c1Outsider));
    expect((await createDraft(c1Engineer, { type: "XYZ" })).json()).toEqual({ error: "type_not_found" });
  });
});

describe("a Work Item link", () => {
  it("that isn't a UUID, or doesn't exist, is 404", async () => {
    await expectHidden(c1Engineer.get("/v1/work-items/not-an-id"));
    await expectHidden(c1Engineer.get(`/v1/work-items/${randomUUID()}`));
  });

  it("needs a session", async () => {
    expect((await api.anonymous().get(`/v1/projects/${projectId}/work-items`)).statusCode).toBe(401);
  });
});

// Last: moving the clock a week on ends every session, so this signs in again.
describe("Step Age", () => {
  it("counts one more week each week at the Step, and never shows a due date", async () => {
    const id = await created(createDraft(c1Engineer, { title: "Lighting fixtures" }));
    api.advanceClock(8 * DAY);
    const again = await api.signIn(c1EngineerEmail, DEFAULT_PASSWORD);
    const detail = (await again.get(`/v1/work-items/${id}`)).json();
    expect(detail.stepAgeWeeks).toBeNull();
    expect((await list(again)).items.find((i) => i.id === id)).toMatchObject({ stepEnteredAt: null, stepAgeWeeks: null });
    expect(JSON.stringify(detail)).not.toMatch(/due|overdue|deadline/i);
  });
});

