import { withMember, type Database, type Db, type ModuleKey } from "@rabaed/db";
import {
  boardLanes,
  closedColumnDays,
  decodeWorkItemCursor,
  encodeWorkItemCursor,
  enteredStepBy,
  isOpenStageCategory,
  stepAgeWeeks,
  workItemPageSize,
  type BilingualText,
  type BoardCardInput,
  type WorkItemBoard,
  type WorkItemList,
  type WorkItemOutcome,
  type WorkItemQuery,
  type WorkItemRow,
  type WorkItemSummary,
} from "@rabaed/domain";
import { sql, type RawBuilder, type Transaction } from "kysely";

// The work item query (spec RP-344): the one read of a Project's Work Items that
// the List uses, and that the Kanban, the Dashboard's drill-downs, Need My Action
// counts and Search build on. Every number they show comes from here, so a count
// can never disagree with the rows behind it.
//
// It reads through RLS, which answers only with the items the Member can see
// (data-model.md §10), and app.step_as_seen, which gives the Step, its Stage and
// Step Age as the viewer may see them: another Company sees only when the item
// reached the holder, never its internal moves (V14). By default each Revision
// chain is one row, the latest Revision the viewer sees (V1 applies to each
// Revision on its own: app.latest_visible_revision).
//
// "With" follows V14 too: the viewer's own Participant sees the Step and who
// claimed it; anyone else sees the holding Company's name only, which is all
// app.work_item_holder gives them.
//
// A new filter is a new key of WorkItemQuery and one more condition in
// `matching`; the page, the counts and the "With" values all follow it.

type Trx = Transaction<Database>;

/** The Module the query reads: the Submittals tab's for now; Module tabs come with RP-346. */
export type QueryScope = { projectId: string; moduleKey: ModuleKey };

type Row = {
  id: string;
  project_id: string;
  type_code: string;
  type_name: BilingualText;
  title: string;
  document_number: string | null;
  revision_no: number;
  outcome: WorkItemOutcome | null;
  stage_key: string;
  stage_name: BilingualText;
  stage_category: WorkItemSummary["stage"]["category"];
  trade_id: string;
  trade_code: string;
  trade_name: BilingualText;
  location_id: string | null;
  location_code: string | null;
  location_name: BilingualText | null;
  step_entered_at: Date;
  /** step_entered_at to the microsecond, for the cursor. */
  entered_key: string;
  closed: boolean;
  holder_participant_id: string | null;
  assignee_member_id: string | null;
  held_by_own: boolean;
  step_key: string;
  step_name: BilingualText;
  holder_name: BilingualText | null;
  claimer_name: BilingualText | null;
  claimed_by_me: boolean;
};

/**
 * The visible items of the scope as rows: the latest Revision of each chain
 * unless `allRevisions`. The holder's Participant and Member come from
 * app.work_item_holder, so another Company's Member is never read.
 */
function visibleRows({ projectId, moduleKey }: QueryScope, allRevisions: boolean): RawBuilder<unknown> {
  return sql`
    select w.id, w.project_id, t.code as type_code, t.name as type_name, w.title, w.document_number,
      w.revision_no, w.outcome,
      st.key as stage_key, st.name as stage_name, st.category as stage_category,
      tv.id as trade_id, tv.code as trade_code, tv.name as trade_name,
      lv.id as location_id, lv.code as location_code, lv.name as location_name,
      seen.entered_at as step_entered_at,
      -- Closed (or cancelled): it no longer ages, nor is it with anyone. The SQL side of isOpenStageCategory.
      st.category not in ('draft', 'in_progress') as closed,
      to_char(seen.entered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as entered_key,
      h.participant_id as holder_participant_id, h.assignee_member_id,
      coalesce(h.participant_id in (select app.current_participant_ids()), false) as held_by_own,
      s.key as step_key, s.name as step_name
    from work_item w
    cross join lateral app.step_as_seen(w.id) seen
    join workflow_step s on s.id = seen.step_id
    join work_item_type t on t.id = w.work_item_type_id
    join stage st on st.module_key = t.module_key and st.key = seen.stage_key and st.project_id is null
    join visibility_dimension td on td.project_id = w.project_id and td.kind = 'trade'
    join work_item_dimension_value tdv on tdv.work_item_id = w.id and tdv.dimension_id = td.id
    join dimension_value tv on tv.id = tdv.dimension_value_id
    join visibility_dimension ld on ld.project_id = w.project_id and ld.kind = 'location'
    left join work_item_dimension_value ldv on ldv.work_item_id = w.id and ldv.dimension_id = ld.id
    left join dimension_value lv on lv.id = ldv.dimension_value_id
    -- One holder: a closed item has none.
    left join lateral (select * from app.work_item_holder(w.id) limit 1) h on true
    where w.project_id = ${projectId} and t.module_key = ${moduleKey}
      and (${allRevisions}::boolean or app.latest_visible_revision(w.id))
  `;
}

const noFilter = sql<boolean>`true`;

/** The rows of `visibleRows` (as `r`) that match the query's filters; the cursor aside. */
function matching(q: WorkItemQuery, now: Date): RawBuilder<boolean> {
  const conditions: RawBuilder<boolean>[] = [];
  if (q.type.length > 0) conditions.push(sql`r.type_code = any(${q.type}::text[])`);
  if (q.stage.length > 0) conditions.push(sql`r.stage_key = any(${q.stage}::text[])`);
  if (q.trade.length > 0) conditions.push(sql`r.trade_id = any(${q.trade}::uuid[])`);
  if (q.location.length > 0) {
    // A Location takes in the ones under it.
    conditions.push(sql`r.location_id in (
      with recursive under as (
        select id from dimension_value where id = any(${q.location}::uuid[])
        union all
        select v.id from dimension_value v join under u on v.parent_id = u.id
      ) select id from under)`);
  }
  if (q.outcome.length > 0) conditions.push(sql`r.outcome = any(${q.outcome}::text[])`);
  if (q.stepAgeMin !== undefined) {
    // A closed item doesn't age.
    conditions.push(sql`not r.closed and r.step_entered_at <= ${enteredStepBy(q.stepAgeMin, now)}::timestamptz`);
  }
  // Steps I hold, unclaimed Steps of my pool, and my own Drafts (app.need_my_action).
  if (q.needMyAction) conditions.push(sql`app.need_my_action(r.id) is not null`);
  if (q.with.length > 0) {
    const steps = q.with.flatMap((v) => (v.startsWith("step:") ? [v.slice(5)] : []));
    const companies = q.with.flatMap((v) => (v.startsWith("company:") ? [v.slice(8)] : []));
    const any: RawBuilder<boolean>[] = [];
    if (q.with.includes("me")) any.push(sql`(r.held_by_own and r.assignee_member_id = app.current_member_id())`);
    if (q.with.includes("unclaimed")) any.push(sql`(r.held_by_own and r.assignee_member_id is null)`);
    if (steps.length > 0) any.push(sql`(r.held_by_own and r.step_key = any(${steps}::text[]))`);
    if (companies.length > 0) any.push(sql`(not r.held_by_own and r.holder_participant_id = any(${companies}::uuid[]))`);
    conditions.push(sql`(${sql.join(any, sql` or `)})`);
  }
  return conditions.length > 0 ? sql`(${sql.join(conditions, sql` and `)})` : noFilter;
}

/** The sort's order and, after a cursor, where the page starts. */
function ordering(q: WorkItemQuery): { orderBy: RawBuilder<unknown>; after: RawBuilder<boolean> } {
  const key = q.cursor === undefined ? null : decodeWorkItemCursor(q.cursor, q.sort);
  if (q.sort === "documentNumber") {
    // Items with no number yet (Drafts) last; numbers compared byte by byte, the same in every locale.
    return {
      orderBy: sql`r.document_number is null, coalesce(r.document_number, '') collate "C", r.id`,
      after: key
        ? sql`(r.document_number is null, coalesce(r.document_number, '') collate "C", r.id) > (${key[0]}::boolean, ${key[1]}::text collate "C", ${key[2]}::uuid)`
        : noFilter,
    };
  }
  // The oldest Step Age first; closed items, which don't age, last.
  return {
    orderBy: sql`r.closed, r.step_entered_at, r.id`,
    after: key ? sql`(r.closed, r.step_entered_at, r.id) > (${key[0]}::boolean, ${key[1]}::timestamptz, ${key[2]}::uuid)` : noFilter,
  };
}

function cursorAfter(q: WorkItemQuery, last: Row): string {
  return q.sort === "documentNumber"
    ? encodeWorkItemCursor(q.sort, [String(last.document_number === null), last.document_number ?? "", last.id])
    : encodeWorkItemCursor(q.sort, [String(last.closed), last.entered_key, last.id]);
}

function toRow(r: Row, now: Date): WorkItemRow {
  const open = isOpenStageCategory(r.stage_category);
  return {
    id: r.id,
    projectId: r.project_id,
    type: { code: r.type_code, name: r.type_name },
    title: r.title,
    documentNumber: r.document_number,
    revisionNo: r.revision_no,
    stage: { key: r.stage_key, name: r.stage_name, category: r.stage_category },
    trade: { id: r.trade_id, code: r.trade_code, name: r.trade_name },
    location: r.location_id ? { id: r.location_id, code: r.location_code!, name: r.location_name! } : null,
    stepEnteredAt: r.step_entered_at.toISOString(),
    stepAgeWeeks: stepAgeWeeks(r.step_entered_at, now),
    outcome: r.outcome,
    with:
      !open || r.holder_name === null
        ? null
        : r.held_by_own
          ? {
              kind: "own",
              companyName: r.holder_name,
              step: { key: r.step_key, name: r.step_name },
              claimer: r.claimer_name ? { name: r.claimer_name, isMe: r.claimed_by_me } : null,
            }
          : { kind: "company", companyName: r.holder_name },
  };
}

// Who holds a row of `visibleRows` (as `r`), by name: only the viewer's own
// Participant's holder is named (app.work_item_holder), and member's own RLS
// shows only their own Company's people (V14).
const holderColumns = sql`hc.legal_name as holder_name,
  m.full_name as claimer_name, coalesce(r.assignee_member_id = app.current_member_id(), false) as claimed_by_me`;
const holderJoins = sql`left join lateral app.work_item_companies(r.id) hc on hc.participant_id = r.holder_participant_id
  left join member m on m.id = r.assignee_member_id`;

/** One page of the scope's visible items matching `q`, and how many match in each Stage. */
export async function queryWorkItems(
  trx: Trx,
  scope: QueryScope,
  q: WorkItemQuery,
  now: Date,
): Promise<{ rows: WorkItemRow[]; nextCursor: string | null; stageCounts: Map<string, number> }> {
  const rows = visibleRows(scope, q.allRevisions);
  const where = matching(q, now);
  const { orderBy, after } = ordering(q);
  const { rows: page } = await sql<Row>`
    with r as (${rows})
    select r.*, ${holderColumns}
    from r
    ${holderJoins}
    where ${where} and ${after}
    order by ${orderBy}
    limit ${workItemPageSize + 1}
  `.execute(trx);
  const shown = page.slice(0, workItemPageSize);
  return {
    rows: shown.map((r) => toRow(r, now)),
    nextCursor: page.length > workItemPageSize ? cursorAfter(q, shown.at(-1)!) : null,
    stageCounts: await countByStage(trx, scope, q, now),
  };
}

/** How many of the scope's visible items match `q` in each Stage, by Stage key. */
async function countByStage(trx: Trx, scope: QueryScope, q: WorkItemQuery, now: Date): Promise<Map<string, number>> {
  const { rows: counts } = await sql<{ stage_key: string; count: number }>`
    with r as (${visibleRows(scope, q.allRevisions)})
    select r.stage_key, count(*)::int as count from r where ${matching(q, now)} group by r.stage_key
  `.execute(trx);
  return new Map(counts.map((c) => [c.stage_key, c.count]));
}

/**
 * The Kanban's cards: every visible item of the scope matching `q`, in the
 * sort's order, but of a closed Stage only those closed in the last
 * `closedColumnDays` days. Grouped by Stage, each card with its holder's Participant.
 */
async function boardCards(trx: Trx, scope: QueryScope, q: WorkItemQuery, now: Date): Promise<Map<string, BoardCardInput[]>> {
  const closedSince = new Date(now.getTime() - closedColumnDays * 86_400_000);
  const { rows } = await sql<Row>`
    with r as (${visibleRows(scope, q.allRevisions)})
    select r.*, ${holderColumns}
    from r
    ${holderJoins}
    left join work_item cw on cw.id = r.id and r.closed
    where ${matching(q, now)} and (not r.closed or coalesce(cw.closed_at, r.step_entered_at) >= ${closedSince}::timestamptz)
    order by ${ordering(q).orderBy}
  `.execute(trx);
  const byStage = new Map<string, BoardCardInput[]>();
  for (const r of rows) {
    const cards = byStage.get(r.stage_key) ?? [];
    cards.push({ card: toRow(r, now), holderParticipantId: r.holder_participant_id });
    byStage.set(r.stage_key, cards);
  }
  return byStage;
}

/**
 * What the "With" filter offers: the Steps of the viewer's own Participant and
 * the other Companies that hold one of the viewer's visible open items, each by
 * name only (V14). Nothing that isn't in a row the viewer could list.
 */
async function withChoices(trx: Trx, scope: QueryScope): Promise<WorkItemList["filters"]["with"]> {
  const { rows } = await sql<{ held_by_own: boolean; step_key: string; step_name: BilingualText; participant_id: string; name: BilingualText }>`
    with r as (${visibleRows(scope, false)})
    select distinct r.held_by_own, r.step_key, r.step_name, r.holder_participant_id as participant_id, hc.legal_name as name
    from r
    join lateral app.work_item_companies(r.id) hc on hc.participant_id = r.holder_participant_id
    where not r.closed
  `.execute(trx);
  const steps = new Map<string, BilingualText>();
  const companies = new Map<string, BilingualText>();
  for (const r of rows) {
    if (r.held_by_own) steps.set(r.step_key, r.step_name);
    else companies.set(r.participant_id, r.name);
  }
  const byName = <T extends { name: BilingualText }>(a: T, b: T) => a.name.en.localeCompare(b.name.en);
  return {
    steps: [...steps].map(([key, name]) => ({ key, name })).sort(byName),
    companies: [...companies].map(([participantId, name]) => ({ participantId, name })).sort(byName),
  };
}

/**
 * The List of one of the Member's Projects: a page of the items they can see
 * that match `q`, every Stage of the Module with how many of them are in it,
 * and what the toolbar's filters offer. Null when it isn't one of their Projects.
 */
export function listWorkItems(db: Db, memberId: string, projectId: string, q: WorkItemQuery, now: Date): Promise<WorkItemList | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const scope: QueryScope = { projectId, moduleKey: "submittals" };
    const { rows, nextCursor, stageCounts } = await queryWorkItems(trx, scope, q, now);
    return { ...(await stagesAndFilters(trx, scope, stageCounts)), items: rows, nextCursor };
  });
}

/**
 * The Kanban of one of the Member's Projects (RP-349): the List's Stages,
 * counts and filters, and a column per Stage with its swimlanes (V14). Null
 * when it isn't one of their Projects.
 */
export function boardWorkItems(db: Db, memberId: string, projectId: string, q: WorkItemQuery, now: Date): Promise<WorkItemBoard | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const scope: QueryScope = { projectId, moduleKey: "submittals" };
    const cards = await boardCards(trx, scope, q, now);
    const { stages, filters } = await stagesAndFilters(trx, scope, await countByStage(trx, scope, q, now));
    const columns = stages.map((s) => {
      const lanes = boardLanes(cards.get(s.key) ?? []);
      return { stageKey: s.key, shown: lanes.reduce((sum, l) => sum + l.count, 0), lanes };
    });
    return { stages, filters, columns };
  });
}

/**
 * What the List and the Kanban show around their items: every Stage of the
 * Module with how many matching items are in it, and what the toolbar's
 * filters offer.
 */
async function stagesAndFilters(trx: Trx, scope: QueryScope, stageCounts: Map<string, number>): Promise<Pick<WorkItemList, "stages" | "filters">> {
  const { projectId } = scope;
  const stages = await trx
    .selectFrom("stage")
    .select(["key", "name", "category"])
    .where("module_key", "=", scope.moduleKey)
    .where("project_id", "is", null)
    .orderBy("sort")
    .execute();
  const types = await trx
    .selectFrom("work_item_type")
    .select(["code", "name"])
    .where("module_key", "=", scope.moduleKey)
    .where((eb) => eb.or([eb("project_id", "is", null), eb("project_id", "=", projectId)]))
    .orderBy("code")
    .execute();
  const { rows: values } = await sql<{ kind: "trade" | "location"; id: string; code: string; name: BilingualText; parent_id: string | null }>`
    select d.kind, v.id, v.code, v.name, v.parent_id
    from dimension_value v
    join visibility_dimension d on d.id = v.dimension_id
    where v.project_id = ${projectId} and d.kind in ('trade', 'location')
    order by v.depth, v.sort, v.code
  `.execute(trx);
  return {
    stages: stages.map((s) => ({ ...s, count: stageCounts.get(s.key) ?? 0 })),
    filters: {
      types,
      trades: values.filter((v) => v.kind === "trade").map(({ id, code, name }) => ({ id, code, name })),
      locations: values.filter((v) => v.kind === "location").map(({ id, code, name, parent_id }) => ({ id, code, name, parentId: parent_id })),
      with: await withChoices(trx, scope),
    },
  };
}
