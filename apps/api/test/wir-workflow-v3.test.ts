// Seam 1 for the Rabaed Default WIR Workflow Version 3 (RP-673, INSP-10; spec RP-649; ADR 0025;
// workflow-engine.md §1 "Rabaed Default documents", §5.3; visibility.md V5, scenario RP-673-1).
// An Inspection ends with a Review Code, as a submittal does: the WIR Type's outcomes are Codes
// A–D, the Inspections Module's Stages are the Submittals set, and Version 3 is Version 2's shape
// with the Consultant Engineer's Recommended Code and the Consultant Manager's code Screens. A WIR
// started on Version 2 still finishes with an Inspection Result.
//
// The seam suites' global setup runs the migrations, then the demo seed, which publishes the
// Rabaed Defaults.
import { rabaedWorkflowFile, sameDefinition } from "@rabaed/admin/services";
import { createDb, readPublishedVersionDefinition, withMember } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { parseWorkflowDefinition, type Home, type TypeOutcomes, type WorkItemBoard, type WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checklistTemplate } from "./support/checklist-template.ts";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { pinToWorkflowVersion } from "./support/pin-version.ts";
import { all, bilingual, detail, memberOnProject, ok, take, tryTake, type Company } from "./support/tower.ts";

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
let wirChecklist = ""; // A Checklist Template of the Project's, for Electrical: the WIR Form asks for one (RP-651).
let hafiz: { id: string; caller: Caller }; // C1 Contractor Engineer: the author.
let ali: { id: string; caller: Caller }; // C1's only Project Manager: holds Contractor PM at once.
let ahmed: { id: string; caller: Caller }; // K1 Consultant Engineer.
let mohammed: { id: string; caller: Caller }; // K1's only Manager: holds Consultant Manager at once.
let faisal: Caller; // O1, Owner Representative: oversight.
let yousef: { id: string; caller: Caller }; // C2, a second Contractor covering Mechanical only.

const board = async (by: Caller, module: string): Promise<WorkItemBoard> =>
  (await ok(by.get(`/v1/projects/${projectId}/modules/${module}/work-items/kanban`), 200)).json();
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> =>
  ((await ok(by.get(`/v1/work-items/${id}/history`), 200)).json() as WorkItemHistory).events;
const transitionKeys = async (by: Caller, id: string) => (await detail(by, id)).actions.transitions.map((t) => t.key).sort();

const RECOMMENDATION_NOTE = "Engineer: cover to the rebar under 40 mm at gridline 4";
/** The final verification a submittal's code Screen asks the Manager for. */
const VERIFIED = { sample_checked: true, matches_specification: true };

/** A WIR raised by Hafiz and sent for review. */
async function inReview(title: string) {
  const id = (
    await ok(
      hafiz.caller.post(`/v1/projects/${projectId}/work-items`, {
        type: "WIR",
        title,
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
  await take(hafiz.caller, id, "send_for_review");
  return id;
}

/** Submitted by Ali to K1: Ahmed, K1's only Engineer, holds the Consultant Engineer Step at once (ADR 0018). */
async function submitted(title: string) {
  const id = await inReview(title);
  await take(ali.caller, id, "submit", { answers: { cover_note: "Ready on site from 09:00" } });
  return id;
}

/** Ahmed Sends to Manager recommending `code`; Mohammed, K1's only Manager, holds the Consultant Manager Step at once. */
const sentToManager = async (id: string, recommendedCode = "C") =>
  take(ahmed.caller, id, "send_to_manager", { recommendedCode, internalNote: RECOMMENDATION_NOTE });

/** Sent to the Manager recommending C, Returned to the Engineer, and Sent again: the path the issue's seam 1 takes to each Code. */
async function returnedAndSentAgain(title: string) {
  const id = await submitted(title);
  await sentToManager(id, "C");
  await take(mohammed.caller, id, "return_to_engineer", { reason: "Photograph the cover at gridline 4" });
  await sentToManager(id, "C");
  return id;
}

/** The WIR Workflow's Version `versionNo`, published. */
async function versionId(versionNo: number) {
  const { rows } = await sql<{ id: string }>`
    select v.id from work_item_type t join workflow_version v on v.workflow_definition_id = t.workflow_definition_id
    where t.owner_kind = 'rabaed' and t.code = 'WIR' and v.version_no = ${versionNo} and v.status = 'published'
  `.execute(migrator);
  return rows[0]!.id;
}

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const o1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "WV3" })).id;
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
  hafiz = await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" });
  ali = await memberOnProject(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  ahmed = await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  mohammed = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Mohammed Al Shamsi" });
  faisal = (await memberOnProject(api, o1, o1ParticipantId, ["engineer"], { name: "Faisal Al Otaibi" })).caller;
  yousef = await memberOnProject(api, c2, c2ParticipantId, ["engineer"], { name: "Yousef Karim" });
});

describe("the WIR Workflow Version 3 is the document `pnpm defaults:publish` publishes", () => {
  it("Version 3 is apps/admin/workflows/WIR.json, Version 2 WIR-2.json and Version 1 WIR-1.json, all three published", async () => {
    for (const [versionNo, file] of [
      [3, "WIR.json"],
      [2, "WIR-2.json"],
      [1, "WIR-1.json"],
    ] as const) {
      const stored = (await readPublishedVersionDefinition(migrator, await versionId(versionNo)))!;
      const document = parseWorkflowDefinition(rabaedWorkflowFile(file));
      expect(document.ok && sameDefinition(stored, document.definition), file).toBe(true);
    }
    const latest = (await readPublishedVersionDefinition(migrator, await versionId(3)))!;
    expect(latest.steps.map((s) => [s.key, s.stage])).toEqual([
      ["draft", "draft"],
      ["internal_review", "internal_review"],
      ["contractor_engineer", "internal_review"],
      ["consultant_engineer", "pending_approval"],
      ["consultant_manager", "pending_approval"],
      ["approved", "approved"],
      ["revise_resubmit", "revise_resubmit"],
      ["rejected", "rejected"],
      ["cancelled", "cancelled"],
    ]);
    // The Manager issues Codes (`issue_code`); Versions 1 and 2 still issue Inspection Results.
    const { rows } = await sql<{ version_no: number; outcome_mode: string }>`
      select v.version_no, s.outcome_mode from work_item_type t
      join workflow_version v on v.workflow_definition_id = t.workflow_definition_id
      join workflow_step s on s.workflow_version_id = v.id
      where t.owner_kind = 'rabaed' and t.code = 'WIR' and s.outcome_mode not in ('none', 'recommend_code')
      order by v.version_no
    `.execute(migrator);
    expect(rows.map((r) => [r.version_no, r.outcome_mode])).toEqual([
      [1, "inspection_result"],
      [2, "inspection_result"],
      [3, "issue_code"],
    ]);
  });
});

describe("a WIR on Version 3 (seam 1 acceptance)", () => {
  it("starts on Version 3 and is Submitted to the Consultant Engineer, in Pending Approval", async () => {
    const id = await submitted("Submitted");
    expect(await detail(ahmed.caller, id)).toMatchObject({ stage: { key: "pending_approval" }, step: { key: "consultant_engineer" }, workflow: { versionNo: 3 } });
    expect((await detail(ahmed.caller, id)).heldBy?.memberName?.en).toBe("Ahmed bin Said");
    expect(await transitionKeys(ahmed.caller, id)).toEqual(["send_to_manager"]);
  });

  it("Send to Manager recommends a Code A–D only; the Manager holds the Step with Return to Engineer and the four Codes", async () => {
    const id = await submitted("Recommended");
    const toManager = (await detail(ahmed.caller, id)).actions.transitions.find((t) => t.key === "send_to_manager")!;
    expect(toManager.recommendCode?.map((o) => o.code)).toEqual(["A", "B", "C", "D"]);
    for (const code of ["passed", "failed", "cancelled"]) {
      const refused = await tryTake(ahmed.caller, id, "send_to_manager", { recommendedCode: code });
      expect(refused.statusCode, `${code}: ${refused.body}`).toBe(422);
      expect(refused.json()).toMatchObject({ error: "recommended_code_not_offered" });
    }
    await sentToManager(id, "C");
    expect(await detail(mohammed.caller, id)).toMatchObject({ stage: { key: "pending_approval" }, step: { key: "consultant_manager" } });
    expect((await detail(mohammed.caller, id)).heldBy?.memberName?.en).toBe("Mohammed Al Shamsi");
    expect(await transitionKeys(mohammed.caller, id)).toEqual(["approve_a", "approve_b", "reject_d", "return_to_engineer", "revise_c"]);
    expect(await transitionKeys(ahmed.caller, id)).toEqual([]);
  });

  it("the Manager Returns to the Engineer with a reason, who Sends to Manager again", async () => {
    const id = await submitted("Returned to the Engineer");
    await sentToManager(id, "C");
    const noReason = await tryTake(mohammed.caller, id, "return_to_engineer");
    expect(noReason.statusCode, noReason.body).toBe(422);
    await take(mohammed.caller, id, "return_to_engineer", { reason: "Photograph the cover at gridline 4" });
    expect(await detail(ahmed.caller, id)).toMatchObject({ stage: { key: "pending_approval" }, step: { key: "consultant_engineer" } });
    await sentToManager(id, "C");
    expect(await detail(mohammed.caller, id)).toMatchObject({ step: { key: "consultant_manager" } });
  });

  it("Code A closes it Approved, with no Revision", async () => {
    const id = await returnedAndSentAgain("Rebar Level 2");
    await take(mohammed.caller, id, "approve_a", { answers: VERIFIED, remarks: "Accepted" });
    expect(await detail(hafiz.caller, id)).toMatchObject({ stage: { key: "approved" }, outcome: "A", actions: { createRevision: false, createReplacement: false } });
  });

  it("Code B makes each row of its table a Comment for the Contractor", async () => {
    const id = await returnedAndSentAgain("Rebar Level 3");
    await take(mohammed.caller, id, "approve_b", {
      answers: { ...VERIFIED, remarks: "Fix the cover", items_to_create: [{ comment: "Raise the cover to 40 mm" }, { comment: "Tie the lap at gridline 4" }] },
    });
    expect(await detail(hafiz.caller, id)).toMatchObject({ stage: { key: "approved" }, outcome: "B", raisedItems: [{ type: { code: "CMT" }, open: 2, closed: 0 }] });
  });

  it("Code C closes it at Revise & Resubmit and offers the Contractor a Revision, the re-inspection", async () => {
    const id = await returnedAndSentAgain("Rebar Level 4");
    await take(mohammed.caller, id, "revise_c", { answers: VERIFIED, remarks: "Spacing out of tolerance" });
    expect(await detail(hafiz.caller, id)).toMatchObject({ stage: { key: "revise_resubmit" }, outcome: "C", actions: { createRevision: true } });
    expect((await detail(mohammed.caller, id)).actions.createRevision).toBe(false);
  });

  it("Code D closes it Rejected, with no Revision and a replacement offered", async () => {
    const id = await returnedAndSentAgain("Rebar Level 5");
    await take(mohammed.caller, id, "reject_d", { answers: VERIFIED, remarks: "Wrong slab" });
    // As a submittal's Code D: no Revision, a replacement offered (the Rabaed Default Review Codes).
    expect(await detail(hafiz.caller, id)).toMatchObject({ stage: { key: "rejected" }, outcome: "D", actions: { createRevision: false, createReplacement: true } });
  });
});

describe("a WIR started on Version 2 finishes on Version 2 (the Workflow Version it pinned)", () => {
  async function atManagerOnVersion2(title: string) {
    const id = await submitted(title);
    await pinToWorkflowVersion(migrator, "WIR", 2, id);
    expect(await detail(ahmed.caller, id)).toMatchObject({ step: { key: "consultant_engineer" }, workflow: { versionNo: 2 } });
    const toManager = (await detail(ahmed.caller, id)).actions.transitions.find((t) => t.key === "send_to_manager")!;
    expect(toManager.recommendCode?.map((o) => o.code)).toEqual(["passed", "passed_with_comments", "failed"]);
    await take(ahmed.caller, id, "send_to_manager", { recommendedCode: "failed", internalNote: RECOMMENDATION_NOTE });
    expect(await transitionKeys(mohammed.caller, id)).toEqual(["fail", "pass", "pass_with_comments", "return_to_engineer"]);
    return id;
  }

  it("Passed with Comments makes its rows Comments, in Approved", async () => {
    const id = await atManagerOnVersion2("Version 2, Passed with Comments");
    await take(mohammed.caller, id, "pass_with_comments", {
      answers: { remarks: "Fix the cover", items_to_create: [{ comment: "Raise the cover to 40 mm" }, { comment: "Tie the lap at gridline 4" }] },
    });
    expect(await detail(hafiz.caller, id)).toMatchObject({
      stage: { key: "approved" },
      outcome: "passed_with_comments",
      workflow: { versionNo: 2 },
      raisedItems: [{ type: { code: "CMT" }, open: 2, closed: 0 }],
    });
  });

  it("Failed offers the Contractor a Revision, in Revise & Resubmit", async () => {
    const id = await atManagerOnVersion2("Version 2, Failed");
    await take(mohammed.caller, id, "fail", { remarks: "Spacing out of tolerance" });
    expect(await detail(hafiz.caller, id)).toMatchObject({ stage: { key: "revise_resubmit" }, outcome: "failed", workflow: { versionNo: 2 }, actions: { createRevision: true } });
    // Home's Recent activity reads it by its name, never "Code failed", though the Type now issues Codes.
    const home: Home = (await ok(hafiz.caller.get("/v1/home"), 200)).json();
    expect(home.activity.find((e) => e.workItem.id === id && e.outcome === "failed")?.outcomeName).toEqual({ en: "Failed", ar: "راسب" });
  });
});

// Scenario RP-673-1 (visibility.md): the Consultant Engineer's Recommended Code and Internal Note on
// a WIR on Version 3 stay inside the Consultant (V5), before and after the Code, read through the
// api and as the app role (row-level security); another Contractor reads nothing of the WIR (V3).
describe("RP-673-1: who reads the Consultant Engineer's Recommended Code of a WIR on Version 3", () => {
  let id = "";
  /** What `as` reads of the item's events through row-level security, as the app role. */
  const eventsAs = (as: string) =>
    withMember(appDb, as, (trx) =>
      sql<{ type: string; payload: unknown }>`select type, payload from work_item_event where work_item_id = ${id}::uuid order by seq`.execute(trx).then((r) => r.rows),
    );

  beforeAll(async () => {
    id = await submitted("Visibility");
  });

  it("C1 and oversight read nothing of it, before or after the Code; K1 reads it", async () => {
    const before = { hafiz: await history(hafiz.caller, id), ali: await history(ali.caller, id), faisal: await history(faisal, id) };
    await sentToManager(id, "C");
    for (const who of [ahmed.caller, mohammed.caller]) {
      const events = await history(who, id);
      expect(events.find((e) => e.type === "recommend_code")).toMatchObject({ audience: "internal", recommendedCode: "C" });
      expect(JSON.stringify(events)).toContain(RECOMMENDATION_NOTE);
    }
    expect(await history(hafiz.caller, id)).toEqual(before.hafiz);
    expect(await history(ali.caller, id)).toEqual(before.ali);
    expect(await history(faisal, id)).toEqual(before.faisal);

    await take(mohammed.caller, id, "revise_c", { answers: VERIFIED, remarks: "Spacing out of tolerance" });
    for (const who of [hafiz.caller, ali.caller, faisal]) {
      const events = await history(who, id);
      expect(events.some((e) => e.type === "recommend_code")).toBe(false);
      expect(events.map((e) => e.recommendedCode ?? null)).toEqual(events.map(() => null));
      expect(JSON.stringify(events)).not.toContain(RECOMMENDATION_NOTE);
      expect(events.at(-1)).toMatchObject({ type: "issue_code", outcome: "C" });
    }
  });

  it("as the app role, the event rows of the Recommended Code and the Internal Note are K1's alone", async () => {
    for (const as of [ahmed.id, mohammed.id]) expect((await eventsAs(as)).map((e) => e.type)).toContain("recommend_code");
    for (const as of [hafiz.id, ali.id]) {
      const rows = await eventsAs(as);
      expect(rows.map((e) => e.type)).not.toContain("recommend_code");
      expect(JSON.stringify(rows)).not.toContain(RECOMMENDATION_NOTE);
    }
  });

  it("another Contractor, C2, who doesn't cover the trade, reads nothing of the WIR: no item, history or events", async () => {
    await expectHidden(yousef.caller.get(`/v1/work-items/${id}`));
    await expectHidden(yousef.caller.get(`/v1/work-items/${id}/history`));
    expect(await eventsAs(yousef.id)).toEqual([]);
  });
});

describe("the WIR Type issues Review Codes (ADR 0025)", () => {
  it("its outcomes on a Project are Codes A–D with a submittal's follow-ups, then the Inspection Results Versions 1 and 2 still issue", async () => {
    const set: TypeOutcomes = (await ok(hafiz.caller.get(`/v1/projects/${projectId}/work-item-types/WIR/outcomes`), 200)).json();
    expect(set.outcomes.map((o) => [o.code, o.name.en, o.polarity, o.actions])).toEqual([
      ["A", "Approved", "positive", []],
      ["B", "Approved with Comments", "positive", [{ kind: "create_items", type: "CMT" }]],
      ["C", "Revise and Resubmit", "negative", [{ kind: "offer_revision" }]],
      ["D", "Rejected", "negative", [{ kind: "offer_replacement" }]],
      ["passed", "Passed", "positive", []],
      ["passed_with_comments", "Passed with Comments", "positive", [{ kind: "create_items", type: "CMT" }]],
      ["failed", "Failed", "negative", [{ kind: "offer_revision" }]],
    ]);
    const type = await migrator.selectFrom("work_item_type").select("outcome_kind").where("owner_kind", "=", "rabaed").where("code", "=", "WIR").executeTakeFirstOrThrow();
    expect(type.outcome_kind).toBe("review_code");
  });
});

describe("the Inspections Stages are the Submittals set (ADR 0025)", () => {
  it("in the Rabaed Defaults and in a Project's copy: the Inspections Kanban's columns are the Submittals' Stages", async () => {
    const submittalKeys = (await board(hafiz.caller, "submittals")).stages.map((s) => s.key);
    const inspections = (await board(hafiz.caller, "inspections")).stages;
    expect(inspections.map((s) => s.key)).toEqual(submittalKeys);
    expect(inspections.map((s) => s.key)).toEqual(["draft", "internal_review", "pending_approval", "approved", "revise_resubmit", "cancelled", "rejected"]);
    expect(inspections.map((s) => s.name.en)).toEqual(["Draft", "Internal Review", "Pending Approval", "Approved", "Revise & Resubmit", "Cancelled", "Rejected"]);
    const { rows } = await sql<{ key: string }>`
      select distinct key from stage where module_key = 'inspections' and owner_kind = 'rabaed' order by key
    `.execute(migrator);
    expect(rows.map((r) => r.key)).toEqual(["approved", "cancelled", "draft", "internal_review", "pending_approval", "rejected", "revise_resubmit"]);
  });

  it("no Workflow Step, Stage or item of the Module is left on Pending Inspection, Passed or Failed", async () => {
    const { rows } = await sql<{ n: number }>`
      select (
        (select count(*) from stage where module_key = 'inspections' and key in ('pending_inspection', 'passed', 'failed'))
        + (select count(*) from workflow_step s join workflow_version v on v.id = s.workflow_version_id
           join work_item_type t on t.id = app.workflow_type(v.workflow_definition_id)
           where t.module_key = 'inspections' and s.stage_key in ('pending_inspection', 'passed', 'failed'))
        + (select count(*) from work_item w join work_item_type t on t.id = w.work_item_type_id
           where t.module_key = 'inspections' and w.current_stage_key in ('pending_inspection', 'passed', 'failed'))
      )::int as n
    `.execute(migrator);
    expect(rows[0]!.n).toBe(0);
  });

  // The migration moves each key with app.move_stage_key. Here, in a transaction rolled back, a
  // Project's WIR is put back on Pending Inspection (the key moved back), then moved as the migration does.
  it("moves a Project's WIR that sat at Pending Inspection to Pending Approval, keeping a name the Project gave a Stage", async () => {
    const id = await submitted("Sat at Pending Inspection");
    const rollback = new Error("rolled back");
    await migrator
      .transaction()
      .execute(async (trx) => {
        await sql`select app.move_stage_key('inspections', 'pending_approval', 'pending_inspection', ${JSON.stringify({ en: "Pending Inspection", ar: "بانتظار المعاينة" })}::jsonb)`.execute(trx);
        await sql`update stage set name = ${JSON.stringify({ en: "Awaiting the Consultant", ar: "بانتظار الاستشاري" })}::jsonb where project_id = ${projectId}::uuid and module_key = 'inspections' and key = 'pending_inspection'`.execute(trx);
        const before = await trx.selectFrom("work_item").select("current_stage_key").where("id", "=", id).executeTakeFirstOrThrow();
        expect(before.current_stage_key).toBe("pending_inspection");

        await sql`select app.move_stage_key('inspections', 'pending_inspection', 'pending_approval', ${JSON.stringify({ en: "Pending Approval", ar: "بانتظار الاعتماد" })}::jsonb)`.execute(trx);
        const after = await trx.selectFrom("work_item").select("current_stage_key").where("id", "=", id).executeTakeFirstOrThrow();
        expect(after.current_stage_key).toBe("pending_approval");
        const names = await sql<{ owner_kind: string; project_id: string | null; name: { en: string } }>`
          select owner_kind, project_id, name from stage where module_key = 'inspections' and key = 'pending_approval'
            and (project_id is null or project_id = ${projectId}::uuid)
          order by owner_kind desc
        `.execute(trx);
        expect(names.rows.map((r) => [r.owner_kind, r.name.en])).toEqual([
          ["rabaed", "Pending Approval"],
          ["project", "Awaiting the Consultant"],
        ]);
        const steps = await sql<{ n: number }>`
          select count(*)::int as n from workflow_step s join workflow_version v on v.id = s.workflow_version_id
          join work_item_type t on t.id = app.workflow_type(v.workflow_definition_id)
          where t.module_key = 'inspections' and s.stage_key = 'pending_inspection'
        `.execute(trx);
        expect(steps.rows[0]!.n).toBe(0);
        throw rollback;
      })
      .catch((e: unknown) => {
        if (e !== rollback) throw e;
      });
    expect(await detail(hafiz.caller, id)).toMatchObject({ stage: { key: "pending_approval" } });
  });

  it("joins a Stage the Project already has under the new key: the Project's own stays, the moved one is dropped, its items join it", async () => {
    const id = await submitted("Joins the Project's own Stage");
    const rollback = new Error("rolled back");
    await migrator
      .transaction()
      .execute(async (trx) => {
        await sql`
          insert into stage (owner_kind, project_id, module_key, key, name, category, sort)
          values ('project', ${projectId}::uuid, 'inspections', 'on_site', ${JSON.stringify({ en: "On Site", ar: "في الموقع" })}::jsonb, 'in_progress', 8)
        `.execute(trx);
        await sql`select app.move_stage_key('inspections', 'pending_approval', 'on_site', ${JSON.stringify({ en: "On Site (default)", ar: "في الموقع" })}::jsonb)`.execute(trx);

        const item = await trx.selectFrom("work_item").select("current_stage_key").where("id", "=", id).executeTakeFirstOrThrow();
        expect(item.current_stage_key).toBe("on_site");
        const own = await sql<{ key: string; name: { en: string } }>`
          select key, name from stage where project_id = ${projectId}::uuid and module_key = 'inspections' and key in ('pending_approval', 'on_site')
        `.execute(trx);
        expect(own.rows.map((r) => [r.key, r.name.en])).toEqual([["on_site", "On Site"]]);
        throw rollback;
      })
      .catch((e: unknown) => {
        if (e !== rollback) throw e;
      });
    expect(await detail(hafiz.caller, id)).toMatchObject({ stage: { key: "pending_approval" } });
  });
});
