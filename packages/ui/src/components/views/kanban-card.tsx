"use client";

import { stepAgeDots, type Locale, type OutcomeLook } from "@rabaed/domain";
import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { AgeDots } from "../status/age-dots.tsx";

// The Kanban card (RP-410, the owner's Kanban Card Anatomy): header (file icon and
// number at the reading start, the Revision or outcome badge pinned to the left in
// both languages), Subject, tags (Trade chip in its hue, Type code), the optional
// Contractor name and plan location, and the footer (owner at the start; date and
// the Step Age dots, on hover, at the end). Presentational: the board decides what
// the viewer may read (V14) and passes it in.

/** The header's badge: the Revision while no outcome is issued, then the outcome. */
export type KanbanCardBadge =
  | { kind: "revision"; /** e.g. "R2". */ label: string }
  | {
      kind: "outcome";
      /** How it looks, from its place in its Type's set (`outcomeLook`): only `a` turns the card green. */
      look: OutcomeLook;
      /** What the pill says, e.g. "Code A", or an outcome's name. */
      label: string;
      /** Its full name, for screen readers and on hover, e.g. "Approved". */
      name: string;
    }
  | { kind: "plain"; label: string };

/**
 * Who holds the card, or who closed it, as the viewer may read it (V14). `initialsFrom`
 * is the name its avatar's initials come from: the English one, so an Arabic card shows
 * Latin initials (the anatomy's "NA").
 */
export type KanbanCardOwner =
  /** One of my own Company's people. */
  | { kind: "person"; name: string; initialsFrom?: string }
  /** My own Company's Step nobody has claimed yet: the Step and "unclaimed". */
  | { kind: "pool"; name: string }
  /** Another Company, by its name only. */
  | { kind: "company"; name: string; initialsFrom?: string };

/** One level of the plan location: its level (1 Zone, 2 Building, 3 Floor…) and the Location's name. */
export type KanbanCardPlace = { depth: number; name: string };

export type KanbanCardProps = {
  /** The Document Number; null for a Draft, which has none yet. */
  number: string | null;
  /** What a card with no number says instead. */
  noNumberLabel: string;
  /** The Subject. */
  title: string;
  /** The item's page. */
  href: string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  badge?: KanbanCardBadge;
  /** The Trade, shown as "Electrical Works (EL)" in its own hue. */
  trade: { code: string; name: string };
  /** The Work Item Type's code, e.g. MAR. */
  typeCode: string;
  /** The raising Company's name: only when the Card view layout shows it. */
  contractorName?: string;
  /** The plan location, top level first: only when the Card view layout shows it. */
  place?: KanbanCardPlace[];
  owner?: KanbanCardOwner;
  /** The card's date, already formatted, and its spoken label: only when the Card view layout shows it. */
  date?: { text: string; label: string };
  /** Step Age in weeks; null when it doesn't age (closed, or a Draft with no number). */
  stepAgeWeeks: number | null;
  locale: Locale;
  /** Being dragged, or chosen: the 2px tomato ring. */
  selected?: boolean;
  /** Shows the hover look (lifted, the Step Age dots) without a pointer over it, e.g. in a picture of the states. */
  hovered?: boolean;
  /** Controls in the header (the Move menu): shown on hover or focus, always on touch. */
  actions?: ReactNode;
  className?: string;
};

// A Trade's chip hue by its code; any other Trade in blue. Full class names, so Tailwind finds them.
const tradeHues: Record<string, string> = {
  CV: "bg-trade-cv-bg text-trade-cv-fg",
  AR: "bg-trade-ar-bg text-trade-ar-fg",
  EL: "bg-trade-el-bg text-trade-el-fg",
  ME: "bg-trade-me-bg text-trade-me-fg",
  SU: "bg-trade-su-bg text-trade-su-fg",
};
const otherTrade = "bg-trade-other-bg text-trade-other-fg";

/** The Trade chip's colours: the default Trades in their own hues. */
export function tradeChipClass(code: string): string {
  return tradeHues[code.toUpperCase()] ?? otherTrade;
}

const outcomeLooks: Record<OutcomeLook, { classes: string; icon: IconName }> = {
  a: { classes: "bg-code-a-bg text-code-a-fg", icon: "circle-check" },
  // Code A: the solid green pill, and the green card; Code B: a light green pill (light fill, green text) on a white card.
  b: { classes: "bg-code-b-bg text-code-b-fg", icon: "circle-check" },
  c: { classes: "bg-code-c-bg text-code-c-fg ring-1 ring-inset ring-code-c-fg/40", icon: "refresh" },
  d: { classes: "bg-code-d-bg text-code-d-fg", icon: "circle-x" },
};

/** An unclaimed Step's mark: its Step Pool, as a group of people. */
// eslint-disable-next-line rabaed/no-avoid-terms -- the Tabler icon's own name, not a Member
export const poolIcon: IconName = "users";

/** The Location's icon per level: Zone a map, Building a building, Floor stairs. */
const placeIcons: IconName[] = ["map", "building", "stairs"];

export function KanbanCard({
  number,
  noNumberLabel,
  title,
  href,
  linkAs: Link = "a",
  badge,
  trade,
  typeCode,
  contractorName,
  place,
  owner,
  date,
  stepAgeWeeks,
  locale,
  selected = false,
  hovered = false,
  actions,
  className,
}: KanbanCardProps) {
  const approved = badge?.kind === "outcome" && badge.look === "a";
  // 4 weeks or more at its step: the warm border and red dots, no wording (Rabaed shows age only).
  const aged = stepAgeWeeks !== null && stepAgeDots(stepAgeWeeks) >= 4;
  return (
    <article
      data-kanban-card=""
      data-approved={approved ? "" : undefined}
      data-aged={aged ? "" : undefined}
      data-hovered={hovered ? "" : undefined}
      className={cn(
        "group/card relative flex flex-col rounded-md border bg-surface px-3 py-[11px] shadow-xs transition-[box-shadow,translate] duration-150",
        "hover:-translate-y-px hover:shadow-[0_6px_16px_color-mix(in_srgb,var(--shadow-colour)_10%,transparent)]",
        "data-hovered:-translate-y-px data-hovered:shadow-[0_6px_16px_color-mix(in_srgb,var(--shadow-colour)_10%,transparent)]",
        approved ? "border-card-approved-border bg-success-tint" : aged ? "border-card-aged-border" : "border-border",
        selected && "ring-2 ring-brand",
        className,
      )}
    >
      <div className="flex min-h-[22px] items-center gap-1.5 font-ui text-caption text-muted">
        {/* Pinned to the left in both languages: first in English, last in Arabic. */}
        {badge && (
          <span className="order-first flex shrink-0 rtl:order-last">
            <HeaderBadge badge={badge} />
          </span>
        )}
        <Icon name="file-text" size={14} className="shrink-0" />
        {number ? <DocNo value={number} className="font-normal" /> : <span className="truncate">{noNumberLabel}</span>}
        <span className="flex-1" />
        {actions && (
          <span className="relative z-10 flex shrink-0 opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100">
            {actions}
          </span>
        )}
      </div>
      <h3 className="mt-1.5 text-[15px] leading-[1.35] font-bold text-text">
        <Link
          href={href}
          dir="auto"
          title={title}
          className={cn(
            "line-clamp-2 rounded-xs after:absolute after:inset-0 after:rounded-md after:content-['']",
            focusRing,
          )}
        >
          {title}
        </Link>
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={cn("inline-flex h-6 items-center rounded-[7px] px-2 text-caption font-semibold", tradeChipClass(trade.code))}>
          {trade.name} (<bdi translate="no">{trade.code}</bdi>)
        </span>
        <span translate="no" className="font-ui text-caption font-semibold tracking-wide text-muted">
          {typeCode}
        </span>
      </div>
      {contractorName !== undefined && (
        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-caption text-muted">
          <Icon name="briefcase" size={14} className="shrink-0" />
          <span className="truncate">{contractorName}</span>
        </p>
      )}
      {place !== undefined && place.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {place.map((p) => (
            <li
              key={`${p.depth}:${p.name}`}
              className="inline-flex h-[22px] items-center gap-1 rounded-[6px] bg-neutral-tint px-[7px] text-[11.5px] font-medium whitespace-nowrap text-text-secondary"
            >
              <Icon name={placeIcons[Math.min(p.depth, placeIcons.length) - 1]!} size={12} className="text-muted" />
              {p.name}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2.5 flex min-h-6 items-center gap-2 text-caption text-text-secondary">
        {owner && (
          <span className="flex min-w-0 items-center gap-2">
            {owner.kind === "pool" ? (
              <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-muted">
                <Icon name={poolIcon} size={13} />
              </span>
            ) : (
              <Avatar name={owner.name} initialsFrom={owner.initialsFrom} kind={owner.kind === "company" ? "company" : "person"} size="sm" decorative />
            )}
            <span className="truncate text-sm">{owner.name}</span>
          </span>
        )}
        <span className="ms-auto flex shrink-0 items-center gap-2">
          {date && (
            <span className="inline-flex items-center gap-1 font-ui text-muted" title={date.label}>
              <Icon name="calendar-event" size={14} />
              <span className="sr-only">{date.label}</span>
              <span aria-hidden="true">{date.text}</span>
            </span>
          )}
          {stepAgeWeeks !== null && (
            // Shown on hover (and focus); always at 4 weeks or more.
            <AgeDots
              weeks={stepAgeWeeks}
              locale={locale}
              className={cn(
                !aged && "opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100 group-data-hovered/card:opacity-100",
              )}
            />
          )}
        </span>
      </div>
    </article>
  );
}

function HeaderBadge({ badge }: { badge: KanbanCardBadge }) {
  if (badge.kind === "revision") {
    return (
      <span translate="no" className="inline-flex h-[22px] items-center rounded-[6px] bg-revision-bg px-2 font-ui text-caption font-bold text-revision-fg">
        {badge.label}
      </span>
    );
  }
  if (badge.kind === "plain") {
    return <span className="inline-flex h-[22px] items-center rounded-[6px] bg-neutral-tint px-2 text-caption font-semibold text-neutral-fg">{badge.label}</span>;
  }
  const { classes, icon } = outcomeLooks[badge.look];
  return (
    <span
      title={badge.name}
      data-outcome-look={badge.look}
      className={cn("inline-flex h-[22px] items-center gap-1 rounded-[6px] px-2 font-ui text-caption font-bold", classes)}
    >
      <Icon name={icon} size={13} />
      <span aria-hidden="true" translate="no">
        {badge.label}
      </span>
      <span className="sr-only">{badge.name}</span>
    </span>
  );
}
