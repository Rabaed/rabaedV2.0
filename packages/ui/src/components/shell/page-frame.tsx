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
            "hidden size-9 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-hover sm:inline-flex",
            "pointer-coarse:size-11",
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

/** A Project's mark: the first letter of its name on a tile. Decorative: the name is always beside it. */
export function ProjectMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "hidden size-10 shrink-0 items-center justify-center rounded-md bg-primary font-display text-h6 font-extrabold text-on-primary sm:inline-flex",
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
    <div className={cn("shrink-0 border-b border-border bg-surface px-4 sm:px-7", className)}>
      {/* The tabs' own bottom border sits on the band's. */}
      <div className="-mb-px">{children}</div>
    </div>
  );
}

export type PageContentProps = {
  children: ReactNode;
  /**
   * A reading width for forms and text pages. By default the content takes the
   * whole width beside the sidebar, for tables and boards.
   */
  narrow?: boolean;
  className?: string;
};

/** The page's content area inside AppShell: side padding, full width unless `narrow`. */
export function PageContent({ children, narrow = false, className }: PageContentProps) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col px-4 py-6 sm:px-7 sm:py-7", className)}>
      <div className={cn("w-full min-w-0", narrow && "max-w-3xl")}>{children}</div>
    </div>
  );
}
