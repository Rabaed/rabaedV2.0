"use client";

import { useDirection } from "@radix-ui/react-direction";
import { useState, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
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
  // Tooltips open towards the page: to the right of a left-hand sidebar, to the left in Arabic.
  const side = useDirection() === "rtl" ? "left" : "right";
  return (
    <nav aria-label={label} className="flex flex-col gap-4">
      {sections.map((section, i) => (
        <div key={section.label ?? i} className="flex flex-col gap-1">
          {section.label !== undefined &&
            (collapsed ? (
              <hr className="mx-2 border-border" />
            ) : (
              <h2 className="px-3 pb-1 text-notes font-semibold text-muted">{section.label}</h2>
            ))}
          {/* Named after its section, so the grouping survives when the heading collapses to a line. */}
          <ul aria-label={section.label} className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const link = (
                <Link
                  href={item.href}
                  aria-current={item.key === current ? "page" : undefined}
                  // Collapsed, the label is hidden; name the link after it. The tooltip shows the same
                  // name, so don't let it also become the description (it would be read twice).
                  aria-label={collapsed ? item.label : undefined}
                  aria-describedby={undefined}
                  onClick={onNavigate}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-sm px-3 text-body font-medium",
                    "pointer-coarse:min-h-11",
                    focusRing,
                    item.key === current ? "bg-brand-tint text-brand-fg" : "text-text-secondary hover:bg-hover",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon name={item.icon} />
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
                    <Tooltip content={item.label} side={side}>
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
  /** The logo or product name at the top. */
  brand: ReactNode;
  /** The brand when collapsed, e.g. the logo mark only. Without it, the collapsed sidebar shows the toggle only. */
  brandCollapsed?: ReactNode;
  /** The toggle's accessible names, e.g. "Collapse sidebar" / "Expand sidebar". */
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
 * height. It collapses to icons with a button, by mouse or keyboard; collapsed,
 * each item shows its name in a tooltip.
 */
export function Sidebar({
  brand,
  brandCollapsed,
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
  return (
    // Not an <aside>: the nav inside is the landmark.
    <div
      data-sidebar=""
      data-collapsed={collapsed || undefined}
      className={cn(
        "sticky top-0 flex h-dvh shrink-0 flex-col gap-4 overflow-y-auto border-e border-border bg-surface p-3",
        "transition-[width] duration-200 motion-reduce:transition-none",
        collapsed ? "w-16 items-stretch px-2" : "w-60",
        className,
      )}
    >
      <div className={cn("flex h-10 items-center gap-2", collapsed ? "flex-col justify-center" : "justify-between ps-3")}>
        {!collapsed && <div className="min-w-0 truncate font-display text-h6 font-semibold text-text">{brand}</div>}
        {collapsed && brandCollapsed}
        <IconButton label={collapsed ? expandLabel : collapseLabel} size="sm" aria-expanded={!collapsed} onClick={toggle}>
          <Icon name={collapsed ? "chevrons-right" : "chevrons-left"} />
        </IconButton>
      </div>
      <SidebarNav {...nav} collapsed={collapsed} />
    </div>
  );
}
