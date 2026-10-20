// A foreign Project (RP-1016): another Company's Project with its own Trade, Location, Workflow, Form
// and Type, and the Rabaed Types only a migrator can make on them (as apps/api/test/outcome-sets.test.ts
// makes one). A test builds it in its beforeAll, before the call under test, so every read that could
// cross into another Project meets one on every run, never only when another test file happens to make
// one at the same moment. Its Trade and Location carry the same codes and names as buildTower's
// ("EL" Electrical, "BA" Building A), so a lookup by code or name that isn't scoped to the Project finds
// the foreign one too.
import { randomInt } from "node:crypto";
import type { Db } from "@rabaed/db";
import { sql } from "kysely";
import type { TestApi } from "./harness.ts";
import { bilingual, type Company } from "./tower.ts";

/** `prefix` and three random capital letters: a Type code that is new on every call. */
const typeCode = (prefix: string) => `${prefix}${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;

/**
 * A copy of the MAR's latest published Workflow Version, as Version 1 of `projectId`'s own Workflow,
 * published. Returns the Workflow's (workflow_definition) id.
 */
export async function projectWorkflow(migrator: Db, projectId: string): Promise<string> {
  const { rows } = await sql<{ definition_id: string; version_id: string }>`
    with definition as (
      insert into workflow_definition (owner_kind, project_id, name)
      values ('project', ${projectId}::uuid, '{"en": "A Project''s own Workflow (test)", "ar": "سير عمل خاص بمشروع (اختبار)"}')
      returning id
    ), mar as (
      select v.id, v.layout from workflow_version v
      join work_item_type t on t.workflow_definition_id = v.workflow_definition_id
      where t.code = 'MAR' and t.owner_kind = 'rabaed' and v.status = 'published'
      order by v.version_no desc limit 1
    ), version as (
      insert into workflow_version (workflow_definition_id, version_no, status, layout)
      select definition.id, 1, 'draft', mar.layout from definition, mar
      returning id, workflow_definition_id
    ), steps as (
      insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode)
      select version.id, s.key, s.name, s.stage_key, s.actor_rule, s.outcome_mode
      from version, mar join workflow_step s on s.workflow_version_id = mar.id
      returning id, key, workflow_version_id
    ), transitions as (
      insert into workflow_transition (
        workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form, rules, actions, notifications)
      select f.workflow_version_id, tr.key, f.id, s.id, tr.label, tr.kind, tr.outcome, tr.permission, tr.sort, tr.action_form, tr.rules, tr.actions, tr.notifications
      from mar
      join workflow_transition tr on tr.workflow_version_id = mar.id
      join workflow_step fs on fs.id = tr.from_step_id
      join workflow_step ts on ts.id = tr.to_step_id
      join steps f on f.key = fs.key
      join steps s on s.key = ts.key
      returning workflow_version_id
    )
    select version.workflow_definition_id as definition_id, version.id as version_id from version
  `.execute(migrator);
  await sql`update workflow_version set status = 'published', published_at = now() where id = ${rows[0]!.version_id}::uuid`.execute(migrator);
  return rows[0]!.definition_id;
}

/** A copy of the MAR's latest Form Version, as Version 1 of `projectId`'s own Form, published. Returns the Form's (form_definition) id. */
export async function projectForm(migrator: Db, projectId: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    with definition as (
      insert into form_definition (owner_kind, project_id, name)
      values ('project', ${projectId}::uuid, '{"en": "A Project''s own Form (test)", "ar": "نموذج خاص بمشروع (اختبار)"}')
      returning id
    ), version as (
      insert into form_version (form_definition_id, version_no, status, schema, published_at)
      select definition.id, 1, 'published', v.schema, now() from definition, form_version v
      where v.id = app.latest_form_version('MAR')
      returning form_definition_id
    )
    select form_definition_id as id from version
  `.execute(migrator);
  return rows[0]!.id;
}

/** What `buildForeignProject` takes. */
export type ForeignProjectOptions = {
  /** The foreign Project's code. Default "FRN". */
  code?: string;
  /**
   * The Project under test. When given, the result also has `formedType`: a Rabaed Type on a Workflow of
   * this Project's own whose Form is the foreign Project's, so the Workflow lets the Type through and only
   * the Form's own scoping keeps it out.
   */
  host?: string;
};

/** Another Company's Project, as buildForeignProject builds it. Codes are new on every call. */
export type ForeignProject = {
  /** Its Company: an Authorized Person who created the Project and is its only Member. */
  company: Company;
  projectId: string;
  /** Its Trade "EL" Electrical. */
  electrical: string;
  /** Its Location "BA" Building A. */
  buildingA: string;
  /** Its own Workflow (workflow_definition id): the MAR's, copied and published. */
  workflowId: string;
  /** Its own Form (form_definition id): the MAR's, copied and published. */
  formId: string;
  /** The code of its own Project-level Type, on its Workflow and its Form. */
  ownType: string;
  /** The code of a Rabaed Type whose own Workflow is the foreign Project's (the MAR's Form). */
  lentType: string;
  /** With `host`: the code of a Rabaed Type on the host Project's own Workflow whose Form is the foreign Project's. */
  formedType: string | undefined;
};

/**
 * Builds a foreign Project through the api (`api`) and, for what only a migrator can make, the test
 * database's `migrator`. Call it in a beforeAll before the call under test.
 */
export async function buildForeignProject(api: TestApi, migrator: Db, { code = "FRN", host }: ForeignProjectOptions = {}): Promise<ForeignProject> {
  const company = await api.projectCreator();
  const projectId = (await api.createProject(company.caller, { code })).id;
  const post = async (path: string, body: unknown): Promise<string> => {
    const res = await company.caller.post(`/v1/projects/${projectId}/${path}`, body);
    if (res.statusCode >= 300) throw new Error(`buildForeignProject ${path}: ${res.statusCode} ${res.body}`);
    return res.json().id;
  };
  const electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  const buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });

  const workflowId = await projectWorkflow(migrator, projectId);
  const formId = await projectForm(migrator, projectId);
  const ownType = typeCode("ZP");
  const lentType = typeCode("ZW");
  const formedType = host === undefined ? undefined : typeCode("ZF");
  type NewType = { project: string | null; code: string; name: string; workflow: string; form: string | null };
  const types: NewType[] = [
    { project: projectId, code: ownType, name: "Their own Material Submittal", workflow: workflowId, form: formId },
    { project: null, code: lentType, name: "Material Submittal on another Project's Workflow", workflow: workflowId, form: null },
  ];
  if (host !== undefined && formedType !== undefined) {
    types.push({ project: null, code: formedType, name: "Material Submittal on another Project's Form", workflow: await projectWorkflow(migrator, host), form: formId });
  }
  for (const t of types) {
    // The MAR's module and outcome kind, and its Form unless one is given.
    await sql`
      insert into work_item_type (owner_kind, project_id, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
      select ${t.project === null ? "rabaed" : "project"}, ${t.project}::uuid, 'submittals', ${t.code}, ${JSON.stringify(bilingual(t.name))}::jsonb,
        ${t.workflow}::uuid, 'review_code', coalesce(${t.form}::uuid, mar.form_definition_id)
      from work_item_type mar where mar.code = 'MAR' and mar.owner_kind = 'rabaed'
    `.execute(migrator);
  }
  return { company, projectId, electrical, buildingA, workflowId, formId, ownType, lentType, formedType };
}
