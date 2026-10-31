"use client";

import type { Locale } from "@rabaed/domain";
import { forwardRef, type ComponentProps, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";

export type WorkItemPageFrameProps = {
  locale: Locale;
  /** Back to the item's list, by its Module's name ("Submittals"). */
  back: { href: string; label: string };
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  /** The item's number in the crumb (a `DocNo`), or what a Draft says instead. */
  crumb: ReactNode;
  /** The top bar's buttons: Watch, View workflow, the Record or Working Copy. */
  topBarEnd?: ReactNode;
  identity?: ReactNode;
  route?: ReactNode;
  facts?: ReactNode;
  /** Under the facts: The Issued Code card, the in-flow Actions card below 880px, notices. */
  lead?: ReactNode;
  /** The tabs and what they hold. */
  children?: ReactNode;
  /** Names the rail. */
  railLabel: string;
  /** The rail from 880px: Actions, Workflow, History. */
  rail?: ReactNode;
  /**
   * The bar at the bottom: while editing, the saved time and Save Draft at every width (`start`);
   * the Transitions under 880px only, where the rail is hidden. None when it holds neither.
   */
  bar?: { label: string; start?: ReactNode; transitions?: ReactNode };
  className?: string;
};

/**
 * The Work Item page's frame (RP-1151, gap table rows 1–2, 28, 66–68): the Submittal Panel at page
 * size. A top bar (back to the list, the number, Watch and View workflow), a body that scrolls in
 * the page's own height (it fills the window, `data-fills-window`), the main column and, from
 * 880px, the rail; and a bar at the bottom. It is a `@container/sdp`, so the panel's own bands lay
 * it out (`submittal-panel.css`, `work-item-page.css`), by the page's width, not the window's.
 */
export function WorkItemPageFrame({ locale, back, linkAs: Link = "a", crumb, topBarEnd, identity, route, facts, lead, children, railLabel, rail, bar, className }: WorkItemPageFrameProps) {
  const transitionsOnly = bar !== undefined && !bar.start;
  return (
    <div
      data-fills-window=""
      className={cn(
        "wip @container/sdp flex min-h-0 min-w-0 flex-1 flex-col bg-surface text-text",
        // Edge to edge inside the shell's content area, as the design's page is.
        "-mx-4 -mt-6 sm:-mx-7 sm:-mt-7",
        className,
      )}
    >
      <div className="sdp-top flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-subtle ps-2.5 pe-3">
        <Link href={back.href} className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-semibold text-text hover:bg-hover", focusRing)}>
          <Icon name={locale === "ar" ? "arrow-right" : "arrow-left"} size={16} />
          <span className="wip-label">{back.label}</span>
        </Link>
        <p className="me-auto flex min-w-0 items-center gap-1.5 text-[12.5px] font-bold">
          <Icon name={locale === "ar" ? "chevron-left" : "chevron-right"} size={15} className="wip-label shrink-0 text-muted" />
          <span className="truncate">{crumb}</span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">{topBarEnd}</div>
      </div>
      <div className="sdp-body min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="sdp-layout flex min-w-0">
          <div className="sdp-main min-w-0 flex-1 pb-6">
            {identity}
            {route}
            {facts}
            {lead}
            {children}
          </div>
          <aside aria-label={railLabel} className="sdp-rail">
            {rail}
          </aside>
        </div>
      </div>
      {bar && (bar.start || bar.transitions) && (
        <section aria-label={bar.label} className={cn("wip-bar flex shrink-0 items-center gap-2 border-t border-border-subtle bg-surface px-4 py-3", transitionsOnly && "wip-narrow")}>
          {bar.start}
          <span className="flex-1" />
          {bar.transitions && <div className="wip-transitions wip-narrow flex flex-wrap justify-end gap-2">{bar.transitions}</div>}
        </section>
      )}
    </div>
  );
}

/** A top-bar button: its icon, and its label beside it, or by its icon only under 560px (still its name). */
export const WorkItemTopBarButton = forwardRef<HTMLButtonElement, { icon: IconName; label: string; on?: boolean } & Omit<ComponentProps<typeof Button>, "children">>(
  function WorkItemTopBarButton({ icon, label, on = false, className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        variant="secondary"
        size="sm"
        className={cn("gap-1.5", on && "bg-brand-tint text-brand-fg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_35%,transparent)]", className)}
        {...props}
      >
        <Icon name={icon} size={16} />
        <span className="wip-label">{label}</span>
      </Button>
    );
  },
);
