"use client";

import {
  formatDate,
  formatNumber,
  isFilteredWorkItemQuery,
  isOpenStageCategory,
  searchMaxLength,
  withoutFilters,
  stepAgeMinimums,
  workItemPageSize,
  type BilingualText,
  type ChainBucket,
  type CodeCFilter,
  type Locale,
  type WorkItemList as WorkItemListData,
  type WorkItemOutcome,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import { type ElementType, type ReactNode } from "react";
import type { Tone } from "../../tokens/themes.ts";
import { buttonVariants } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, type TableSort } from "../data/table.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { cn } from "../../lib/cn.ts";
import { touchBox } from "../form/control-styles.ts";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { FilterChoices, FilterMenu, type FilterMenuField } from "../list/filter-menu.tsx";
import { ListToolbar, ToolbarSearch, ToolbarSwitch } from "../list/list-toolbar.tsx";
import { Pager, TableCard } from "../list/table-card.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { CodeBadge } from "../status/code-badge.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StageDot, StagePill } from "../status/stage-pill.tsx";
import { WithChip } from "../status/with-chip.tsx";

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
  stageCounts: string;
  /** The table's name: the Module's, e.g. "Submittals". */
  table: string;
  documentNumber: string;
  subject: string;
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
  /** Each Review Code and Inspection Result, as its filter choice and its badge. */
  outcomes: Record<WorkItemOutcome, string>;
  /** Before a Dashboard number's filter (its buckets and Code C sub-states), which the toolbar has no control for. */
  dashboardFigure: string;
  /** Each Dashboard bucket (chainBucket), as the Dashboard names it. */
  buckets: Record<ChainBucket, string>;
  /** Each sub-state of the Dashboard's Code C line (codeCState). */
  codeCStates: Record<CodeCFilter, string>;
};

/** The labels that take no value, for `t`. */
type TextLabel = { [K in keyof WorkItemListLabels]: WorkItemListLabels[K] extends string ? K : never }[keyof WorkItemListLabels];

const outcomeTones: Record<WorkItemOutcome, Tone> = {
  A: "success",
  B: "success",
  C: "warning",
  D: "danger",
  passed: "success",
  passed_with_comments: "success",
  failed: "danger",
  cancelled: "neutral",
  closed: "neutral",
};

/** Each sort's column order, as `aria-sort` says it: Step Age oldest first, Document Number A to Z, Submission Date latest first. */
const sortOrders = { stepAge: "descending", documentNumber: "ascending", submissionDate: "descending" } as const satisfies Record<
  WorkItemQuery["sort"],
  TableSort
>;

const reviewCodes = { A: "a", B: "b", C: "c", D: "d" } as const;

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
}: WorkItemListProps) {
  const t = (key: TextLabel) => labels[key];
  const n = (value: number) => formatNumber(value, locale);
  const change = (next: Partial<WorkItemQuery>) => {
    const { cursor: _cursor, ...rest } = query;
    onQueryChange({ ...rest, ...next });
  };
  const filtered = isFilteredWorkItemQuery(query);
  // The Creation Date is the raiser's Company's alone: the API sends it to no one else, so without one in the rows the column is left out.
  const showCreationDate = list.items.some((i) => i.creationDate !== null);
  const columns = showCreationDate ? 11 : 10;
  const date = (iso: string | null) => (iso === null ? null : formatDate(new Date(iso), locale));
  const sortHead = (sort: WorkItemQuery["sort"]) => ({
    sort: query.sort === sort ? sortOrders[sort] : ("none" as const),
    onSort: () => {
      if (query.sort !== sort) change({ sort });
    },
  });

  const choices = (
    key: "type" | "stage" | "with" | "trade" | "location" | "outcome",
    label: string,
    options: { value: string; label: ReactNode; mark?: ReactNode }[],
  ): FilterMenuField => ({
    key,
    label,
    count: query[key].length,
    content: (
      <FilterChoices
        label={label}
        allLabel={t("all")}
        value={query[key][0]}
        choices={options}
        onChange={(v) => change({ [key]: v ? [v] : [] })}
      />
    ),
  });
  const fields: FilterMenuField[] = [
    choices("type", t("type"), list.filters.types.map((v) => ({ value: v.code, label: v.name[locale] }))),
    choices(
      "stage",
      t("stage"),
      list.stages.map((s) => ({ value: s.key, label: s.name[locale], mark: <StageDot stage={stageColour(s)} /> })),
    ),
    choices("with", t("with"), [
      { value: "me", label: t("withMe") },
      { value: "unclaimed", label: t("anyUnclaimed") },
      ...list.filters.with.steps.map((s) => ({ value: `step:${s.key}`, label: s.name[locale] })),
      ...list.filters.with.companies.map((c) => ({ value: `company:${c.participantId}`, label: c.name[locale] })),
    ]),
    choices("trade", t("trade"), list.filters.trades.map((v) => ({ value: v.id, label: v.name[locale] }))),
    choices("location", t("location"), locationOptions(list.filters.locations, locale)),
    choices("outcome", t("outcome"), Object.entries(labels.outcomes).map(([value, label]) => ({ value, label }))),
    {
      key: "stepAge",
      label: t("stepAge"),
      count: query.stepAgeMin === undefined ? 0 : 1,
      content: (
        <FilterChoices
          label={t("stepAge")}
          allLabel={t("all")}
          value={query.stepAgeMin === undefined ? undefined : String(query.stepAgeMin)}
          choices={stepAgeMinimums.map((weeks) => ({
            value: String(weeks),
            label: labels.weeksOrMore(n(weeks), weeks),
            mark: <AgeDots weeks={weeks} locale={locale} />,
          }))}
          onChange={(v) => change({ stepAgeMin: v ? (Number(v) as WorkItemQuery["stepAgeMin"]) : undefined })}
        />
      ),
    },
    {
      key: "submissionDate",
      label: t("submissionDate"),
      count: (query.submittedFrom ? 1 : 0) + (query.submittedTo ? 1 : 0),
      content: (
        <div className="flex flex-col gap-3 p-1">
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
      <ListToolbar label={t("toolbar")} end={viewSwitch}>
        {action}
        <ToolbarSearch
          // A new query (back button, a cleared filter) shows its own words.
          key={query.q ?? ""}
          value={query.q}
          label={t("search")}
          placeholder={t("searchPlaceholder")}
          maxLength={searchMaxLength}
          description={t("searchHelp")}
          onSearch={(q) => change({ q })}
        />
        <FilterMenu
          fields={fields}
          labels={{ filters: t("filters"), clearAll: t("clearAll"), done: t("done"), close: t("close"), applied: labels.filtersApplied, number: n }}
          onClearAll={() =>
            change({ type: [], stage: [], with: [], trade: [], location: [], outcome: [], stepAgeMin: undefined, submittedFrom: undefined, submittedTo: undefined })
          }
        />
        <ToolbarSwitch label={t("needMyAction")} checked={query.needMyAction} onCheckedChange={(on) => change({ needMyAction: on })} />
        <ToolbarSwitch label={t("allRevisions")} checked={query.allRevisions} onCheckedChange={(on) => change({ allRevisions: on })} />
        {/* A Dashboard number's filter, which the toolbar has no control for: its buckets and Code C sub-states. */}
        {query.bucket.length + query.codeC.length > 0 && (
          <Badge tone="info" data-testid="bucket-filter">
            {t("dashboardFigure")}:{" "}
            {[...query.bucket.map((bucket) => labels.buckets[bucket]), ...query.codeC.map((codeC) => labels.codeCStates[codeC])].join(", ")}
          </Badge>
        )}
        {filtered && (
          <Link href={hrefFor(withoutFilters(query))} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t("clear")}
          </Link>
        )}
      </ListToolbar>

      {board ?? (
        <>
          <ul aria-label={t("stageCounts")} className="flex flex-wrap gap-2" data-testid="stage-counts">
            {list.stages.map((s) => (
              <li key={s.key}>
                <StagePill stage={stageColour(s)} label={s.name[locale]} count={s.count} locale={locale} />
              </li>
            ))}
          </ul>

          <TableCard footer={<WorkItemPager list={list} query={query} labels={labels} locale={locale} hrefFor={hrefFor} pageTrail={pageTrail} linkAs={Link} />}>
            <Table
              label={t("table")}
              stickyHeader
              className="w-max min-w-full text-sm [&_td]:whitespace-nowrap"
              containerClassName="min-h-64 lg:max-h-[calc(100dvh-20rem)]"
            >
              <TableHeader>
                <TableRow>
                  <TableHead {...sortHead("documentNumber")}>{t("documentNumber")}</TableHead>
                  <TableHead>{t("subject")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>{t("stage")}</TableHead>
                  <TableHead>{t("with")}</TableHead>
                  <TableHead {...sortHead("stepAge")}>{t("stepAge")}</TableHead>
                  <TableHead>{t("trade")}</TableHead>
                  <TableHead>{t("location")}</TableHead>
                  <TableHead className="min-w-28 whitespace-normal">{t("outcome")}</TableHead>
                  <TableHead {...sortHead("submissionDate")}>{t("submissionDate")}</TableHead>
                  {showCreationDate && <TableHead>{t("creationDate")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.length === 0 ? (
                  <TableEmpty colSpan={columns}>
                    <p className="px-4 py-12 text-center text-muted">{t(query.q === undefined ? "empty" : "noResults")}</p>
                  </TableEmpty>
                ) : (
                  list.items.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      // The whole row opens the item; the Subject is its link, for the keyboard and screen readers.
                      onClick={(event) => {
                        if ((event.target as Element).closest("a")) return;
                        event.currentTarget.querySelector<HTMLAnchorElement>("a[data-item-link]")?.click();
                      }}
                    >
                      <TableCell className="tabular-nums">
                        {/* A Revision's number carries its " Rev n"; one with no number yet says which Revision it is. */}
                        {item.documentNumber ? (
                          <DocNo value={item.documentNumber} locale={locale} />
                        ) : (
                          <span className="text-muted">
                            {item.revisionNo > 0 ? labels.revisionNoNumber(n(item.revisionNo)) : t("noNumber")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={itemHref(item.id)}
                          data-item-link=""
                          dir="auto"
                          title={item.title}
                          className={cn("block w-fit max-w-64 truncate font-semibold text-text hover:text-brand-fg hover:underline", touchBox)}
                        >
                          {item.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex h-5 items-center rounded-xs px-1.5 font-ui text-notes font-bold tracking-wide text-text-secondary ring-1 ring-border-strong ring-inset">
                          {item.type.code}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StagePill stage={stageColour(item.stage)} label={item.stage.name[locale]} locale={locale} />
                      </TableCell>
                      <TableCell>
                        <WithCell row={item} locale={locale} unclaimed={t("unclaimed")} />
                      </TableCell>
                      <TableCell>
                        {/* A closed item doesn't age. */}
                        {isOpenStageCategory(item.stage.category) && item.stepAgeWeeks !== null ? <AgeDots weeks={item.stepAgeWeeks} locale={locale} /> : null}
                      </TableCell>
                      <TableCell>
                        <Badge>
                          {item.trade.name[locale]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-text-secondary">{item.location?.name[locale]}</TableCell>
                      <TableCell>{item.outcome ? <Outcome outcome={item.outcome} locale={locale} labels={labels.outcomes} /> : null}</TableCell>
                      <TableCell className="text-text-secondary">{date(item.submissionDate)}</TableCell>
                      {showCreationDate && <TableCell className="text-text-secondary">{date(item.creationDate)}</TableCell>}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
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

/** Each Location with the ones above it, so it reads in place (Tower 1 › Building A). */
function locationOptions(locations: WorkItemListData["filters"]["locations"], locale: Locale) {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const path = (id: string | null, seen = new Set<string>()): BilingualText[] => {
    const l = id ? byId.get(id) : undefined;
    if (!l || seen.has(l.id)) return [];
    seen.add(l.id);
    return [...path(l.parentId, seen), l.name];
  };
  return locations
    .map((l) => ({ value: l.id, label: path(l.id).map((n) => n[locale]).join(" › ") }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

/** "With", as V14 has it. */
function WithCell({ row, locale, unclaimed }: { row: WorkItemRow; locale: Locale; unclaimed: string }) {
  const w = row.with;
  if (!w) return null;
  if (w.kind === "company") return <WithChip kind="company" inViewerCompany={false} companyName={w.companyName[locale]} />;
  if (!w.claimer) {
    return <WithChip kind="pool" inViewerCompany companyName={w.companyName[locale]} stepName={w.step.name[locale]} unclaimedLabel={unclaimed} />;
  }
  return <WithChip kind="person" inViewerCompany name={w.claimer.name[locale]} companyName={w.companyName[locale]} />;
}

/**
 * The Review Code or Inspection Result badge, the same on the List and the
 * Kanban. A Review Code says its meaning in the fixed product wording of
 * `CodeBadge`; anything else says its label.
 */
export function Outcome({ outcome, locale, labels }: { outcome: WorkItemOutcome; locale: Locale; labels: Record<WorkItemOutcome, string> }) {
  if (outcome in reviewCodes) {
    return <CodeBadge code={reviewCodes[outcome as keyof typeof reviewCodes]} locale={locale} size="sm" variant="letter" />;
  }
  return <Badge tone={outcomeTones[outcome]}>{labels[outcome]}</Badge>;
}
