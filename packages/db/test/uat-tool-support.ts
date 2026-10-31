// What the UAT tool's two seam 2 files (uat-age, uat-run-job; RP-922) both set up on a Seam Two Tower.
// The weekly Step Age report covers Submittals only and goes to the Members holding Assign, and no
// default Position holds it, so the tests add both, as apps/api/test/step-age-report.test.ts does.
import { sql } from "kysely";
import type pg from "pg";
import { addTestWorkflow, bilingual, digits, type SeamTwoTower } from "../test-support/index.ts";

/** A test-only Position with View and Assign on Submittals. */
const REPORT_LEAD = "uat_report_lead";

/** C1's Project Manager and K1's Engineer hold Assign; C1's Engineer does not. */
export async function giveAssign(migrator: pg.Client, t: SeamTwoTower): Promise<void> {
  await migrator.query(
    `insert into position (owner_kind, base_role, key, name, sort)
     select 'rabaed', r, $1, '{"en": "Report lead (test)", "ar": "Report lead (test)"}', 99
     from unnest(array['contractor', 'consultant', 'owner', 'owner_representative']) r
     on conflict (base_role, key) do nothing`,
    [REPORT_LEAD],
  );
  await migrator.query(
    `insert into position_permission (position_id, module_key, permission)
     select p.id, 'submittals', x from position p cross join unnest(array['view', 'assign']) x where p.key = $1
     on conflict do nothing`,
    [REPORT_LEAD],
  );
  for (const [company, member, position] of [
    [t.c1, t.c1.members.project_manager, "project_manager"],
    [t.k1, t.k1.members.engineer, "engineer"],
  ] as const) {
    const outcome = await t.outcome(
      company.ap,
      sql`select app.set_project_member_positions(${company.participantId}::uuid, ${member}::uuid, ${[position, REPORT_LEAD]}::text[]) as outcome`,
    );
    if (outcome !== "set") throw new Error(`giveAssign: ${outcome}`);
  }
}

/** A Rabaed Submittals Type on the test Workflow (Contractor to Consultant), with a one-field Form; returns its code. */
export async function addSubmittalType(migrator: pg.Client): Promise<string> {
  const code = `UA${Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("")}`; // letters only (work_item_type_code_check)
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-922 UAT tool ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("UAT tool (RP-922)"))]))
    .rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [code, JSON.stringify(bilingual("UAT tool submittal (RP-922)")), workflowId, formId],
  );
  return code;
}

/** C1's Engineer raises a Submittal of `type`, sends it for review, and C1's PM Submits it to K1; returns its id. */
export async function submittalAtK1(t: SeamTwoTower, type: string, title: string): Promise<string> {
  const [created] = await t.call<{ outcome: string; work_item_id: string }>(
    t.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${t.projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify({ model: "CT-1" })}::jsonb,
      ${t.tradeId}::uuid, ${t.buildingA}::uuid, now())`,
  );
  if (created?.outcome !== "created") throw new Error(`submittalAtK1 create: ${created?.outcome}`);
  const id = created.work_item_id;
  for (const [what, result] of [
    ["send_for_review", () => t.take(t.c1.members.engineer, id, "send_for_review")],
    ["pick up", () => t.pickUp(t.c1.members.project_manager, id)],
    ["submit", () => t.take(t.c1.members.project_manager, id, "submit")],
  ] as const) {
    const outcome = await result();
    if (outcome !== "applied" && outcome !== "picked_up") throw new Error(`submittalAtK1 ${what}: ${outcome}`);
  }
  return id;
}

/** The emails of `projectId`'s active Members holding Assign. */
export async function assignHolders(migrator: pg.Client, projectId: string): Promise<string[]> {
  const { rows } = await migrator.query<{ email: string }>(
    `select m.email from project_member pm join member m on m.id = pm.member_id
     where pm.project_id = $1 and pm.status = 'active' and app.project_member_holds_assign(pm.id) order by m.email`,
    [projectId],
  );
  return rows.map((r) => r.email);
}
