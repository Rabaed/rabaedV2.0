"use client";

import type { Locale, OutcomeLook } from "@rabaed/domain";
import { Fragment, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Badge } from "../data/badge.tsx";
import { Button } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
import { CodeTile } from "../work-item-page/page-parts.tsx";
import type { SubmittalPanelBarChip } from "./action-bar-model.ts";

/**
 * The Submittal Panel's action bar parts (RP-1237, gap table v3 rows 22–27 and 48–51; the owner's
 * Submittal Panel Anatomy V3, part 9): the "Issue Review Code ▾" menu, which opens upward with the
 * code Transitions, a divider and any other one (a Send Back), and the chip that says where the item
 * waits when the viewer has nothing to press. Presentational: the app fills them from what the engine
 * offers (`submittalPanelBar`) and opens each Transition's Action Form.
 */

export type SubmittalPanelCodeMenuItem = {
  /** The Transition's key, given back to `onSelect`. */
  key: string;
  /** The Review Code it issues; none for a Transition that issues no code. */
  code?: string;
  /** The code's place in its Type's set (`outcomeLook`): its tile's colour. */
  look?: OutcomeLook | undefined;
  /** The Workflow's own label for it. */
  title: string;
  /** What it does, in one line: who is told, whether a Revision follows. */
  line?: string | undefined;
  /** The code a checklist proposes (RP-86): its badge's words. */
  proposed?: string | undefined;
};

export type SubmittalPanelCodeMenuProps = {
  /** The button's and the menu's name: "Issue Review Code". */
  label: string;
  codes: readonly SubmittalPanelCodeMenuItem[];
  /** Below the divider: an offered Transition that issues no code (a Send Back). */
  others?: readonly SubmittalPanelCodeMenuItem[];
  onSelect: (key: string) => void;
  disabled?: boolean;
  /** Waiting before a Transition can open (its Signature and Stamp checks). */
  busy?: boolean;
};

const itemClass =
  "flex w-full items-start gap-3 rounded-sm px-2.5 py-2.5 text-start hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11";

/**
 * "Issue Review Code ▾" (rows 23, 24): the bar's primary, last. Opens upward; Up, Down, Home and End
 * move between the choices, Escape closes it back to the button. Each choice opens its Action Form.
 */
export function SubmittalPanelCodeMenu({ label, codes, others = [], onSelect, disabled = false, busy = false }: SubmittalPanelCodeMenuProps) {
  const list = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown" ? (at + 1) % items.length
      : event.key === "ArrowUp" ? (at - 1 + items.length) % items.length
      : event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : undefined;
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  }
  const item = (choice: SubmittalPanelCodeMenuItem, icon?: IconName) => (
    <PopoverClose asChild key={choice.key}>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => onSelect(choice.key)} className={cn(itemClass, focusRing)}>
        {choice.code ? (
          <CodeTile code={choice.code} look={choice.look} size="lg" />
        ) : (
          <span aria-hidden="true" className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-muted shadow-[inset_0_0_0_1px_var(--border-subtle)]">
            <Icon name={icon ?? "message"} size={17} />
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-text">
            {choice.title}
            {choice.proposed && <Badge tone="neutral">{choice.proposed}</Badge>}
          </span>
          {choice.line && <span className="text-[12.5px] leading-snug text-muted">{choice.line}</span>}
        </span>
      </button>
    </PopoverClose>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button disabled={disabled} aria-haspopup="menu" aria-busy={busy || undefined} className="gap-2" data-code-menu="">
          <Icon name="gavel" size={17} />
          {label}
          <Icon name="chevron-down" size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={list}
        side="top"
        align="end"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="w-[min(380px,calc(100vw-32px))] rounded-[12px] border-border-strong p-1.5 shadow-lg"
      >
        <div role="menu" aria-label={label}>
          <p aria-hidden="true" className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-bold tracking-[0.06em] text-muted uppercase">
            {label}
          </p>
          {codes.map((choice) => item(choice))}
          {others.length > 0 && (
            <>
              <div role="separator" className="mx-2.5 my-1 h-px bg-border-subtle" />
              {others.map((choice) => (
                <Fragment key={choice.key}>{item(choice, "message")}</Fragment>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type SubmittalPanelBarChipLabels = {
  /** "In the review pool · 3". */
  pool: (count: number) => string;
  /** "Picked up by Ahmed · 1 week": its Step Age in weeks, or the name alone when it doesn't age. */
  pickedUp: (name: string, weeks: number | null) => string;
  viewOnly: string;
};

/**
 * Where the item waits, when the bar has nothing (else) to press (rows 26, 48, 51): the viewer's own
 * Step Pool and how many it waits on, who of their own Company picked it up, or "View only". Another
 * Company is never named by a person (V14): the read gives no name for it, so it reads "View only".
 */
export function SubmittalPanelWaiting({ chip, labels, locale }: { chip: SubmittalPanelBarChip; labels: SubmittalPanelBarChipLabels; locale: Locale }): ReactNode {
  const [icon, text]: [IconName, string] =
    chip.kind === "pool"
      ? ["users", labels.pool(chip.count)]
      : chip.kind === "pickedUp"
        ? ["lock", labels.pickedUp(chip.name[locale], chip.weeks)]
        : ["eye", labels.viewOnly];
  return (
    <span
      data-bar-chip={chip.kind}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold",
        chip.kind === "pool" ? "bg-brand-tint text-brand-fg" : "text-text-secondary",
      )}
    >
      <Icon name={icon} size={15} className="shrink-0" />
      <span>{text}</span>
    </span>
  );
}
