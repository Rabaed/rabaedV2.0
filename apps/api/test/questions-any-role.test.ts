// Seam 1 for Questions asked by any role (RP-1108; decision RP-1004; spec RP-619 stories 10 and 30;
// glossary Question; workflow-engine.md §3.1, §5.1 "Informed Participants" and "The Question Types
// as built"; visibility.md V1, V3, V5, V14 and scenarios RP-1108-1 to RP-1108-4).
//
// One Type per role asked, each Draft held by the raiser: the Question to Consultant (QSN), to
// Contractor (QSC) and to Owner (QSO). The Contractor, the Consultant, the Owner and the Owner's
// Representative ask; "New" never offers the Type that asks the raiser's own role. A QSO lands
// with the Owner Representative covering it, else the Owner (ADR 0022). The covering Consultant
// is informed of a Contractor's QSO and of the Owner side's QSC; it holds no Step.
//
// The Project: C1 (Contractor, all of it), K1 (Consultant, all of it), O1 (Owner, all of it), R1
// (Owner Representative, Building A only) and C2 (another Contractor of the same Trade,
// Building B only).
import type { WorkItemHistory, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, only, projectMember, take, tryTake, type Tower } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

type QuestionType = "QSN" | "QSC" | "QSO";

let at: Tower;
let buildingB = "";
let o1Pm: Caller; // The Owner's project manager.
let r1Engineer: Caller; // The Owner Representative's engineer, Building A only.
let c2Engineer: Caller; // Another Contractor of the same Trade, Building B only (V3).

const snags = async (by: Caller): Promise<WorkItemList> => (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items`), 200)).json();
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
const raisable = async (by: Caller): Promise<string[]> =>
  (await ok(by.get(`/v1/projects/${at.projectId}/raisable-types?module=snag_list`), 200)).json().types.map((t: { code: string }) => t.code);
const offered = async (by: Caller, id: string) => (await detail(by, id)).actions.transitions.map((t) => t.key);

/** `by`'s Draft Question of `type` on Electrical, at `location` (Building A unless named). */
async function draftQuestion(by: Caller, type: QuestionType, title: string, location = at.buildingA): Promise<string> {
  const answers = { question: `${title}?`, trade: at.electrical, location };
  return (await ok(by.post(`/v1/projects/${at.projectId}/work-items`, { type, title, answers }), 201)).json().id as string;
}

/** `asker`'s Question of `type`, asked: Open with the asked role. */
async function asked(asker: Caller, type: QuestionType, title: string, location = at.buildingA): Promise<string> {
  const id = await draftQuestion(asker, type, title, location);
  await take(asker, id, "ask");
  return id;
}

/** `by` holds the item's Step, from its Company's Step Pool. */
async function pickUp(by: Caller, id: string) {
  if ((await detail(by, id)).actions.pickUp) await ok(by.post(`/v1/work-items/${id}/pick-up`));
}

/** `by` reads item `id` nowhere: not in the Snag List, and by id, history and Links a 404. */
async function hiddenFrom(by: Caller, id: string, label: string) {
  expect((await snags(by)).items.map((i) => i.id), label).not.toContain(id);
  await expectHidden(by.get(`/v1/work-items/${id}`), label);
  await expectHidden(by.get(`/v1/work-items/${id}/history`), label);
  await expectHidden(by.get(`/v1/work-items/${id}/links`), label);
}

/** The shared Transitions of another Company that `by` reads on item `id`, with their answers. */
const othersTransitions = async (by: Caller, id: string) =>
  (await history(by, id))
    .filter((e) => e.by.memberName === null && e.type === "transition")
    .map((e) => ({ audience: e.audience, transition: e.transition?.en ?? null, answers: e.answers ?? null }));

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "QAR");
  buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  const join = async (role: "owner" | "owner_representative" | "contractor", location = all) => {
    const company = await api.authorizedPerson();
    const participant = await api.addParticipant(c1.caller, at.projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participant}/visibility`, { trade: all, location }));
    return { company, participant };
  };
  const o1 = await join("owner");
  const r1 = await join("owner_representative", only(at.buildingA));
  const c2 = await join("contractor", only(buildingB));
  o1Pm = await projectMember(api, o1.company, o1.participant, ["project_manager"]);
  r1Engineer = await projectMember(api, r1.company, r1.participant, ["engineer"]);
  c2Engineer = await projectMember(api, c2.company, c2.participant, ["engineer"]);
});

describe("which Question Types each role is offered in New (seam 1)", () => {
  it("each role is offered the Types that ask another role, never its own; the Owner side no Snag or Site Observation", async () => {
    const questions = async (by: Caller) => (await raisable(by)).filter((code) => code.startsWith("QS")).sort();
    expect(await questions(at.c1Engineer)).toEqual(["QSN", "QSO"]);
    expect(await questions(at.k1Manager)).toEqual(["QSC", "QSO"]);
    expect(await questions(o1Pm)).toEqual(["QSC", "QSN"]);
    expect(await questions(r1Engineer)).toEqual(["QSC", "QSN"]);
    // The Owner side's `create` is for the Question Types only.
    for (const owner of [o1Pm, r1Engineer]) expect((await raisable(owner)).sort()).toEqual(["QSC", "QSN"]);
    // Positive control: the Contractor still raises Snags.
    expect(await raisable(at.c1Engineer)).toContain("SNG");
  });

  it("a Question to one's own role, and a Snag by the Owner side, are refused when the Draft is started", async () => {
    const start = (by: Caller, type: string) =>
      by.post(`/v1/projects/${at.projectId}/work-items`, { type, title: "Mine", answers: { question: "Why?", trade: at.electrical, location: at.buildingA } });
    for (const [by, type] of [
      [at.c1Engineer, "QSC"],
      [at.k1Manager, "QSN"],
      [o1Pm, "QSO"],
      [r1Engineer, "QSO"],
      [o1Pm, "SNG"],
      [r1Engineer, "OBS"],
    ] as const) {
      const res = await start(by, type);
      expect(res.statusCode, `${type}: ${res.body}`).toBe(403);
    }
  });
});

describe("a Contractor's Question to Owner (seam 1, scenario RP-1108-1)", () => {
  it("lands with the covering Owner Representative, is answered, asked again and closed; the Consultant is informed and holds nothing", async () => {
    const id = await asked(at.c1Engineer, "QSO", "Which façade colour");
    const open = await detail(r1Engineer, id);
    expect(open.documentNumber).toMatch(/-QSO-/);
    expect(open.step.key).toBe("open");
    await pickUp(r1Engineer, id);
    expect(await offered(r1Engineer, id)).toContain("answer");
    // The Owner reads it (oversight) and holds nothing; so does the informed Consultant.
    expect(await offered(o1Pm, id)).toEqual([]);
    expect(await offered(at.k1Manager, id)).toEqual([]);
    expect(await offered(at.c1Engineer, id)).toEqual([]);
    const refused = await tryTake(at.k1Manager, id, "answer", { answers: { answer: "Grey" } });
    expect(refused.statusCode, refused.body).toBe(409);

    await take(r1Engineer, id, "answer", { answers: { answer: "RAL 7016" } });
    await pickUp(at.c1Engineer, id);
    await take(at.c1Engineer, id, "ask_again", { reason: "Matt or gloss?" });
    expect((await detail(r1Engineer, id)).step.key).toBe("open");
    await take(r1Engineer, id, "answer", { answers: { answer: "Matt" } });
    await pickUp(at.c1Engineer, id);
    await take(at.c1Engineer, id, "close");
    expect((await detail(at.k1Manager, id)).outcome).toBe("closed");

    // The informed Consultant reads the shared Transitions only, the Answers' text with them.
    expect(await othersTransitions(at.k1Manager, id)).toEqual([
      { audience: "shared", transition: "Ask", answers: null },
      { audience: "shared", transition: "Answer", answers: { answer: "RAL 7016" } },
      { audience: "shared", transition: "Ask again", answers: { reason: "Matt or gloss?" } },
      { audience: "shared", transition: "Answer", answers: { answer: "Matt" } },
      { audience: "shared", transition: "Close", answers: null },
    ]);
    expect((await history(at.k1Manager, id)).some((e) => e.type === "picked_up")).toBe(false);
  });

  it("RP-1108-1: C2, another Contractor, sees C1's QSO nowhere, Draft to Closed, not even by id; the Owner side and the Consultant see it once asked", async () => {
    const id = await draftQuestion(at.c1Engineer, "QSO", "C1's question to the Owner");
    await hiddenFrom(c2Engineer, id, "draft, C2");
    for (const other of [o1Pm, r1Engineer, at.k1Manager]) await expectHidden(other.get(`/v1/work-items/${id}`), "draft");
    await take(at.c1Engineer, id, "ask");
    for (const reader of [o1Pm, r1Engineer, at.k1Manager]) expect((await snags(reader)).items.map((i) => i.id)).toContain(id);
    await hiddenFrom(c2Engineer, id, "open, C2");
    await pickUp(r1Engineer, id);
    await take(r1Engineer, id, "answer", { answers: { answer: "Yes" } });
    await hiddenFrom(c2Engineer, id, "answered, C2");
    await pickUp(at.c1Engineer, id);
    await take(at.c1Engineer, id, "close");
    await hiddenFrom(c2Engineer, id, "closed, C2");
  });

  it("with no Owner Representative covering it, lands with the Owner", async () => {
    const id = await asked(at.c1Engineer, "QSO", "Which paving at Building B", buildingB);
    await expectHidden(r1Engineer.get(`/v1/work-items/${id}`), "R1 covers Building A only");
    await pickUp(o1Pm, id);
    expect(await offered(o1Pm, id)).toContain("answer");
    await take(o1Pm, id, "answer", { answers: { answer: "Interlock" } });
    expect((await detail(at.c1Engineer, id)).step.key).toBe("answered");
  });
});

describe("the Owner side asks (seam 1, scenarios RP-1108-2 to RP-1108-4)", () => {
  it("RP-1108-2: the Owner's QSC to C1 reaches C1, the Owner side and the Consultant (informed); C2 never", async () => {
    const id = await draftQuestion(o1Pm, "QSC", "When is the slab poured");
    await take(o1Pm, id, "ask");
    expect((await detail(at.c1Pm, id)).step.key).toBe("open");
    expect(await offered(at.k1Manager, id)).toEqual([]);
    expect((await snags(at.k1Manager)).items.map((i) => i.id)).toContain(id);
    expect((await snags(r1Engineer)).items.map((i) => i.id)).toContain(id);
    await hiddenFrom(c2Engineer, id, "open, C2");
    await pickUp(at.c1Pm, id);
    await take(at.c1Pm, id, "answer", { answers: { answer: "Sunday" } });
    await pickUp(o1Pm, id);
    expect(await offered(o1Pm, id)).toEqual(expect.arrayContaining(["close", "ask_again"]));
    await take(o1Pm, id, "close");
    expect((await detail(at.k1Manager, id)).outcome).toBe("closed");
    expect((await othersTransitions(at.k1Manager, id)).map((e) => e.transition)).toEqual(["Ask", "Answer", "Close"]);
    await hiddenFrom(c2Engineer, id, "closed, C2");
  });

  it("RP-1108-3: a Consultant's QSO and the Owner's QSN reach no Contractor, and inform nobody", async () => {
    const toOwner = await asked(at.k1Manager, "QSO", "Is the alternate tile accepted");
    const toConsultant = await asked(o1Pm, "QSN", "Has the mock-up been approved");
    for (const id of [toOwner, toConsultant]) {
      await hiddenFrom(at.c1Pm, id, "C1");
      await hiddenFrom(c2Engineer, id, "C2");
    }
    // Positive controls: the asked Company reads each.
    expect((await detail(r1Engineer, toOwner)).step.key).toBe("open");
    expect((await detail(at.k1Manager, toConsultant)).step.key).toBe("open");
  });

  it("RP-1108-4: the Owner Representative's Draft is its own until the Ask", async () => {
    const id = await draftQuestion(r1Engineer, "QSN", "Which sample is the reference");
    for (const other of [o1Pm, at.k1Manager, at.c1Pm, c2Engineer]) await hiddenFrom(other, id, "draft");
    expect((await detail(r1Engineer, id)).step.key).toBe("draft");
    await take(r1Engineer, id, "ask");
    await pickUp(at.k1Manager, id);
    expect(await offered(at.k1Manager, id)).toContain("answer");
    for (const contractor of [at.c1Pm, c2Engineer]) await hiddenFrom(contractor, id, "open");
  });
});
