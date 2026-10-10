// Seam 1 for Transition rules at run time (RP-430, WF-7; spec RP-423;
// workflow-engine.md §4, §5.1). Restrict: a Transition isn't offered, and taking
// it is refused like one that isn't there, unless its rule holds: a field value
// picking among Transitions sharing a label, Positions, not the same person,
// has been through a Step or a shared fact, all Comments closed. Validate: the
// Transition is offered, and taking it is refused with its message, in English
// and Arabic, until the rule holds: a condition, the Form complete, a Document.
//
// The Type is test-only, on the test Workflow with rules (addRulesType).
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uploadDocument, type Caller } from "./support/harness.ts";
import { addRulesType } from "./support/rules.ts";
import { all, bilingual, detail, ok, projectMember, take, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "RULED";

let engineer: Caller; // C1 engineer: raises the items.
let pm: Caller; // C1 PM: Submits.
let pm2: Caller;
let k1Engineer: Caller;
let k1Manager: Caller;
let k1Manager2: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";

async function newDraft(by: Caller, model: string, answers: Record<string, unknown> = {}): Promise<string> {
  const res = await ok(
    by.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: electrical, location: buildingA, ...answers } }),
    201,
  );
  return res.json().id as string;
}

const offered = async (by: Caller, id: string) => (await detail(by, id)).actions.transitions.map((t) => t.key);
const pickUp = (by: Caller, id: string) => ok(by.post(`/v1/work-items/${id}/pick-up`));
const returnToPool = (by: Caller, id: string) => ok(by.post(`/v1/work-items/${id}/return-to-pool`));
const pdf = (fieldKey: string | null) => ({
  ...(fieldKey === null ? {} : { fieldKey }),
  fileName: "datasheet.pdf",
  contentType: "application/pdf",
  body: "%PDF-1.7 a datasheet (test)",
});

/** A Draft of the C1 engineer's, at the C1 PM's review. */
async function inReview(model: string, answers: Record<string, unknown> = {}, beforeSending?: (id: string) => Promise<unknown>): Promise<string> {
  const id = await newDraft(engineer, model, answers);
  await beforeSending?.(id);
  await take(engineer, id, "send_for_review");
  await pickUp(pm, id);
  return id;
}

/** An item Submitted to K1, picked up by `holder`. */
async function atConsultant(model: string, holder: Caller, answers: Record<string, unknown> = {}): Promise<string> {
  const id = await inReview(model, answers);
  await take(pm, id, "submit");
  await pickUp(holder, id);
  return id;
}

/** An item K1's `sender` sent to the Manager, picked up by `holder`. */
async function atApproval(model: string, sender: Caller, holder: Caller, answers: Record<string, unknown> = {}): Promise<string> {
  const id = await atConsultant(model, sender, answers);
  await take(sender, id, "send_to_manager");
  await pickUp(holder, id);
  return id;
}

/** Refused with the Validate rule's message, in English and Arabic. */
async function expectRefusedWith(response: ReturnType<typeof tryTake>, message: { en: string; ar: string }) {
  const res = await response;
  expect(res.statusCode, res.body).toBe(422);
  expect(res.json()).toEqual({ error: "validation_failed", message });
}

/** Refused exactly like a Transition that isn't there. */
async function expectNotAvailable(response: ReturnType<typeof tryTake>) {
  const res = await response;
  expect(res.statusCode, res.body).toBe(409);
  expect(res.json()).toEqual({ error: "transition_not_available" });
}

beforeAll(async () => {
  await addRulesType(migrator, TYPE);
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  pm2 = await projectMember(api, c1, own, ["project_manager"]);
  const k1 = await api.authorizedPerson();
  const k1Participant = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  k1Engineer = await projectMember(api, k1, k1Participant, ["engineer"]);
  k1Manager = await projectMember(api, k1, k1Participant, ["manager"]);
  k1Manager2 = await projectMember(api, k1, k1Participant, ["manager"]);
});

describe("Restrict: a field value picks among Transitions sharing a label", () => {
  it("offers one Send to Manager, and the cost impact decides where it goes", async () => {
    const small = await atConsultant("Small cost", k1Engineer, { cost: 100_000 });
    const sends = (await detail(k1Engineer, small)).actions.transitions.filter((t) => t.label.en === "Send to Manager");
    expect(sends).toEqual([expect.objectContaining({ label: { en: "Send to Manager", ar: "إرسال للمدير" } })]);
    await take(k1Engineer, small, sends[0]!.key);
    expect((await detail(k1Engineer, small)).step.key).toBe("consultant_approval");

    const big = await atConsultant("Big cost", k1Engineer, { cost: 750_000 });
    await take(k1Engineer, big, sends[0]!.key);
    expect((await detail(k1Engineer, big)).step.key).toBe("senior_approval");
  });

  it("routes whichever of the label's keys is asked for", async () => {
    const big = await atConsultant("Big cost, other key", k1Engineer, { cost: 750_000 });
    await take(k1Engineer, big, "send_to_manager");
    expect((await detail(k1Engineer, big)).step.key).toBe("senior_approval");
  });
});

describe("Restrict: who may take it, by Position", () => {
  it("offers Send Back to a K1 manager, never to a K1 engineer", async () => {
    const id = await atConsultant("Positions", k1Engineer);
    expect(await offered(k1Engineer, id)).not.toContain("send_back");
    await expectNotAvailable(tryTake(k1Engineer, id, "send_back"));
    await returnToPool(k1Engineer, id);
    await pickUp(k1Manager, id);
    expect(await offered(k1Manager, id)).toContain("send_back");
    await take(k1Manager, id, "send_back");
  });
});

describe("Restrict: not the same person", () => {
  it("hides Approve from the manager who sent it to the Manager; another manager approves", async () => {
    const id = await atApproval("Separation", k1Manager, k1Manager);
    expect(await offered(k1Manager, id)).not.toContain("approve_a");
    await expectNotAvailable(tryTake(k1Manager, id, "approve_a"));
    await returnToPool(k1Manager, id);
    await pickUp(k1Manager2, id);
    expect(await offered(k1Manager2, id)).toContain("approve_a");
    await take(k1Manager2, id, "approve_a");
  });

  it("hides the second-pair-of-eyes Submit from the PM who left the Draft", async () => {
    const id = await newDraft(pm, "Second pair of eyes");
    await take(pm, id, "send_for_review");
    await pickUp(pm, id);
    expect(await offered(pm, id)).not.toContain("submit_separate");
    await returnToPool(pm, id);
    await pickUp(pm2, id);
    await take(pm2, id, "submit_separate");
  });
});

describe("Restrict: not the same person keeps that Member from holding the next Step", () => {
  /** At K1's review again, held by its engineer: K1's manager sent it to the Manager, `returner` returned it. */
  async function backAtReview(model: string, returner: Caller): Promise<string> {
    const id = await atApproval(model, k1Manager, returner);
    await take(returner, id, "return_to_engineer");
    // Back with the manager who held the review; handed on to K1's engineer.
    await returnToPool(k1Manager, id);
    await pickUp(k1Engineer, id);
    return id;
  }

  it("leaves the manager who sent it to the Manager out of the next Step's pool and of Assign to", async () => {
    const id = await backAtReview("Fresh eyes", k1Manager);
    const fresh = (await detail(k1Engineer, id)).actions.transitions.find((t) => t.key === "fresh_eyes");
    // The other manager only.
    expect(fresh?.assignTo).toHaveLength(1);
    await take(k1Engineer, id, "fresh_eyes");
    // Without them the pool has one Member, who holds it at once (§3.3 rule 4).
    expect((await detail(k1Manager2, id)).heldBy?.memberName).not.toBeNull();
    expect((await detail(k1Manager2, id)).actions.returnToPool).toBe(false);
    const refused = await k1Manager.post(`/v1/work-items/${id}/pick-up`);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toEqual({ error: "already_picked_up" });
  });

  it("refuses with the usual answer when nobody is left to hold the next Step", async () => {
    const id = await backAtReview("No fresh eyes", k1Manager2);
    expect(await offered(k1Engineer, id)).not.toContain("fresh_eyes");
    const res = await tryTake(k1Engineer, id, "fresh_eyes");
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toEqual({ error: "next_step_unavailable" });
  });
});

describe("Restrict: has been through a Step, or a shared fact", () => {
  it("offers Submit directly from the Draft only once it has been through Contractor review", async () => {
    const id = await newDraft(pm, "Been through");
    expect(await offered(pm, id)).not.toContain("submit_direct");
    await expectNotAvailable(tryTake(pm, id, "submit_direct"));
    await take(pm, id, "send_for_review");
    await pickUp(pm2, id);
    await take(pm2, id, "return");
    expect(await offered(pm, id)).toContain("submit_direct");
    await take(pm, id, "submit_direct");
  });

  it("offers Resubmit only after a Send Back", async () => {
    const id = await inReview("Resubmit");
    expect(await offered(pm, id)).not.toContain("resubmit");
    await take(pm, id, "submit");
    await pickUp(k1Manager, id);
    await take(k1Manager, id, "send_back");
    expect(await offered(pm, id)).toContain("resubmit");
    await take(pm, id, "resubmit");
  });

  it("offers Submit Revision only on a Revision", async () => {
    const id = await atApproval("Revised", k1Engineer, k1Manager, { cost: 10 });
    expect(await offered(pm, (await inReview("Not a Revision")))).not.toContain("submit_revision");
    await take(k1Manager, id, "revise_c", { remarks: "Use the other cable." });
    const revision = (await ok(engineer.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id as string;
    await take(engineer, revision, "send_for_review");
    await pickUp(pm, revision);
    expect(await offered(pm, revision)).toContain("submit_revision");
    await take(pm, revision, "submit_revision");
  });
});

describe("Restrict: all Comments closed", () => {
  it("hides Reject while a Comment raised from the item is open", async () => {
    const id = await atApproval("Commented", k1Engineer, k1Manager);
    expect(await offered(k1Manager, id)).toContain("reject_d");
    const comment = await atConsultant("Comment", k1Engineer);
    await sql`insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id)
      select project_id, ${comment}::uuid, id, 'raised_from', created_by_member_id from work_item where id = ${id}::uuid`.execute(migrator);
    expect(await offered(k1Manager, id)).not.toContain("reject_d");
    await expectNotAvailable(tryTake(k1Manager, id, "reject_d"));
    // Closed, it no longer holds the item back.
    await take(k1Engineer, comment, "send_to_manager");
    await pickUp(k1Manager2, comment);
    await take(k1Manager2, comment, "approve_a");
    expect(await offered(k1Manager, id)).toContain("reject_d");
    await take(k1Manager, id, "reject_d");
  });
});

describe("Validate: a condition", () => {
  const costMessage = { en: "Enter the cost impact before you submit.", ar: "أدخل الأثر المالي قبل التقديم." };

  it("on the Form: refuses Submit with cost until the cost impact is given", async () => {
    const id = await inReview("No cost");
    expect(await offered(pm, id)).toContain("submit_costed");
    await expectRefusedWith(tryTake(pm, id, "submit_costed"), costMessage);
    const costed = await inReview("Costed", { cost: 12_000 });
    await take(pm, costed, "submit_costed");
  });

  it("on the Action Form: refuses Code C without Remarks", async () => {
    const id = await atApproval("Code C", k1Engineer, k1Manager);
    await expectRefusedWith(tryTake(k1Manager, id, "revise_c", { remarks: "" }), {
      en: "Write the Remarks for Code C.",
      ar: "اكتب ملاحظات الرمز C.",
    });
    await take(k1Manager, id, "revise_c", { remarks: "Use the other cable." });
  });
});

describe("Validate: the Form complete", () => {
  it("refuses Escalate until the verdict a cost impact over 1,000,000 requires is given", async () => {
    const id = await atConsultant("Verdict", k1Engineer, { cost: 2_000_000 });
    const incomplete = { en: "Complete the Form before you take this step.", ar: "أكمل النموذج قبل اتخاذ هذه الخطوة." };
    expect(await offered(k1Engineer, id)).toContain("escalate");
    await expectRefusedWith(tryTake(k1Engineer, id, "escalate"), incomplete);
    await take(k1Engineer, id, "send_to_manager");
    await pickUp(k1Manager, id);
    expect((await detail(k1Manager, id)).step.key).toBe("senior_approval");
    const answers = (await detail(k1Manager, id)).answers;
    await ok(k1Manager.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...answers, verdict: "Fit for use" } }));
    await take(k1Manager, id, "return_from_senior");
    await take(k1Engineer, id, "escalate");
  });
});

describe("Validate: a Document", () => {
  it("in the named field: refuses Submit with Datasheet until a file is in it", async () => {
    const id = await inReview("No datasheet");
    await expectRefusedWith(tryTake(pm, id, "submit_documented"), {
      en: "Add at least one Document to Datasheet first.",
      ar: "أضف مستندًا واحدًا على الأقل إلى نشرة البيانات أولًا.",
    });
    const documented = await inReview("Datasheet", {}, (draft) => uploadDocument(engineer, draft, pdf("datasheet")));
    await take(pm, documented, "submit_documented");
  });

  it("anywhere on the item: refuses Submit with a Document until it has one", async () => {
    const id = await inReview("No Document");
    await expectRefusedWith(tryTake(pm, id, "submit_any_document"), {
      en: "Add at least one Document first.",
      ar: "أضف مستندًا واحدًا على الأقل أولًا.",
    });
    const documented = await inReview("A Document", {}, (draft) => uploadDocument(engineer, draft, pdf(null)));
    await take(pm, documented, "submit_any_document");
  });
});
