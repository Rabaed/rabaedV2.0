// Seam 1 for the Rabaed Default WIR Workflow Version 3 (RP-673, INSP-10; spec RP-649; ADR 0025;
// workflow-engine.md §1 "Rabaed Default documents", §5.3; visibility.md V5, scenario RP-673-1).
// An Inspection ends with a Review Code, as a submittal does: the WIR Type's outcomes are Codes
// A–D, the Inspections Module's Stages are the Submittals set, and Version 3 is Version 2's shape
// with the Consultant Engineer's Recommended Code and the Consultant Manager's code Screens. A WIR
// started on Version 2 still finishes with an Inspection Result.
//
// The seam suites' global setup runs the migrations, then the demo seed, which publishes the
// Rabaed Defaults.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { TypeOutcomes, WorkItemBoard } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checklistTemplate } from "./support/checklist-template.ts";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, memberOnProject, ok, take, type Company } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let projectId = "";
let electrical = "";
let buildingA = "";
let wirChecklist = ""; // A Checklist Template of the Project's, for Electrical: the WIR Form asks for one (RP-651).
let admin: Caller; // C1's Authorized Person: the Project Admin.
let hafiz: Caller; // C1 Contractor Engineer: the author.
let ali: Caller; // C1's only Project Manager: holds Contractor PM at once.

const board = async (by: Caller, module: string): Promise<WorkItemBoard> =>
  (await ok(by.get(`/v1/projects/${projectId}/modules/${module}/work-items/kanban`), 200)).json();

/** A WIR raised by Hafiz and sent for review. */
async function inReview(title: string) {
  const id = (
    await ok(
      hafiz.post(`/v1/projects/${projectId}/work-items`, {
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
  await take(hafiz, id, "send_for_review");
  return id;
}

/** Submitted by Ali to K1: its only Engineer holds the Consultant Engineer Step at once (ADR 0018). */
async function submitted(title: string) {
  const id = await inReview(title);
  await take(ali, id, "submit", { answers: { cover_note: "Ready on site from 09:00" } });
  return id;
}

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  admin = c1.caller;
  projectId = (await api.createProject(c1.caller, { code: "WV3" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  wirChecklist = await checklistTemplate(c1.caller, projectId, electrical);
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  hafiz = (await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" })).caller;
  ali = (await memberOnProject(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" })).caller;
  await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Mohammed Al Shamsi" });
});

describe("the WIR Type issues Review Codes (ADR 0025)", () => {
  it("its outcomes on a Project are Codes A–D with a submittal's follow-ups, then the Inspection Results Versions 1 and 2 still issue", async () => {
    const set: TypeOutcomes = (await ok(hafiz.get(`/v1/projects/${projectId}/work-item-types/WIR/outcomes`), 200)).json();
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
    const submittalKeys = (await board(hafiz, "submittals")).stages.map((s) => s.key);
    const inspections = (await board(hafiz, "inspections")).stages;
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
    expect(await detail(hafiz, id)).toMatchObject({ stage: { key: "pending_approval" } });
  });
});
