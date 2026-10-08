import { withMember, type Database, type Db } from "@rabaed/db";
import {
  activityFeedQuery,
  byNewestWaiting,
  homeActivityLimit,
  homeNeedsMyActionLimit,
  homeStepAgeWeeks,
  mergeActivity,
  workItemQuery,
  type Home,
  type HomeWorkItem,
  type ProjectSummary,
  type WorkItemQueryInput,
  type WorkItemRow,
} from "@rabaed/domain";
import type { Transaction } from "kysely";
import { myProjectSummaries, waitingOnMember } from "../projects/projects.ts";
import { activityFeedPage } from "../work-items/activity-feed.ts";
import { queryWorkItems, type QueryScope } from "../work-items/query.ts";

// Home across my Projects (RP-407, spec RP-447; visibility.md "Home across
// Projects"). Home has no read of its own: it runs the per-Project reads the
// Member already has (the Projects page's Need My Action rows, the work item
// query, the Activity Feed) over each of their active Projects, inside one
// transaction as the Member, and sums or merges them here. Whatever a
// per-Project read hides, Home can't show. A closed Project contributes nothing.

type Trx = Transaction<Database>;

/** Every row of the work item query for `scope` and `q`, page after page. */
async function everyRow(trx: Trx, scope: QueryScope, q: WorkItemQueryInput, now: Date): Promise<WorkItemRow[]> {
  const rows: WorkItemRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await queryWorkItems(trx, scope, workItemQuery.parse({ ...q, ...(cursor ? { cursor } : {}) }), now);
    rows.push(...page.rows);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}

/** Each Module tab of each Project: where the work item query reads. */
const scopesOf = (projects: readonly ProjectSummary[]) =>
  projects.flatMap((p) => p.modules.map((moduleKey): QueryScope & { project: ProjectSummary } => ({ projectId: p.id, moduleKey, project: p })));

/** Home as the Member sees it, now. */
export function getHome(db: Db, memberId: string, now: Date): Promise<Home> {
  return withMember(db, memberId, async (trx) => {
    const projects = await myProjectSummaries(trx, memberId);
    const active = projects.filter((p) => p.status === "active");
    const scopes = scopesOf(active);
    const ref = (p: ProjectSummary) => ({ id: p.id, code: p.code, name: p.name });

    // Need My Action: the List's toggle rows that are the Projects page's count (never a Draft of mine).
    const waiting = new Set((await waitingOnMember(trx, active.map((p) => p.id))).map((w) => w.id));
    const needsMyAction: HomeWorkItem[] = [];
    for (const { project, ...scope } of scopes) {
      for (const row of await everyRow(trx, scope, { needMyAction: true }, now)) {
        if (waiting.has(row.id)) needsMyAction.push({ ...row, project: ref(project), moduleKey: scope.moduleKey });
      }
    }

    // At their Step for 4+ weeks: open items my own Participant holds ("With" is "own"), aged as the List
    // ages them for me (V14); a Draft never.
    let longAtStep = 0;
    for (const scope of scopes) {
      const aged = await everyRow(trx, scope, { stepAgeMin: homeStepAgeWeeks }, now);
      longAtStep += aged.filter((r) => r.with?.kind === "own" && r.stage.category !== "draft").length;
    }

    // Recent activity: each Project's newest entries, merged.
    const page = activityFeedQuery.parse({ limit: homeActivityLimit });
    const feeds = [];
    for (const p of active) feeds.push((await activityFeedPage(trx, p.id, page)).entries.map((e) => ({ ...e, project: ref(p) })));

    return {
      counts: {
        activeProjects: active.length,
        needMyAction: active.reduce((n, p) => n + p.needMyAction, 0),
        longAtStep,
      },
      needsMyAction: needsMyAction.toSorted(byNewestWaiting).slice(0, homeNeedsMyActionLimit),
      activity: mergeActivity(feeds, homeActivityLimit),
      projects,
    };
  });
}
