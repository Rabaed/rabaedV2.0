// Seam 1 for the Rabaed Default WIR Workflow Version 2 (RP-170, spec RP-649; workflow-engine.md
// §1 "Rabaed Default documents", §5.3; visibility.md V5, scenario RP-170-1), which is the
// submittal shape: Draft → Contractor PM (Return to Contractor Engineer) → Submit (Cover Note) →
// Consultant Engineer, who Sends to Manager with a Recommended Result and an Internal Note →
// Consultant Manager, who may Return to Engineer or issue Passed, Passed with Comments or Failed.
// A WIR already on Version 1 (one Consultant inspection Step) finishes on Version 1.
//
// Since RP-673 (ADR 0025) a new WIR starts on Version 3, which issues Review Codes
// (wir-workflow-v3.test.ts): each WIR here is pinned to Version 2 when it is raised, as one
// started on it before, and its Stages are the Submittals' keys the migration moved them to.
//
// The seam suites' global setup runs the demo seed, which publishes the Rabaed Defaults.
import { publishRabaedDefaults, rabaedWorkflowFile, sameDefinition } from "@rabaed/admin/services";
import { createDb, readPublishedVersionDefinition, withMember } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import { parseWorkflowDefinition, type WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_ENGINEER_EMAIL } from "../src/demo/seed.ts";
import { checklistTemplate } from "./support/checklist-template.ts";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { pinToWorkflowVersion } from "./support/pin-version.ts";
import { all, bilingual, detail, memberOnProject, ok, tryTake, take, type Company } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
const appDb = createDb(testDatabaseUrls().app, { max: 2 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
  await appDb.destroy();
});

let projectId = "";
let electrical = "";
let buildingA = "";
let wirChecklist = ""; // A Checklist Template of the Project's, for Electrical: the WIR Form Version 3 asks for one (RP-651).
let hafiz: Caller; // C1 Contractor Engineer: the author.
let ali: Caller; // C1's only Project Manager: holds Contractor PM at once.
let ahmed: { id: string; caller: Caller }; // K1 Consultant Engineer.
let mohammed: { id: string; caller: Caller }; // K1's only Manager: holds Consultant Manager at once.
let faisal: Caller; // O1, Owner Representative: oversight.
let yousef: { id: string; caller: Caller }; // C2, a second Contractor covering Mechanical only.
let hafizId = "";
let aliId = "";

const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> =>
  ((await ok(by.get(`/v1/work-items/${id}/history`), 200)).json() as WorkItemHistory).events;
const transitionKeys = async (by: Caller, id: string) => (await detail(by, id)).actions.transitions.map((t) => t.key).sort();

const RECOMMENDATION_NOTE = "Engineer: rebar spacing out of tolerance at gridline 4";

/** A WIR raised by Hafiz on Version 2 and sent for review. */
async function inReview(title: string) {
  const id = (
    await ok(
      hafiz.post(`/v1/projects/${projectId}/work-items`, {
        type: "WIR",
        title,
        // The WIR Form Version 2 asks when the work is ready (RP-82); Version 3 for its Checklist Template (RP-651).
        answers: {
          description: "Slab rebar, Level 2",
          requested_for: "2026-11-02T05:30:00.000Z",
          trade: electrical,
          location: buildingA,
          checklist_template: wirChecklist,
        },
      }),
      201,
    )
  ).json().id as string;
  await pinToWorkflowVersion(migrator, "WIR", 2, id);
  await take(hafiz, id, "send_for_review");
  return id;
}

/** Submitted by Ali to K1: Ahmed, K1's only Engineer, holds the Consultant Engineer Step at once (ADR 0018). */
async function submitted(title: string) {
  const id = await inReview(title);
  await take(ali, id, "submit", { answers: { cover_note: "Ready on site from 09:00" } });
  return id;
}

/** Ahmed Sends to Manager recommending Failed; Mohammed, K1's only Manager, holds the Consultant Manager Step at once. */
const sentToManager = async (id: string, recommendedCode = "failed") =>
  take(ahmed.caller, id, "send_to_manager", { recommendedCode, internalNote: RECOMMENDATION_NOTE });

async function atManager(title: string) {
  const id = await submitted(title);
  await sentToManager(id);
  return id;
}

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const o1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "WV2" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  wirChecklist = await checklistTemplate(c1.caller, projectId, electrical);
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  const participant = async (company: Company, role: "consultant" | "owner_representative" | "contractor") => {
    const id = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
    return id;
  };
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await participant(k1, "consultant");
  const o1ParticipantId = await participant(o1, "owner_representative");
  const c2ParticipantId = await participant(c2, "contractor");
  // C2 covers Mechanical only, and never sees C1's Electrical items (V3).
  const mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: { isAll: false, valueIds: [mechanical] }, location: all }));
  const hafizMember = await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" });
  const aliMember = await memberOnProject(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  [hafiz, ali, hafizId, aliId] = [hafizMember.caller, aliMember.caller, hafizMember.id, aliMember.id];
  ahmed = await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  mohammed = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Mohammed Al Shamsi" });
  faisal = (await memberOnProject(api, o1, o1ParticipantId, ["engineer"], { name: "Faisal Al Otaibi" })).caller;
  yousef = await memberOnProject(api, c2, c2ParticipantId, ["engineer"], { name: "Yousef Karim" });
});

describe("the WIR Workflow Version 2 is the document `pnpm defaults:publish` publishes", () => {
  it("apps/admin/workflows/WIR-2.json is Version 2, published beside Version 1 for the items pinned to them (Version 3 is WIR-3.json, RP-673; Version 4 WIR.json, RP-86)", async () => {
    const definitionId = (
      await migrator.selectFrom("work_item_type").select("workflow_definition_id").where("owner_kind", "=", "rabaed").where("code", "=", "WIR").executeTakeFirstOrThrow()
    ).workflow_definition_id!;
    const version2 = await sql<{ id: string }>`
      select id from workflow_version where workflow_definition_id = ${definitionId}::uuid and version_no = 2
    `.execute(migrator);
    const stored = (await readPublishedVersionDefinition(migrator, version2.rows[0]!.id))!;
    const file = parseWorkflowDefinition(rabaedWorkflowFile("WIR-2.json"));
    expect(file.ok && sameDefinition(stored, file.definition)).toBe(true);
    expect(stored.steps.map((s) => s.key)).toEqual([
      "draft",
      "internal_review",
      "contractor_engineer",
      "consultant_engineer",
      "consultant_manager",
      "passed",
      "failed",
      "cancelled",
    ]);
    const versions = await sql<{ version_no: number; status: string }>`
      select v.version_no, v.status from workflow_version v where v.workflow_definition_id = ${definitionId}::uuid order by v.version_no
    `.execute(migrator);
    expect(versions.rows.map((v) => [v.version_no, v.status])).toEqual([
      [1, "published"],
      [2, "published"],
      [3, "published"],
      [4, "published"],
    ]);
  });
});

describe("a WIR on Version 2 (seam 1 acceptance)", () => {
  it("goes Draft → Contractor PM → Return → Contractor Engineer → PM → Submit, on Version 2", async () => {
    const id = await inReview("Returned");
    expect(await detail(ali, id)).toMatchObject({ stage: { key: "internal_review" }, workflow: { versionNo: 2 } });
    await take(ali, id, "return", { reason: "Add the drawing reference" });
    const returned = await detail(hafiz, id);
    expect(returned).toMatchObject({ stage: { key: "internal_review" }, step: { key: "contractor_engineer" } });
    expect(returned.actions.transitions.map((t) => t.key).sort()).toEqual(["cancel_engineer", "send_for_review_again"]);
    await take(hafiz, id, "send_for_review_again");
    await take(ali, id, "submit", { answers: { cover_note: "Drawing E-201 attached" } });
    expect(await detail(ahmed.caller, id)).toMatchObject({ stage: { key: "pending_approval" }, step: { key: "consultant_engineer" } });
  });

  it("the Consultant Engineer Step's pool is the Consultant's Engineers only, so its Engineer holds it at once and the Manager doesn't", async () => {
    const id = await submitted("Pool of one");
    expect((await detail(ahmed.caller, id)).heldBy?.memberName?.en).toBe("Ahmed bin Said");
    expect((await detail(mohammed.caller, id)).actions).toMatchObject({ pickUp: false, transitions: [] });
    expect(await transitionKeys(ahmed.caller, id)).toEqual(["send_to_manager"]);
  });

  it("Send to Manager recommends one of the Inspection Results only, and the Manager holds the Step at once with Return to Engineer and the three Results", async () => {
    const id = await submitted("Recommended");
    for (const code of ["A", "cancelled", "Z"]) {
      const refused = await tryTake(ahmed.caller, id, "send_to_manager", { recommendedCode: code });
      expect(refused.statusCode, `${code}: ${refused.body}`).toBe(422);
      expect(refused.json()).toMatchObject({ error: "recommended_code_not_offered" });
    }
    await sentToManager(id, "failed");
    expect(await detail(mohammed.caller, id)).toMatchObject({ stage: { key: "pending_approval" }, step: { key: "consultant_manager" } });
    expect((await detail(mohammed.caller, id)).heldBy?.memberName?.en).toBe("Mohammed Al Shamsi");
    expect(await transitionKeys(mohammed.caller, id)).toEqual(["fail", "pass", "pass_with_comments", "return_to_engineer"]);
    // The Engineer no longer holds it, and the Contractor holds nothing of it.
    expect(await transitionKeys(ahmed.caller, id)).toEqual([]); // not hidden-from: holds no Step, so takes nothing
    for (const who of [hafiz, ali]) expect(await transitionKeys(who, id)).toEqual([]); // not hidden-from: holds no Step, so takes nothing
  });

  it("the Manager Returns to the Engineer with a reason, who Sends to Manager again", async () => {
    const id = await atManager("Returned to the Engineer");
    const noReason = await tryTake(mohammed.caller, id, "return_to_engineer");
    expect(noReason.statusCode, noReason.body).toBe(422);
    await take(mohammed.caller, id, "return_to_engineer", { reason: "Photograph the cover at gridline 4" });
    expect(await detail(ahmed.caller, id)).toMatchObject({ stage: { key: "pending_approval" }, step: { key: "consultant_engineer" } });
    expect((await detail(ahmed.caller, id)).heldBy?.memberName?.en).toBe("Ahmed bin Said");
    expect(await transitionKeys(mohammed.caller, id)).toEqual([]); // not hidden-from: holds no Step, so takes nothing
    await sentToManager(id, "passed");
    expect(await detail(mohammed.caller, id)).toMatchObject({ step: { key: "consultant_manager" } });
  });

  /** Sent to the Manager, Returned, and Sent again: the path the issue's seam 1 takes to each Result. */
  async function returnedAndSentAgain(title: string) {
    const id = await atManager(title);
    await take(mohammed.caller, id, "return_to_engineer", { reason: "Photograph the cover at gridline 4" });
    await sentToManager(id, "failed");
    return id;
  }

  it("Passed closes the WIR Passed, with no Revision offered", async () => {
    const id = await returnedAndSentAgain("Rebar Level 2");
    await take(mohammed.caller, id, "pass", { remarks: "Accepted" });
    expect(await detail(hafiz, id)).toMatchObject({ stage: { key: "approved" }, outcome: "passed", actions: { createRevision: false } });
  });

  it("Passed with Comments makes each row of its table a Comment for the Contractor", async () => {
    const id = await returnedAndSentAgain("Rebar Level 3");
    const none = await tryTake(mohammed.caller, id, "pass_with_comments", { remarks: "See the Comments" });
    expect(none.statusCode, none.body).toBe(422);
    await take(mohammed.caller, id, "pass_with_comments", {
      answers: { remarks: "Fix the cover", items_to_create: [{ comment: "Raise the cover to 40 mm" }, { comment: "Tie the lap at gridline 4" }] },
    });
    expect(await detail(hafiz, id)).toMatchObject({ stage: { key: "approved" }, outcome: "passed_with_comments", raisedItems: [{ type: { code: "CMT" }, open: 2, closed: 0 }] });
  });

  it("Failed closes the WIR Failed and offers the Contractor a Revision, the re-inspection", async () => {
    const id = await returnedAndSentAgain("Rebar Level 4");
    const none = await tryTake(mohammed.caller, id, "fail");
    expect(none.statusCode, none.body).toBe(422);
    await take(mohammed.caller, id, "fail", { remarks: "Spacing out of tolerance" });
    expect(await detail(hafiz, id)).toMatchObject({ stage: { key: "revise_resubmit" }, outcome: "failed", actions: { createRevision: true } });
    expect((await detail(mohammed.caller, id)).actions.createRevision).toBe(false);
  });

  it("is Cancelled from the Contractor's Steps until the Submit, never after it", async () => {
    const draft = (
      await ok(hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "WIR", title: "Cancel from Draft", answers: { trade: electrical, location: buildingA } }), 201)
    ).json().id as string;
    expect(await transitionKeys(hafiz, draft)).toContain("cancel");
    const review = await inReview("Cancel from review");
    expect(await transitionKeys(ali, review)).toContain("cancel_review");
    await take(ali, review, "cancel_review");
    expect(await detail(hafiz, review)).toMatchObject({ stage: { key: "cancelled" } });
    const inspected = await submitted("No Cancel after Submit");
    for (const who of [hafiz, ali, ahmed.caller, mohammed.caller]) {
      expect((await transitionKeys(who, inspected)).filter((k) => k.startsWith("cancel"))).toEqual([]); // not hidden-from: no Cancel is offered after the Submit
    }
  });
});

describe("a WIR on Version 1 finishes on Version 1 (the Workflow Version it pinned)", () => {
  it("is Submitted to the one Consultant inspection Step and closed by its Result there; publishing again moves nothing", async () => {
    const id = await inReview("In flight on Version 1");
    await pinToWorkflowVersion(migrator, "WIR", 1, id);
    expect(await detail(ali, id)).toMatchObject({ stage: { key: "internal_review" }, workflow: { versionNo: 1 } });
    await take(ali, id, "submit", { answers: { cover_note: "Ready on site" } });
    expect(await detail(ahmed.caller, id)).toMatchObject({ stage: { key: "pending_approval" }, step: { key: "consultant_inspection" }, workflow: { versionNo: 1 } });

    const engineer = await migrator.selectFrom("rabaed_engineer").select("id").where("email", "=", DEMO_ENGINEER_EMAIL).executeTakeFirstOrThrow();
    const again = await publishRabaedDefaults(migrator, { engineerId: engineer.id, reason: "RP-170 test: nothing to publish" });
    expect(again.ok && again.done.filter((d) => d.published)).toEqual([]); // not hidden-from: nothing to publish
    expect(again.ok && again.moved.map((m) => m.type)).not.toContain("WIR"); // not hidden-from: no WIR moved
    expect(await detail(ahmed.caller, id)).toMatchObject({ step: { key: "consultant_inspection" }, workflow: { versionNo: 1 } });

    await ok(ahmed.caller.post(`/v1/work-items/${id}/pick-up`));
    expect(await transitionKeys(ahmed.caller, id)).toEqual(["fail", "pass", "pass_with_comments"]);
    await take(ahmed.caller, id, "pass", { remarks: "Accepted" });
    expect(await detail(hafiz, id)).toMatchObject({ stage: { key: "approved" }, outcome: "passed", workflow: { versionNo: 1 } });
  });
});

// Scenario RP-170-1 (visibility.md): the Consultant Engineer's Recommended Result and Internal
// Note stay inside the Consultant (V5), before and after the Result; another Contractor reads
// nothing of the WIR (V3).
describe("RP-170-1: who reads the Consultant Engineer's Recommended Result of a WIR on Version 2", () => {
  let id = "";
  /** What `as` reads of the item's events through row-level security, as the app role. */
  const eventsAs = (as: string) =>
    withMember(appDb, as, (trx) =>
      sql<{ id: string; type: string; payload: unknown }>`select id, type, payload from work_item_event where work_item_id = ${id}::uuid order by seq`.execute(trx).then((r) => r.rows),
    );
  /** As the app role: the item's events whose row holds the Internal Note. */
  const noteRowsAs = async (as: string) => (await eventsAs(as)).filter((e) => JSON.stringify(e.payload).includes(RECOMMENDATION_NOTE));
  /** [the note] when `by`'s history of the item holds it (an event's `seq` counts only what its reader sees, so the note's own text is the key). */
  const noteInHistory = async (by: Caller) =>
    (await readById<WorkItemHistory>(`/v1/work-items/${id}/history`)(by)).filter((h) => JSON.stringify(h).includes(RECOMMENDATION_NOTE)).map(() => ({ id: RECOMMENDATION_NOTE }));
  /** The id of the item's event the migrator reads under `where`. */
  const eventId = async (where: string) =>
    (await sql<{ id: string }>`select id from work_item_event where work_item_id = ${id}::uuid and ${sql.raw(where)} order by seq desc limit 1`.execute(migrator)).rows[0]!.id;
  const names = new Map<string | Caller, string>();
  const named = (who: string | Caller) => names.get(who) ?? "someone";

  beforeAll(async () => {
    id = await submitted("Visibility");
    const known: [string | Caller, string][] = [
      [hafiz, "Hafiz (C1)"], [hafizId, "Hafiz (C1)"], [ali, "Ali (C1)"], [aliId, "Ali (C1)"], [faisal, "Faisal (O1)"],
      [ahmed.caller, "Ahmed (K1)"], [ahmed.id, "Ahmed (K1)"], [mohammed.caller, "Mohammed (K1)"], [mohammed.id, "Mohammed (K1)"],
      [yousef.caller, "Yousef (C2)"], [yousef.id, "Yousef (C2)"],
    ];
    for (const [who, name] of known) names.set(who, name);
  });

  it("the Contractor and oversight read nothing of it, before or after the Result; the Consultant reads it", async () => {
    const before = { hafiz: await history(hafiz, id), ali: await history(ali, id), faisal: await history(faisal, id) };
    await sentToManager(id, "failed");
    // Internal to K1: the Engineer's and the Manager's history carries the recommendation and the note.
    for (const who of [ahmed.caller, mohammed.caller]) {
      const events = await history(who, id);
      expect(events.find((e) => e.type === "recommend_code")).toMatchObject({ audience: "internal", recommendedCode: "failed" });
      expect(JSON.stringify(events)).toContain(RECOMMENDATION_NOTE);
    }
    expect(await history(hafiz, id)).toEqual(before.hafiz);
    expect(await history(ali, id)).toEqual(before.ali);
    expect(await history(faisal, id)).toEqual(before.faisal);
    // Stored internal to K1's Participant.
    const { rows } = await sql<{ audience: string }>`
      select e.audience from work_item_event e where e.work_item_id = ${id}::uuid and e.type = 'recommend_code'
    `.execute(migrator);
    expect(rows).toEqual([{ audience: "internal" }]);

    await take(mohammed.caller, id, "pass_with_comments", { answers: { remarks: "Accepted with a Comment", items_to_create: [{ comment: "Label the sleeves" }] } });
    for (const who of [hafiz, ali, faisal]) {
      const events = await history(who, id);
      expect(events.some((e) => e.type === "recommend_code")).toBe(false);
      expect(events.map((e) => e.recommendedCode ?? null)).toEqual(events.map(() => null));
      expect(events.at(-1)).toMatchObject({ outcome: "passed_with_comments" });
    }
    await expectHiddenFrom({ read: noteInHistory, target: RECOMMENDATION_NOTE, seenBy: [ahmed.caller, mohammed.caller], hiddenFrom: [hafiz, ali, faisal], name: named, label: "after the Result" });
  });

  it("as the app role, the event rows of the Recommended Result and the Internal Note are K1's alone", async () => {
    const [seenBy, hiddenFrom] = [[ahmed.id, mohammed.id], [hafizId, aliId]];
    await expectHiddenFrom({ read: eventsAs, target: await eventId("type = 'recommend_code'"), seenBy, hiddenFrom, name: named, label: "the Recommended Result's row" });
    const noteRow = await eventId(`payload::text like '%${RECOMMENDATION_NOTE}%'`);
    await expectHiddenFrom({ read: noteRowsAs, target: noteRow, seenBy, hiddenFrom, name: named, label: "the Internal Note's row" });
  });

  it("another Contractor, C2, who doesn't cover the trade, reads nothing of the WIR: no item, history, events or actions", async () => {
    const seenBy = [hafiz, mohammed.caller];
    await expectHiddenFrom({ read: readById(`/v1/work-items/${id}`), target: id, seenBy, hiddenFrom: yousef.caller, name: named, label: "the item" });
    const historyRead = async (by: Caller) => (await readById<WorkItemHistory>(`/v1/work-items/${id}/history`)(by)).map(() => ({ id }));
    await expectHiddenFrom({ read: historyRead, target: id, seenBy, hiddenFrom: yousef.caller, name: named, label: "its history" });
    // The Result, shared: C1 and K1 read its row as the app role, C2 doesn't.
    await expectHiddenFrom({ read: eventsAs, target: await eventId("audience = 'shared'"), seenBy: [hafizId, mohammed.id], hiddenFrom: yousef.id, name: named, label: "its events" });
  });
});
