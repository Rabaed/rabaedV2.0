// Seam 1: Send for Review and Return inside the Contractor (RP-193; workflow-engine.md
// §5.1, §5.2, §8; visibility.md V1, V5; spec scenarios 2, 7 and 11).
// The Engineer sends a Draft to the Contractor PM pool; a PM claims it and
// returns it with a reason. Nobody outside the Contractor sees any of it.
import { randomUUID } from "node:crypto";
import type { WorkItemDetail, WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

type Company = { company: OnboardedCompany; caller: Caller };

let c1: Company; // Contractor (Electrical); its Authorized Person created the Project.
let c1ParticipantId = "";
let engineer: Caller; // C1 Engineer: raises and sends.
let pm1: Caller; // C1 Project Managers: the Internal Review pool.
let pm2: Caller;
let noPosition: Caller; // A C1 Member on the Project with no Position.
let c2Engineer: Caller; // Second Contractor, Electrical too (V3).
let k1Engineer: Caller; // Consultant.
let orEngineer: Caller; // Owner Representative.
let projectId = "";
let electrical = "";

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

async function ok(res: Promise<{ statusCode: number; body: string }>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
}

/** A signed-in Member of `company` on the Project through `participantId`, covering all of it, with `positions`. */
async function projectMember(company: Company, participantId: string, positions: string[]) {
  const { member, caller } = await api.member(company.caller);
  await api.addProjectMember(company.caller, participantId, member.id);
  await ok(
    company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/visibility`, {
      trade: all,
      location: all,
    }),
  );
  if (positions.length) {
    await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/positions`, { positions }));
  }
  return caller;
}

async function otherParticipant(role: "contractor" | "consultant" | "owner_representative", positions: string[]) {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return projectMember(company, participantId, positions);
}

async function createDraft(by: Caller, title = "Cable trays"): Promise<string> {
  const res = await by.post(`/v1/projects/${projectId}/work-items`, {
    type: "MAR",
    title,
    tradeId: electrical,
    locationId: null,
    answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

const take = (by: Caller, id: string, transition: string, extra: { reason?: string; idempotencyKey?: string } = {}) =>
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

/** The buttons the viewer gets, as a flat list: "claim", "release", or a Transition's key. */
const buttons = (d: WorkItemDetail) => [
  ...(d.actions.claim ? ["claim"] : []),
  ...(d.actions.release ? ["release"] : []),
  ...d.actions.transitions.map((t) => t.key),
];

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const res = await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") });
  electrical = res.json().id;
  c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(c1, c1ParticipantId, ["engineer"]);
  pm1 = await projectMember(c1, c1ParticipantId, ["project_manager"]);
  pm2 = await projectMember(c1, c1ParticipantId, ["project_manager"]);
  noPosition = await projectMember(c1, c1ParticipantId, []);
  c2Engineer = await otherParticipant("contractor", ["engineer"]);
  k1Engineer = await otherParticipant("consultant", ["engineer"]);
  orEngineer = await otherParticipant("owner_representative", ["engineer"]);
});

describe("Send for Review", () => {
  let id = "";
  beforeAll(async () => {
    id = await createDraft(engineer);
  });

  it("is the only button the Engineer gets on their Draft; PMs get none", async () => {
    expect(buttons(await detail(engineer, id))).toEqual(["send_for_review"]);
    expect((await detail(engineer, id)).actions.transitions[0]).toMatchObject({
      label: { en: "Send for Review" },
      needsReason: false,
    });
    expect(buttons(await detail(pm1, id))).toEqual([]);
  });

  it("moves the Draft to Internal Review, held by the PM pool, and assigns the Document Number", async () => {
    await ok(take(engineer, id, "send_for_review"));
    const d = await detail(engineer, id);
    expect(d).toMatchObject({
      stage: { key: "internal_review" },
      step: { key: "internal_review" },
      heldBy: { companyName: { en: "Test Constructions" }, memberName: null },
      stepAgeWeeks: 1,
    });
    expect(d.documentNumber).toBe("TWR-MAR-01-0001");
    expect(buttons(d)).toEqual([]);
    expect(buttons(await detail(pm1, id))).toEqual(["claim"]);
  });

  it("keeps the item invisible to the Consultant, the Owner Representative and the second Contractor (V1)", async () => {
    for (const caller of [k1Engineer, orEngineer, c2Engineer]) {
      const list = (await caller.get(`/v1/projects/${projectId}/work-items`)).json();
      expect(list.items).toEqual([]);
      expect(list.stages.every((s: { count: number }) => s.count === 0)).toBe(true);
      await expectHidden(caller.get(`/v1/work-items/${id}`));
      await expectHidden(caller.get(`/v1/work-items/${id}/history`));
      const res = await take(caller, id, "return", { reason: "x" });
      await expectHidden(res);
      await expectHidden(caller.post(`/v1/work-items/${id}/claim`));
    }
  });

  it("is counted under Internal Review for the Contractor", async () => {
    const list = (await engineer.get(`/v1/projects/${projectId}/work-items`)).json();
    const counts = Object.fromEntries(list.stages.map((s: { key: string; count: number }) => [s.key, s.count]));
    expect(counts).toMatchObject({ draft: 0, internal_review: 1 });
  });
});

describe("Claim, Return and re-send", () => {
  let id = "";
  beforeAll(async () => {
    id = await createDraft(engineer, "Lighting fixtures");
    await ok(take(engineer, id, "send_for_review"));
  });

  it("lets only one of two simultaneous Claims win", async () => {
    const [a, b] = await Promise.all([pm1.post(`/v1/work-items/${id}/claim`), pm2.post(`/v1/work-items/${id}/claim`)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([204, 409]);
    expect([a, b].find((r) => r.statusCode === 409)!.json()).toEqual({ error: "already_claimed" });
    // Whoever lost holds nothing; whoever won holds the Step. Continue with pm1 holding it.
    if (a.statusCode === 409) {
      await ok(pm2.post(`/v1/work-items/${id}/release`));
      await ok(pm1.post(`/v1/work-items/${id}/claim`));
    }
    const d = await detail(pm1, id);
    expect(d.heldBy?.memberName).toEqual({ en: "Test Member", ar: "عضو الاختبار" });
    expect(buttons(d)).toEqual(["release", "return"]);
    expect(d.actions.transitions[0]).toMatchObject({ label: { en: "Return" }, needsReason: true });
    expect(buttons(await detail(pm2, id))).toEqual([]);
  });

  it("refuses the Engineer and the other PM, who don't hold the Step, and changes nothing (scenario 11)", async () => {
    const before = await history(engineer, id);
    for (const caller of [engineer, pm2]) {
      const res = await take(caller, id, "return", { reason: "Wrong tray size" });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toEqual({ error: "not_holder" });
    }
    expect((await pm2.post(`/v1/work-items/${id}/release`)).json()).toEqual({ error: "not_holder" });
    expect(await history(engineer, id)).toEqual(before);
    expect((await detail(engineer, id)).stage.key).toBe("internal_review");
  });

  it("needs a reason to Return", async () => {
    const res = await take(pm1, id, "return", { reason: "   " });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "reason_required" });
  });

  it("refuses a Transition that doesn't leave the current Step, or whose next Step nobody could hold", async () => {
    expect((await take(pm1, id, "send_for_review")).json()).toEqual({ error: "transition_not_available" });
    // The Consultant has Engineers only: nobody could issue its Code (RP-194), which is theirs to know.
    // Submit isn't offered (above), and the answer is the one a Gap or an Overlap gets (scenario 37).
    const res = await take(pm1, id, "submit");
    expect(res.statusCode).toBe(409);
    expect(res.body).toBe(JSON.stringify({ error: "next_step_unavailable" }));
    expect((await take(pm1, id, "no_such_thing")).statusCode).toBe(409);
  });

  it("Returns it to the Engineer who sent it, with the reason, keeping the Document Number", async () => {
    const number = (await detail(pm1, id)).documentNumber;
    expect(number).toMatch(/^TWR-MAR-01-\d{4}$/);
    await ok(take(pm1, id, "return", { reason: "Wrong tray size" }));
    const d = await detail(engineer, id);
    expect(d).toMatchObject({ stage: { key: "draft" }, documentNumber: number });
    expect(d.heldBy?.memberName).not.toBeNull();
    expect(buttons(d)).toEqual(["send_for_review"]);
    expect(buttons(await detail(pm1, id))).toEqual([]);

    await ok(take(engineer, id, "send_for_review"));
    expect((await detail(engineer, id)).documentNumber).toBe(number);
    expect((await detail(pm1, id)).stage.key).toBe("internal_review");
  });

  it("shows the Contractor's Members each move, with the Return reason (V5)", async () => {
    const events = await history(pm2, id);
    expect(events.map((e) => [e.type, e.transition?.en ?? null, e.audience])).toEqual([
      ["created", null, "internal"],
      ["transition", "Send for Review", "internal"],
      ["claimed", null, "internal"],
      ["transition", "Return", "internal"],
      ["transition", "Send for Review", "internal"],
    ]);
    expect(events[1]).toMatchObject({
      fromStep: { en: "Draft" },
      toStep: { en: "Contractor review" },
      documentNumber: expect.stringMatching(/^TWR-MAR-01-/),
      by: { companyName: { en: "Test Constructions" }, memberName: { en: "Test Member" } },
    });
    expect(events[3]!.reason).toBe("Wrong tray size");
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the Return reason from everyone outside the Contractor (V5)", async () => {
    for (const caller of [k1Engineer, orEngineer, c2Engineer]) {
      const res = await caller.get(`/v1/work-items/${id}/history`);
      await expectHidden(res);
      expect(res.body).not.toContain("Wrong tray size");
    }
  });
});

describe("the Document Number", () => {
  it("counts on per Participant, and not before leaving Draft", async () => {
    const a = await createDraft(engineer, "Switchgear");
    const b = await createDraft(engineer, "Busbars");
    expect((await detail(engineer, a)).documentNumber).toBeNull();
    await ok(take(engineer, b, "send_for_review"));
    await ok(take(engineer, a, "send_for_review"));
    const nb = (await detail(engineer, b)).documentNumber!;
    const na = (await detail(engineer, a)).documentNumber!;
    expect(Number(na.slice(-4))).toBe(Number(nb.slice(-4)) + 1);
  });

  it("is the second Contractor's own series", async () => {
    const id = await createDraft(c2Engineer);
    // c2 has Engineers only: nobody could hold Internal Review, so it can't be sent, and no button says it can.
    expect(buttons(await detail(c2Engineer, id))).toEqual([]);
    const res = await take(c2Engineer, id, "send_for_review");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_step_pool" });
    expect((await detail(c2Engineer, id)).documentNumber).toBeNull();
  });
});

describe("a Transition", () => {
  it("applies once for the same idempotency key, even sent twice at once", async () => {
    const id = await createDraft(engineer, "Earthing");
    const idempotencyKey = randomUUID();
    const [a, b] = await Promise.all([
      take(engineer, id, "send_for_review", { idempotencyKey }),
      take(engineer, id, "send_for_review", { idempotencyKey }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([204, 204]);
    await ok(take(engineer, id, "send_for_review", { idempotencyKey }));
    const events = await history(engineer, id);
    expect(events.filter((e) => e.type === "transition")).toHaveLength(1);
    expect((await detail(engineer, id)).stage.key).toBe("internal_review");

    // The same key for another item is a mistake, not a replay.
    const reused = await take(engineer, await createDraft(engineer), "send_for_review", { idempotencyKey });
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toEqual({ error: "idempotency_key_reused" });
  });

  it("applies one key to only one of two items, even sent to both at once", async () => {
    const [a, b] = [await createDraft(engineer, "Sockets"), await createDraft(engineer, "Switches")];
    const idempotencyKey = randomUUID();
    const results = await Promise.all([
      take(engineer, a, "send_for_review", { idempotencyKey }),
      take(engineer, b, "send_for_review", { idempotencyKey }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 422]);
    const stages = [(await detail(engineer, a)).stage.key, (await detail(engineer, b)).stage.key].sort();
    expect(stages).toEqual(["draft", "internal_review"]);
  });

  it("is refused to a holder without the permission, and nothing changes (scenario 11)", async () => {
    const id = await createDraft(noPosition, "Cable glands");
    expect(buttons(await detail(noPosition, id))).toEqual([]);
    const res = await take(noPosition, id, "send_for_review");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden" });
    expect(await history(noPosition, id)).toHaveLength(1);
    expect((await detail(noPosition, id)).stage.key).toBe("draft");
  });

  it("needs a key and a session", async () => {
    const id = await createDraft(engineer, "Trunking");
    expect((await engineer.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review" })).statusCode).toBe(400);
    expect((await take(api.anonymous(), id, "send_for_review")).statusCode).toBe(401);
    await expectHidden(engineer.post(`/v1/work-items/${randomUUID()}/claim`));
  });
});

describe("Positions", () => {
  it("are set by the Authorized Person, from their base role's Positions only", async () => {
    const { member } = await api.member(c1.caller);
    await api.addProjectMember(c1.caller, c1ParticipantId, member.id);
    const path = `/v1/participants/${c1ParticipantId}/members/${member.id}/positions`;
    expect((await c1.caller.request("PUT", path, { positions: ["manager"] })).json()).toEqual({
      error: "position_not_found",
    });
    await ok(c1.caller.request("PUT", path, { positions: ["engineer", "project_manager"] }));
    const members = (await c1.caller.get(`/v1/participants/${c1ParticipantId}/members`)).json();
    expect(members.positions.map((p: { key: string }) => p.key)).toEqual(["engineer", "project_manager"]);
    expect(members.members.find((m: { id: string }) => m.id === member.id).positions).toEqual([
      "engineer",
      "project_manager",
    ]);
    // Not by anyone else.
    expect((await pm1.request("PUT", path, { positions: [] })).statusCode).toBe(403);
  });
});
