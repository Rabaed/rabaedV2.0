"use client";

import { directionOf, formatNumber, type Locale } from "@rabaed/domain";
import type { ReactNode } from "react";
import type { IconName } from "../icon/icon.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../navigation/tabs.tsx";

export type SubmittalPanelTabItem = {
  key: string;
  label: string;
  /** Internal Communication's lock (README §4.6). */
  icon?: IconName;
  /** A count after the label, e.g. Internal Communication's events. */
  count?: number;
  content: ReactNode;
};

export type SubmittalPanelTabsProps = {
  locale: Locale;
  /** Names the set of tabs for screen readers. */
  label: string;
  /** The tabs this item offers the viewer: Details, then Internal Communication only to a Member of a Participant with internal history on it (V5). */
  tabs: readonly SubmittalPanelTabItem[];
  /** The open tab's key (`submittalPanelTab`). */
  value: string;
  onValueChange: (key: string) => void;
};

/**
 * The Submittal Panel's tabs (RP-1066, README §4.6): sticky at the top of the panel's scrolling
 * body, so they stay in reach while the sections scroll under them. The kit's Tabs, so the arrow
 * keys move along the reading direction (flipped in Arabic) and Home and End reach the ends.
 * Chat joins them in RP-1069.
 */
export function SubmittalPanelTabs({ locale, label, tabs, value, onValueChange }: SubmittalPanelTabsProps) {
  return (
    <Tabs value={value} onValueChange={onValueChange} dir={directionOf(locale)} className="sdp-tabs">
      <TabsList
        aria-label={label}
        className="sdp-tablist sticky top-0 z-[4] mt-4 gap-0.5 border-border-subtle bg-surface px-5 @[880px]/sdp:px-7"
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.key}
            value={tab.key}
            data-tab={tab.key}
            icon={tab.icon}
            count={tab.count === undefined ? undefined : formatNumber(tab.count, locale)}
            className="h-[42px] gap-1.5 px-2.5 text-[13px] [&>svg]:size-[15px]"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.key} value={tab.key} className="sdp-tabpanel">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
