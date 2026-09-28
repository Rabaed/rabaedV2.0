"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";

export type TableProps = ComponentProps<"table"> & {
  /** Names the table (a hidden caption) and its scrolling region, e.g. "Submittals". */
  label: string;
  /** Keep the header row in view while the rows scroll. Give the region a height (`containerClassName="max-h-96"`). */
  stickyHeader?: boolean;
  /** Classes for the scrolling region around the table, e.g. its maximum height. */
  containerClassName?: string;
};

/**
 * A data table with real table semantics (table, row, column header, cell),
 * inside a named region that scrolls when the table is wider or taller than
 * its space. While it scrolls, the region takes keyboard focus so it can be
 * scrolled without a mouse; controls in the table (sort buttons, checkboxes,
 * links) follow in Tab order. Columns run in the reading direction, so they mirror in Arabic.
 */
export function Table({ label, stickyHeader = false, containerClassName, className, children, ...props }: TableProps) {
  const region = useRef<HTMLDivElement>(null);
  const scrollable = useScrollable(region);
  return (
    <div
      ref={region}
      role="region"
      aria-label={label}
      // A tab stop only where there is something to scroll.
      tabIndex={scrollable ? 0 : undefined}
      data-sticky-header={stickyHeader || undefined}
      className={cn("group/table overflow-auto rounded-sm border border-border bg-surface", focusRing, containerClassName)}
    >
      <table className={cn("w-full border-separate border-spacing-0 text-body text-text", className)} {...props}>
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

/** Whether the element's content overflows it, kept up to date as either resizes. */
function useScrollable(ref: RefObject<HTMLElement | null>) {
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setScrollable(element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [ref]);
  return scrollable;
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      className={cn("bg-surface-subtle group-data-sticky-header/table:sticky group-data-sticky-header/table:top-0 group-data-sticky-header/table:z-10", className)}
      {...props}
    />
  );
}

export function TableBody(props: ComponentProps<"tbody">) {
  return <tbody {...props} />;
}

export type TableRowProps = ComponentProps<"tr"> & {
  /** Highlights the row. Say so to assistive tech with a checked checkbox in the row, too. */
  selected?: boolean;
};

export function TableRow({ selected = false, className, ...props }: TableRowProps) {
  return (
    <tr
      data-selected={selected || undefined}
      className={cn("[tbody_&]:hover:bg-hover data-selected:bg-brand-tint [tbody_&]:data-selected:hover:bg-brand-tint", className)}
      {...props}
    />
  );
}

type Align = "start" | "center" | "end";
const alignClass: Record<Align, string> = { start: "text-start", center: "text-center", end: "text-end" };

type AlignProp = {
  /** `end` for numbers, so they line up; it mirrors in Arabic. */
  align?: Align;
};

export type TableSort = "ascending" | "descending" | "none";

export type TableHeadProps = Omit<ComponentProps<"th">, "align"> & AlignProp & {
  /**
   * Makes the column sortable: the header becomes a button, and `aria-sort`
   * tells screen readers the column's current order. `none` when the table is
   * sorted by another column.
   */
  sort?: TableSort;
  /** Called when the sort button is pressed; the caller decides the next order. */
  onSort?: () => void;
};

const sortIcon = { ascending: "arrow-up", descending: "arrow-down", none: "arrows-sort" } as const;

/** A column header. Sortable when given `sort` and `onSort`. */
export function TableHead({ align = "start", sort, onSort, className, children, ...props }: TableHeadProps) {
  const sortable = sort !== undefined && onSort !== undefined;
  return (
    <th
      scope="col"
      aria-sort={sortable ? sort : undefined}
      className={cn(
        "h-10 border-b border-border px-3 text-caption pointer-coarse:h-12 font-semibold whitespace-nowrap text-muted",
        alignClass[align],
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "-mx-1 inline-flex items-center gap-1 rounded-xs px-1 py-0.5 font-semibold hover:text-text",
            "pointer-coarse:min-h-11 pointer-coarse:min-w-11",
            sort !== "none" && "text-text",
            focusRing,
          )}
        >
          {children}
          <Icon name={sortIcon[sort]} size={14} className={cn(sort === "none" && "text-faint")} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export type TableCellProps = Omit<ComponentProps<"td">, "align"> & AlignProp;

export function TableCell({ align = "start", className, ...props }: TableCellProps) {
  return (
    <td
      className={cn(
        "h-12 border-b border-border-subtle px-3 align-middle [tr:last-child>&]:border-b-0",
        align === "end" && "tabular-nums",
        alignClass[align],
        className,
      )}
      {...props}
    />
  );
}

export type TableEmptyProps = {
  /** The number of columns, so the message spans the whole table. */
  colSpan: number;
  /** Usually an EmptyState: what the table would show and how to add the first one. */
  children: ReactNode;
};

/** The one row a table with no rows shows, spanning every column. */
export function TableEmpty({ colSpan, children }: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}
