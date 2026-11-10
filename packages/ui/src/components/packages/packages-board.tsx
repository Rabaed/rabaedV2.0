"use client";

import {
  closedCount,
  filterPackages,
  formatNumber,
  packageFilterChoices,
  packageStateTotals,
  packageStatuses,
  type BilingualText,
  type Locale,
  type PackageStatus,
  type PackageSummary,
  type PackagesFilter,
} from "@rabaed/domain";
import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { CompanyChip } from "../data/avatar.tsx";
import { EmptyState } from "../feedback/states.tsx";
import { focusRing } from "../form/control-styles.ts";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Switch } from "../form/switch.tsx";
import { Icon } from "../icon/icon.tsx";
import { pageBleed } from "../shell/page-frame.tsx";
import { companyFilterChoice, filterClearClass, tradeFilterChoice } from "../list/filter-choices.tsx";
import { FilterMenu, FilterValues, type FilterChoice, type FilterMenuField } from "../list/filter-menu.tsx";
import { ListToolbar, ToolbarRowBreak, ToolbarSearch } from "../list/list-toolbar.tsx";
import { PrimaryAction } from "../shell/action-bar.tsx";
import { NewPackageDialog, type NewPackageLabels } from "./package-dialogs.tsx";
import { PackageStatusPill, StateMiniBar, TypeIconTile } from "./package-states.tsx";
import { PackagesList, type PackagesListLabels } from "./packages-list.tsx";

// The Packages view of the Submittals (RP-660, spec RP-616 stories 24, 29–33): the Packages the
// viewer sees as a Kanban of Open, In Progress and Done, or as the List of Packages (RP-1143).
// Its look is the rebuilt kit screen's (RP-1143, `ui_kits/app/packages.html`, `packages/packages.js`
// card() and list(), as the owner agreed on 2026-11-08): each card with its PKG number left to
// right and its status pill, its name, a ledger of its submittals by Type (closed of total and one
// segment per submittal by state), how many wait on the viewer, and its owning Company. Numbers count
// per Project and owning Participant, so two Companies' Packages can both be PKG-001: the owning
// Company shows on every card. Every count is of the submittals the viewer sees (RP-641). No dates, ever.
// Presentational: the view reads the Packages and makes the calls.
//
// Search and filters (RP-953): the search finds a Package by its PKG number or its name in either
// language; the Filter panel narrows by Trade and by owning Company, its choices from the Packages
// given only, so no choice names a Trade or a Company the viewer sees nothing of. "Need my action"
// (RP-1143) keeps the Packages with a submittal waiting on the viewer.

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
  /** The × beside the Filter button: clears the search, every filter and Need my action. */
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
  /** The "Need my action" switch (RP-1143). */
  mine: string;
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
  /** Closed of the submittals the viewer sees, e.g. "3 of 8 closed". */
  closedOf: (closed: string, total: string) => string;
  /** The line under the toolbar (RP-1143): when a Package is Done. */
  doneRule: string;
  /** The card's ledger by Type, read before it. */
  byType: string;
  /** A card whose Package has no submittal the viewer sees. */
  noSubmittals: string;
  /** "n waiting for your action": `n` written for the locale; `count` chooses the plural. */
  waiting: (n: string, count: number) => string;
  /** The Board / List switch. */
  show: { label: string; board: string; list: string };
  /** The table of Packages; its status, closed and empty words are the board's own. */
  list: Omit<PackagesListLabels, "status" | "closedOf" | "noSubmittals">;
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
  /** The search, filters and how the Packages show, as the page keeps them (its URL); none, nothing narrowed, the board. */
  filter?: PackagesFilter;
  /** Asked for with the new search, filters or show; none, no search box, Filter, switch or Cards / Table choice. */
  onFilterChange?: (filter: PackagesFilter) => void;
};

const noFilter: PackagesFilter = { trade: [], company: [] };

const statusDot = { open: "bg-neutral-fg", in_progress: "bg-info-fg", done: "bg-success" } as const;

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
  const narrowed = filter.q !== undefined || filter.trade.length > 0 || filter.company.length > 0 || filter.mine === true;
  const list = filter.show === "list";
  const end =
    onFilterChange || viewSwitch !== undefined ? (
      <>
        {onFilterChange && (
          <SegmentedControl
            aria-label={labels.show.label}
            value={list ? "list" : "board"}
            onValueChange={(v) => onFilterChange({ ...withoutShow(filter), ...(v === "list" ? { show: "list" as const } : {}) })}
            options={[
              { value: "board", label: labels.show.board },
              { value: "list", label: labels.show.list },
            ]}
          />
        )}
        {/* On a phone the View switch takes a row of its own (RP-1277). */}
        <ToolbarRowBreak />
        {viewSwitch}
      </>
    ) : undefined;
  return (
    // The board takes the rest of the window under the toolbar (RP-1135, as RP-1092's boards).
    <div className="flex min-w-0 flex-col gap-4 fills-window:min-h-0 fills-window:flex-1">
      {toolbar && (
        <ListToolbar label={labels.toolbar} end={end}>
          {/* On a phone in the bottom action bar (RP-1272), not the toolbar (RP-1277, as the List's: RP-1273). */}
          {onCreate && (
            <PrimaryAction>
              <NewPackageDialog labels={labels.create} close={labels.close} cancel={labels.cancel} refusals={labels.refusals} onCreate={onCreate} />
            </PrimaryAction>
          )}
          {onFilterChange && (
            <PackagesFilterControls packages={all} filter={filter} narrowed={narrowed} locale={locale} labels={labels.filter} close={labels.close} onChange={onFilterChange} />
          )}
        </ListToolbar>
      )}
      {/* When a Package is Done (GLOSSARY Package), the kit's line in our words (RP-1143 row 8). */}
      <p role="note" className="flex items-start gap-2 rounded-md bg-info-tint px-3 py-2.5 text-sm font-medium text-info-fg">
        <Icon name="info-circle" size={16} className="mt-0.5 shrink-0" />
        {labels.doneRule}
      </p>
      {narrowed && packages.length === 0 ? (
        <EmptyState icon="search" title={labels.filter.noMatchesTitle}>
          {labels.filter.noMatchesBody}
        </EmptyState>
      ) : list ? (
        <PackagesList
          packages={packages}
          locale={locale}
          labels={{ ...labels.list, status: labels.status, closedOf: labels.closedOf, noSubmittals: labels.noSubmittals }}
          packageHref={packageHref}
          linkAs={Link}
        />
      ) : (
        <PackageColumns packages={packages} locale={locale} labels={labels} packageHref={packageHref} linkAs={Link} n={n} onCreate={onCreate} />
      )}
    </div>
  );
}

const withoutShow = ({ show: _show, ...rest }: PackagesFilter): PackagesFilter => rest;

/**
 * The search box, the Filter button with its Trade and owning Company fields, a × that clears
 * them all while any is on, and the "Need my action" switch; each change asked for at once.
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
  const { mine: _mine, ...notMine } = filter;
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
        // Wide enough for its placeholder beside the "/" hint at 1366; on a phone it shares its row with Filter (RP-1277).
        className="sm:w-[272px] phone:w-auto phone:min-w-0 phone:flex-1"
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
            // The × clears what narrows, not how the Packages show.
            onClick={() => onChange({ ...noFilter, ...(filter.show ? { show: filter.show } : {}) })}
            className={filterClearClass}
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </span>
      {/* On a phone Need My Action starts the second row, with Cards / Table beside it (RP-1277). */}
      <ToolbarRowBreak />
      {/* The kit's "Need my action" (`.tgl`): the Packages with a submittal waiting on the viewer. 44 high on a touch screen. */}
      <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 px-1 text-sm font-semibold text-text pointer-coarse:min-h-11">
        <Switch checked={filter.mine === true} onCheckedChange={(on) => onChange(on ? { ...filter, mine: true } : notMine)} />
        {labels.mine}
      </label>
    </>
  );
}

/** The three columns, Open, In Progress and Done, each with its count and cards; the Open column's "+" starts a Package. */
function PackageColumns({
  packages,
  locale,
  labels,
  packageHref,
  linkAs: Link,
  n,
  onCreate,
}: {
  packages: PackageSummary[];
  locale: Locale;
  labels: PackagesBoardLabels;
  packageHref: (id: string) => string;
  linkAs: ElementType;
  n: (value: number) => string;
  onCreate: PackagesBoardProps["onCreate"];
}) {
  return (
    <section
      aria-label={labels.board}
      // Focusable, so the board can be scrolled with the keyboard.
      tabIndex={0}
      data-packages-board=""
      // The page gives it the rest of the window (`fills-window`, RP-1135); it scrolls itself, so the page doesn't.
      // In a very short window it keeps 16rem and the page scrolls instead. Its focus ring is drawn inside: the board ends on the window's edge.
      data-fills-window=""
      className={cn("relative min-h-64 flex-1 overflow-auto bg-canvas pt-1 pb-[40px]", pageBleed, focusRing, "focus-visible:-outline-offset-2")}
    >
      <ol className="flex w-max items-start gap-[18px]">
        {packageStatuses.map((status) => {
          const cards = packages.filter((p) => p.status === status);
          const headingId = `packages-column-${status}`;
          return (
            // The kit's `.pkcol`: 330 px.
            <li key={status} aria-labelledby={headingId} data-package-column={status} className="flex w-[330px] shrink-0 flex-col rounded-lg border border-border bg-surface">
              <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-[11px]">
                <h2 id={headingId} className="flex min-w-0 flex-1 items-center gap-2.5 py-[3px] text-lg leading-6 font-bold text-text">
                  <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", statusDot[status])} />
                  <span className="min-w-0 truncate">{labels.status[status]}</span>
                  <span className="rounded-full bg-neutral-tint px-2 font-ui text-caption leading-5 font-semibold text-neutral-fg tabular-nums">{n(cards.length)}</span>
                </h2>
                {/* The kit's "+" on the first column (`data-act="new"`): the same dialog as "+ New Package". */}
                {status === "open" && onCreate && (
                  <NewPackageDialog
                    labels={labels.create}
                    close={labels.close}
                    cancel={labels.cancel}
                    refusals={labels.refusals}
                    onCreate={onCreate}
                    trigger={
                      <IconButton label={labels.create.trigger} size="sm" data-column-new="">
                        <Icon name="plus" />
                      </IconButton>
                    }
                  />
                )}
              </div>
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

/**
 * One Package (the kit's `card()`): its number and status pill, its name, its ledger by Type, how
 * many of its submittals wait on the viewer, and its owning Company with the closed share.
 */
function PackageCard({ pkg, locale, labels, href, linkAs: Link }: { pkg: PackageSummary; locale: Locale; labels: PackagesBoardLabels; href: string; linkAs: ElementType }) {
  const n = (value: number) => formatNumber(value, locale);
  const totals = packageStateTotals(pkg.byType);
  const closedText = labels.closedOf(n(totals.closed), n(totals.total));
  return (
    <Link
      href={href}
      data-package-card=""
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-[13px] text-text shadow-xs transition-[box-shadow,translate] duration-150 hover:-translate-y-px hover:border-border-strong hover:shadow-md",
        focusRing,
      )}
    >
      {/* The kit's `.pkc .r1`: the number at the start, the status at the end. */}
      <span className="flex min-w-0 items-center justify-between gap-2">
        <bdi dir="ltr" translate="no" data-package-number="" className="min-w-0 truncate font-ui text-caption font-bold text-muted">
          {pkg.number}
        </bdi>
        <PackageStatusPill status={pkg.status} label={labels.status[pkg.status]} />
      </span>
      <h3 dir="auto" className="text-base leading-snug font-bold text-text">
        {pkg.name[locale]}
      </h3>
      <TypeLedger pkg={pkg} locale={locale} labels={labels} />
      {pkg.waiting > 0 && (
        // The kit's `.pmine`.
        <span data-package-waiting="" className="inline-flex h-6 items-center gap-1.5 self-start rounded-[7px] bg-brand-tint px-2 text-caption font-bold text-brand-fg">
          <Icon name="hand-finger" size={14} />
          {labels.waiting(n(pkg.waiting), pkg.waiting)}
        </span>
      )}
      {/* The kit's `.pkc .r3`, with the owning Company where the kit has From → To: numbers repeat between Companies. */}
      <span className="flex min-w-0 items-center gap-2 border-t border-border-subtle pt-2.5">
        <span className="sr-only">{labels.ownedBy}</span>
        <CompanyChip name={pkg.owner.companyName[locale]} className="min-w-0" />
        <span
          role="progressbar"
          aria-label={closedText}
          aria-valuemin={0}
          aria-valuemax={totals.total}
          aria-valuenow={totals.closed}
          className="ms-auto shrink-0 text-caption whitespace-nowrap text-muted"
        >
          {closedText}
        </span>
      </span>
    </Link>
  );
}

/** The kit's Type ledger (`.pled`, `.plr`): per Type, its icon, code and name, a segment per submittal, and closed of total. */
function TypeLedger({ pkg, locale, labels }: { pkg: PackageSummary; locale: Locale; labels: PackagesBoardLabels }) {
  const n = (value: number) => formatNumber(value, locale);
  if (pkg.byType.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-caption text-muted">{labels.noSubmittals}</p>;
  }
  return (
    <ul aria-label={labels.byType} data-type-ledger="" className="flex flex-col overflow-hidden rounded-md border border-border-subtle">
      {pkg.byType.map((t) => {
        const closed = closedCount(t);
        return (
          <li
            key={t.typeId}
            data-type={t.code}
            className="grid grid-cols-[24px_minmax(0,1fr)_64px_auto] items-center gap-2 px-2.5 py-[7px] text-caption [&+&]:border-t [&+&]:border-border-subtle"
          >
            <TypeIconTile code={t.code} />
            <span className="flex min-w-0 items-baseline gap-1.5">
              <b translate="no" className="font-bold">
                {t.code}
              </b>
              <span className="truncate text-muted">{t.name[locale]}</span>
            </span>
            <StateMiniBar counts={t} />
            <span className={cn("text-end font-ui font-bold whitespace-nowrap tabular-nums", closed === t.total ? "text-success-fg" : "text-text")}>
              <span className="sr-only">{labels.closedOf(n(closed), n(t.total))}</span>
              <span aria-hidden="true" dir="ltr">
                {n(closed)}/{n(t.total)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
