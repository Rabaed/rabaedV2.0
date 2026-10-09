import { withMember, type Db } from "@rabaed/db";
import {
  dashboardCard,
  moduleKeys,
  workItemQuery,
  type BilingualText,
  type Dashboard,
  type Outcome,
  type OutcomeKind,
} from "@rabaed/domain";
import { sql } from "kysely";
import { countWorkItemBuckets } from "./query.ts";

// The Dashboard's Type cards (RP-351, spec RP-344; visibility.md "Dashboard and
// Location Status"). Each Module that has a Work Item Type on the Project gets
// one card per Type, counted by the work item query over the viewer's visible
// items, one per Revision chain, by bucket (chainBucket). Each number carries
// the `type` and `bucket` filter that lists exactly the chains it counts; a
// `review_code` Type's Code C line (RP-352) is counted from the same rows by
// Code C state (codeCState), each figure carrying its `codeC` filter.

/** The counts summed by one key. */
function sumBy<T extends { count: number }, K>(counts: readonly T[], key: (c: T) => K): Map<K, number> {
  const sums = new Map<K, number>();
  for (const c of counts) sums.set(key(c), (sums.get(key(c)) ?? 0) + c.count);
  return sums;
}

/** The Dashboard of one of the Member's Projects, or null when it isn't one of theirs. */
export function getDashboard(db: Db, memberId: string, projectId: string, now: Date): Promise<Dashboard | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const types = await trx
      .selectFrom("work_item_type")
      .select(["id", "module_key", "code", "name", "outcome_kind"])
      .where((eb) => eb.or([eb("project_id", "is", null), eb("project_id", "=", projectId)]))
      .orderBy("code")
      .execute();
    // Each Type's outcome set on the Project (RP-429): its bars, their names, the Approved % and the Code C line.
    const { rows: outcomes } = await sql<Outcome & { type_id: string }>`
      select o.work_item_type_id as type_id, o.code, o.name, o.closing, o.polarity, o.actions
      from outcome o where o.project_id = ${projectId}::uuid
      order by o.sort, o.code
    `.execute(trx);
    const everything = workItemQuery.parse({});
    const modules: Dashboard["modules"] = [];
    for (const key of moduleKeys) {
      const ofModule = types.filter((t) => t.module_key === key);
      if (ofModule.length === 0) continue;
      const counts = await countWorkItemBuckets(trx, { projectId, moduleKey: key }, everything, now);
      modules.push({
        key,
        cards: ofModule.map((t) => {
          const ofType = counts.filter((c) => c.typeCode === t.code);
          return dashboardCard({
            type: { code: t.code, name: t.name as BilingualText },
            moduleKey: key,
            outcomeKind: t.outcome_kind as OutcomeKind,
            outcomes: outcomes.filter((o) => o.type_id === t.id).map(({ type_id: _, ...o }) => o),
            counts: sumBy(ofType, (c) => c.bucket),
            codeCCounts: sumBy(ofType, (c) => c.codeC),
          });
        }),
      });
    }
    return { modules };
  });
}
