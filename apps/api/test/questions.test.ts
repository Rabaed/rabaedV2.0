// Seam 1 for the Question Types (RP-626, SNAG-6; spec RP-619; glossary Question, Snag List,
// Stage, Step; workflow-engine.md §3.1, §12; visibility.md V3, V5, V14 and scenarios RP-626-1 to
// RP-626-4).
//
// A Contractor asks the Consultant a Question to Consultant (QSN) and a Consultant asks the
// Contractor a Question to Contractor (QSC); each Type is offered only to the other role. The
// asked role answers (its reply in the Screen `question_answer`, shared, ADR 0019), and the
// asker, who holds Answered, closes it or asks again with a reason. One Participant of the
// asked role covers the Question's Trade and Location: the asker picking among several is
// RP-658.
import { rabaedFormFile, rabaedWorkflowFile, sameDefinition } from "@rabaed/admin/services";
import { createDb, rabaedDefaultWorkflowId, readLatestPublishedDefinition } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, parseWorkflowDefinition, sameJson, type WorkItemHistory, type WorkItemList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, only, projectMember, take, tryTake, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company;
let k1: Company;
let at: Tower;
let c2Engineer: Caller; // Another Contractor of the same Trade, covering Building B only (V3).

const snags = async (by: Caller): Promise<WorkItemList> => (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items`), 200)).json();
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
const raisable = async (by: Caller) =>
  (await ok(by.get(`/v1/projects/${at.projectId}/raisable-types?module=snag_list`), 200)).json().types.map((t: { code: string }) => t.code);
const offered = async (by: Caller, id: string) => (await detail(by, id)).actions.transitions.map((t) => t.key);
const who = (by: Caller) =>
  by === c2Engineer ? "C2 engineer" : by === at.c1Engineer ? "C1 engineer" : by === at.c1Pm ? "C1 PM" : by === at.k1Manager ? "K1 manager" : "someone";

/**
 * Item `id` is read by each of `seenBy`, then by none of `hiddenFrom`: in the Snag List (its row, so
 * its Step Age too), by id, its history, Links and Documents. A read that answers 200 counts as reading it.
 */
async function hiddenEverywhere(id: string, seenBy: Caller | Caller[], hiddenFrom: Caller | Caller[], label: string) {
  const asItem = (path: string) => async (by: Caller) => (await readById<unknown>(path)(by)).map(() => ({ id }));
  const reads: [string, (by: Caller) => Promise<readonly { id: string }[]>][] = [
    ["Snag List", async (by) => (await snags(by)).items],
    ["by id", readById(`/v1/work-items/${id}`)],
    ["history", asItem(`/v1/work-items/${id}/history`)],
    ["Links", asItem(`/v1/work-items/${id}/links`)],
    ["Documents", asItem(`/v1/work-items/${id}/documents`)],
  ];
  for (const [read, rows] of reads) await expectHiddenFrom({ read: rows, target: id, seenBy, hiddenFrom, name: who, label: `${label}, ${read}` });
}

/** `by`'s Draft Question of Type `type` on Building A, Electrical. */
async function draftQuestion(by: Caller, type: "QSN" | "QSC", title: string): Promise<string> {
  const answers = { question: `${title}?`, trade: at.electrical, location: at.buildingA };
  return (await ok(by.post(`/v1/projects/${at.projectId}/work-items`, { type, title, answers }), 201)).json().id as string;
}

/** `by` holds Open from the asked Company's Step Pool. */
async function pickUp(by: Caller, id: string) {
  if ((await detail(by, id)).actions.pickUp) await ok(by.post(`/v1/work-items/${id}/pick-up`));
}

/** `asker`'s Question of Type `type`, asked: Open with the asked role. */
async function asked(asker: Caller, type: "QSN" | "QSC", title: string): Promise<string> {
  const id = await draftQuestion(asker, type, title);
  await take(asker, id, "ask");
  return id;
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "QST");
  const buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
});

describe("which Question Types a Member is offered (seam 1)", () => {
  it("a Contractor is offered the Question to Consultant, never the Question to Contractor; a Consultant the reverse", async () => {
    const contractor = await raisable(at.c1Engineer);
    expect(contractor).toContain("QSN");
    expect(contractor).not.toContain("QSC"); // not hidden-from: Types offered, not a row
    const consultant = await raisable(at.k1Manager);
    expect(consultant).toContain("QSC");
    expect(consultant).not.toContain("QSN"); // not hidden-from: Types offered, not a row
  });

  it("asking one's own role is refused when the Draft is started", async () => {
    const own = await at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: "QSC",
      title: "Asking myself",
      answers: { question: "Why?", trade: at.electrical, location: at.buildingA },
    });
    expect(own.statusCode, own.body).toBe(403);
    const other = await at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, {
      type: "QSN",
      title: "Asking myself",
      answers: { question: "Why?", trade: at.electrical, location: at.buildingA },
    });
    expect(other.statusCode, other.body).toBe(403);
  });
});

describe("a Contractor's Question to Consultant (seam 1)", () => {
  it("is asked, answered, asked again with a reason, answered again and closed", async () => {
    const id = await draftQuestion(at.c1Engineer, "QSN", "Slab level at the riser");
    const draft = await detail(at.c1Engineer, id);
    expect(draft.step?.key).toBe("draft");
    expect(draft.type.code).toBe("QSN");

    await take(at.c1Engineer, id, "ask");
    const open = await detail(at.k1Manager, id);
    expect(open.documentNumber).toMatch(/-QSN-/);
    expect(open.step?.key).toBe("open");
    expect(open.stage.key).toBe("open");
    // Asked of the Consultant, the Contractor that asked it holds nothing.
    expect(await offered(at.c1Engineer, id)).toEqual([]); // not hidden-from: no Transition offered on an item it reads
    expect(open.actions.transitions.map((t) => t.key)).toContain("answer");

    // The answer is required: it is the Consultant's reply Screen.
    await pickUp(at.k1Manager, id);
    const noAnswer = await tryTake(at.k1Manager, id, "answer");
    expect(noAnswer.statusCode, noAnswer.body).toBe(422);
    await take(at.k1Manager, id, "answer", { answers: { answer: "Plus 150 above the finished floor" } });

    const answered = await detail(at.c1Engineer, id);
    expect(answered.step?.key).toBe("answered");
    expect(answered.stage.key).toBe("resolved");
    expect((await history(at.c1Engineer, id)).filter((e) => e.answers).at(-1)!.answers).toEqual({ answer: "Plus 150 above the finished floor" });
    // The asker's Company holds Answered, in its Step Pool: its Member picks it up, then Close, or Ask again; the Consultant, nothing.
    await pickUp(at.c1Engineer, id);
    expect(await offered(at.c1Engineer, id)).toEqual(expect.arrayContaining(["close", "ask_again"]));
    expect(await offered(at.k1Manager, id)).toEqual([]); // not hidden-from: no Transition offered on an item it reads

    const noReason = await tryTake(at.c1Engineer, id, "ask_again");
    expect(noReason.statusCode, noReason.body).toBe(422);
    await take(at.c1Engineer, id, "ask_again", { reason: "Above which floor, the ground or the first?" });
    const again = await detail(at.k1Manager, id);
    expect(again.step?.key).toBe("open");
    expect(again.actions.transitions.map((t) => t.key)).toContain("answer");

    await take(at.k1Manager, id, "answer", { answers: { answer: "The finished ground floor" } });
    await pickUp(at.c1Engineer, id);
    await take(at.c1Engineer, id, "close");
    const closed = await detail(at.k1Manager, id);
    expect(closed.outcome).toBe("closed");
    expect(closed.stage.key).toBe("closed");
    expect((await history(at.k1Manager, id)).filter((e) => e.type === "transition").map((e) => e.transition?.en)).toEqual([
      "Ask",
      "Answer",
      "Ask again",
      "Answer",
      "Close",
    ]);
  });
});

describe("a Consultant's Question to Contractor (seam 1)", () => {
  it("is asked of C1, answered by C1 and closed by the Consultant", async () => {
    const id = await asked(at.k1Manager, "QSC", "Where is the fire damper?");
    const open = await detail(at.c1Pm, id);
    expect(open.documentNumber).toMatch(/-QSC-/);
    expect(open.step?.key).toBe("open");
    expect(open.actions.pickUp).toBe(true); // In C1's Step Pool.
    expect(await offered(at.k1Manager, id)).toEqual([]); // not hidden-from: no Transition offered on an item it reads

    await pickUp(at.c1Pm, id);
    await take(at.c1Pm, id, "answer", { answers: { answer: "Behind the ceiling access panel" } });
    expect((await detail(at.k1Manager, id)).step?.key).toBe("answered");
    expect(await offered(at.k1Manager, id)).toEqual(expect.arrayContaining(["close", "ask_again"]));
    expect(await offered(at.c1Pm, id)).toEqual([]); // not hidden-from: no Transition offered on an item it reads

    await take(at.k1Manager, id, "close");
    expect((await detail(at.c1Pm, id)).outcome).toBe("closed");
  });

  it("shows in the Snag List by its Stages: Open, then Resolved while Answered, then Closed", async () => {
    const id = await asked(at.k1Manager, "QSC", "Which tray size?");
    expect((await snags(at.c1Pm)).items.find((i) => i.id === id)?.stage.key).toBe("open");
    await pickUp(at.c1Pm, id);
    await take(at.c1Pm, id, "answer", { answers: { answer: "300 by 100" } });
    expect((await snags(at.k1Manager)).items.find((i) => i.id === id)?.stage.key).toBe("resolved");
    await take(at.k1Manager, id, "close");
    expect((await snags(at.k1Manager)).items.find((i) => i.id === id)?.stage.key).toBe("closed");
  });
});

describe("C2 never sees C1's Questions (scenarios RP-626-1, RP-626-2)", () => {
  it("RP-626-1: C2, another Contractor of the same Trade, sees a Question to Consultant in no list or count, by id, history or Links, at any Step", async () => {
    const id = await draftQuestion(at.c1Engineer, "QSN", "C1's own question");
    const hidden = (step: string) => hiddenEverywhere(id, at.c1Engineer, c2Engineer, step);
    await hidden("draft");
    await take(at.c1Engineer, id, "ask");
    await hidden("open");
    await pickUp(at.k1Manager, id);
    await take(at.k1Manager, id, "answer", { answers: { answer: "Yes" } });
    await hidden("answered");
    await pickUp(at.c1Engineer, id);
    await take(at.c1Engineer, id, "ask_again", { reason: "Which one?" });
    await hidden("asked again");
    await take(at.k1Manager, id, "answer", { answers: { answer: "This one" } });
    await pickUp(at.c1Engineer, id);
    await take(at.c1Engineer, id, "close");
    await hidden("closed");
    // Its Stage counts: C1 counts it, C2 counts nothing (C2 has no Snag List item on this Project).
    const counted = async (by: Caller) => (await snags(by)).stages.reduce((n, s) => n + s.count, 0);
    expect(await counted(at.c1Engineer)).toBeGreaterThan(0);
    expect(await counted(c2Engineer)).toBe(0);
  });

  it("RP-626-2: C2 sees a Question to Contractor that K1 asked of C1 nowhere either; the Draft stays K1's", async () => {
    const id = await draftQuestion(at.k1Manager, "QSC", "For C1 only");
    await expectHiddenFrom({ read: readById(`/v1/work-items/${id}`), target: id, seenBy: at.k1Manager, hiddenFrom: [at.c1Pm, c2Engineer], name: who, label: "draft" });
    await take(at.k1Manager, id, "ask");
    await hiddenEverywhere(id, [at.k1Manager, at.c1Pm], c2Engineer, "open");
  });
});

describe("C2 reads neither Company's open Question (scenario RP-626-3)", () => {
  it("RP-626-3: with C1's QSN and K1's QSC both Open, C2 reads neither in the Snag List or its Step Age, by id, history, Links or Documents", async () => {
    const qsn = await asked(at.c1Engineer, "QSN", "C1's open question");
    const qsc = await asked(at.k1Manager, "QSC", "K1's open question");
    // Each is Open with the asked role, so both C1 and K1 read both, Step Age included; the Step to its holder only (RP-1192).
    for (const [id, holder] of [
      [qsn, at.k1Manager],
      [qsc, at.c1Pm],
    ] as const) {
      expect((await detail(holder, id)).step?.key).toBe("open");
      for (const by of [at.c1Pm, at.k1Manager]) expect((await snags(by)).items.find((i) => i.id === id)?.stepAgeWeeks, who(by)).toBeGreaterThan(0);
    }
    await hiddenEverywhere(qsn, [at.c1Engineer, at.k1Manager], c2Engineer, "QSN");
    await hiddenEverywhere(qsc, [at.c1Pm, at.k1Manager], c2Engineer, "QSC");
  });
});

describe("each Company reads the other's work as the shared Transitions only (scenario RP-626-4)", () => {
  it("RP-626-4: K1 reads C1's Ask, Ask again and Close; C1 reads K1's two Answers and their text; neither reads the other's pick-ups", async () => {
    const id = await asked(at.c1Engineer, "QSN", "Which floor");
    await pickUp(at.k1Manager, id);
    await take(at.k1Manager, id, "answer", { answers: { answer: "The ground floor" } });
    await pickUp(at.c1Engineer, id);
    await take(at.c1Engineer, id, "ask_again", { reason: "The finished one?" });
    await pickUp(at.k1Manager, id);
    await take(at.k1Manager, id, "answer", { answers: { answer: "The finished ground floor" } });
    await pickUp(at.c1Engineer, id);
    await take(at.c1Engineer, id, "close");

    // Another Company's events name it by Company only, never a person (V14): those are the other's work.
    const others = async (by: Caller) =>
      (await history(by, id))
        .filter((e) => e.by.memberName === null)
        .map((e) => ({ type: e.type, audience: e.audience, transition: e.transition?.en ?? null, answers: e.answers }));
    expect((await others(at.k1Manager)).map(({ answers: _, ...e }) => e)).toEqual([
      { type: "transition", audience: "shared", transition: "Ask" },
      { type: "transition", audience: "shared", transition: "Ask again" },
      { type: "transition", audience: "shared", transition: "Close" },
    ]);
    expect(await others(at.c1Engineer)).toEqual([
      { type: "transition", audience: "shared", transition: "Answer", answers: { answer: "The ground floor" } },
      { type: "transition", audience: "shared", transition: "Answer", answers: { answer: "The finished ground floor" } },
    ]);
    // Positive control: C1 reads its own pick-ups, internal, which K1 never does.
    expect((await history(at.c1Engineer, id)).some((e) => e.type === "picked_up" && e.audience === "internal" && e.by.memberName !== null)).toBe(true);
    const historyOf = async (by: Caller) => (await readById<unknown>(`/v1/work-items/${id}/history`)(by)).map(() => ({ id }));
    await expectHiddenFrom({ read: historyOf, target: id, seenBy: [at.c1Engineer, at.k1Manager], hiddenFrom: c2Engineer, name: who, label: "history" });
  });
});

describe("the Rabaed Default Question Workflows and Form", () => {
  // RP-1108: QSN's and QSC's Version 2 hold the Draft by the raiser; QSO is new at Version 1.
  it.each([
    ["QSN", 2],
    ["QSC", 2],
    ["QSO", 1],
  ])("%s's Workflow and the shared Form are the documents `pnpm defaults:publish` publishes, as their latest Versions (Version %i)", async (code, versionNo) => {
    const definitionId = (await rabaedDefaultWorkflowId(migrator, code))!;
    const latest = (await readLatestPublishedDefinition(migrator, definitionId))!;
    expect(latest.versionNo).toBe(versionNo);
    const file = parseWorkflowDefinition(rabaedWorkflowFile(`${code}.json`));
    expect(file.ok && sameDefinition(latest.definition, file.definition)).toBe(true);

    const { rows } = await sql<{ schema: unknown }>`
      select v.schema from form_version v
      join work_item_type t on t.form_definition_id = v.form_definition_id
      where t.owner_kind = 'rabaed' and t.code = ${code} and v.status = 'published'
      order by v.version_no desc limit 1
    `.execute(migrator);
    expect(sameJson(formSchema.parse(rows[0]!.schema), formSchema.parse(rabaedFormFile("QST.json")))).toBe(true);
  });
});
