"use client";

import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { ModalContent } from "../overlay/modal.tsx";
import { Sheet, SheetTrigger } from "../overlay/sheet.tsx";
import { PrimaryAction } from "./action-bar.tsx";

export type PageHeaderProps = {
  /** The page's heading (its one `h1`), e.g. the Project's name. */
  title: ReactNode;
  /** A line above the title, e.g. the Project Number or a breadcrumb. */
  eyebrow?: ReactNode;
  /** A line under the title. */
  description?: ReactNode;
  /** The page's one primary action, at the end of the title row; on a phone in AppShell's bottom bar (RP-1272). */
  primaryAction?: ReactNode;
  /** The other buttons, at the end of the title row; on a phone behind ⋯ when `more` is given. */
  actions?: ReactNode;
  /** The ⋯ button's name, e.g. "More actions", and its sheet's close button's: on a phone `actions` open from it in a bottom sheet. */
  more?: { label: string; closeLabel: string };
  /** Tabs under the title, e.g. `ProjectTabs`. */
  tabs?: ReactNode;
  className?: string;
};

/**
 * The top of a page: its title, its actions, and tabs underneath. On a phone the title steps down to 20 and
 * the actions move out of the title row: the primary one to the bottom bar, the rest behind ⋯ (RP-1272).
 */
export function PageHeader({ title, eyebrow, description, primaryAction, actions, more, tabs, className }: PageHeaderProps) {
  const folded = actions !== undefined && more !== undefined;
  return (
    // A div, not <header>: the TopBar is the page's one banner.
    <div data-page-header="" className={cn("flex flex-col gap-4 border-b border-border bg-surface px-4 pt-5 sm:px-6", !tabs && "pb-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow !== undefined && <div className="text-caption text-muted">{eyebrow}</div>}
          <h1 className="font-display text-h3 font-semibold text-text phone:text-h5">{title}</h1>
          {description !== undefined && <p className="text-body text-muted">{description}</p>}
        </div>
        {(actions !== undefined || primaryAction !== undefined) && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {actions !== undefined && <div className={cn("flex flex-wrap gap-2", folded && "phone:hidden")}>{actions}</div>}
            {folded && <MoreActions label={more.label} closeLabel={more.closeLabel}>{actions}</MoreActions>}
            {primaryAction !== undefined && <PrimaryAction>{primaryAction}</PrimaryAction>}
          </div>
        )}
      </div>
      {/* The tabs' own bottom border sits on the header's. */}
      {tabs !== undefined && <div className="-mb-px">{tabs}</div>}
    </div>
  );
}

/** On a phone only: ⋯, opening the page's other actions in a sheet from the bottom of the screen. */
function MoreActions({ label, closeLabel, children }: { label: string; closeLabel: string; children: ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <IconButton label={label} variant="secondary" className="hidden phone:inline-flex">
          <Icon name="dots" />
        </IconButton>
      </SheetTrigger>
      <ModalContent
        title={label}
        closeLabel={closeLabel}
        // eslint-disable-next-line rabaed/no-avoid-terms -- CSS env() name
        className="inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[20px] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex flex-col gap-2 [&>*]:w-full">{children}</div>
      </ModalContent>
    </Sheet>
  );
}
