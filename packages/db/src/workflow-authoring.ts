import {
  definitionFromRows,
  definitionToRows,
  formSchema,
  parseWorkflowDefinition,
  workflowPublishProblems,
  type DefinitionIssue,
  type OutcomeKind,
  type StageCategory,
  type WorkflowDefinition,
  type WorkflowProblem,
  type WorkflowPublishContext,
  type WorkflowVersionRows,
} from "@rabaed/domain";
import { sql } from "kysely";
import type { Db } from "./client.ts";

// Workflow authoring (RP-427, WF-4; workflow-engine.md §1 "Authoring"): the reads and
// checks the api (a Project Admin, an Authorized Person, through the app role and its
// row-level security), Rabaed Admin (rabaed_admin) and the `workflow:publish` CLI (the
// migrator) share. The writes are the app.* functions of the workflow authoring
// migration; the publish checks are @rabaed/domain's workflowPublishProblems, run here
// in the transaction that publishes.

/** What a Workflow's publish checks read: its Work Item Type's outcome kind, its Module's Stages, its Form. */
export type WorkflowCheckContext = { workItemTypeId: string; outcomeKind: OutcomeKind; context: WorkflowPublishContext };

/**
 * The context Workflow `definitionId` is checked in: its Work Item Type's outcome kind,
 * the Stages of the Type's Module (the Project's own when it has them, else the Rabaed
 * Defaults'), the Type's latest published Form and the Option Lists. Null when `db`
 * doesn't read the Workflow, or it is made for no Type.
 */
export async function readWorkflowCheckContext(db: Db, definitionId: string): Promise<WorkflowCheckContext | null> {
  const { rows } = await sql<{ type_id: string; outcome_kind: OutcomeKind; module_key: string; project_id: string | null; form: unknown }>`
    select t.id as type_id, t.outcome_kind, t.module_key, d.project_id,
      (select f.schema from form_version f
       where f.form_definition_id = t.form_definition_id and f.status = 'published'
       order by f.version_no desc limit 1) as form
    from workflow_definition d
    join work_item_type t on t.id = coalesce(
      d.work_item_type_id,
      (select o.id from work_item_type o where o.workflow_definition_id = d.id order by o.created_at, o.id limit 1))
    where d.id = ${definitionId}::uuid
  `.execute(db);
  const type = rows[0];
  if (!type) return null;
  const stages = await sql<{ key: string; category: StageCategory; own: boolean }>`
    select key, category, project_id is not null as own from stage
    where module_key = ${type.module_key} and (project_id is null or project_id = ${type.project_id}::uuid)
    order by sort, key
  `.execute(db);
  const own = stages.rows.some((s) => s.own);
  const lists = await sql<{ id: string }>`select id from option_list`.execute(db);
  return {
    workItemTypeId: type.type_id,
    outcomeKind: type.outcome_kind,
    context: {
      outcomeKind: type.outcome_kind,
      stages: stages.rows.filter((s) => s.own === own).map(({ key, category }) => ({ key, category })),
      form: type.form === null ? null : formSchema.parse(type.form),
      optionListIds: new Set(lists.rows.map((l) => l.id)),
    },
  };
}

/** A definition document read and checked: where it doesn't fit the format, else its publish problems. */
export type CheckedDefinition =
  | { ok: false; issues: DefinitionIssue[] }
  | { ok: true; definition: WorkflowDefinition; rows: WorkflowVersionRows; problems: WorkflowProblem[] };

/** Parses `input` as a definition and runs every publish check on it in `check`'s context. */
export function checkDefinition(input: unknown, check: WorkflowCheckContext): CheckedDefinition {
  const parsed = parseWorkflowDefinition(input);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  return {
    ok: true,
    definition: parsed.definition,
    rows: definitionToRows(parsed.definition, check.outcomeKind),
    problems: workflowPublishProblems(parsed.definition, check.context),
  };
}

/**
 * Parts of a definition the rows can't hold yet: a Transition's rules, actions or
 * notifications have no columns until WF-7, WF-8 and WF-9 add them. Saving them would
 * lose them, so a draft carrying them is refused, saying where.
 */
export function unstorableParts(definition: WorkflowDefinition): DefinitionIssue[] {
  return definition.transitions.flatMap((t, index) =>
    (["rules", "actions", "notifications"] as const)
      .filter((part) => t[part] !== undefined)
      .map((part) => ({ path: `transitions.${index}.${part}`, message: "Not set up yet: this Workflow can't store it" })),
  );
}

type DraftRow = { workflow_version_id: string; version_no: number; layout: unknown; steps: unknown; transitions: unknown };

/** A draft as `app.workflow_draft` returns it. */
export type StoredDraft = { versionId: string; versionNo: number; rows: WorkflowVersionRows; definition: WorkflowDefinition };

/**
 * The draft of Workflow `definitionId`, for its authors only (`app.workflow_draft`),
 * locking the definition until the transaction ends. Null when there is none to read.
 */
export async function readWorkflowDraft(db: Db, definitionId: string): Promise<StoredDraft | null> {
  const { rows } = await sql<DraftRow>`select * from app.workflow_draft(${definitionId}::uuid)`.execute(db);
  const row = rows[0];
  if (!row) return null;
  const stored: WorkflowVersionRows = {
    layout: row.layout,
    steps: row.steps as WorkflowVersionRows["steps"],
    transitions: row.transitions as WorkflowVersionRows["transitions"],
  };
  return { versionId: row.workflow_version_id, versionNo: row.version_no, rows: stored, definition: definitionFromRows(stored) };
}

/** The rows' Steps and Transitions as the app.* draft functions take them. */
export function draftArguments(rows: WorkflowVersionRows) {
  return {
    layout: JSON.stringify(rows.layout),
    steps: JSON.stringify(rows.steps),
    transitions: JSON.stringify(rows.transitions),
  };
}

/** The published Version of Workflow `definitionId` new items would start on: the latest, as rows, if `db` reads it. */
export async function readLatestPublishedDefinition(db: Db, definitionId: string): Promise<{ versionNo: number; definition: WorkflowDefinition } | null> {
  const version = await sql<{ id: string; version_no: number; layout: unknown }>`
    select id, version_no, layout from workflow_version
    where workflow_definition_id = ${definitionId}::uuid and status = 'published'
    order by version_no desc limit 1
  `.execute(db);
  const v = version.rows[0];
  if (!v) return null;
  const steps = await sql<WorkflowVersionRows["steps"][number]>`
    select key, name, stage_key, actor_rule, is_signing, outcome_mode from workflow_step
    where workflow_version_id = ${v.id}::uuid order by created_at, key
  `.execute(db);
  const transitions = await sql<WorkflowVersionRows["transitions"][number]>`
    select t.key, f.key as from_step_key, s.key as to_step_key, t.label, t.kind, t.outcome, t.permission, t.sort, t.action_form
    from workflow_transition t
    join workflow_step f on f.id = t.from_step_id
    join workflow_step s on s.id = t.to_step_id
    where t.workflow_version_id = ${v.id}::uuid order by t.sort, t.key
  `.execute(db);
  return { versionNo: v.version_no, definition: definitionFromRows({ layout: v.layout, steps: steps.rows, transitions: transitions.rows }) };
}

/** A Rabaed Default's draft saved or published, with the warnings its checks found; or why not. */
export type RabaedDefaultResult =
  | { ok: true; definitionId: string; versionNo: number; warnings: WorkflowProblem[] }
  | { ok: false; reason: "type_not_found" }
  | { ok: false; reason: "invalid_definition"; issues: DefinitionIssue[] }
  | { ok: false; reason: "workflow_problems"; problems: WorkflowProblem[] };

/**
 * Saves `input` (a definition document) as the draft of the Rabaed Default Workflow of
 * Work Item Type `typeCode` and, with `publish`, publishes it as its next Version after
 * every publish check: refused on any error, warnings allowed. New items of the Type,
 * on every Project that binds no other Workflow, start on it at once. Run inside a
 * transaction (`trx`), connected as the migrator (the `workflow:publish` CLI) or as
 * rabaed_admin (Rabaed Admin, in its admin_action). A draft the Default had is replaced.
 */
export async function writeRabaedDefaultWorkflow(
  trx: Db,
  typeCode: string,
  input: unknown,
  { publish }: { publish: boolean },
): Promise<RabaedDefaultResult> {
  const definitionId = await rabaedDefaultWorkflowId(trx, typeCode);
  const check = definitionId ? await readWorkflowCheckContext(trx, definitionId) : null;
  if (!definitionId || !check) return { ok: false, reason: "type_not_found" };
  const checked = checkDefinition(input, check);
  if (!checked.ok) return { ok: false, reason: "invalid_definition", issues: checked.issues };
  const unstorable = unstorableParts(checked.definition);
  if (unstorable.length > 0) return { ok: false, reason: "invalid_definition", issues: unstorable };
  if (publish && checked.problems.some((p) => p.severity === "error")) return { ok: false, reason: "workflow_problems", problems: checked.problems };
  const args = draftArguments(checked.rows);
  const saved = await sql<{ outcome: string; version_no: number }>`
    select outcome, version_no from app.write_workflow_draft(
      ${definitionId}::uuid, null, ${args.layout}::jsonb, ${args.steps}::jsonb, ${args.transitions}::jsonb, now())
  `.execute(trx);
  if (saved.rows[0]?.outcome !== "saved") throw new Error(`write_workflow_draft: ${saved.rows[0]?.outcome}`);
  if (!publish) return { ok: true, definitionId, versionNo: saved.rows[0].version_no, warnings: checked.problems };
  const published = await sql<{ outcome: string; version_no: number }>`
    select outcome, version_no from app.mark_workflow_published(${definitionId}::uuid, now())
  `.execute(trx);
  if (published.rows[0]?.outcome !== "published") throw new Error(`mark_workflow_published: ${published.rows[0]?.outcome}`);
  return { ok: true, definitionId, versionNo: published.rows[0].version_no, warnings: checked.problems };
}

/** What a check of `input` against the Rabaed Default of `typeCode` finds; null for no such Type. */
export async function validateRabaedDefaultWorkflow(db: Db, typeCode: string, input: unknown) {
  const definitionId = await rabaedDefaultWorkflowId(db, typeCode);
  const check = definitionId ? await readWorkflowCheckContext(db, definitionId) : null;
  if (!check) return null;
  const checked = checkDefinition(input, check);
  return checked.ok ? { issues: unstorableParts(checked.definition), problems: checked.problems } : { issues: checked.issues, problems: [] };
}

/** The Rabaed Default Workflow of the Rabaed Work Item Type `typeCode`, if there is one. */
export async function rabaedDefaultWorkflowId(db: Db, typeCode: string): Promise<string | null> {
  const type = await db
    .selectFrom("work_item_type")
    .select("workflow_definition_id")
    .where("owner_kind", "=", "rabaed")
    .where("code", "=", typeCode)
    .executeTakeFirst();
  return type?.workflow_definition_id ?? null;
}
