"use client";

import {
  formatNumber,
  optionLabel,
  optionPath,
  retiredMark,
  type Locale,
  type OptionList,
  type OptionNode,
} from "@rabaed/domain";
import { useId } from "react";
import { CheckboxGroup } from "../form/checkbox-group.tsx";
import { Field, useFieldControl, type FieldControlProps } from "../form/field.tsx";
import { Select } from "../form/select.tsx";

// The `option_list` field (form-engine.md §2, §10): a choice from an Option List
// of up to three levels. A single choice is a drop-down per level, each offering
// the options under the one chosen above it; a multiple choice is a checkbox for
// every option that can be chosen, named by its path. Options are read from the
// live list, so one added in Rabaed Admin shows at once. A retired option stays
// on an answer that holds it, marked, but is never offered for a new choice.
// Presentational only, like the renderer around it.

const copy = {
  en: {
    level: (n: number) => `Level ${formatNumber(n, "en")}`,
    choose: "Choose…",
    none: "None",
    unavailable: "This list isn't available.",
  },
  ar: {
    level: (n: number) => `المستوى ${formatNumber(n, "ar")}`,
    choose: "اختر…",
    none: "بدون",
    unavailable: "هذه القائمة غير متاحة.",
  },
} satisfies Record<Locale, unknown>;

// A drop-down's "no choice" item: option values never are "-" alone, so it never clashes with one.
const noChoice = "-";

const labelOf = (option: OptionNode, locale: Locale) => (option.retired ? `${option.label[locale]} (${retiredMark[locale]})` : option.label[locale]);

type Level = { options: { value: string; label: string }[]; chosen: string };

/**
 * The drop-downs a single choice shows: one for the first level, then one for
 * each level under an option chosen above, down to `depth`. A level offers its
 * options that aren't retired (a chosen retired one stays, marked), and nothing
 * under a retired option, which can't be gone deeper into.
 */
function levelsOf(list: OptionList, depth: number, path: readonly OptionNode[], locale: Locale): Level[] {
  const levels: Level[] = [];
  let options = list.options;
  for (let i = 0; i < depth; i++) {
    const chosen = path[i];
    const closed = path.slice(0, i).some((o) => o.retired);
    const offered = options.filter((o) => (closed ? o === chosen : !o.retired || o === chosen));
    if (offered.length === 0) break;
    levels.push({ options: offered.map((o) => ({ value: o.value, label: labelOf(o, locale) })), chosen: chosen?.value ?? "" });
    if (!chosen) break;
    options = chosen.options;
  }
  return levels;
}

/** The options a multiple choice can tick: those reached at `depth` (or where nothing deeper can be chosen), then any already chosen. */
function targetsOf(list: OptionList, depth: number, chosen: readonly string[], locale: Locale): { value: string; label: string }[] {
  const targets = new Map<string, string>();
  const walk = (nodes: OptionNode[], trail: OptionNode[]) => {
    for (const node of nodes) {
      if (node.retired) continue;
      const path = [...trail, node];
      if (path.length === depth || node.options.every((o) => o.retired)) targets.set(node.value, optionLabel(path, locale));
      else walk(node.options, path);
    }
  };
  walk(list.options, []);
  for (const value of chosen) {
    const path = optionPath(list, value);
    if (path && !targets.has(value)) targets.set(value, optionLabel(path, locale));
  }
  return [...targets].map(([value, label]) => ({ value, label }));
}

export type OptionListInputProps = {
  /** The list, or undefined when the viewer doesn't have it. */
  list: OptionList | undefined;
  depth: number;
  multiple: boolean;
  /** The option value (single), or the values in the order chosen (multiple). */
  value: unknown;
  locale: Locale;
  /** `undefined` clears the answer. */
  onChange: (value: string | string[] | undefined) => void;
};

/** An Option List field's control. Put it in a Field with `group`, which names it. */
export function OptionListInput({ list, depth, multiple, value, locale, onChange }: OptionListInputProps) {
  const text = copy[locale];
  const generated = useId();
  const { id = `ol${generated.replaceAll(":", "")}`, labelId, required, "aria-describedby": describedBy } = useFieldControl<FieldControlProps>({});
  if (!list) {
    return (
      <p id={id} className="text-body text-muted">
        {text.unavailable}
      </p>
    );
  }
  if (multiple) {
    const chosen = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    return (
      <CheckboxGroup
        id={id}
        aria-describedby={describedBy}
        options={targetsOf(list, depth, chosen, locale)}
        value={chosen}
        onValueChange={(next) => onChange(next.length === 0 ? undefined : next)}
      />
    );
  }
  const current = typeof value === "string" ? value : "";
  const path = (current && optionPath(list, current)) || [];
  const levels = levelsOf(list, depth, path, locale);
  return (
    <div id={id} role="group" aria-labelledby={labelId} aria-describedby={describedBy} className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
      {levels.map((level, i) => (
        <Field key={i} id={`${id}-level${i + 1}`} label={text.level(i + 1)} required={required && i === 0}>
          <Select
            placeholder={text.choose}
            // Taking a choice back is offered where the answer can be empty: the first level of an optional field, or any deeper one.
            options={required && i === 0 ? level.options : [{ value: noChoice, label: text.none }, ...level.options]}
            value={level.chosen}
            // Choosing none at a level leaves the choice above it (or no answer at the first).
            onValueChange={(v) => onChange(v === noChoice ? (i === 0 ? undefined : path[i - 1]!.value) : v)}
          />
        </Field>
      ))}
    </div>
  );
}
