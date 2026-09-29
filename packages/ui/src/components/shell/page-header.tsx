import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export type PageHeaderProps = {
  /** The page's heading (its one `h1`), e.g. the Project's name. */
  title: ReactNode;
  /** A line above the title, e.g. the Project Number or a breadcrumb. */
  eyebrow?: ReactNode;
  /** A line under the title. */
  description?: ReactNode;
  /** Buttons at the end of the title row. */
  actions?: ReactNode;
  /** Tabs under the title, e.g. `ProjectTabs`. */
  tabs?: ReactNode;
  className?: string;
};

/** The top of a page: its title, optional actions, and tabs underneath. */
export function PageHeader({ title, eyebrow, description, actions, tabs, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4 border-b border-border bg-surface px-4 pt-5 sm:px-6", !tabs && "pb-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow !== undefined && <div className="text-caption text-muted">{eyebrow}</div>}
          <h1 className="font-display text-h3 font-semibold text-text">{title}</h1>
          {description !== undefined && <p className="text-body text-muted">{description}</p>}
        </div>
        {actions !== undefined && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {/* The tabs' own bottom border sits on the header's. */}
      {tabs !== undefined && <div className="-mb-px">{tabs}</div>}
    </header>
  );
}
