"use client";

import { segmentValue, type NumberingAttributes, type NumberingPattern, type NumberingSegment } from "@rabaed/domain";
import { useDirection } from "@radix-ui/react-direction";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Icon } from "../icon/icon.tsx";
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
  type SegmentKind,
} from "./numbering-model.ts";
import { Code, rich, toneClasses, type NumberingText } from "./numbering-text.tsx";

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

const chipBase =
  "relative flex min-w-[130px] items-center gap-2 rounded-[10px] bg-surface py-2 ps-1.5 pe-2 shadow-[inset_0_0_0_1px_var(--border),0_1px_2px_color-mix(in_srgb,var(--shadow-colour)_5%,transparent)]";

/** The segment chips, the sequence last and locked. */
export function SegmentChips({ t, pattern, example, onChange }: EditorProps) {
  const listId = useId();
  const hintId = useId();
  const direction = useDirection();
  const [dragging, setDragging] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const grips = useRef<(HTMLButtonElement | null)[]>([]);
  const editable = onChange !== undefined;
  const name = (kind: SegmentKind | "sequence") => t(`kinds.${kind}`);

  useEffect(() => {
    if (focusAt !== null) grips.current[focusAt]?.focus();
  }, [focusAt, pattern]);

  const move = (from: number, to: number, announce: boolean) => {
    if (!onChange || to < 0 || to >= pattern.segments.length || to === from) return;
    onChange(moveSegment(pattern, from, to));
    if (announce) {
      setFocusAt(to);
      setAnnouncement(t("moved", { segment: name(pattern.segments[from]!.kind), n: to + 1, total: pattern.segments.length }));
    }
  };

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

  const separator = (
    <span aria-hidden="true" className="self-center font-bold text-faint">
      {pattern.separator}
    </span>
  );

  return (
    <div className="flex flex-col">
      <ol
        aria-label={t("segmentList")}
        id={listId}
        className="flex min-h-[74px] flex-wrap items-stretch gap-2 rounded-md bg-surface-subtle p-3 shadow-[inset_0_0_0_1px_var(--border-subtle)]"
        data-testid="segment-chips"
      >
        {pattern.segments.map((segment, i) => {
          const tone = toneClasses[segment.kind];
          const label = name(segment.kind);
          return (
            <li key={i} className="flex items-stretch gap-2">
              {i > 0 && separator}
              <div
                className={cn(
                  chipBase,
                  editable && "cursor-grab hover:shadow-[inset_0_0_0_1px_var(--border-strong),0_4px_10px_color-mix(in_srgb,var(--shadow-colour)_8%,transparent)]",
                  dragging === i && "opacity-35",
                )}
                draggable={editable}
                onDragStart={(e) => {
                  if ((e.target as HTMLElement).closest("input,select")) return e.preventDefault();
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
                  <button
                    ref={(el) => {
                      grips.current[i] = el;
                    }}
                    type="button"
                    aria-label={t("move", { segment: label })}
                    aria-describedby={hintId}
                    onKeyDown={onGripKey(i)}
                    onBlur={() => setFocusAt(null)}
                    className={cn("flex size-6 cursor-grab items-center justify-center rounded-xs text-faint hover:bg-hover", focusRing)}
                  >
                    <Icon name="grid-dots" size={14} />
                  </button>
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
                      "ms-auto flex size-6 items-center justify-center rounded-[6px] text-faint hover:bg-danger-tint hover:text-danger-fg disabled:invisible",
                      focusRing,
                    )}
                  >
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
        <li className="flex items-stretch gap-2">
          {separator}
          <div className={cn(chipBase, "cursor-default bg-press")} title={t("sequenceLocked")}>
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

/** A segment's example code on its colour. */
function Chip({ kind, children }: { kind: SegmentKind | "sequence"; children: ReactNode }) {
  return (
    <bdi dir="ltr" translate="no" className={cn("self-start rounded-[5px] px-1.5 py-px text-caption font-bold", toneClasses[kind].tint, toneClasses[kind].fg)}>
      {children}
    </bdi>
  );
}

const mini = cn("h-6 rounded-[5px] border border-control-border bg-surface px-1.5 text-caption text-text", focusRing);

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
        className={cn(mini, "w-[78px] font-semibold uppercase")}
      />
    );
  }
  if (editable && segment.kind === "location") {
    return (
      <select
        aria-label={t("level")}
        value={segment.level}
        onChange={(e) => onChange({ kind: "location", level: Number(e.target.value) })}
        className={cn(mini, "w-auto")}
      >
        {levelKeys.map((key, i) => (
          <option key={key} value={i + 1}>
            {`${t(`levels.${key}`)} · \u2066${example.locationPath[i] ?? "—"}\u2069`}
          </option>
        ))}
      </select>
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
              "inline-flex h-[30px] items-center gap-1.5 rounded-sm bg-surface px-2.5 text-[12.5px] font-semibold text-text-secondary",
              "outline-1 -outline-offset-1 outline-border-strong outline-dashed hover:text-brand-fg hover:outline-primary",
              "disabled:cursor-not-allowed disabled:opacity-45",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
            )}
          >
            <i aria-hidden="true" className={cn("size-2 rounded-[3px]", toneClasses[kind].solid)} />
            {t(`kinds.${kind}`)}
            <bdi dir="ltr" aria-hidden="true" className="text-notes font-semibold text-muted">
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
      <Warning key="company" tone="amber" icon="alert-triangle" testId="shared-counter-warning">
        <span>
          <b>{hasCompany ? t("companySharedTitle") : t("noCompanyTitle")}</b> {t("noCompanyBody")}
        </span>
        {onChange &&
          (hasCompany ? (
            <Button size="sm" variant="secondary" className="ms-auto bg-surface" onClick={() => onChange(setCounted(pattern, "participant", true))}>
              {t("countCompany")}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" className="ms-auto bg-surface" disabled={full} onClick={() => onChange(addSegment(pattern, "participant"))}>
              <Icon name="plus" />
              {t("companySegment")}
            </Button>
          ))}
      </Warning>,
    );
  }
  if (onChange && full) {
    warnings.push(
      <Warning key="max" tone="blue" icon="info-circle">
        <span>{t("maxSegments")}</span>
      </Warning>,
    );
  }
  if (length > comfortableLength) {
    warnings.push(
      <Warning key="long" tone="amber" icon="ruler">
        <span>{rich(t, "tooLong", { n: <b>{length}</b> })}</span>
      </Warning>,
    );
  }
  return warnings.length > 0 ? <div className="mt-3 flex flex-col gap-2">{warnings}</div> : null;
}

function Warning({ tone, icon, testId, children }: { tone: "amber" | "blue"; icon: "alert-triangle" | "info-circle" | "ruler"; testId?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-sm leading-[1.45]",
        tone === "amber" ? "bg-warning-tint text-warning-fg" : "bg-info-tint text-info-fg",
      )}
      data-testid={testId}
    >
      <Icon name={icon} size={17} className="mt-px shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2.5">{children}</div>
    </div>
  );
}

export type ScopeExample = { label: string; next: string };

/** Separator, digits and the sequence scope with its plain explanation and example counters. */
export function SequenceOptions({
  t,
  pattern,
  onChange,
  tradeCodes,
  examples,
}: {
  t: NumberingText;
  pattern: NumberingPattern;
  onChange?: (pattern: NumberingPattern) => void;
  /** Two of the Project's Trade codes, for the explanation. */
  tradeCodes: readonly string[];
  /** The next number of a few counters: real for a Project Admin, examples from 1 for anyone else. */
  examples: readonly ScopeExample[];
}) {
  const separatorId = useId();
  const digitsId = useId();
  const scopeId = useId();
  const scoped = [...new Set(pattern.segments.map((s) => s.kind))].filter((k) => scopedKinds.has(k));
  const hasTrade = pattern.segments.some((s) => s.kind === "trade");
  const [a, b] = tradeCodes;
  const readOnly = onChange === undefined;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <b id={separatorId} className="text-sm font-semibold text-text">
          {t("separator")}
        </b>
        <SegmentedControl
          aria-labelledby={separatorId}
          readOnly={readOnly}
          value={pattern.separator}
          onValueChange={(separator) => onChange?.({ ...pattern, separator: separator as NumberingPattern["separator"] })}
          options={[
            { value: "-", label: <bdi dir="ltr" className="min-w-4 font-semibold">-</bdi> },
            { value: "/", label: <bdi dir="ltr" className="min-w-4 font-semibold">/</bdi> },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2">
        <b id={digitsId} className="text-sm font-semibold text-text">
          {t("digits")}
        </b>
        <SegmentedControl
          aria-labelledby={digitsId}
          readOnly={readOnly}
          value={String(pattern.seqDigits)}
          onValueChange={(d) => onChange?.({ ...pattern, seqDigits: Number(d) })}
          options={digitChoices.map((d) => ({ value: String(d), label: <span className="min-w-4 font-semibold">{d}</span> }))}
        />
        <small className="text-caption text-muted">
          {t("zeroPadded")} ·{" "}
          <bdi dir="ltr">
            {`${"0".repeat(pattern.seqDigits - 1)}1 … ${"9".repeat(pattern.seqDigits)}`}
          </bdi>
        </small>
      </div>
      <div className="flex flex-col gap-2 md:col-span-2" role="group" aria-labelledby={scopeId}>
        <b id={scopeId} className="text-sm font-semibold text-text">
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
                      "inline-flex h-[34px] items-center gap-2 rounded-sm ps-2.5 pe-3 text-sm select-none",
                      on ? cn(tone.tint, tone.fg, "font-semibold") : "bg-surface text-text shadow-[inset_0_0_0_1px_var(--border)]",
                      !readOnly && "cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus",
                    )}
                  >
                    {/* Read-only, a disabled box still says whether it is ticked. */}
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      disabled={readOnly}
                      onChange={(e) => onChange?.(setCounted(pattern, kind, e.target.checked))}
                    />

                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-xs text-on-primary",
                        on ? tone.solid : "bg-surface shadow-[inset_0_0_0_1.5px_var(--control-border)]",
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
        {hasTrade && a !== undefined && b !== undefined && (
          <p className="mt-1 text-[12.5px] leading-normal text-muted">
            {isCounted(pattern, "trade")
              ? rich(t, "scopeSeparate", { a: <Code>{`…${a}…-${"0".repeat(pattern.seqDigits - 1)}1`}</Code>, b: <Code>{`…${b}…-${"0".repeat(pattern.seqDigits - 1)}1`}</Code> })
              : rich(t, "scopeShared", { a: <Code>{a}</Code>, b: <Code>{b}</Code> })}
          </p>
        )}
        {examples.length > 0 && (
          <ul aria-label={t("scopeExamples")} className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2" data-testid="scope-examples">
            {examples.map((e, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-sm bg-surface-subtle px-2.5 py-2 text-caption text-muted shadow-[inset_0_0_0_1px_var(--border-subtle)]"
              >
                <span className="min-w-0 truncate">{e.label}</span>
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
