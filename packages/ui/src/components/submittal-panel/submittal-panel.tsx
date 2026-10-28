"use client";

import { directionOf, formatNumber, stepAgeLabel, type Locale } from "@rabaed/domain";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { Avatar } from "../data/avatar.tsx";
import { Icon } from "../icon/icon.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { poolIcon } from "../views/kanban-card.tsx";
import { panelKey, type PanelWith } from "./panel-model.ts";
import { normalPanelWidth } from "./panel-preferences.ts";

/**
 * The Submittal Panel (spec RP-1054, RP-1061): a slide-over that opens a submittal from the List
 * and the Kanban, over the list with no scrim, at the inline-end side (the right in English, the
 * left in Arabic). Its class names carry the `sdp` prefix (README §9).
 *
 * It is the base the panel's later parts build on, through its slots: `topBarEnd` (the size
 * switch), `identity`, `facts`, `tabs`, the sections as `children`, `rail` (the side rail of
 * the wide bands) and `actions`. Its own width band is a container (`@container/sdp`), so a part
 * can change with the panel's width, live while it is dragged.
 */

export type SubmittalPanelLabels = {
  /** The Module, first in the breadcrumb, e.g. "Submittals". */
  module: string;
  /** "3 / 42": the open item's place among the loaded rows. */
  position: (n: string, total: string) => string;
  previous: string;
  next: string;
  close: string;
  /** The action bar's keyboard hint, e.g. "Esc to close · ↑ ↓ to move through the list". */
  hint: string;
};

export type SubmittalPanelProps = {
  locale: Locale;
  labels: SubmittalPanelLabels;
  /** The open item's number as the breadcrumb shows it (its Document Number with any " Rev n"), or what a Draft says instead. */
  crumb: string;
  /** Its place among the loaded rows; none for an item that isn't on the loaded page. */
  position?: { index: number; total: number };
  /** The previous and next loaded rows; absent at either edge, which disables the button. */
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
  /** The panel's width in px (Normal, 640, unless the viewer chose another), never wider than the screen. */
  width?: number;
  /** The ids of what names the panel for screen readers: the identity's number and Subject. */
  labelledBy?: string;
  /** Top-bar controls before Close (the size switch, RP-1063). */
  topBarEnd?: ReactNode;
  identity?: ReactNode;
  facts?: ReactNode;
  /** The tabs, sticky at the top of the scrolling body (RP-1066). */
  tabs?: ReactNode;
  /** The side rail of the Wide and Full bands (RP-1063, RP-1064). */
  rail?: ReactNode;
  /** The fixed footer's actions; the primary one last. */
  actions?: ReactNode;
  /** The sections (or a loading or failed state). */
  children?: ReactNode;
  className?: string;
};

/** A layer opened over the panel (a pop-up, a menu): Esc and the arrows are its own until it closes. */
const layerSelector = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"], [role="listbox"]';
/** Where the arrows already move something. */
const widgetSelector = '[role="menu"], [role="menubar"], [role="listbox"], [role="grid"], [role="tablist"], [role="radiogroup"], [role="slider"], [role="tree"]';

function isTyping(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

export function SubmittalPanel({
  locale,
  labels,
  crumb,
  position,
  onPrevious,
  onNext,
  onClose,
  width = normalPanelWidth,
  labelledBy,
  topBarEnd,
  identity,
  facts,
  tabs,
  rail,
  actions,
  children,
  className,
}: SubmittalPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest handlers, so the one key listener never reads stale ones.
  const handlers = useRef({ onPrevious, onNext, onClose });
  handlers.current = { onPrevious, onNext, onClose };

  // Focus moves into the panel when it opens (not when its content swaps), so the keyboard reaches it.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = document.activeElement;
      const panel = ref.current;
      const action = panelKey({
        key: event.key,
        modifier: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
        defaultPrevented: event.defaultPrevented,
        typing: isTyping(target),
        inWidget: target instanceof Element && target.closest(widgetSelector) !== null,
        layerOpen: [...document.querySelectorAll(layerSelector)].some((layer) => layer !== panel),
      });
      const { onPrevious, onNext, onClose } = handlers.current;
      const run = action === "close" ? onClose : action === "previous" ? onPrevious : action === "next" ? onNext : undefined;
      if (!run) return;
      event.preventDefault();
      run();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const n = (value: number) => formatNumber(value, locale);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      dir={directionOf(locale)}
      data-submittal-panel=""
      style={{ width: `min(${width}px, 100vw)` }}
      className={cn(
        "sdp @container/sdp fixed inset-y-0 end-0 z-40 flex flex-col border-s border-border bg-surface text-text outline-none",
        "shadow-[-28px_0_56px_-28px_color-mix(in_srgb,var(--shadow-colour)_32%,transparent)] rtl:shadow-[28px_0_56px_-28px_color-mix(in_srgb,var(--shadow-colour)_32%,transparent)]",
        className,
      )}
    >
      <div className="sdp-top flex h-[52px] shrink-0 items-center gap-1 border-b border-border-subtle ps-3.5 pe-2.5">
        <p className="sdp-crumb me-auto flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
          <Icon name="file-text" size={15} className="shrink-0" />
          <span className="whitespace-nowrap">{labels.module}</span>
          <Icon name={locale === "ar" ? "chevron-left" : "chevron-right"} size={15} className="shrink-0" />
          {/* A Document Number reads left to right, in Arabic too. */}
          <bdi dir="ltr" translate="no" className="truncate font-bold text-text">
            {crumb}
          </bdi>
          {position && position.index >= 0 && (
            <span className="whitespace-nowrap tabular-nums">· {labels.position(n(position.index + 1), n(position.total))}</span>
          )}
        </p>
        <span className="sdp-nav flex shrink-0 items-center">
          <IconButton size="sm" label={labels.previous} disabled={!onPrevious} onClick={onPrevious}>
            <Icon name="chevron-up" size={16} />
          </IconButton>
          <IconButton size="sm" label={labels.next} disabled={!onNext} onClick={onNext}>
            <Icon name="chevron-down" size={16} />
          </IconButton>
        </span>
        {topBarEnd}
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border-subtle" />
        <IconButton size="sm" label={labels.close} onClick={onClose} className="shrink-0">
          <Icon name="x" size={16} />
        </IconButton>
      </div>
      <div className="sdp-body min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="sdp-layout flex min-w-0">
          <div className="sdp-main min-w-0 flex-1 pb-6">
            {identity}
            {facts}
            {tabs}
            {children}
          </div>
          {rail}
        </div>
      </div>
      <div className="sdp-actions flex shrink-0 flex-wrap items-center gap-2 border-t border-border-subtle bg-surface px-4 py-3">
        <span className="sdp-hint me-auto text-caption text-muted">{labels.hint}</span>
        {actions}
      </div>
    </div>
  );
}

export type SubmittalPanelIdentityProps = {
  /** The Document Number with " Rev n" split off (`panelNumber`); null for a Draft. */
  number: { number: string; revision: string | null } | null;
  /** What a Draft with no number says instead. */
  noNumber: string;
  subject: string;
  /** The Stage, the Issued Code and the Trade. */
  chips?: ReactNode;
  /** The ids `labelledBy` names: the number's and the Subject's. */
  numberId?: string;
  subjectId?: string;
};

/**
 * The identity (README §4.3, gap A16): the Document Number big, bold and monochrome, left to right
 * in Arabic too, with a Revision's "Rev N" inline after it in brand orange (Rev 0 shows nothing),
 * then the Subject and the chips.
 */
export function SubmittalPanelIdentity({ number, noNumber, subject, chips, numberId, subjectId }: SubmittalPanelIdentityProps) {
  return (
    <div className="sdp-identity px-5 pt-[18px] pb-3.5">
      <p id={numberId} className="sdp-number text-[26px] leading-[1.1] font-extrabold break-all text-text tabular-nums">
        {number ? (
          <bdi dir="ltr" translate="no">
            {number.number}
            {number.revision && (
              <>
                {" "}
                <span className="sdp-rev font-extrabold text-brand-fg">{number.revision}</span>
              </>
            )}
          </bdi>
        ) : (
          <span className="text-[21px] text-muted">{noNumber}</span>
        )}
      </p>
      <h2 id={subjectId} dir="auto" className="sdp-subject mt-2 mb-2.5 text-[20px] leading-tight font-bold text-pretty">
        {subject}
      </h2>
      {chips && <div className="sdp-chips flex flex-wrap items-center gap-1.5">{chips}</div>}
    </div>
  );
}

export type SubmittalPanelFactsLabels = {
  with: string;
  stepAge: string;
  location: string;
  /** "+2": how many more of a Step Pool's names. */
  more: (n: string) => string;
  /** What an empty fact shows. */
  none: string;
};

export type SubmittalPanelFactsProps = {
  locale: Locale;
  labels: SubmittalPanelFactsLabels;
  /** Who it is with (`panelWith`): null once closed. */
  with: PanelWith | null;
  /** Step Age in weeks; null when it doesn't age (closed, or a Draft with no number). */
  stepAgeWeeks: number | null;
  /** The plan location, top level first; empty when it has none. */
  place: string[];
};

/**
 * The key facts (README §4.5, gaps A1–A3): With, at every width; Step Age as 1–4+ dots in weeks;
 * the Location. No due date. Another Company is named by its Company name only, with no person
 * and no avatar (V14).
 */
export function SubmittalPanelFacts({ locale, labels, with: holder, stepAgeWeeks, place }: SubmittalPanelFactsProps) {
  const none = <span className="text-faint">{labels.none}</span>;
  const fact = (key: string, label: string, value: ReactNode) => (
    <div key={key} data-fact={key} className="min-w-0 bg-surface px-3 py-2.5">
      <dt className="mb-1 text-[11.5px] text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-[7px] text-[13.5px] font-semibold">{value}</dd>
    </div>
  );
  return (
    <dl className="sdp-facts mx-5 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] bg-border-subtle shadow-[0_0_0_1px_var(--border-subtle)] @[560px]/sdp:grid-cols-3">
      {fact(
        "with",
        labels.with,
        holder === null ? (
          none
        ) : holder.kind === "person" ? (
          <>
            <Avatar name={holder.name} size="sm" decorative />
            <span className="truncate">{holder.name}</span>
          </>
        ) : holder.kind === "pool" ? (
          <>
            <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-muted">
              <Icon name={poolIcon} size={13} />
            </span>
            <span className="truncate">
              {holder.names.join(locale === "ar" ? "، " : ", ")}
              {holder.more > 0 && ` ${labels.more(formatNumber(holder.more, locale))}`}
            </span>
          </>
        ) : (
          // Another Company, or "Owner review": its name only, no avatar.
          <span className="truncate">{holder.name}</span>
        ),
      )}
      {fact(
        "stepAge",
        labels.stepAge,
        stepAgeWeeks === null ? (
          none
        ) : (
          <>
            <AgeDots weeks={stepAgeWeeks} locale={locale} />
            <span aria-hidden="true" className="truncate">
              {stepAgeLabel(stepAgeWeeks, locale)}
            </span>
          </>
        ),
      )}
      {fact("location", labels.location, place.length === 0 ? none : <span className="truncate">{place.join(" › ")}</span>)}
    </dl>
  );
}

/** Ids for the panel's name: the number's and the Subject's, joined for `labelledBy`. */
export function useSubmittalPanelIds() {
  const id = useId();
  const numberId = `${id}-number`;
  const subjectId = `${id}-subject`;
  return { numberId, subjectId, labelledBy: `${numberId} ${subjectId}` };
}
