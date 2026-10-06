"use client";

import {
  formatDate,
  formatNumber,
  isFilteredWorkItemQuery,
  isOpenStageCategory,
  searchMaxLength,
  withoutFilters,
  stepAgeMinimums,
  workItemSorts,
  type BilingualText,
  type ChainBucket,
  type CodeCFilter,
  type Locale,
  type WorkItemList as WorkItemListData,
  type WorkItemOutcome,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import type { ReactNode } from "react";
import type { Tone } from "../../tokens/themes.ts";
import { Button, buttonVariants } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "../data/table.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Select } from "../form/select.tsx";
import { Switch } from "../form/switch.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { CodeBadge } from "../status/code-badge.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StagePill } from "../status/stage-pill.tsx";
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
  weeksOrMore: (weeks: string) => string;
  sort: string;
  sortStepAge: string;
  sortDocumentNumber: string;
  sortSubmissionDate: string;
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
  searchHelp: string;
  noResults: string;
  pages: string;
  firstPage: string;
  nextPage: string;
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

const sortLabels = { stepAge: "sortStepAge", documentNumber: "sortDocumentNumber", submissionDate: "sortSubmissionDate" } as const satisfies Record<WorkItemQuery["sort"], TextLabel>;

const reviewCodes = { A: "a", B: "b", C: "c", D: "d" } as const;

/** A Select's value for "no filter": Radix Select takes no empty value. */
const ALL = "all";

export type WorkItemListProps = {
  /** One page of the work item query, as the API returns it. */
  list: WorkItemListData;
  /** The query the page shows. */
  query: WorkItemQuery;
  locale: Locale;
  labels: WorkItemListLabels;
  /** The List's URL for `query`: a filter link, the next page. */
  hrefFor: (query: WorkItemQuery) => string;
  /** An item's page. */
  itemHref: (id: string) => string;
  /** Shows the List for `query` (the web navigates to `hrefFor(query)`). */
  onQueryChange: (query: WorkItemQuery) => void;
  /** The Kanban (`WorkItemBoard`), shown under the toolbar in place of the Stage counts, table and pages. */
  board?: ReactNode;
};

/**
 * The List of a Module's Work Items (spec RP-344): a toolbar of filters and
 * sort with the Need My Action and "Show all Revisions" switches, the Stage counts of the matching
 * items, and one page of them, 50 rows. Every choice is a new query, which the
 * page keeps in its URL. "With" follows V14: the Step and who claimed it in the
 * viewer's own Company, another Company's name only, as the API sends it.
 * The table scrolls sideways on a narrow screen.
 */
export function WorkItemList({ list, query, locale, labels, hrefFor, itemHref, onQueryChange, board }: WorkItemListProps) {
  const t = (key: TextLabel) => labels[key];
  const change = (next: Partial<WorkItemQuery>) => {
    const { cursor: _cursor, ...rest } = query;
    onQueryChange({ ...rest, ...next });
  };
  const filtered = isFilteredWorkItemQuery(query);
  // The Creation Date is the raiser's Company's alone: the API sends it to no one else, so without one in the rows the column is left out.
  const showCreationDate = list.items.some((i) => i.creationDate !== null);
  const columns = showCreationDate ? 11 : 10;
  const date = (iso: string | null) => (iso === null ? null : formatDate(new Date(iso), locale));

  return (
    <div className="space-y-4">
      <section aria-label={t("toolbar")} className="space-y-3">
        <SearchBox
          // A new query (back button, a cleared filter) shows its own words.
          key={query.q ?? ""}
          value={query.q}
          label={t("search")}
          placeholder={t("searchHelp")}
          onSearch={(q) => change({ q })}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <FilterSelect
            label={t("type")}
            allLabel={t("all")}
            value={query.type[0]}
            options={list.filters.types.map((v) => ({ value: v.code, label: v.name[locale] }))}
            onChange={(v) => change({ type: v ? [v] : [] })}
          />
          <FilterSelect
            label={t("stage")}
            allLabel={t("all")}
            value={query.stage[0]}
            options={list.stages.map((s) => ({ value: s.key, label: s.name[locale] }))}
            onChange={(v) => change({ stage: v ? [v] : [] })}
          />
          <FilterSelect
            label={t("with")}
            allLabel={t("all")}
            value={query.with[0]}
            options={[
              { value: "me", label: t("withMe") },
              { value: "unclaimed", label: t("anyUnclaimed") },
              ...list.filters.with.steps.map((s) => ({ value: `step:${s.key}`, label: s.name[locale] })),
              ...list.filters.with.companies.map((c) => ({ value: `company:${c.participantId}`, label: c.name[locale] })),
            ]}
            onChange={(v) => change({ with: v ? [v as WorkItemQuery["with"][number]] : [] })}
          />
          <FilterSelect
            label={t("trade")}
            allLabel={t("all")}
            value={query.trade[0]}
            options={list.filters.trades.map((v) => ({ value: v.id, label: v.name[locale] }))}
            onChange={(v) => change({ trade: v ? [v] : [] })}
          />
          <FilterSelect
            label={t("location")}
            allLabel={t("all")}
            value={query.location[0]}
            options={locationOptions(list.filters.locations, locale)}
            onChange={(v) => change({ location: v ? [v] : [] })}
          />
          <FilterSelect
            label={t("outcome")}
            allLabel={t("all")}
            value={query.outcome[0]}
            options={Object.entries(labels.outcomes).map(([value, label]) => ({ value, label }))}
            onChange={(v) => change({ outcome: v ? [v as WorkItemOutcome] : [] })}
          />
          <FilterSelect
            label={t("stepAge")}
            allLabel={t("all")}
            value={query.stepAgeMin === undefined ? undefined : String(query.stepAgeMin)}
            options={stepAgeMinimums.map((n) => ({ value: String(n), label: labels.weeksOrMore(formatNumber(n, locale)) }))}
            onChange={(v) => change({ stepAgeMin: v ? (Number(v) as WorkItemQuery["stepAgeMin"]) : undefined })}
          />
          <Field label={t("submittedFrom")}>
            <Input type="date" value={query.submittedFrom ?? ""} max={query.submittedTo} onChange={(e) => change({ submittedFrom: e.target.value || undefined })} />
          </Field>
          <Field label={t("submittedTo")}>
            <Input type="date" value={query.submittedTo ?? ""} min={query.submittedFrom} onChange={(e) => change({ submittedTo: e.target.value || undefined })} />
          </Field>
          <Field label={t("sort")}>
            <Select
              value={query.sort}
              options={workItemSorts.map((s) => ({ value: s, label: t(sortLabels[s]) }))}
              onValueChange={(v) => change({ sort: v as WorkItemQuery["sort"] })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Field label={t("needMyAction")} layout="inline">
              <Switch checked={query.needMyAction} onCheckedChange={(on) => change({ needMyAction: on })} />
            </Field>
            <Field label={t("allRevisions")} layout="inline">
              <Switch checked={query.allRevisions} onCheckedChange={(on) => change({ allRevisions: on })} />
            </Field>
            {/* A Dashboard number's filter, which the toolbar has no control for: its buckets and Code C sub-states. */}
            {query.bucket.length + query.codeC.length > 0 && (
              <Badge tone="info" data-testid="bucket-filter">
                {t("dashboardFigure")}:{" "}
                {[...query.bucket.map((bucket) => labels.buckets[bucket]), ...query.codeC.map((codeC) => labels.codeCStates[codeC])].join(", ")}
              </Badge>
            )}
          </div>
          {filtered && (
            <a href={hrefFor(withoutFilters(query))} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {t("clear")}
            </a>
          )}
        </div>
      </section>

      {board ?? <>
      <ul aria-label={t("stageCounts")} className="flex flex-wrap gap-2" data-testid="stage-counts">
        {list.stages.map((s) => (
          <li key={s.key}>
            <StagePill stage={stageColour(s)} label={s.name[locale]} count={s.count} locale={locale} />
          </li>
        ))}
      </ul>

      <Table label={t("table")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("documentNumber")}</TableHead>
            <TableHead>{t("subject")}</TableHead>
            <TableHead>{t("type")}</TableHead>
            <TableHead>{t("stage")}</TableHead>
            <TableHead>{t("with")}</TableHead>
            <TableHead>{t("stepAge")}</TableHead>
            <TableHead>{t("trade")}</TableHead>
            <TableHead>{t("location")}</TableHead>
            <TableHead>{t("outcome")}</TableHead>
            <TableHead>{t("submissionDate")}</TableHead>
            {showCreationDate && <TableHead>{t("creationDate")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.items.length === 0 ? (
            <TableEmpty colSpan={columns}>{t(query.q === undefined ? "empty" : "noResults")}</TableEmpty>
          ) : (
            list.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap">
                  {/* A Revision's number carries its " Rev n"; one with no number yet says which Revision it is. */}
                  {item.documentNumber ? (
                    <DocNo value={item.documentNumber} locale={locale} />
                  ) : (
                    <span className="text-muted">
                      {item.revisionNo > 0 ? labels.revisionNoNumber(formatNumber(item.revisionNo, locale)) : t("noNumber")}
                    </span>
                  )}
                </TableCell>
                <TableCell className="min-w-48">
                  <a href={itemHref(item.id)} className="font-medium text-primary underline underline-offset-4">
                    {item.title}
                  </a>
                </TableCell>
                <TableCell className="whitespace-nowrap">{item.type.code}</TableCell>
                <TableCell>
                  <StagePill stage={stageColour(item.stage)} label={item.stage.name[locale]} locale={locale} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <WithCell row={item} locale={locale} unclaimed={t("unclaimed")} />
                </TableCell>
                <TableCell>
                  {/* A closed item doesn't age. */}
                  {isOpenStageCategory(item.stage.category) && item.stepAgeWeeks !== null ? <AgeDots weeks={item.stepAgeWeeks} locale={locale} /> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">{item.trade.name[locale]}</TableCell>
                <TableCell className="whitespace-nowrap">{item.location?.name[locale]}</TableCell>
                <TableCell>{item.outcome ? <Outcome outcome={item.outcome} locale={locale} labels={labels.outcomes} /> : null}</TableCell>
                <TableCell className="whitespace-nowrap">{date(item.submissionDate)}</TableCell>
                {showCreationDate && <TableCell className="whitespace-nowrap">{date(item.creationDate)}</TableCell>}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {(query.cursor !== undefined || list.nextCursor !== null) && (
        <nav aria-label={t("pages")} className="flex flex-wrap justify-end gap-2">
          {query.cursor !== undefined && (
            <a href={hrefFor({ ...query, cursor: undefined })} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              {t("firstPage")}
            </a>
          )}
          {list.nextCursor !== null && (
            <a href={hrefFor({ ...query, cursor: list.nextCursor })} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              {t("nextPage")}
            </a>
          )}
        </nav>
      )}
      </>}
    </div>
  );
}

/**
 * Search (RP-347): words to find in the Project's items the viewer sees, by
 * Document Number, Subject, Type, Trade, Location or the raiser's Company,
 * never in answers or Documents. Asked for on Enter or the button; an empty
 * box asks for no search.
 */
function SearchBox({
  value,
  label,
  placeholder,
  onSearch,
}: {
  value: string | undefined;
  label: string;
  placeholder: string;
  onSearch: (q: string | undefined) => void;
}) {
  return (
    <form
      role="search"
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const words = String(new FormData(event.currentTarget).get("q") ?? "").trim();
        onSearch(words === "" ? undefined : words);
      }}
    >
      <Field label={label} className="min-w-0 flex-1">
        <Input type="search" name="q" defaultValue={value ?? ""} placeholder={placeholder} maxLength={searchMaxLength} />
      </Field>
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string | undefined;
  options: { value: string; label: ReactNode }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Field label={label}>
      <Select
        value={value ?? ALL}
        options={[{ value: ALL, label: allLabel }, ...options]}
        onValueChange={(v) => onChange(v === ALL ? undefined : v)}
      />
    </Field>
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
