// Seam 1 for the Question Types (RP-626, SNAG-6; spec RP-619; glossary Question, Snag List,
// Stage, Step; workflow-engine.md §3.1, §12; visibility.md V3, V5 and scenarios RP-626-1 to
// RP-626-3).
//
// A Contractor asks the Consultant a Question to Consultant (QSN) and a Consultant asks the
// Contractor a Question to Contractor (QSC); each Type is offered only to the other role. The
// asked role answers (its reply in the Screen `question_answer`, shared, ADR 0019), and the
// asker, who holds Answered, closes it or asks again with a reason. One Participant of the
// asked role covers the Question's Trade and Location: the asker picking among several is
// RP-658.
import { rabaedFormFile, rabaedWorkflowFile, sameDefinition } from "@rabaed/admin/services";
import { createDb, rabaedDefaultWorkflowId, readLatestPublishedDefinition } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, parseWorkflowDefinition, sameJson, type WorkItemHistory, type WorkItemList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
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
    expect(contractor).not.toContain("QSC");
    const consultant = await raisable(at.k1Manager);
    expect(consultant).toContain("QSC");
    expect(consultant).not.toContain("QSN");
  });

  it("asking one's own role is refused when the Draft is started", async () => {
    const own = await at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: "QSC",
      title: "Asking myself",
      answers: { question: "Why?", trade: at.electrical, location: at.buildingA },
    });
    expect(own.statusCode, own.body).toBeGreaterThanOrEqual(400);
    const other = await at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, {
      type: "QSN",
      title: "Asking myself",
      answers: { question: "Why?", trade: at.electrical, location: at.buildingA },
    });
    expect(other.statusCode, other.body).toBeGreaterThanOrEqual(400);
  });
});

describe("a Contractor's Question to Consultant (seam 1)", () => {
  it("is asked, answered, asked again with a reason, answered again and closed", async () => {
    const id = await draftQuestion(at.c1Engineer, "QSN", "Slab level at the riser");
    const draft = await detail(at.c1Engineer, id);
    expect(draft.step.key).toBe("draft");
    expect(draft.type.code).toBe("QSN");

    await take(at.c1Engineer, id, "ask");
    const open = await detail(at.k1Manager, id);
    expect(open.documentNumber).toMatch(/-QSN-/);
    expect(open.step.key).toBe("open");
    expect(open.stage.key).toBe("open");
    // Asked of the Consultant, the Contractor that asked it holds nothing.
    expect(await offered(at.c1Engineer, id)).toEqual([]);
    expect(open.actions.transitions.map((t) => t.key)).toContain("answer");

    // The answer is required: it is the Consultant's reply Screen.
    await pickUp(at.k1Manager, id);
    const noAnswer = await tryTake(at.k1Manager, id, "answer");
    expect(noAnswer.statusCode, noAnswer.body).toBe(422);
    await take(at.k1Manager, id, "answer", { answers: { answer: "Plus 150 above the finished floor" } });

    const answered = await detail(at.c1Engineer, id);
    expect(answered.step.key).toBe("answered");
    expect(answered.stage.key).toBe("resolved");
    expect((await history(at.c1Engineer, id)).filter((e) => e.answers).at(-1)!.answers).toEqual({ answer: "Plus 150 above the finished floor" });
    // The asker's Company holds Answered, in its Step Pool: its Member picks it up, then Close, or Ask again; the Consultant, nothing.
    await pickUp(at.c1Engineer, id);
    expect(await offered(at.c1Engineer, id)).toEqual(expect.arrayContaining(["close", "ask_again"]));
    expect(await offered(at.k1Manager, id)).toEqual([]);

    const noReason = await tryTake(at.c1Engineer, id, "ask_again");
    expect(noReason.statusCode, noReason.body).toBe(422);
    await take(at.c1Engineer, id, "ask_again", { reason: "Above which floor, the ground or the first?" });
    const again = await detail(at.k1Manager, id);
    expect(again.step.key).toBe("open");
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
    expect(open.step.key).toBe("open");
    expect(open.actions.pickUp).toBe(true); // In C1's Step Pool.
    expect(await offered(at.k1Manager, id)).toEqual([]);

    await pickUp(at.c1Pm, id);
    await take(at.c1Pm, id, "answer", { answers: { answer: "Behind the ceiling access panel" } });
    expect((await detail(at.k1Manager, id)).step.key).toBe("answered");
    expect(await offered(at.k1Manager, id)).toEqual(expect.arrayContaining(["close", "ask_again"]));
    expect(await offered(at.c1Pm, id)).toEqual([]);

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
    const hidden = async (step: string) => {
      expect((await snags(c2Engineer)).items.map((i) => i.id), step).not.toContain(id);
      await expectHidden(c2Engineer.get(`/v1/work-items/${id}`), step);
      await expectHidden(c2Engineer.get(`/v1/work-items/${id}/history`), step);
      await expectHidden(c2Engineer.get(`/v1/work-items/${id}/links`), step);
    };
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
    expect((await snags(c2Engineer)).stages.reduce((n, s) => n + s.count, 0)).toBe(0);
  });

  it("RP-626-2: C2 sees a Question to Contractor that K1 asked of C1 nowhere either; the Draft stays K1's", async () => {
    const id = await draftQuestion(at.k1Manager, "QSC", "For C1 only");
    await expectHidden(at.c1Pm.get(`/v1/work-items/${id}`), "draft, C1");
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}`), "draft, C2");
    await take(at.k1Manager, id, "ask");
    expect((await detail(at.c1Pm, id)).id).toBe(id);
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}`), "open, C2");
    expect((await snags(c2Engineer)).items.map((i) => i.id)).not.toContain(id);
  });
});

describe("the Rabaed Default Question Workflows and Form", () => {
  it.each(["QSN", "QSC"])("%s's Workflow and the shared Form are the documents `pnpm defaults:publish` publishes, as their latest Versions", async (code) => {
    const definitionId = (await rabaedDefaultWorkflowId(migrator, code))!;
    const latest = (await readLatestPublishedDefinition(migrator, definitionId))!;
    expect(latest.versionNo).toBe(1);
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
