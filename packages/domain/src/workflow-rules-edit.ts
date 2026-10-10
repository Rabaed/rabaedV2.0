import type { BilingualText } from "./company.ts";
import type { Comparison, Condition, ConditionOp } from "./condition.ts";
import { conditionOps } from "./condition.ts";
import { parseActionForm } from "./action-form.ts";
import { formFields, isAnswerField, type FormFieldType, type FormOption, type FormSchema } from "./form.ts";
import type { StageCategory } from "./chain-bucket.ts";
import { transitionFieldScope, type WorkflowProblem } from "./workflow-checks.ts";
import type { Restriction, TransitionAction, Validation, WorkflowDefinition, WorkflowStep, WorkflowTransition } from "./workflow-definition.ts";
import type { NotificationRecipient } from "./workflow-definition.ts";
import type { BaseRole } from "./project.ts";

// The Workflow builder's rule, action and notification edits (RP-440, WF-17;
// workflow-engine.md §11): the "Add rule" dialog (Restrict, Validate, Actions, as
// Jira groups them) and the Notifications tab change a Transition through these.
// Like workflow-edit.ts, each takes a definition and gives a new one, and what it
// writes fits the WF-2 format; WF-4's checks (RP-427) have the last word at save.

/** Jira's three groups of rules: Restrict (is it offered), Validate (may it go through) and Actions (what it does). */
export type RuleGroup = "restrict" | "validate" | "action";

/** A rule with the group it belongs to: what the dialog adds and edits. */
export type RuleEntry =
  | { group: "restrict"; rule: Restriction }
  | { group: "validate"; rule: Validation }
  | { group: "action"; rule: TransitionAction };

/** Where a rule sits on a Transition: its group and place in that group's list. */
export type RuleRef = { group: RuleGroup; index: number };

/** The kinds of rule the dialog offers; one editor each. A kind may sit in more than one group (a field value is a Restrict or a Validate). */
export type RuleKind =
  | "field_value"
  | "positions"
  | "not_same_person"
  | "been_through"
  | "all_closed"
  | "field_filled"
  | "form_complete"
  | "has_document"
  | "offer_assign_to"
  | "set_field"
  | "copy_field";

function withTransition(definition: WorkflowDefinition, key: string, change: (t: WorkflowTransition) => WorkflowTransition): WorkflowDefinition {
  return { ...definition, transitions: definition.transitions.map((t) => (t.key === key ? change(t) : t)) };
}

/** A Transition's rules and actions as lists, by group. */
function listsOf(t: WorkflowTransition): { restrict: Restriction[]; validate: Validation[]; action: TransitionAction[] } {
  return { restrict: [...(t.rules?.restrict ?? [])], validate: [...(t.rules?.validate ?? [])], action: [...(t.actions ?? [])] };
}

/** The Transition with these lists; an empty list is left out, so a Transition with none is stored as one with no rules. */
function withLists(t: WorkflowTransition, lists: ReturnType<typeof listsOf>): WorkflowTransition {
  const { rules: _rules, actions: _actions, ...rest } = t;
  const rules = {
    ...(lists.restrict.length > 0 ? { restrict: lists.restrict } : {}),
    ...(lists.validate.length > 0 ? { validate: lists.validate } : {}),
  };
  return {
    ...rest,
    ...(Object.keys(rules).length > 0 ? { rules } : {}),
    ...(lists.action.length > 0 ? { actions: lists.action } : {}),
  };
}

/** Appends a rule to its group's list on Transition `transition`. */
export function addRule(definition: WorkflowDefinition, transition: string, entry: RuleEntry): WorkflowDefinition {
  return withTransition(definition, transition, (t) => {
    const lists = listsOf(t);
    (lists[entry.group] as unknown[]).push(entry.rule);
    return withLists(t, lists);
  });
}

/** Replaces the rule at `ref` with `entry` (the same group), keeping its place. */
export function updateRule(definition: WorkflowDefinition, transition: string, ref: RuleRef, entry: RuleEntry): WorkflowDefinition {
  return withTransition(definition, transition, (t) => {
    const lists = listsOf(t);
    (lists[ref.group] as unknown[])[ref.index] = entry.rule;
    return withLists(t, lists);
  });
}

/** Removes the rule at `ref`. */
export function removeRule(definition: WorkflowDefinition, transition: string, ref: RuleRef): WorkflowDefinition {
  return withTransition(definition, transition, (t) => {
    const lists = listsOf(t);
    lists[ref.group].splice(ref.index, 1);
    return withLists(t, lists);
  });
}

/** A Transition's rules in the order the side editor lists them: Restrict, then Validate, then Actions. */
export function listRules(t: WorkflowTransition): { ref: RuleRef; entry: RuleEntry }[] {
  const lists = listsOf(t);
  return [
    ...lists.restrict.map((rule, index) => ({ ref: { group: "restrict" as const, index }, entry: { group: "restrict" as const, rule } })),
    ...lists.validate.map((rule, index) => ({ ref: { group: "validate" as const, index }, entry: { group: "validate" as const, rule } })),
    ...lists.action.map((rule, index) => ({ ref: { group: "action" as const, index }, entry: { group: "action" as const, rule } })),
  ];
}

// The fields a rule can name -----------------------------------------------------------

/** A Form field a rule can name: its key and label, its type and (for a choice) its options. */
export type RuleField = {
  key: string;
  label: BilingualText;
  type: FormFieldType;
  options?: FormOption[];
  /** The Form's, or the Transition's own Action Form's (which a Validate or an action may also name). */
  source: "form" | "action_form";
};

function fieldsOfSchema(schema: FormSchema, source: RuleField["source"]): RuleField[] {
  return formFields(schema)
    .filter(isAnswerField)
    .map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      ...("options" in f ? { options: f.options } : {}),
      source,
    }));
}

/**
 * The fields a rule's picker lists: the Form's fields that take answers (no
 * headings), then the Transition's own Action Form's. Nothing else, so a rule
 * can't name a field the Form doesn't have (publish check 6 would refuse it).
 */
export function ruleFieldsOf(form: FormSchema | null, actionForm: unknown): RuleField[] {
  let own: FormSchema | null;
  try {
    own = parseActionForm(actionForm);
  } catch {
    own = null; // an Action Form the format no longer reads: publish check 7 names it
  }
  return [...(form ? fieldsOfSchema(form, "form") : []), ...(own ? fieldsOfSchema(own, "action_form") : [])];
}

/** The fields each group of a Transition's rules may name, for its pickers. */
export type TransitionRuleFields = { restrict: RuleField[]; validate: RuleField[]; write: RuleField[] };

/**
 * What Transition `t`'s pickers list, by group: ruleFieldsOf's fields, kept to those
 * publish check 6 accepts there (transitionFieldScope, the rule the check reads).
 * `stages` are the Module's, whose categories say which Step is the Draft.
 */
export function transitionRuleFields(
  form: FormSchema | null,
  t: WorkflowTransition,
  workflow: Pick<WorkflowDefinition, "steps" | "transitions">,
  stages: readonly { key: string; category: StageCategory }[],
): TransitionRuleFields {
  const categories = new Map(stages.map((s) => [s.key, s.category]));
  const scope = transitionFieldScope(t, { steps: workflow.steps, transitions: workflow.transitions, form, categoryOf: (stage) => categories.get(stage) });
  const every = ruleFieldsOf(form, t.actionForm);
  const within = (keys: ReadonlySet<string>) => every.filter((f) => keys.has(f.key));
  return { restrict: within(scope.restrict), validate: within(scope.validate), write: within(scope.write) };
}

/** A field a rule names that the Form doesn't have, kept so the rule can still be shown and changed. */
export const missingRuleField = (key: string): RuleField => ({ key, label: { en: key, ar: key }, type: "text", source: "form" });

/** The field types an action may set or copy: plain answers, not Documents, tables or checklists. */
const settableTypes: readonly FormFieldType[] = ["text", "textarea", "number", "currency", "email", "phone", "date", "datetime", "time", "yes_no", "select"];
export const isSettable = (f: RuleField): boolean => settableTypes.includes(f.type);

/** The field types that hold Documents, which a "has a Document" rule may name. */
export const isDocumentField = (f: RuleField): boolean => f.type === "attachments" || f.type === "photos";

// Conditions -----------------------------------------------------------------------------

const orderable: readonly ConditionOp[] = ["=", "!=", ">", ">=", "<", "<=", "empty", "not_empty"];

/** The operators a field of this type offers (condition.ts's, those that make sense for its answers). */
export function operatorsFor(type: FormFieldType): readonly ConditionOp[] {
  switch (type) {
    case "number":
    case "currency":
    case "calculated":
    case "date":
    case "time":
      return orderable;
    case "text":
    case "textarea":
    case "email":
    case "phone":
    case "yes_no":
      return ["=", "!=", "empty", "not_empty"];
    case "select":
      return ["=", "!=", "in", "not_in", "empty", "not_empty"];
    case "multi_select":
      return ["in", "not_in", "empty", "not_empty"];
    default:
      return ["empty", "not_empty"];
  }
}

export type ValueInput = "none" | "text" | "number" | "date" | "time" | "boolean" | "option" | "options";

/** How the value of "field op value" is entered. */
export function valueInputFor(field: Pick<RuleField, "type">, op: ConditionOp): ValueInput {
  if (op === "empty" || op === "not_empty") return "none";
  if (op === "in" || op === "not_in") return "options";
  switch (field.type) {
    case "yes_no":
      return "boolean";
    case "select":
    case "multi_select":
      return "option";
    case "number":
    case "currency":
    case "calculated":
      return "number";
    case "date":
      return "date";
    case "time":
      return "time";
    default:
      return "text";
  }
}

/** A comparison on `field` that fits the format: the value a new one starts from. */
export function defaultComparison(field: RuleField): Comparison {
  const input = valueInputFor(field, "=");
  if (operatorsFor(field.type).includes("=")) {
    if (input === "number") return { field: field.key, op: "=", value: 0 };
    if (input === "boolean") return { field: field.key, op: "=", value: true };
    if (input === "option") return { field: field.key, op: "=", value: field.options?.[0]?.value ?? "" };
    if (input === "text") return { field: field.key, op: "=", value: "" };
  }
  return { field: field.key, op: "not_empty" };
}

/** The same comparison on another field or operator, keeping the value only when it still fits. */
export function retargetComparison(c: Comparison, field: RuleField, op: ConditionOp = c.op): Comparison {
  const key = field.key;
  const ops = operatorsFor(field.type);
  if (!ops.includes(op)) return defaultComparison(field);
  const input = valueInputFor(field, op);
  if (input === "none") return { field: key, op } as Comparison;
  if (input === "options") return { field: key, op, value: (field.options?.[0] ? [field.options[0].value] : []) as string[] } as Comparison;
  // The value stays while it is entered the same way: the same field, another operator of the same kind.
  const kept = c.field === key && valueInputFor(field, c.op) === input && c.value !== undefined;
  if (kept) return { field: key, op, value: c.value } as Comparison;
  const start = defaultComparison(field);
  const value = "value" in start && start.value !== undefined ? start.value : "";
  return { field: key, op, value } as Comparison;
}

export const allConditionOps: readonly ConditionOp[] = conditionOps;

/** An operator's key in the messages (`=` and `<` are not message keys). */
export const conditionOpKey = {
  "=": "eq",
  "!=": "ne",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  in: "in",
  not_in: "not_in",
  empty: "empty",
  not_empty: "not_empty",
} as const satisfies Record<ConditionOp, string>;

export type ConditionKind = "comparison" | "all" | "any" | "not";

export function conditionKindOf(c: Condition): ConditionKind {
  return "all" in c ? "all" : "any" in c ? "any" : "not" in c ? "not" : "comparison";
}

const childrenOf = (c: Condition): Condition[] => ("all" in c ? c.all : "any" in c ? c.any : "not" in c ? [c.not] : [c]);

const firstComparison = (c: Condition): Comparison | null => {
  if ("all" in c || "any" in c || "not" in c) {
    for (const child of childrenOf(c)) {
      const found = firstComparison(child);
      if (found) return found;
    }
    return null;
  }
  return c;
};

/**
 * Turns a condition into a comparison, "all of", "any of" or "not" without losing
 * what was built: a comparison becomes the one member of a group, a group keeps its
 * members under another kind, and "not" wraps whatever is there. Back to a
 * comparison it keeps the first one; `fallback` stands when there is none.
 */
export function changeConditionKind(c: Condition, kind: ConditionKind, fallback?: Comparison): Condition {
  if (conditionKindOf(c) === kind) return c;
  switch (kind) {
    case "all":
      return { all: childrenOf(c) };
    case "any":
      return { any: childrenOf(c) };
    case "not":
      return { not: c };
    case "comparison": {
      const found = firstComparison(c) ?? fallback;
      if (!found) throw new Error("no comparison to keep");
      return found;
    }
  }
}

// Messages -------------------------------------------------------------------------------

/** What a "field is filled in" Validate says when it refuses a move. */
export function defaultValidationMessage(label: BilingualText): BilingualText {
  return { en: `${label.en} is required.`, ar: `${label.ar} مطلوب.` };
}

// Starting a rule -------------------------------------------------------------------------

export type RuleContext = {
  /** What each group may name (transitionRuleFields). */
  fields: TransitionRuleFields;
  steps: readonly WorkflowStep[];
  transitions: readonly WorkflowTransition[];
  /** The Transition the rule is for. */
  transitionKey: string;
};

type Start = (context: RuleContext) => RuleEntry | null;

/**
 * Every kind the dialog offers, by group, in the order it lists them, with the rule
 * it starts from: one fitting the format, on the first field the group may name
 * that suits it; null when it can't start (a field rule with no field to name; a
 * Document rule with none still starts: it means any Document on the item). Adding
 * a kind adds its row here, its editor and summary (exhaustive switches over the
 * stored rule) and its messages.
 */
const ruleKindTable: Record<RuleGroup, Partial<Record<RuleKind, Start>>> = {
  restrict: {
    field_value: ({ fields }) => {
      const first = fields.restrict[0];
      return first ? { group: "restrict", rule: { type: "condition", condition: defaultComparison(first) } } : null;
    },
    // Starts with none chosen: the format needs at least one, so the dialog holds it until one is ticked.
    positions: () => ({ group: "restrict", rule: { type: "positions", positions: [] } }),
    not_same_person: ({ steps, transitions, transitionKey }) => {
      const sourceStep = transitions.find((t) => t.key === transitionKey)?.from;
      const held = steps.find((s) => s.actor !== null && s.key !== sourceStep) ?? steps.find((s) => s.actor !== null);
      return held ? { group: "restrict", rule: { type: "not_same_person", step: held.key } } : null;
    },
    been_through: () => ({ group: "restrict", rule: { type: "been_through", fact: "sent_back" } }),
    all_closed: () => ({ group: "restrict", rule: { type: "all_closed", items: "comments" } }),
  },
  validate: {
    field_filled: ({ fields }) => {
      const first = fields.validate[0];
      return first ? { group: "validate", rule: { type: "condition", condition: { field: first.key, op: "not_empty" }, message: defaultValidationMessage(first.label) } } : null;
    },
    field_value: ({ fields }) => {
      const first = fields.validate[0];
      return first ? { group: "validate", rule: { type: "condition", condition: defaultComparison(first), message: { en: "", ar: "" } } } : null;
    },
    form_complete: () => ({ group: "validate", rule: { type: "form_complete" } }),
    has_document: () => ({ group: "validate", rule: { type: "has_document" } }),
  },
  action: {
    offer_assign_to: () => ({ group: "action", rule: { type: "offer_assign_to" } }),
    set_field: ({ fields }) => {
      const target = fields.write.filter(isSettable)[0];
      return target ? { group: "action", rule: { type: "set_field", field: target.key, value: defaultSetValue(target) } } : null;
    },
    copy_field: ({ fields }) => {
      const settable = fields.write.filter(isSettable);
      const from = settable[0];
      const to = settable[1] ?? from;
      return from && to ? { group: "action", rule: { type: "copy_field", from: from.key, to: to.key } } : null;
    },
  },
};

/** What the dialog offers, by group, in order. */
export const ruleKinds = Object.fromEntries(Object.entries(ruleKindTable).map(([group, kinds]) => [group, Object.keys(kinds)])) as Record<RuleGroup, RuleKind[]>;

/** A new rule of `kind` in `group` (ruleKindTable); null when it can't start, or the group has no such kind. */
export function defaultRule(kind: RuleKind, group: RuleGroup, context: RuleContext): RuleEntry | null {
  return ruleKindTable[group][kind]?.(context) ?? null;
}

/** The value a "set a field" action starts from, for the field's type. */
export function defaultSetValue(field: RuleField): string | number | boolean {
  switch (valueInputFor(field, "=")) {
    case "number":
      return 0;
    case "boolean":
      return true;
    case "option":
      return field.options?.[0]?.value ?? "";
    default:
      return "";
  }
}

/** Which of the dialog's kinds a stored rule is (a field-filled Validate is a condition with `not_empty`). */
export function ruleKindOf(entry: RuleEntry): RuleKind {
  switch (entry.group) {
    case "restrict": {
      const r = entry.rule;
      return r.type === "condition" ? "field_value" : r.type;
    }
    case "validate": {
      const v = entry.rule;
      if (v.type !== "condition") return v.type;
      const c = v.condition;
      return "field" in c && c.field !== undefined && c.op === "not_empty" ? "field_filled" : "field_value";
    }
    case "action":
      return entry.rule.type;
  }
}

// Notifications ---------------------------------------------------------------------------

const sameRecipient = (a: NotificationRecipient, b: NotificationRecipient) => a.to === b.to && (a.to !== "position" || (b.to === "position" && a.position === b.position));

/**
 * Names or drops a recipient of the Transition's notifications, each once. The next
 * holder or Step Pool is always told (WF-9): it is never stored, so naming it does nothing.
 */
export function setRecipient(definition: WorkflowDefinition, transition: string, recipient: NotificationRecipient, on: boolean): WorkflowDefinition {
  if (recipient.to === "holder") return definition;
  return withTransition(definition, transition, (t) => {
    const { notifications, ...rest } = t;
    const without = (notifications ?? []).filter((n) => !sameRecipient(n, recipient));
    const next = on ? [...without, recipient] : without;
    // Naming it again keeps its place.
    const kept = on && (notifications ?? []).some((n) => sameRecipient(n, recipient)) ? (notifications ?? []) : next;
    return kept.length > 0 ? { ...rest, notifications: kept } : rest;
  });
}

export type PositionOption = { role: BaseRole; key: string; name: BilingualText };

/** What the Notifications tab shows for a Transition. */
export type NotificationChoices = {
  holder: { always: true };
  raiser: boolean;
  watchers: boolean;
  /** The Positions of the acting Participant (the role of the Transition's source Step), ticked when named. */
  positions: { key: string; name: BilingualText; on: boolean }[];
};

export function notificationChoices(t: WorkflowTransition, steps: readonly WorkflowStep[], positions: readonly PositionOption[]): NotificationChoices {
  const named = t.notifications ?? [];
  const role = steps.find((s) => s.key === t.from)?.actor?.role;
  return {
    holder: { always: true },
    raiser: named.some((n) => n.to === "raiser"),
    watchers: named.some((n) => n.to === "watchers"),
    positions: positions
      .filter((p) => p.role === role)
      .map((p) => ({ key: p.key, name: p.name, on: named.some((n) => n.to === "position" && n.position === p.key) })),
  };
}

// Problems ----------------------------------------------------------------------------------

/** The problem codes of publish check 6 and what rules and actions name (workflow-checks.ts), and the §4 warnings about conditions. */
const ruleProblemCodes: readonly string[] = [
  "unknown_field",
  "unknown_attribute",
  "unknown_step",
  "unknown_transition",
  "been_through_other_participant",
  "not_a_document_field",
  "field_not_filled_at_step",
  "now_not_a_date_field",
  "names_person",
  "copy_internal_answer",
  "condition_overlap",
  "condition_gap",
];

/** The publish problems that concern the rules, actions and conditions of Transition `transition`, for its side editor. */
export function workflowRuleProblemsOf(problems: readonly WorkflowProblem[], transition: string): WorkflowProblem[] {
  return problems.filter((p) => p.transition === transition && ruleProblemCodes.includes(p.code));
}

// Completeness ------------------------------------------------------------------------------

const conditionComplete = (c: Condition): boolean => {
  if ("all" in c || "any" in c) {
    const items = "all" in c ? c.all : c.any;
    return items.length > 0 && items.every(conditionComplete);
  }
  if ("not" in c) return conditionComplete(c.not);
  if (c.op === "in" || c.op === "not_in") return Array.isArray(c.value) && c.value.length > 0;
  if (c.op === "empty" || c.op === "not_empty") return true;
  return c.value !== undefined && !(Array.isArray(c.value) && c.value.length === 0);
};

/** Whether a rule is finished enough to add: Positions chosen, a message in both languages, no empty group. */
export function isRuleComplete(entry: RuleEntry): boolean {
  switch (entry.group) {
    case "restrict": {
      const r = entry.rule;
      return r.type === "condition" ? conditionComplete(r.condition) : r.type === "positions" ? r.positions.length > 0 : true;
    }
    case "validate": {
      const v = entry.rule;
      return v.type === "condition" ? conditionComplete(v.condition) && v.message.en.trim() !== "" && v.message.ar.trim() !== "" : true;
    }
    case "action":
      return true;
  }
}
