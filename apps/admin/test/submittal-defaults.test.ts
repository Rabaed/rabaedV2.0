// Seam 1: the eight Rabaed Default submittal Workflows in Rabaed Admin -> Workflows (RP-596,
// spec RP-598; workflow-engine.md §1 "Rabaed Defaults"). Each submittal Type lists all eight, in
// the order the owner decided; a Rabaed Engineer opens, checks and saves a draft of any of them
// by its id (`?workflow=`), never one of another Type's. The demo seed publishes them.
import { createDb, readLatestPublishedDefinition } from "@rabaed/db";
import { addTestWorkflow, testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rabaedWorkflowFile, submittalWorkflows } from "../src/rabaed-defaults.ts";
import { createTestAdmin, type Browser } from "./support/harness.ts";

const admin = await createTestAdmin();
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await admin.close();
  await adminDb.destroy();
  await migrator.destroy();
});

type Row = { code: string; workflowId: string; workflowName: { en: string; ar: string }; isTypeDefault: boolean; publishedVersions: number[]; hasDraft: boolean };

let engineer: { id: string; browser: Browser };
let rows: Row[] = [];
const of = (code: string) => rows.filter((r) => r.code === code);

/** A test Rabaed Type of its own with two published Rabaed Defaults: the one it runs and a second, keyed. */
const TYPE = "WFVAR";
async function twoWorkflows(): Promise<{ ownId: string; otherId: string }> {
  const run = (text: string) => sql.raw(text).execute(migrator);
  const existing = await sql<{ id: string; workflow_definition_id: string }>`
    select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = ${TYPE}
  `.execute(migrator);
  if (existing.rows[0]) {
    const other = await sql<{ id: string }>`
      select id from workflow_definition where work_item_type_id = ${existing.rows[0].id}::uuid and default_key = 'second'
    `.execute(migrator);
    return { ownId: existing.rows[0].workflow_definition_id, otherId: other.rows[0]!.id };
  }
  const ownId = await addTestWorkflow(run, { name: { en: "Variant, own (test)", ar: "متغير، الأصلي" } });
  const otherId = await addTestWorkflow(run, { name: { en: "Variant, second (test)", ar: "متغير، الثاني" } });
  const mar = await sql<{ form_definition_id: string }>`select form_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'`.execute(migrator);
  const type = await sql<{ id: string }>`
    insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
    values ('rabaed', 'submittals', ${TYPE}, '{"en": "Variants (test)", "ar": "متغيرات (اختبار)"}', ${ownId}::uuid, 'review_code', ${mar.rows[0]!.form_definition_id}::uuid)
    returning id
  `.execute(migrator);
  await sql`update workflow_definition set work_item_type_id = ${type.rows[0]!.id}::uuid where id = ${ownId}::uuid`.execute(migrator);
  await sql`update workflow_definition set work_item_type_id = ${type.rows[0]!.id}::uuid, default_key = 'second' where id = ${otherId}::uuid`.execute(migrator);
  return { ownId, otherId };
}

beforeAll(async () => {
  engineer = await admin.signedInEngineer();
  rows = (await engineer.browser.get("/v1/workflows")).json().types;
});

describe("Rabaed Admin lists the eight for MAR, SAR and DAR", () => {
  it.each(["MAR", "SAR", "DAR"])("%s: eight Workflows in the owner's order, one the Type runs, each published", (code) => {
    expect(of(code).map((r) => r.workflowName.en)).toEqual(submittalWorkflows.map((w) => w.name.en));
    expect(of(code).map((r) => r.workflowName.ar)).toEqual(submittalWorkflows.map((w) => w.name.ar));
    expect(of(code).filter((r) => r.isTypeDefault)).toHaveLength(1);
    expect(of(code).every((r) => r.publishedVersions.length > 0)).toBe(true);
  });

  it("MAR and SAR run 2→2, DAR runs 1→1 → Owner review", () => {
    const runs = (code: string) => of(code).find((r) => r.isTypeDefault)!.workflowName.en;
    expect(runs("MAR")).toBe(submittalWorkflows[3].name.en);
    expect(runs("SAR")).toBe(submittalWorkflows[3].name.en);
    expect(runs("DAR")).toBe(submittalWorkflows[4].name.en);
  });

  it("the other Types list one Workflow each", () => {
    for (const code of ["WIR", "CMT"]) expect(of(code)).toHaveLength(1);
  });
});

describe("a Rabaed Engineer opens, checks and saves one of the eight by its id", () => {
  it("reads it with the Type's sets, as the builder does", async () => {
    const row = of("MAR").find((r) => r.workflowName.en === submittalWorkflows[0].name.en)!;
    const res = await engineer.browser.get(`/v1/workflows/MAR?workflow=${row.workflowId}`);
    expect(res.statusCode, res.body).toBe(200);
    const read = res.json();
    expect(read.workflow).toMatchObject({ id: row.workflowId, name: submittalWorkflows[0].name });
    expect(read.workflow.published.definition.steps.map((s: { key: string }) => s.key)).toEqual(
      expect.not.arrayContaining(["contractor_engineer", "consultant_engineer", "owner_review"]),
    );
    expect(read.outcomeSet.map((o: { code: string }) => o.code)).toEqual(["A", "B", "C", "D"]);
  });

  // On a Type of its own, so the drafts it leaves are no real Type's.
  it("checks a document against its own Workflow, and saves a draft of it that the Type's own Workflow doesn't show", async () => {
    const { ownId, otherId } = await twoWorkflows();
    const definition = (await readLatestPublishedDefinition(adminDb, otherId))!.definition;
    const checked = await engineer.browser.post(`/v1/workflows/${TYPE}/validate?workflow=${otherId}`, { definition });
    expect(checked.statusCode, checked.body).toBe(200);
    const saved = await engineer.browser.post(`/v1/workflows/${TYPE}/draft?workflow=${otherId}`, { definition, reason: "RP-596 test: save a draft of the Type's other Workflow" });
    expect(saved.statusCode, saved.body).toBe(200);
    const after: Row[] = (await engineer.browser.get("/v1/workflows")).json().types;
    expect(after.filter((r) => r.code === TYPE).map((r) => [r.workflowId, r.isTypeDefault, r.hasDraft])).toEqual([
      [ownId, true, false],
      [otherId, false, true],
    ]);
    const read = (await engineer.browser.get(`/v1/workflows/${TYPE}?workflow=${otherId}`)).json();
    expect(read.workflow.draft).toMatchObject({ versionNo: 2 });
    expect((await engineer.browser.get(`/v1/workflows/${TYPE}`)).json().workflow.draft).toBeNull();
  });

  it("refuses another Type's Workflow under this Type: 404", async () => {
    const dar = of("DAR")[0]!;
    expect((await engineer.browser.get(`/v1/workflows/MAR?workflow=${dar.workflowId}`)).statusCode).toBe(404);
    const definition = rabaedWorkflowFile(submittalWorkflows[0].file);
    expect((await engineer.browser.post(`/v1/workflows/MAR/validate?workflow=${dar.workflowId}`, { definition })).statusCode).toBe(404);
    expect((await engineer.browser.post(`/v1/workflows/MAR/draft?workflow=${dar.workflowId}`, { definition, reason: "x" })).statusCode).toBe(404);
  });
});
