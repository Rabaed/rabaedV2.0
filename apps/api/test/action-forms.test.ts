// Seam 1: Action Forms built from Form schemas (RP-300, spec RP-299;
// form-engine.md §4 "Settled 2026-10-05 (part 3)"; workflow-engine.md §1
// check 7, §5.1; visibility.md V5). Each Transition's pop-up is a Form schema on
// the Workflow: the API offers it with the Transition, validates the answers
// against it, and stores them in the Transition's event. MAR Workflow Version 1
// asks exactly what it did before: a reason on the Return, nothing elsewhere,
// and an Internal Note under every pop-up that stays inside the writer's Company.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { workflowActionFormProblems, type WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller, type OnboardedCompany } from "./support/harness.ts";
import { detail, projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

type Company = { company: OnboardedCompany; caller: Caller };

let c1: Company;
let c1ParticipantId = "";
let engineer: Caller;
let pm: Caller;
let k1Manager: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

async function ok(res: Promise<{ statusCode: number; body: string }>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
}

async function createDraft(title: string): Promise<string> {
  const res = await engineer.post(`/v1/projects/${projectId}/work-items`, {
    type: "MAR",
    title,
    answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: electrical, location: buildingA },
  });
  expect(res.statusCode, res.body).toBe(201);
  await attachDatasheet(engineer, res.json().id);
  return res.json().id;
}

async function history(by: Caller, id: string): Promise<WorkItemHistory["events"]> {
  const res = await by.get(`/v1/work-items/${id}/history`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().events;
}

/** An item sent for review and picked up by the PM, at Internal Review. */
async function atInternalReview(title: string) {
  const id = await createDraft(title);
  await ok(tryTake(engineer, id, "send_for_review"));
  await ok(pm.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

const returnForm = {
  sections: [
    {
      key: "return",
      title: { en: "Return", ar: "إعادة" },
      fields: [
        {
          key: "reason",
          type: "textarea",
          required: true,
          maxLength: 2000,
          label: { en: "Reason", ar: "السبب" },
          help: { en: "Only your Company sees this.", ar: "لا يراه إلا شركتك." },
        },
      ],
    },
  ],
};

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })).json()
    .id;
  c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, c1ParticipantId, ["engineer"]);
  pm = await projectMember(api, c1, c1ParticipantId, ["project_manager"]);
  const k1 = await api.authorizedPerson();
  const k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  k1Manager = await projectMember(api, k1, k1ParticipantId, ["manager"]);
});

describe("publish check 7", () => {
  it("passes every published Workflow Version: each Action Form is a valid Form schema", async () => {
    const { rows } = await sql<{ key: string; actionForm: unknown }>`
      select v.id || '/' || tr.key as key, tr.action_form as "actionForm"
      from workflow_transition tr join workflow_version v on v.id = tr.workflow_version_id
      where v.status = 'published'
      order by v.id, tr.sort
    `.execute(migrator);
    const lists = await sql<{ id: string }>`select id from option_list`.execute(migrator);
    expect(rows.length).toBeGreaterThan(0);
    expect(workflowActionFormProblems(rows, { optionListIds: new Set(lists.rows.map((l) => l.id)) })).toEqual([]);
  });
});

describe("MAR Workflow Version 1's Action Forms", () => {
  it("offers the Return with its reason as a required textarea, and the other Transitions with none", async () => {
    const draft = await createDraft("Offered");
    expect((await detail(engineer, draft)).actions.transitions).toEqual([
      { key: "send_for_review", label: { en: "Send for Review", ar: "إرسال للمراجعة" }, kind: "send", actionForm: null },
    ]);
    const id = await atInternalReview("Offered at review");
    const transitions = (await detail(pm, id)).actions.transitions;
    expect(transitions.find((t) => t.key === "return")?.actionForm).toEqual(returnForm);
    expect(transitions.find((t) => t.key === "submit")?.actionForm).toBeNull();
  });
});

describe("taking a Transition with its Action Form", () => {
  it("stores the answers in the Transition's event, where the history reads the reason", async () => {
    const id = await atInternalReview("Answered");
    await ok(tryTake(pm, id, "return", { answers: { reason: "Wrong tray size" } }));
    const events = await history(engineer, id);
    expect(events.at(-1)).toMatchObject({ type: "transition", transition: { en: "Return" }, reason: "Wrong tray size" });
    const { rows } = await sql<{ payload: unknown }>`
      select payload from work_item_event where work_item_id = ${id}::uuid order by seq desc limit 1
    `.execute(migrator);
    expect(rows[0]!.payload).toEqual({ reason: "Wrong tray size" });
  });

  it("refuses a Return without its reason, naming the field, and moves nothing", async () => {
    const id = await atInternalReview("No reason");
    for (const answers of [undefined, {}, { reason: "   " }]) {
      const res = await tryTake(pm, id, "return", { answers });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toEqual({ error: "invalid_action_form", fields: [{ key: "reason", code: "required" }] });
    }
    expect((await detail(pm, id)).stage.key).toBe("internal_review");
  });

  it("refuses answers the Action Form doesn't ask for, or of the wrong kind", async () => {
    const id = await atInternalReview("Unknown answers");
    expect((await tryTake(pm, id, "return", { answers: { reason: "Fine", remarks: "Not asked" } })).json()).toEqual({
      error: "invalid_action_form",
      fields: [{ key: "remarks", code: "unknown_field" }],
    });
    expect((await tryTake(pm, id, "return", { answers: { reason: 42 } })).json()).toEqual({
      error: "invalid_action_form",
      fields: [{ key: "reason", code: "wrong_type" }],
    });
    expect((await tryTake(pm, id, "return", { answers: { reason: "x".repeat(2001) } })).json()).toEqual({
      error: "invalid_action_form",
      fields: [{ key: "reason", code: "too_long" }],
    });
    // A Transition with no Action Form takes no answers.
    expect((await tryTake(pm, id, "submit", { answers: { reason: "Not asked" } })).json()).toEqual({
      error: "invalid_action_form",
      fields: [{ key: "reason", code: "unknown_field" }],
    });
    expect((await detail(pm, id)).stage.key).toBe("internal_review");
  });

  it("tells someone who can't take the Transition only that, never what its Action Form lacks", async () => {
    const id = await atInternalReview("Not theirs");
    const res = await tryTake(engineer, id, "return", { answers: {} });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toEqual({ error: "not_holder" });
    await expectHidden(tryTake(k1Manager, id, "return", { answers: {} }));
  });

  it("keeps the Internal Note out of the shared payload, as its own internal event (V5, scenario 34)", async () => {
    const id = await atInternalReview("Noted");
    await ok(tryTake(pm, id, "submit", { internalNote: "Checked against the drawings" }));
    const { rows } = await sql<{ type: string; audience: string; payload: Record<string, unknown> }>`
      select type, audience, payload from work_item_event where work_item_id = ${id}::uuid order by seq desc limit 2
    `.execute(migrator);
    expect(rows.map((r) => [r.type, r.audience])).toEqual([
      ["transition", "shared"],
      ["internal_note", "internal"],
    ]);
    expect(rows[0]!.payload).not.toHaveProperty("internal_note");
    expect((await history(k1Manager, id)).some((e) => e.internalNote !== null)).toBe(false);
  });
});
