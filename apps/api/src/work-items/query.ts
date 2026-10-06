import { withMember, type Database, type Db, type ModuleKey } from "@rabaed/db";
import {
  boardLanes,
  chainBucketRules,
  closedColumnDays,
  codeCFilterStates,
  codeCRules,
  decodeWorkItemCursor,
  encodeWorkItemCursor,
  enteredStepBy,
  isOpenStageCategory,
  parseActionForm,
  stageCategories,
  stepAgeWeeks,
  workItemPageSize,
  type BilingualText,
  type BoardCardInput,
  type ChainBucket,
  type CodeCCondition,
  type CodeCState,
  type WorkItemBoard,
  type WorkItemMove,
  type WorkItemList,
  type WorkItemOutcome,
  type WorkItemQuery,
  type WorkItemRow,
  type WorkItemSort,
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

/** What the query reads: one Module of one Project (a Module tab's, or the query's `module`). */
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
  /** Null for a Draft with no number: its Step began when it was started, which nobody sees (scenario 61). */
  step_entered_at: Date | null;
  /** step_entered_at to the microsecond, for the cursor; null with it. */
  entered_key: string | null;
  closed: boolean;
  /** The first Submit: for everyone who sees the item. */
  submitted_at: Date | null;
  /** submitted_at to the microsecond, for the cursor. */
  submitted_key: string | null;
  /** Null unless the viewer is a Member of the raiser's Participant. */
  creation_date: Date | null;
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
      w.revision_no, w.outcome, t.outcome_kind,
      -- For the Dashboard's buckets (chainBucket): Submitted, and raised by the viewer's own Participant.
      w.submitted_at is not null as submitted,
      coalesce(w.raised_by_participant_id in (select app.current_participant_ids()), false) as raised_by_own,
      -- For the Code C line (codeCState): a Revision of the chain the viewer sees got Code C, this one
      -- included. The chain is read only through app.revision_chain, which gives the Revisions the
      -- viewer sees (V1 per Revision); their outcome is read through RLS like any item's.
      t.outcome_kind = 'review_code' and exists (
        select 1 from app.revision_chain(w.id) rc join work_item o on o.id = rc.work_item_id where o.outcome = 'C'
      ) as had_code_c,
      st.key as stage_key, st.name as stage_name, st.category as stage_category,
      tv.id as trade_id, tv.code as trade_code, tv.name as trade_name,
      lv.id as location_id, lv.code as location_code, lv.name as location_name,
      e.step_entered_at,
      -- Closed (or cancelled): it no longer ages, nor is it with anyone (isOpenStageCategory).
      ${closedStageCategory(sql.ref("st.category"))} as closed,
      to_char(e.step_entered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as entered_key,
      -- Never created_at (when the Draft was started: audit only, V-Creation Date). The Creation Date is
      -- numbered_at, which app.work_item_creation_date gives to the raiser's own Participant only.
      w.submitted_at, to_char(w.submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as submitted_key,
      app.work_item_creation_date(w.id) as creation_date,
      h.participant_id as holder_participant_id, h.assignee_member_id,
      coalesce(h.participant_id in (select app.current_participant_ids()), false) as held_by_own,
      s.key as step_key, s.name as step_name
    from work_item w
    cross join lateral app.step_as_seen(w.id) seen
    -- A Draft with no number has never moved, so its Step began when it was started: nobody sees that (visibility.md
    -- "Creation Date", scenario 61). It has no Step Age, matches no Step Age filter and sorts last, so no row,
    -- count, cursor or card carries the time. numbered_at is set with the Document Number.
    cross join lateral (select case when w.document_number is null then null else seen.entered_at end as step_entered_at) e
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

/** The Stage categories an item still moves through (isOpenStageCategory), from the domain's own list. */
const openStageCategories = stageCategories.filter(isOpenStageCategory);

/** Whether a Stage category is closed (or cancelled): the SQL side of isOpenStageCategory. */
export function closedStageCategory(category: RawBuilder<unknown>): RawBuilder<boolean> {
  return sql<boolean>`(${category} <> all(${openStageCategories}::text[]))`;
}

/**
 * How each key of a bucket or Code C condition holds over a row of
 * `visibleRows` (as `r`): the SQL side of holdsChainCondition. One entry per
 * key, so a new key can't be left out.
 */
const holdsSql: { [K in keyof CodeCCondition]-?: (value: NonNullable<CodeCCondition[K]>) => RawBuilder<boolean> } = {
  hadCodeC: (had) => sql`r.had_code_c = ${had}`,
  open: (open) => (open ? sql`not r.closed` : sql`r.closed`),
  submitted: (submitted) => sql`r.submitted = ${submitted}`,
  raisedByViewer: (raised) => sql`r.raised_by_own = ${raised}`,
  outcomeKind: (kind) => sql`r.outcome_kind = ${kind}`,
  // An open item has no outcome: false, not null, as in the domain.
  outcome: (outcome) => sql`r.outcome is not distinct from ${outcome}`,
  stageCategory: (category) => sql`r.stage_category = ${category}`,
};

/** One condition of the bucket or Code C rule, over a row of `visibleRows` (as `r`). */
export function chainConditionSql(when: CodeCCondition): RawBuilder<boolean> {
  const parts = Object.entries(when).flatMap(([key, value]) => {
    const holdsKey = holdsSql[key as keyof CodeCCondition] as ((value: unknown) => RawBuilder<boolean>) | undefined;
    if (!holdsKey) throw new Error(`Not a chain condition key: ${key}`);
    return value === undefined ? [] : [holdsKey(value)];
  });
  return parts.length > 0 ? sql`(${sql.join(parts, sql` and `)})` : noFilter;
}

/**
 * The Dashboard bucket of a row of `visibleRows` (as `r`), or null: the domain's
 * chainBucketRules in order, as one SQL case, so the `bucket` filter and the
 * Dashboard's counts follow chainBucket's own rule.
 */
export const bucketOfRow: RawBuilder<ChainBucket | null> = sql`(case ${sql.join(
  chainBucketRules.map((rule) => sql`when ${chainConditionSql(rule.when)} then ${rule.bucket}::text`),
  sql` `,
)} end)`;

/**
 * The Code C state of a row of `visibleRows` (as `r`), or null: the domain's
 * codeCRules in order, as one SQL case, so the `codeC` filter and the
 * Dashboard's Code C line follow codeCState's own rule.
 */
export const codeCOfRow: RawBuilder<CodeCState | null> = sql`(case ${sql.join(
  codeCRules.map((rule) => sql`when ${chainConditionSql(rule.when)} then ${rule.state}::text`),
  sql` `,
)} end)`;

/** The rows of `visibleRows` (as `r`) that match the query's filters; the cursor aside. */
function matching(q: WorkItemQuery, now: Date, scope: QueryScope): RawBuilder<boolean> {
  // A chain in no bucket is one nobody but its raiser should see (V1): listed and counted nowhere,
  // so a Dashboard total (every bucket) and the List of its Type agree.
  const conditions: RawBuilder<boolean>[] = [sql`${bucketOfRow} is not null`];
  if (q.q !== undefined) {
    // Search (RP-347): the Document Number, Subject, Type, Trade, Location and the
    // raiser's Company name, never answers or Documents (V19). The function answers
    // only with items the caller sees; the rows here are those already.
    conditions.push(sql`r.id in (select app.search_work_items(${scope.projectId}::uuid, ${q.q}::text))`);
  }
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
  if (q.bucket.length > 0) conditions.push(sql`${bucketOfRow} = any(${q.bucket}::text[])`);
  if (q.codeC.length > 0) conditions.push(sql`${codeCOfRow} = any(${codeCFilterStates(q.codeC)}::text[])`);
  if (q.stepAgeMin !== undefined) {
    // A closed item doesn't age.
    conditions.push(sql`not r.closed and r.step_entered_at <= ${enteredStepBy(q.stepAgeMin, now)}::timestamptz`);
  }
  // The Submission Date range, in Saudi days, both days included; an item not yet Submitted has none and is left out.
  if (q.submittedFrom !== undefined) conditions.push(sql`(r.submitted_at at time zone 'Asia/Riyadh')::date >= ${q.submittedFrom}::date`);
  if (q.submittedTo !== undefined) conditions.push(sql`(r.submitted_at at time zone 'Asia/Riyadh')::date <= ${q.submittedTo}::date`);
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
  return sql`(${sql.join(conditions, sql` and `)})`;
}

/**
 * One sort, all in one place: its order, the sort key a cursor keeps of a page's
 * last row, and where the next page starts after that key. The key is
 * [sorts last, value, id], as text; `cursorKeyValid` (work-item-query.ts in @rabaed/domain)
 * checks a cursor's key has this sort's shape before it reaches `after`.
 */
type SortDefinition = {
  orderBy: RawBuilder<unknown>;
  keyOf: (row: Row) => [last: string, value: string, id: string];
  after: (key: string[]) => RawBuilder<boolean>;
};

const sorts: Record<WorkItemSort, SortDefinition> = {
  // The oldest Step Age first; closed items, which don't age, last, and within each the items with no Step Age (a Draft with no number) last, by id.
  stepAge: {
    orderBy: sql`r.closed, r.step_entered_at nulls last, r.id`,
    keyOf: (r) => [String(r.closed), r.entered_key ?? "", r.id],
    after: ([closed, at, id]) =>
      at === ""
        ? sql`(r.closed > ${closed}::boolean or (r.closed = ${closed}::boolean and r.step_entered_at is null and r.id > ${id}::uuid))`
        : sql`(r.closed > ${closed}::boolean or (r.closed = ${closed}::boolean and (r.step_entered_at is null or r.step_entered_at > ${at}::timestamptz or (r.step_entered_at = ${at}::timestamptz and r.id > ${id}::uuid))))`,
  },
  // Items with no number yet (Drafts) last; numbers compared byte by byte, the same in every locale.
  documentNumber: {
    orderBy: sql`r.document_number is null, coalesce(r.document_number, '') collate "C", r.id`,
    keyOf: (r) => [String(r.document_number === null), r.document_number ?? "", r.id],
    after: ([none, number, id]) =>
      sql`(r.document_number is null, coalesce(r.document_number, '') collate "C", r.id) > (${none}::boolean, ${number}::text collate "C", ${id}::uuid)`,
  },
  // The latest Submission Date first; items not yet Submitted last, by id.
  submissionDate: {
    orderBy: sql`r.submitted_at is null, r.submitted_at desc, r.id`,
    keyOf: (r) => [String(r.submitted_key === null), r.submitted_key ?? "", r.id],
    after: ([none, at, id]) =>
      none === "true"
        ? sql`(r.submitted_at is null and r.id > ${id}::uuid)`
        : sql`(r.submitted_at is null or r.submitted_at < ${at}::timestamptz or (r.submitted_at = ${at}::timestamptz and r.id > ${id}::uuid))`,
  },
};

/** Where the query's page starts: after its cursor's key, or at the start. */
function afterCursor(q: WorkItemQuery): RawBuilder<boolean> {
  const key = q.cursor === undefined ? null : decodeWorkItemCursor(q.cursor, q.sort);
  return key ? sorts[q.sort].after(key) : noFilter;
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
    stepEnteredAt: r.step_entered_at?.toISOString() ?? null,
    stepAgeWeeks: r.step_entered_at ? stepAgeWeeks(r.step_entered_at, now) : null,
    outcome: r.outcome,
    submissionDate: r.submitted_at?.toISOString() ?? null,
    creationDate: r.creation_date?.toISOString() ?? null,
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
  const where = matching(q, now, scope);
  const { orderBy } = sorts[q.sort];
  const after = afterCursor(q);
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
    nextCursor: page.length > workItemPageSize ? encodeWorkItemCursor(q.sort, sorts[q.sort].keyOf(shown.at(-1)!)) : null,
    // A search counts no more than its page shows ("Search and filters": no totals beyond the page).
    stageCounts: q.q === undefined ? await countByStage(trx, scope, q, now) : pageCounts(shown),
  };
}

function pageCounts(rows: Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.stage_key, (counts.get(r.stage_key) ?? 0) + 1);
  return counts;
}

/** How many of the scope's visible items match `q` in each Stage, by Stage key. */
async function countByStage(trx: Trx, scope: QueryScope, q: WorkItemQuery, now: Date): Promise<Map<string, number>> {
  const { rows: counts } = await sql<{ stage_key: string; count: number }>`
    with r as (${visibleRows(scope, q.allRevisions)})
    select r.stage_key, count(*)::int as count from r where ${matching(q, now, scope)} group by r.stage_key
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
    where ${matching(q, now, scope)} and (not r.closed or coalesce(cw.closed_at, r.step_entered_at) >= ${closedSince}::timestamptz)
    order by ${sorts[q.sort].orderBy}
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
 * What the viewer may do with the board's cards now (RP-350): for each card they
 * hold, the Transitions app.work_item_actions lists, which are exactly the
 * buttons of the item's page, with the Stage of the Step each leads to and its
 * Action Form. Asked only for the open cards the viewer claimed, since nobody
 * else can take a Transition; a card with none has no entry. The Stage is of the
 * item's pinned Workflow Version, one of the Module's own columns.
 */
async function boardMoves(trx: Trx, cards: readonly WorkItemRow[]): Promise<Record<string, WorkItemMove[]>> {
  const mine = cards.filter((c) => c.with?.kind === "own" && c.with.claimer?.isMe).map((c) => c.id);
  if (mine.length === 0) return {};
  const { rows } = await sql<{ id: string; key: string; label: BilingualText; kind: WorkItemMove["kind"]; stage_key: string; action_form: unknown }>`
    select w.id, a.transition_key as key, a.label, a.transition_kind as kind, s.stage_key, tr.action_form
    from unnest(${mine}::uuid[]) as c (id)
    join work_item w on w.id = c.id
    cross join lateral app.work_item_actions(w.id) with ordinality a (action, transition_key, label, transition_kind, n)
    join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.key = a.transition_key
    join workflow_step s on s.id = tr.to_step_id
    where a.action = 'transition'
    order by w.id, a.n
  `.execute(trx);
  const moves: Record<string, WorkItemMove[]> = {};
  for (const r of rows) {
    (moves[r.id] ??= []).push({ transition: r.key, label: r.label, kind: r.kind, stageKey: r.stage_key, actionForm: parseActionForm(r.action_form) });
  }
  return moves;
}

/**
 * How many of the scope's visible items matching `q` are in each Type,
 * Dashboard bucket (chainBucket) and Code C state (codeCState), null for none:
 * the same rows, filters, bucket and state as the List, so a count and the
 * List behind it can't disagree.
 */
export async function countWorkItemBuckets(
  trx: Trx,
  scope: QueryScope,
  q: WorkItemQuery,
  now: Date,
): Promise<{ typeCode: string; bucket: ChainBucket | null; codeC: CodeCState | null; count: number }[]> {
  const { rows } = await sql<{ type_code: string; bucket: ChainBucket | null; code_c: CodeCState | null; count: number }>`
    with r as (${visibleRows(scope, q.allRevisions)})
    select r.type_code, ${bucketOfRow} as bucket, ${codeCOfRow} as code_c, count(*)::int as count
    from r where ${matching(q, now, scope)}
    group by 1, 2, 3
  `.execute(trx);
  return rows.map((r) => ({ typeCode: r.type_code, bucket: r.bucket, codeC: r.code_c, count: r.count }));
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
 * Whether the Member is on the scope's Project (RLS on project) and it has a
 * Work Item Type in the scope's Module, so the Module has a tab there (RP-346).
 */
async function hasModuleTab(trx: Trx, { projectId, moduleKey }: QueryScope): Promise<boolean> {
  const found = await trx
    .selectFrom("project as p")
    .innerJoin("work_item_type as t", (join) => join.on((eb) => eb.or([eb("t.project_id", "is", null), eb("t.project_id", "=", eb.ref("p.id"))])))
    .select("p.id")
    .where("p.id", "=", projectId)
    .where("t.module_key", "=", moduleKey)
    .executeTakeFirst();
  return found !== undefined;
}

/**
 * The List of one Module of one of the Member's Projects: a page of the items they can see
 * that match `q`, every Stage of the Module with how many of them are in it,
 * and what the toolbar's filters offer. Null when it isn't one of their Projects,
 * or the Project has no Work Item Type in the Module.
 */
export function listWorkItems(db: Db, memberId: string, scope: QueryScope, q: WorkItemQuery, now: Date): Promise<WorkItemList | null> {
  return withMember(db, memberId, async (trx) => {
    if (!(await hasModuleTab(trx, scope))) return null;
    const { rows, nextCursor, stageCounts } = await queryWorkItems(trx, scope, q, now);
    return { ...(await stagesAndFilters(trx, scope, stageCounts)), items: rows, nextCursor };
  });
}

/**
 * The Kanban of one Module of one of the Member's Projects (RP-349): the List's
 * Stages, counts and filters, and a column per Stage with its swimlanes (V14).
 * Null as for the List.
 */
export function boardWorkItems(db: Db, memberId: string, scope: QueryScope, q: WorkItemQuery, now: Date): Promise<WorkItemBoard | null> {
  return withMember(db, memberId, async (trx) => {
    if (!(await hasModuleTab(trx, scope))) return null;
    const cards = await boardCards(trx, scope, q, now);
    // A search counts no more than the cards it shows ("Search and filters": no totals beyond what is shown).
    const counts = q.q === undefined ? await countByStage(trx, scope, q, now) : new Map([...cards].map(([key, c]) => [key, c.length]));
    const { stages, filters } = await stagesAndFilters(trx, scope, counts);
    const columns = stages.map((s) => {
      const lanes = boardLanes(cards.get(s.key) ?? []);
      return { stageKey: s.key, shown: lanes.reduce((sum, l) => sum + l.count, 0), lanes };
    });
    const moves = await boardMoves(trx, [...cards.values()].flatMap((c) => c.map((i) => i.card)));
    return { stages, filters, columns, moves };
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
