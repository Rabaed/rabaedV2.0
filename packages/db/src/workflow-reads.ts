import type { BilingualText, StageCategory } from "@rabaed/domain";
import { sql, type Expression } from "kysely";
import type { Db } from "./client.ts";
import type { PositionTable } from "./schema.ts";

// What every Workflow read draws a map with (RP-528 review): the Module's Stages, the
// Positions a Step's actor names, and the Version new items start on. The api's builder,
// map and Version reads and Rabaed Admin's builder read share them, each through its own
// connection (the app role's row-level security, or the admin role).

/**
 * The latest published Version number of the Workflow `definitionId` refers to (a column or
 * a value), null while it has none: the Version new items start on.
 */
export const latestPublishedVersionNo = (definitionId: Expression<unknown>) =>
  sql<number | null>`(select max(lpv.version_no) from workflow_version lpv where lpv.workflow_definition_id = ${definitionId} and lpv.status = 'published')`;

export type ModuleStage = { key: string; name: BilingualText; category: StageCategory };

/** Module `moduleKey`'s Stages in order: Project `projectId`'s own set, or the Rabaed Defaults' for null. */
export async function readModuleStages(db: Db, moduleKey: string, projectId: string | null): Promise<ModuleStage[]> {
  const { rows } = await sql<ModuleStage>`
    select key, name, category from stage
    where module_key = ${moduleKey} and project_id is not distinct from ${projectId}::uuid
    order by sort, key
  `.execute(db);
  return rows;
}

export type PositionChoice = { role: PositionTable["base_role"]; key: string; name: BilingualText };

/** The Positions a Step's actor may name, by base role and order: every one, or only those of `keys`. */
export async function readPositions(db: Db, keys?: readonly string[]): Promise<PositionChoice[]> {
  if (keys !== undefined && keys.length === 0) return [];
  let query = db.selectFrom("position").select(["base_role", "key", "name"]);
  if (keys !== undefined) query = query.where("key", "in", [...keys]);
  const rows = await query.orderBy("base_role").orderBy("sort").execute();
  return rows.map((p) => ({ role: p.base_role, key: p.key, name: p.name as BilingualText }));
}
