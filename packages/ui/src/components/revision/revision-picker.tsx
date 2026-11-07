"use client";

import { directionOf, formatDate, formatNumber, type Locale, type RevisionChain, type WorkItemOutcome } from "@rabaed/domain";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StagePill } from "../status/stage-pill.tsx";
import { revisionPicker, type RevisionPickerRow } from "./revision-picker-model.ts";

// The one Revision picker (RP-1253; gap table approved 2026-11-07), on the Submittal Panel and the Work
// Item page. Right after the Document Number: the open Revision as "Rev n" or "Original" with a chevron,
// the brand tint on the latest the viewer sees and amber on an earlier one. Its menu lists the chain
// read's Revisions only (visibility.md, the Revisions channel), newest first: a Revision the read leaves
// out is never named, here or in the banner. A Draft Revision shows a plain "Rev n".

/** A Revision's name, from the app's messages: "Rev 1" (untranslated; given the number as text) or "Original". */
export type RevisionNameLabels = { rev: (n: string) => string; original: string };

/** "Rev 1", or "Original" for 0: the one wording of the picker, the banner and the read-only bar. */
export const revisionName = (labels: RevisionNameLabels, revisionNo: number, locale: Locale) =>
  revisionNo > 0 ? labels.rev(formatNumber(revisionNo, locale)) : labels.original;

/** The Revision picker's words, from the app's messages. */
export type RevisionPickerLabels = {
  revision: RevisionNameLabels;
  /** "Open an earlier revision": the button's tooltip. */
  tooltip: string;
  /** "Revisions · each one came from a Code C": names the menu. */
  title: string;
  /** "Current": the latest Revision the viewer sees. */
  current: string;
  /** "Submitted 1 Aug 2026": the Submission Date, given formatted. */
  submitted: (date: string) => string;
  /** "Returned 25 Jul 2026": the date its code closed it, given formatted. */
  closed: (date: string) => string;
};

export type RevisionPickerProps = {
  locale: Locale;
  labels: RevisionPickerLabels;
  /** The chain read (`RevisionChain.revisions`), in order: only the Revisions the viewer may see. */
  revisions: RevisionChain["revisions"];
  /** The Revision in the panel or on the page. */
  openId: string;
  /** Opens the chosen Revision; never called for the one already open. */
  onOpen: (id: string) => void;
  /** An earlier Revision's Outcome chip, as the panel shows an Issued Code (`Outcome`). */
  outcome: (code: WorkItemOutcome) => ReactNode;
};

/** The button and its menu; a plain "Rev n" on a Draft or the only Revision seen; nothing with only the Original. */
export function RevisionPicker({ locale, labels, revisions, openId, onOpen, outcome }: RevisionPickerProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const view = revisionPicker(revisions, openId);
  const name = (revisionNo: number) => revisionName(labels.revision, revisionNo, locale);
  if (view.kind === "none") return null;
  if (view.kind === "label") {
    return <span className="sdp-rev ms-[0.35em] text-[16px] font-extrabold whitespace-nowrap text-brand-fg">{name(view.revisionNo)}</span>;
  }

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
  // Arrow keys move between the rows, Home and End to the ends; leaving by the keyboard closes it, as Esc and a click outside do (the popover).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // eslint-disable-next-line rabaed/no-avoid-terms -- the key's name, not copy
    if (event.key === "Tab") return setOpen(false);
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to =
      event.key === "ArrowDown" ? (at + 1) % all.length
      : event.key === "ArrowUp" ? (at - 1 + all.length) % all.length
      : event.key === "Home" ? 0
      : event.key === "End" ? all.length - 1
      : null;
    if (to === null) return;
    event.preventDefault();
    all[to]?.focus();
  };
  const choose = (row: RevisionPickerRow) => {
    setOpen(false);
    if (!row.open) onOpen(row.id);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="menu"
          title={labels.tooltip}
          data-revision-picker={view.past ? "past" : "latest"}
          className={cn(
            "ms-[0.35em] inline-flex h-[30px] shrink-0 items-center pointer-coarse:h-11 gap-1 rounded-[8px] ps-2.5 pe-2 align-middle text-[16px] font-extrabold whitespace-nowrap hover:ring-[1.5px] hover:ring-inset",
            view.past ? "bg-warning-tint text-warning-fg hover:ring-warning-fg" : "bg-brand-tint text-brand-fg hover:ring-brand-fg",
            focusRing,
          )}
        >
          {name(view.revisionNo)}
          <Icon name="chevron-down" size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={menu}
        role="menu"
        aria-labelledby={titleId}
        dir={directionOf(locale)}
        onKeyDown={onKeyDown}
        // The open Revision's row takes the focus, so the arrows start from it.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (items().find((el) => el.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
        }}
        className="flex w-[330px] max-w-[calc(100vw-2.5rem)] flex-col gap-0.5 rounded-[12px] p-1.5 text-[13px] font-medium"
      >
        <small id={titleId} aria-hidden="true" className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-semibold text-muted">
          {labels.title}
        </small>
        {view.rows.map((row) => (
          <button
            key={row.id}
            type="button"
            role="menuitemradio"
            aria-checked={row.open}
            tabIndex={-1}
            onClick={() => choose(row)}
            className={cn(
              "flex min-h-12 items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-start text-text hover:bg-hover",
              row.open && "bg-brand-tint hover:bg-brand-tint",
              focusRing,
            )}
          >
            <Icon name={row.open ? "check" : "point"} size={15} className={row.open ? "text-brand-fg" : "text-faint"} />
            <span className="min-w-0 flex-1">
              <b className="block text-[13.5px] font-bold">
                {name(row.revisionNo)}
                {row.current && <small className="ms-1 text-[11px] font-semibold text-muted">{labels.current}</small>}
              </b>
              {row.date && (
                <small className="block text-[12px] text-muted">{(row.date.kind === "submitted" ? labels.submitted : labels.closed)(formatDate(new Date(row.date.at), locale))}</small>
              )}
            </span>
            {row.chip.kind === "stage" ? <StagePill stage={stageColour(row.chip.stage)} label={row.chip.stage.name[locale]} /> : outcome(row.chip.outcome)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** The banner's words, from the app's messages. */
export type RevisionBannerLabels = {
  revision: RevisionNameLabels;
  /** "You are viewing Rev 1 · Code C"; without a code, "You are viewing Rev 1". */
  viewing: (name: string, code: WorkItemOutcome | null) => string;
  /** "Replaced by Rev 2. Read only — the form, attachments, chat and log exactly as they were." */
  replaced: (latest: string) => string;
  /** "Go to Rev 2". */
  goTo: (latest: string) => string;
};

export type RevisionBannerProps = {
  locale: Locale;
  labels: RevisionBannerLabels;
  /** The chain read, as the picker takes it. */
  revisions: RevisionChain["revisions"];
  openId: string;
  /** Opens the latest Revision the viewer sees. */
  onOpen: (id: string) => void;
  className?: string;
};

/**
 * The amber banner above the number while an earlier Revision is open (RP-1253, gap rows 21–23): it
 * names the latest Revision the viewer sees and goes to it. None on the latest, so a viewer who sees no
 * later Revision never learns of one.
 */
export function RevisionBanner({ locale, labels, revisions, openId, onOpen, className }: RevisionBannerProps) {
  const view = revisionPicker(revisions, openId);
  if (view.kind !== "button" || view.banner === null) return null;
  const { banner } = view;
  const latest = revisionName(labels.revision, banner.latest.revisionNo, locale);
  return (
    <div
      role="status"
      dir={directionOf(locale)}
      data-revision-banner=""
      className={cn("flex flex-wrap items-center gap-2.5 rounded-[10px] bg-warning-tint px-3 py-2.5 text-[12.5px] leading-[1.4] text-warning-fg", className)}
    >
      <Icon name="history" size={18} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <b className="block text-[13px]">{labels.viewing(revisionName(labels.revision, view.revisionNo, locale), banner.outcome)}</b>
        {labels.replaced(latest)}
      </span>
      <Button variant="secondary" size="sm" className="ms-7 shrink-0" onClick={() => onOpen(banner.latest.id)}>
        {labels.goTo(latest)}
      </Button>
    </div>
  );
}
