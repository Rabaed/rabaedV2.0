import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { buttonVariants } from "../button/button.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";

// The table card and pager of a data list page (kit `list/list.css` `.tw`,
// `.pg`; RP-409).

export type TableCardProps = {
  /** A `Table`: its region loses its own border and corners inside the card. */
  children: ReactNode;
  /** The card's last row, e.g. `Pager`. */
  footer?: ReactNode;
  className?: string;
};

/**
 * A surface card holding a list's table and its footer. The table keeps its
 * named region, which scrolls sideways (and, with a height, down) on its own,
 * so the page never scrolls sideways.
 */
export function TableCard({ children, footer, className }: TableCardProps) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-border bg-surface",
        "[&>[role=region]]:rounded-none [&>[role=region]]:border-0",
        className,
      )}
    >
      {children}
      {footer}
    </div>
  );
}

export type PagerLabels = {
  /** Names the pager's navigation, e.g. "Pages". */
  pages: string;
  first: string;
  previous: string;
  next: string;
};

export type PagerProps = {
  labels: PagerLabels;
  /** The middle line, e.g. "Page 2 of 5 · 230 items". Omit when nothing honest can be said. */
  summary?: ReactNode;
  /** Each page's URL; undefined where there is none (on the first page, after the last). */
  first?: string;
  previous?: string;
  next?: string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/**
 * First / Previous / Next for a list read a page at a time, with an optional
 * summary between. A page with no link is shown but not a link.
 */
export function Pager({ labels, summary, first, previous, next, linkAs: Link = "a" }: PagerProps) {
  const step = (href: string | undefined, label: string, icon: IconName, iconAfter = false) => {
    const content = (
      <>
        {!iconAfter && <Icon name={icon} size={16} />}
        <span className="max-sm:sr-only">{label}</span>
        {iconAfter && <Icon name={icon} size={16} />}
      </>
    );
    const className = cn(buttonVariants({ variant: "secondary", size: "sm" }), "px-2.5 pointer-coarse:min-w-11");
    return href === undefined ? (
      <span aria-disabled="true" className={className}>
        {content}
      </span>
    ) : (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  };
  return (
    <nav aria-label={labels.pages} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle px-4 py-2.5 text-sm text-text-secondary">
      <span className="min-w-0 flex-1">{summary}</span>
      <span className="flex gap-1">
        {step(first, labels.first, "chevrons-left")}
        {step(previous, labels.previous, "chevron-left")}
        {step(next, labels.next, "chevron-right", true)}
      </span>
    </nav>
  );
}
