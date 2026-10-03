// Seam 1: Submit to the Consultant, and Code A or C closes the item (RP-194;
// workflow-engine.md §3, §5.1; visibility.md V2, V3, V5, V14; spec scenarios 3–6).
// The Contractor PM submits; the Consultant's managers pool holds it, the Owner
// Representative sees it as oversight when their Visibility covers it, and a
// Consultant manager issues the Code. Nobody sees the other side's internal work.
import { randomUUID } from "node:crypto";
import type { WorkItemDetail, WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, DEFAULT_PASSWORD, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

type Company = { company: OnboardedCompany; caller: Caller };
type Coverage = { isAll: boolean; valueIds: string[] };

const bilingual = (text: string) => ({ en: text, ar: text });
const all: Coverage = { isAll: true, valueIds: [] };
const only = (...valueIds: string[]): Coverage => ({ isAll: false, valueIds });

const CONSULTANT = "Design Consultants LLC";
const SIGNER = "Khalid Signer";
const OTHER_MANAGER = "Sara Reviewer";

let c1: Company; // Contractor; its Authorized Person created the Project.
let k1: Company; // Consultant: the only one, covering the whole Project.
let k1ParticipantId = "";
let projectId = "";
let electrical = "";
let mechanical = "";
let buildingA = "";
let buildingB = "";

let engineer: Caller; // C1 Engineer.
let pm: Caller; // C1 Project Manager.
let signer: Caller; // K1 Managers: the Consultant review pool.
let otherManager: Caller;
let mechanicalManager: Caller; // K1 Manager covering Mechanical only (scenario 4).
let k1Engineer: Caller; // K1 Engineer: sees it, but can't issue a Code.
let c2Engineer: Caller; // Second Contractor, Electrical too (V3).
let orEngineer: Caller; // Owner Representative covering Electrical everywhere (oversight).
let orElsewhere: Caller; // Owner Representative covering Building B only.
let orMechanical: Caller; // Owner Representative covering Mechanical only.
let owner: Caller; // Owner, covering the whole Project (oversight).

/** Each Member's email, to sign them in again once the clock has moved past their session. */
const emails = new Map<Caller, string>();

async function ok(res: Promise<{ statusCode: number; body: string }>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
}

/** A signed-in Member of `company` named `name`, on the Project through `participantId`, with `positions`. */
async function projectMember(
  company: Company,
  participantId: string,
  positions: string[],
  { name = "Test Member", trade = all }: { name?: string; trade?: Coverage } = {},
) {
  const member = await api.inviteMember(company.caller, { fullName: bilingual(name) });
  const caller = await api.acceptInvitation(member.invitationToken);
  emails.set(caller, member.email);
  await api.addProjectMember(company.caller, participantId, member.id);
  await ok(
    company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/visibility`, {
      trade,
      location: all,
    }),
  );
  if (positions.length) {
    await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/positions`, { positions }));
  }
  return caller;
}

/** Another Company on the Project in `role`, with the Participant Visibility the Project Admin gives it. */
async function participant(
  role: "contractor" | "consultant" | "owner" | "owner_representative",
  coverage: { trade: Coverage; location: Coverage } = { trade: all, location: all },
  legalName = "Test Constructions",
) {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  const company = { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  const participantId = await api.addParticipant(c1.caller, projectId, onboarded, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, coverage));
  return { company, participantId };
}

async function createDraft(by: Caller, title: string): Promise<string> {
  const res = await by.post(`/v1/projects/${projectId}/work-items`, {
    type: "MAR",
    title,
    tradeId: electrical,
    locationId: buildingA,
    answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

const take = (by: Caller, id: string, transition: string, extra: { reason?: string; internalNote?: string } = {}) =>
  by.post(`/v1/work-items/${id}/transitions`, { transition, idempotencyKey: randomUUID(), ...extra });

async function detail(by: Caller, id: string): Promise<WorkItemDetail> {
  const res = await by.get(`/v1/work-items/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

async function history(by: Caller, id: string): Promise<WorkItemHistory["events"]> {
  const res = await by.get(`/v1/work-items/${id}/history`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().events;
}

const buttons = (d: WorkItemDetail) => [
  ...(d.actions.claim ? ["claim"] : []),
  ...(d.actions.release ? ["release"] : []),
  ...d.actions.transitions.map((t) => t.key),
];

async function listed(by: Caller) {
  const list = (await by.get(`/v1/projects/${projectId}/work-items`)).json();
  const counts = Object.fromEntries(list.stages.map((s: { key: string; count: number }) => [s.key, s.count]));
  return { ids: list.items.map((i: { id: string }) => i.id) as string[], counts };
}

/** Everything a caller can learn of the item: list, counts, detail, history and notifications, as one body. */
async function everything(by: Caller, id: string) {
  const parts = await Promise.all([
    by.get(`/v1/projects/${projectId}/work-items`),
    by.get(`/v1/work-items/${id}`),
    by.get(`/v1/work-items/${id}/history`),
    by.get("/v1/notifications"),
  ]);
  return parts.map((r) => r.body).join("\n");
}

/** A Draft, sent, Returned once with a reason, sent again and claimed by the PM: ready to Submit. */
async function readyToSubmit(title: string) {
  const id = await createDraft(engineer, title);
  await ok(take(engineer, id, "send_for_review"));
  await ok(pm.post(`/v1/work-items/${id}/claim`));
  await ok(take(pm, id, "return", { reason: "Wrong tray size" }));
  await ok(take(engineer, id, "send_for_review"));
  await ok(pm.post(`/v1/work-items/${id}/claim`));
  return id;
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  const tower = await post("locations", { code: "T1", name: bilingual("Tower 1"), parentId: null });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: tower });
  buildingB = await post("locations", { code: "BB", name: bilingual("Building B"), parentId: tower });

  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(c1, c1ParticipantId, ["engineer"]);
  pm = await projectMember(c1, c1ParticipantId, ["project_manager"]);

  const consultant = await participant("consultant", { trade: all, location: all }, CONSULTANT);
  k1 = consultant.company;
  k1ParticipantId = consultant.participantId;
  signer = await projectMember(k1, consultant.participantId, ["manager"], { name: SIGNER });
  otherManager = await projectMember(k1, consultant.participantId, ["manager"], { name: OTHER_MANAGER });
  mechanicalManager = await projectMember(k1, consultant.participantId, ["manager"], { trade: only(mechanical) });
  k1Engineer = await projectMember(k1, consultant.participantId, ["engineer"]);

  const c2 = await participant("contractor");
  c2Engineer = await projectMember(c2.company, c2.participantId, ["engineer"]);
  const or = await participant("owner_representative", { trade: only(electrical), location: all });
  orEngineer = await projectMember(or.company, or.participantId, ["engineer"]);
  const orB = await participant("owner_representative", { trade: all, location: only(buildingB) });
  orElsewhere = await projectMember(orB.company, orB.participantId, ["engineer"]);
  const orM = await participant("owner_representative", { trade: only(mechanical), location: all });
  orMechanical = await projectMember(orM.company, orM.participantId, ["engineer"]);
  const ow = await participant("owner");
  owner = await projectMember(ow.company, ow.participantId, ["representative"]);
});

describe("Submit", () => {
  let id = "";
  beforeAll(async () => {
    id = await readyToSubmit("Cable trays");
  });

  it("is offered to the PM holding Internal Review, beside Return", async () => {
    const d = await detail(pm, id);
    expect(buttons(d)).toEqual(["release", "return", "submit"]);
    expect(d.actions.transitions.find((t) => t.key === "submit")).toMatchObject({
      label: { en: "Submit" },
      kind: "submit",
      needsReason: false,
    });
  });

  it("moves the item to Pending Approval, with the Consultant's pool", async () => {
    await ok(take(pm, id, "submit"));
    const d = await detail(pm, id);
    expect(d).toMatchObject({
      stage: { key: "pending_approval" },
      step: { key: "consultant_review" },
      outcome: null,
      closedAt: null,
      stepAgeWeeks: 1,
    });
    // "With Design Consultants LLC", never a Consultant person (V14).
    expect(d.heldBy).toEqual({ companyName: bilingual(CONSULTANT), memberName: null });
    expect(buttons(d)).toEqual([]);
    // Named on the item, yet never listed among the Contractor's Participants (V15).
    const participants = await pm.get(`/v1/projects/${projectId}/participants`);
    expect(participants.statusCode).toBe(200);
    expect(participants.body).not.toContain(CONSULTANT);
  });

  it("shows the item to the Consultant's Members whose Visibility covers it: list, counts and detail (V2, scenario 3)", async () => {
    for (const caller of [signer, otherManager, k1Engineer]) {
      const { ids, counts } = await listed(caller);
      expect(ids).toEqual([id]);
      expect(counts).toMatchObject({ draft: 0, internal_review: 0, pending_approval: 1 });
      expect((await detail(caller, id)).documentNumber).toMatch(/^TWR-MAR-01-\d{4}$/);
    }
    expect(buttons(await detail(signer, id))).toEqual(["claim"]);
    // An Engineer can't issue a Code, so isn't in the pool.
    expect(buttons(await detail(k1Engineer, id))).toEqual([]);
  });

  it("hides it from a Consultant Member whose Visibility doesn't cover its Trade (scenario 4)", async () => {
    expect(await listed(mechanicalManager)).toMatchObject({ ids: [], counts: { pending_approval: 0 } });
    await expectHidden(mechanicalManager.get(`/v1/work-items/${id}`));
    await expectHidden(mechanicalManager.post(`/v1/work-items/${id}/claim`));
  });

  it("shows it as oversight to the Owner and the Owner Representative whose Visibility covers it, with no actions (V2, scenario 6)", async () => {
    for (const caller of [orEngineer, owner]) {
      expect((await listed(caller)).ids).toEqual([id]);
      const d = await detail(caller, id);
      expect(buttons(d)).toEqual([]);
      expect(d.heldBy?.memberName).toBeNull();
    }
  });

  it("hides it from an Owner Representative whose Visibility doesn't cover its Location, or its Trade: 404", async () => {
    for (const caller of [orElsewhere, orMechanical]) {
      expect(await listed(caller)).toMatchObject({ ids: [], counts: { pending_approval: 0 } });
      await expectHidden(caller.get(`/v1/work-items/${id}`));
      await expectHidden(caller.get(`/v1/work-items/${id}/history`));
    }
  });

  it("still shows the second Contractor nothing: list, counts, detail, history (V3, scenario 5)", async () => {
    expect(await listed(c2Engineer)).toMatchObject({ ids: [], counts: { pending_approval: 0 } });
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}`));
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/history`));
    await expectHidden(take(c2Engineer, id, "approve_a"));
  });

  it("shows the Consultant the Submit, never the Contractor's Return or internal moves (V5)", async () => {
    const events = await history(signer, id);
    expect(events.map((e) => [e.type, e.transition?.en ?? null, e.audience])).toEqual([["transition", "Submit", "shared"]]);
    expect(events[0]).toMatchObject({
      by: { companyName: { en: "Test Constructions" }, memberName: null },
      fromStep: { en: "Contractor review" },
      toStep: { en: "Consultant review" },
      reason: null,
      outcome: null,
    });
    expect(await everything(signer, id)).not.toContain("Wrong tray size");
  });

  it("keeps the Contractor's own history whole, with the Submit shared", async () => {
    const events = await history(engineer, id);
    expect(events.at(-1)).toMatchObject({ type: "transition", transition: { en: "Submit" }, audience: "shared" });
    expect(events.some((e) => e.reason === "Wrong tray size")).toBe(true);
  });

  it("is refused to a PM holding nothing, and to the Contractor once the item left it", async () => {
    expect((await take(pm, id, "submit")).json()).toEqual({ error: "not_holder" });
  });
});

describe("Approve · A", () => {
  let id = "";
  beforeAll(async () => {
    id = await readyToSubmit("Lighting fixtures");
    await ok(take(pm, id, "submit"));
  });

  it("goes to the Consultant manager who claims it; the Contractor still sees only the Company", async () => {
    await ok(signer.post(`/v1/work-items/${id}/claim`));
    const mine = await detail(signer, id);
    expect(mine.heldBy).toEqual({ companyName: bilingual(CONSULTANT), memberName: bilingual(SIGNER) });
    expect(buttons(mine)).toEqual(["release", "approve_a", "revise_c"]);
    expect(buttons(await detail(otherManager, id))).toEqual([]);

    expect((await detail(pm, id)).heldBy).toEqual({ companyName: bilingual(CONSULTANT), memberName: null });
    expect(await everything(pm, id)).not.toContain(SIGNER);
  });

  it("is refused to a Consultant Member who doesn't hold the Step", async () => {
    expect((await take(otherManager, id, "approve_a")).json()).toEqual({ error: "not_holder" });
  });

  it("closes the item Approved with Code A", async () => {
    await ok(take(signer, id, "approve_a"));
    for (const caller of [engineer, pm, signer, otherManager, orEngineer]) {
      const d = await detail(caller, id);
      expect(d).toMatchObject({ stage: { key: "approved", category: "closed_positive" }, outcome: "A", heldBy: null });
      expect(d.closedAt).not.toBeNull();
      expect(buttons(d)).toEqual([]);
    }
  });

  it("shows the Contractor the Code and its signer, never another Consultant person (V5, V14)", async () => {
    const events = await history(pm, id);
    expect(events.at(-1)).toMatchObject({
      type: "issue_code",
      audience: "shared",
      transition: { en: "Approve · A" },
      outcome: "A",
      by: { companyName: bilingual(CONSULTANT), memberName: bilingual(SIGNER) },
    });
    // The Consultant's Claim is theirs alone.
    expect(events.filter((e) => e.by.companyName?.en === CONSULTANT)).toHaveLength(1);
    expect(await everything(pm, id)).not.toContain(OTHER_MANAGER);
  });

  it("shows the Consultant only the Submit and the Code of the Contractor's side, beside its own Claim", async () => {
    const events = await history(signer, id);
    expect(events.map((e) => [e.type, e.by.companyName?.en])).toEqual([
      ["transition", "Test Constructions"],
      ["claimed", CONSULTANT],
      ["issue_code", CONSULTANT],
    ]);
  });

  it("accepts no more Transitions, Claims or Releases once closed", async () => {
    for (const [caller, key] of [
      [signer, "approve_a"],
      [signer, "revise_c"],
      [pm, "submit"],
    ] as const) {
      const res = await take(caller, id, key);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toEqual({ error: "item_closed" });
    }
    expect((await otherManager.post(`/v1/work-items/${id}/claim`)).json()).toEqual({ error: "item_closed" });
    expect((await signer.post(`/v1/work-items/${id}/release`)).json()).toEqual({ error: "item_closed" });
  });

  it("is counted under Approved for everyone who sees it, and for nobody else", async () => {
    expect((await listed(signer)).counts).toMatchObject({ approved: 1, pending_approval: 1 });
    expect((await listed(orEngineer)).counts).toMatchObject({ approved: 1 });
    expect((await listed(c2Engineer)).counts).toMatchObject({ approved: 0 });
    expect((await listed(orElsewhere)).counts).toMatchObject({ approved: 0 });
  });
});

describe("Revise & Resubmit · C", () => {
  let id = "";
  beforeAll(async () => {
    id = await readyToSubmit("Busbars");
    await ok(take(pm, id, "submit"));
  });

  it("closes the item Revise & Resubmit with Code C", async () => {
    await ok(otherManager.post(`/v1/work-items/${id}/claim`));
    await ok(take(otherManager, id, "revise_c"));
    const d = await detail(engineer, id);
    expect(d).toMatchObject({ stage: { key: "revise_resubmit", category: "closed_negative" }, outcome: "C", heldBy: null });
    expect((await history(engineer, id)).at(-1)).toMatchObject({
      type: "issue_code",
      outcome: "C",
      by: { memberName: bilingual(OTHER_MANAGER) },
    });
    expect(await everything(engineer, id)).not.toContain(SIGNER);
  });
});

// Scenario 37: whether no Consultant covers the item, two do, or the one that does has
// nobody who can issue its Code (transitions.test.ts), the PM gets one answer (V14, V16).
describe("Submit with no single Consultant to take it (scenario 37)", () => {
  const SECOND_CONSULTANT = "Second Consultants";
  /** The one answer, byte for byte, whichever case it is. */
  const ANSWER = JSON.stringify({ error: "next_step_unavailable" });
  const NEVER_IN_REFUSAL = [CONSULTANT, SECOND_CONSULTANT, "Electrical", "Building A", "Mechanical"];

  /** Submit isn't offered, and taking it gets the one answer, naming nobody and nothing. */
  async function expectRefused(id: string) {
    expect(buttons(await detail(pm, id))).toEqual(["release", "return"]);
    const res = await take(pm, id, "submit");
    expect(res.statusCode).toBe(409);
    expect(res.body).toBe(ANSWER);
    for (const name of NEVER_IN_REFUSAL) expect(res.body).not.toContain(name);
    expect((await detail(pm, id)).stage.key).toBe("internal_review");
  }

  it("is not offered, and refused without saying why, when no Consultant covers the item (a Visibility Gap)", async () => {
    const setK1Trade = async (trade: Coverage) =>
      ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade, location: all }));
    await setK1Trade(only(mechanical));
    try {
      const id = await readyToSubmit("Cable glands");
      await expectRefused(id);
      // Give the Consultant Electrical again: Submit comes back.
      await setK1Trade(all);
      expect(buttons(await detail(pm, id))).toEqual(["release", "return", "submit"]);
    } finally {
      // K1 is every other test's Consultant.
      await setK1Trade(all);
    }
  });

  it("is not offered, and refused with the same answer, when two Consultants cover the item (a Visibility Overlap)", async () => {
    const k2 = await participant("consultant", { trade: only(electrical), location: all }, SECOND_CONSULTANT);
    await projectMember(k2.company, k2.participantId, ["manager"]);
    const id = await readyToSubmit("Switchgear");
    await expectRefused(id);
    // Narrow the second Consultant away: Submit comes back.
    await ok(c1.caller.request("PUT", `/v1/participants/${k2.participantId}/visibility`, { trade: only(mechanical), location: all }));
    expect(buttons(await detail(pm, id))).toEqual(["release", "return", "submit"]);
  });
});

describe("Internal Note (V5, scenarios 7 and 34)", () => {
  const SENT = "Checked against the approved catalogue";
  const RETURNED = "Supplier letter is missing";
  const SUBMITTED = "Price is 8% over budget, don't mention it";
  const CODED = "Approving, but watch their next batch";
  let id = "";

  /** The Internal Notes a caller sees in the item's history, each with the Transition it was written with. */
  const notes = async (by: Caller) =>
    (await history(by, id)).filter((e) => e.type === "internal_note").map((e) => [e.transition?.en, e.internalNote, e.audience]);

  beforeAll(async () => {
    id = await createDraft(engineer, "Cable glands");
    await ok(take(engineer, id, "send_for_review", { internalNote: SENT }));
    await ok(pm.post(`/v1/work-items/${id}/claim`));
    await ok(take(pm, id, "return", { reason: "Wrong gland size", internalNote: RETURNED }));
    await ok(take(engineer, id, "send_for_review"));
    await ok(pm.post(`/v1/work-items/${id}/claim`));
    await ok(take(pm, id, "submit", { internalNote: SUBMITTED }));
  });

  it("is recorded with each Transition, Send for Review, Return and Submit, inside the Contractor", async () => {
    expect(await notes(engineer)).toEqual([
      ["Send for Review", SENT, "internal"],
      ["Return", RETURNED, "internal"],
      ["Submit", SUBMITTED, "internal"],
    ]);
    // Each is written just before its Transition, by the Member who took it.
    const events = await history(pm, id);
    const submitNote = events.findIndex((e) => e.internalNote === SUBMITTED);
    expect(events[submitNote]).toMatchObject({ by: { memberName: bilingual("Test Member") }, reason: null });
    expect(events[submitNote + 1]).toMatchObject({ type: "transition", transition: { en: "Submit" }, audience: "shared", internalNote: null });
  });

  it("is never seen by the Consultant or the Owner Representative, who see the Submit (scenario 34)", async () => {
    for (const caller of [signer, otherManager, orEngineer, owner]) {
      const events = await history(caller, id);
      expect(events.map((e) => [e.seq, e.type, e.transition?.en ?? null])).toEqual([[1, "transition", "Submit"]]);
      expect(events[0]!.internalNote).toBeNull();
      const all = await everything(caller, id);
      for (const note of [SENT, RETURNED, SUBMITTED]) expect(all).not.toContain(note);
    }
  });

  it("written with the Code, stays inside the Consultant (scenario 8)", async () => {
    await ok(signer.post(`/v1/work-items/${id}/claim`));
    await ok(take(signer, id, "approve_a", { internalNote: CODED }));
    expect(await notes(otherManager)).toEqual([["Approve · A", CODED, "internal"]]);
    for (const caller of [engineer, pm, orEngineer]) {
      const events = await history(caller, id);
      // Numbered as they see them: no gap counts the Consultant's Claim or Internal Note.
      expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
      expect(events.at(-1)).toMatchObject({ type: "issue_code", outcome: "A", internalNote: null });
      expect(await everything(caller, id)).not.toContain(CODED);
    }
  });

  it("is written once for a repeated request, and not at all for a blank one", async () => {
    const other = await createDraft(engineer, "Cable lugs");
    const idempotencyKey = randomUUID();
    const send = () =>
      engineer.post(`/v1/work-items/${other}/transitions`, { transition: "send_for_review", internalNote: SENT, idempotencyKey });
    await Promise.all([ok(send()), ok(send())]);
    await ok(pm.post(`/v1/work-items/${other}/claim`));
    await ok(take(pm, other, "return", { reason: "Again", internalNote: "   " }));
    const events = await history(engineer, other);
    expect(events.filter((e) => e.type === "internal_note").map((e) => e.internalNote)).toEqual([SENT]);
  });

  it("writes nothing when the Transition is refused", async () => {
    const other = await createDraft(engineer, "Cable ties");
    expect((await take(pm, other, "send_for_review", { internalNote: "Not mine to send" })).statusCode).not.toBe(204);
    await ok(take(engineer, other, "send_for_review"));
    await ok(pm.post(`/v1/work-items/${other}/claim`));
    expect((await take(pm, other, "return", { internalNote: "No reason given" })).json()).toEqual({ error: "reason_required" });
    const events = await history(pm, other);
    expect(events.some((e) => e.type === "internal_note")).toBe(false);
  });

  it("is at most 4000 characters", async () => {
    const other = await createDraft(engineer, "Cable clips");
    expect((await take(engineer, other, "send_for_review", { internalNote: "x".repeat(4001) })).statusCode).toBe(400);
    await ok(take(engineer, other, "send_for_review", { internalNote: "x".repeat(4000) }));
  });
});

// Last: moving the clock ends every session.
describe("Step Age", () => {
  it("counts the weeks at the Consultant's Step, for both sides", async () => {
    const id = await readyToSubmit("Earthing");
    await ok(take(pm, id, "submit"));
    api.advanceClock(15 * 86_400_000);
    for (const caller of [pm, signer]) {
      const again = await api.signIn(emails.get(caller)!, DEFAULT_PASSWORD);
      expect((await detail(again, id)).stepAgeWeeks).toBe(3);
    }
  });
});
