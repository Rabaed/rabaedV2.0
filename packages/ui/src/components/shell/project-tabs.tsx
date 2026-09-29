"use client";

import { useEffect, useId, useRef, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Tooltip } from "../overlay/tooltip.tsx";

/** The Project tabs in the agreed order (design change requests, 2026-09-27). */
export const projectTabKeys = [
  "dashboard",
  "submittals",
  "inspections",
  "snag-list",
  "site-reports",
  "drawings",
  "files",
  "views",
  "schedule",
  "settings",
] as const;
export type ProjectTabKey = (typeof projectTabKeys)[number];

/** Tabs that aren't built yet: shown greyed out, with the Coming soon hint. */
const comingSoon: ReadonlySet<ProjectTabKey> = new Set<ProjectTabKey>(["schedule"]);

const tabClass = cn(
  "inline-flex h-12 shrink-0 items-center border-b-2 border-transparent text-body font-medium whitespace-nowrap",
  // Touch targets of at least 44px on phones (gloved hands on site).
  "pointer-coarse:min-w-11",
  focusRing,
  // Inside the scrolling bar, where an outside ring would be clipped.
  "focus-visible:-outline-offset-2",
);

export type ProjectTabsProps = {
  /** Names the navigation, e.g. "Project". */
  label: string;
  /** Every tab's name in the viewer's language. */
  labels: Record<ProjectTabKey, string>;
  /** Where each tab leads. */
  href: (key: ProjectTabKey) => string;
  /** The tab of the page being shown. */
  current: ProjectTabKey;
  /** The hint on tabs that aren't built yet, e.g. "Coming soon". */
  comingSoonLabel: string;
  /** The link component, e.g. Next.js `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
  className?: string;
};

/**
 * A Project's tabs, always in the agreed order: page navigation, so links in a
 * named `nav` rather than ARIA tabs. On a phone they scroll sideways, with the
 * current tab scrolled into view.
 */
export function ProjectTabs({ label, labels, href, current, comingSoonLabel, linkAs: Link = "a", className }: ProjectTabsProps) {
  const hintId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const currentRef = useRef<HTMLElement>(null);
  // Scroll the current tab into view sideways only; scrollIntoView could scroll the page too.
  useEffect(() => {
    const list = listRef.current;
    const tab = currentRef.current?.getBoundingClientRect();
    if (!list || !tab) return;
    const box = list.getBoundingClientRect();
    if (tab.right > box.right) list.scrollBy({ left: tab.right - box.right });
    else if (tab.left < box.left) list.scrollBy({ left: tab.left - box.left });
  }, [current]);

  return (
    <nav aria-label={label} className={className}>
      <span id={hintId} hidden>
        {comingSoonLabel}
      </span>
      <ul ref={listRef} className="flex gap-7 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {projectTabKeys.map((key) => (
          <li key={key} className="flex shrink-0">
            {comingSoon.has(key) ? (
              <Tooltip content={comingSoonLabel} side="bottom">
                {/* Announced as a link that is unavailable; it has nowhere to go yet. */}
                <a
                  role="link"
                  aria-disabled="true"
                  // The hint as a description at all times, not only while the tooltip is open.
                  aria-describedby={hintId}
                  tabIndex={0}
                  className={cn(tabClass, "cursor-not-allowed text-on-disabled")}
                >
                  {labels[key]}
                </a>
              </Tooltip>
            ) : (
              <Link
                ref={key === current ? currentRef : undefined}
                href={href(key)}
                aria-current={key === current ? "page" : undefined}
                className={cn(
                  tabClass,
                  key === current ? "border-primary font-semibold text-primary" : "text-muted hover:text-text",
                )}
              >
                {labels[key]}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
