import {
  rabaedDefaultWorkflowId,
  readLatestPublishedDefinition,
  readModuleStages,
  readPositions,
  readWorkflowCheckContext,
  writeRabaedDefaultWorkflow,
  type Db,
} from "@rabaed/db";
import {
  definitionFromRows,
  outcomeActions,
  type AdminWorkflowRead,
  type AdminWorkflowSummary,
  type BilingualText,
  type ModuleKey,
  type Outcome,
  type StageCategory,
  type WorkflowDefinition,
  type WorkflowVersionRows,
} from "@rabaed/domain";
import { sql } from "kysely";
import { asEngineer } from "./admin-action.ts";
import { Refused, refusable, type Refusable } from "./refusals.ts";

// Rabaed Admin -> Workflows (RP-443, WF-20): the Rabaed Defaults a Rabaed Engineer authors, as
// the builder reads them, and the edits of a Rabaed Default's outcome set and its Module's Stage
// set. The reads are Rabaed's own data (nothing of a Company's), so they ask for no reason, as
// the publish check doesn't; every change is an Engineer action with a reason in admin_action
// (V9). Projects keep the sets they were given: every edit, an added outcome or Stage included,
// reaches only the Projects created after it (decided 2026-10-11: a new Project copies the
// Rabaed Defaults as they are then). Each edit takes its set's advisory lock before reading
// the set it checks, as a Project's own Stage and outcome commands do, so two edits never
// interleave between a check and its write.

type VersionRows = { layout: unknown; steps: unknown; transitions: unknown };
const definitionOf = (row: VersionRows): WorkflowDefinition =>
  definitionFromRows({ layout: row.layout, steps: row.steps as WorkflowVersionRows["steps"], transitions: row.transitions as WorkflowVersionRows["transitions"] });

/** Every Rabaed Default Work Item Type with its Workflow's published Versions and whether a draft is waiting. */
export async function listRabaedWorkflows(db: Db): Promise<AdminWorkflowSummary[]> {
  const { rows } = await sql<{ code: string; name: BilingualText; module_key: ModuleKey; versions: number[]; has_draft: boolean }>`
    select t.code, t.name, t.module_key,
      coalesce((select array_agg(v.version_no order by v.version_no) from workflow_version v
        where v.workflow_definition_id = t.workflow_definition_id and v.status = 'published'), '{}') as versions,
      exists (select 1 from workflow_version v where v.workflow_definition_id = t.workflow_definition_id and v.status = 'draft') as has_draft
    from work_item_type t
    where t.owner_kind = 'rabaed'
    order by t.module_key, t.code
  `.execute(db);
  return rows.map((r) => ({ code: r.code, name: r.name, moduleKey: r.module_key, publishedVersions: r.versions, hasDraft: r.has_draft }));
}

/** The draft of Workflow `definitionId`, if it has one (the newest Version, while unpublished). */
async function readDraft(db: Db, definitionId: string) {
  const { rows } = await sql<VersionRows & { version_no: number; name: BilingualText }>`
    select v.version_no, coalesce(v.draft_name, d.name) as name, r.layout, r.steps, r.transitions
    from workflow_version v
    join workflow_definition d on d.id = v.workflow_definition_id
    cross join lateral app.workflow_version_rows(v.id) r
    where v.workflow_definition_id = ${definitionId}::uuid and v.status = 'draft'
      and v.version_no = (select max(o.version_no) from workflow_version o where o.workflow_definition_id = ${definitionId}::uuid)
  `.execute(db);
  const row = rows[0];
  return row ? { versionNo: row.version_no, name: row.name, definition: definitionOf(row) } : null;
}

/** What the builder edits Type `typeCode`'s Rabaed Default with; null for a Type that has none. */
export async function readRabaedWorkflow(db: Db, typeCode: string): Promise<AdminWorkflowRead | null> {
  const type = await db
    .selectFrom("work_item_type")
    .innerJoin("workflow_definition", "workflow_definition.id", "work_item_type.workflow_definition_id")
    .select(["work_item_type.id", "work_item_type.code", "work_item_type.name", "work_item_type.module_key", "work_item_type.workflow_definition_id", "workflow_definition.name as workflow_name"])
    .where("work_item_type.owner_kind", "=", "rabaed")
    .where("work_item_type.code", "=", typeCode)
    .executeTakeFirst();
  if (!type) return null;
  const definitionId = type.workflow_definition_id;
  const versions = await db
    .selectFrom("workflow_version")
    .select("version_no")
    .where("workflow_definition_id", "=", definitionId)
    .where("status", "=", "published")
    .orderBy("version_no")
    .execute();
  const outcomes = await db
    .selectFrom("outcome")
    .select(["code", "name", "closing", "polarity", "actions"])
    .where("owner_kind", "=", "rabaed")
    .where("work_item_type_id", "=", type.id)
    .orderBy("sort")
    .orderBy("code")
    .execute();
  const check = await readWorkflowCheckContext(db, definitionId);
  return {
    workflow: {
      id: definitionId,
      name: type.workflow_name,
      owner: "rabaed",
      projectId: null,
      workItemTypeId: type.id,
      publishedVersions: versions.map((v) => v.version_no),
      published: await readLatestPublishedDefinition(db, definitionId),
      draft: await readDraft(db, definitionId),
      canAuthor: true,
    },
    type: { code: type.code, name: type.name },
    moduleKey: type.module_key,
    form: check?.context.form ?? null,
    stages: await readModuleStages(db, type.module_key, null),
    outcomes: outcomes.map(({ code, name, closing, polarity }) => ({ code, name, closing, polarity })),
    outcomeSet: outcomes.map((o): Outcome => ({ code: o.code, name: o.name, closing: o.closing, polarity: o.polarity, actions: outcomeActions.parse(o.actions) })),
    positions: await readPositions(db),
  };
}

export type DuplicateRefusal = "not_found" | "invalid_definition";

/**
 * Rabaed Engineer `engineerId` copies Type `fromTypeCode`'s Workflow (its draft, else its latest
 * Version) in as the draft of Type `typeCode`'s, replacing the draft it had. The copy is checked
 * against the target Type when it is published, not now.
 */
export async function duplicateRabaedWorkflow(
  db: Db,
  engineerId: string,
  typeCode: string,
  input: { fromTypeCode: string; reason: string },
): Promise<Refusable<{ versionNo: number }, DuplicateRefusal>> {
  return refusable(() =>
    asEngineer(db, { engineerId, action: "duplicate_workflow", reason: input.reason }, async (trx) => {
      const source = await readRabaedWorkflow(trx, input.fromTypeCode);
      const targetId = await rabaedDefaultWorkflowId(trx, typeCode);
      const definition = source && (source.workflow.draft?.definition ?? source.workflow.published?.definition);
      if (!targetId || !definition) throw new Refused("not_found");
      const written = await writeRabaedDefaultWorkflow(trx, typeCode, definition, { publish: false });
      if (!written.ok) throw new Refused(written.reason === "type_not_found" ? "not_found" : "invalid_definition");
      return {
        target: { kind: "workflow_definition", id: written.definitionId },
        after: { typeCode, fromTypeCode: input.fromTypeCode, versionNo: written.versionNo },
        result: { versionNo: written.versionNo },
      };
    }),
  );
}

export type SetRefusal = "not_found" | "already_exists" | "invalid_order";

/** Holds Type `typeId`'s Rabaed Default outcome set until the transaction ends (a Project's own is 'outcomes:<project>:<type>'). */
const lockOutcomeSet = (trx: Db, typeId: string) => sql`select pg_advisory_xact_lock(hashtextextended(${`outcomes:rabaed:${typeId}`}, 0))`.execute(trx);

/** Holds the Module's Rabaed Default Stage set until the transaction ends (a Project's own is 'stages:<project>:<module>'). */
const lockStageSet = (trx: Db, moduleKey: ModuleKey) => sql`select pg_advisory_xact_lock(hashtextextended(${`stages:rabaed:${moduleKey}`}, 0))`.execute(trx);

/** Whether `next` names every member of `current` exactly once: a reorder, nothing added, dropped or repeated. */
export const isPermutation = (current: readonly string[], next: readonly string[]): boolean =>
  current.length === next.length && new Set(next).size === next.length && next.every((x) => current.includes(x));

const outcomeTarget = async (trx: Db, typeCode: string) =>
  trx.selectFrom("work_item_type").select("id").where("owner_kind", "=", "rabaed").where("code", "=", typeCode).executeTakeFirst();

/** Adds an outcome to Type `typeCode`'s Rabaed Default set, last in its order; the Projects created afterwards get it. */
export function addDefaultOutcome(
  db: Db,
  engineerId: string,
  typeCode: string,
  input: Outcome & { reason: string },
): Promise<Refusable<null, SetRefusal>> {
  return refusable(() =>
    asEngineer(db, { engineerId, action: "add_default_outcome", reason: input.reason }, async (trx) => {
      const type = await outcomeTarget(trx, typeCode);
      if (!type) throw new Refused("not_found");
      await lockOutcomeSet(trx, type.id);
      const existing = await trx.selectFrom("outcome").select(["code", "sort"]).where("owner_kind", "=", "rabaed").where("work_item_type_id", "=", type.id).execute();
      if (existing.some((o) => o.code === input.code)) throw new Refused("already_exists");
      await trx
        .insertInto("outcome")
        .values({
          owner_kind: "rabaed",
          project_id: null,
          work_item_type_id: type.id,
          code: input.code,
          name: JSON.stringify(input.name),
          closing: input.closing,
          polarity: input.polarity,
          actions: JSON.stringify(input.actions),
          sort: Math.max(0, ...existing.map((o) => o.sort)) + 1,
        })
        .execute();
      const { reason: _reason, ...outcome } = input;
      return { target: { kind: "outcome", id: type.id }, after: { typeCode, outcome }, result: null };
    }),
  );
}

/** Changes an outcome's names and follow-up actions in the Rabaed Default set; Projects' copies stay as they are. */
export function changeDefaultOutcome(
  db: Db,
  engineerId: string,
  typeCode: string,
  code: string,
  input: { name: BilingualText; actions: Outcome["actions"]; reason: string },
): Promise<Refusable<null, SetRefusal>> {
  return refusable(() =>
    asEngineer(db, { engineerId, action: "change_default_outcome", reason: input.reason }, async (trx) => {
      const type = await outcomeTarget(trx, typeCode);
      const before = type
        ? await trx.selectFrom("outcome").select(["name", "actions"]).where("owner_kind", "=", "rabaed").where("work_item_type_id", "=", type.id).where("code", "=", code).forUpdate().executeTakeFirst()
        : undefined;
      if (!type || !before) throw new Refused("not_found");
      await trx
        .updateTable("outcome")
        .set({ name: JSON.stringify(input.name), actions: JSON.stringify(input.actions), updated_at: sql`now()` })
        .where("owner_kind", "=", "rabaed")
        .where("work_item_type_id", "=", type.id)
        .where("code", "=", code)
        .execute();
      return { target: { kind: "outcome", id: type.id }, before: { typeCode, code, ...before }, after: { typeCode, code, name: input.name, actions: input.actions }, result: null };
    }),
  );
}

/** Puts the Rabaed Default set of Type `typeCode` in the order of `codes`, which must name every outcome once. */
export function reorderDefaultOutcomes(db: Db, engineerId: string, typeCode: string, input: { codes: string[]; reason: string }): Promise<Refusable<null, SetRefusal>> {
  return refusable(() =>
    asEngineer(db, { engineerId, action: "reorder_default_outcomes", reason: input.reason }, async (trx) => {
      const type = await outcomeTarget(trx, typeCode);
      if (!type) throw new Refused("not_found");
      await lockOutcomeSet(trx, type.id);
      const current = await trx.selectFrom("outcome").select("code").where("owner_kind", "=", "rabaed").where("work_item_type_id", "=", type.id).orderBy("sort").execute();
      if (!isPermutation(current.map((o) => o.code), input.codes)) throw new Refused("invalid_order");
      for (const [index, code] of input.codes.entries()) {
        await trx.updateTable("outcome").set({ sort: index + 1 }).where("owner_kind", "=", "rabaed").where("work_item_type_id", "=", type.id).where("code", "=", code).execute();
      }
      return { target: { kind: "outcome", id: type.id }, before: { typeCode, codes: current.map((o) => o.code) }, after: { typeCode, codes: input.codes }, result: null };
    }),
  );
}

const stageRows = (trx: Db, moduleKey: ModuleKey) => trx.selectFrom("stage").where("owner_kind", "=", "rabaed").where("module_key", "=", moduleKey);

/** Adds a Stage to the Module's Rabaed Defaults, last in its order; the Projects created afterwards get it. */
export function addDefaultStage(
  db: Db,
  engineerId: string,
  moduleKey: ModuleKey,
  input: { key: string; name: BilingualText; category: StageCategory; reason: string },
): Promise<Refusable<null, SetRefusal>> {
  return refusable(() =>
    asEngineer(db, { engineerId, action: "add_default_stage", reason: input.reason }, async (trx) => {
      await lockStageSet(trx, moduleKey);
      const existing = await stageRows(trx, moduleKey).select(["key", "sort"]).execute();
      if (existing.some((s) => s.key === input.key)) throw new Refused("already_exists");
      await trx
        .insertInto("stage")
        .values({
          owner_kind: "rabaed",
          project_id: null,
          module_key: moduleKey,
          key: input.key,
          name: JSON.stringify(input.name),
          category: input.category,
          sort: Math.max(0, ...existing.map((s) => s.sort)) + 1,
        })
        .execute();
      return { target: { kind: "stage", id: null }, after: { moduleKey, key: input.key, name: input.name, category: input.category }, result: null };
    }),
  );
}

/** Renames a Rabaed Default Stage (its key and category stay); Projects' own Stage sets stay theirs. */
export function renameDefaultStage(db: Db, engineerId: string, moduleKey: ModuleKey, key: string, input: { name: BilingualText; reason: string }): Promise<Refusable<null, SetRefusal>> {
  return refusable(() =>
    asEngineer(db, { engineerId, action: "rename_default_stage", reason: input.reason }, async (trx) => {
      const before = await stageRows(trx, moduleKey).select("name").where("key", "=", key).forUpdate().executeTakeFirst();
      if (!before) throw new Refused("not_found");
      await trx.updateTable("stage").set({ name: JSON.stringify(input.name), updated_at: sql`now()` }).where("owner_kind", "=", "rabaed").where("module_key", "=", moduleKey).where("key", "=", key).execute();
      return { target: { kind: "stage", id: null }, before: { moduleKey, key, name: before.name }, after: { moduleKey, key, name: input.name }, result: null };
    }),
  );
}

/** Puts the Module's Rabaed Default Stages in the order of `keys`, which must name every Stage once. */
export function reorderDefaultStages(db: Db, engineerId: string, moduleKey: ModuleKey, input: { keys: string[]; reason: string }): Promise<Refusable<null, SetRefusal>> {
  return refusable(() =>
    asEngineer(db, { engineerId, action: "reorder_default_stages", reason: input.reason }, async (trx) => {
      await lockStageSet(trx, moduleKey);
      const current = await stageRows(trx, moduleKey).select("key").orderBy("sort").execute();
      if (!isPermutation(current.map((s) => s.key), input.keys)) throw new Refused("invalid_order");
      for (const [index, key] of input.keys.entries()) {
        await trx.updateTable("stage").set({ sort: index + 1 }).where("owner_kind", "=", "rabaed").where("module_key", "=", moduleKey).where("key", "=", key).execute();
      }
      return { target: { kind: "stage", id: null }, before: { moduleKey, keys: current.map((s) => s.key) }, after: { moduleKey, keys: input.keys }, result: null };
    }),
  );
}
