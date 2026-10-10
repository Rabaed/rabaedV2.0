"use client";

import {
  changeConditionKind,
  conditionKindOf,
  defaultComparison,
  missingRuleField,
  operatorsFor,
  retargetComparison,
  valueInputFor,
  type Comparison,
  type Condition,
  type ConditionKind,
  type ConditionOp,
  type Locale,
  type RuleField,
} from "@rabaed/domain";
import { useId } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, IconButton } from "../button/button.tsx";
import { Checkbox } from "../form/checkbox.tsx";
import { Input } from "../form/input.tsx";
import { Select } from "../form/select.tsx";
import { Icon } from "../icon/icon.tsx";
import type { WorkflowRuleLabels } from "./workflow-rule-labels.ts";

export type ConditionBuilderProps = {
  value: Condition;
  onChange: (value: Condition) => void;
  /** The Form's fields (and the Transition's own Action Form's): the only ones the pickers list. */
  fields: readonly RuleField[];
  locale: Locale;
  labels: WorkflowRuleLabels;
  /** A name for the builder, for its controls' accessible names. */
  name: string;
  /** The design's narrow row (field, operator, value, remove), for a rule listed on a Transition. */
  compact?: boolean;
  /** Adds the design's remove button after a lone row (a rule listed on a Transition). */
  onRemove?: () => void;
  /** Opens the rule in the dialog, for a lone row listed on a Transition (to make it a group). */
  onEdit?: () => void;
};

/**
 * Builds a condition (workflow-engine.md §4) without typing JSON: "field operator
 * value" rows, joined as all of, any of, or not, to any depth. Each row's operator
 * and value input follow the field's type, as the design's rule row does (field,
 * operator, value, remove). A comparison on an item attribute, which the Form's
 * pickers don't offer, is kept and shown as it is.
 */
export function ConditionBuilder(props: ConditionBuilderProps) {
  const { value, fields, onChange, labels, onRemove, onEdit } = props;
  const first = fields[0];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <ConditionNode {...props} depth={0} onRemove={onRemove ?? null} />
        </div>
        {onEdit && (
          <IconButton label={labels.editCondition} size="sm" onClick={onEdit}>
            <Icon name="edit" size={15} />
          </IconButton>
        )}
      </div>
      {/* A lone comparison grows into a group here; inside a list the dialog does it. */}
      {conditionKindOf(value) === "comparison" && !onRemove && first && (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => onChange({ all: [value, defaultComparison(first)] })}>
          <Icon name="plus" />
          {labels.addCondition}
        </Button>
      )}
    </div>
  );
}

type NodeProps = Omit<ConditionBuilderProps, "onRemove" | "onEdit"> & { depth: number; onRemove: (() => void) | null };

const kinds: ConditionKind[] = ["comparison", "all", "any", "not"];

function ConditionNode(props: NodeProps) {
  const { value, onChange, fields, labels, depth, onRemove, name } = props;
  const kind = conditionKindOf(value);
  if (kind === "comparison") return <ComparisonRow {...props} comparison={value as Comparison} />;

  const children = "all" in value ? value.all : "any" in value ? value.any : "not" in value ? [value.not] : [];
  const setChildren = (next: Condition[]) => onChange("all" in value ? { all: next } : "any" in value ? { any: next } : { not: next[0]! });
  const first = fields[0];
  const newComparison = (): Condition => (first ? defaultComparison(first) : { field: "", op: "not_empty" });
  const asComparison = (c: Condition) => (first ? changeConditionKind(c, "comparison", defaultComparison(first)) : c);

  return (
    <div role="group" aria-label={labels.conditionKindName(kind)} className={cn("flex flex-col gap-2 rounded-lg border border-border-subtle p-2.5", depth % 2 === 0 ? "bg-surface-subtle" : "bg-surface")}>
      <div className="flex items-center gap-2">
        <Select
          aria-label={`${labels.conditionKind} · ${name}`}
          value={kind}
          onValueChange={(next) => onChange(changeConditionKind(value, next as ConditionKind, first ? defaultComparison(first) : undefined))}
          options={kinds.map((k) => ({ value: k, label: labels.conditionKindName(k) }))}
          className="w-44"
        />
        <span className="flex-1 text-[12px] text-muted">{labels.conditionKindHelp(kind as "all" | "any" | "not")}</span>
        {onRemove && (
          <IconButton label={labels.removeCondition} size="sm" onClick={onRemove}>
            <Icon name="x" />
          </IconButton>
        )}
      </div>
      <div className="flex flex-col gap-2 ps-3">
        {children.length === 0 && <p className="m-0 text-[12.5px] text-muted">{labels.emptyGroup}</p>}
        {children.map((child, i) => (
          <ConditionNode
            // The children have no identity of their own; their place in the list is it.
            key={i}
            {...props}
            value={child}
            depth={depth + 1}
            name={`${name} ${i + 1}`}
            onChange={(next) => setChildren(children.map((c, j) => (j === i ? next : c)))}
            onRemove={kind === "not" ? null : () => setChildren(children.filter((_, j) => j !== i))}
          />
        ))}
        {kind !== "not" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setChildren([...children, newComparison()])}>
              <Icon name="plus" />
              {labels.addCondition}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChildren([...children, { all: [asComparison(newComparison())] }])}>
              <Icon name="plus" />
              {labels.addGroup}
            </Button>
          </div>
        )}
        {kind === "not" && children.length === 0 && (
          <Button size="sm" variant="secondary" onClick={() => setChildren([newComparison()])}>
            <Icon name="plus" />
            {labels.addCondition}
          </Button>
        )}
      </div>
    </div>
  );
}

function ComparisonRow({ comparison, onChange, fields, locale, labels, name, onRemove, compact }: NodeProps & { comparison: Comparison }) {
  const id = useId();
  if (comparison.attr !== undefined) {
    // An item attribute isn't one of the Form's fields: shown as it is, and removable.
    return (
      <div className="flex items-center gap-2 rounded-sm bg-surface px-2 py-1.5 text-[12.5px] shadow-[inset_0_0_0_1px_var(--border-subtle)]">
        <span className="flex-1">
          {labels.attribute(comparison.attr)} {labels.op(comparison.op)} {valueText(comparison)}
        </span>
        {onRemove && (
          <IconButton label={labels.removeCondition} size="sm" onClick={onRemove}>
            <Icon name="x" />
          </IconButton>
        )}
      </div>
    );
  }
  const key = comparison.field ?? "";
  const known = fields.find((f) => f.key === key);
  // A field the Form no longer has stays in the list so it can be changed, marked.
  const field: RuleField = known ?? missingRuleField(key);
  const ops = operatorsFor(field.type);
  const input = valueInputFor(field, comparison.op);
  const set = (next: Comparison) => onChange(next);
  const label = (f: RuleField) => f.label[locale];

  return (
    <div role="group" aria-label={name} className={cn("flex items-center", compact ? "gap-1" : "flex-wrap gap-2")}>
      <Select
        aria-label={`${labels.field} · ${name}`}
        value={key}
        onValueChange={(next) => {
          const target = fields.find((f) => f.key === next);
          if (target) set(retargetComparison(comparison, target));
        }}
        options={[
          ...(known || key === "" ? [] : [{ value: key, label: labels.missingField(key) }]),
          ...fields.map((f) => ({ value: f.key, label: label(f) })),
        ]}
        className={cn("min-w-0", compact ? "h-[30px] flex-[1.3_1_0] text-[12px]" : "flex-[2_1_9rem]")}
      />
      <Select
        aria-label={`${labels.operator} · ${name}`}
        value={comparison.op}
        onValueChange={(next) => set(retargetComparison(comparison, field, next as ConditionOp))}
        options={ops.map((o) => ({ value: o, label: compact ? (opSymbol[o] ?? labels.op(o)) : labels.op(o) }))}
        className={cn("min-w-0", compact ? cn("h-[30px] shrink-0 text-[12px]", opSymbol[comparison.op] ? "w-[3.75rem]" : "w-[6.5rem]") : "flex-[1_1_7rem]")}
      />
      {input !== "none" && (
        <div className={cn("min-w-0", compact ? "flex-1 [&_[role=combobox]]:h-[30px] [&_input]:h-[30px] [&_[role=combobox]]:text-[12px] [&_input]:text-[12px]" : "flex-[2_1_9rem]")}>
          <ValueInput id={`${id}-value`} input={input} comparison={comparison} field={field} locale={locale} labels={labels} name={name} onChange={set} />
        </div>
      )}
      {onRemove && (
        <IconButton label={labels.removeCondition} size="sm" onClick={onRemove}>
          <Icon name="x" />
        </IconButton>
      )}
    </div>
  );
}

/** The design's short operators, for the compact row listed on a Transition. */
const opSymbol: Partial<Record<ConditionOp, string>> = { "=": "=", "!=": "≠", ">": ">", ">=": "≥", "<": "<", "<=": "≤" };

function valueText(c: Comparison): string {
  return "value" in c && c.value !== undefined ? (Array.isArray(c.value) ? c.value.join(", ") : String(c.value)) : "";
}

type ValueInputProps = {
  id: string;
  input: ReturnType<typeof valueInputFor>;
  comparison: Comparison;
  field: RuleField;
  locale: Locale;
  labels: WorkflowRuleLabels;
  name: string;
  onChange: (c: Comparison) => void;
};

function ValueInput({ id, input, comparison, field, locale, labels, name, onChange }: ValueInputProps) {
  const value = "value" in comparison ? comparison.value : undefined;
  const set = (next: string | number | boolean | string[]) => onChange({ ...comparison, value: next } as Comparison);
  const aria = `${labels.value} · ${name}`;
  switch (input) {
    case "number":
      return <Input id={id} aria-label={aria} type="number" dir="ltr" value={typeof value === "number" || typeof value === "string" ? String(value) : ""} onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))} />;
    case "date":
      return <Input id={id} aria-label={aria} type="date" dir="ltr" value={typeof value === "string" ? value : ""} onChange={(e) => set(e.target.value)} />;
    case "time":
      return <Input id={id} aria-label={aria} type="time" dir="ltr" value={typeof value === "string" ? value : ""} onChange={(e) => set(e.target.value)} />;
    case "boolean":
      return (
        <Select
          aria-label={aria}
          value={value === false ? "no" : "yes"}
          onValueChange={(next) => set(next === "yes")}
          options={[
            { value: "yes", label: labels.yes },
            { value: "no", label: labels.no },
          ]}
        />
      );
    case "option":
      return (
        <Select
          aria-label={aria}
          value={typeof value === "string" ? value : ""}
          onValueChange={(next) => set(next)}
          options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label[locale] }))}
        />
      );
    case "options": {
      const chosen = Array.isArray(value) ? value.map(String) : [];
      return (
        <fieldset aria-label={aria} className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          {(field.options ?? []).map((o) => {
            const optionId = `${id}-${o.value}`;
            return (
              <div key={o.value} className="flex items-center gap-2 text-[12.5px]">
                <Checkbox
                  id={optionId}
                  checked={chosen.includes(o.value)}
                  onCheckedChange={(on) => set(on === true ? [...chosen, o.value] : chosen.filter((v) => v !== o.value))}
                />
                <label htmlFor={optionId}>{o.label[locale]}</label>
              </div>
            );
          })}
        </fieldset>
      );
    }
    default:
      return <Input id={id} aria-label={aria} value={typeof value === "string" || typeof value === "number" ? String(value) : ""} onChange={(e) => set(e.target.value)} />;
  }
}
