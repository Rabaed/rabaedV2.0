import { withMember, type Database, type Db, type ModuleKey } from "@rabaed/db";
import {
  boardLanes,
  chainBucketRules,
  closedColumnDays,
  codeCFilterStates,
  codeCRules,
  decodeWorkItemCursor,
  defaultBoardCardLayout,
  encodeWorkItemCursor,
  enteredStepBy,
  isOpenStageCategory,
  listColumnLayout,
  listColumns,
  parseActionForm,
  stageCategories,
  sortDirectionOf,
  stepAgeWeeks,
  workItemCursorSorts,
  workItemExportMax,
  workItemPageSize,
  type BilingualText,
  type ListColumnLayout,
  type Locale,
  type WorkItemCursorSort,
  type WorkItemExport,
  type BoardCardLayout,
  type BoardCardLayoutChange,
  type BoardCardInput,
  type ChainBucket,
  type CodeCCondition,
  type CodeCState,
  type WorkItemBoard,
  type WorkItemCursorKey,
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
  /** The raising Company's name: everyone who sees the item reads it (Search finds it too). */
  raiser_name: BilingualText | null;
  /** The role holding it, my own Company's only (RP-410): its Position and my Project Role. */
  role_position_key: string | null;
  role_position_name: BilingualText | null;
  role_position_sort: number | null;
  role_project_role: BilingualText | null;
  /** Who closed it: my own Company's person by name, else the closing Company only (V14). */
  closer_name: BilingualText | null;
  closer_company_name: BilingualText | null;
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
      -- For the Dashboard's buckets (chainBucket): Submitted, and raised by the viewer's own Participant.
      w.submitted_at is not null as submitted,
      coalesce(w.raised_by_participant_id in (select app.current_participant_ids()), false) as raised_by_own,
      -- Its outcome in its Type's set on the Project (RP-429, chainOutcomeTraits): one of the card's
      -- bars (a closing outcome of a set with two or more), its polarity, whether it offers a Revision.
      coalesce(oc.closing and (
        select count(*) from outcome x where x.project_id = w.project_id and x.work_item_type_id = t.id and x.closing
      ) >= 2, false) as outcome_bar,
      oc.polarity,
      coalesce(oc.actions @> '[{"kind": "offer_revision"}]', false) as offers_revision,
      -- For the Code C line (codeCState): a Revision of the chain the viewer sees got an outcome offering
      -- a Revision (Code C), this one included. The chain is read only through app.revision_chain, which
      -- gives the Revisions the viewer sees (V1 per Revision); their outcome is read through RLS like any item's.
      exists (
        select 1 from app.revision_chain(w.id) rc join work_item o on o.id = rc.work_item_id
        where app.outcome_offers(o.project_id, o.work_item_type_id, o.outcome, 'offer_revision')
      ) as had_code_c,
      st.key as stage_key, st.name as stage_name, st.category as stage_category, st.sort as stage_sort,
      tv.id as trade_id, tv.code as trade_code, tv.name as trade_name, tv.sort as trade_sort,
      lv.id as location_id, lv.code as location_code, lv.name as location_name,
      e.step_entered_at,
      -- Closed (or cancelled): it no longer ages, nor is it with anyone (isOpenStageCategory).
      ${closedStageCategory(sql.ref("st.category"))} as closed,
      to_char(e.step_entered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as entered_key,
      -- Never created_at (when the Draft was started: audit only, V-Creation Date). The Creation Date is
      -- numbered_at, which app.work_item_creation_date gives to the raiser's own Participant only.
      w.submitted_at, to_char(w.submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as submitted_key,
      app.work_item_creation_date(w.id) as creation_date,
      h.participant_id as holder_participant_id, h.assignee_member_id, w.raised_by_participant_id as raiser_participant_id,
      coalesce(h.participant_id in (select app.current_participant_ids()), false) as held_by_own,
      s.key as step_key, s.name as step_name, s.id as step_id, s.actor_rule, t.module_key
    from work_item w
    cross join lateral app.step_as_seen(w.id) seen
    -- A Draft with no number has never moved, so its Step began when it was started: nobody sees that (visibility.md
    -- "Creation Date", scenario 61). It has no Step Age, matches no Step Age filter and sorts last, so no row,
    -- count, cursor or card carries the time. numbered_at is set with the Document Number.
    cross join lateral (select case when w.document_number is null then null else seen.entered_at end as step_entered_at) e
    join workflow_step s on s.id = seen.step_id
    join work_item_type t on t.id = w.work_item_type_id
    -- Its outcome in the Project's copy of its Type's set (RP-429); none while open or cancelled.
    left join outcome oc on oc.project_id = w.project_id and oc.work_item_type_id = t.id and oc.code = w.outcome
    -- The Project's own Stages (RP-428): their names, order and categories, never the Rabaed Defaults'.
    join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = seen.stage_key
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
  // An open item has no outcome: false, not null, as in the domain.
  outcome: (outcome) => sql`r.outcome is not distinct from ${outcome}`,
  stageCategory: (category) => sql`r.stage_category = ${category}`,
  outcomeBar: (bar) => sql`r.outcome_bar = ${bar}`,
  polarity: (polarity) => sql`r.polarity is not distinct from ${polarity}`,
  offersRevision: (offers) => sql`r.offers_revision = ${offers}`,
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
  chainBucketRules.map(
    ({ when, bucket }) =>
      sql`when ${chainConditionSql(when)} then ${typeof bucket === "object" && bucket !== null ? sql.ref("r.outcome") : sql`${bucket}::text`}`,
  ),
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
    // The Kanban's search (RP-410) also finds the words, as one phrase of 3 letters or more, in what
    // the card shows besides: its owner as the viewer may read it (my own Company's person; another
    // Company's name only, V14), only while the card shows one (an open item: a closed one has no
    // owner, so it is never found by its last holder), and the Zone, Building or Floor its Location is in.
    // The holder's name is read only for another Company's items, and only under a search.
    const phrase = `%${q.q.replace(/[\\%_]/g, "\\$&")}%`;
    const named = (name: RawBuilder<unknown>) => sql<boolean>`concat_ws(' ', ${name} ->> 'en', ${name} ->> 'ar') ilike ${phrase}`;
    const onCard =
      q.q.length < 3
        ? sql<boolean>`false`
        : sql<boolean>`(
          (not r.closed and r.held_by_own and exists (select 1 from member o where o.id = r.assignee_member_id and ${named(sql.ref("o.full_name"))}))
          or (not r.closed and not r.held_by_own and r.holder_participant_id is not null and exists (
            select 1 from app.work_item_companies(r.id) o where o.participant_id = r.holder_participant_id and ${named(sql.ref("o.legal_name"))}))
          or exists (
            with recursive up as (
              select id, parent_id, name from dimension_value where id = r.location_id
              union all
              select v.id, v.parent_id, v.name from dimension_value v join up on v.id = up.parent_id
            ) select 1 from up where ${named(sql.ref("up.name"))}))`;
    conditions.push(sql`(r.id in (select app.search_work_items(${scope.projectId}::uuid, ${q.q}::text)) or ${onCard})`);
  }
  if (q.type.length > 0) conditions.push(sql`r.type_code = any(${q.type}::text[])`);
  if (q.stage.length > 0) conditions.push(sql`r.stage_key = any(${q.stage}::text[])`);
  if (q.trade.length > 0) conditions.push(sql`r.trade_id = any(${q.trade}::uuid[])`);
  if (q.location.length > 0) {
    // A Location takes in the ones under it. The Zone, Building and Floor filters are levels of one
    // tree (RP-410), grouped by the level's name (its depth where it has none), so an uneven tree
    // (a Floor right under a Zone) still groups with the other Floors: values of one level are any of
    // them, and the levels chosen must all hold (AND), so "Zone A and Floor 5" is Floor 5 of Zone A.
    // One level only, as every earlier link holds, is the old "any of them". An item with no Location
    // matches none.
    conditions.push(sql`(r.location_id is not null and not exists (
      select 1 from dimension_value chosen where chosen.id = any(${q.location}::uuid[])
      group by coalesce(chosen.level_name ->> 'en', chosen.depth::text)
      having not bool_or(chosen.id in (
        with recursive up as (
          select id, parent_id from dimension_value where id = r.location_id
          union all
          select v.id, v.parent_id from dimension_value v join up on v.id = up.parent_id
        ) select id from up))))`);
  }
  if (q.outcome.length > 0) conditions.push(sql`r.outcome = any(${q.outcome}::text[])`);
  if (q.bucket.length > 0) conditions.push(sql`${bucketOfRow} = any(${q.bucket}::text[])`);
  if (q.codeC.length > 0) conditions.push(sql`${codeCOfRow} = any(${codeCFilterStates(q.codeC)}::text[])`);
  if (q.stepAgeMin !== undefined) {
    // A closed item doesn't age.
    conditions.push(sql`not r.closed and r.step_entered_at <= ${enteredStepBy(q.stepAgeMin, now)}::timestamptz`);
  }
  if (q.createdWithin !== undefined) {
    // The date the card shows (RP-410): the Creation Date, which app.work_item_creation_date gives the
    // raiser's own Participant only, else the Submission Date everyone who sees the item reads. So
    // another Company filters by nothing but the Submission Date (visibility.md "Creation Date").
    // The last N Saudi days, today included.
    conditions.push(sql`(coalesce(r.creation_date, r.submitted_at) at time zone 'Asia/Riyadh')::date
      > (${now}::timestamptz at time zone 'Asia/Riyadh')::date - ${q.createdWithin}::int`);
  }
  // The Submission Date range, in Saudi days, both days included; an item not yet Submitted has none and is left out.
  if (q.submittedFrom !== undefined) conditions.push(sql`(r.submitted_at at time zone 'Asia/Riyadh')::date >= ${q.submittedFrom}::date`);
  if (q.submittedTo !== undefined) conditions.push(sql`(r.submitted_at at time zone 'Asia/Riyadh')::date <= ${q.submittedTo}::date`);
  // Steps I hold, unclaimed Steps of my pool, and my own Drafts (app.need_my_action).
  if (q.needMyAction) conditions.push(sql`app.need_my_action(r.id) is not null`);
  // Home (RP-407): my own Participant's items, and who holds an open item now. Another Participant
  // holds it whenever my own doesn't, even one since withdrawn; a closed item is held by nobody.
  if (q.raisedByMe) conditions.push(sql`r.raised_by_own`);
  if (q.heldBy === "own") conditions.push(sql`(not r.closed and r.held_by_own)`);
  if (q.heldBy === "others") conditions.push(sql`(not r.closed and not r.held_by_own)`);
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
  if (q.owner.length > 0) {
    // Who holds it (RP-410). Only my own Company's people are named: app.work_item_holder gives
    // nobody else's Member, so another Company's Member id matches nothing (V14).
    const members = q.owner.flatMap((v) => (v.startsWith("member:") ? [v.slice(7)] : []));
    const companies = q.owner.flatMap((v) => (v.startsWith("company:") ? [v.slice(8)] : []));
    const any: RawBuilder<boolean>[] = [];
    if (members.length > 0) any.push(sql`(r.held_by_own and r.assignee_member_id = any(${members}::uuid[]))`);
    if (q.owner.includes("unclaimed")) any.push(sql`(r.held_by_own and r.assignee_member_id is null)`);
    if (companies.length > 0) any.push(sql`(not r.held_by_own and r.holder_participant_id = any(${companies}::uuid[]))`);
    conditions.push(sql`(${sql.join(any, sql` or `)})`);
  }
  // The role holding it (RP-410): a Step of my own Company. Another Company's items match none,
  // as it is one lane, never split into its roles (V5).
  if (q.role.length > 0) conditions.push(sql`(r.held_by_own and r.step_key = any(${q.role}::text[]))`);
  return sql`(${sql.join(conditions, sql` and `)})`;
}

/**
 * One sort, all in one place: its order, the sort key a cursor keeps of a page's
 * last row, and where the next page starts after that key. Every sort's key has
 * one shape, `WorkItemCursorKey` (work-item-query.ts in @rabaed/domain), whose
 * `decodeWorkItemCursor` checks a cursor's key before it reaches `after`.
 *
 * Rows with no value to sort by (no number, no Step Age, not yet Submitted) go by
 * Subject, then id: ids are random and say nothing of when an item was made, so
 * they only break ties (ADR 0015, scenario 73). Subjects and numbers are compared
 * byte by byte, the same in every locale.
 */
type SortDefinition = {
  orderBy: RawBuilder<unknown>;
  keyOf: (row: Row) => WorkItemCursorKey;
  after: (key: WorkItemCursorKey) => RawBuilder<boolean>;
};

/** The order of rows with no value to sort by (`none`): by Subject, byte by byte, then id. */
const bySubjectWhen = (none: RawBuilder<boolean>) => sql`case when ${none} then r.title end collate "C", r.id`;

/** Whether a row comes after `text` and `id`, comparing `column` byte by byte, then the id. */
const pastTextThenId = (column: RawBuilder<unknown>, text: string, id: string) =>
  sql<boolean>`(${column} collate "C", r.id) > (${text}::text collate "C", ${id}::uuid)`;

/** A row's key: its Subject only when it has no value. */
const keyOf = (last: boolean, value: string | null, r: Row): WorkItemCursorKey => [String(last), value ?? "", value === null ? r.title : "", r.id];

const sorts: Record<WorkItemCursorSort, SortDefinition> = {
  // The oldest Step Age first; closed items, which don't age, last, and within each the items with no Step Age
  // (a Draft with no number) last, by Subject.
  stepAge: {
    orderBy: sql`r.closed, r.step_entered_at nulls last, ${bySubjectWhen(sql`r.step_entered_at is null`)}`,
    keyOf: (r) => keyOf(r.closed, r.entered_key, r),
    after: ([closed, at, subject, id]) =>
      at === ""
        ? sql`(r.closed > ${closed}::boolean or (r.closed = ${closed}::boolean and r.step_entered_at is null and ${pastTextThenId(sql`r.title`, subject, id)}))`
        : sql`(r.closed > ${closed}::boolean or (r.closed = ${closed}::boolean and (r.step_entered_at is null or r.step_entered_at > ${at}::timestamptz or (r.step_entered_at = ${at}::timestamptz and r.id > ${id}::uuid))))`,
  },
  // Items with no number yet (Drafts) last, by Subject.
  documentNumber: {
    orderBy: sql`r.document_number is null, r.document_number collate "C", ${bySubjectWhen(sql`r.document_number is null`)}`,
    keyOf: (r) => keyOf(r.document_number === null, r.document_number, r),
    after: ([none, number, subject, id]) =>
      none === "true"
        ? sql`(r.document_number is null and ${pastTextThenId(sql`r.title`, subject, id)})`
        : sql`(r.document_number is null or ${pastTextThenId(sql`r.document_number`, number, id)})`,
  },
  // The latest Submission Date first; items not yet Submitted last, by Subject.
  submissionDate: {
    orderBy: sql`r.submitted_at is null, r.submitted_at desc, ${bySubjectWhen(sql`r.submitted_at is null`)}`,
    keyOf: (r) => keyOf(r.submitted_key === null, r.submitted_key, r),
    after: ([none, at, subject, id]) =>
      none === "true"
        ? sql`(r.submitted_at is null and ${pastTextThenId(sql`r.title`, subject, id)})`
        : sql`(r.submitted_at is null or r.submitted_at < ${at}::timestamptz or (r.submitted_at = ${at}::timestamptz and r.id > ${id}::uuid))`,
  },
};

/** Where the query's page starts: after its cursor's key, or at the start. */
function afterCursor(q: WorkItemQuery & { sort: WorkItemCursorSort }): RawBuilder<boolean> {
  const key = q.cursor === undefined ? null : decodeWorkItemCursor(q.cursor, q.sort);
  return key ? sorts[q.sort].after(key) : noFilter;
}

/**
 * A List column's sort (RP-409), paged by number: what it sorts by (`value`), which rows have nothing
 * to sort by (`none`, last whichever way; by default those with no value), and whether the column reads
 * the other way round from the value (Step Age: the oldest first is the earliest Step entry). Ties go by
 * Subject, byte by byte, then id (ADR 0015). Names are sorted in the reader's language (`lang`), and only
 * as the viewer may read them: another Company's people are never read (V14), so an owner sorts by the
 * name the row shows. `value` may read `holderJoins`.
 */
type ColumnSort = { value: (lang: Locale) => RawBuilder<unknown>; none?: RawBuilder<boolean>; reversed?: boolean };

/** The ancestor (or the Location itself) at `depth` of a row's Location: its place in the Project's order. */
const locationLevel = (depth: number): ColumnSort => ({
  value: () => sql`(
    with recursive up as (
      select id, parent_id, depth, sort, code from dimension_value where id = r.location_id
      union all
      select v.id, v.parent_id, v.depth, v.sort, v.code from dimension_value v join up on v.id = up.parent_id
    ) select (up.sort, up.code collate "C") from up where up.depth = ${depth} limit 1)`,
});

const named = (name: RawBuilder<unknown>, lang: Locale) => sql`lower(${name} ->> ${lang})`;

const columnSorts: Record<WorkItemSort, ColumnSort> = {
  stepAge: { value: () => sql`r.step_entered_at`, none: sql`(r.closed or r.step_entered_at is null)`, reversed: true },
  documentNumber: { value: () => sql`r.document_number collate "C"` },
  submissionDate: { value: () => sql`r.submitted_at` },
  subject: { value: () => sql`lower(r.title) collate "C"` },
  revision: { value: () => sql`r.revision_no` },
  trade: { value: () => sql`(r.trade_sort, r.trade_code collate "C")` },
  type: { value: () => sql`r.type_code collate "C"` },
  stage: { value: () => sql`r.stage_sort` },
  outcome: { value: () => sql`r.outcome collate "C"` },
  locationLevel1: locationLevel(1),
  locationLevel2: locationLevel(2),
  locationLevel3: locationLevel(3),
  // What the row shows: my own Company's person who claimed it, or my unclaimed Step by its name; another Company by
  // its name; closed, who closed it.
  owner: {
    value: (lang) =>
      named(
        sql`(case when r.closed then coalesce(cm.full_name, co.closer_company_name)
          when r.held_by_own and r.assignee_member_id is null then r.step_name
          else coalesce(m.full_name, co.holder_name) end)`,
        lang,
      ),
  },
  // The date the row shows: the Creation Date, which only the raiser's Participant reads, else the Submission Date.
  created: { value: () => sql`coalesce(r.creation_date, r.submitted_at)` },
  contractor: { value: (lang) => named(sql`co.raiser_name`, lang) },
};

/** A numbered page's order: the column's sort in the query's direction, rows with nothing to sort by last. */
function columnOrder(q: WorkItemQuery): RawBuilder<unknown> {
  const { value, none, reversed } = columnSorts[q.sort];
  const v = value(q.lang ?? "en");
  const ascending = (sortDirectionOf(q) === "asc") !== (reversed ?? false);
  return sql`${none ?? sql`${v} is null`}, ${v} ${ascending ? sql`asc` : sql`desc`}, r.title collate "C", r.id`;
}

const isCursorSort = (sort: WorkItemSort): sort is WorkItemCursorSort => (workItemCursorSorts as readonly string[]).includes(sort);

/**
 * Whether a read of `q` pages by cursor (`nextCursor`) to its end: a cursor's own sort in its own
 * order, with no numbered page. Any other query is read one numbered page at a time, so a loop
 * over `nextCursor` (Home's `everyRow`) would stop after its first page.
 */
export const pagesByCursor = (q: Pick<WorkItemQuery, "page" | "dir" | "sort">) => q.page === undefined && q.dir === undefined && isCursorSort(q.sort);

/**
 * How a query pages: by number (`page`), or by cursor, which only the cursor's sorts in their own
 * order can do; any other read without a page is its first numbered page.
 */
function pagingOf(q: WorkItemQuery) {
  const cursor = pagesByCursor(q) ? { ...q, sort: q.sort as WorkItemCursorSort } : null;
  const page = cursor ? null : (q.page ?? 1);
  const size = page === null ? workItemPageSize : (q.pageSize ?? workItemPageSize);
  return { cursor, page, size, orderBy: cursor ? sorts[cursor.sort].orderBy : columnOrder(q) };
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
    ...(r.raiser_name ? { raiserCompanyName: r.raiser_name } : {}),
    // Who closed it (RP-410): my own Company's person, or the Company only (V14).
    closedBy: open
      ? null
      : r.closer_name && r.closer_company_name
        ? { kind: "own", name: r.closer_name, companyName: r.closer_company_name }
        : r.closer_company_name
          ? { kind: "company", companyName: r.closer_company_name }
          : null,
    with:
      !open || r.holder_name === null
        ? null
        : r.held_by_own
          ? {
              kind: "own",
              companyName: r.holder_name,
              step: { key: r.step_key, name: r.step_name },
              claimer: r.claimer_name ? { name: r.claimer_name, isMe: r.claimed_by_me } : null,
              role:
                r.role_position_key && r.role_position_name && r.role_project_role
                  ? { position: { key: r.role_position_key, name: r.role_position_name, sort: r.role_position_sort ?? 0 }, projectRole: r.role_project_role }
                  : null,
            }
          : { kind: "company", companyName: r.holder_name },
  };
}

// Who holds a row of `visibleRows` (as `r`), by name: only the viewer's own
// Participant's holder is named (app.work_item_holder), and member's own RLS
// shows only their own Company's people (V14).
const holderColumns = sql`co.holder_name, co.raiser_name, co.closer_company_name, cm.full_name as closer_name,
  m.full_name as claimer_name, coalesce(r.assignee_member_id = app.current_member_id(), false) as claimed_by_me,
  hr.key as role_position_key, hr.name as role_position_name, hr.sort as role_position_sort, hr.project_role as role_project_role`;
// RP-410:
// - The closing move of a closed item: the latest event, as RLS lets the viewer read it (the
//   closing Transition is shared), that brought it to the Step it is at. Its actor is named only
//   when they are of the viewer's own Participant; anyone else's Company by name only (V14).
// - The holder's, the raiser's (the card's Contractor name) and the closer's Companies, from one read
//   of the Companies on the item that everyone who sees it may name.
// - The role holding an open item of my own Company: the claimer's Position on the Project, or for an
//   unclaimed Step the Positions its Step Pool holds (the Step's permission, narrowed to the Step's
//   Positions where it names them), the first in the Positions' order where it spans several; with
//   my own Project Role. project_member_position is read only for my own Participant (RLS), and
//   nothing here is asked of another Company's items (V5, V14).
const holderJoins = sql`left join lateral (
    select e.actor_participant_id, e.actor_member_id
    from work_item_event e
    where r.closed and e.work_item_id = r.id and e.to_step_id = r.step_id
    order by e.seq desc
    limit 1
  ) ce on true
  left join lateral (
    select
      (max(x.legal_name::text) filter (where x.participant_id = r.holder_participant_id))::jsonb as holder_name,
      (max(x.legal_name::text) filter (where x.participant_id = r.raiser_participant_id))::jsonb as raiser_name,
      (max(x.legal_name::text) filter (where x.participant_id = ce.actor_participant_id))::jsonb as closer_company_name
    from app.work_item_companies(r.id) x
  ) co on true
  left join member cm on cm.id = ce.actor_member_id and ce.actor_participant_id in (select app.current_participant_ids())
  left join member m on m.id = r.assignee_member_id
  left join lateral (
    select p.key, p.name, p.sort, pr.name as project_role
    from participant hp
    join project_role pr on pr.id = hp.project_role_id
    join position p on p.base_role = pr.base_role
    where r.held_by_own and not r.closed and hp.id = r.holder_participant_id
      and (not (r.actor_rule ? 'positions') or p.key in (select jsonb_array_elements_text(r.actor_rule -> 'positions')))
      and (
        case when r.assignee_member_id is null
          then exists (
            select 1 from position_permission pp
            where pp.position_id = p.id and pp.module_key = r.module_key and pp.permission = r.actor_rule ->> 'permission')
          else p.id in (
            select mp.position_id from project_member_position mp
            join project_member pm on pm.id = mp.project_member_id
            where pm.member_id = r.assignee_member_id and pm.project_id = r.project_id and pm.status = 'active')
        end)
    order by exists (
        select 1 from position_permission pp
        where pp.position_id = p.id and pp.module_key = r.module_key and pp.permission = r.actor_rule ->> 'permission') desc,
      p.sort, p.key
    limit 1
  ) hr on true`;

/** One page of the scope's visible items matching `q`, and how many match in each Stage. */
export async function queryWorkItems(
  trx: Trx,
  scope: QueryScope,
  q: WorkItemQuery,
  now: Date,
): Promise<{ rows: WorkItemRow[]; nextCursor: string | null; page?: NonNullable<WorkItemList["page"]>; stageCounts: Map<string, number> }> {
  const rows = visibleRows(scope, q.allRevisions);
  const where = matching(q, now, scope);
  const { cursor, page: number, size, orderBy } = pagingOf(q);
  const after = cursor ? afterCursor(cursor) : noFilter;
  const { rows: page } = await sql<Row>`
    with r as (${rows})
    select r.*, ${holderColumns}
    from r
    ${holderJoins}
    where ${where} and ${after}
    order by ${orderBy}
    limit ${size + 1} offset ${number === null ? 0 : (number - 1) * size}
  `.execute(trx);
  const shown = page.slice(0, size);
  const more = page.length > size;
  return {
    rows: shown.map((r) => toRow(r, now)),
    nextCursor: cursor && more ? encodeWorkItemCursor(cursor.sort, sorts[cursor.sort].keyOf(shown.at(-1)!)) : null,
    ...(number === null ? {} : { page: { number, size, hasNext: more } }),
    // A search counts no more than its page shows ("Search and filters": no totals beyond the page).
    stageCounts: q.q === undefined ? await countByStage(trx, scope, q, now) : pageCounts(shown),
  };
}

/**
 * Export (RP-409): the rows of the List as the viewer reads them, with its filters and order,
 * through the same read: every matching row, or under a search only the pages read so far (1 to
 * the query's `page`, the last the client read), and never more than `max` rows: `capped` says
 * when more matched. Null as for the List.
 */
export function exportWorkItems(
  db: Db,
  memberId: string,
  scope: QueryScope,
  q: WorkItemQuery,
  now: Date,
  max: number = workItemExportMax,
): Promise<WorkItemExport | null> {
  return withMember(db, memberId, async (trx) => {
    if (!(await hasModuleTab(trx, scope))) return null;
    const size = q.pageSize ?? workItemPageSize;
    const read = q.q === undefined ? max : Math.min(max, (q.page ?? 1) * size);
    // One row more than given, only to tell whether more matched.
    const { rows } = await sql<Row>`
      with r as (${visibleRows(scope, q.allRevisions)})
      select r.*, ${holderColumns}
      from r
      ${holderJoins}
      where ${matching(q, now, scope)}
      order by ${columnOrder(q)}
      limit ${read + 1}
    `.execute(trx);
    // Stopped by the cap, not by the pages a search read so far.
    return { items: rows.slice(0, read).map((r) => toRow(r, now)), capped: read === max && rows.length > read };
  });
}

function pageCounts(rows: Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.stage_key, (counts.get(r.stage_key) ?? 0) + 1);
  return counts;
}

/**
 * How many of the scope's visible items match `q` in each Stage, by Stage key: the List's
 * `stages[].count`, with no rows read (Home's counts, RP-407).
 */
export const countWorkItems = (trx: Trx, scope: QueryScope, q: WorkItemQuery, now: Date) => countByStage(trx, scope, q, now);

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
    order by ${sorts[isCursorSort(q.sort) ? q.sort : "stepAge"].orderBy}
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
 * What the "With", Owner and Step filters offer, from one read of the viewer's
 * visible open items: the Steps of the viewer's own Participant, the other
 * Companies that hold one of them, each by name only (V14), and my own
 * Company's Members who have claimed one (RP-410). app.work_item_holder gives
 * no other Company's Member, and member's own RLS shows only my own Company's
 * people. Nothing that isn't in a row the viewer could list.
 */
async function holderChoices(
  trx: Trx,
  scope: QueryScope,
): Promise<Pick<WorkItemList["filters"], "with" | "owners">> {
  const { rows } = await sql<{
    held_by_own: boolean;
    step_key: string;
    step_name: BilingualText;
    participant_id: string;
    name: BilingualText;
    member_id: string | null;
    member_name: BilingualText | null;
  }>`
    with r as (${visibleRows(scope, false)})
    select distinct r.held_by_own, r.step_key, r.step_name, r.holder_participant_id as participant_id, hc.legal_name as name,
      m.id as member_id, m.full_name as member_name
    from r
    join lateral app.work_item_companies(r.id) hc on hc.participant_id = r.holder_participant_id
    left join member m on m.id = r.assignee_member_id and r.held_by_own
    where not r.closed
  `.execute(trx);
  const steps = new Map<string, BilingualText>();
  const companies = new Map<string, BilingualText>();
  const owners = new Map<string, BilingualText>();
  for (const r of rows) {
    if (r.held_by_own) {
      steps.set(r.step_key, r.step_name);
      if (r.member_id && r.member_name) owners.set(r.member_id, r.member_name);
    } else companies.set(r.participant_id, r.name);
  }
  const byName = <T extends { name: BilingualText }>(a: T, b: T) => a.name.en.localeCompare(b.name.en);
  return {
    with: {
      steps: [...steps].map(([key, name]) => ({ key, name })).sort(byName),
      companies: [...companies].map(([participantId, name]) => ({ participantId, name })).sort(byName),
    },
    owners: [...owners].map(([memberId, name]) => ({ memberId, name })).sort(byName),
  };
}

/** The Member's own Card view layout of the scope's board (RP-410), or the default. */
async function readBoardLayout(trx: Trx, { projectId, moduleKey }: QueryScope): Promise<BoardCardLayout> {
  const { rows } = await sql<{ contractor_name: boolean; location: boolean; creation_date: boolean }>`
    select contractor_name, location, creation_date from member_board_layout
    where member_id = app.current_member_id() and project_id = ${projectId}::uuid and module_key = ${moduleKey}
  `.execute(trx);
  const row = rows[0];
  return row ? { contractorName: row.contractor_name, location: row.location, creationDate: row.creation_date } : defaultBoardCardLayout;
}

/**
 * Changes the Member's own Card view layout of a board (RP-410): the switches
 * given, the others kept. Null when the Module has no tab on one of their
 * Projects, as for the board itself. app.set_board_layout writes the Member's own row only.
 */
export function changeBoardLayout(db: Db, memberId: string, scope: QueryScope, change: BoardCardLayoutChange): Promise<BoardCardLayout | null> {
  return withMember(db, memberId, async (trx) => {
    if (!(await hasModuleTab(trx, scope))) return null;
    const next = { ...(await readBoardLayout(trx, scope)), ...change };
    const { rows } = await sql<{ outcome: string }>`
      select app.set_board_layout(${scope.projectId}::uuid, ${scope.moduleKey}, ${next.contractorName}, ${next.location}, ${next.creationDate}) as outcome
    `.execute(trx);
    return rows[0]?.outcome === "set" ? next : null;
  });
}

/** The Member's own List columns of the scope's Module (RP-409), or undefined when they saved none. */
async function readListColumns(trx: Trx, { moduleKey }: QueryScope): Promise<ListColumnLayout | undefined> {
  const { rows } = await sql<{ columns: unknown }>`
    select columns from member_list_columns where member_id = app.current_member_id() and module_key = ${moduleKey}
  `.execute(trx);
  const saved = listColumnLayout.safeParse(rows[0]?.columns);
  return rows[0] && saved.success ? listColumns(saved.data) : undefined;
}

/**
 * Saves the Member's own List columns of a Module (RP-409, "Save as my default"), as the List
 * will show them. Null when the Module has no tab on the Project or it isn't one of theirs.
 * app.set_list_columns writes the Member's own row only.
 */
export function saveListColumns(db: Db, memberId: string, scope: QueryScope, columns: ListColumnLayout): Promise<ListColumnLayout | null> {
  return withMember(db, memberId, async (trx) => {
    if (!(await hasModuleTab(trx, scope))) return null;
    const layout = listColumns(columns);
    const { rows } = await sql<{ outcome: string }>`
      select app.set_list_columns(${scope.moduleKey}, ${JSON.stringify(layout)}::jsonb) as outcome
    `.execute(trx);
    return rows[0]?.outcome === "set" ? layout : null;
  });
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
    const { rows, nextCursor, page, stageCounts } = await queryWorkItems(trx, scope, q, now);
    const columnLayout = await readListColumns(trx, scope);
    return {
      ...(await stagesAndFilters(trx, scope, stageCounts)),
      items: rows,
      nextCursor,
      ...(page ? { page } : {}),
      ...(columnLayout ? { columnLayout } : {}),
    };
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
    return { stages, filters, columns, moves, layout: await readBoardLayout(trx, scope) };
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
    .where("project_id", "=", projectId)
    .orderBy("sort")
    .orderBy("key")
    .execute();
  const types = await trx
    .selectFrom("work_item_type")
    .select(["code", "name"])
    .where("module_key", "=", scope.moduleKey)
    .where((eb) => eb.or([eb("project_id", "is", null), eb("project_id", "=", projectId)]))
    .orderBy("code")
    .execute();
  // Each Type's outcomes on the Project (RP-429), for the "Review Code / Result" filter and the
  // outcome badges: read like the Types themselves, the Project's copies.
  const { rows: outcomes } = await sql<WorkItemList["filters"]["outcomes"][number]>`
    select t.code as type, o.code, o.name, o.closing, o.polarity, o.actions
    from outcome o
    join work_item_type t on t.id = o.work_item_type_id
    where o.project_id = ${projectId}::uuid and t.module_key = ${scope.moduleKey}
      and (t.project_id is null or t.project_id = ${projectId}::uuid)
    order by t.code, o.sort, o.code
  `.execute(trx);
  const { rows: values } = await sql<{
    kind: "trade" | "location";
    id: string;
    code: string;
    name: BilingualText;
    parent_id: string | null;
    depth: number;
    level_name: BilingualText | null;
  }>`
    select d.kind, v.id, v.code, v.name, v.parent_id, v.depth, v.level_name
    from dimension_value v
    join visibility_dimension d on d.id = v.dimension_id
    where v.project_id = ${projectId} and d.kind in ('trade', 'location')
    order by v.depth, v.sort, v.code
  `.execute(trx);
  return {
    stages: stages.map((s) => ({ ...s, count: stageCounts.get(s.key) ?? 0 })),
    filters: {
      types,
      outcomes,
      trades: values.filter((v) => v.kind === "trade").map(({ id, code, name }) => ({ id, code, name })),
      locations: values
        .filter((v) => v.kind === "location")
        .map(({ id, code, name, parent_id, depth, level_name }) => ({ id, code, name, parentId: parent_id, depth, levelName: level_name })),
      ...(await holderChoices(trx, scope)),
    },
  };
}
