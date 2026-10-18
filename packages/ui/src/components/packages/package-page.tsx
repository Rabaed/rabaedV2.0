"use client";

import {
  formatNumber,
  intlLocaleOf,
  isOpenStageCategory,
  workItemSortOrders,
  type BilingualText,
  type ListColumnKey,
  type ListColumnLayout,
  type Locale,
  type PackageDetail,
  type PackageStatus,
  type WorkItemList as WorkItemListData,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import { useState, type CSSProperties, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { CompanyChip } from "../data/avatar.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { TableCard } from "../list/table-card.tsx";
import { cellText, WorkItemTable, type WorkItemTableLabels } from "../views/work-item-table.tsx";
import { AddPackageItemsDialog, type AddPackageItemsLabels, type PackageItemSearch } from "./add-package-items-dialog.tsx";
import { DeletePackageDialog, RenamePackageDialog, type DeletePackageLabels, type RenamePackageLabels } from "./package-dialogs.tsx";
import { SubmitPackageDialog, type SubmitPackageCall, type SubmitPackageLabels } from "./submit-package-dialog.tsx";

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
  /** The breadcrumb's name. */
  breadcrumb: string;
  /** The way back: the Submittals. */
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
  /** A count's Review Code, e.g. "Code A". */
  code: (code: string) => string;
  stillOpen: string;
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
  pkg: PackageDetail;
  /** Its submittals the viewer sees, as the List gives them (the work item query's `packageId`). */
  rows: WorkItemRow[];
  /** What the List read around them: the Types' outcomes and the Location tree. */
  filters: Pick<WorkItemListData["filters"], "outcomes" | "locations" | "trades">;
  locale: Locale;
  labels: PackagePageLabels;
  /** The Submittals, where the breadcrumb leads back. */
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
};

const statusTone = { open: "neutral", in_progress: "info", done: "success" } as const;

/** The table's columns: Document Number, Subject, Type, Trade, With, Review Code or Stage, Step Age; never a date. */
const columns: ListColumnLayout = (["documentNumber", "subject", "type", "trade", "owner", "stage", "outcome", "stepAge"] as const).map((key) => ({
  key,
  shown: true,
}));

/** The submittals still to Submit: open, never Submitted (a Sent Back one is re-Submitted alone, on its own page). */
export function packageItemsToSubmit(rows: readonly WorkItemRow[]): WorkItemRow[] {
  return rows.filter((r) => r.submissionDate === null && isOpenStageCategory(r.stage.category));
}

export function PackagePage({
  pkg,
  rows,
  filters,
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
}: PackagePageProps) {
  const [sort, setSort] = useState<Pick<WorkItemQuery, "sort" | "dir">>({ sort: "documentNumber", dir: undefined });
  const [error, setError] = useState<string | null>(null);
  const n = (value: number) => formatNumber(value, locale);
  const name = pkg.name[locale];
  const toSubmit = packageItemsToSubmit(rows);
  // Submit Package: for the owner, while anything is left to Submit; disabled in its dialog until nothing stops it.
  const owner = pkg.actions.rename || pkg.actions.addItems;
  const submittable = onSubmit !== undefined && (pkg.actions.submit || (owner && toSubmit.length > 0));
  const tableLabels: WorkItemTableLabels = { ...labels.table, columns: { ...labels.table.columns, owner: labels.with }, empty: labels.empty };
  const sorted = sortRows(rows, sort, locale, tableLabels, filters);

  const run = async (call: () => ReturnType<PackageCall>) => {
    setError(null);
    try {
      const result = await call();
      if (!result.ok) setError(labels.refusals[result.reason] ?? labels.refusals.unavailable);
    } catch {
      setError(labels.refusals.unavailable);
    }
  };

  return (
    <div data-package-page="" className="flex min-w-0 flex-col gap-3.5">
      <nav aria-label={labels.breadcrumb} className="flex items-center gap-1.5 text-sm text-muted">
        <Link href={backHref} className={cn("inline-flex items-center gap-1.5 rounded-xs font-medium text-text-secondary hover:text-text", focusRing)}>
          <Icon name="arrow-left" size={16} />
          {labels.back}
        </Link>
        <Icon name="chevron-right" size={14} className="text-faint" />
        <bdi dir="ltr" translate="no" aria-current="page" className="font-ui font-semibold text-text-secondary">
          {pkg.number}
        </bdi>
      </nav>

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
            <Badge tone={statusTone[pkg.status]} dot data-package-status={pkg.status}>
              {labels.status[pkg.status]}
            </Badge>
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
            />
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}

      <Counts pkg={pkg} locale={locale} labels={labels} />

      {pkg.status === "done" && (
        <p role="note" className="flex items-center gap-2 rounded-md bg-success-tint px-4 py-3 text-sm font-medium text-success-fg">
          <Icon name="circle-check" size={18} />
          {labels.done}
        </p>
      )}

      <section aria-labelledby="package-submittals" className="flex min-w-0 flex-col gap-2">
        <h2 id="package-submittals" className="flex items-center gap-2 text-lg font-bold text-text">
          {labels.submittals}
          <span className="rounded-full bg-neutral-tint px-2 font-ui text-caption leading-5 font-semibold text-neutral-fg tabular-nums">{n(rows.length)}</span>
        </h2>
        <TableCard>
          {/* The table scrolls sideways in its own region, so the page never does. */}
          <div role="region" aria-label={labels.table.table} tabIndex={0} className={cn("relative overflow-auto", focusRing)}>
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

/** The counts panel: a ring of the closed of all the viewer sees, then one count per Review Code and the ones still open. */
function Counts({ pkg, locale, labels }: { pkg: PackageDetail; locale: Locale; labels: PackagePageLabels }) {
  const n = (value: number) => formatNumber(value, locale);
  const { total, open, codes } = pkg.counts;
  const closed = total - open;
  // A to D always, in order; any other outcome after them, as the API names it.
  const codeKeys = [...new Set(["A", "B", "C", "D", ...Object.keys(codes).sort()])];
  const share = total === 0 ? 0 : Math.round((closed / total) * 100);
  const ring: CSSProperties = { background: `conic-gradient(var(--color-success) ${share}%, var(--color-neutral-tint) 0)` };
  const tile = "flex min-w-[88px] flex-col items-start gap-0.5 rounded-md bg-surface-subtle px-3 py-2";
  return (
    <section aria-labelledby="package-progress" className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3.5">
      <h2 id="package-progress" className="text-notes font-bold tracking-wide text-muted uppercase rtl:tracking-normal">
        {labels.progress}
      </h2>
      <div className="flex flex-wrap items-center gap-4">
        <div aria-hidden="true" style={ring} className="relative flex size-[88px] shrink-0 items-center justify-center rounded-full">
          <span className="absolute inset-2 rounded-full bg-surface" />
          <span className="relative font-ui text-lg font-extrabold text-text tabular-nums">
            {n(closed)}/{n(total)}
          </span>
        </div>
        <p data-testid="package-closed" className="sr-only">
          {labels.closedOf(n(closed), n(total))}
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {codeKeys.map((code) => (
            <li key={code} data-code={code} className={tile}>
              <span className={cn("font-ui text-xl leading-tight font-extrabold tabular-nums", codes[code] ? "text-text" : "text-faint")}>{n(codes[code] ?? 0)}</span>
              <span className="text-caption whitespace-nowrap text-muted">{labels.code(code)}</span>
            </li>
          ))}
          <li data-code="open" className={tile}>
            <span className={cn("font-ui text-xl leading-tight font-extrabold tabular-nums", open ? "text-text" : "text-faint")}>{n(open)}</span>
            <span className="text-caption whitespace-nowrap text-muted">{labels.stillOpen}</span>
          </li>
        </ul>
      </div>
    </section>
  );
}

/** The rows in the table's order: by a column's text, its own way first, then the other. */
function sortRows(
  rows: readonly WorkItemRow[],
  { sort, dir }: Pick<WorkItemQuery, "sort" | "dir">,
  locale: Locale,
  labels: WorkItemTableLabels,
  filters: PackagePageProps["filters"],
): WorkItemRow[] {
  const key = sort as ListColumnKey;
  if (!columns.some((c) => c.key === key)) return [...rows];
  const ascending = (dir ?? workItemSortOrders[key]) === "asc";
  const text = (r: WorkItemRow) => (key === "stepAge" ? String(r.stepAgeWeeks ?? -1).padStart(4, "0") : cellText(key, r, locale, labels, filters));
  const collator = new Intl.Collator(intlLocaleOf(locale), { numeric: true });
  return [...rows].sort((a, b) => (ascending ? 1 : -1) * collator.compare(text(a), text(b)) || collator.compare(a.title, b.title));
}
