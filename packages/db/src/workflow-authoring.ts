import {
  definitionFromRows,
  definitionOutcomesAndStages,
  definitionToRows,
  formSchema,
  outcomeActions,
  parseWorkflowDefinition,
  withAfterSendBackDefault,
  workflowPublishProblems,
  type DefinitionIssue,
  type OutcomeKind,
  type OutcomesAndStages,
  type StageCategory,
  type WorkflowDefinition,
  type WorkflowProblem,
  type WorkflowPublishContext,
  type WorkflowValidation,
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

/** What a Workflow's publish checks read: its Work Item Type's outcome kind and outcome set, its Module's Stages, its Form. */
export type WorkflowCheckContext = { workItemTypeId: string; outcomeKind: OutcomeKind; context: WorkflowPublishContext };

/**
 * The context Workflow `definitionId` is checked in: its Work Item Type's outcome kind and
 * outcome set (the Project's copy for a Project's own Workflow, else the Rabaed Default set),
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
    join work_item_type t on t.id = app.workflow_type(d.id)
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
  // The Type's outcome set (RP-429): the Project's copy for a Project's own Workflow, else the Rabaed Default set.
  const outcomes = await sql<{ code: string; closing: boolean; actions: unknown }>`
    select code, closing, actions from outcome
    where work_item_type_id = ${type.type_id}::uuid
      and case when ${type.project_id}::uuid is null then project_id is null else project_id = ${type.project_id}::uuid end
    order by sort, code
  `.execute(db);
  const lists = await sql<{ id: string }>`select id from option_list`.execute(db);
  // The Screens its Transitions may show (RP-516): the owner's, else the Rabaed Defaults', by key.
  const screens = await sql<{ key: string; schema: unknown; internal_fields: string[] }>`
    select key, schema, internal_fields from app.workflow_screens(${definitionId}::uuid)
  `.execute(db);
  return {
    workItemTypeId: type.type_id,
    outcomeKind: type.outcome_kind,
    context: {
      // Stored follow-up actions that no longer fit fail loudly, never read as none.
      outcomes: outcomes.rows.map((o) => ({ ...o, actions: outcomeActions.parse(o.actions) })),
      stages: stages.rows.filter((s) => s.own === own).map(({ key, category }) => ({ key, category })),
      form: type.form === null ? null : formSchema.parse(type.form),
      optionListIds: new Set(lists.rows.map((l) => l.id)),
      screens: new Map(screens.rows.map((s) => [s.key, { schema: formSchema.parse(s.schema), internalFields: s.internal_fields }])),
    },
  };
}

/**
 * Whether a Workflow whose next publish would pin Screen `screenId` shows it on a Transition
 * that doesn't close the item (form-engine.md §3.3, RP-1088), in its latest published
 * Version: a Workflow of the Screen's owner, or, for a Rabaed Default Screen, one whose key
 * `app.workflow_screens` reads as this Screen (none of its owner's own). A draft is left to
 * its own publish, which refuses it, so no one's unpublished draft holds a Screen back.
 * Read with `db`'s row-level security.
 */
export async function readScreenShownOffClose(db: Db, screenId: string): Promise<boolean> {
  const { rows } = await sql<{ shown: boolean }>`
    select exists (
      select 1
      from screen s
      join workflow_definition d
        on s.owner_kind = 'rabaed'
        or (s.owner_kind = 'project' and d.owner_kind = 'project' and d.project_id = s.project_id)
        or (s.owner_kind = 'company' and d.owner_kind = 'company' and d.company_id = s.company_id)
      join workflow_version v on v.workflow_definition_id = d.id and v.status = 'published'
        and v.version_no = (select max(p.version_no) from workflow_version p
                            where p.workflow_definition_id = d.id and p.status = 'published')
      join workflow_transition t on t.workflow_version_id = v.id and t.screen_key = s.key and t.kind <> 'close'
      where s.id = ${screenId}::uuid
        and (s.owner_kind <> 'rabaed'
          or coalesce((select sv.screen_id from app.workflow_screens(d.id) w
                       join screen_version sv on sv.id = w.screen_version_id
                       where w.key = s.key), s.id) = s.id)
    ) as shown
  `.execute(db);
  return rows[0]?.shown === true;
}

/** The rows' layout, Steps and Transitions as the app.* draft functions take them (jsonb text). */
export type DraftArguments = { layout: string; steps: string; transitions: string };

/**
 * A definition document prepared for saving: refused with `issues` where it doesn't fit
 * the format, else its rows as the draft functions take them (a Transition's rules,
 * actions and notifications included, WF-7 to WF-9) and its publish problems.
 */
export type PreparedDraft =
  | { ok: false; issues: DefinitionIssue[]; problems: WorkflowProblem[] }
  | { ok: true; definition: WorkflowDefinition; args: DraftArguments; problems: WorkflowProblem[] };

/**
 * Parses `input` as a definition and runs every publish check on it in `check`'s
 * context: the one sequence every save, check and publish of a Workflow runs, in the
 * api and in Rabaed Admin. A Step a Send Back leads to that doesn't say what the raiser
 * may change after it gets "Comment only" (ADR 0021), so every saved Version says it.
 */
export function prepareDraft(input: unknown, check: WorkflowCheckContext): PreparedDraft {
  const parsed = parseWorkflowDefinition(input);
  if (!parsed.ok) return { ok: false, issues: parsed.issues, problems: [] };
  const definition = withAfterSendBackDefault(parsed.definition, check.context.stages);
  const problems = workflowPublishProblems(definition, check.context);
  const rows = definitionToRows(definition, check.outcomeKind);
  return {
    ok: true,
    definition,
    args: { layout: JSON.stringify(rows.layout), steps: JSON.stringify(rows.steps), transitions: JSON.stringify(rows.transitions) },
    problems,
  };
}

/** What a check of a prepared document answers: where it doesn't fit, and every publish problem. */
export function draftValidation(prepared: PreparedDraft): WorkflowValidation {
  return { issues: prepared.ok ? [] : prepared.issues, problems: prepared.problems };
}

/** A Version's rows as `app.workflow_version_rows` shapes them. */
type VersionRows = { layout: unknown; steps: unknown; transitions: unknown };

const definitionOf = (row: VersionRows): WorkflowDefinition =>
  definitionFromRows({
    layout: row.layout,
    steps: row.steps as WorkflowVersionRows["steps"],
    transitions: row.transitions as WorkflowVersionRows["transitions"],
  });

/** A draft as `app.workflow_draft` returns it, with the name the Workflow takes when it is published. */
export type StoredDraft = { versionId: string; versionNo: number; name: { en: string; ar: string }; definition: WorkflowDefinition };

/**
 * The draft of Workflow `definitionId`, for its authors only (`app.workflow_draft`),
 * locking the definition until the transaction ends. Null when there is none to read.
 */
export async function readWorkflowDraft(db: Db, definitionId: string): Promise<StoredDraft | null> {
  const { rows } = await sql<VersionRows & { workflow_version_id: string; version_no: number; name: { en: string; ar: string } }>`
    select * from app.workflow_draft(${definitionId}::uuid)
  `.execute(db);
  const row = rows[0];
  if (!row) return null;
  return { versionId: row.workflow_version_id, versionNo: row.version_no, name: row.name, definition: definitionOf(row) };
}

/** The published Version of Workflow `definitionId` new items would start on: the latest, as rows, if `db` reads it. */
export async function readLatestPublishedDefinition(db: Db, definitionId: string): Promise<{ versionNo: number; definition: WorkflowDefinition } | null> {
  const { rows } = await sql<VersionRows & { version_no: number }>`
    select v.version_no, r.* from (
      select id, version_no from workflow_version
      where workflow_definition_id = ${definitionId}::uuid and status = 'published'
      order by version_no desc limit 1
    ) v cross join lateral app.workflow_version_rows(v.id) r
  `.execute(db);
  const row = rows[0];
  return row ? { versionNo: row.version_no, definition: definitionOf(row) } : null;
}

/** Published Workflow Version `versionId` as a definition, if `db` reads it (V20); null otherwise. */
export async function readPublishedVersionDefinition(db: Db, versionId: string): Promise<WorkflowDefinition | null> {
  const { rows } = await sql<VersionRows>`
    select r.* from workflow_version v cross join lateral app.workflow_version_rows(v.id) r
    where v.id = ${versionId}::uuid and v.status = 'published'
  `.execute(db);
  const row = rows[0];
  return row ? definitionOf(row) : null;
}

/** A Rabaed Default's draft saved or published, with the warnings its checks found; or why not. */
export type RabaedDefaultResult =
  | { ok: true; definitionId: string; versionNo: number; warnings: WorkflowProblem[] }
  | { ok: false; reason: "type_not_found" }
  | { ok: false; reason: "invalid_definition"; issues: DefinitionIssue[] }
  | { ok: false; reason: "workflow_problems"; problems: WorkflowProblem[] }
  | ({ ok: false; reason: "projects_lack_entries" } & ProjectsLacking);

/** How many Projects running a Rabaed Default lack outcomes or Stages a Version would use, and which: never which Projects (V9). */
export type ProjectsLacking = { projects: number } & OutcomesAndStages;

/**
 * Saves `input` (a definition document) as the draft of the Rabaed Default Workflow of
 * Work Item Type `typeCode` and, with `publish`, publishes it as its next Version after
 * every publish check: refused on any error, warnings allowed. New items of the Type,
 * on every Project that binds no other Workflow, start on it at once. Run inside a
 * transaction (`trx`), connected as the migrator (the `workflow:publish` CLI) or as
 * rabaed_admin (Rabaed Admin, in its admin_action). A draft the Default had is replaced.
 * `workflowId` names one of the Type's other Rabaed Defaults (RP-596) instead of the one
 * the Type runs; one made for another Type is `type_not_found`.
 */
export async function writeRabaedDefaultWorkflow(
  trx: Db,
  typeCode: string,
  input: unknown,
  { publish, changeNote, workflowId }: { publish: boolean; changeNote?: string | undefined; workflowId?: string | null | undefined },
): Promise<RabaedDefaultResult> {
  const definitionId = await rabaedWorkflowTargetId(trx, typeCode, workflowId);
  const check = definitionId ? await readWorkflowCheckContext(trx, definitionId) : null;
  if (!definitionId || !check) return { ok: false, reason: "type_not_found" };
  const prepared = prepareDraft(input, check);
  if (!prepared.ok) return { ok: false, reason: "invalid_definition", issues: prepared.issues };
  if (publish && hasError(prepared.problems)) return { ok: false, reason: "workflow_problems", problems: prepared.problems };
  if (publish) {
    const lacking = await projectsLackingOutcomesAndStages(trx, definitionId, check.workItemTypeId, definitionOutcomesAndStages(prepared.definition));
    if (lacking.projects > 0) return { ok: false, reason: "projects_lack_entries", ...lacking };
  }
  const { args } = prepared;
  const saved = await sql<{ outcome: string; version_no: number }>`
    select outcome, version_no from app.write_workflow_draft(
      ${definitionId}::uuid, ${args.layout}::jsonb, ${args.steps}::jsonb, ${args.transitions}::jsonb, now())
  `.execute(trx);
  if (saved.rows[0]?.outcome !== "saved") throw new Error(`write_workflow_draft: ${saved.rows[0]?.outcome}`);
  if (!publish) return { ok: true, definitionId, versionNo: saved.rows[0].version_no, warnings: prepared.problems };
  const published = await sql<{ outcome: string; version_no: number }>`
    select outcome, version_no from app.mark_workflow_published_with_change_note(${definitionId}::uuid, now(), ${changeNote ?? null}::text)
  `.execute(trx);
  if (published.rows[0]?.outcome !== "published") throw new Error(`mark_workflow_published: ${published.rows[0]?.outcome}`);
  return { ok: true, definitionId, versionNo: published.rows[0].version_no, warnings: prepared.problems };
}

/**
 * The Active Projects that run Rabaed Default `definitionId` of Rabaed Work Item Type `typeId`
 * and lack one of `used` in their own sets, counted, with the outcomes and Stages they lack
 * (RP-566). A Project runs the Rabaed Default when it uses the Rabaed Type (no Type of its own
 * of that code, `app.project_type_id`) and either binds no other Workflow to it Project-wide or
 * binds a raising Participant to the Rabaed Default (`app.new_item_workflow_version` reads the
 * raiser's own binding first; an exception for another Workflow leaves the other raisers on the
 * Project-wide choice). It lacks an outcome its copy of the Type's set holds no closing outcome
 * of (`work_item_outcome_in_set`), and a Stage its Module's Stage set has no key of. A Closed
 * Project raises no items, so it is not counted. Read across every Company, as Rabaed Admin and
 * the migrator read (V9): the answer names no Project.
 *
 * Run in the publish's transaction, it locks what it checks until the publish commits
 * (CODING_STANDARDS "a lock per check-then-write"): the Rabaed Default's workflow_definition row
 * for update, which `app.bind_workflow` (binding to it) and `app.unbind_workflow` (falling back
 * to it) lock too, so no Project moves onto it between this check and the publish; and each
 * counted Project's outcome set and Stage set, shared (`app.lock_project_sets_shared`), the
 * advisory keys `app.delete_stage` and an outcome's code change take exclusively, so neither
 * drops what this check found.
 */
export async function projectsLackingOutcomesAndStages(db: Db, definitionId: string, typeId: string, used: OutcomesAndStages): Promise<ProjectsLacking> {
  await sql`select 1 from workflow_definition where id = ${definitionId}::uuid for update`.execute(db);
  // One of the Type's other Rabaed Defaults (RP-596) is run only by the Projects that bind it: no
  // Project falls back to it, so "binds no other Workflow" does not put a Project on it.
  const onDefault = sql`
    rabaed_type as (
      select id, code, module_key, workflow_definition_id from work_item_type where id = ${typeId}::uuid and owner_kind = 'rabaed'
    ), on_default as (
      select p.id from project p cross join rabaed_type t
      where p.status = 'active'
        and not exists (select 1 from work_item_type own where own.project_id = p.id and own.code = t.code)
        and case when t.workflow_definition_id = ${definitionId}::uuid then
          (
            not exists (
              select 1 from workflow_binding b
              where b.project_id = p.id and b.work_item_type_id = t.id and b.raising_participant_id is null
                and b.workflow_definition_id <> ${definitionId}::uuid)
            or exists (
              select 1 from workflow_binding b
              where b.project_id = p.id and b.work_item_type_id = t.id and b.raising_participant_id is not null
                and b.workflow_definition_id = ${definitionId}::uuid)
          )
        else
          exists (
            select 1 from workflow_binding b
            where b.project_id = p.id and b.work_item_type_id = t.id and b.workflow_definition_id = ${definitionId}::uuid)
        end
    )`;
  await sql`with ${onDefault} select app.lock_project_sets_shared(d.id, ${typeId}::uuid) from on_default d order by d.id`.execute(db);
  const { rows } = await sql<ProjectsLacking>`
    with ${onDefault}, lacks as (
      select d.id, 'outcome' as kind, e.entry from on_default d cross join rabaed_type t
      cross join unnest(${used.outcomes}::text[]) e(entry)
      where not exists (
        select 1 from outcome o where o.project_id = d.id and o.work_item_type_id = t.id and o.code = e.entry and o.closing
      )
      union all
      select d.id, 'stage', e.entry from on_default d cross join rabaed_type t
      cross join unnest(${used.stages}::text[]) e(entry)
      where not exists (select 1 from stage s where s.project_id = d.id and s.module_key = t.module_key and s.key = e.entry)
    )
    select count(distinct id)::int as projects,
      coalesce(array_agg(distinct entry order by entry) filter (where kind = 'outcome'), '{}') as outcomes,
      coalesce(array_agg(distinct entry order by entry) filter (where kind = 'stage'), '{}') as stages
    from lacks
  `.execute(db);
  return rows[0]!;
}

/** Whether any of `problems` refuses a publish (warnings don't). */
export const hasError = (problems: WorkflowProblem[]): boolean => problems.some((p) => p.severity === "error");

/** What a check of `input` against the Rabaed Default of `typeCode` finds; null for no such Type. */
export async function validateRabaedDefaultWorkflow(
  db: Db,
  typeCode: string,
  input: unknown,
  workflowId?: string | null,
): Promise<WorkflowValidation | null> {
  const definitionId = await rabaedWorkflowTargetId(db, typeCode, workflowId);
  const check = definitionId ? await readWorkflowCheckContext(db, definitionId) : null;
  return check ? draftValidation(prepareDraft(input, check)) : null;
}

/**
 * Rabaed Default Workflow `workflowId` of the Rabaed Work Item Type `typeCode` (RP-596: a Type
 * may have several, `workflow_definition.default_key`), else, for no `workflowId`, the one the
 * Type runs; null when the Type has none, or `workflowId` is not a Rabaed Default made for it.
 */
export async function rabaedWorkflowTargetId(db: Db, typeCode: string, workflowId?: string | null): Promise<string | null> {
  if (!workflowId) return rabaedDefaultWorkflowId(db, typeCode);
  const row = await db
    .selectFrom("workflow_definition as d")
    .innerJoin("work_item_type as t", "t.id", "d.work_item_type_id")
    .select("d.id")
    .where("d.id", "=", workflowId)
    .where("d.owner_kind", "=", "rabaed")
    .where("t.owner_kind", "=", "rabaed")
    .where("t.code", "=", typeCode)
    .executeTakeFirst();
  return row?.id ?? null;
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
