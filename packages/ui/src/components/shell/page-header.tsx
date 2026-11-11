"use client";

import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { useMediaQuery } from "../../lib/use-media-query.ts";
import { PHONE } from "../../lib/widths.ts";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { BottomSheetContent, Sheet, SheetTrigger } from "../overlay/sheet.tsx";
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
  // On a phone the other actions live only in the ⋯ sheet: mounted once, so a dialog they open isn't doubled.
  const folded = useMediaQuery(PHONE, false) && actions !== undefined && more !== undefined;
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
          // Empty on a phone when the primary action has gone to the bottom bar.
          <div className="flex shrink-0 flex-wrap gap-2 empty:hidden">
            {folded && more ? (
              <MoreActions label={more.label} closeLabel={more.closeLabel}>
                {actions}
              </MoreActions>
            ) : (
              actions
            )}
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
        <IconButton label={label} variant="secondary">
          <Icon name="dots" />
        </IconButton>
      </SheetTrigger>
      <BottomSheetContent
        title={label}
        closeLabel={closeLabel}
      >
        <div className="flex flex-col gap-2 [&>*]:w-full">{children}</div>
      </BottomSheetContent>
    </Sheet>
  );
}
