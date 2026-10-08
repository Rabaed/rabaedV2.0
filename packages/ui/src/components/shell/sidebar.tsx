"use client";

import { useState, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { Tooltip } from "../overlay/tooltip.tsx";

export type SidebarItem = {
  key: string;
  label: string;
  icon: IconName;
  href: string;
  /** A count after the label, formatted by the caller (`formatNumber`). */
  count?: ReactNode;
};

export type SidebarSection = {
  /** A heading over the items, e.g. "My Company". */
  label?: string;
  items: SidebarItem[];
};

export type SidebarNavProps = {
  /** Names the navigation, e.g. "Main". */
  label: string;
  sections: SidebarSection[];
  /** The key of the item for the page being shown. */
  current?: string;
  /** The link component, e.g. Next.js `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
  /** Called when an item is chosen, e.g. to close the phone sheet. */
  onNavigate?: () => void;
  /** Icons only, each name in a tooltip; Sidebar sets it. */
  collapsed?: boolean;
};

/** The navigation list itself: shared by the desktop sidebar and the phone sheet. */
export function SidebarNav({ label, sections, current, linkAs: Link = "a", onNavigate, collapsed = false }: SidebarNavProps) {
  return (
    <nav aria-label={label} className="flex flex-col gap-4">
      {sections.map((section, i) => (
        // A line between sections, as in the design.
        <div key={section.label ?? i} className={cn("flex flex-col gap-1", i > 0 && "border-t border-border pt-4")}>
          {section.label !== undefined && !collapsed && (
            <h2 className="px-3 pb-1 text-notes font-bold text-muted uppercase ltr:tracking-wider rtl:text-caption">{section.label}</h2>
          )}
          {/* Named after its section, so the grouping survives when the heading is hidden. */}
          <ul aria-label={section.label} className="flex flex-col gap-1">
            {section.items.map((item) => {
              const isCurrent = item.key === current;
              const link = (
                <Link
                  href={item.href}
                  aria-current={isCurrent ? "page" : undefined}
                  // Collapsed, the label is hidden; name the link after it. The tooltip shows the same
                  // name, so don't let it also become the description (it would be read twice).
                  aria-label={collapsed ? item.label : undefined}
                  aria-describedby={undefined}
                  onClick={onNavigate}
                  className={cn(
                    "relative flex h-11 items-center gap-3 rounded-sm px-3 text-body font-medium",
                    focusRing,
                    isCurrent
                      ? // The current page: tinted, with an accent bar on the sidebar's inline-start edge.
                        "bg-brand-tint font-semibold text-brand-fg before:absolute before:inset-y-2 before:-start-3 before:w-0.75 before:rounded-e-xs before:bg-brand"
                      : "text-text-secondary hover:bg-hover",
                    collapsed && "justify-center px-0 before:-start-2",
                  )}
                >
                  <Icon name={item.icon} className={isCurrent ? undefined : "text-muted"} />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                  {!collapsed && item.count !== undefined && (
                    <span className="rounded-full bg-neutral-tint px-2 text-caption font-semibold text-neutral-fg">
                      {/* A space, so the name reads "Projects 3", not "Projects3". */}
                      <span className="sr-only"> </span>
                      {item.count}
                    </span>
                  )}
                </Link>
              );
              return (
                <li key={item.key}>
                  {collapsed ? (
                    // Towards the page: the sidebar is on the start side.
                    <Tooltip content={item.label} side="end">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export type SidebarProps = SidebarNavProps & {
  /** The block at the top: the logo, the product name and the Member's Company, e.g. `SidebarBrand`. */
  brand: ReactNode;
  /** The brand when collapsed, e.g. the logo mark only. */
  brandCollapsed?: ReactNode;
  /**
   * The block at the bottom, beside the collapse button: the signed-in Member,
   * e.g. a `MemberMenu` with `placement="sidebar"`. A function gets whether the
   * sidebar is collapsed.
   */
  footer?: ReactNode | ((collapsed: boolean) => ReactNode);
  /** The collapse button's accessible names, e.g. "Collapse sidebar" / "Expand sidebar". */
  collapseLabel: string;
  expandLabel: string;
  /** Start collapsed, e.g. from a saved preference. */
  defaultCollapsed?: boolean;
  /** Called when the sidebar collapses or expands, e.g. to save the preference. */
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
};

/**
 * The app's sidebar, on the inline-start side (the right in Arabic), full
 * height: the brand at the top, the navigation, and the signed-in Member with
 * the collapse button at the bottom. It collapses to an icon rail with that
 * button, by mouse or keyboard; collapsed, each item shows its name in a tooltip.
 */
export function Sidebar({
  brand,
  brandCollapsed,
  footer,
  collapseLabel,
  expandLabel,
  defaultCollapsed = false,
  onCollapsedChange,
  className,
  ...nav
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggle = () => {
    setCollapsed(!collapsed);
    onCollapsedChange?.(!collapsed);
  };
  const label = collapsed ? expandLabel : collapseLabel;
  return (
    // Not an <aside>: the nav inside is the landmark.
    <div
      data-sidebar=""
      data-collapsed={collapsed || undefined}
      className={cn(
        // The column runs the page's full height; its contents stay in view as the page scrolls.
        "flex shrink-0 flex-col border-e border-border bg-surface",
        "transition-[width] duration-200 motion-reduce:transition-none",
        collapsed ? "w-18" : "w-66",
        className,
      )}
    >
      <div className="sticky top-0 flex h-dvh flex-col">
        <div className={cn("flex h-18 shrink-0 items-center border-b border-border", collapsed ? "justify-center px-2" : "px-4")}>
          {collapsed ? brandCollapsed : <div className="min-w-0 flex-1">{brand}</div>}
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
          <SidebarNav {...nav} collapsed={collapsed} />
        </div>
        <div className={cn("flex shrink-0 items-center gap-2 border-t border-border p-3", collapsed && "flex-col")}>
          {footer !== undefined && <div className="min-w-0 flex-1">{typeof footer === "function" ? footer(collapsed) : footer}</div>}
          <button
            type="button"
            aria-label={label}
            title={label}
            aria-expanded={!collapsed}
            onClick={toggle}
            className={cn(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary text-on-primary hover:bg-primary-hover",
              "pointer-coarse:size-11",
              focusRing,
            )}
          >
            {/* Points to the sidebar's edge to collapse, away from it to expand; mirrored in Arabic. */}
            <Icon name={collapsed ? "chevron-right" : "chevron-left"} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Rabaed logo mark, in the current text colour. */
export function RabaedMark({ className }: { className?: string }) {
  return (
    <svg viewBox="175.5 115 56 50.5" aria-hidden="true" focusable="false" className={className} fill="currentColor">
      <g transform="matrix(1,0,0,-1,0,278.13) translate(200.551,114.215)">
        <path d="M 22.588 23.458 L 24.51 21.736 C 27.51 19.049 29.195 15.405 29.195 11.605 L 29.195 0 L 5.031 21.645 C 5.311 22.5 5.565 23.356 5.786 24.223 C 5.966 24.9 6.126 25.582 6.267 26.264 C 6.908 29.25 7.214 32.322 6.634 35.342 C 6.354 36.784 5.879 38.203 5.191 39.584 C 5.125 39.728 5.051 39.878 4.971 40.022 C 3.668 42.475 1.918 44.701 0 46.802 L 29.195 46.802 L 17.344 36.186 L 12.867 32.17 L 14.618 30.602 L 22.588 23.458 Z" />
      </g>
      <g transform="matrix(1,0,0,-1,0,278.13) translate(177.496,114.215)">
        <path d="M 23.96 23.78 C 22.572 27.916 19.518 31.368 16.374 34.555 C 14.784 36.168 17.037 40.225 17.61 41.969 C 17.712 42.279 18.842 44.91 19.824 46.805 L 0 46.805 L 0 0 L 23.095 20.684 C 23.996 21.495 24.328 22.684 23.96 23.78 Z" />
      </g>
    </svg>
  );
}

/** The logo on its tile, as at the top of the sidebar. */
export function RabaedLogoTile({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-sm bg-brand text-on-primary", className)}>
      <RabaedMark className="size-6" />
    </span>
  );
}

export type SidebarBrandProps = {
  /** The product name, e.g. "Rabaed". */
  name: string;
  /** The signed-in Member's Company: shown under the name, never a switcher. */
  companyName?: string;
};

/** The top of the sidebar: the logo tile, the product name and the Member's Company. */
export function SidebarBrand({ name, companyName }: SidebarBrandProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <RabaedLogoTile />
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-display text-body font-bold text-text">{name}</span>
        {companyName !== undefined && <span className="truncate text-caption text-muted">{companyName}</span>}
      </div>
    </div>
  );
}
