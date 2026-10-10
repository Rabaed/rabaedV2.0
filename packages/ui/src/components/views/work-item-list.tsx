"use client";

import {
  formatNumber,
  isFilteredWorkItemQuery,
  listColumns,
  searchMaxLength,
  withoutFilters,
  stepAgeMinimums,
  createdWithinDays,
  workItemPageSize,
  type BilingualText,
  outcomeLabel,
  type CodeCFilter,
  type FixedChainBucket,
  type ListColumnKey,
  type ListColumnLayout,
  type Locale,
  type WorkItemList as WorkItemListData,
  type WorkItemQuery,
} from "@rabaed/domain";
import { type ElementType, type ReactNode } from "react";
import { Badge } from "../data/badge.tsx";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Avatar } from "../data/avatar.tsx";
import { Icon } from "../icon/icon.tsx";
import { FilterMenu, FilterValues, type FilterChoice, type FilterMenuField } from "../list/filter-menu.tsx";
import { poolIcon, tradeChipClass } from "./kanban-card.tsx";
import { ListToolbar, ToolbarSearch, ToolbarSwitch } from "../list/list-toolbar.tsx";
import { Pager, TableCard } from "../list/table-card.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StageDot } from "../status/stage-pill.tsx";
import { WorkItemTable } from "./work-item-table.tsx";

/**
 * The List's words, in the viewer's language, from the app's messages: the
 * package has no translations of its own. A function takes a value already
 * formatted for the viewer's locale.
 */
export type WorkItemListLabels = {
  toolbar: string;
  /** A filter's "no filter" choice. */
  all: string;
  type: string;
  stage: string;
  with: string;
  withMe: string;
  /** After a Step's name, when nobody in the viewer's Company has claimed it. */
  unclaimed: string;
  /** The "With" filter's choice of every unclaimed Step. */
  anyUnclaimed: string;
  trade: string;
  location: string;
  outcome: string;
  stepAge: string;
  /** `weeks` is `count` written in the reader's digits; `count` chooses the plural. */
  weeksOrMore: (weeks: string, count: number) => string;
  submissionDate: string;
  creationDate: string;
  submittedFrom: string;
  submittedTo: string;
  allRevisions: string;
  needMyAction: string;
  clear: string;
  /** The table's name: the Module's, e.g. "Submittals". */
  table: string;
  /** Each column's header (RP-409, the owner's design). */
  columns: Record<ListColumnKey, string>;
  /** A column's sort button, e.g. "Sort by Title". */
  sortBy: (column: string) => string;
  /** A letter outcome's pill, e.g. "Code A". */
  code: (code: string) => string;
  /** The Revision chip, e.g. "R2". */
  revision: (n: string) => string;
  noNumber: string;
  revisionNoNumber: (revision: string) => string;
  empty: string;
  search: string;
  /** The search box's placeholder, e.g. "Search this list". */
  searchPlaceholder: string;
  /** What the search looks in, read with the box. */
  searchHelp: string;
  noResults: string;
  /** The Filters button and its panel. */
  filters: string;
  clearAll: string;
  done: string;
  close: string;
  /** The filter panel's footer: `n` is `count` written for the locale; `count` chooses the plural. */
  filtersApplied: (n: string, count: number) => string;
  pages: string;
  firstPage: string;
  previousPage: string;
  nextPage: string;
  /** "Page 3", when the number of pages can't be said (a search). */
  page: (page: string) => string;
  /** "Page 3 of 5". */
  pageOf: (page: string, pages: string) => string;
  /** "230 items": `n` is `count` written for the locale; `count` chooses the plural. */
  items: (n: string, count: number) => string;
  /** The outcome of a cancelled item, as its filter choice and its badge; every other outcome is named by its Type's set (RP-429). */
  cancelled: string;
  /** Before a Dashboard number's filter (its buckets and Code C sub-states), which the toolbar has no control for. */
  dashboardFigure: string;
  /** Each Dashboard bucket that isn't an outcome (chainBucket), as the Dashboard names it. */
  buckets: Record<FixedChainBucket, string>;
  /** Each sub-state of the Dashboard's Code C line (codeCState). */
  codeCStates: Record<CodeCFilter, string>;
  /** The filter panel's fields (RP-410): the Type as "Document type", who holds it, the role holding it, the card's date. */
  documentType: string;
  owner: string;
  role: string;
  createdDate: string;
  /** "Last 7 days": `days` is `count` written for the locale. */
  withinDays: (days: string, count: number) => string;
  /** A Location level with no name of its own, e.g. "Level 2". */
  level: (n: string) => string;
  /** Clears one field of the filter panel. */
  clearField: string;
  /** The filter panel's value search. */
  searchValues: string;
  noMatches: string;
  /** The filter panel's name for the Stage field: "Status", as the owner's anatomy has it. */
  statusField: string;
  /** The search box's placeholder on the Kanban, e.g. "Search this board". */
  searchPlaceholderBoard: string;
  /** The filter panel's field for "Show all Revisions" (RP-410: the toolbar keeps the anatomy's five controls). */
  revisions: string;
};

/** The filter fields' names in the other language, shown small after each (the anatomy's bilingual field list). */
export type WorkItemFilterHints = Partial<Record<"stage" | "trade" | "documentType" | "owner" | "role" | "createdDate" | "stepAge" | "outcome" | "submissionDate" | "revisions", string>>;

/** The labels that take no value, for `t`. */
type TextLabel = { [K in keyof WorkItemListLabels]: WorkItemListLabels[K] extends string ? K : never }[keyof WorkItemListLabels];

/** Each Type's outcomes on the Project, as the List and the Kanban send them (RP-429). */
export type ListOutcomes = WorkItemListData["filters"]["outcomes"];

/** Each outcome code of the Types, once (the first Type's name), then Cancelled: the outcome filter's choices. */
function outcomeOptions(outcomes: ListOutcomes, locale: Locale, cancelled: string) {
  const byCode = new Map<string, string>();
  for (const o of outcomes) if (!byCode.has(o.code)) byCode.set(o.code, outcomeLabel(o, locale));
  return [...[...byCode].map(([value, label]) => ({ value, label })), { value: "cancelled", label: cancelled }];
}

/** A bucket's name: the app's word for a fixed one, else the outcome's from the Types' sets. */
function bucketLabel(bucket: string, outcomes: ListOutcomes, locale: Locale, labels: WorkItemListLabels): string {
  const fixed = (labels.buckets as Record<string, string>)[bucket];
  if (fixed !== undefined) return fixed;
  const outcome = outcomes.find((o) => o.code === bucket);
  return outcome ? outcomeLabel(outcome, locale) : bucket;
}

/**
 * The pages before this one, as the List keeps them to go back: the cursor of
 * each page from the second to the one before this, oldest first. Empty on the
 * second page; undefined when not known (a link from elsewhere into a later page).
 */
export type WorkItemPageTrail = readonly string[];

export type WorkItemListProps = {
  /** One page of the work item query, as the API returns it. */
  list: WorkItemListData;
  /** The query the page shows. */
  query: WorkItemQuery;
  locale: Locale;
  labels: WorkItemListLabels;
  /** The List's URL for `query`: a filter link, a page; `pageTrail` is the pages before it, to keep in the URL. */
  hrefFor: (query: WorkItemQuery, pageTrail?: WorkItemPageTrail) => string;
  /** The pages before this one (from the URL), so the pager can go back and number the page. */
  pageTrail?: WorkItemPageTrail;
  /** An item's page. */
  itemHref: (id: string) => string;
  /** Shows the List for `query` (the web navigates to `hrefFor(query)`). */
  onQueryChange: (query: WorkItemQuery) => void;
  /** The toolbar's primary action, at its start, e.g. "New Material Submittal". */
  action?: ReactNode;
  /** At the toolbar's end: the List / Kanban switch. */
  viewSwitch?: ReactNode;
  /** The link component for items and pages, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  /** The Kanban (`WorkItemBoard`), shown under the toolbar in place of the Stage counts, table and pages. */
  board?: ReactNode;
  /** The filter fields' names in the other language. */
  hints?: WorkItemFilterHints;
  /** The table's columns in order, each shown or not; by default the Member's own (`list.columnLayout`), else the design's. */
  columns?: ListColumnLayout;
};

/**
 * The List of a Module's Work Items (spec RP-344), on the data list page
 * template (RP-409): a toolbar (action, search, Filters, the Need My Action and
 * "Show all Revisions" switches, the view switch), the Stage counts of the
 * matching items, and one page of them, 50 rows, in a card with its pager.
 * Every choice is a new query, which the page keeps in its URL. "With" follows
 * V14: the Step and who claimed it in the viewer's own Company, another
 * Company's name only, as the API sends it. The table scrolls sideways in its
 * own region on a narrow screen.
 */
export function WorkItemList({
  list,
  query,
  locale,
  labels,
  hrefFor,
  pageTrail,
  itemHref,
  onQueryChange,
  action,
  viewSwitch,
  linkAs: Link = "a",
  board,
  hints,
  columns = listColumns(list.columnLayout),
}: WorkItemListProps) {
  const t = (key: TextLabel) => labels[key];
  const n = (value: number) => formatNumber(value, locale);
  const change = (next: Partial<WorkItemQuery>) => {
    const { cursor: _cursor, ...rest } = query;
    onQueryChange({ ...rest, ...next });
  };
  const filtered = isFilteredWorkItemQuery(query);

  const valueLabels = { clear: t("clearField"), search: t("searchValues"), noMatches: t("noMatches") };
  /** A field of several values, any of them (RP-410). */
  const many = (
    key: "type" | "stage" | "owner" | "role" | "trade" | "outcome",
    label: string,
    hint: string | undefined,
    group: string,
    options: FilterChoice[],
  ): FilterMenuField => ({
    key,
    label,
    hint,
    group,
    count: query[key].length,
    content: (
      <FilterValues
        label={label}
        hint={hint}
        values={query[key]}
        choices={options}
        labels={valueLabels}
        onChange={(values) => change({ [key]: values })}
      />
    ),
  });
  // The Kanban has no Drafts column, so its Stage field leaves Drafts out; the List keeps them (RP-410).
  const stageChoices = (board ? list.stages.filter((s) => s.category !== "draft") : list.stages).map((s) => ({
    value: s.key,
    label: s.name[locale],
    mark: <StageDot stage={stageColour(s)} />,
  }));
  // Zone, Building, Floor…: one field per level of the Location tree, its values any of them; levels together, all of them.
  const levels = locationLevels(list.filters.locations, locale, labels);
  const fields: FilterMenuField[] = [
    // The filter panel names the Stage "Status" and the Step "Role", as the owner's anatomy does (2026-10-10).
    many("stage", t("statusField"), hints?.stage, "workflow", stageChoices),
    many(
      "trade",
      t("trade"),
      hints?.trade,
      "workflow",
      list.filters.trades.map((v) => ({
        value: v.id,
        text: `${v.name[locale]} ${v.code}`,
        label: (
          <span className={cn("inline-flex h-5 items-center rounded-[6px] px-1.5 text-notes font-semibold", tradeChipClass(v.code))}>
            {v.name[locale]} (<bdi translate="no">{v.code}</bdi>)
          </span>
        ),
      })),
    ),
    many(
      "type",
      t("documentType"),
      hints?.documentType,
      "workflow",
      list.filters.types.map((v) => ({
        value: v.code,
        text: `${v.code} ${v.name[locale]}`,
        label: v.name[locale],
        mark: (
          <span translate="no" className="font-ui text-notes font-bold text-muted">
            {v.code}
          </span>
        ),
      })),
    ),
    // My own Company's people, my unclaimed pool, and another Company by its name only (V14).
    many("owner", t("owner"), hints?.owner, "workflow", [
      ...list.filters.owners.map((o) => ({ value: `member:${o.memberId}`, label: o.name[locale], mark: <Avatar name={o.name[locale]} size="sm" decorative className="size-5" /> })),
      {
        value: "unclaimed",
        label: t("anyUnclaimed"),
        mark: (
          <span className="inline-flex size-5 items-center justify-center rounded-full border border-dashed border-border-strong text-muted">
            <Icon name={poolIcon} size={11} />
          </span>
        ),
      },
      ...list.filters.with.companies.map((c) => ({
        value: `company:${c.participantId}`,
        label: c.name[locale],
        mark: <Avatar name={c.name[locale]} kind="company" size="sm" decorative className="size-5" />,
      })),
    ]),
    // My own Company's Steps only: another Company is one lane, never its roles (V5).
    many(
      "role",
      t("role"),
      hints?.role,
      "workflow",
      list.filters.with.steps.map((s, i) => ({ value: s.key, label: s.name[locale], mark: <span className={cn("size-2 rounded-full", roleDots[i % roleDots.length])} /> })),
    ),
    ...levels.map(
      (level): FilterMenuField => ({
        key: `location-${level.key}`,
        label: level.label,
        hint: level.hint,
        group: "place",
        count: query.location.filter((id) => level.ids.has(id)).length,
        content: (
          <FilterValues
            label={level.label}
            hint={level.hint}
            values={query.location.filter((id) => level.ids.has(id))}
            choices={level.choices}
            labels={valueLabels}
            onChange={(values) => change({ location: [...query.location.filter((id) => !level.ids.has(id)), ...values] })}
          />
        ),
      }),
    ),
    {
      key: "createdDate",
      label: t("createdDate"),
      hint: hints?.createdDate,
      group: "time",
      count: query.createdWithin === undefined ? 0 : 1,
      content: (
        <FilterValues
          label={t("createdDate")}
          hint={hints?.createdDate}
          multiple={false}
          values={query.createdWithin === undefined ? [] : [String(query.createdWithin)]}
          choices={createdWithinDays.map((days) => ({ value: String(days), label: labels.withinDays(n(days), days) }))}
          labels={valueLabels}
          onChange={([v]) => change({ createdWithin: v ? (Number(v) as WorkItemQuery["createdWithin"]) : undefined })}
        />
      ),
    },
    {
      key: "stepAge",
      label: t("stepAge"),
      hint: hints?.stepAge,
      group: "time",
      count: query.stepAgeMin === undefined ? 0 : 1,
      content: (
        <FilterValues
          label={t("stepAge")}
          hint={hints?.stepAge}
          multiple={false}
          values={query.stepAgeMin === undefined ? [] : [String(query.stepAgeMin)]}
          choices={stepAgeMinimums.map((weeks) => ({
            value: String(weeks),
            label: labels.weeksOrMore(n(weeks), weeks),
            mark: <AgeDots weeks={weeks} locale={locale} />,
          }))}
          labels={valueLabels}
          onChange={([v]) => change({ stepAgeMin: v ? (Number(v) as WorkItemQuery["stepAgeMin"]) : undefined })}
        />
      ),
    },
    many("outcome", t("outcome"), hints?.outcome, "more", outcomeOptions(list.filters.outcomes, locale, labels.cancelled)),
    {
      // Every visible Revision, not only the latest of each chain: how the rows are shown, so not a filter of the query.
      key: "revisions",
      label: t("revisions"),
      hint: hints?.revisions,
      group: "more",
      count: query.allRevisions ? 1 : 0,
      content: (
        <FilterValues
          label={t("revisions")}
          hint={hints?.revisions}
          values={query.allRevisions ? ["all"] : []}
          choices={[{ value: "all", label: t("allRevisions") }]}
          labels={valueLabels}
          onChange={(values) => change({ allRevisions: values.includes("all") })}
        />
      ),
    },
    {
      key: "submissionDate",
      label: t("submissionDate"),
      hint: hints?.submissionDate,
      group: "more",
      count: (query.submittedFrom ? 1 : 0) + (query.submittedTo ? 1 : 0),
      content: (
        <div className="flex flex-col gap-3 px-[14px] py-1">
          <Field label={t("submittedFrom")}>
            <Input type="date" value={query.submittedFrom ?? ""} max={query.submittedTo} onChange={(e) => change({ submittedFrom: e.target.value || undefined })} />
          </Field>
          <Field label={t("submittedTo")}>
            <Input type="date" value={query.submittedTo ?? ""} min={query.submittedFrom} onChange={(e) => change({ submittedTo: e.target.value || undefined })} />
          </Field>
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ListToolbar label={t("toolbar")} end={viewSwitch} className="gap-3">
        {action}
        <ToolbarSearch
          tall
          // A new query (back button, a cleared filter) shows its own words.
          key={query.q ?? ""}
          value={query.q}
          label={t("search")}
          placeholder={board ? t("searchPlaceholderBoard") : t("searchPlaceholder")}
          maxLength={searchMaxLength}
          description={t("searchHelp")}
          onSearch={(q) => change({ q })}
        />
        <span className="inline-flex shrink-0 items-center">
        <FilterMenu
          // With filters on, the button carries a small × that clears them (search and Need My Action too), so the toolbar keeps one row.
          triggerClassName={filtered ? "rounded-e-none" : undefined}
          fields={fields}
          labels={{ filters: t("filters"), clearAll: t("clearAll"), done: t("done"), close: t("close"), applied: labels.filtersApplied, number: n }}
          onClearAll={() =>
            change({
              type: [],
              stage: [],
              with: [],
              owner: [],
              role: [],
              trade: [],
              location: [],
              outcome: [],
              stepAgeMin: undefined,
              createdWithin: undefined,
              submittedFrom: undefined,
              submittedTo: undefined,
              allRevisions: false,
            })
          }
        />
        {filtered && (
          <Link
            href={hrefFor(withoutFilters(query))}
            aria-label={t("clear")}
            title={t("clear")}
            className={cn(
              "-ms-px inline-flex h-[42px] w-9 items-center justify-center rounded-e-sm border border-border-strong bg-surface text-muted hover:bg-hover hover:text-text pointer-coarse:min-h-11 pointer-coarse:w-11",
              focusRing,
            )}
          >
            <Icon name="x" size={16} />
          </Link>
        )}
        </span>
        <ToolbarSwitch label={t("needMyAction")} checked={query.needMyAction} onCheckedChange={(on) => change({ needMyAction: on })} />
        {/* A Dashboard number's filter, which the toolbar has no control for: its buckets and Code C sub-states. */}
        {query.bucket.length + query.codeC.length > 0 && (
          <Badge tone="info" data-testid="bucket-filter">
            {t("dashboardFigure")}:{" "}
            {[
              ...query.bucket.map((bucket) => bucketLabel(bucket, list.filters.outcomes, locale, labels)),
              ...query.codeC.map((codeC) => labels.codeCStates[codeC]),
            ].join(", ")}
          </Badge>
        )}
      </ListToolbar>

      {board ?? (
        <>
          <TableCard footer={<WorkItemPager list={list} query={query} labels={labels} locale={locale} hrefFor={hrefFor} pageTrail={pageTrail} linkAs={Link} />}>
            {/* The table scrolls sideways (and, on a wide screen, down) in its own region, so the page never does. */}
            <div role="region" aria-label={t("table")} tabIndex={0} className={cn("min-h-64 overflow-auto lg:max-h-[calc(100dvh-17rem)]", focusRing)}>
              <WorkItemTable
                rows={list.items}
                filters={list.filters}
                columns={columns}
                query={query}
                locale={locale}
                labels={{ ...labels, empty: t(query.q === undefined ? "empty" : "noResults") }}
                onSort={(sort) => change(sort)}
                itemHref={itemHref}
                linkAs={Link}
              />
            </div>
          </TableCard>
        </>
      )}
    </div>
  );
}

/**
 * The List's pager: First / Previous / Next over the cursor pages, and "Page x
 * of y · n items". Under a search there is no total ("Search and filters": a
 * search counts no more than its page), so the line says the page alone.
 */
function WorkItemPager({
  list,
  query,
  labels,
  locale,
  hrefFor,
  pageTrail,
  linkAs,
}: Pick<WorkItemListProps, "list" | "query" | "labels" | "locale" | "hrefFor" | "pageTrail" | "linkAs">) {
  const n = (value: number) => formatNumber(value, locale);
  const onFirst = query.cursor === undefined;
  // The page's number: 1 without a cursor; from the trail when it is known.
  const page = onFirst ? 1 : pageTrail === undefined ? null : pageTrail.length + 2;
  const first = onFirst ? undefined : hrefFor({ ...query, cursor: undefined });
  const previous =
    onFirst || pageTrail === undefined
      ? undefined
      : pageTrail.length === 0
        ? first
        : hrefFor({ ...query, cursor: pageTrail.at(-1) }, pageTrail.slice(0, -1));
  const nextTrail = onFirst ? [] : pageTrail === undefined ? undefined : [...pageTrail, query.cursor!];
  const next = list.nextCursor === null ? undefined : hrefFor({ ...query, cursor: list.nextCursor }, nextTrail);

  const total = query.q === undefined ? list.stages.reduce((sum, s) => sum + s.count, 0) : null;
  const pages = total === null ? null : Math.max(1, Math.ceil(total / workItemPageSize));
  const pageLine = page === null ? null : pages === null ? labels.page(n(page)) : labels.pageOf(n(page), n(pages));
  const parts = [pageLine, total === null ? null : labels.items(n(total), total)].filter((p) => p !== null);
  return (
    <Pager
      labels={{ pages: labels.pages, first: labels.firstPage, previous: labels.previousPage, next: labels.nextPage }}
      summary={parts.length > 0 ? parts.join(" · ") : undefined}
      first={first}
      previous={previous}
      next={next}
      linkAs={linkAs}
    />
  );
}

// The Role field's dots, as the board's lanes have them: my own Steps in turn.
const roleDots = ["bg-stage-internal-dot", "bg-stage-pending-dot", "bg-trade-el-fg", "bg-stage-approved-dot"];

/**
 * The Location tree's levels (Zone, Building, Floor…), each a filter field named
 * by its level, its values the Locations at that level, each with the ones above
 * it after its name so it reads in place (Floor 1 · Building 1).
 */
function locationLevels(locations: WorkItemListData["filters"]["locations"], locale: Locale, labels: WorkItemListLabels) {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const above = (id: string | null, seen = new Set<string>()): BilingualText[] => {
    const l = id ? byId.get(id) : undefined;
    if (!l || seen.has(l.id)) return [];
    seen.add(l.id);
    return [...above(l.parentId, seen), l.name];
  };
  // A level is its name (its depth where it has none), as the API groups it, so an uneven tree
  // (a Floor right under a Zone) still puts every Floor in one field; levels in the order they first appear.
  const levelOf = (l: (typeof locations)[number]) => (l.levelName ? `name:${l.levelName.en}` : `depth:${l.depth}`);
  const firstDepth = new Map<string, number>();
  for (const l of locations) firstDepth.set(levelOf(l), Math.min(firstDepth.get(levelOf(l)) ?? l.depth, l.depth));
  const levels = [...firstDepth].sort((a, b) => a[1] - b[1]);
  return levels.map(([key, depth]) => {
    const at = locations.filter((l) => levelOf(l) === key);
    const named = at.find((l) => l.levelName !== null)?.levelName;
    return {
      key,
      label: named ? named[locale] : labels.level(formatNumber(depth, locale)),
      // The level's name in the other language, as the other fields have it.
      hint: named ? named[locale === "en" ? "ar" : "en"] : undefined,
      ids: new Set(at.map((l) => l.id)),
      choices: at
        .map((l): FilterChoice => {
          const path = above(l.parentId).map((p) => p[locale]);
          const where = path.reverse().join(" · ");
          return {
            value: l.id,
            text: `${l.name[locale]} ${where}`,
            label: (
              <span className="flex flex-wrap items-baseline gap-x-1.5">
                <span>{l.name[locale]}</span>
                {where && <span className="text-caption text-muted">{where}</span>}
              </span>
            ),
          };
        })
        .sort((a, b) => (a.text ?? "").localeCompare(b.text ?? "", locale)),
    };
  });
}

