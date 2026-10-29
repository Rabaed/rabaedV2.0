"use client";

import type { DocumentNumberSegments } from "@rabaed/domain";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { PatternNumber, toneClasses } from "../numbering/numbering-text.tsx";
import { submittalNumberCard, type SubmittalNumberSegment } from "./number-card-model.ts";

export type SubmittalPanelNumberCardLabels = {
  /** "How this number is built": the ⓘ's name and the card's title. */
  title: string;
  /** "Set by the Project's Numbering Pattern. The number never changes; Revisions add Rev 1, Rev 2…" */
  footnote: string;
  /** What kind of part it is, e.g. "Participant Code". */
  kind: (segment: SubmittalNumberSegment) => string;
  /** What it stands for, e.g. "TMC Constructions' Participant Code" (its value is shown before it). */
  line: (segment: SubmittalNumberSegment) => string;
};

export type SubmittalPanelNumberCardProps = {
  /** The item read's `numberSegments`; none hides the ⓘ. */
  segments: DocumentNumberSegments | undefined;
  labels: SubmittalPanelNumberCardLabels;
  className?: string;
};

/** How long the card stays once the pointer leaves, so it can cross the gap to the card. */
const leaveDelay = 150;

/**
 * The ⓘ next to the big number and its "How this number is built" card (RP-1065, README §4.3,
 * gaps A15 and A16): it opens on hover and on keyboard focus, and Esc closes it before the
 * panel. The number is coloured by part only inside the card (the headline stays monochrome),
 * left to right in Arabic too. It sits in the identity's number row (`numberInfo`), which
 * places the card under the number.
 */
export function SubmittalPanelNumberCard({ segments, labels, className }: SubmittalPanelNumberCardProps) {
  const card = submittalNumberCard(segments);
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stay = () => clearTimeout(leaving.current);
  useEffect(() => () => clearTimeout(leaving.current), []);
  // Esc closes the open card first, wherever the focus is (a hover opens it with the focus on
  // the panel): taken before the panel's own listener, which then sees it taken and stays open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);
  if (!card) return null;

  const show = () => {
    stay();
    setOpen(true);
  };
  // The pointer leaving closes it, unless the keyboard's focus is still on the ⓘ.
  const hideSoon = () => {
    stay();
    if (wrapper.current?.contains(document.activeElement)) return;
    leaving.current = setTimeout(() => setOpen(false), leaveDelay);
  };
  return (
    <span
      ref={wrapper}
      className={cn("sdp-number-info inline-flex shrink-0", className)}
      onPointerEnter={show}
      onPointerLeave={hideSoon}
      onFocus={show}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={labels.title}
        aria-describedby={id}
        className="w-8 px-0 text-muted hover:text-text pointer-coarse:min-w-11"
        // A tap opens it too (a touch screen has no hover); a tap elsewhere or Esc closes it.
        onClick={show}
      >
        <Icon name="info-circle" size={18} />
      </Button>
      <div
        id={id}
        role="tooltip"
        hidden={!open}
        data-number-card=""
        className="absolute start-0 top-full z-20 mt-1.5 flex w-[min(360px,100%)] flex-col gap-3 rounded-[12px] bg-surface p-3.5 text-start text-[12px] leading-[1.4] font-normal text-muted shadow-lg ring-1 ring-border"
      >
        <p className="text-[13px] font-bold text-text">{labels.title}</p>
        <PatternNumber parts={card.parts} separator={card.separator} className="text-[17px] font-extrabold" />
        <ul className="flex flex-col gap-2">
          {card.lines.map((segment, i) => (
            <li key={i} data-segment={segment.kind} className="grid grid-cols-[10px_minmax(0,1fr)] gap-2">
              <span aria-hidden="true" className={cn("mt-1 size-2 rounded-full", toneClasses[segment.kind].solid)} />
              <span className="min-w-0">
                <b className="block font-bold text-text">{labels.kind(segment)}</b>
                <bdi dir="ltr" translate="no" className="font-semibold text-text">
                  {segment.value}
                </bdi>
                : {labels.line(segment)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11.5px] leading-[1.45]">{labels.footnote}</p>
      </div>
    </span>
  );
}
