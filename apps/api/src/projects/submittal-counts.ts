import type { Database } from "@rabaed/db";
import { workItemQuery, type ProjectSummary } from "@rabaed/domain";
import type { Transaction } from "kysely";
import { countWorkItems, stageCountTotal, type QueryScope } from "../work-items/query.ts";

/**
 * Each Project's Submittals the Member sees, for its card (Home and the Projects
 * page): the count of the Project's Submittals List as the Member reads it (the
 * List's own Stage counts, the latest Revision of each chain, open and closed),
 * so never an item the List hides, another Company's internal ones included.
 * With the Project setting "Show Inspections in the Submittals tab" (RP-652) the List also lists the Inspections
 * items, and so does this count. 0 for a Project with no Submittals Module. Run inside the Member's transaction.
 */
export async function submittalCounts(trx: Transaction<Database>, projects: readonly ProjectSummary[], now: Date): Promise<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(projects.map((p) => [p.id, 0]));
  for (const p of projects) {
    if (!p.modules.includes("submittals")) continue;
    const scope: QueryScope = { projectId: p.id, moduleKey: "submittals", ...(p.showInspectionsInSubmittals ? { alsoModules: ["inspections"] } : {}) };
    const stages = await countWorkItems(trx, scope, workItemQuery.parse({}), now);
    counts[p.id] = stageCountTotal(stages);
  }
  return counts;
}
