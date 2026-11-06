"use client";

import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import type { Tone } from "../../tokens/themes.ts";
import { toneClasses } from "../data/tone.ts";
import { Icon, type IconName } from "../icon/icon.tsx";

/** A notification kind's tone: its icon tile's tint and colour. */
export type NotificationTone = Tone;

export type NotificationRowProps = {
  /** Where it opens: its item, or its Package. */
  href: string;
  /** The app's link component (Next's `Link`); a plain `a` by default. */
  linkAs?: ElementType;
  icon: IconName;
  tone: NotificationTone;
  /** What happened: "Reached you at Review & issue Code". */
  what: ReactNode;
  /** Shown left-to-right in both languages; null while the item has none. */
  documentNumber: string | null;
  /** The item's Subject, or a Package's name. */
  subject: string;
  /** The Project's name. */
  project: string;
  /** "Watching", on a notification about an item the Member watches. */
  watching?: string;
  /** "Goes away if a colleague picks it up", on one still waiting in their Step Pool. */
  hint?: string;
  /** The short time ("5 min", "Yesterday 10:10") and when, for the `time` element and its hover. */
  time: string;
  dateTime: string;
  timeTitle?: string;
  unread: boolean;
  /** "Unread", said to screen readers on an unread row, so its state isn't told by colour alone. */
  unreadLabel: string;
  /** `menu` in the bell's dropdown and sheet, `page` on the Notifications page. Under 560 px either puts the time under the rest. */
  layout?: "menu" | "page";
  /** Called as it opens, e.g. to mark it read. */
  onOpen?: () => void;
};

/**
 * One notification (RP-1153, the owner's design `.nr`): an unread dot, the kind's icon on its
 * tint, what happened, the Document Number · Subject on one line, the Project (and Watching, or
 * the pool hint), and a short time at the end. The whole row is the link.
 */
export function NotificationRow({
  href,
  linkAs: Link = "a",
  icon,
  tone,
  what,
  documentNumber,
  subject,
  project,
  watching,
  hint,
  time,
  dateTime,
  timeTitle,
  unread,
  unreadLabel,
  layout = "page",
  onOpen,
}: NotificationRowProps) {
  const menu = layout === "menu";
  return (
    <Link
      href={href}
      onClick={onOpen}
      className={cn(
        "grid items-start gap-x-3 border-t border-border-subtle text-start first:border-t-0 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
        menu ? "grid-cols-[8px_32px_minmax(0,1fr)_auto] px-[14px] py-2.5" : "grid-cols-[10px_36px_minmax(0,1fr)_auto] px-4 py-[14px]",
        // A phone (the design's `.nph-root .nr`): the time goes under the text.
        "max-[559px]:grid-cols-[8px_34px_minmax(0,1fr)] max-[559px]:p-3",
        unread && "bg-[color-mix(in_oklch,var(--brand-tint)_55%,var(--surface))] hover:bg-brand-tint",
      )}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", menu ? "mt-3" : "mt-[14px]", unread && "bg-primary")} />
      <span
        aria-hidden="true"
        className={cn("flex items-center justify-center rounded-[10px]", menu ? "size-8" : "size-9", "max-[559px]:size-[34px]", toneClasses[tone])}
      >
        <Icon name={icon} size={menu ? 16 : 18} />
      </span>
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className={cn("text-[13.5px] leading-[1.35] text-pretty text-text", unread ? "font-bold" : "font-semibold")}>
          {what}
          {unread && (
            <>
              {" "}
              <span className="sr-only">{unreadLabel}</span>
            </>
          )}
        </span>
        <span className="min-w-0 truncate text-[12.5px] text-text-secondary">
          {documentNumber && (
            <>
              <bdi dir="ltr" className="font-bold text-text tabular-nums">
                {documentNumber}
              </bdi>
              {" · "}
            </>
          )}
          {subject}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
          <span>{project}</span>
          {watching && (
            <span className="inline-flex items-center gap-[3px]">
              <Icon name="eye" size={14} />
              {watching}
            </span>
          )}
          {hint && (
            <span className="inline-flex items-center gap-[3px] font-semibold text-warning-fg">
              <Icon name="info-circle" size={14} />
              {hint}
            </span>
          )}
        </span>
      </span>
      <RowTime time={time} dateTime={dateTime} title={timeTitle} className="pt-0.5 max-[559px]:col-start-3 max-[559px]:row-start-2 max-[559px]:pt-1" />
    </Link>
  );
}

function RowTime({ time, dateTime, title, className }: { time: string; dateTime: string; title?: string; className?: string }) {
  return (
    <time dateTime={dateTime} title={title} className={cn("text-[11.5px] whitespace-nowrap text-muted", className)}>
      {time}
    </time>
  );
}
