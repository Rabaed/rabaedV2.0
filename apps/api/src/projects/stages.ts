import { withMember, type Db } from "@rabaed/db";
import {
  stageRefusals,
  type AddStageRequest,
  type BilingualText,
  type ModuleKey,
  type ProjectStages,
  type StageCategory,
} from "@rabaed/domain";
import { sql } from "kysely";
import { isProjectAdmin, projectAdminCommand } from "./project-admin.ts";

// A Project's Stages per Module (RP-428, WF-5; workflow-engine.md "Stages"). Every
// Project Member reads them (stage's RLS: they are the Kanban columns everyone
// sees); only a Project Admin changes them, through app.rename_stage,
// app.add_stage, app.reorder_stages and app.delete_stage, each audited. Anyone
// else gets 'not_found'.

export type StageCommandResult = { ok: true } | { ok: false; reason: (typeof stageRefusals)[number] };

/** The Project's Stages of `moduleKey` in their order, for its Project Members; null for anyone else. */
export function getProjectStages(db: Db, memberId: string, projectId: string, moduleKey: ModuleKey): Promise<ProjectStages | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const { rows } = await sql<{ key: string; name: BilingualText; category: StageCategory; in_use: boolean }>`
      select s.key, s.name, s.category, app.stage_in_use(s.project_id, s.module_key, s.key) as in_use
      from stage s
      where s.project_id = ${projectId}::uuid and s.module_key = ${moduleKey}
      order by s.sort, s.key
    `.execute(trx);
    return {
      canEdit: await isProjectAdmin(trx, projectId),
      stages: rows.map((r) => ({ key: r.key, name: r.name, category: r.category, inUse: r.in_use })),
    };
  });
}

/** A Project Admin renames a Stage, in English and Arabic. */
export const renameStage = (db: Db, memberId: string, projectId: string, moduleKey: ModuleKey, key: string, name: BilingualText): Promise<StageCommandResult> =>
  projectAdminCommand(
    db,
    memberId,
    sql`select app.rename_stage(${projectId}::uuid, ${moduleKey}, ${key}, ${JSON.stringify(name)}::jsonb) as outcome`,
    "renamed",
    stageRefusals,
  );

/** A Project Admin adds a Stage, last in the Module's order. */
export const addStage = (db: Db, memberId: string, projectId: string, moduleKey: ModuleKey, input: AddStageRequest): Promise<StageCommandResult> =>
  projectAdminCommand(
    db,
    memberId,
    sql`select app.add_stage(${projectId}::uuid, ${moduleKey}, ${input.key}, ${JSON.stringify(input.name)}::jsonb, ${input.category}) as outcome`,
    "added",
    stageRefusals,
  );

/** A Project Admin puts the Module's Stages in a new order: every key, each once. */
export const reorderStages = (db: Db, memberId: string, projectId: string, moduleKey: ModuleKey, keys: readonly string[]): Promise<StageCommandResult> =>
  projectAdminCommand(
    db,
    memberId,
    sql`select app.reorder_stages(${projectId}::uuid, ${moduleKey}, ${[...keys]}::text[]) as outcome`,
    "reordered",
    stageRefusals,
  );

/** A Project Admin deletes a Stage no Step of the Project's Workflows uses. */
export const deleteStage = (db: Db, memberId: string, projectId: string, moduleKey: ModuleKey, key: string): Promise<StageCommandResult> =>
  projectAdminCommand(db, memberId, sql`select app.delete_stage(${projectId}::uuid, ${moduleKey}, ${key}) as outcome`, "removed", stageRefusals);
