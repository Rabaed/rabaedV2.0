"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { toneClasses } from "../data/tone.ts";
import { Icon, type IconName } from "../icon/icon.tsx";

/**
 * Tabs over one area of a page, following the ARIA tabs pattern: arrow keys
 * move along the reading direction (they flip in Arabic, via DirectionProvider),
 * Home and End jump to the ends, and selecting a tab shows its panel.
 */
export const Tabs = TabsPrimitive.Root;

export type TabsListProps = ComponentProps<typeof TabsPrimitive.List> & {
  /** Names the set of tabs, e.g. "Project". */
  "aria-label": string;
};

/** The tab bar, underlined; it scrolls sideways when the tabs don't fit. */
export function TabsList({ className, ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      className={cn("flex gap-7 overflow-x-auto border-b border-border [scrollbar-width:none]", className)}
      {...props}
    />
  );
}

export type TabsTriggerProps = ComponentProps<typeof TabsPrimitive.Trigger> & {
  icon?: IconName;
  /** A count after the label, formatted by the caller (`formatNumber`); read as part of the tab's name. */
  count?: ReactNode;
};

/** One tab; the selected one is primary with an underline. */
export function TabsTrigger({ icon, count, className, children, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "group inline-flex h-12 shrink-0 items-center gap-2 border-b-2 border-transparent text-body font-medium whitespace-nowrap text-muted",
        "hover:text-text",
        "data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:text-primary",
        "disabled:cursor-not-allowed disabled:text-on-disabled disabled:hover:text-on-disabled",
        // Touch targets of at least 44px on phones (gloved hands on site).
        "pointer-coarse:min-w-11",
        focusRing,
        // Inside the scrolling bar, where an outside ring would be clipped.
        "focus-visible:-outline-offset-2",
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full px-2 text-caption font-semibold",
            toneClasses.neutral,
            // The brand tone on the selected tab.
            "group-data-[state=active]:bg-brand-tint group-data-[state=active]:text-brand-fg",
          )}
        >
          {/* A space, so the name reads "Submittals 231", not "Submittals231". */}
          <span className="sr-only"> </span>
          {count}
        </span>
      )}
    </TabsPrimitive.Trigger>
  );
}

/** The panel for one tab, labelled by it. Focusable, so keyboard users can reach content without controls. */
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("rounded-xs", focusRing, className)} {...props} />;
}
