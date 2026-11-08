"use client";

import { formatNumber, packageStateTotals, type Locale, type PackageItemState, type PackageSummary } from "@rabaed/domain";
import type { ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { CompanyChip } from "../data/avatar.tsx";
import { focusRing } from "../form/control-styles.ts";
import { TableCard } from "../list/table-card.tsx";
import { issueOf, PackageStatusPill, StateShareBar, TypeIconTile } from "./package-states.tsx";
import type { PackagesBoardLabels } from "./packages-board.tsx";

// The List of Packages (RP-1143, owner 2026-11-08; the kit's `packages/packages.js` list(), `.pkl`):
// one row per Package the viewer sees, with its progress, its submittals by Type and by state, how
// many wait on the viewer, and its owning Company. Every count is of the submittals the viewer sees
// (RP-641). Not the kit's Target, Created, Created by, To or Missing columns: no due dates (CLAUDE.md),
// no other Company's people (V14), no receiver and no expected items (gap table rows 17, 4, 11, 25).

export type PackagesListLabels = {
  /** The table's name. */
  table: string;
  number: string;
  /** The Package column: its name, then its status pill. */
  name: string;
  progress: string;
  items: string;
  /** The group heading over the per-Type columns. */
  types: string;
  /** The group heading over the per-state columns. */
  states: string;
  state: Record<PackageItemState, string>;
  /** "Waiting for you". */
  waiting: string;
  owner: string;
};

/** The state columns' order: what counts towards Done first. */
const stateColumns: readonly PackageItemState[] = ["done", "replace", "revise", "open"];
const stateText: Record<PackageItemState, string> = { done: "text-success-fg", replace: "text-danger-fg", revise: "text-warning-fg", open: "text-info-fg" };
const issueDot = { replace: "bg-danger", revise: "bg-warning-fg" } as const;

const th = "h-10 bg-surface-subtle px-3 text-start text-caption font-semibold whitespace-nowrap text-text-secondary";
const td = "h-[60px] border-t border-border-subtle bg-surface px-3 whitespace-nowrap";
const num = "text-center font-ui tabular-nums";
// The first two columns stay in view as the table scrolls sideways (the kit's `.pkl .s1`, `.s2`).
const sticky1 = "sticky start-0 z-[1] w-[120px] min-w-[120px]";
const sticky2 = "sticky start-[120px] z-[1] shadow-[inset_-1px_0_0_var(--color-border-subtle)] rtl:shadow-[inset_1px_0_0_var(--color-border-subtle)]";

export function PackagesList({
  packages,
  locale,
  labels,
  packageHref,
  linkAs: Link = "a",
}: {
  packages: PackageSummary[];
  locale: Locale;
  labels: PackagesBoardLabels;
  packageHref: (id: string) => string;
  linkAs?: ElementType;
}) {
  const n = (value: number) => formatNumber(value, locale);
  const l = labels.list;
  // A column for each Type of the Packages listed, by code: never one the viewer sees nothing of.
  const types = [...new Map(packages.flatMap((p) => p.byType.map((t) => [t.code, t] as const))).values()].sort((a, b) => a.code.localeCompare(b.code, "en"));
  return (
    <TableCard>
      <div role="region" aria-label={l.table} tabIndex={0} data-packages-list="" className={cn("overflow-x-auto", focusRing)}>
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th colSpan={4} className={cn(th, "h-7 bg-surface")} />
              {types.length > 0 && (
                <th colSpan={types.length} scope="colgroup" className={cn(th, "h-7 border-s border-border-subtle text-center text-[10.5px] font-bold tracking-wide uppercase rtl:tracking-normal")}>
                  {l.types}
                </th>
              )}
              <th colSpan={stateColumns.length} scope="colgroup" className={cn(th, "h-7 border-s border-border-subtle text-center text-[10.5px] font-bold tracking-wide uppercase rtl:tracking-normal")}>
                {l.states}
              </th>
              <th colSpan={2} className={cn(th, "h-7 border-s border-border-subtle bg-surface")} />
            </tr>
            <tr>
              <th scope="col" className={cn(th, sticky1)}>
                {l.number}
              </th>
              <th scope="col" className={cn(th, sticky2)}>
                {l.name}
              </th>
              <th scope="col" className={cn(th, "min-w-[240px]")}>
                {l.progress}
              </th>
              <th scope="col" className={cn(th, num, "border-s border-border-subtle")}>
                {l.items}
              </th>
              {types.map((t, i) => (
                <th key={t.code} scope="col" title={t.name[locale]} className={cn(th, num, i === 0 && "border-s border-border-subtle")}>
                  <span translate="no">{t.code}</span>
                </th>
              ))}
              {stateColumns.map((s, i) => (
                <th key={s} scope="col" className={cn(th, num, i === 0 && "border-s border-border-subtle")}>
                  {l.state[s]}
                </th>
              ))}
              <th scope="col" className={cn(th, num, "border-s border-border-subtle")}>
                {l.waiting}
              </th>
              <th scope="col" className={th}>
                {l.owner}
              </th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => {
              const totals = packageStateTotals(p.byType);
              const byCode = new Map(p.byType.map((t) => [t.code, t]));
              return (
                <tr key={p.id} data-package-row={p.id} className="group">
                  <td className={cn(td, sticky1, "group-hover:bg-hover")}>
                    <bdi dir="ltr" translate="no" data-package-number="" className="font-ui text-caption font-semibold text-muted">
                      {p.number}
                    </bdi>
                  </td>
                  <td className={cn(td, sticky2, "group-hover:bg-hover")}>
                    <span className="flex max-w-[340px] items-center gap-2">
                      <Link href={packageHref(p.id)} dir="auto" className={cn("min-w-0 truncate font-bold text-text hover:underline", focusRing)}>
                        {p.name[locale]}
                      </Link>
                      <PackageStatusPill status={p.status} label={labels.status[p.status]} className="ms-auto" />
                    </span>
                  </td>
                  <td className={cn(td, "py-2 group-hover:bg-hover")}>
                    {/* The kit's `.pe-cell`: closed of total with the share bar, then a chip per Type. */}
                    <span className="flex flex-col gap-1.5">
                      <span className="flex items-center gap-2">
                        <span className="shrink-0 text-caption text-text-secondary">{labels.closedOf(n(totals.closed), n(totals.total))}</span>
                        <StateShareBar counts={totals} total={totals.total} className="flex-1" />
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {p.byType.length === 0 ? (
                          <span className="text-caption text-faint">{labels.noSubmittals}</span>
                        ) : (
                          p.byType.map((t) => {
                            const issue = issueOf(t);
                            return (
                              <span key={t.code} className="inline-flex h-6 items-center gap-1 rounded-[7px] bg-segment-type-tint ps-1 pe-2 text-caption font-bold text-segment-type-fg">
                                <TypeIconTile code={t.code} size={18} className="bg-surface" />
                                <span translate="no">{t.code}</span>
                                <span className="font-ui text-text tabular-nums">{n(t.total)}</span>
                                {issue && <span aria-hidden="true" data-issue={issue} className={cn("size-[7px] rounded-full", issueDot[issue])} />}
                              </span>
                            );
                          })
                        )}
                      </span>
                    </span>
                  </td>
                  <td className={cn(td, num, "border-s border-border-subtle font-semibold group-hover:bg-hover")}>{n(totals.total)}</td>
                  {types.map((t, i) => {
                    const c = byCode.get(t.code)?.total ?? 0;
                    return (
                      <td key={t.code} className={cn(td, num, i === 0 && "border-s border-border-subtle", "group-hover:bg-hover")}>
                        {c > 0 ? <span className="inline-flex min-w-6 justify-center rounded-[6px] bg-segment-type-tint px-1.5 font-semibold text-segment-type-fg">{n(c)}</span> : <span className="text-faint">–</span>}
                      </td>
                    );
                  })}
                  {stateColumns.map((s, i) => (
                    <td key={s} data-state={s} className={cn(td, num, i === 0 && "border-s border-border-subtle", totals[s] > 0 ? cn("font-semibold", stateText[s]) : "text-faint", "group-hover:bg-hover")}>
                      {totals[s] > 0 ? n(totals[s]) : "–"}
                    </td>
                  ))}
                  <td data-package-waiting="" className={cn(td, num, "border-s border-border-subtle group-hover:bg-hover")}>
                    {p.waiting > 0 ? <span className="inline-flex min-w-6 justify-center rounded-[6px] bg-primary px-1.5 font-semibold text-on-primary">{n(p.waiting)}</span> : <span className="text-faint">–</span>}
                  </td>
                  <td className={cn(td, "group-hover:bg-hover")}>
                    <CompanyChip name={p.owner.companyName[locale]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </TableCard>
  );
}
