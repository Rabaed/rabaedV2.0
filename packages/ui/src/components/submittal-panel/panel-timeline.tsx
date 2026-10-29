"use client";

import { formatNumber, intlLocaleOf, timeZone, type Locale } from "@rabaed/domain";
import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import type { SubmittalInternalEntry, SubmittalLogEntry, SubmittalTimelineEvent, SubmittalTimelineText, SubmittalTimelineTone } from "./timeline-model.ts";

/**
 * The Submittal Panel's timeline (RP-1067, README §5): one list, newest first, for both the approval
 * log and Internal Communication. Each entry has a status dot, the move in bold, who acted, a text
 * box only when text was written, an optional chip, and the date and time. It is not a chat: no
 * bubbles, and no composer (an Internal Note is written only in a Transition's Action Form, gap A9).
 */

export type SubmittalTimelineItem = {
  key: string;
  tone: SubmittalTimelineTone;
  icon: IconName;
  move: string;
  /** Who acted: a person (the viewer's own, or the Code's signer) and their Company, or a Company alone. */
  who?: { person: string | null; company: string | null };
  /** Each text written with it, labelled ("Cover Note", "Remarks"). */
  texts?: readonly { label: string; text: string }[];
  chip?: ReactNode;
  /** When, as the read gives it (ISO); none for a collapsed "<Company> review" block. */
  at?: string;
  /** Another Company's collapsed internal Steps: drawn quieter, with no time. */
  collapsed?: boolean;
};

const dotTone: Record<SubmittalTimelineTone, string> = {
  neutral: "bg-surface text-text-secondary shadow-[inset_0_0_0_1px_var(--border)]",
  ok: "bg-success-tint text-success-fg",
  warn: "bg-warning-tint text-warning-fg",
  bad: "bg-danger-tint text-danger-fg",
};

/** "29 Oct 2026, 09:40": Saudi time, Latin digits in Arabic too. */
function formatWhen(at: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocaleOf(locale), { timeZone, dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" }).format(new Date(at));
}

export function SubmittalPanelTimeline({ locale, items, empty, label }: { locale: Locale; items: readonly SubmittalTimelineItem[]; empty: string; label?: string }) {
  if (items.length === 0) return <p className="text-[12.5px] text-muted">{empty}</p>;
  return (
    <ol aria-label={label} className="sdp-timeline flex flex-col">
      {items.map((item, i) => (
        <li
          key={item.key}
          data-tone={item.tone}
          data-collapsed={item.collapsed || undefined}
          className="sdp-timeline-entry relative grid grid-cols-[26px_minmax(0,1fr)] gap-2.5 pb-4 last:pb-0"
        >
          {/* The line down to the next entry. */}
          {i < items.length - 1 && <span aria-hidden="true" className="absolute start-3 top-7 bottom-0.5 w-0.5 bg-border-subtle" />}
          <span aria-hidden="true" className={cn("flex size-[26px] items-center justify-center rounded-full", dotTone[item.tone], item.collapsed && "border border-dashed border-border-strong bg-surface-subtle shadow-none")}>
            <Icon name={item.icon} size={14} />
          </span>
          <div className="min-w-0 pt-[3px]">
            <p className={cn("text-[13px] font-semibold", item.collapsed && "text-text-secondary")}>{item.move}</p>
            {item.who && (item.who.person || item.who.company) && (
              <p className="mt-1 text-[12.5px] [overflow-wrap:anywhere]">
                {item.who.person && <span className="font-semibold">{item.who.person}</span>}
                {item.who.person && item.who.company && <span className="text-muted"> · </span>}
                {item.who.company && <span className="text-muted">{item.who.company}</span>}
              </p>
            )}
            {item.texts?.map((text) => (
              <p
                key={text.label}
                data-text={text.label}
                className="sdp-timeline-text mt-2 rounded-[8px] bg-surface px-2.5 py-2 text-[12.5px] leading-[1.45] shadow-[inset_0_0_0_1px_var(--border-subtle)] [overflow-wrap:anywhere]"
              >
                <span className="block text-[11.5px] font-semibold text-muted">{text.label}</span>
                {/* The text's own direction, whatever the page's: an English Remark in Arabic keeps its full stop. */}
                <span dir="auto" className="block whitespace-pre-wrap">
                  {text.text}
                </span>
              </p>
            ))}
            {item.chip && <div className="mt-2">{item.chip}</div>}
            {item.at && (
              <time dateTime={item.at} className="mt-1.5 block text-[11px] text-muted tabular-nums">
                {formatWhen(item.at, locale)}
              </time>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export type SubmittalTimelineLabels = {
  /** "Created": the Creation Date, for the raiser's Participant only. */
  created: string;
  /** "Design Consultants LLC review": another Company's internal Steps in one block (V14). */
  review: (company: string) => string;
  /** What a move is called: its Transition's label, or the history's wording for an internal one. */
  move: (event: SubmittalTimelineEvent) => string;
  texts: Record<SubmittalTimelineText["kind"], string>;
  /** "3 Comments in the Snag List": `n` formatted, `count` for the plural. */
  comments: (n: string, count: number) => string;
  /** "Recommended Code B", inside its Participant only (V5). */
  recommendedCode: (code: string) => string;
  /** What an empty timeline says. */
  empty: string;
};

const toneIcon: Record<SubmittalTimelineTone, IconName> = { neutral: "send", ok: "circle-check", warn: "arrow-back-up", bad: "circle-x" };
/** A Code's own icon: approved (A or B) or not (C or D); a move's by its tone. */
const iconOf = (event: SubmittalTimelineEvent, tone: SubmittalTimelineTone): IconName =>
  event.outcome !== null ? (tone === "bad" ? "circle-x" : "circle-check") : toneIcon[tone];

const chipClass = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold";

/**
 * The approval log (gaps A6–A8): the shared moves between Participants as the history read gives
 * them, another Company's internal Steps as one "<Company> review" block, "Created" for the raiser's
 * Participant only, and Code B's chip linking to the Comments the viewer sees.
 */
export function SubmittalApprovalLog({
  locale,
  labels,
  entries,
  commentsHref,
  linkAs: Anchor = "a",
}: {
  locale: Locale;
  labels: SubmittalTimelineLabels;
  entries: readonly SubmittalLogEntry[];
  /** Where Code B's chip goes: the Snag List filtered to the Comments raised from this item. */
  commentsHref?: (typeCode: string) => string | undefined;
  linkAs?: ElementType;
}) {
  const items = entries.map((entry, i): SubmittalTimelineItem => {
    if (entry.kind === "created") return { key: "created", tone: "neutral", icon: "file-text", move: labels.created, at: entry.at };
    if (entry.kind === "review") {
      return { key: `review-${i}`, tone: "neutral", icon: "building", move: labels.review(entry.companyName[locale]), collapsed: true };
    }
    const { event, comments } = entry;
    const href = comments ? commentsHref?.(comments.typeCode) : undefined;
    const chipText = comments ? `${labels.comments(formatNumber(comments.count, locale), comments.count)}` : null;
    return {
      key: String(event.seq),
      tone: entry.tone,
      icon: iconOf(event, entry.tone),
      move: labels.move(event),
      who: { person: entry.person?.[locale] ?? null, company: event.by.companyName?.[locale] ?? null },
      texts: entry.texts.map((t) => ({ label: labels.texts[t.kind], text: t.text })),
      chip:
        chipText === null ? undefined : href ? (
          <Anchor href={href} data-chip="comments" className={cn(chipClass, "bg-danger-tint text-danger-fg hover:underline")}>
            {chipText}
            <Icon name="arrow-up-right" size={13} />
          </Anchor>
        ) : (
          <span data-chip="comments" className={cn(chipClass, "bg-danger-tint text-danger-fg")}>
            {chipText}
          </span>
        ),
      at: event.at,
    };
  });
  return <SubmittalPanelTimeline locale={locale} items={items} empty={labels.empty} />;
}

/**
 * The Internal Communication tab (gap A9, V5): an amber banner saying who alone sees it, then the
 * viewer's own Participant's internal entries as the same timeline. No composer.
 */
export function SubmittalInternalCommunication({
  locale,
  labels,
  banner,
  entries,
}: {
  locale: Locale;
  labels: SubmittalTimelineLabels;
  /** "Internal: only TMC Constructions can see this. Never shown to the Consultant or the Owner.", worded by the viewer's role. */
  banner: string;
  entries: readonly SubmittalInternalEntry[];
}) {
  const items = entries.map(({ event, person, texts, tone }): SubmittalTimelineItem => ({
    key: String(event.seq),
    tone,
    icon: event.type === "internal_note" ? "message" : event.recommendedCode !== null ? "gavel" : toneIcon[tone],
    move: labels.move(event),
    who: { person: person?.[locale] ?? null, company: event.by.companyName?.[locale] ?? null },
    texts: texts.map((t) => ({ label: labels.texts[t.kind], text: t.text })),
    chip: event.recommendedCode ? (
      <span data-chip="recommended-code" className={cn(chipClass, "bg-surface-subtle text-text-secondary shadow-[inset_0_0_0_1px_var(--border-subtle)]")}>
        {labels.recommendedCode(event.recommendedCode)}
      </span>
    ) : undefined,
    at: event.at,
  }));
  return (
    <div className="sdp-internal flex flex-col gap-4 px-5 py-4 @[880px]/sdp:px-7">
      <p role="note" className="flex items-start gap-2 rounded-[10px] bg-warning-tint px-3 py-2.5 text-[12.5px] leading-[1.4] font-semibold text-warning-fg">
        <Icon name="lock" size={15} className="mt-px shrink-0" />
        {banner}
      </p>
      <SubmittalPanelTimeline locale={locale} items={items} empty={labels.empty} />
    </div>
  );
}
