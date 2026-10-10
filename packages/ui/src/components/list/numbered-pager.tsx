"use client";

import { useId, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";

// The List's pager (RP-409, the owner's design): rows per page at the start, "Page 1 of 2 ·
// 42 submittals" in the middle, and « ‹ 1 2 › » at the end. When the number of pages can't be
// said (a search: visibility.md "Search and filters"), there is no total and no last page, and
// the page numbers grow as the pages are read.

export type NumberedPagerLabels = {
  /** Names the pager's navigation, e.g. "Pages". */
  pages: string;
  rowsPerPage: string;
  first: string;
  previous: string;
  next: string;
  last: string;
  /** A page's button, spoken: "Page 3". */
  page: (page: string) => string;
};

export type NumberedPagerProps = {
  /** This page, from 1. */
  page: number;
  /** The last page; null when it can't be said. */
  lastPage: number | null;
  /** Whether a next page holds rows. */
  hasNext: boolean;
  pageSize: number;
  pageSizes: readonly number[];
  /** The middle line, e.g. "Page 1 of 2 · 42 submittals". */
  summary?: string;
  labels: NumberedPagerLabels;
  /** Digits for the page numbers. */
  number: (n: number) => string;
  /** A page's URL. */
  hrefFor: (page: number) => string;
  onPageSize: (size: number) => void;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/** The page numbers the pager shows, with gaps where pages are left out. */
export function pageNumbers(page: number, lastPage: number | null, hasNext: boolean): (number | "gap")[] {
  const last = lastPage ?? (hasNext ? page + 1 : page);
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  if (lastPage === null) return [1, ...(page - 1 > 2 ? ["gap" as const] : [2]), ...[page - 1, page, ...(hasNext ? [page + 1] : [])].filter((p) => p > 2)];
  const from = Math.max(2, page - 1);
  const to = Math.min(last - 1, page + 1);
  const middle = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return [1, ...(from > 2 ? ["gap" as const] : []), ...middle, ...(to < last - 1 ? ["gap" as const] : []), last];
}

const box = "inline-flex h-[30px] min-w-[30px] items-center justify-center rounded-xs px-2 text-[13px] font-semibold pointer-coarse:min-h-11 pointer-coarse:min-w-11";
const idle = "bg-secondary text-on-secondary hover:bg-secondary-hover";

export function NumberedPager({ page, lastPage, hasNext, pageSize, pageSizes, summary, labels, number, hrefFor, onPageSize, linkAs: Link = "a" }: NumberedPagerProps) {
  const id = useId();
  const step = (to: number | null, label: string, icon: IconName) =>
    to === null ? (
      <span aria-disabled="true" title={label} className={cn(box, "bg-disabled text-on-disabled")}>
        <Icon name={icon} size={16} />
        <span className="sr-only">{label}</span>
      </span>
    ) : (
      <Link href={hrefFor(to)} title={label} className={cn(box, idle, focusRing)}>
        <Icon name={icon} size={16} />
        <span className="sr-only">{label}</span>
      </Link>
    );
  return (
    <nav aria-label={labels.pages} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle px-[14px] py-2.5 text-[13px] text-text-secondary">
      <span className="flex items-center gap-2.5">
        <label htmlFor={id}>{labels.rowsPerPage}</label>
        <select
          id={id}
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
          className={cn("h-[30px] rounded-xs border border-control-border bg-surface px-2 text-[13px] text-text pointer-coarse:min-h-11", focusRing)}
        >
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {number(size)}
            </option>
          ))}
        </select>
      </span>
      <span className="min-w-0 flex-1 text-center">{summary}</span>
      <span className="flex flex-wrap gap-1">
        {step(page > 1 ? 1 : null, labels.first, "chevrons-left")}
        {step(page > 1 ? page - 1 : null, labels.previous, "chevron-left")}
        {pageNumbers(page, lastPage, hasNext).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} aria-hidden="true" className={cn(box, "text-muted")}>
              …
            </span>
          ) : p === page ? (
            <span key={p} aria-current="page" className={cn(box, "bg-primary text-on-primary")}>
              <span className="sr-only">{labels.page(number(p))}</span>
              <span aria-hidden="true">{number(p)}</span>
            </span>
          ) : (
            <Link key={p} href={hrefFor(p)} aria-label={labels.page(number(p))} className={cn(box, idle, focusRing)}>
              {number(p)}
            </Link>
          ),
        )}
        {step(hasNext ? page + 1 : null, labels.next, "chevron-right")}
        {/* No last page under a search: nothing says how many there are. */}
        {lastPage !== null && step(page < lastPage ? lastPage : null, labels.last, "chevrons-right")}
      </span>
    </nav>
  );
}
