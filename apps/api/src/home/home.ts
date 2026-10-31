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
  type BilingualText,
  type Home,
  type HomeWorkItem,
  type HomeActivityOutcome,
  type OutcomeAction,
  type OutcomePolarity,
  type ProjectSummary,
  type TransitionKind,
  type WorkItemQueryInput,
} from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { myProjectSummaries, waitingOnMember } from "../projects/projects.ts";
import { submittalCounts } from "../projects/submittal-counts.ts";
import { activityFeedPage } from "../work-items/activity-feed.ts";
import { countWorkItems, listKeysAmong, listRowsAmong, stageCountTotal, type QueryScope } from "../work-items/query.ts";

// Home across my Projects (RP-407, spec RP-447; visibility.md "Home across
// Projects"). Home has no read of its own: it runs the per-Project reads the
// Member already has (the Projects page's Need My Action rows, the work item
// query's counts and rows, the Activity Feed) over each of their active
// Projects, inside one transaction as the Member, and sums or merges them here.
// Whatever a per-Project read hides, Home can't show. A closed Project
// contributes nothing to the counts and lists; its card still shows its Submittals count.

type Trx = Transaction<Database>;

/** How many items match `q` in the scope, by Stage key: the List's `stages[].count`, no rows read. */
const counted = (trx: Trx, scope: QueryScope, q: WorkItemQueryInput, now: Date) => countWorkItems(trx, scope, workItemQuery.parse(q), now);

/** The shown items' ids, grouped by the Project and Module tab they were read in. */
function shownByScope<S>(shown: readonly { id: string; project: ProjectSummary; scope: S }[]) {
  const groups = new Map<S, { project: ProjectSummary; scope: S; ids: string[] }>();
  for (const { id, project, scope } of shown) {
    const group = groups.get(scope) ?? { project, scope, ids: [] };
    group.ids.push(id);
    groups.set(scope, group);
  }
  return [...groups.values()];
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

    // Need My Action: the List's toggle rows that are the Projects page's count (never a Draft of mine). Those are the
    // List's rows among the items waiting on me: each waits on me, so the toggle shows it wherever the List does (RP-1050).
    // Asked of every Project, as myProjectSummaries just asked (read once); a closed one has none waiting.
    const waiting = await waitingOnMember(trx, projects.map((p) => p.id));
    // Home shows the newest few: ordered by what the rows give, then only those read whole.
    const keys = [];
    for (const { project, ...scope } of scopes) {
      const ids = waiting.filter((w) => w.projectId === project.id).map((w) => w.id);
      for (const key of await listKeysAmong(trx, scope, ids, now)) keys.push({ ...key, project, scope });
    }
    const needsMyAction: HomeWorkItem[] = [];
    for (const { project, scope, ids } of shownByScope(keys.toSorted(byNewestWaiting).slice(0, homeNeedsMyActionLimit))) {
      for (const row of await listRowsAmong(trx, scope, ids, now)) needsMyAction.push({ ...row, project: ref(project), moduleKey: scope.moduleKey });
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
    const submittals = await submittalCounts(trx, projects, now);
    for (const { project, ...scope } of scopes) {
      const aged = await counted(trx, scope, { stepAgeMin: homeStepAgeWeeks, heldBy: "own" }, now);
      longAtStep += stageCountTotal(aged, (key) => !draftStages.has(`${project.id}/${scope.moduleKey}/${key}`));
      waitingWithOthers += stageCountTotal(await counted(trx, scope, { raisedByMe: true, heldBy: "others" }, now));
    }

    // Recent activity: each Project's newest entries, merged, each with what was done (its Transition's
    // kind, a Code's own kind from its polarity and actions), read through the same RLS as the feed: only the events it shows.
    const page = activityFeedQuery.parse({ limit: homeActivityLimit });
    const feeds = [];
    for (const p of active) feeds.push((await activityFeedPage(trx, p.id, page)).entries.map((e) => ({ ...e, project: ref(p) })));
    const shown = mergeActivity(feeds, homeActivityLimit);
    const how = new Map<string, { kind: TransitionKind | null; outcome: HomeActivityOutcome | null; outcomeName: BilingualText | null }>();
    if (shown.length > 0) {
      const { rows } = await sql<{
        id: string;
        kind: TransitionKind | null;
        polarity: OutcomePolarity | null;
        actions: OutcomeAction[] | null;
        outcome_name: BilingualText | null;
      }>`
        -- A Review Code reads "Code B"; any other outcome by its own name, such as the Inspection
        -- Result a WIR on Workflow Version 1 or 2 ends with though its Type issues Codes (RP-673):
        -- its Step issues Inspection Results, so its event is no issue_code.
        select e.id, t.kind, o.polarity, o.actions,
          case when wt.outcome_kind <> 'review_code' or e.type <> 'issue_code' then o.name end as outcome_name
        from work_item_event e
        join work_item w on w.id = e.work_item_id
        join work_item_type wt on wt.id = w.work_item_type_id
        -- The Transition's kind, which everyone who reads the event is shown; its id is the actor's own (RP-1140).
        left join app.event_transitions(${shown.map((e) => e.id)}::uuid[]) t on t.event_id = e.id
        left join outcome o on o.project_id = e.project_id and o.work_item_type_id = w.work_item_type_id and o.code = e.payload ->> 'outcome'
        where e.id = any(${shown.map((e) => e.id)}::uuid[])
      `.execute(trx);
      for (const r of rows)
        how.set(r.id, { kind: r.kind, outcome: r.polarity ? { polarity: r.polarity, actions: r.actions ?? [] } : null, outcomeName: r.outcome_name });
    }

    return {
      counts: {
        activeProjects: active.length,
        needMyAction: active.reduce((n, p) => n + p.needMyAction, 0),
        longAtStep,
        waitingWithOthers,
      },
      needsMyAction: needsMyAction.toSorted(byNewestWaiting).slice(0, homeNeedsMyActionLimit),
      activity: shown.map((e) => ({
        ...e,
        verb: homeActivityVerb(e.type, how.get(e.id)?.kind ?? null, e.outcome ? (how.get(e.id)?.outcome ?? null) : null),
        outcomeName: e.outcome ? (how.get(e.id)?.outcomeName ?? null) : null,
      })),
      projects,
      submittals,
    };
  });
}
