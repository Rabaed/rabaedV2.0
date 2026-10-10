import { withMember, type Database, type Db } from "@rabaed/db";
import {
  activityFeedQuery,
  byNewestWaiting,
  homeActivityLimit,
  homeActivityVerb,
  homeNeedsMyActionLimit,
  homeStepAgeWeeks,
  mergeActivity,
  workItemQuery,
  type Home,
  type HomeWorkItem,
  type HomeActivityOutcome,
  type OutcomeAction,
  type OutcomePolarity,
  type ProjectSummary,
  type TransitionKind,
  type WorkItemQueryInput,
  type WorkItemRow,
} from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { myProjectSummaries, waitingOnMember } from "../projects/projects.ts";
import { activityFeedPage } from "../work-items/activity-feed.ts";
import { countWorkItems, pagesByCursor, queryWorkItems, type QueryScope } from "../work-items/query.ts";

// Home across my Projects (RP-407, spec RP-447; visibility.md "Home across
// Projects"). Home has no read of its own: it runs the per-Project reads the
// Member already has (the Projects page's Need My Action rows, the work item
// query's counts and rows, the Activity Feed) over each of their active
// Projects, inside one transaction as the Member, and sums or merges them here.
// Whatever a per-Project read hides, Home can't show. A closed Project
// contributes nothing.

type Trx = Transaction<Database>;

/** Every row of the work item query for `scope` and `q`, page after page: only for Need My Action, a few rows. */
async function everyRow(trx: Trx, scope: QueryScope, q: WorkItemQueryInput, now: Date): Promise<WorkItemRow[]> {
  const rows: WorkItemRow[] = [];
  const query = workItemQuery.parse(q);
  // Only a cursor pages to the end: a numbered page or a List-only sort would give one page, silently (RP-409).
  if (!pagesByCursor(query)) throw new Error("everyRow reads every row by cursor: give it a cursor sort in its own order, and no page");
  let cursor: string | undefined;
  do {
    const page = await queryWorkItems(trx, scope, workItemQuery.parse({ ...q, ...(cursor ? { cursor } : {}) }), now);
    rows.push(...page.rows);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}

/** How many items match `q` in the scope, by Stage key: the List's `stages[].count`, no rows read. */
const counted = (trx: Trx, scope: QueryScope, q: WorkItemQueryInput, now: Date) => countWorkItems(trx, scope, workItemQuery.parse(q), now);
const total = (counts: Map<string, number>, keep: (stageKey: string) => boolean = () => true) =>
  [...counts].reduce((n, [key, count]) => n + (keep(key) ? count : 0), 0);

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

    // The Draft Stages, which never age on Home: a Revision's Draft has a number, so the List ages it.
    const draftStages = new Set(
      active.length === 0
        ? []
        : (
            await trx
              .selectFrom("stage")
              .select(["project_id", "module_key", "key"])
              .where("project_id", "in", active.map((p) => p.id))
              .where("category", "=", "draft")
              .execute()
          ).map((s) => `${s.project_id}/${s.module_key}/${s.key}`),
    );

    // The List's own counts for each Module: its Submittals (the card's count), my own Participant's open
    // items at their Step for 4+ weeks as the List ages them for me (V14; never a Draft), and my own
    // Participant's open items another Participant holds now.
    let longAtStep = 0;
    let waitingWithOthers = 0;
    const submittals: Record<string, number> = Object.fromEntries(active.map((p) => [p.id, 0]));
    for (const { project, ...scope } of scopes) {
      if (scope.moduleKey === "submittals") submittals[project.id] = total(await counted(trx, scope, {}, now));
      const aged = await counted(trx, scope, { stepAgeMin: homeStepAgeWeeks, heldBy: "own" }, now);
      longAtStep += total(aged, (key) => !draftStages.has(`${project.id}/${scope.moduleKey}/${key}`));
      waitingWithOthers += total(await counted(trx, scope, { raisedByMe: true, heldBy: "others" }, now));
    }

    // Recent activity: each Project's newest entries, merged, each with what was done (its Transition's
    // kind, a Code's own kind from its polarity and actions), read through the same RLS as the feed: only the events it shows.
    const page = activityFeedQuery.parse({ limit: homeActivityLimit });
    const feeds = [];
    for (const p of active) feeds.push((await activityFeedPage(trx, p.id, page)).entries.map((e) => ({ ...e, project: ref(p) })));
    const shown = mergeActivity(feeds, homeActivityLimit);
    const how = new Map<string, { kind: TransitionKind | null; outcome: HomeActivityOutcome | null }>();
    if (shown.length > 0) {
      const { rows } = await sql<{ id: string; kind: TransitionKind | null; polarity: OutcomePolarity | null; actions: OutcomeAction[] | null }>`
        select e.id, t.kind, o.polarity, o.actions
        from work_item_event e
        join work_item w on w.id = e.work_item_id
        left join workflow_transition t on t.id = e.transition_id
        left join outcome o on o.project_id = e.project_id and o.work_item_type_id = w.work_item_type_id and o.code = e.payload ->> 'outcome'
        where e.id = any(${shown.map((e) => e.id)}::uuid[])
      `.execute(trx);
      for (const r of rows) how.set(r.id, { kind: r.kind, outcome: r.polarity ? { polarity: r.polarity, actions: r.actions ?? [] } : null });
    }

    return {
      counts: {
        activeProjects: active.length,
        needMyAction: active.reduce((n, p) => n + p.needMyAction, 0),
        longAtStep,
        waitingWithOthers,
      },
      needsMyAction: needsMyAction.toSorted(byNewestWaiting).slice(0, homeNeedsMyActionLimit),
      activity: shown.map((e) => ({ ...e, verb: homeActivityVerb(e.type, how.get(e.id)?.kind ?? null, e.outcome ? (how.get(e.id)?.outcome ?? null) : null) })),
      projects,
      submittals,
    };
  });
}
