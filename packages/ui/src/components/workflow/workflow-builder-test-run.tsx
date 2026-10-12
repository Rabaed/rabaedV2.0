"use client";

import {
  conditionFields,
  evaluateCondition,
  formatNumber,
  formFields,
  readsAttrs,
  ruleFieldsOf,
  type Condition,
  type FormSchema,
  type Locale,
  type RuleField,
  type WorkflowDefinition,
  type WorkflowTransition,
} from "@rabaed/domain";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import type { WorkflowBuilderLabels } from "./workflow-builder-labels.ts";

/** Where a test run is: the Step it is at, the Steps and Transitions it has been through. */
export type TestRun = { at: string; path: string[]; edges: string[] };
/** A test run's sample answers, by field key, for the fields the draft's Restrict conditions read. */
export type Sample = Record<string, unknown>;

/** The plain Restrict conditions of a Transition: those a test run can check with sample answers (none reading an item attribute). */
function sampledConditions(t: WorkflowTransition): Condition[] {
  return (t.rules?.restrict ?? []).flatMap((r) => (r.type === "condition" && !readsAttrs(r.condition) ? [r.condition] : []));
}

/** The Form fields the draft's Restrict conditions read, in the order first read (a field the Form lacks is a publish problem, not sampled). */
export function sampledFields(definition: WorkflowDefinition, form: FormSchema | null): RuleField[] {
  const known = ruleFieldsOf(form, null);
  const keys = [...new Set(definition.transitions.flatMap((t) => sampledConditions(t).flatMap(conditionFields)))];
  return keys.flatMap((key) => known.filter((f) => f.key === key));
}

/** A round sample beyond a threshold, as the reference's 620,000 past 500,000 (and 120,000 under it). */
function roundBeyond(value: number, op: string): number {
  if (value <= 0) return op === "<" ? value - 1 : value + 1;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
  return op === ">" || op === ">=" ? Math.ceil((value * 1.24) / step) * step : op === "<" || op === "<=" ? Math.floor((value * 0.24) / step) * step : value;
}

/** Sample answers that make the first condition on each field hold, so a test run starts on its conditional route. */
export function defaultSample(definition: WorkflowDefinition, fields: readonly RuleField[]): Sample {
  const out: Sample = {};
  const visit = (c: Condition) => {
    if ("all" in c) return c.all.forEach(visit);
    if ("any" in c) return c.any.forEach(visit);
    if ("not" in c) return visit(c.not);
    if (c.field === undefined || c.field in out || !("value" in c)) return;
    const value = Array.isArray(c.value) ? c.value[0] : c.value;
    out[c.field] = typeof value === "number" ? roundBeyond(value, c.op) : value;
  };
  for (const t of definition.transitions) sampledConditions(t).forEach(visit);
  for (const f of fields) if (!(f.key in out)) out[f.key] = f.type === "yes_no" ? true : "";
  return out;
}

/** Whether a test run offers `t` with `sample`: every plain Restrict condition holds; other rules aren't sampled. */
export function offeredWith(t: WorkflowTransition, sample: Sample): boolean {
  return sampledConditions(t).every((c) => evaluateCondition(c, { fields: sample }));
}

type TestRunBarProps = {
  run: TestRun;
  definition: WorkflowDefinition;
  /** The fields the conditions read, and their sample answers. */
  fields: readonly RuleField[];
  form: FormSchema | null;
  sample: Sample;
  onSample: (key: string, value: unknown) => void;
  /** The Work Item Type's code, before the sample ("MAR · Cost impact"). */
  typeCode?: string | undefined;
  /** Whether a Transition is offered with the sample. */
  offered: (t: WorkflowTransition) => boolean;
  locale: Locale;
  labels: WorkflowBuilderLabels;
  terminal: (key: string) => boolean;
  onTake: (t: WorkflowTransition) => void;
  onRestart: () => void;
  onClose: () => void;
};

/**
 * The test run's bar over the canvas (the reference's): the sample answers the conditions read,
 * where the run is, and the Transitions it may take there with them: a conditional one only
 * when the sample meets its condition. Dark in both themes, over the overview.
 */
export function TestRunBar({ run, definition, fields, form, sample, onSample, typeCode, offered, locale, labels, terminal, onTake, onRestart, onClose }: TestRunBarProps) {
  const at = definition.steps.find((s) => s.key === run.at);
  const next = definition.transitions.filter((t) => t.from === run.at && offered(t));
  const currencyOf = (key: string) => {
    const field = form ? formFields(form).find((f) => f.key === key) : undefined;
    return field && field.type === "currency" ? field.currency : null;
  };
  return (
    <div
      role="region"
      aria-label={labels.testRun}
      className="absolute inset-x-3 bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 text-[12.5px] text-on-primary"
      style={{ background: "var(--sidebar)" }}
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <Icon name="player-play" size={16} />
      <b>{labels.testRun}</b>
      {fields.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          {labels.sample}
          {typeCode && <span dir="ltr">{typeCode} ·</span>}
          {fields.map((f) => (
            <SampleInput key={f.key} field={f} currency={currencyOf(f.key)} value={sample[f.key]} locale={locale} yes={labels.rules.yes} no={labels.rules.no} onChange={(value) => onSample(f.key, value)} />
          ))}
        </span>
      )}
      <span className="opacity-70">·</span>
      {at && terminal(at.key) ? (
        <b>{labels.finished(at.name[locale])}</b>
      ) : (
        <>
          <span>
            {labels.testRunAt} <b>{at?.name[locale]}</b> —
          </span>
          {next.length === 0 && <span className="opacity-80">{labels.noWayOn}</span>}
          {next.map((t) => (
            <Button key={t.key} size="sm" className="h-[30px]" onClick={() => onTake(t)}>
              {t.label[locale]}
            </Button>
          ))}
        </>
      )}
      <span className="flex-1" />
      <Button size="sm" variant="ghost" className="h-[30px] text-on-primary hover:bg-transparent hover:opacity-80" onClick={onRestart}>
        <Icon name="refresh" />
        {labels.restart}
      </Button>
      <IconButton label={labels.closeTestRun} size="sm" className="text-on-primary hover:bg-transparent hover:opacity-80" onClick={onClose}>
        <Icon name="x" />
      </IconButton>
    </div>
  );
}

/** One sample answer in the test run bar, by the field's type: an amount (grouped, Latin digits, its currency), a choice, yes or no, or text. */
function SampleInput({
  field,
  currency,
  value,
  locale,
  yes,
  no,
  onChange,
}: {
  field: RuleField;
  currency: string | null;
  value: unknown;
  locale: Locale;
  yes: string;
  no: string;
  onChange: (value: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const name = field.label[locale];
  const look = "h-[26px] rounded-[5px] border-0 bg-surface px-1.5 text-[12px] text-text";
  if (field.type === "yes_no") {
    return (
      <label className="inline-flex items-center gap-1">
        {name}
        <select aria-label={name} className={look} value={value === false ? "no" : "yes"} onChange={(e) => onChange(e.target.value === "yes")}>
          <option value="yes">{yes}</option>
          <option value="no">{no}</option>
        </select>
      </label>
    );
  }
  if (field.options && field.options.length > 0) {
    return (
      <label className="inline-flex items-center gap-1">
        {name}
        <select aria-label={name} className={look} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label[locale]}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const numeric = field.type === "number" || field.type === "currency";
  // An amount reads as the reference's "620,000 SAR" until it is being typed.
  const shown = value === undefined || value === null ? "" : numeric && typeof value === "number" && !editing ? formatNumber(value, locale) : String(value);
  return (
    <label className="inline-flex items-center gap-1">
      {name}
      <span className={cn(look, "inline-flex items-center gap-1 pe-2")} dir="ltr">
        <input
          aria-label={name}
          inputMode={numeric ? "decimal" : undefined}
          className="h-full w-[5.5rem] border-0 bg-transparent p-0 text-[12px] text-text outline-none"
          value={shown}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => {
            const raw = e.target.value.replaceAll(",", "");
            onChange(numeric ? (raw === "" || Number.isNaN(Number(raw)) ? raw : Number(raw)) : e.target.value);
          }}
        />
        {currency && <span className="text-muted">{currency}</span>}
      </span>
    </label>
  );
}
