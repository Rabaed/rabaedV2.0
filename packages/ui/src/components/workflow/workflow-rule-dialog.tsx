"use client";

import {
  defaultRule,
  defaultSetValue,
  defaultValidationMessage,
  isDocumentField,
  isRuleComplete,
  isSettable,
  ruleKindOf,
  ruleKinds,
  valueInputFor,
  type BilingualText,
  type Condition,
  type Locale,
  type PositionOption,
  type RuleEntry,
  type RuleField,
  type RuleGroup,
  type RuleKind,
  type RuleRef,
  type TransitionRuleFields,
  type WorkflowStep,
  type WorkflowTransition,
} from "@rabaed/domain";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { Checkbox } from "../form/checkbox.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Select } from "../form/select.tsx";
import { Switch } from "../form/switch.tsx";
import { Dialog, DialogContent, DialogFooter } from "../overlay/dialog.tsx";
import { ConditionBuilder } from "./workflow-condition-builder.tsx";
import type { WorkflowRuleLabels } from "./workflow-rule-labels.ts";

export type RuleDialogProps = {
  /** The Transition the rule is for. */
  transition: WorkflowTransition;
  steps: readonly WorkflowStep[];
  transitions: readonly WorkflowTransition[];
  /** What each group may name, as publish check 6 accepts it (transitionRuleFields). */
  fields: TransitionRuleFields;
  /** The Positions of the acting Participant (the role of the Transition's source Step). */
  positions: readonly PositionOption[];
  locale: Locale;
  labels: WorkflowRuleLabels;
  /** The rule to edit, or null to add a new one. */
  editing: { ref: RuleRef; entry: RuleEntry } | null;
  onClose: () => void;
  onSubmit: (entry: RuleEntry, ref: RuleRef | null) => void;
};

const groups: RuleGroup[] = ["restrict", "validate", "action"];

/**
 * The "Add rule" dialog (RP-440, WF-17), grouped as Jira's: Restrict (is the
 * button offered), Validate (may it go through) and Actions (what it does). Pick a
 * kind, then fill its editor; each writes the WF-2 JSON, so a Position, a field or a
 * Step is picked from what the Workflow and the Form have, never typed. Editing a
 * rule opens straight on its editor.
 */
export function WorkflowRuleDialog(props: RuleDialogProps) {
  const { transition, steps, transitions, fields, locale, labels, editing, onClose, onSubmit } = props;
  const context = { fields, steps, transitions, transitionKey: transition.key };
  const [picked, setPicked] = useState<{ kind: RuleKind; group: RuleGroup } | null>(editing ? { kind: ruleKindOf(editing.entry), group: editing.entry.group } : null);
  const [choice, setChoice] = useState<string>("");
  const [draft, setDraft] = useState<RuleEntry | null>(editing?.entry ?? null);
  const transitionName = transition.label[locale];

  const start = (kind: RuleKind, group: RuleGroup) => {
    const entry = defaultRule(kind, group, context);
    if (!entry) return;
    setPicked({ kind, group });
    setDraft(entry);
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        title={editing ? labels.editTitle(transitionName) : labels.addTitle(transitionName)}
        description={picked ? labels.kindHelp(picked.kind) : labels.chooseKind}
        closeLabel={labels.close}
        className="w-[min(640px,calc(100%-2rem))]"
      >
        {picked === null || draft === null ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const [group, kind] = choice.split(":") as [RuleGroup, RuleKind];
              if (kind) start(kind, group);
            }}
          >
            {/* The list scrolls on a short screen, so Next stays in reach. */}
            <div className="-mx-1 flex max-h-[min(58dvh,30rem)] flex-col gap-4 overflow-y-auto px-1 py-1">
            {groups.map((group) => (
              <fieldset key={group} className="m-0 flex flex-col gap-1.5 border-0 p-0">
                <legend className="mb-1 text-[11px] font-bold tracking-wider text-muted uppercase">
                  {labels.groupTitle(group)}
                  <span className="ms-2 font-medium tracking-normal normal-case">{labels.groupHelp(group)}</span>
                </legend>
                {ruleKinds[group].map((kind) => {
                  const available = defaultRule(kind, group, context) !== null;
                  const value = `${group}:${kind}`;
                  const id = `rule-kind-${value}`;
                  return (
                    <label
                      key={value}
                      htmlFor={id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 shadow-[inset_0_0_0_1px_var(--border-subtle)] hover:shadow-[inset_0_0_0_1px_var(--primary)]",
                        "has-[:checked]:bg-brand-tint has-[:checked]:shadow-[inset_0_0_0_2px_var(--primary)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
                        !available && "cursor-not-allowed opacity-60 hover:shadow-[inset_0_0_0_1px_var(--border-subtle)]",
                      )}
                    >
                      <input
                        id={id}
                        type="radio"
                        name="rule-kind"
                        value={value}
                        disabled={!available}
                        checked={choice === value}
                        onChange={() => setChoice(value)}
                        onDoubleClick={() => available && start(kind, group)}
                        className="mt-1 accent-[var(--primary)]"
                      />
                      <span className="flex flex-col">
                        <b className="text-[13.5px]">{labels.kindTitle(kind)}</b>
                        <span className="text-[12.5px] text-muted">{available ? labels.kindHelp(kind) : labels.noFields}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
            </div>
            <DialogFooter className="-mx-6 -mb-6 border-t border-border-subtle bg-surface-subtle px-6 py-3">
              <Button variant="secondary" onClick={onClose}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={!choice}>
                {labels.next}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (isRuleComplete(draft)) onSubmit(draft, editing?.ref ?? null);
            }}
          >
            <p className="m-0 flex items-center gap-2 text-[11px] font-bold tracking-wider text-muted uppercase">
              {labels.groupTitle(picked.group)} · {labels.kindTitle(picked.kind)}
            </p>
            <RuleEditor kind={picked.kind} entry={draft} onChange={setDraft} {...props} />
            <DialogFooter className="-mx-6 -mb-6 border-t border-border-subtle bg-surface-subtle px-6 py-3">
              {!editing && (
                <Button variant="ghost" className="me-auto" onClick={() => setPicked(null)}>
                  {labels.back}
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={!isRuleComplete(draft)}>
                {editing ? labels.save : labels.add}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

type EditorProps = RuleDialogProps & { kind: RuleKind; entry: RuleEntry; onChange: (entry: RuleEntry) => void };

/** The editor of one kind of rule: it writes the rule's JSON from pickers. */
function RuleEditor(props: EditorProps) {
  const { kind, entry, onChange, fields, steps, transitions, positions, locale, labels, transition } = props;
  const fieldOptions = (list: readonly RuleField[], current?: string) => [
    ...(current && !list.some((f) => f.key === current) ? [{ value: current, label: labels.missingField(current) }] : []),
    ...list.map((f) => ({ value: f.key, label: f.label[locale] })),
  ];
  const fieldOf = (key: string) => [...fields.validate, ...fields.write, ...fields.restrict].find((f) => f.key === key);

  if (entry.group === "restrict") {
    const rule = entry.rule;
    switch (rule.type) {
      case "condition":
        return (
          <ConditionBuilder
            value={rule.condition}
            onChange={(condition) => onChange({ group: "restrict", rule: { type: "condition", condition } })}
            fields={fields.restrict}
            locale={locale}
            labels={labels}
            name={labels.kindTitle("field_value")}
          />
        );
      case "positions":
        return (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-body font-medium">{labels.positions}</legend>
            {positions.length === 0 && <p className="m-0 text-[12.5px] text-muted">{labels.noPositions}</p>}
            {positions.map((p) => {
              const id = `rule-position-${p.key}`;
              return (
                <div key={p.key} className="flex items-center gap-2 text-[13px]">
                  <Checkbox
                    id={id}
                    checked={rule.positions.includes(p.key)}
                    onCheckedChange={(on) =>
                      onChange({ group: "restrict", rule: { type: "positions", positions: on === true ? [...rule.positions, p.key] : rule.positions.filter((k) => k !== p.key) } })
                    }
                  />
                  <label htmlFor={id}>{p.name[locale]}</label>
                </div>
              );
            })}
            <p className="m-0 text-caption text-muted">{labels.positionsHelp}</p>
          </fieldset>
        );
      case "not_same_person": {
        const byTransition = "transition" in rule;
        const stepsHeld = steps.filter((s) => s.actor !== null);
        const others = transitions;
        return (
          <>
            <Field label={labels.notSamePersonOf} group>
              <SegmentedControl
                value={byTransition ? "transition" : "step"}
                onValueChange={(next) =>
                  onChange({
                    group: "restrict",
                    rule: next === "transition" ? { type: "not_same_person", transition: transition.key } : { type: "not_same_person", step: stepsHeld[0]?.key ?? transition.from },
                  })
                }
                options={[
                  { value: "step", label: labels.heldStep },
                  { value: "transition", label: labels.tookTransition },
                ]}
              />
            </Field>
            {byTransition ? (
              <Field label={labels.transition}>
                <Select
                  value={rule.transition}
                  onValueChange={(next) => onChange({ group: "restrict", rule: { type: "not_same_person", transition: next } })}
                  options={others.map((t) => ({ value: t.key, label: t.label[locale] }))}
                />
              </Field>
            ) : (
              <Field label={labels.step}>
                <Select
                  value={rule.step}
                  onValueChange={(next) => onChange({ group: "restrict", rule: { type: "not_same_person", step: next } })}
                  options={stepsHeld.map((s) => ({ value: s.key, label: s.name[locale] }))}
                />
              </Field>
            )}
          </>
        );
      }
      case "been_through": {
        const byFact = "fact" in rule;
        // A Step of the acting Participant's own role (publish check 6).
        const role = steps.find((s) => s.key === transition.from)?.actor?.role;
        const own = steps.filter((s) => s.actor !== null && s.actor.role === role);
        return (
          <>
            <Field label={labels.beenThroughOf} group>
              <SegmentedControl
                value={byFact ? "fact" : "step"}
                onValueChange={(next) =>
                  onChange({ group: "restrict", rule: next === "fact" ? { type: "been_through", fact: "sent_back" } : { type: "been_through", step: own[0]?.key ?? transition.from } })
                }
                options={[
                  { value: "step", label: labels.ownStep },
                  { value: "fact", label: labels.fact },
                ]}
              />
            </Field>
            {byFact ? (
              <Field label={labels.fact}>
                <Select
                  value={rule.fact}
                  onValueChange={(next) => onChange({ group: "restrict", rule: { type: "been_through", fact: next as "sent_back" | "revision" } })}
                  options={(["sent_back", "revision"] as const).map((f) => ({ value: f, label: labels.sharedFact(f) }))}
                />
              </Field>
            ) : (
              <Field label={labels.step}>
                <Select
                  value={rule.step}
                  onValueChange={(next) => onChange({ group: "restrict", rule: { type: "been_through", step: next } })}
                  options={own.map((s) => ({ value: s.key, label: s.name[locale] }))}
                />
              </Field>
            )}
          </>
        );
      }
      case "all_closed":
        return (
          <Field label={labels.items} group>
            <SegmentedControl
              value={rule.items}
              onValueChange={(next) => onChange({ group: "restrict", rule: { type: "all_closed", items: next as "comments" | "subtasks" } })}
              options={(["comments", "subtasks"] as const).map((i) => ({ value: i, label: labels.itemsKind(i) }))}
            />
          </Field>
        );
    }
  }

  if (entry.group === "validate") {
    const rule = entry.rule;
    const set = (message: BilingualText) => rule.type === "condition" && onChange({ group: "validate", rule: { ...rule, message } });
    const messageFields = rule.type === "condition" && (
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-body font-medium">{labels.messageHeading}</legend>
        <Field label={labels.messageEn} required>
          <Input value={rule.message.en} dir="ltr" onChange={(e) => set({ ...rule.message, en: e.target.value })} />
        </Field>
        <Field label={labels.messageAr} required>
          <Input value={rule.message.ar} dir="rtl" onChange={(e) => set({ ...rule.message, ar: e.target.value })} />
        </Field>
        <p className="m-0 text-caption text-muted">{labels.messageHelp}</p>
      </fieldset>
    );
    switch (rule.type) {
      case "condition":
        if (kind === "field_filled") {
          const key = "field" in rule.condition ? (rule.condition.field ?? "") : "";
          return (
            <>
              <Field label={labels.field}>
                <Select
                  value={key}
                  onValueChange={(next) => {
                    const target = fieldOf(next);
                    if (!target) return;
                    // Follow the field's name while the message is still the one made for the old field.
                    const old = fieldOf(key);
                    const followed = !old || (rule.message.en === defaultValidationMessage(old.label).en && rule.message.ar === defaultValidationMessage(old.label).ar);
                    onChange({
                      group: "validate",
                      rule: { type: "condition", condition: { field: next, op: "not_empty" }, message: followed ? defaultValidationMessage(target.label) : rule.message },
                    });
                  }}
                  options={fieldOptions(fields.validate, key)}
                />
              </Field>
              {messageFields}
            </>
          );
        }
        return (
          <>
            <ConditionBuilder
              value={rule.condition}
              onChange={(condition: Condition) => onChange({ group: "validate", rule: { ...rule, condition } })}
              fields={fields.validate}
              locale={locale}
              labels={labels}
              name={labels.kindTitle("field_value")}
            />
            {messageFields}
          </>
        );
      case "form_complete":
        return <p className="m-0 text-[13px] text-muted">{labels.kindHelp("form_complete")}</p>;
      case "has_document": {
        const documents = fields.validate.filter(isDocumentField);
        return (
          <>
            <Field label={labels.documentField} help={labels.documentHelp}>
              <Select
                value={rule.field ?? "__any"}
                onValueChange={(next) => onChange({ group: "validate", rule: next === "__any" ? { type: "has_document" } : { type: "has_document", field: next } })}
                options={[{ value: "__any", label: labels.anyDocument }, ...fieldOptions(documents, rule.field)]}
              />
            </Field>
          </>
        );
      }
    }
  }

  const rule = entry.rule;
  const settable = fields.write.filter(isSettable);
  switch (rule.type) {
    case "offer_assign_to":
      return <p className="m-0 text-[13px] text-muted">{labels.assignHelp}</p>;
    case "set_field": {
      const target = fieldOf(rule.field);
      const input = target ? valueInputFor(target, "=") : "text";
      const isMoment = typeof rule.value === "object";
      const canBeNow = target?.type === "date" || target?.type === "datetime" || target?.type === "time";
      const setValue = (value: string | number | boolean | { now: true }) => onChange({ group: "action", rule: { type: "set_field", field: rule.field, value } });
      return (
        <>
          <Field label={labels.field}>
            <Select
              value={rule.field}
              onValueChange={(next) => {
                const chosen = fieldOf(next);
                if (chosen) onChange({ group: "action", rule: { type: "set_field", field: next, value: defaultSetValue(chosen) } });
              }}
              options={fieldOptions(settable, rule.field)}
            />
          </Field>
          {canBeNow && (
            <Field label={labels.setNow} layout="inline">
              <Switch checked={isMoment} onCheckedChange={(on) => setValue(on ? { now: true } : "")} />
            </Field>
          )}
          {!isMoment && (
            <Field label={labels.setValue}>
              {input === "boolean" ? (
                <Select
                  value={rule.value === false ? "no" : "yes"}
                  onValueChange={(next) => setValue(next === "yes")}
                  options={[
                    { value: "yes", label: labels.yes },
                    { value: "no", label: labels.no },
                  ]}
                />
              ) : input === "option" ? (
                <Select
                  value={String(rule.value)}
                  onValueChange={(next) => setValue(next)}
                  options={(target?.options ?? []).map((o) => ({ value: o.value, label: o.label[locale] }))}
                />
              ) : (
                <Input
                  type={input === "number" ? "number" : input === "date" ? "date" : input === "time" ? "time" : "text"}
                  dir={input === "text" ? undefined : "ltr"}
                  value={String(rule.value)}
                  onChange={(e) => setValue(input === "number" ? (e.target.value === "" ? 0 : Number(e.target.value)) : e.target.value)}
                />
              )}
            </Field>
          )}
        </>
      );
    }
    case "copy_field":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={labels.copyFrom}>
            <Select value={rule.from} onValueChange={(next) => onChange({ group: "action", rule: { ...rule, from: next } })} options={fieldOptions(settable, rule.from)} />
          </Field>
          <Field label={labels.copyTo}>
            <Select value={rule.to} onValueChange={(next) => onChange({ group: "action", rule: { ...rule, to: next } })} options={fieldOptions(settable, rule.to)} />
          </Field>
        </div>
      );
  }
}
