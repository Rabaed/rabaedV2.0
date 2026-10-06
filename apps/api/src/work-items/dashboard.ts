import { withMember, type Db } from "@rabaed/db";
import { dashboardCard, moduleKeys, workItemQuery, type BilingualText, type ChainBucket, type Dashboard, type OutcomeKind } from "@rabaed/domain";
import { countWorkItemBuckets } from "./query.ts";

// The Dashboard's Type cards (RP-351, spec RP-344; visibility.md "Dashboard and
// Location Status"). Each Module that has a Work Item Type on the Project gets
// one card per Type, counted by the work item query over the viewer's visible
// items, one per Revision chain, by bucket (chainBucket). Each number carries
// the `type` and `bucket` filter that lists exactly the chains it counts.

/** The Dashboard of one of the Member's Projects, or null when it isn't one of theirs. */
export function getDashboard(db: Db, memberId: string, projectId: string, now: Date): Promise<Dashboard | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const types = await trx
      .selectFrom("work_item_type")
      .select(["module_key", "code", "name", "outcome_kind"])
      .where((eb) => eb.or([eb("project_id", "is", null), eb("project_id", "=", projectId)]))
      .orderBy("code")
      .execute();
    const everything = workItemQuery.parse({});
    const modules: Dashboard["modules"] = [];
    for (const key of moduleKeys) {
      const ofModule = types.filter((t) => t.module_key === key);
      if (ofModule.length === 0) continue;
      const counts = await countWorkItemBuckets(trx, { projectId, moduleKey: key }, everything, now);
      modules.push({
        key,
        cards: ofModule.map((t) =>
          dashboardCard({
            type: { code: t.code, name: t.name as BilingualText },
            moduleKey: key,
            outcomeKind: t.outcome_kind as OutcomeKind,
            counts: new Map<ChainBucket | null, number>(counts.filter((c) => c.typeCode === t.code).map((c) => [c.bucket, c.count])),
          }),
        ),
      });
    }
    return { modules };
  });
}
