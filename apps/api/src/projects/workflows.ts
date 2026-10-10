import {
  draftValidation,
  hasError,
  prepareDraft,
  readLatestPublishedDefinition,
  readWorkflowCheckContext,
  readWorkflowDraft,
  withMember,
  type Db,
} from "@rabaed/db";
import {
  stageCopyProblems,
  type BilingualText,
  type BindWorkflowRequest,
  type StageCategory,
  type WorkflowBuilderRead,
  type DefinitionIssue,
  type DuplicateWorkflowRequest,
  type SaveWorkflowDraftRequest,
  type StageCopyProblem,
  type UnbindWorkflowQuery,
  type WorkflowProblem,
  type WorkflowRead,
  type WorkflowValidation,
} from "@rabaed/domain";
import { sql } from "kysely";
import { checkedOutcome, commandResult } from "../outcomes.ts";

// Workflow authoring (RP-427, WF-4; workflow-engine.md §1 "Authoring"; ADR 0016). A
// Project Admin authors the Project's own Workflows and its bindings; an Authorized
// Person their Company's Library. Every write is an app.* command of the workflow
// authoring migration, one transaction each; the publish checks run here, in the
// transaction that publishes, on the draft app.workflow_draft has locked. Anyone who
// may not author the Workflow gets 'not_found', exactly like a made-up id.

/** A Workflow as the Member reads it (V18, V20); null when they don't, as for one only its authors read yet. */
export function readWorkflow(db: Db, memberId: string, definitionId: string): Promise<WorkflowRead | null> {
  return withMember(db, memberId, (trx) => workflowRead(trx, definitionId));
}

/**
 * What the builder edits with (RP-439, WF-16), for the Workflow's authors only: the
 * Workflow, its Type, the Stages and outcome set it is checked against (as
 * readWorkflowCheckContext reads them) and the Positions; null for anyone else.
 */
export function readWorkflowBuilder(db: Db, memberId: string, definitionId: string): Promise<WorkflowBuilderRead | null> {
  return withMember(db, memberId, async (trx): Promise<WorkflowBuilderRead | null> => {
    if (!(await authors(trx, definitionId))) return null;
    const workflow = await workflowRead(trx, definitionId);
    const { rows } = await sql<{ type_id: string; code: string; name: BilingualText; module_key: string; project_id: string | null }>`
      select t.id as type_id, t.code, t.name, t.module_key, d.project_id
      from workflow_definition d join work_item_type t on t.id = app.workflow_type(d.id)
      where d.id = ${definitionId}::uuid
    `.execute(trx);
    const type = rows[0];
    if (!workflow || !type) return null;
    const stages = await sql<{ key: string; name: BilingualText; category: StageCategory; own: boolean }>`
      select key, name, category, project_id is not null as own from stage
      where module_key = ${type.module_key} and (project_id is null or project_id = ${type.project_id}::uuid)
      order by sort, key
    `.execute(trx);
    const own = stages.rows.some((s) => s.own);
    const outcomes = await sql<WorkflowBuilderRead["outcomes"][number]>`
      select code, name, closing, polarity from outcome
      where work_item_type_id = ${type.type_id}::uuid
        and case when ${type.project_id}::uuid is null then project_id is null else project_id = ${type.project_id}::uuid end
      order by sort, code
    `.execute(trx);
    const positions = await trx.selectFrom("position").select(["base_role", "key", "name"]).orderBy("base_role").orderBy("sort").execute();
    return {
      workflow,
      type: { code: type.code, name: type.name },
      stages: stages.rows.filter((s) => s.own === own).map(({ key, name, category }) => ({ key, name, category })),
      outcomes: outcomes.rows,
      positions: positions.map((p) => ({ role: p.base_role, key: p.key, name: p.name as BilingualText })),
    };
  });
}

async function workflowRead(trx: Db, definitionId: string): Promise<WorkflowRead | null> {
  const definition = await trx
    .selectFrom("workflow_definition")
    .select(["id", "name", "owner_kind", "project_id", sql<string | null>`app.workflow_type(id)`.as("work_item_type_id")])
    .where("id", "=", definitionId)
    .executeTakeFirst();
  if (!definition) return null;
  const versions = await trx
    .selectFrom("workflow_version")
    .select("version_no")
    .where("workflow_definition_id", "=", definitionId)
    .where("status", "=", "published")
    .orderBy("version_no")
    .execute();
  const canAuthor = await authors(trx, definitionId);
  const draft = canAuthor ? await readWorkflowDraft(trx, definitionId) : null;
  return {
    id: definition.id,
    name: definition.name,
    owner: definition.owner_kind,
    projectId: definition.project_id,
    workItemTypeId: definition.work_item_type_id,
    publishedVersions: versions.map((v) => v.version_no),
    published: await readLatestPublishedDefinition(trx, definitionId),
    draft: draft && { versionNo: draft.versionNo, name: draft.name, definition: draft.definition },
    canAuthor,
  };
}

const duplicateRefusals = ["not_found", "project_closed", "invalid_name"] as const;
export type DuplicateWorkflowResult =
  | { ok: true; id: string }
  | { ok: false; reason: (typeof duplicateRefusals)[number] }
  /** Copied into a Project whose Module lacks a Stage the Workflow uses: one problem per Stage. */
  | { ok: false; reason: "stage_missing"; problems: StageCopyProblem[] };

/** Thrown inside the copy's transaction to undo it, carrying why. */
class StageMissing extends Error {
  constructor(readonly problems: StageCopyProblem[]) {
    super("stage_missing");
  }
}

/**
 * Copies a Workflow the Member reads into a Project they are a Project Admin of, or into
 * their Company Library. Into a Project its Stages map by key (WF-5): refused, with
 * nothing copied, when the Project's Module lacks one (stageCopyProblems).
 */
export async function duplicateWorkflow(
  db: Db,
  memberId: string,
  sourceId: string,
  input: DuplicateWorkflowRequest,
  now: Date,
): Promise<DuplicateWorkflowResult> {
  try {
    return await withMember(db, memberId, async (trx): Promise<DuplicateWorkflowResult> => {
      const { rows } = await sql<{ outcome: string; workflow_definition_id: string | null }>`
        select outcome, workflow_definition_id from app.duplicate_workflow(
          ${sourceId}::uuid, ${input.projectId}::uuid, ${JSON.stringify(input.name)}::jsonb, ${now})
      `.execute(trx);
      const outcome = checkedOutcome(rows[0]!.outcome, ["duplicated", ...duplicateRefusals]);
      if (outcome !== "duplicated") return { ok: false, reason: outcome };
      const id = rows[0]!.workflow_definition_id!;
      if (input.projectId !== null) {
        const problems = await copyStageProblems(trx, id, input.projectId);
        if (problems.length > 0) throw new StageMissing(problems);
      }
      return { ok: true, id };
    });
  } catch (error) {
    if (error instanceof StageMissing) return { ok: false, reason: "stage_missing", problems: error.problems };
    throw error;
  }
}

/** The Stages copy `copyId` (a draft the Member authors) uses that Project `projectId` lacks in its Type's Module. */
async function copyStageProblems(trx: Db, copyId: string, projectId: string): Promise<StageCopyProblem[]> {
  const draft = await readWorkflowDraft(trx, copyId);
  if (!draft) return [];
  const { rows } = await sql<{ key: string }>`
    select s.key from stage s
    join work_item_type t on t.id = app.workflow_type(${copyId}::uuid)
    where s.project_id = ${projectId}::uuid and s.module_key = t.module_key
  `.execute(trx);
  return stageCopyProblems(draft.definition, rows);
}

const saveRefusals = ["not_found", "project_closed", "invalid_name", "invalid_definition", "workflow_name_names_participant"] as const;
export type SaveWorkflowDraftResult =
  | { ok: true; versionNo: number }
  /** `issues` say where the document doesn't fit the format. */
  | { ok: false; reason: (typeof saveRefusals)[number]; issues?: DefinitionIssue[] };

/** Saves the draft of a Workflow the Member authors; a document that isn't a definition is refused, saying where. */
export function saveWorkflowDraft(
  db: Db,
  memberId: string,
  definitionId: string,
  input: SaveWorkflowDraftRequest,
  now: Date,
): Promise<SaveWorkflowDraftResult> {
  return withMember(db, memberId, async (trx): Promise<SaveWorkflowDraftResult> => {
    const check = await authoredCheckContext(trx, definitionId);
    if (!check) return { ok: false, reason: "not_found" };
    const prepared = prepareDraft(input.definition, check);
    if (!prepared.ok) return { ok: false, reason: "invalid_definition", issues: prepared.issues };
    const { args } = prepared;
    const name = input.name === undefined ? null : JSON.stringify(input.name);
    const { rows } = await sql<{ outcome: string; version_no: number | null }>`
      select outcome, version_no from app.save_workflow_draft(
        ${definitionId}::uuid, ${name}::jsonb, ${args.layout}::jsonb, ${args.steps}::jsonb, ${args.transitions}::jsonb, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["saved", ...saveRefusals]);
    return outcome === "saved" ? { ok: true, versionNo: rows[0]!.version_no! } : { ok: false, reason: outcome };
  });
}

/** Checks `definition`, or the saved draft when it is left out, for a Workflow the Member authors; saves nothing. */
export function validateWorkflow(db: Db, memberId: string, definitionId: string, definition: unknown): Promise<WorkflowValidation | null> {
  return withMember(db, memberId, async (trx) => {
    const check = await authoredCheckContext(trx, definitionId);
    if (!check) return null;
    let input = definition;
    if (input === undefined) {
      const draft = await readWorkflowDraft(trx, definitionId);
      if (!draft) return { issues: [], problems: [] };
      input = draft.definition;
    }
    return draftValidation(prepareDraft(input, check));
  });
}

const publishRefusals = ["not_found", "project_closed", "no_draft", "workflow_name_names_participant"] as const;
export type PublishWorkflowResult =
  | { ok: true; versionNo: number; warnings: WorkflowProblem[] }
  | { ok: false; reason: "workflow_problems"; problems: WorkflowProblem[] }
  | { ok: false; reason: (typeof publishRefusals)[number] };

/** Publishes the draft of a Workflow the Member authors, after every publish check: refused on any error, warnings allowed. */
export function publishWorkflow(db: Db, memberId: string, definitionId: string, now: Date): Promise<PublishWorkflowResult> {
  return withMember(db, memberId, async (trx): Promise<PublishWorkflowResult> => {
    const check = await authoredCheckContext(trx, definitionId);
    if (!check) return { ok: false, reason: "not_found" };
    // Locks the definition: no save comes between these checks and the publish.
    const draft = await readWorkflowDraft(trx, definitionId);
    if (!draft) return { ok: false, reason: "no_draft" };
    const { problems } = prepareDraft(draft.definition, check);
    if (hasError(problems)) return { ok: false, reason: "workflow_problems", problems };
    const { rows } = await sql<{ outcome: string; version_no: number | null }>`
      select outcome, version_no from app.publish_workflow(${definitionId}::uuid, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["published", ...publishRefusals]);
    return outcome === "published" ? { ok: true, versionNo: rows[0]!.version_no!, warnings: problems } : { ok: false, reason: outcome };
  });
}

const bindRefusals = ["not_found", "project_closed", "workflow_not_published", "workflow_not_for_type", "workflow_name_names_participant"] as const;

/** A Project Admin binds a Work Item Type on the Project to a Workflow, for every raiser or for one raising Participant. */
export function bindWorkflow(db: Db, memberId: string, projectId: string, input: BindWorkflowRequest, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.bind_workflow(
        ${projectId}::uuid, ${input.workItemTypeId}::uuid, ${input.raisingParticipantId}::uuid, ${input.workflowId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "bound", bindRefusals);
  });
}

const unbindRefusals = ["not_found", "project_closed"] as const;

/** A Project Admin takes a binding away: new items run the Project's binding, else the Rabaed Default. */
export function unbindWorkflow(db: Db, memberId: string, projectId: string, input: UnbindWorkflowQuery, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.unbind_workflow(${projectId}::uuid, ${input.workItemTypeId}::uuid, ${input.raisingParticipantId ?? null}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "unbound", unbindRefusals);
  });
}

/** Whether the acting Member authors Workflow `definitionId`. */
async function authors(trx: Db, definitionId: string): Promise<boolean> {
  const { rows } = await sql<{ can: boolean }>`select app.can_author_workflow(${definitionId}::uuid) as can`.execute(trx);
  return rows[0]!.can;
}

/** The check context of a Workflow the Member authors; null for any other (hidden, a Rabaed Default, made up). */
async function authoredCheckContext(trx: Db, definitionId: string) {
  return (await authors(trx, definitionId)) ? readWorkflowCheckContext(trx, definitionId) : null;
}
