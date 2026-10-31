"use client";

import { formatDate, formatNumber, type BilingualText, type Locale } from "@rabaed/domain";
import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { Badge } from "../data/badge.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import {
  submittalPositionsText,
  type SubmittalInternalEntry,
  type SubmittalLogEntry,
  type SubmittalTimelineEvent,
  type SubmittalTimelineText,
  type SubmittalTimelineTone,
} from "./timeline-model.ts";

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
  /**
   * Who acted: a person (the viewer's own, or the Code's signer), their Position (the viewer's own
   * people only, as the read gives it, RP-1091) and their Company; or a Company alone.
   */
  who?: { person: string | null; position?: string | null; company: string | null; avatar?: boolean };
  /** Each text written with it, labelled ("Cover Note", "Remarks"). */
  texts?: readonly { label: string; text: string }[];
  chip?: ReactNode;
  /** When, as the read gives it (ISO); none for a collapsed "<Company> review" block. */
  at?: string;
  /** Another Company's collapsed internal Steps: drawn quieter, with no time. */
  collapsed?: boolean;
  /** Its number as the viewer reads the list (the Work Item page's History, RP-1151), formatted. */
  n?: string;
  /** A pill under it, e.g. the amber "Internal: only your Company sees this" (V5). */
  pill?: string;
  /** More about it, folded behind a "Details" toggle (the page's History). */
  details?: { label: string; content: ReactNode };
};

const dotTone: Record<SubmittalTimelineTone, string> = {
  neutral: "bg-surface text-text-secondary shadow-[inset_0_0_0_1px_var(--border)]",
  ok: "bg-success-tint text-success-fg",
  warn: "bg-warning-tint text-warning-fg",
  bad: "bg-danger-tint text-danger-fg",
};

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
            <p className={cn("text-[13px] font-semibold", item.collapsed && "text-text-secondary")}>
              {item.n && (
                <span className="me-1.5 inline-flex h-[18px] min-w-5 items-center justify-center rounded-[5px] bg-surface px-1 align-[1px] text-[11px] font-bold text-muted tabular-nums shadow-[inset_0_0_0_1px_var(--border-subtle)]">
                  {item.n}
                </span>
              )}
              {item.move}
            </p>
            {item.who && (item.who.person || item.who.company) && (
              <p className={cn("mt-1 text-[12.5px] [overflow-wrap:anywhere]", item.who.avatar && "flex items-start gap-1.5")}>
                {/* The page's History draws the person's initials before the name (RP-1151 row 60); the name is beside it. */}
                {item.who.avatar && item.who.person && <Avatar name={item.who.person} size="sm" decorative />}
                {/* One run of text, so it wraps as words, not part by part; the panel's line stays as it was. */}
                <span className={cn(item.who.avatar && "min-w-0 self-center")}>
                {/* Name · Position · Company, each part only when given; a Position only with its person. */}
                {item.who.person && <span className="font-semibold">{item.who.person}</span>}
                {item.who.person && item.who.position && (
                  <>
                    <span className="text-muted"> · </span>
                    <span data-who="position" className="text-muted">
                      {item.who.position}
                    </span>
                  </>
                )}
                {item.who.person && item.who.company && <span className="text-muted"> · </span>}
                {item.who.company && <span className="text-muted">{item.who.company}</span>}
                </span>
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
            {item.pill && (
              <p className="mt-2 inline-flex h-[22px] items-center gap-1.5 rounded-[6px] bg-warning-tint px-2 text-[11.5px] font-semibold text-warning-fg">
                <Icon name="lock" size={13} />
                {item.pill}
              </p>
            )}
            {item.details && (
              <details className="mt-1.5 text-[12.5px]">
                <summary className={cn("w-fit cursor-pointer rounded-xs text-[12px] font-semibold text-muted hover:text-text", focusRing)}>{item.details.label}</summary>
                <div className="mt-1.5 flex flex-col gap-1 text-text-secondary [overflow-wrap:anywhere]">{item.details.content}</div>
              </details>
            )}
            {item.at && (
              <time dateTime={item.at} className="mt-1.5 block text-[11px] text-muted tabular-nums">
                {formatDate(new Date(item.at), locale, { dateStyle: "medium", timeStyle: "short" })}
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

/** What every event entry shows alike: its key, move, who acted, its texts and its time. */
function eventItem(
  event: SubmittalTimelineEvent,
  person: BilingualText | null,
  positions: readonly BilingualText[],
  texts: readonly SubmittalTimelineText[],
  labels: SubmittalTimelineLabels,
  locale: Locale,
): Pick<SubmittalTimelineItem, "key" | "move" | "who" | "texts" | "at"> {
  return {
    key: String(event.seq),
    move: labels.move(event),
    who: {
      person: person?.[locale] ?? null,
      position: submittalPositionsText(positions, locale),
      company: event.by.companyName?.[locale] ?? null,
    },
    texts: texts.map((t) => ({ label: labels.texts[t.kind], text: t.text })),
    at: event.at,
  };
}

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
    const chip = comments && (
      <Badge tone="danger" data-chip="comments" className="h-auto gap-1 px-2 py-0.5 text-[11.5px]">
        {labels.comments(formatNumber(comments.count, locale), comments.count)}
        {href && <Icon name="arrow-up-right" size={13} />}
      </Badge>
    );
    return {
      ...eventItem(event, entry.person, entry.positions, entry.texts, labels, locale),
      tone: entry.tone,
      icon: iconOf(event, entry.tone),
      chip: chip && href ? (
        <Anchor href={href} className="inline-flex rounded-full hover:underline">
          {chip}
        </Anchor>
      ) : (
        chip || undefined
      ),
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
  const items = entries.map(({ event, person, positions, texts, tone }): SubmittalTimelineItem => ({
    ...eventItem(event, person, positions, texts, labels, locale),
    tone,
    icon: event.type === "internal_note" ? "message" : event.recommendedCode !== null ? "gavel" : toneIcon[tone],
    chip: event.recommendedCode ? (
      <Badge data-chip="recommended-code" className="h-auto px-2 py-0.5 text-[11.5px]">
        {labels.recommendedCode(event.recommendedCode)}
      </Badge>
    ) : undefined,
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
