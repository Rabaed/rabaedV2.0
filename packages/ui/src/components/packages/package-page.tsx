"use client";

import {
  formatNumber,
  closedCount,
  intlLocaleOf,
  packageStateTotals,
  workItemSortOrders,
  type BilingualText,
  type ListColumnKey,
  type ListColumnLayout,
  type Locale,
  type PackageDetail,
  type PackageDetailItem,
  type PackageItemState,
  type PackageStatus,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import { useState, type CSSProperties, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { sayRefusal } from "../../lib/refusal.ts";
import { Button, IconButton } from "../button/button.tsx";
import { CompanyChip } from "../data/avatar.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { TableCard } from "../list/table-card.tsx";
import { BackLink } from "../navigation/back-link.tsx";
import { scrollClear } from "../views/work-item-list.tsx";
import { cellText, WorkItemTable, type WorkItemTableLabels } from "../views/work-item-table.tsx";
import { AddPackageItemsDialog, type AddPackageItemsLabels, type PackageItemSearch } from "./add-package-items-dialog.tsx";
import { usePackageBulk, type PackageBulkProps } from "./package-bulk.tsx";
import { DeletePackageDialog, RenamePackageDialog, type DeletePackageLabels, type RenamePackageLabels } from "./package-dialogs.tsx";
import { IssueDot, PackageStatusPill, StateMiniBar, stateEdge, stateOrder, stateText, TypeIconTile } from "./package-states.tsx";
import { PackageNotReadyList, SubmitPackageDialog, type SubmitPackageCall, type SubmitPackageLabels } from "./submit-package-dialog.tsx";

// The Package page (RP-659, spec RP-616; reference: the RP-633 prototype's page header, counts
// panel and item table, as corrected by design/prompts/packages.md "Reference (RP-633)"): the
// PKG number left to right beside its owning Company (numbers count per Project and owning
// Participant, so two Companies' Packages can both be PKG-001), its name, status and counts of the
// submittals the viewer sees, and those submittals as the List shows them, with Step Age dots and
// no dates. The owner renames it, adds items and Submits it; while Open, also removes items and
// deletes it. Presentational: what the viewer may do comes from the API (`pkg.actions`), and the
// page makes the calls.

/** A command as the page calls it: a refusal by the API's error code. */
export type PackageCall = () => Promise<{ ok: true } | { ok: false; reason: string }>;

export type PackagePageLabels = {
  /** The way back, "Back" (RP-1241). */
  back: string;
  /** The tag before the number, "Package". */
  kind: string;
  status: Record<PackageStatus, string>;
  /** Read before the owning Company's name, e.g. "Owned by". */
  ownedBy: string;
  /** The counts panel's heading. */
  progress: string;
  /** Under the ring, e.g. "2 of 8 closed". */
  closedOf: (closed: string, total: string) => string;
  /** Each state's name (RP-1143): the Progress tiles and the table's tabs, e.g. "Closed A/B", "Code C". */
  state: Record<PackageItemState, string>;
  /** The "By Type" box's heading (RP-1143). */
  byType: string;
  /** Clears the By Type box's choice. */
  clearType: string;
  /** The table's tabs (RP-1143): their name, "Waiting for you" and "All". */
  tabs: { label: string; waiting: string; all: string };
  /** A tab or Type that leaves no row. */
  nothingHere: string;
  /** The table section's heading. */
  submittals: string;
  /** The table of a Package with none the viewer sees yet. */
  empty: string;
  /** Said on a Done Package. */
  done: string;
  /** The header's actions, as a group. */
  actions: string;
  /** "With": who holds each submittal now (the table's owner column). */
  with: string;
  /** A row's remove button, e.g. "Remove Floor tiles from the Package". */
  remove: (subject: string) => string;
  close: string;
  cancel: string;
  /** A refused command, by the API's error code, and `unavailable` for any other. */
  refusals: Record<string, string> & { unavailable: string };
  table: WorkItemTableLabels;
  rename: RenamePackageLabels;
  delete: DeletePackageLabels;
  addItems: AddPackageItemsLabels;
  submit: SubmitPackageLabels;
};

export type PackagePageProps = {
  /** The Package as the API gives it: its submittals the viewer sees (each its List row), and what the table reads around them. */
  pkg: PackageDetail;
  locale: Locale;
  labels: PackagePageLabels;
  /** The page's fixed parent, the Project's Packages: where "Back" goes when the page before wasn't inside Rabaed. */
  backHref: string;
  itemHref: (id: string) => string;
  linkAs?: ElementType;
  /** The calls, each offered only where `pkg.actions` allows it. */
  onRename?: (name: BilingualText) => ReturnType<PackageCall>;
  onDelete?: PackageCall;
  onRemove?: (row: WorkItemRow) => ReturnType<PackageCall>;
  searchItems?: PackageItemSearch;
  onAdd?: (workItemIds: string[]) => ReturnType<PackageCall>;
  onSubmit?: SubmitPackageCall;
  /** Bulk Transitions on the submittals waiting on the viewer (RP-661). */
  bulk?: PackageBulkProps;
};

/**
 * The table's columns, as the Reference (RP-633) has them: Document Number, Rev, Subject, Type, Trade,
 * With, Review Code or Stage (one column: the Code once there is one), Step Age; never a date.
 */
const columns: ListColumnLayout = (["documentNumber", "revision", "subject", "type", "trade", "owner", "stage", "stepAge"] as const).map((key) => ({
  key,
  shown: true,
}));

export function PackagePage({
  pkg,
  locale,
  labels,
  backHref,
  itemHref,
  linkAs: Link = "a",
  onRename,
  onDelete,
  onRemove,
  searchItems,
  onAdd,
  onSubmit,
  bulk,
}: PackagePageProps) {
  const [sort, setSort] = useState<Pick<WorkItemQuery, "sort" | "dir">>({ sort: "documentNumber", dir: undefined });
  const [error, setError] = useState<string | null>(null);
  const n = (value: number) => formatNumber(value, locale);
  const name = pkg.name[locale];
  const { items: rows, filters } = pkg;
  // The table's tab and Type (RP-1143, the kit's `.dtabs` and `.tt`): it opens on what waits on the viewer, when anything does.
  const waitingCount = rows.filter((r) => r.waiting).length;
  const [tab, setTab] = useState<Tab>(waitingCount > 0 ? "waiting" : "all");
  const [type, setType] = useState<string | null>(null);
  const shownTab: Tab = tab === "waiting" && waitingCount === 0 ? "all" : tab;
  const inTab = (r: PackageDetailItem) => shownTab === "all" || (shownTab === "waiting" ? r.waiting : r.state === shownTab);
  const visible = rows.filter((r) => inTab(r) && (type === null || r.type.code === type));
  // The bulk bar and its checkboxes on the Waiting for you tab only (gap table row 34, the kit's Waiting my action).
  const bulkTable = usePackageBulk({ items: shownTab === "waiting" ? visible : [], bulk, locale, close: labels.close, cancel: labels.cancel, itemHref, linkAs: Link });
  const states = new Map(rows.map((r) => [r.id, r.state]));
  // The API says which are still to Submit, which of them stop it and why, and whether the viewer owns the Package.
  const toSubmit = rows.filter((r) => r.toSubmit);
  // Submit Package only when nothing stops it (spec RP-616 story 11, RP-974); otherwise the owner reads what does.
  const submittable = onSubmit !== undefined && pkg.actions.submit;
  const notReady = rows.flatMap((r) => (r.notReady ? [{ id: r.id, documentNumber: r.documentNumber, title: r.title, reason: r.notReady }] : []));
  const blocked = onSubmit !== undefined && pkg.owned && !pkg.actions.submit && (notReady.length > 0 || pkg.othersNotReady);
  const tableLabels: WorkItemTableLabels = { ...labels.table, columns: { ...labels.table.columns, owner: labels.with }, empty: rows.length === 0 ? labels.empty : labels.nothingHere };
  const sorted = sortRows(visible, sort, locale, tableLabels, filters);

  const run = async (call: () => ReturnType<PackageCall>) => {
    setError(null);
    try {
      const result = await call();
      if (!result.ok) setError(sayRefusal(labels.refusals, result.reason));
    } catch {
      setError(labels.refusals.unavailable);
    }
  };

  return (
    <div data-package-page="" className="flex min-w-0 flex-col gap-4">
      <BackLink href={backHref} label={labels.back} linkAs={Link} />

      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-[7px] bg-brand-tint px-2 text-caption font-semibold text-brand-fg">
              <Icon name="packages" size={14} />
              {labels.kind}
            </span>
            <bdi dir="ltr" translate="no" data-package-number="" className="font-ui text-sm font-bold text-muted">
              {pkg.number}
            </bdi>
            {/* Beside the number: two Companies' Packages can share it. The Company by its name only (V14). */}
            <span className="sr-only">{labels.ownedBy}</span>
            <CompanyChip name={pkg.owner.companyName[locale]} />
            <PackageStatusPill status={pkg.status} label={labels.status[pkg.status]} />
          </div>
          <h1 dir="auto" className="mt-2 font-display text-h3 leading-tight font-extrabold text-text">
            {name}
          </h1>
        </div>
        <div role="group" aria-label={labels.actions} className="flex flex-wrap gap-2">
          {pkg.actions.rename && onRename && (
            <RenamePackageDialog name={pkg.name} labels={labels.rename} close={labels.close} cancel={labels.cancel} refusals={labels.refusals} onRename={onRename} />
          )}
          {pkg.actions.delete && onDelete && (
            <DeletePackageDialog number={pkg.number} labels={labels.delete} close={labels.close} cancel={labels.cancel} refusals={labels.refusals} onDelete={onDelete} />
          )}
          {pkg.actions.addItems && searchItems && onAdd && (
            <AddPackageItemsDialog
              packageId={pkg.id}
              trades={filters.trades}
              locale={locale}
              labels={labels.addItems}
              close={labels.close}
              cancel={labels.cancel}
              refusals={labels.refusals}
              search={searchItems}
              onAdd={onAdd}
              primary={!submittable}
            />
          )}
          {submittable && (
            <SubmitPackageDialog
              number={pkg.number}
              items={toSubmit}
              locale={locale}
              labels={labels.submit}
              close={labels.close}
              cancel={labels.cancel}
              refusals={labels.refusals}
              itemHref={itemHref}
              linkAs={Link}
              onSubmit={onSubmit}
              gate={bulk?.gate}
            />
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}

      {blocked && (
        <PackageNotReadyList
          items={notReady}
          others={pkg.othersNotReady}
          intro={labels.submit.notReadyOnPage}
          labels={labels.submit}
          itemHref={itemHref}
          linkAs={Link}
        />
      )}

      {/* The kit's `.pp-sum`: Progress and By Type side by side from 1280 (so at 1366 and 1920), stacked under it. */}
      <div className={cn("grid min-w-0 gap-3", pkg.byType.length > 0 && "xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]")}>
        <Progress pkg={pkg} locale={locale} labels={labels} tab={shownTab} onTab={setTab} />
        {/* Nothing the viewer sees in it yet: the table says so, once. */}
        {pkg.byType.length > 0 && <ByType pkg={pkg} locale={locale} labels={labels} type={type} onType={setType} />}
      </div>

      {pkg.status === "done" && (
        <p role="note" className="flex items-center gap-2 rounded-md bg-success-tint px-4 py-3 text-sm font-medium text-success-fg">
          <Icon name="circle-check" size={18} />
          {labels.done}
        </p>
      )}

      <section aria-labelledby="package-submittals" className="flex min-w-0 flex-col gap-2">
        <h2 id="package-submittals" className="sr-only">
          {labels.submittals}
        </h2>
        <TableCard>
          {/* The kit's tabs over the table (`.pp-th .dtabs`): what waits on the viewer, all, and each state, with their counts. */}
          <div role="group" aria-label={labels.tabs.label} data-package-tabs="" className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-3 pt-2">
            {tabsOf(waitingCount).map((t) => {
              const count = t === "waiting" ? waitingCount : t === "all" ? rows.length : rows.filter((r) => r.state === t).length;
              const on = shownTab === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  data-tab={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold whitespace-nowrap",
                    on ? "border-primary text-text" : "border-transparent text-text-secondary hover:text-text",
                    focusRing,
                  )}
                >
                  {t === "waiting" && <Icon name="hand-finger" size={16} className="text-brand-fg" />}
                  {t === "waiting" ? labels.tabs.waiting : t === "all" ? labels.tabs.all : labels.state[t]}
                  <span
                    className={cn(
                      "rounded-full px-1.5 font-ui text-caption leading-5 font-semibold tabular-nums",
                      t === "waiting" && count > 0 ? "bg-brand text-on-primary" : on ? "bg-brand-tint text-brand-fg" : "bg-neutral-tint text-neutral-fg",
                    )}
                  >
                    {n(count)}
                  </span>
                </button>
              );
            })}
          </div>
          {bulkTable.bar}
          {/* The table scrolls in its own region, as the List's does, its scrollbar on screen, so the page never does and nothing is cut unseen. */}
          <div
            role="region"
            aria-label={labels.table.table}
            tabIndex={0}
            data-package-table=""
            className={cn("relative overflow-auto lg:max-h-[calc(100dvh-12rem)]", scrollClear, focusRing)}
          >
            <WorkItemTable
              rows={sorted}
              filters={filters}
              columns={columns}
              query={sort}
              locale={locale}
              labels={tableLabels}
              onSort={setSort}
              itemHref={itemHref}
              linkAs={Link}
              selection={bulkTable.selection}
              stageShowsCode
              // The kit's state edge on each row (`.pkt tr.ok td:first-child`): green A/B, red D, orange C.
              rowStartClassName={(row) => stateEdge[states.get(row.id) ?? "open"]}
              // Fits 1366 as the List's table does (RP-1177), so "Review Code or Stage" and "Step Age" show (RP-1164, UX-23).
              fit
              rowEnd={
                pkg.actions.removeItems && onRemove
                  ? (row) => (
                      <IconButton label={labels.remove(row.title)} size="sm" onClick={() => void run(() => onRemove(row))}>
                        <Icon name="x" />
                      </IconButton>
                    )
                  : undefined
              }
            />
          </div>
        </TableCard>
      </section>
    </div>
  );
}

/** The table's tabs: "Waiting for you" only when something waits on the viewer, then All and each state. */
type Tab = "waiting" | "all" | PackageItemState;
const tabsOf = (waiting: number): Tab[] => [...(waiting > 0 ? (["waiting"] as const) : []), "all", ...stateOrder];

const boxHeading = "text-notes font-bold tracking-wide text-muted uppercase rtl:tracking-normal";

/**
 * The Progress box (the kit's `.pp-prog`): a ring of what counts towards Done (closed at Code A, B
 * or D) of all the viewer sees, then a tile per state, each showing its rows in the table.
 */
function Progress({ pkg, locale, labels, tab, onTab }: { pkg: PackageDetail; locale: Locale; labels: PackagePageLabels; tab: Tab; onTab: (tab: Tab) => void }) {
  const n = (value: number) => formatNumber(value, locale);
  const totals = packageStateTotals(pkg.byType);
  const share = totals.total === 0 ? 0 : Math.round((totals.closed / totals.total) * 100);
  const ring: CSSProperties = { background: `conic-gradient(var(--color-success) ${share}%, var(--color-neutral-tint) 0)` };
  return (
    <section aria-labelledby="package-progress" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-4">
      <h2 id="package-progress" className={boxHeading}>
        {labels.progress}
      </h2>
      <div className="flex flex-wrap items-center gap-4">
        {/* The kit's `.ring`: 104 px. */}
        <div aria-hidden="true" style={ring} className="relative flex size-[104px] shrink-0 flex-col items-center justify-center rounded-full">
          <span className="absolute inset-2 rounded-full bg-surface" />
          <span dir="ltr" className="relative font-ui text-xl font-extrabold text-text tabular-nums">
            {n(totals.closed)}/{n(totals.total)}
          </span>
        </div>
        <p data-testid="package-closed" className="sr-only">
          {labels.closedOf(n(totals.closed), n(totals.total))}
        </p>
        <ul className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
          {stateOrder.map((state) => (
            <li key={state}>
              {/* The kit's `.sc`: a tile shows its rows; again, all of them. */}
              <button
                type="button"
                data-state={state}
                aria-pressed={tab === state}
                onClick={() => onTab(tab === state ? "all" : state)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-md bg-surface-subtle px-3 py-2 text-start hover:bg-hover",
                  stateEdge[state],
                  tab === state && "bg-brand-tint",
                  focusRing,
                )}
              >
                <span className={cn("font-ui text-xl leading-tight font-extrabold tabular-nums", totals[state] > 0 ? stateText[state] : "text-faint")}>{n(totals[state])}</span>
                <span className="text-caption whitespace-nowrap text-muted">{labels.state[state]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The By Type box (the kit's `.pp-ty`): a tile per Type the viewer sees, with its count, closed of
 * total, a segment per submittal by state and a dot when one needs attention; a tile shows only its rows.
 */
function ByType({ pkg, locale, labels, type, onType }: { pkg: PackageDetail; locale: Locale; labels: PackagePageLabels; type: string | null; onType: (type: string | null) => void }) {
  const n = (value: number) => formatNumber(value, locale);
  return (
    <section aria-labelledby="package-by-type" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-4">
      <div className="flex items-center gap-2">
        <h2 id="package-by-type" className={boxHeading}>
          {labels.byType}
        </h2>
        {type !== null && (
          <Button size="sm" variant="ghost" className="ms-auto h-6" onClick={() => onType(null)}>
            {labels.clearType}
          </Button>
        )}
      </div>
      <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
        {pkg.byType.map((t) => {
          const closed = closedCount(t);
          const on = type === t.code;
          return (
            <li key={t.typeId}>
              <button
                type="button"
                data-type={t.code}
                aria-pressed={on}
                onClick={() => onType(on ? null : t.code)}
                className={cn("relative flex w-full flex-col gap-1.5 rounded-md bg-surface-subtle px-3 py-2.5 text-start hover:bg-hover", on && "bg-brand-tint ring-1 ring-primary", focusRing)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <TypeIconTile code={t.code} />
                  <b translate="no" className="text-sm font-bold">
                    {t.code}
                  </b>
                  <span className="min-w-0 truncate text-caption text-muted">{t.name[locale]}</span>
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="font-ui text-xl leading-tight font-extrabold tabular-nums">{n(t.total)}</span>
                  <span className={cn("ms-auto text-caption font-bold", closed === t.total ? "text-success-fg" : "text-text-secondary")}>{labels.closedOf(n(closed), n(t.total))}</span>
                </span>
                <StateMiniBar counts={t} />
                <IssueDot counts={t} className="absolute end-2 top-2 size-2" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The rows in the table's order: by a column's text, its own way first, then the other. */
function sortRows(
  rows: readonly WorkItemRow[],
  { sort, dir }: Pick<WorkItemQuery, "sort" | "dir">,
  locale: Locale,
  labels: WorkItemTableLabels,
  filters: PackageDetail["filters"],
): WorkItemRow[] {
  const key = sort as ListColumnKey;
  if (!columns.some((c) => c.key === key)) return [...rows];
  const ascending = (dir ?? workItemSortOrders[key]) === "asc";
  // The Stage column shows the Review Code once there is one (stageShowsCode), and sorts by what it shows.
  const shownKey = (r: WorkItemRow): ListColumnKey => (key === "stage" && r.outcome !== null ? "outcome" : key);
  const text = (r: WorkItemRow) => (key === "stepAge" ? String(r.stepAgeWeeks ?? -1).padStart(4, "0") : cellText(shownKey(r), r, locale, labels, filters));
  const collator = new Intl.Collator(intlLocaleOf(locale), { numeric: true });
  return [...rows].sort((a, b) => (ascending ? 1 : -1) * collator.compare(text(a), text(b)) || collator.compare(a.title, b.title));
}
