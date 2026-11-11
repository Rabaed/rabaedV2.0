"use client";

import { segmentValue, type NumberingAttributes, type NumberingPattern, type NumberingSegment } from "@rabaed/domain";
import { useDirection } from "@radix-ui/react-direction";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
import {
  addSegment,
  cleanText,
  comfortableLength,
  digitChoices,
  isCounted,
  maxSegments,
  moveSegment,
  removeSegment,
  replaceSegment,
  scopedKinds,
  segmentKinds,
  setCounted,
  sharesCounter,
  type SampleEntry,
  type SegmentKind,
} from "./numbering-model.ts";
import { Code, rich, toneClasses, type NumberingText } from "./numbering-text.tsx";
import { useSegmentLongPress } from "./use-segment-long-press.ts";

// The pattern editor of the Numbering page (RP-412, kit settings/numbering.js):
// the segment chips, edited in place and reordered by drag or by the arrow keys on
// a chip's handle; the "Add segment" buttons; the inline warnings; and the
// sequence options (separator, digits, scope). Used for the Project pattern and in
// the Custom pattern drawer. Without `onChange` it is the read-only view.

type EditorProps = {
  t: NumberingText;
  pattern: NumberingPattern;
  /** What the chips' example codes come from. */
  example: NumberingAttributes;
  /** Absent: read-only (a Member who isn't a Project Admin). */
  onChange?: (pattern: NumberingPattern) => void;
};

const levelKeys = ["zone", "building", "floor"] as const;

/** A segment's example code, as it would print for the example item. */
const exampleCode = (segment: NumberingSegment, example: NumberingAttributes): string => segmentValue(segment, example) ?? "—";

// On touch the handle and remove button are 44 px, so the chip's own padding shrinks around them (RP-1288);
// on a phone each chip is a card across the list.
const chipBase =
  "relative flex min-w-[130px] items-center gap-2 rounded-[10px] bg-surface py-2 ps-1.5 pe-2 shadow-[inset_0_0_0_1px_var(--border),0_1px_2px_color-mix(in_srgb,var(--shadow-colour)_5%,transparent)] pointer-coarse:py-1 pointer-coarse:ps-0.5 pointer-coarse:pe-0.5 phone:w-full";

/** The segment chips, the sequence last and locked. */
export function SegmentChips({ t, pattern, example, onChange }: EditorProps) {
  const listId = useId();
  const hintId = useId();
  const direction = useDirection();
  const [dragging, setDragging] = useState<number | null>(null);
  // A finger is carrying the segment (a long press), not the browser's drag.
  const [lifted, setLifted] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const grips = useRef<(HTMLButtonElement | null)[]>([]);
  // A move from a handle's menu: focus goes to the moved segment's handle, not back to the menu's own.
  const menuMoved = useRef(false);
  const editable = onChange !== undefined;
  const name = (kind: SegmentKind | "sequence") => t(`kinds.${kind}`);

  useEffect(() => {
    if (focusAt !== null) grips.current[focusAt]?.focus();
  }, [focusAt, pattern]);

  const movedText = (kind: SegmentKind, at: number) => t("moved", { segment: name(kind), n: at + 1, total: pattern.segments.length });

  const move = (from: number, to: number, announce: boolean) => {
    if (!onChange || to < 0 || to >= pattern.segments.length || to === from) return;
    onChange(moveSegment(pattern, from, to));
    if (announce) {
      setFocusAt(to);
      setAnnouncement(movedText(pattern.segments[from]!.kind, to));
    }
  };

  // A long press on touch (RP-1288): the lifted segment moves as the finger passes each other one.
  // It moves once the finger passes the other card's middle, so cards of different sizes don't swap back and forth.
  const liftedFrom = useRef<number | null>(null);
  const longPress = useSegmentLongPress({
    onLift: (i) => {
      liftedFrom.current = i;
      setDragging(i);
      setLifted(true);
    },
    onOver: (over, x, y) => {
      if (dragging === null || over === null || over.index === dragging) return;
      const later = over.index > dragging;
      const box = over.card.getBoundingClientRect();
      const own = over.card.closest("ol")?.querySelector(`[data-segment-index="${dragging}"]`)?.getBoundingClientRect();
      // Beside it in a row (820 and wider): along the reading direction; one under the other: down the list.
      const sameLine = own !== undefined && Math.abs(own.top - box.top) < box.height / 2;
      const ahead = sameLine ? (direction === "rtl" ? box.left + box.width / 2 - x : x - (box.left + box.width / 2)) : y - (box.top + box.height / 2);
      if (later ? ahead <= 0 : ahead >= 0) return;
      move(dragging, over.index, false);
      setDragging(over.index);
    },
    onDrop: (cancelled) => {
      // Only a move that happened is announced.
      if (dragging !== null && !cancelled && dragging !== liftedFrom.current) setAnnouncement(movedText(pattern.segments[dragging]!.kind, dragging));
      liftedFrom.current = null;
      setDragging(null);
      setLifted(false);
    },
  });

  /** Arrow keys move the chip along the reading direction; Home and End to the ends. */
  const onGripKey = (i: number) => (e: KeyboardEvent) => {
    const later = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    const earlier = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
    const to =
      e.key === later || e.key === "ArrowDown"
        ? i + 1
        : e.key === earlier || e.key === "ArrowUp"
          ? i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? pattern.segments.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    move(i, to, true);
  };

  // Each chip carries the separator after it, so a wrapped line never starts with one (the kit's trailing separator).
  // On a phone the cards stand one under the other, so there is nothing to separate (Responsive Anatomy 18).
  const separator = (
    <span aria-hidden="true" className="self-center text-sm font-bold text-faint phone:hidden">
      {pattern.separator}
    </span>
  );

  return (
    <div className="flex flex-col">
      <ol
        aria-label={t("segmentList")}
        id={listId}
        ref={longPress.listRef}
        className="flex min-h-[74px] flex-wrap items-stretch gap-2 rounded-md bg-surface-subtle p-3 shadow-[inset_0_0_0_1px_var(--border-subtle)] phone:flex-col phone:flex-nowrap"
        data-testid="segment-chips"
      >
        {pattern.segments.map((segment, i) => {
          const tone = toneClasses[segment.kind];
          const label = name(segment.kind);
          return (
            <li key={i} className="flex items-stretch gap-2 phone:w-full">
              <div
                className={cn(
                  chipBase,
                  editable && "cursor-grab hover:shadow-[inset_0_0_0_1px_var(--border-strong),0_4px_10px_color-mix(in_srgb,var(--shadow-colour)_8%,transparent)]",
                  // A long press must not select the card's words or open the browser's callout.
                  editable && "pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
                  dragging === i && (lifted ? "z-10 outline-2 outline-primary" : "opacity-35"),
                )}
                data-segment-index={i}
                {...(editable ? longPress.pressProps(i) : {})}
                draggable={editable}
                onDragStart={(e) => {
                  // A finger reorders with a long press, not the browser's drag.
                  if (longPress.pressing() || (e.target as HTMLElement).closest("input,select")) return e.preventDefault();
                  setDragging(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragOver={(e) => {
                  if (dragging === null) return;
                  e.preventDefault();
                  if (dragging !== i) {
                    move(dragging, i, false);
                    setDragging(i);
                  }
                }}
                onDrop={(e) => e.preventDefault()}
                onDragEnd={() => setDragging(null)}
                data-testid="segment-chip"
              >
                {editable && (
                  <MoveMenu t={t} label={label} at={i} count={pattern.segments.length} onMove={(to) => move(i, to, true)} movedRef={menuMoved}>
                    <button
                      ref={(el) => {
                        grips.current[i] = el;
                      }}
                      type="button"
                      aria-label={t("move", { segment: label })}
                      aria-describedby={hintId}
                      data-segment-grip=""
                      onKeyDown={onGripKey(i)}
                      onBlur={() => setFocusAt(null)}
                      className={cn(
                        "flex size-6 shrink-0 cursor-grab items-center justify-center rounded-xs text-faint hover:bg-hover pointer-coarse:size-11",
                        "data-[state=open]:bg-brand-tint data-[state=open]:text-brand-fg",
                        focusRing,
                      )}
                    >
                      <Icon name="grid-dots" size={14} />
                    </button>
                  </MoveMenu>
                )}
                <span aria-hidden="true" className={cn("h-[30px] w-1 shrink-0 rounded-[3px]", tone.solid)} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <b className="text-sm font-semibold whitespace-nowrap text-text">{label}</b>
                  <SegmentValue t={t} segment={segment} example={example} editable={editable} onChange={(s) => onChange?.(replaceSegment(pattern, i, s))} />
                </span>
                {editable && (
                  <button
                    type="button"
                    aria-label={t("remove", { segment: label })}
                    title={t("remove", { segment: label })}
                    disabled={pattern.segments.length === 1}
                    onClick={() => onChange(removeSegment(pattern, i))}
                    className={cn(
                      "ms-auto flex size-6 shrink-0 items-center justify-center rounded-[6px] text-faint hover:bg-danger-tint hover:text-danger-fg disabled:invisible pointer-coarse:size-11",
                      focusRing,
                    )}
                  >
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
              {separator}
            </li>
          );
        })}
        <li className="flex items-stretch gap-2 phone:w-full">
          {/* The lock stands where a segment's handle is on touch, so the names line up. */}
          <div className={cn(chipBase, "cursor-default bg-press pointer-coarse:min-h-[52px] pointer-coarse:ps-2")} title={t("sequenceLocked")}>
            <span aria-hidden="true" className={cn("h-[30px] w-1 shrink-0 rounded-[3px]", toneClasses.sequence.solid)} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <b className="text-sm font-semibold whitespace-nowrap text-text">{name("sequence")}</b>
              <Chip kind="sequence">{`${"0".repeat(pattern.seqDigits - 1)}1`}</Chip>
            </span>
            <Icon name="lock" size={14} className="ms-auto text-faint" aria-label={t("sequenceLocked")} />
          </div>
        </li>
      </ol>
      {editable && (
        <>
          <p id={hintId} className="sr-only">
            {t("patternHint")}
          </p>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * A tap on a segment's ⋮ opens its moves (RP-1288, the owner's (b), comment 15836): a way to reorder that needs
 * only a tap, beside the drag, the long press and the arrow keys. Those that can't apply are disabled. Keyboard:
 * Enter or Space opens it on the first move it can make; Up, Down, Home and End go between them; Escape closes it.
 */
function MoveMenu({
  t,
  label,
  at,
  count,
  onMove,
  movedRef,
  children,
}: {
  t: NumberingText;
  label: string;
  at: number;
  count: number;
  onMove: (to: number) => void;
  movedRef: { current: boolean };
  children: ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  const name = t("move", { segment: label });
  const moves = [
    { key: "moveUp", to: at - 1 },
    { key: "moveDown", to: at + 1 },
    { key: "moveTop", to: 0 },
    { key: "moveBottom", to: count - 1 },
  ] as const;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (items.length === 0) return;
    const now = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown" ? (now + 1) % items.length
      : event.key === "ArrowUp" ? (now - 1 + items.length) % items.length
      : event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : undefined;
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <Popover>
      <PopoverTrigger asChild aria-haspopup="menu">
        {children}
      </PopoverTrigger>
      <PopoverContent
        ref={list}
        aria-label={name}
        onKeyDown={onKeyDown}
        onCloseAutoFocus={(event) => {
          // After a move the handle of the moved segment takes focus (SegmentChips' focusAt).
          if (movedRef.current) event.preventDefault();
          movedRef.current = false;
        }}
        className="w-auto min-w-48 rounded-md border-border-strong p-1.5 shadow-lg"
      >
        <div role="menu" aria-label={name}>
          {moves.map(({ key, to }) => (
            <PopoverClose asChild key={key}>
              <button
                type="button"
                role="menuitem"
                disabled={to < 0 || to >= count || to === at}
                onClick={() => {
                  movedRef.current = true;
                  onMove(to);
                }}
                className={cn(
                  "flex w-full items-center rounded-sm px-2.5 py-[9px] text-start text-[13.5px] font-medium whitespace-nowrap text-text-secondary hover:bg-canvas",
                  "disabled:cursor-not-allowed disabled:text-on-disabled disabled:hover:bg-transparent pointer-coarse:min-h-11",
                  focusRing,
                )}
              >
                {t(key)}
              </button>
            </PopoverClose>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A segment's example code on its colour. */
function Chip({ kind, children }: { kind: SegmentKind | "sequence"; children: ReactNode }) {
  return (
    <bdi dir="ltr" translate="no" className={cn("self-start rounded-[5px] px-1.5 py-px text-caption font-bold", toneClasses[kind].tint, toneClasses[kind].fg)}>
      {children}
    </bdi>
  );
}

// The kit's `.mini`: a 24px control with a light inset edge, inside a chip. 44 high on touch, and 16 px text on
// a phone so the browser doesn't zoom in on it (RP-1288).
const mini = cn(
  "h-6 rounded-[5px] bg-surface px-1.5 text-caption text-text shadow-[inset_0_0_0_1px_var(--border-strong)] hover:shadow-[inset_0_0_0_1px_var(--control-border)]",
  "pointer-coarse:h-11 phone:text-base",
  focusRing,
);

/** The chip's example code; for a Project Admin, a Location's level and a fixed text are edited in place. */
function SegmentValue({
  t,
  segment,
  example,
  editable,
  onChange,
}: {
  t: NumberingText;
  segment: NumberingSegment;
  example: NumberingAttributes;
  editable: boolean;
  onChange: (segment: NumberingSegment) => void;
}) {
  if (editable && segment.kind === "text") {
    return (
      <input
        aria-label={t("text")}
        dir="ltr"
        maxLength={10}
        value={segment.text}
        onChange={(e) => {
          const text = cleanText(e.target.value);
          if (text) onChange({ kind: "text", text });
        }}
        className={cn(mini, "w-[78px] font-semibold uppercase phone:w-32")}
      />
    );
  }
  if (editable && segment.kind === "location") {
    // A native select (a phone opens its own picker), drawn as the kit's mini control with its own chevron.
    return (
      <span className="relative inline-flex self-start">
        <select
          aria-label={t("level")}
          value={segment.level}
          onChange={(e) => onChange({ kind: "location", level: Number(e.target.value) })}
          className={cn(mini, "w-auto cursor-pointer appearance-none pe-5 font-semibold")}
        >
          {levelKeys.map((key, i) => (
            <option key={key} value={i + 1}>
              {`${t(`levels.${key}`)} · \u2066${example.locationPath[i] ?? "—"}\u2069`}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={12} className="pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2 text-muted" />
      </span>
    );
  }
  return <Chip kind={segment.kind}>{exampleCode(segment, example)}</Chip>;
}

/** The "Add segment" buttons: each kind not in the pattern yet, and fixed text always. */
export function AddSegments({ t, pattern, example, onChange }: EditorProps & { onChange: (pattern: NumberingPattern) => void }) {
  const used = new Set(pattern.segments.map((s) => s.kind));
  const full = pattern.segments.length >= maxSegments;
  return (
    <div role="group" aria-label={t("addSegment")} className="mt-3 flex flex-wrap items-center gap-2">
      <small aria-hidden="true" className="me-1 text-caption font-semibold text-muted">
        {t("addSegment")}
      </small>
      {segmentKinds
        .filter((kind) => kind === "text" || !used.has(kind))
        .map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={full}
            aria-label={t("add", { segment: t(`kinds.${kind}`) })}
            onClick={() => onChange(addSegment(pattern, kind))}
            className={cn(
              "group inline-flex h-[30px] items-center gap-1.5 rounded-sm bg-surface px-2.5 text-[12.5px] font-semibold text-text-secondary pointer-coarse:h-11",
              "outline-1 -outline-offset-1 outline-border-strong outline-dashed enabled:hover:text-brand-fg enabled:hover:outline-primary",
              // Disabled: the plain muted look, no segment tone and no hover colour.
              "disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-on-disabled disabled:outline-border",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
            )}
          >
            <i aria-hidden="true" className={cn("size-2 rounded-[3px] group-disabled:bg-border-strong", toneClasses[kind].solid)} />
            {t(`kinds.${kind}`)}
            <bdi dir="ltr" aria-hidden="true" className="text-notes font-semibold text-muted group-disabled:text-on-disabled">
              {exampleCode(kind === "location" ? { kind, level: 2 } : kind === "text" ? { kind, text: "SUB" } : { kind }, example)}
            </bdi>
          </button>
        ))}
    </div>
  );
}

/** The inline warnings: a shared counter, six segments, a long number. Never blocking. */
export function PatternWarnings({ t, pattern, length, onChange }: { t: NumberingText; pattern: NumberingPattern; length: number; onChange?: (p: NumberingPattern) => void }) {
  const hasCompany = pattern.segments.some((s) => s.kind === "participant");
  const full = pattern.segments.length >= maxSegments;
  const warnings: ReactNode[] = [];
  if (sharesCounter(pattern)) {
    warnings.push(
      <Warning
        key="company"
        tone="amber"
        icon="alert-triangle"
        testId="shared-counter-warning"
        action={
          onChange &&
          (hasCompany ? (
            <Button size="sm" variant="secondary" className="bg-surface" onClick={() => onChange(setCounted(pattern, "participant", true))}>
              {t("countCompany")}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" className="bg-surface" disabled={full} onClick={() => onChange(addSegment(pattern, "participant"))}>
              <Icon name="plus" />
              {t("companySegment")}
            </Button>
          ))
        }
      >
        <b>{hasCompany ? t("companySharedTitle") : t("noCompanyTitle")}</b> {t("noCompanyBody")}
      </Warning>,
    );
  }
  if (onChange && full) {
    warnings.push(
      <Warning key="max" tone="blue" icon="info-circle" testId="max-segments">
        {t("maxSegments")}
      </Warning>,
    );
  }
  if (length > comfortableLength) {
    warnings.push(
      <Warning key="long" tone="amber" icon="ruler">
        {rich(t, "tooLong", { n: <b>{length}</b> })}
      </Warning>,
    );
  }
  return warnings.length > 0 ? <div className="mt-3 flex flex-col gap-2">{warnings}</div> : null;
}

/** The kit's `.wn`: one row of icon, text and an action at the end; the text wraps, the action stays beside it. */
function Warning({
  tone,
  icon,
  testId,
  action,
  children,
}: {
  tone: "amber" | "blue";
  icon: "alert-triangle" | "info-circle" | "ruler";
  testId?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] leading-[1.45] sm:flex-nowrap",
        tone === "amber" ? "bg-warning-tint text-warning-fg" : "bg-info-tint text-info-fg",
      )}
      data-testid={testId}
    >
      <Icon name={icon} size={17} className="mt-px shrink-0" />
      <p className="min-w-0 flex-1 basis-56">{children}</p>
      {action && <div className="-my-0.5 shrink-0 ms-auto">{action}</div>}
    </div>
  );
}

/**
 * The kit's `.segx`: a light grey track with a light edge, the chosen option a raised
 * white pill. A radio group underneath, as SegmentedControl: arrow keys follow the
 * reading direction; read-only, it still says which one is chosen.
 */
function KitSegmented({
  labelledBy,
  value,
  onChange,
  options,
}: {
  labelledBy: string;
  value: string;
  onChange?: (value: string) => void;
  options: { value: string; label: ReactNode }[];
}) {
  const readOnly = onChange === undefined;
  return (
    <RadioGroupPrimitive.Root
      aria-labelledby={labelledBy}
      aria-readonly={readOnly || undefined}
      orientation="horizontal"
      value={value}
      onValueChange={readOnly ? undefined : onChange}
      className="inline-flex w-fit gap-0.5 self-start rounded-sm bg-surface-subtle p-0.5 shadow-[inset_0_0_0_1px_var(--border)]"
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          // Read-only: the others can't be chosen, the chosen one still reads as chosen.
          disabled={readOnly && option.value !== value}
          className={cn(
            "inline-flex h-[30px] min-w-10 items-center justify-center rounded-[6px] px-3 text-[13px] font-semibold text-muted",
            "pointer-coarse:min-h-11 pointer-coarse:min-w-11",
            !readOnly && "cursor-pointer hover:text-text",
            "data-[state=checked]:bg-surface data-[state=checked]:text-text",
            "data-[state=checked]:shadow-[0_1px_2px_color-mix(in_srgb,var(--shadow-colour)_8%,transparent),inset_0_0_0_1px_var(--border)]",
            "disabled:cursor-default",
            focusRing,
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

/**
 * A sample's label, truncated as a whole with the Trade kept: the Company part gives
 * way first ("TMC Constr… · Electrical"), down to a few letters. The whole label is its
 * title, so two rows that still look alike can be told apart.
 */
export function SampleLabel({ entry, fallback, className }: { entry: SampleEntry; fallback: string; className?: string }) {
  const pieces = [entry.company, entry.trade].filter((p): p is string => p !== null);
  const whole = pieces.length === 0 ? fallback : pieces.join(" · ");
  return (
    <span title={whole} className={cn("flex min-w-0 items-center whitespace-nowrap", className)}>
      {pieces.length < 2 ? (
        <bdi className="min-w-0 truncate">{pieces[0] ?? fallback}</bdi>
      ) : (
        <>
          {/* Gives way first, down to three letters; the Trade shrinks only once the Company cannot. */}
          <bdi className="min-w-[3ch] shrink truncate">{pieces[0]}</bdi>
          <span aria-hidden="true" className="shrink-0 px-1">
            ·
          </span>
          <span className="sr-only">, </span>
          <bdi className="min-w-0 shrink-[0.001] truncate">{pieces[1]}</bdi>
        </>
      )}
    </span>
  );
}

/** Separator, digits and the sequence scope with its plain explanation and example counters. */
export function SequenceOptions({
  t,
  pattern,
  onChange,
  tradeCodes,
  examples,
  fallback,
}: {
  t: NumberingText;
  pattern: NumberingPattern;
  onChange?: (pattern: NumberingPattern) => void;
  /** Two of the Project's Trade codes, for the explanation. */
  tradeCodes: readonly string[];
  /** One per counter of the pattern (`sampleEntries` by counter): real next numbers for a Project Admin, examples from 1 for anyone else. */
  examples: readonly SampleEntry[];
  /** The label of a counter the pattern splits by nothing it shows, e.g. the Type's name. */
  fallback: string;
}) {
  const separatorId = useId();
  const digitsId = useId();
  const scopeId = useId();
  const scoped = [...new Set(pattern.segments.map((s) => s.kind))].filter((k) => scopedKinds.has(k));
  const tradeCounted = pattern.segments.some((s) => s.kind === "trade") && isCounted(pattern, "trade");
  const [a, b] = tradeCodes;
  const readOnly = onChange === undefined;
  const first = `${"0".repeat(pattern.seqDigits - 1)}1`;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <b id={separatorId} className="text-[13px] font-semibold text-text">
          {t("separator")}
        </b>
        <KitSegmented
          labelledBy={separatorId}
          value={pattern.separator}
          onChange={onChange && ((separator) => onChange({ ...pattern, separator: separator as NumberingPattern["separator"] }))}
          options={[
            { value: "-", label: <bdi dir="ltr">-</bdi> },
            { value: "/", label: <bdi dir="ltr">/</bdi> },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2">
        <b id={digitsId} className="text-[13px] font-semibold text-text">
          {t("digits")}
        </b>
        <KitSegmented
          labelledBy={digitsId}
          value={String(pattern.seqDigits)}
          onChange={onChange && ((d) => onChange({ ...pattern, seqDigits: Number(d) }))}
          options={digitChoices.map((d) => ({ value: String(d), label: d }))}
        />
        <small className="text-caption text-muted">
          {t("zeroPadded")} · <bdi dir="ltr">{`${first} … ${"9".repeat(pattern.seqDigits)}`}</bdi>
        </small>
      </div>
      <div className="flex flex-col gap-2 md:col-span-2" role="group" aria-labelledby={scopeId}>
        <b id={scopeId} className="text-[13px] font-semibold text-text">
          {t("scopeTitle")}
        </b>
        <small className="text-caption text-muted">{t("scopeHint")}</small>
        {scoped.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t("scopeNone")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {scoped.map((kind) => {
              const on = isCounted(pattern, kind);
              const tone = toneClasses[kind];
              return (
                <li key={kind}>
                  <label
                    className={cn(
                      // 44 high on touch (RP-1288), the hidden box at its centre so the whole label is its target.
                      "relative inline-flex h-[34px] items-center gap-2 rounded-sm ps-2.5 pe-3 text-[13px] select-none pointer-coarse:h-11",
                      on ? cn(tone.tint, tone.fg, "font-semibold") : "bg-surface text-text shadow-[inset_0_0_0_1px_var(--border)]",
                      !readOnly && "cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus",
                    )}
                  >
                    {/* Read-only, a disabled box still says whether it is ticked. */}
                    <input
                      type="checkbox"
                      className="sr-only pointer-coarse:inset-0 pointer-coarse:m-auto"
                      checked={on}
                      disabled={readOnly}
                      onChange={(e) => onChange?.(setCounted(pattern, kind, e.target.checked))}
                    />

                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-xs text-on-primary",
                        on ? tone.solid : "bg-surface shadow-[inset_0_0_0_1.5px_var(--border-strong)]",
                      )}
                    >
                      {on && <Icon name="check" size={11} />}
                    </span>
                    {t(`scope.${kind}`)}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {a !== undefined && b !== undefined && (
          <p className="mt-1 text-[12.5px] leading-normal text-muted" data-testid="scope-explanation">
            {tradeCounted
              ? rich(t, "scopeSeparate", { a: <Code>{`…${a}…-${first}`}</Code>, b: <Code>{`…${b}…-${first}`}</Code> })
              : rich(t, "scopeShared", { a: <Code>{a}</Code>, b: <Code>{b}</Code> })}
          </p>
        )}
        {examples.length > 0 && (
          <ul aria-label={t("scopeExamples")} className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2" data-testid="scope-examples">
            {examples.map((e, i) => (
              <li
                key={i}
                className="flex min-w-0 items-center gap-2 rounded-sm bg-surface-subtle px-2.5 py-2 text-caption text-muted shadow-[inset_0_0_0_1px_var(--border-subtle)]"
              >
                <SampleLabel entry={e} fallback={fallback} />
                <b className="ms-auto shrink-0 font-bold whitespace-nowrap text-text tabular-nums">
                  <bdi dir="ltr">→ {e.next}</bdi>
                </b>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
