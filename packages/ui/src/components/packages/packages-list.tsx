"use client";

import { formatNumber, packageStateTotals, type Locale, type PackageItemState, type PackageStatus, type PackageSummary } from "@rabaed/domain";
import type { ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { CompanyChip } from "../data/avatar.tsx";
import { focusRing } from "../form/control-styles.ts";
import { TableCard } from "../list/table-card.tsx";
import { IssueDot, PackageStatusPill, StateShareBar, stateOrder, stateText, TypeIconTile } from "./package-states.tsx";

// The table of Packages (RP-1143, owner 2026-11-08; the kit's `packages/packages.js` list(), `.pkl`):
// one row per Package the viewer sees, with its progress (closed of total, the share bar and a chip
// per Type with its count), its submittals by Review Code, how many wait on the viewer, and its owning
// Company. Every count is of the submittals the viewer sees (RP-641). Not the kit's Target, Created,
// Created by, To or Missing columns: no due dates (CLAUDE.md), no other Company's people (V14), no
// receiver and no expected items (gap table rows 17, 4, 11, 25). Its per-Type and Items columns are left
// to the Progress cell's chips and total, so the table fits 1366 (row 19).

export type PackagesListLabels = {
  /** The table's name. */
  table: string;
  number: string;
  /** The Package column: its name, then its status pill. */
  name: string;
  progress: string;
  /** The group heading over the Review Code columns. */
  states: string;
  state: Record<PackageItemState, string>;
  /** "Waiting for you". */
  waiting: string;
  owner: string;
  /** Each Package's status, for its pill. */
  status: Record<PackageStatus, string>;
  /** Closed of the submittals the viewer sees, e.g. "3 of 8 closed". */
  closedOf: (closed: string, total: string) => string;
  /** A Package with no submittal the viewer sees. */
  noSubmittals: string;
};

const th = "h-10 bg-surface-subtle px-2.5 text-start text-caption font-semibold whitespace-nowrap text-text-secondary";
const td = "h-[60px] border-t border-border-subtle bg-surface px-2.5 whitespace-nowrap group-hover:bg-hover";
const num = "text-center font-ui tabular-nums";
const groupStart = "border-s border-border-subtle";
// The first two columns stay in view as the table scrolls sideways (the kit's `.pkl .s1`, `.s2`).
const sticky1 = "sticky start-0 z-[1] w-[96px] min-w-[96px]";
const sticky2 = "sticky start-[96px] z-[1] shadow-[inset_-1px_0_0_var(--color-border-subtle)] rtl:shadow-[inset_1px_0_0_var(--color-border-subtle)]";

export function PackagesList({
  packages,
  locale,
  labels: l,
  packageHref,
  linkAs: Link = "a",
}: {
  packages: PackageSummary[];
  locale: Locale;
  labels: PackagesListLabels;
  packageHref: (id: string) => string;
  linkAs?: ElementType;
}) {
  const n = (value: number) => formatNumber(value, locale);
  return (
    <TableCard>
      <div role="region" aria-label={l.table} tabIndex={0} data-packages-list="" className={cn("overflow-x-auto", focusRing)}>
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th colSpan={3} className={cn(th, "h-7 bg-surface")} />
              <th colSpan={stateOrder.length} scope="colgroup" className={cn(th, groupStart, "h-7 text-center text-[10.5px] font-bold tracking-wide uppercase rtl:tracking-normal")}>
                {l.states}
              </th>
              <th colSpan={2} className={cn(th, groupStart, "h-7 bg-surface")} />
            </tr>
            <tr>
              <th scope="col" className={cn(th, sticky1)}>
                {l.number}
              </th>
              <th scope="col" className={cn(th, sticky2)}>
                {l.name}
              </th>
              <th scope="col" className={cn(th, "min-w-[170px]")}>
                {l.progress}
              </th>
              {stateOrder.map((s, i) => (
                <th key={s} scope="col" className={cn(th, num, i === 0 && groupStart)}>
                  {l.state[s]}
                </th>
              ))}
              <th scope="col" className={cn(th, num, groupStart)}>
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
              return (
                <tr key={p.id} data-package-row={p.id} className="group">
                  <td className={cn(td, sticky1)}>
                    <bdi dir="ltr" translate="no" data-package-number="" className="font-ui text-caption font-semibold text-muted">
                      {p.number}
                    </bdi>
                  </td>
                  <td className={cn(td, sticky2)}>
                    <span className="flex max-w-[210px] items-center gap-2">
                      <Link href={packageHref(p.id)} dir="auto" className={cn("min-w-0 truncate font-bold text-text hover:underline pointer-coarse:leading-11", focusRing)}>
                        {p.name[locale]}
                      </Link>
                      <PackageStatusPill status={p.status} label={l.status[p.status]} className="ms-auto" />
                    </span>
                  </td>
                  <td className={cn(td, "py-2")}>
                    {/* The kit's `.pe-cell`: closed of total with the share bar, then a chip per Type with its count. */}
                    <span className="flex flex-col gap-1.5">
                      <span className="flex items-center gap-2">
                        <span className="shrink-0 text-caption text-text-secondary">{l.closedOf(n(totals.closed), n(totals.total))}</span>
                        <StateShareBar counts={totals} total={totals.total} className="flex-1" />
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {p.byType.length === 0 ? (
                          <span className="text-caption text-faint">{l.noSubmittals}</span>
                        ) : (
                          p.byType.map((t) => (
                            <span
                              key={t.code}
                              data-type={t.code}
                              title={t.name[locale]}
                              className="inline-flex h-6 items-center gap-1 rounded-[7px] bg-segment-type-tint ps-1 pe-2 text-caption font-bold text-segment-type-fg"
                            >
                              <TypeIconTile code={t.code} size={18} className="bg-surface" />
                              <span translate="no">{t.code}</span>
                              <span className="font-ui text-text tabular-nums">{n(t.total)}</span>
                              <IssueDot counts={t} className="size-[7px]" />
                            </span>
                          ))
                        )}
                      </span>
                    </span>
                  </td>
                  {stateOrder.map((s, i) => (
                    <td key={s} data-state={s} className={cn(td, num, i === 0 && groupStart, totals[s] > 0 ? cn("font-semibold", stateText[s]) : "text-faint")}>
                      {totals[s] > 0 ? n(totals[s]) : "–"}
                    </td>
                  ))}
                  <td data-package-waiting="" className={cn(td, num, groupStart)}>
                    {p.waiting > 0 ? <span className="inline-flex min-w-6 justify-center rounded-[6px] bg-primary px-1.5 font-semibold text-on-primary">{n(p.waiting)}</span> : <span className="text-faint">–</span>}
                  </td>
                  <td className={td}>
                    <CompanyChip name={p.owner.companyName[locale]} className="max-w-[160px]" />
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
