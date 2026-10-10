"use client";

import {
  addRule,
  formatNumber,
  listRules,
  notificationChoices,
  removeRule,
  ruleKindOf,
  setRecipient,
  updateRule,
  workflowRuleProblemsOf,
  type Comparison,
  type Condition,
  type Locale,
  type PositionOption,
  type RuleEntry,
  type RuleField,
  type RuleGroup,
  type RuleRef,
  type TransitionRuleFields,
  type WorkflowDefinition,
  type WorkflowProblem,
  type WorkflowTransition,
} from "@rabaed/domain";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, IconButton } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { ConditionBuilder } from "./workflow-condition-builder.tsx";
import { WorkflowRuleDialog } from "./workflow-rule-dialog.tsx";
import type { WorkflowRuleLabels } from "./workflow-rule-labels.ts";

type CommonProps = {
  definition: WorkflowDefinition;
  transition: WorkflowTransition;
  locale: Locale;
  labels: WorkflowRuleLabels;
  onCommit: (definition: WorkflowDefinition, coalesce?: string | null) => void;
};

/** One line saying what a rule does, in the viewer's language. */
export function ruleSummary(
  entry: RuleEntry,
  ctx: { fields: readonly RuleField[]; definition: WorkflowDefinition; positions: readonly Pick<PositionOption, "key" | "name">[]; locale: Locale; labels: WorkflowRuleLabels },
): string {
  const { fields, definition, positions, locale, labels } = ctx;
  const fieldName = (key: string) => fields.find((f) => f.key === key)?.label[locale] ?? key;
  const stepName = (key: string) => definition.steps.find((s) => s.key === key)?.name[locale] ?? key;
  const transitionName = (key: string) => definition.transitions.find((t) => t.key === key)?.label[locale] ?? key;
  const valueName = (key: string, value: unknown): string => {
    if (Array.isArray(value)) return value.map((v) => valueName(key, v)).join(", ");
    const field = fields.find((f) => f.key === key);
    const option = field?.options?.find((o) => o.value === value);
    if (option) return option.label[locale];
    if (typeof value === "boolean") return value ? labels.yes : labels.no;
    if (typeof value === "number") return formatNumber(value, locale);
    return String(value ?? "");
  };
  const condition = (c: Condition): string => {
    if ("all" in c) return labels.summaryAll(c.all.map(condition).join(" · "));
    if ("any" in c) return labels.summaryAny(c.any.map(condition).join(" · "));
    if ("not" in c) return labels.summaryNot(condition(c.not));
    const cmp: Comparison = c;
    const name = cmp.field !== undefined ? fieldName(cmp.field) : labels.attribute(cmp.attr);
    return labels.summaryCondition(name, labels.op(cmp.op), "value" in cmp && cmp.value !== undefined ? valueName(cmp.field ?? "", cmp.value) : "").trim();
  };
  switch (entry.group) {
    case "restrict": {
      const r = entry.rule;
      switch (r.type) {
        case "condition":
          return condition(r.condition);
        case "positions":
          return labels.summaryPositions(r.positions.map((k) => positions.find((p) => p.key === k)?.name[locale] ?? k).join(", "));
        case "not_same_person":
          return "step" in r ? labels.summaryNotSameStep(stepName(r.step)) : labels.summaryNotSameTransition(transitionName(r.transition));
        case "been_through":
          return "step" in r ? labels.summaryBeenStep(stepName(r.step)) : labels.summaryFact(r.fact);
        case "all_closed":
          return labels.summaryAllClosed(r.items);
      }
      break;
    }
    case "validate": {
      const v = entry.rule;
      switch (v.type) {
        case "condition":
          return `${condition(v.condition)} · ${labels.summaryMessage(v.message[locale])}`;
        case "form_complete":
          return labels.kindTitle("form_complete");
        case "has_document":
          return labels.summaryDocument(v.field === undefined ? null : fieldName(v.field));
      }
      break;
    }
    case "action": {
      const a = entry.rule;
      switch (a.type) {
        case "offer_assign_to":
          return labels.kindTitle("offer_assign_to");
        case "set_field":
          return typeof a.value === "object" ? labels.summarySetNow(fieldName(a.field)) : labels.summarySet(fieldName(a.field), valueName(a.field, a.value));
        case "copy_field":
          return labels.summaryCopy(fieldName(a.from), fieldName(a.to));
      }
    }
  }
  return "";
}

const groupIcon: Record<RuleGroup, IconName> = { restrict: "lock", validate: "circle-check", action: "send" };
const groups: RuleGroup[] = ["restrict", "validate", "action"];

type RulesProps = CommonProps & {
  /** What each group may name, as publish check 6 accepts it (transitionRuleFields). */
  fields: TransitionRuleFields;
  positions: readonly PositionOption[];
  /** Every publish problem of the draft; the ones about this Transition's rules show under them. */
  problems: readonly WorkflowProblem[];
};

/**
 * A Transition's rules, as the design lists its Condition: one row each, with the
 * remove button, "AND" between the Restrict rules (all must hold) and "Add rule"
 * under them (RP-440, WF-17). A Restrict rule that is one plain comparison is edited
 * in its row (field, operator, value); every other opens in the dialog.
 */
export function TransitionRules({ definition, transition, fields, positions, problems, locale, labels, onCommit }: RulesProps) {
  const [dialog, setDialog] = useState<{ editing: { ref: RuleRef; entry: RuleEntry } | null } | null>(null);
  const listed = listRules(transition);
  const mine = workflowRuleProblemsOf(problems, transition.key);
  // A summary names any field the rules may name.
  const ctx = { fields: [...fields.validate, ...fields.write, ...fields.restrict], definition, positions, locale, labels };
  const own = (r: { ref: RuleRef; entry: RuleEntry }) => ruleSummary(r.entry, ctx);
  const remove = (ref: RuleRef) => onCommit(removeRule(definition, transition.key, ref));

  return (
    <section aria-label={labels.heading} className="flex flex-col gap-2">
      <h3 className="mt-1.5 mb-0 text-[10.5px] font-bold tracking-wider text-muted uppercase">{labels.heading}</h3>
      {listed.length === 0 && <p className="m-0 text-[12.5px] text-muted">{labels.noRules}</p>}
      {groups.map((group) => {
        const rows = listed.filter((r) => r.ref.group === group);
        if (rows.length === 0) return null;
        return (
          <div key={group} role="group" aria-label={labels.groupTitle(group)} className="flex flex-col gap-1.5">
            <p className="m-0 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
              <Icon name={groupIcon[group]} size={13} />
              {labels.groupTitle(group)}
            </p>
            {rows.map((r, i) => {
              const summary = own(r);
              const lone = r.entry.group === "restrict" && r.entry.rule.type === "condition" && !("all" in r.entry.rule.condition || "any" in r.entry.rule.condition || "not" in r.entry.rule.condition);
              return (
                <div key={`${group}-${r.ref.index}`} className="flex flex-col gap-1.5">
                  {group === "restrict" && i > 0 && <small className="font-bold text-muted">{labels.and}</small>}
                  {lone && r.entry.group === "restrict" && r.entry.rule.type === "condition" ? (
                    <ConditionBuilder
                      value={r.entry.rule.condition}
                      onChange={(condition) => onCommit(updateRule(definition, transition.key, r.ref, { group: "restrict", rule: { type: "condition", condition } }), `${transition.key}:rule:${r.ref.index}`)}
                      onRemove={() => remove(r.ref)}
                      onEdit={() => setDialog({ editing: r })}
                      compact
                      fields={fields.restrict}
                      locale={locale}
                      labels={labels}
                      name={`${labels.groupTitle("restrict")} ${i + 1}`}
                    />
                  ) : (
                    <div className="flex items-start gap-1.5 rounded-sm bg-surface-subtle px-2 py-1.5 shadow-[inset_0_0_0_1px_var(--border-subtle)]">
                      <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
                        <b className="me-1">{labels.kindTitle(ruleKindOf(r.entry))}</b>
                        <span className="text-muted">{summary}</span>
                      </span>
                      <IconButton label={labels.edit(summary)} size="sm" onClick={() => setDialog({ editing: r })}>
                        <Icon name="edit" size={15} />
                      </IconButton>
                      <IconButton label={labels.remove(summary)} size="sm" onClick={() => remove(r.ref)}>
                        <Icon name="x" size={15} />
                      </IconButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setDialog({ editing: null })}>
        <Icon name="plus" />
        {labels.addRule}
      </Button>
      {mine.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-live="polite">
          {mine.map((p, i) => (
            <li key={`${p.code}:${p.detail ?? ""}:${i}`} className={cn("flex items-start gap-1.5 text-[12px]", p.severity === "error" ? "text-danger-fg" : "text-warning-fg")}>
              <Icon name={p.severity === "error" ? "circle-x" : "alert-triangle"} size={14} className="mt-0.5" />
              {p.message[locale]}
            </li>
          ))}
        </ul>
      )}
      {dialog && (
        <WorkflowRuleDialog
          // A fresh dialog for each rule opened, so it never shows the last one's draft.
          key={dialog.editing ? `${dialog.editing.ref.group}:${dialog.editing.ref.index}` : "new"}
          transition={transition}
          steps={definition.steps}
          transitions={definition.transitions}
          fields={fields}
          positions={positions}
          locale={locale}
          labels={labels}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSubmit={(entry, ref) => {
            onCommit(ref ? updateRule(definition, transition.key, ref, entry) : addRule(definition, transition.key, entry));
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

/** A chip of the Notifications tab, as the design's: dark when chosen. */
function Chip({ on, locked, onToggle, children }: { on: boolean; locked?: boolean; onToggle?: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={locked || undefined}
      onClick={locked ? undefined : onToggle}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full px-3 text-[12px] font-semibold",
        focusRing,
        on ? "bg-inverse text-on-inverse" : "bg-surface text-text shadow-[inset_0_0_0_1px_var(--control-border)] hover:shadow-[inset_0_0_0_1px_var(--primary)]",
        locked && "cursor-default",
      )}
    >
      {on && <Icon name="check" size={12} />}
      {children}
    </button>
  );
}

type NotificationsProps = CommonProps & {
  steps: WorkflowDefinition["steps"];
  /** Every Position, to find those of the acting Participant. */
  positionOptions: Parameters<typeof notificationChoices>[2];
};

/**
 * A Transition's Notifications tab (RP-440, WF-17; WF-9): the people told besides
 * the next holder or Step Pool, who is always told (the raiser, watchers, a Position
 * of the acting Participant), as the design's chips; and the channels: in-app always
 * on, email as each Member's settings say, SMS not set up yet. A Workflow never
 * overrides a Member's own settings, and everyone is checked against what they may
 * see when the notification goes out (visibility.md, Notifications and emails).
 */
export function TransitionNotifications({ definition, transition, steps, positionOptions, locale, labels, onCommit }: NotificationsProps) {
  const choices = notificationChoices(transition, steps, positionOptions);
  const set = (recipient: Parameters<typeof setRecipient>[2], on: boolean) => onCommit(setRecipient(definition, transition.key, recipient, on));
  return (
    <div className="flex flex-col gap-3">
      <h3 className="mt-1.5 mb-0 text-[10.5px] font-bold tracking-wider text-muted uppercase">{labels.notificationsHeading}</h3>
      <p className="m-0 text-[12.5px] text-muted">{labels.notificationsHelp}</p>
      <div role="group" aria-label={labels.recipients} className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Chip on locked>
            {labels.holder}
          </Chip>
          <Chip on={choices.raiser} onToggle={() => set({ to: "raiser" }, !choices.raiser)}>
            {labels.raiser}
          </Chip>
          <Chip on={choices.watchers} onToggle={() => set({ to: "watchers" }, !choices.watchers)}>
            {labels.watchers}
          </Chip>
        </div>
        <p className="m-0 text-caption text-muted">{labels.holderAlways}</p>
      </div>
      <div role="group" aria-label={labels.positionsOfActing} className="flex flex-col gap-1.5">
        <b className="text-[12.5px]">{labels.positionsOfActing}</b>
        {choices.positions.length === 0 ? (
          <p className="m-0 text-[12.5px] text-muted">{labels.noActingPositions}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {choices.positions.map((p) => (
              <Chip key={p.key} on={p.on} onToggle={() => set({ to: "position", position: p.key }, !p.on)}>
                {p.name[locale]}
              </Chip>
            ))}
          </div>
        )}
      </div>
      <div role="group" aria-label={labels.channels} className="flex flex-col gap-1.5">
        <b className="text-[12.5px]">{labels.channels}</b>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          <Channel icon="bell" name={labels.inApp} status={labels.inAppHelp} on />
          <Channel icon="mail" name={labels.email} status={labels.emailHelp} on />
          <Channel icon="device-mobile" name={labels.sms} status={labels.smsHelp} />
        </ul>
      </div>
    </div>
  );
}

function Channel({ icon, name, status, on }: { icon: IconName; name: string; status: string; on?: boolean }) {
  return (
    <li className={cn("flex items-center gap-2 rounded-sm bg-surface-subtle px-2 py-1.5 text-[12.5px] shadow-[inset_0_0_0_1px_var(--border-subtle)]", !on && "text-muted")}>
      <Icon name={icon} size={16} />
      <b>{name}</b>
      <span className="ms-auto text-muted">{status}</span>
    </li>
  );
}
