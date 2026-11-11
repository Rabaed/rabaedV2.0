import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";

// The pieces around a page inside AppShell: the title in the top bar, the band
// of tabs under it, and the content area. Presentational; the app fills them.

export type TopBarTitleProps = {
  /** The page's name, or the Project's name. Not the page's heading: the page keeps its own `h1`. */
  title: ReactNode;
  /** A line under it, e.g. the Project's Host Company. */
  subtitle?: ReactNode;
  /** A mark before the title, e.g. `ProjectMark`. */
  mark?: ReactNode;
  /** A link back up, e.g. from a Project to the Projects page: its target and accessible name. */
  back?: { href: string; label: string };
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/** The start of the top bar: where the Member is. Inside a Project: a back link, the Project's mark, its name and Host Company. */
export function TopBarTitle({ title, subtitle, mark, back, linkAs: Link = "a" }: TopBarTitleProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {back !== undefined && (
        <Link
          href={back.href}
          aria-label={back.label}
          title={back.label}
          className={cn(
            // On a phone too, 44 × 44 there (RP-1272).
            "inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-hover",
            "pointer-coarse:size-11 phone:size-11",
            focusRing,
          )}
        >
          {/* Points back: left in English, right in Arabic. */}
          <Icon name="arrow-left" />
        </Link>
      )}
      {mark}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-lg font-bold text-text">{title}</span>
        {subtitle !== undefined && <span className="truncate text-sm text-muted">{subtitle}</span>}
      </div>
    </div>
  );
}

/** A Project's mark: the first letter of its name on a tile. Decorative: the name is always beside it. Not on a phone, where the name needs the room. */
export function ProjectMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-project-mark=""
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary font-display text-h6 font-extrabold text-on-primary phone:hidden",
        className,
      )}
    >
      {Array.from(name.trim())[0] ?? ""}
    </span>
  );
}

/** The band under the top bar holding a page's tabs, e.g. `ProjectTabs`, edge to edge. */
export function TabsBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("shrink-0 border-b border-border bg-surface px-7 tablet:px-4", className)}>
      {/* The tabs' own bottom border sits on the band's. */}
      <div className="-mb-px">{children}</div>
    </div>
  );
}

/**
 * Classes that take an element out to the page's edges through `PageContent`'s side padding, keeping
 * that padding inside it, e.g. a board's canvas whose sideways scroll should reach the window's edge.
 */
export const pageBleed = "-mx-7 px-7 tablet:-mx-4 tablet:px-4";

/** `pageBleed` at 1024 and below only: out to the page's edges through its 16 px gutter there. */
export const tabletPageBleed = "tablet:-mx-4 tablet:px-4";

export type PageContentProps = {
  children: ReactNode;
  /**
   * A reading width for forms and text pages. By default the content takes the
   * whole width beside the sidebar, for tables and boards.
   */
  narrow?: boolean;
  className?: string;
};

/**
 * The page's content area inside AppShell: side padding (28 on a desktop, 16 on a tablet or phone,
 * RP-1272), full width unless `narrow`. Holding a board that fills the window (RP-1092), it passes
 * the board the rest of the window, with no bottom padding, so the board reaches the window's bottom edge.
 */
export function PageContent({ children, narrow = false, className }: PageContentProps) {
  return (
    <div
      data-page-content=""
      className={cn("flex min-w-0 flex-1 flex-col px-7 py-7 tablet:px-4 phone:py-6 fills-window:min-h-0 fills-window:pb-0", className)}
    >
      <div className={cn("w-full min-w-0 fills-window:flex fills-window:min-h-0 fills-window:flex-1 fills-window:flex-col", narrow && "max-w-3xl")}>{children}</div>
    </div>
  );
}
