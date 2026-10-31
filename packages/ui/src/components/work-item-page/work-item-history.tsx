"use client";

import { formatNumber, type BilingualText, type Locale } from "@rabaed/domain";
import type { ReactNode } from "react";
import type { IconName } from "../icon/icon.tsx";
import { SubmittalPanelTimeline, type SubmittalTimelineItem } from "../submittal-panel/panel-timeline.tsx";
import { sameName, submittalPositionsText, type SubmittalTimelineEvent, type SubmittalTimelineText, type SubmittalTimelineTone } from "../submittal-panel/timeline-model.ts";
import type { WorkItemHistoryEntry } from "./history-model.ts";

export type WorkItemPageHistoryLabels = {
  /** "History": names the list. */
  title: string;
  /** What a move is called: its Transition's label, or the history's wording. */
  move: (event: SubmittalTimelineEvent) => string;
  texts: Record<SubmittalTimelineText["kind"], string>;
  /** "Internal: only your Company sees this" (V5). */
  internal: string;
  /** "Details": the toggle over an entry's further details. */
  details: string;
  /** "Hafiz Hamdan (you)": the viewer's own entries. */
  you: (name: string) => string;
  empty: string;
};

const toneIcon: Record<SubmittalTimelineTone, IconName> = { neutral: "send", ok: "circle-check", warn: "arrow-back-up", bad: "circle-x" };

function iconOf({ event, tone }: WorkItemHistoryEntry): IconName {
  if (event.type === "created") return "file-text";
  if (event.type === "internal_note") return "message";
  if (event.type === "picked_up" || event.type === "claimed") return "hand-grab";
  if (event.type === "issue_code" || event.recommendedCode !== null) return "gavel";
  return toneIcon[tone];
}

/**
 * The Work Item page's History (RP-1151, gap table rows 60–64): every event the viewer reads, newest
 * first, numbered from the oldest, with the viewer's own internal moves in an amber pill (V5). Who
 * acted is as `workItemHistoryEntries` names them: another Company by its name only, but the Code's
 * signer (V14). `details` gives an entry's further details (a reply's answers, the files it took, the
 * fields it changed), folded behind "Details"; none for an entry with nothing more.
 */
export function WorkItemPageHistory({
  locale,
  labels,
  entries,
  details,
  viewer,
}: {
  locale: Locale;
  labels: WorkItemPageHistoryLabels;
  entries: readonly WorkItemHistoryEntry[];
  /** The viewer's own name, as the reads give it: their entries say "(you)". */
  viewer?: BilingualText;
  details?: (entry: WorkItemHistoryEntry) => ReactNode;
}) {
  const items = entries.map((entry): SubmittalTimelineItem => {
    const more = details?.(entry);
    return {
      key: String(entry.event.seq),
      tone: entry.tone,
      icon: iconOf(entry),
      move: labels.move(entry.event),
      n: formatNumber(entry.n, locale),
      who: {
        person: entry.person === null ? null : sameName(entry.person, viewer ?? null) ? labels.you(entry.person[locale]) : entry.person[locale],
        avatar: true,
        position: submittalPositionsText(entry.positions, locale),
        company: entry.event.by.companyName?.[locale] ?? null,
      },
      texts: entry.texts.map((t) => ({ label: labels.texts[t.kind], text: t.text })),
      at: entry.event.at,
      ...(entry.internal ? { pill: labels.internal } : {}),
      ...(more ? { details: { label: labels.details, content: more } } : {}),
    };
  });
  return <SubmittalPanelTimeline locale={locale} items={items} empty={labels.empty} label={labels.title} />;
}
