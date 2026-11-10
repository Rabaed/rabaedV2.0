"use client";

import { moduleTabOrder, type ModuleKey } from "@rabaed/domain";
import { useEffect, useRef, useState, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";

/**
 * The Project tabs in the kit's order (RP-1142, owner 2026-11-08): a Module's tab is its Module key. The Activity Feed
 * has no tab: it is a panel in the Dashboard, whose "View all" opens its page (GLOSSARY.md › Module).
 */
export const projectTabKeys = ["dashboard", ...moduleTabOrder, "settings"] as const;
export type ProjectTabKey = (typeof projectTabKeys)[number];

/**
 * The tabs a Project shows (RP-346, RP-406, RP-1142): Dashboard, Submittals and Settings always;
 * another Module's tab only when the Project has a Work Item Type in it. Never
 * an empty tab, and no placeholder for what isn't built.
 */
export function visibleProjectTabs(modules: readonly ModuleKey[]): ProjectTabKey[] {
  const shown = new Set<ProjectTabKey>(["dashboard", "submittals", "settings", ...modules]);
  return projectTabKeys.filter((key) => shown.has(key));
}

const tabClass = cn(
  // 52 high, 46 on a phone (RP-1272).
  "inline-flex h-13 shrink-0 items-center border-b-2 border-transparent text-body font-medium whitespace-nowrap phone:h-11.5",
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
 * named `nav` rather than ARIA tabs. Where they don't fit they scroll sideways,
 * snapping per tab, with the current tab scrolled into view and a fade at the
 * row's end while more tabs are hidden there (RP-1272).
 */
export function ProjectTabs({ label, labels, modules, href, current, linkAs: Link = "a", className }: ProjectTabsProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const currentRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  // More tabs hidden at the end: in Arabic scrollLeft runs from 0 towards negative, so measure its size.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => setMore(list.scrollWidth - list.clientWidth - Math.abs(list.scrollLeft) > 1);
    update();
    list.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    // The tabs too: their width changes without the row's when a font arrives late.
    for (const item of [list, ...list.children]) resize.observe(item);
    return () => {
      list.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [modules]);
  // Scroll the current tab into view sideways only; scrollIntoView could scroll the page too.
  useEffect(() => {
    const list = listRef.current;
    const tab = currentRef.current?.getBoundingClientRect();
    if (!list || !tab) return;
    const box = list.getBoundingClientRect();
    if (tab.left >= box.left - 1 && tab.right <= box.right + 1) return;
    // To the tab's start edge, where it snaps (the right edge in Arabic); a snap point between would pull it back half out of view.
    if (getComputedStyle(list).direction === "rtl") list.scrollBy({ left: tab.right - box.right });
    else list.scrollBy({ left: tab.left - box.left });
  }, [current]);

  return (
    <nav aria-label={label} className={cn("relative", className)}>
      <ul ref={listRef} className="flex snap-x snap-mandatory gap-7 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {visibleProjectTabs(modules).map((key) => (
          <li key={key} className="flex shrink-0 snap-start">
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
      {/* The row's end: the right in English, the left in Arabic. */}
      {more && (
        <span
          data-fade=""
          aria-hidden="true"
          className="pointer-events-none absolute top-0 end-0 bottom-px w-10 bg-linear-to-l from-surface to-transparent rtl:bg-linear-to-r"
        />
      )}
    </nav>
  );
}
