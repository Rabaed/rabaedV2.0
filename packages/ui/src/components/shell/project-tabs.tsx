"use client";

import { moduleTabOrder, type ModuleKey } from "@rabaed/domain";
import { useEffect, useRef, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";

/** The Project tabs in the agreed order (design change requests, 2026-09-27): a Module's tab is its Module key. */
export const projectTabKeys = ["dashboard", ...moduleTabOrder, "activity", "settings"] as const;
export type ProjectTabKey = (typeof projectTabKeys)[number];

/**
 * The tabs a Project shows (RP-346, RP-406): Dashboard, Submittals, Activity and Settings always;
 * another Module's tab only when the Project has a Work Item Type in it. Never
 * an empty tab, and no placeholder for what isn't built.
 */
export function visibleProjectTabs(modules: readonly ModuleKey[]): ProjectTabKey[] {
  const shown = new Set<ProjectTabKey>(["dashboard", "submittals", "activity", "settings", ...modules]);
  return projectTabKeys.filter((key) => shown.has(key));
}

const tabClass = cn(
  "inline-flex h-13 shrink-0 items-center border-b-2 border-transparent text-body font-medium whitespace-nowrap",
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
  /** The Modules the Project has a Work Item Type in: each of them gets a tab. */
  modules: readonly ModuleKey[];
  /** Where each tab leads. */
  href: (key: ProjectTabKey) => string;
  /** The tab of the page being shown, if any. */
  current?: ProjectTabKey;
  /** The link component, e.g. Next.js `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
  className?: string;
};

/**
 * A Project's tabs, always in the agreed order: page navigation, so links in a
 * named `nav` rather than ARIA tabs. On a phone they scroll sideways, with the
 * current tab scrolled into view.
 */
export function ProjectTabs({ label, labels, modules, href, current, linkAs: Link = "a", className }: ProjectTabsProps) {
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
      <ul ref={listRef} className="flex gap-7 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {visibleProjectTabs(modules).map((key) => (
          <li key={key} className="flex shrink-0">
            <Link
              ref={key === current ? currentRef : undefined}
              href={href(key)}
              aria-current={key === current ? "page" : undefined}
              className={cn(tabClass, key === current ? "border-primary font-semibold text-brand-fg" : "text-muted hover:text-text")}
            >
              {labels[key]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
