"use client";

import {
  formatNumber,
  isFilteredWorkItemQuery,
  isOpenStageCategory,
  watchOutcomeNames,
  withoutFilters,
  stepAgeMinimums,
  workItemSorts,
  type BilingualText,
  type Locale,
  type WorkItemList as WorkItemListData,
  type WorkItemOutcome,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import type { ReactNode } from "react";
import type { Tone } from "../../tokens/themes.ts";
import { buttonVariants } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "../data/table.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Field } from "../form/field.tsx";
import { Select } from "../form/select.tsx";
import { Switch } from "../form/switch.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { CodeBadge } from "../status/code-badge.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StagePill } from "../status/stage-pill.tsx";
import { WithChip } from "../status/with-chip.tsx";
import { chainBucketLabel, codeCLabel } from "./project-dashboard.tsx";

const copy = {
  toolbar: { en: "Filters and sort", ar: "التصفية والترتيب" },
  all: { en: "All", ar: "الكل" },
  type: { en: "Type", ar: "النوع" },
  stage: { en: "Stage", ar: "المرحلة" },
  with: { en: "With", ar: "لدى" },
  withMe: { en: "Me", ar: "أنا" },
  unclaimed: { en: "unclaimed", ar: "لم تُستلَم" },
  anyUnclaimed: { en: "Unclaimed", ar: "لم تُستلَم" },
  trade: { en: "Trade", ar: "التخصص" },
  location: { en: "Location", ar: "الموقع" },
  outcome: { en: "Review Code / Result", ar: "رمز المراجعة / النتيجة" },
  stepAge: { en: "Step Age", ar: "عمر الخطوة" },
  weeksOrMore: { en: "# weeks or more", ar: "# أسابيع أو أكثر" },
  sort: { en: "Sort by", ar: "الترتيب حسب" },
  sortStepAge: { en: "Step Age, oldest first", ar: "عمر الخطوة، الأقدم أولًا" },
  sortDocumentNumber: { en: "Document Number", ar: "رقم المستند" },
  allRevisions: { en: "Show all Revisions", ar: "عرض كل المراجعات" },
  clear: { en: "Clear filters", ar: "مسح التصفية" },
  dashboardFigure: { en: "From the Dashboard", ar: "من لوحة المعلومات" },
  stageCounts: { en: "Items in each Stage", ar: "العناصر في كل مرحلة" },
  table: { en: "Submittals", ar: "الاعتمادات" },
  documentNumber: { en: "Document Number", ar: "رقم المستند" },
  subject: { en: "Subject", ar: "الموضوع" },
  noNumber: { en: "No number yet", ar: "بلا رقم بعد" },
  revisionNoNumber: { en: "Revision #: no number yet", ar: "المراجعة #: بلا رقم بعد" },
  empty: { en: "No items you can see match these filters.", ar: "لا توجد عناصر يمكنك رؤيتها تطابق هذه التصفية." },
  pages: { en: "Pages", ar: "الصفحات" },
  firstPage: { en: "First page", ar: "الصفحة الأولى" },
  nextPage: { en: "Next page", ar: "الصفحة التالية" },
} satisfies Record<string, Record<Locale, string>>;

const outcomes: Record<WorkItemOutcome, { label: Record<Locale, string>; tone: Tone }> = {
  A: { label: { en: "Code A", ar: "الرمز A" }, tone: "success" },
  B: { label: { en: "Code B", ar: "الرمز B" }, tone: "success" },
  C: { label: { en: "Code C", ar: "الرمز C" }, tone: "warning" },
  D: { label: { en: "Code D", ar: "الرمز D" }, tone: "danger" },
  passed: { label: watchOutcomeNames.passed, tone: "success" },
  passed_with_comments: { label: watchOutcomeNames.passed_with_comments, tone: "success" },
  failed: { label: watchOutcomeNames.failed, tone: "danger" },
  cancelled: { label: watchOutcomeNames.cancelled, tone: "neutral" },
  closed: { label: { en: "Closed", ar: "مغلق" }, tone: "neutral" },
};

const reviewCodes = { A: "a", B: "b", C: "c", D: "d" } as const;

/** A Select's value for "no filter": Radix Select takes no empty value. */
const ALL = "all";

export type WorkItemListProps = {
  /** One page of the work item query, as the API returns it. */
  list: WorkItemListData;
  /** The query the page shows. */
  query: WorkItemQuery;
  locale: Locale;
  /** The List's URL for `query`: a filter link, the next page. */
  hrefFor: (query: WorkItemQuery) => string;
  /** An item's page. */
  itemHref: (id: string) => string;
  /** Shows the List for `query` (the web navigates to `hrefFor(query)`). */
  onQueryChange: (query: WorkItemQuery) => void;
};

/**
 * The List of a Module's Work Items (spec RP-344): a toolbar of filters and
 * sort with the "Show all Revisions" switch, the Stage counts of the matching
 * items, and one page of them, 50 rows. Every choice is a new query, which the
 * page keeps in its URL. "With" follows V14: the Step and who claimed it in the
 * viewer's own Company, another Company's name only, as the API sends it.
 * The table scrolls sideways on a narrow screen.
 */
export function WorkItemList({ list, query, locale, hrefFor, itemHref, onQueryChange }: WorkItemListProps) {
  const t = (key: keyof typeof copy) => copy[key][locale];
  const change = (next: Partial<WorkItemQuery>) => {
    const { cursor: _cursor, ...rest } = query;
    onQueryChange({ ...rest, ...next });
  };
  const filtered = isFilteredWorkItemQuery(query);

  return (
    <div className="space-y-4">
      <section aria-label={t("toolbar")} className="space-y-3">
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
            options={Object.entries(outcomes).map(([value, o]) => ({ value, label: o.label[locale] }))}
            onChange={(v) => change({ outcome: v ? [v as WorkItemOutcome] : [] })}
          />
          <FilterSelect
            label={t("stepAge")}
            allLabel={t("all")}
            value={query.stepAgeMin === undefined ? undefined : String(query.stepAgeMin)}
            options={stepAgeMinimums.map((n) => ({ value: String(n), label: t("weeksOrMore").replace("#", formatNumber(n, locale)) }))}
            onChange={(v) => change({ stepAgeMin: v ? (Number(v) as WorkItemQuery["stepAgeMin"]) : undefined })}
          />
          <Field label={t("sort")}>
            <Select
              value={query.sort}
              options={workItemSorts.map((s) => ({ value: s, label: t(s === "stepAge" ? "sortStepAge" : "sortDocumentNumber") }))}
              onValueChange={(v) => change({ sort: v as WorkItemQuery["sort"] })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Field label={t("allRevisions")} layout="inline">
            <Switch checked={query.allRevisions} onCheckedChange={(on) => change({ allRevisions: on })} />
          </Field>
          {/* A Dashboard number's filter, which the toolbar has no control for: its buckets and Code C sub-states. */}
          {query.bucket.length + query.codeC.length > 0 && (
            <Badge tone="info" data-testid="bucket-filter">
              {t("dashboardFigure")}:{" "}
              {[...query.bucket.map((bucket) => chainBucketLabel(bucket, locale)), ...query.codeC.map((codeC) => codeCLabel(codeC, locale))].join(", ")}
            </Badge>
          )}
          {filtered && (
            <a href={hrefFor(withoutFilters(query))} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {t("clear")}
            </a>
          )}
        </div>
      </section>

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
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.items.length === 0 ? (
            <TableEmpty colSpan={9}>{t("empty")}</TableEmpty>
          ) : (
            list.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap">
                  {/* A Revision's number carries its " Rev n"; one with no number yet says which Revision it is. */}
                  {item.documentNumber ? (
                    <DocNo value={item.documentNumber} locale={locale} />
                  ) : (
                    <span className="text-muted">
                      {item.revisionNo > 0 ? t("revisionNoNumber").replace("#", formatNumber(item.revisionNo, locale)) : t("noNumber")}
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
                  {isOpenStageCategory(item.stage.category) ? <AgeDots weeks={item.stepAgeWeeks} locale={locale} /> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">{item.trade.name[locale]}</TableCell>
                <TableCell className="whitespace-nowrap">{item.location?.name[locale]}</TableCell>
                <TableCell>{item.outcome ? <Outcome outcome={item.outcome} locale={locale} /> : null}</TableCell>
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
    </div>
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

function Outcome({ outcome, locale }: { outcome: WorkItemOutcome; locale: Locale }) {
  if (outcome in reviewCodes) {
    return <CodeBadge code={reviewCodes[outcome as keyof typeof reviewCodes]} locale={locale} size="sm" variant="letter" />;
  }
  const o = outcomes[outcome];
  return <Badge tone={o.tone}>{o.label[locale]}</Badge>;
}
