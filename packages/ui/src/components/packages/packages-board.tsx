"use client";

import {
  filterPackages,
  formatNumber,
  packageFilterChoices,
  packageStatuses,
  type BilingualText,
  type Locale,
  type PackageStatus,
  type PackageSummary,
  type PackagesFilter,
} from "@rabaed/domain";
import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { CompanyChip } from "../data/avatar.tsx";
import { Badge } from "../data/badge.tsx";
import { EmptyState } from "../feedback/states.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { companyFilterChoice, filterClearClass, tradeFilterChoice } from "../list/filter-choices.tsx";
import { FilterMenu, FilterValues, type FilterChoice, type FilterMenuField } from "../list/filter-menu.tsx";
import { ListToolbar, ToolbarSearch } from "../list/list-toolbar.tsx";
import { NewPackageDialog, type NewPackageLabels } from "./package-dialogs.tsx";

// The Packages view of the Submittals (RP-660, spec RP-616 stories 24, 29–33; reference: the
// RP-633 prototype's Package card, as corrected by design/prompts/packages.md "Reference
// (RP-633)"): the Packages the viewer sees as a Kanban of Open, In Progress and Done. Each card
// shows the PKG number left to right beside its owning Company (numbers count per Project and
// owning Participant, so two Companies' Packages can both be PKG-001), its name, status and the
// viewer's counts, as the board API gives them (RP-641): of the submittals they see only. No
// dates, ever. Presentational: the view reads the Packages and makes the calls.
//
// Search and filters (RP-953, design/prompts/packages.md "1. Packages view"): the search box
// finds a Package by its PKG number or its name in either language; the Filter panel narrows by
// Trade and by owning Company, as the List's does. Their choices come from the Packages given
// only (packageFilterChoices): the Trades of the submittals the viewer sees in them, and their
// owners, so no choice names a Trade or a Company the viewer sees nothing of.

/** The search and Filter panel's words. */
export type PackagesFilterLabels = {
  /** The search box's name. */
  search: string;
  searchPlaceholder: string;
  /** What the search looks in, read with the box. */
  searchHelp: string;
  /** The Filter button's and panel's name. */
  filters: string;
  clearAll: string;
  done: string;
  /** The × beside the Filter button: clears the search and every filter. */
  clear: string;
  /** Clears one field. */
  clearField: string;
  /** A field's value search. */
  searchValues: string;
  /** When a field's value search finds nothing. */
  noMatches: string;
  /** The panel's footer: `n` written for the locale; `count` chooses the plural. */
  applied: (n: string, count: number) => string;
  trade: string;
  company: string;
  /** Each field's name in the other language, small after it. */
  hints?: { trade?: string; company?: string };
  /** When the search and filters leave no Package. */
  noMatchesTitle: string;
  noMatchesBody: string;
};

export type PackagesBoardLabels = {
  /** The board's name, e.g. "Packages". */
  board: string;
  /** The toolbar's name. */
  toolbar: string;
  status: Record<PackageStatus, string>;
  /** A column with no Package. */
  noPackages: string;
  /** Read before the owning Company's name, e.g. "Owned by". */
  ownedBy: string;
  /** A count's Review Code, e.g. "Code A". */
  code: (code: string) => string;
  stillOpen: string;
  /** Closed of the submittals the viewer sees, e.g. "3 of 8 closed". */
  closedOf: (closed: string, total: string) => string;
  close: string;
  cancel: string;
  /** A refused create, by the API's error code, and `unavailable` for any other. */
  refusals: Record<string, string> & { unavailable: string };
  create: NewPackageLabels;
  filter: PackagesFilterLabels;
};

export type PackagesBoardProps = {
  /** The Project's Packages the viewer sees (the board API), in its order. */
  packages: PackageSummary[];
  locale: Locale;
  labels: PackagesBoardLabels;
  /** A Package's page. */
  packageHref: (id: string) => string;
  linkAs?: ElementType;
  /** The toolbar's end: the View switch. */
  viewSwitch?: ReactNode;
  /** "+ New Package", for a Member whose Company can build one; none, no button. */
  onCreate?: (name: BilingualText) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** The search and filters the page keeps (its URL); none, nothing narrowed. */
  filter?: PackagesFilter;
  /** Asked for with the new search and filters; none, no search box or Filter button. */
  onFilterChange?: (filter: PackagesFilter) => void;
};

const noFilter: PackagesFilter = { trade: [], company: [] };

const statusTone = { open: "neutral", in_progress: "info", done: "success" } as const;
const statusDot = { open: "bg-neutral-fg", in_progress: "bg-info-fg", done: "bg-success" } as const;
// Full class names, so Tailwind finds them; an outcome other than A–D is neutral.
const codeColour: Record<string, string> = {
  A: "bg-code-a-bg text-code-a-fg",
  B: "bg-code-b-bg text-code-b-fg",
  C: "bg-code-c-bg text-code-c-fg",
  D: "bg-code-d-bg text-code-d-fg",
};

export function PackagesBoard({
  packages: all,
  locale,
  labels,
  packageHref,
  linkAs: Link = "a",
  viewSwitch,
  onCreate,
  filter = noFilter,
  onFilterChange,
}: PackagesBoardProps) {
  const n = (value: number) => formatNumber(value, locale);
  const toolbar = viewSwitch !== undefined || onCreate !== undefined || onFilterChange !== undefined;
  const packages = filterPackages(all, filter);
  const narrowed = filter.q !== undefined || filter.trade.length > 0 || filter.company.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {toolbar && (
        <ListToolbar label={labels.toolbar} end={viewSwitch}>
          {onCreate && <NewPackageDialog labels={labels.create} close={labels.close} cancel={labels.cancel} refusals={labels.refusals} onCreate={onCreate} />}
          {onFilterChange && (
            <PackagesFilterControls packages={all} filter={filter} narrowed={narrowed} locale={locale} labels={labels.filter} close={labels.close} onChange={onFilterChange} />
          )}
        </ListToolbar>
      )}
      {narrowed && packages.length === 0 ? (
        <EmptyState icon="search" title={labels.filter.noMatchesTitle}>
          {labels.filter.noMatchesBody}
        </EmptyState>
      ) : (
        <PackageColumns packages={packages} locale={locale} labels={labels} packageHref={packageHref} linkAs={Link} n={n} />
      )}
    </div>
  );
}

/**
 * The search box and the Filter button with its Trade and owning Company fields, then a × that
 * clears them all while any is on; each change asked for at once.
 */
function PackagesFilterControls({
  packages,
  filter,
  narrowed,
  locale,
  labels,
  close,
  onChange,
}: {
  packages: PackageSummary[];
  filter: PackagesFilter;
  narrowed: boolean;
  locale: Locale;
  labels: PackagesFilterLabels;
  /** The Filter sheet's close button. */
  close: string;
  onChange: (filter: PackagesFilter) => void;
}) {
  const n = (value: number) => formatNumber(value, locale);
  const choices = packageFilterChoices(packages, locale);
  const valueLabels = { clear: labels.clearField, search: labels.searchValues, noMatches: labels.noMatches };
  const field = (key: "trade" | "company", options: FilterChoice[]): FilterMenuField => ({
    key,
    label: labels[key],
    hint: labels.hints?.[key],
    count: filter[key].length,
    content: (
      <FilterValues
        label={labels[key]}
        hint={labels.hints?.[key]}
        values={filter[key]}
        choices={options}
        labels={valueLabels}
        onChange={(values) => onChange({ ...filter, [key]: values })}
      />
    ),
  });
  const filtered = filter.trade.length > 0 || filter.company.length > 0;
  return (
    <>
      <ToolbarSearch
        tall
        // A new filter (back button, the ×) shows its own words.
        key={filter.q ?? ""}
        value={filter.q}
        label={labels.search}
        placeholder={labels.searchPlaceholder}
        description={labels.searchHelp}
        maxLength={100}
        onSearch={(q) => onChange({ ...filter, q })}
        // Wide enough for its placeholder beside the "/" hint at 1366; the toolbar has three controls only.
        className="sm:w-[272px]"
      />
      <span className="inline-flex shrink-0 items-center">
        <FilterMenu
          triggerClassName={narrowed ? "rounded-e-none" : undefined}
          fields={[
            field(
              "trade",
              choices.trades.map((v) => tradeFilterChoice(v, locale)),
            ),
            // Each owning Company by its name only (V14).
            field(
              "company",
              choices.companies.map((c) => companyFilterChoice(c.participantId, c.companyName, locale)),
            ),
          ]}
          labels={{ filters: labels.filters, clearAll: labels.clearAll, done: labels.done, close, applied: labels.applied, number: n }}
          onClearAll={filtered ? () => onChange({ ...filter, trade: [], company: [] }) : undefined}
        />
        {narrowed && (
          <button
            type="button"
            aria-label={labels.clear}
            title={labels.clear}
            onClick={() => onChange(noFilter)}
            className={filterClearClass}
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </span>
    </>
  );
}

/** The three columns, Open, In Progress and Done, each with its count and cards. */
function PackageColumns({
  packages,
  locale,
  labels,
  packageHref,
  linkAs: Link,
  n,
}: {
  packages: PackageSummary[];
  locale: Locale;
  labels: PackagesBoardLabels;
  packageHref: (id: string) => string;
  linkAs: ElementType;
  n: (value: number) => string;
}) {
  return (
      <section
        aria-label={labels.board}
        // Focusable, so the board can be scrolled with the keyboard.
        tabIndex={0}
        data-packages-board=""
        className={cn("relative -mx-4 overflow-x-auto bg-canvas px-4 pt-1 pb-[40px] sm:-mx-7 sm:px-7", focusRing)}
      >
        <ol className="flex w-max items-start gap-[18px]">
          {packageStatuses.map((status) => {
            const cards = packages.filter((p) => p.status === status);
            const headingId = `packages-column-${status}`;
            return (
              <li key={status} aria-labelledby={headingId} data-package-column={status} className="flex w-[330px] shrink-0 flex-col rounded-lg border border-border bg-surface">
                <h2 id={headingId} className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-[14px] text-lg leading-6 font-bold text-text">
                  <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", statusDot[status])} />
                  <span className="min-w-0 truncate">{labels.status[status]}</span>
                  <span className="rounded-full bg-neutral-tint px-2 font-ui text-caption leading-5 font-semibold text-neutral-fg tabular-nums">{n(cards.length)}</span>
                </h2>
                {cards.length === 0 ? (
                  <p className="px-3 py-6 text-center text-caption text-muted">{labels.noPackages}</p>
                ) : (
                  <ul className="flex flex-col gap-[14px] px-2.5 py-2.5">
                    {cards.map((p) => (
                      <li key={p.id}>
                        <PackageCard pkg={p} locale={locale} labels={labels} href={packageHref(p.id)} linkAs={Link} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </section>
  );
}

/** One Package: number and owning Company, status, name, the counts by Review Code and still open, and the closed share. */
function PackageCard({ pkg, locale, labels, href, linkAs: Link }: { pkg: PackageSummary; locale: Locale; labels: PackagesBoardLabels; href: string; linkAs: ElementType }) {
  const n = (value: number) => formatNumber(value, locale);
  const { total, open, codes } = pkg.counts;
  const closed = total - open;
  // A to D in order, then any other outcome as the API names it; only those with a count.
  const codeKeys = [...new Set(["A", "B", "C", "D", ...Object.keys(codes).sort()])].filter((code) => (codes[code] ?? 0) > 0);
  const share = total === 0 ? 0 : (closed / total) * 100;
  const closedText = labels.closedOf(n(closed), n(total));
  return (
    <Link
      href={href}
      data-package-card=""
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-[13px] text-text shadow-xs transition-[box-shadow,translate] duration-150 hover:-translate-y-px hover:border-border-strong hover:shadow-md",
        focusRing,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <bdi dir="ltr" translate="no" data-package-number="" className="shrink-0 font-ui text-caption font-bold text-muted">
          {pkg.number}
        </bdi>
        {/* Beside the number: two Companies' Packages can share it. The Company by its name only (V14). */}
        <span className="sr-only">{labels.ownedBy}</span>
        <CompanyChip name={pkg.owner.companyName[locale]} className="min-w-0" />
      </span>
      <h3 dir="auto" className="text-base leading-snug font-bold text-text">
        {pkg.name[locale]}
      </h3>
      <ul className="flex flex-wrap items-center gap-1">
        {codeKeys.map((code) => (
          <li
            key={code}
            data-code={code}
            className={cn("inline-flex h-[22px] items-center gap-1 rounded-[6px] px-1.5 text-notes font-semibold", codeColour[code] ?? "bg-neutral-tint text-neutral-fg")}
          >
            <span className="sr-only">{labels.code(code)}</span>
            <span aria-hidden="true" translate="no">
              {code}
            </span>
            <span className="font-ui tabular-nums">{n(codes[code]!)}</span>
          </li>
        ))}
        <li data-code="open" className="inline-flex h-[22px] items-center gap-1 rounded-[6px] bg-neutral-tint px-1.5 text-notes font-medium text-text-secondary">
          {labels.stillOpen}
          <span className="font-ui font-semibold tabular-nums">{n(open)}</span>
        </li>
      </ul>
      <span
        role="progressbar"
        aria-label={closedText}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={closed}
        className="flex h-2 overflow-hidden rounded-full bg-neutral-tint"
      >
        <span className="h-full rounded-full bg-success" style={{ width: `${share}%` }} />
      </span>
      <span className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2.5">
        <Badge tone={statusTone[pkg.status]} dot data-package-status={pkg.status}>
          {labels.status[pkg.status]}
        </Badge>
        <span className="ms-auto text-caption text-muted">{closedText}</span>
      </span>
    </Link>
  );
}
