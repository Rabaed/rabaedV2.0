// What the Rabaed Default Work Item Types are, read from the database, so a test
// need not assume which they are (the MAR was once the only one; the Comment joined it,
// RP-434, and more will). A test that lists Types or Modules derives its expectation here.
import { moduleTabOrder, type ModuleKey } from "@rabaed/domain";
import type { Db } from "@rabaed/db";
import { sql } from "kysely";

/**
 * The Modules a new Project has a tab for (RP-346): those with a Rabaed Default Type,
 * plus `extra` Modules, in the order of the tabs. `migrator` reads as the migrator.
 */
export async function defaultModules(migrator: Db, extra: readonly ModuleKey[] = []): Promise<ModuleKey[]> {
  const { rows } = await sql<{ module_key: ModuleKey }>`select distinct module_key from work_item_type where owner_kind = 'rabaed'`.execute(migrator);
  const have = new Set<ModuleKey>([...rows.map((r) => r.module_key), ...extra]);
  return moduleTabOrder.filter((m) => have.has(m));
}

/**
 * The codes of the Types a Project can raise in `module`: the Rabaed Defaults and the
 * Project's own, sorted (the List's Type filter).
 */
export async function typeCodes(migrator: Db, module: ModuleKey, projectId: string): Promise<string[]> {
  const { rows } = await sql<{ code: string }>`
    select code from work_item_type
    where module_key = ${module} and (owner_kind = 'rabaed' or project_id = ${projectId}::uuid)
  `.execute(migrator);
  return rows.map((r) => r.code).sort();
}
