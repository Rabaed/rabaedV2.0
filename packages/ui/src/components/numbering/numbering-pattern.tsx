"use client";

import {
  countsByParticipant,
  formatNumber,
  documentNumbering,
  numberingPattern,
  type Locale,
  type NumberingAttributes,
  type NumberingPattern,
  type NumberingSegment,
} from "@rabaed/domain";
import { useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, IconButton } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Checkbox } from "../form/checkbox.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Select } from "../form/select.tsx";
import { Icon } from "../icon/icon.tsx";

// The Numbering Pattern builder and its read-only view (RP-313; GLOSSARY.md,
// Numbering Pattern; workflow-engine.md §8 "Settled 2026-10-05 (Document
// numbering)"). Up to six segments, a separator, 3–7 sequence digits and the
// segments the sequence counts separately for, with a live example built by the
// same domain function the database copies. A pattern whose sequence doesn't
// count by the Participant Code saves only with the shared-counter warning
// accepted (visibility.md, Document Numbers). Presentational: the page passes the
// saved pattern and the example's attributes, and saves through `onSave`.

type Kind = NumberingSegment["kind"];
const kinds: Kind[] = ["project", "type", "trade", "participant", "location", "text"];
const maxSegments = 6;
const digitChoices = [3, 4, 5, 6, 7];

/** The pattern builder's and the read-only view's words, from the app's messages. A number is given already formatted for the locale. */
export type NumberingPatternLabels = {
  kinds: Record<Kind, string>;
  /** The Location levels, from the top: Zone, Building, Floor. */
  levels: readonly [string, string, string];
  segments: string;
  segment: (n: string) => string;
  level: string;
  text: string;
  textHint: string;
  textInvalid: string;
  counted: string;
  countedHint: string;
  moveUp: (n: string) => string;
  moveDown: (n: string) => string;
  remove: (n: string) => string;
  add: string;
  separator: string;
  digits: string;
  example: string;
  exampleHint: string;
  sharedTitle: string;
  sharedBody: string;
  sharedAccept: string;
  sharedReadOnly: string;
  save: string;
  saving: string;
  afterChange: string;
  countedBadge: string;
};

type Text = NumberingPatternLabels;

const segmentName = (text: Text, s: NumberingSegment) =>
  s.kind === "location" ? `${text.kinds.location}: ${text.levels[s.level - 1]}` : s.kind === "text" ? `${text.kinds.text}: ${s.text}` : text.kinds[s.kind];

const newSegment = (kind: Kind): NumberingSegment =>
  kind === "location" ? { kind, level: 1 } : kind === "text" ? { kind, text: "SUB" } : { kind };

/** The live example: the first number the pattern gives the example item. */
function Example({ text, pattern, example }: { text: Text; pattern: NumberingPattern; example: NumberingAttributes }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={`${id}-label`} className="text-body font-medium text-text">
        {text.example}
      </span>
      <output aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} className="text-h6" data-testid="numbering-example">
        <DocNo value={documentNumbering(pattern, example).number(1)} />
      </output>
      <span id={`${id}-hint`} className="text-sm text-muted">
        {text.exampleHint}
      </span>
    </div>
  );
}

export type NumberingPatternViewProps = {
  labels: NumberingPatternLabels;
  /** The pattern in effect: the saved one, or the Rabaed Default. */
  pattern: NumberingPattern;
  /** What the live example is built from. */
  example: NumberingAttributes;
  className?: string;
};

/** A Numbering Pattern read-only, as every Project Member sees it. */
export function NumberingPatternView({ labels: text, pattern, example, className }: NumberingPatternViewProps) {
  const listId = useId();
  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="numbering-pattern-view">
      <Example text={text} pattern={pattern} example={example} />
      <div className="flex flex-col gap-2">
        <span id={listId} className="text-body font-medium text-text">
          {text.segments}
        </span>
        <ol aria-labelledby={listId} className="flex flex-col divide-y divide-border rounded-md border border-border">
          {pattern.segments.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>{segmentName(text, s)}</span>
              {pattern.countedBy.includes(i) && <Badge tone="info">{text.countedBadge}</Badge>}
            </li>
          ))}
        </ol>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">{text.separator}</dt>
        <dd>
          <bdi dir="ltr">{pattern.separator}</bdi>
        </dd>
        <dt className="text-muted">{text.digits}</dt>
        <dd>{pattern.seqDigits}</dd>
      </dl>
      {!countsByParticipant(pattern) && (
        <p className="flex items-start gap-2 text-sm text-text">
          <Icon name="alert-triangle" size={16} className="mt-0.5 shrink-0 text-warning-fg" />
          {text.sharedReadOnly}
        </p>
      )}
    </div>
  );
}

export type NumberingPatternBuilderProps = {
  labels: NumberingPatternLabels;
  locale: Locale;
  /** Where the builder starts: the saved pattern, or the Rabaed Default. */
  pattern: NumberingPattern;
  /** What the live example is built from. */
  example: NumberingAttributes;
  /** Saves the pattern; `sharedCounterAccepted` is true only when the warning applies and was accepted. */
  onSave: (pattern: NumberingPattern, sharedCounterAccepted: boolean) => void | Promise<void>;
  pending?: boolean;
  /** Why the last save was refused. */
  error?: ReactNode;
  className?: string;
};

/** The Project Admin's Numbering Pattern builder, with its live example and the shared-counter warning. */
export function NumberingPatternBuilder({ locale, labels: text, pattern: initial, example, onSave, pending = false, error, className }: NumberingPatternBuilderProps) {
  const id = useId();
  const [pattern, setPattern] = useState<NumberingPattern>(initial);
  const [accepted, setAccepted] = useState(false);
  const shared = !countsByParticipant(pattern);
  const valid = numberingPattern.safeParse(pattern).success;

  const setSegments = (segments: NumberingSegment[], countedBy: number[]) => setPattern({ ...pattern, segments, countedBy });
  const replace = (i: number, segment: NumberingSegment) =>
    setSegments(pattern.segments.map((s, j) => (j === i ? segment : s)), pattern.countedBy);
  const toggleCounted = (i: number, counted: boolean) =>
    setSegments(pattern.segments, counted ? [...pattern.countedBy, i].sort() : pattern.countedBy.filter((j) => j !== i));
  /** Moves segment `i` to `to`, keeping each segment's tick with it. */
  const move = (i: number, to: number) => {
    const order = pattern.segments.map((_, j) => j);
    order.splice(to, 0, ...order.splice(i, 1));
    setSegments(
      order.map((j) => pattern.segments[j]!),
      order.flatMap((j, at) => (pattern.countedBy.includes(j) ? [at] : [])),
    );
  };
  const remove = (i: number) =>
    setSegments(
      pattern.segments.filter((_, j) => j !== i),
      pattern.countedBy.filter((j) => j !== i).map((j) => (j > i ? j - 1 : j)),
    );
  const add = () => {
    const unused = kinds.find((k) => k !== "text" && !pattern.segments.some((s) => s.kind === k)) ?? "text";
    setSegments([...pattern.segments, newSegment(unused)], pattern.countedBy);
  };

  const kindOptions = kinds.map((k) => ({ value: k, label: text.kinds[k] }));
  const levelOptions = text.levels.map((label, i) => ({ value: String(i + 1), label }));

  return (
    <form
      className={cn("flex flex-col gap-6", className)}
      data-testid="numbering-pattern-builder"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && (!shared || accepted)) void onSave(pattern, shared && accepted);
      }}
    >
      <Example text={text} pattern={pattern} example={example} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-body font-medium text-text">{text.segments}</legend>
        <ol className="flex flex-col gap-3">
          {pattern.segments.map((s, i) => {
            const n = i + 1;
            const textInvalid = s.kind === "text" && !/^[A-Z0-9]{1,10}$/.test(s.text);
            return (
              <li key={i} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3" data-testid="numbering-segment">
                <Field label={text.segment(formatNumber(n, locale))} id={`${id}-kind-${i}`} className="min-w-44">
                  <Select options={kindOptions} value={s.kind} onValueChange={(k) => replace(i, newSegment(k as Kind))} />
                </Field>
                {s.kind === "location" && (
                  <Field label={text.level} id={`${id}-level-${i}`} className="min-w-32">
                    <Select
                      options={levelOptions}
                      value={String(s.level)}
                      onValueChange={(level) => replace(i, { kind: "location", level: Number(level) })}
                    />
                  </Field>
                )}
                {s.kind === "text" && (
                  <Field label={text.text} id={`${id}-text-${i}`} help={text.textHint} error={textInvalid ? text.textInvalid : undefined} className="w-44">
                    <Input
                      dir="ltr"
                      maxLength={10}
                      value={s.text}
                      onChange={(e) => replace(i, { kind: "text", text: e.target.value.toUpperCase() })}
                    />
                  </Field>
                )}
                <Field label={text.counted} layout="inline" id={`${id}-counted-${i}`} className="h-9">
                  <Checkbox checked={pattern.countedBy.includes(i)} onCheckedChange={(c) => toggleCounted(i, c === true)} />
                </Field>
                <div className="ms-auto flex gap-1">
                  <IconButton label={text.moveUp(formatNumber(n, locale))} disabled={i === 0} onClick={() => move(i, i - 1)}>
                    <Icon name="arrow-up" />
                  </IconButton>
                  <IconButton label={text.moveDown(formatNumber(n, locale))} disabled={i === pattern.segments.length - 1} onClick={() => move(i, i + 1)}>
                    <Icon name="arrow-down" />
                  </IconButton>
                  <IconButton label={text.remove(formatNumber(n, locale))} disabled={pattern.segments.length === 1} onClick={() => remove(i)}>
                    <Icon name="trash" />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="text-sm text-muted">{text.countedHint}</p>
        <Button variant="secondary" className="w-fit" disabled={pattern.segments.length >= maxSegments} onClick={add}>
          <Icon name="plus" />
          {text.add}
        </Button>
      </fieldset>

      <div className="flex flex-wrap gap-6">
        <Field label={text.separator} group>
          <SegmentedControl
            options={[
              { value: "-", label: <bdi dir="ltr">-</bdi> },
              { value: "/", label: <bdi dir="ltr">/</bdi> },
            ]}
            value={pattern.separator}
            onValueChange={(separator) => setPattern({ ...pattern, separator: separator as NumberingPattern["separator"] })}
          />
        </Field>
        <Field label={text.digits} group>
          <SegmentedControl
            options={digitChoices.map((d) => ({ value: String(d), label: String(d) }))}
            value={String(pattern.seqDigits)}
            onValueChange={(d) => setPattern({ ...pattern, seqDigits: Number(d) })}
          />
        </Field>
      </div>

      {shared && (
        <div role="group" aria-labelledby={`${id}-shared`} className="flex flex-col gap-3 rounded-md bg-warning-tint p-4" data-testid="shared-counter-warning">
          <p id={`${id}-shared`} className="flex items-center gap-2 font-semibold text-text">
            <Icon name="alert-triangle" size={18} className="shrink-0 text-warning-fg" />
            {text.sharedTitle}
          </p>
          <p className="text-sm text-text">{text.sharedBody}</p>
          <Field label={text.sharedAccept} layout="inline" id={`${id}-accept`}>
            <Checkbox checked={accepted} onCheckedChange={(c) => setAccepted(c === true)} />
          </Field>
        </div>
      )}

      <p className="text-sm text-muted">{text.afterChange}</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="w-fit" disabled={pending || !valid || (shared && !accepted)}>
        {pending ? text.saving : text.save}
      </Button>
    </form>
  );
}
