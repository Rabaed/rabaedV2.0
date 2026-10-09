import { workflowActionFormProblems } from "./action-form.ts";
import type { OutcomeKind, StageCategory } from "./chain-bucket.ts";
import type { BilingualText } from "./company.ts";
import { evaluateCondition, type Comparison, type Condition } from "./condition.ts";
import { formFields, formSchema, type FormField, type FormSchema } from "./form.ts";
import { sectionSteps, type WorkflowStepHolder } from "./form-sections.ts";
import { isOpenStageCategory, outcomeSets, type WorkItemOutcome } from "./work-item.ts";
import type { WorkflowDefinition, WorkflowStep, WorkflowTransition } from "./workflow-definition.ts";
import { workflowKindProblems } from "./workflow-publish.ts";

// Every publish check of a Workflow Version (workflow-engine.md §1, §4; RP-425,
// spec RP-423), over the definition format (workflow-definition.ts). The builder
// runs it live, the api again on publish, Rabaed Admin on import. Check 5 is
// dropped (ADR 0017); checks 4, 7 and 8 are the built ones (workflowKindProblems,
// workflowActionFormProblems). Each problem has a stable code, the Step or
// Transition it concerns, and its message in English and Arabic.

/** What the checks read besides the definition. */
export type WorkflowPublishContext = {
  /**
   * The Work Item Type's outcome kind: which outcome set its closing Transitions
   * use. WF-6 (RP-429) replaces it with the Type's own, editable outcome set.
   */
  outcomeKind: OutcomeKind;
  /** The Module's Stage set (the Project's, or the Rabaed Defaults'): Stages come from here, never from the definition. */
  stages: readonly { key: string; category: StageCategory }[];
  /** The latest published Version of the Type's Form; null when it has none. */
  form: FormSchema | null;
  /** The Option Lists an Action Form may name (check 7). */
  optionListIds?: ReadonlySet<string>;
};

export const workflowProblemCodes = [
  // Structure and check 1
  "duplicate_step",
  "duplicate_transition",
  "unknown_step",
  "no_draft_step",
  "several_draft_steps",
  "unreachable_step",
  "dead_end_step",
  "step_without_actor",
  // Check 2
  "unknown_stage",
  "terminal_step_has_transitions",
  // Check 3
  "no_issuing_step",
  "missing_outcome",
  "outcome_not_in_set",
  "outcome_not_from_issuing_step",
  "outcome_on_open_step",
  "close_to_open_step",
  "ends_without_close",
  // Check 4 and 8 (workflowKindProblems)
  "return_crosses_participants",
  "submit_stays_inside",
  "send_back_not_to_submitter",
  "send_back_sets_outcome",
  "cycle_without_way_back",
  "loop_across_participants",
  // Check 7 (workflowActionFormProblems)
  "invalid_action_form",
  // Cancel (spec RP-423)
  "cancel_not_by_raiser",
  "cancel_not_to_cancelled_stage",
  "cancel_sets_outcome",
  // Check 6, and what rules and actions name
  "unknown_field",
  "unknown_attribute",
  "unknown_transition",
  "been_through_other_participant",
  "not_a_document_field",
  "field_not_filled_at_step",
  "now_not_a_date_field",
  "names_person",
  "copy_internal_answer",
  // Warnings (§4)
  "condition_overlap",
  "condition_gap",
] as const;
export type WorkflowProblemCode = (typeof workflowProblemCodes)[number];

/** One thing that stops a Version from being published (`error`), or that its author should look at (`warning`). */
export type WorkflowProblem = {
  code: WorkflowProblemCode;
  severity: "error" | "warning";
  /** The Step it concerns, by key. */
  step?: string;
  /** The Transition it concerns, by key. */
  transition?: string;
  /** What else it names: a Stage, a field, an attribute, an outcome code or another Step or Transition. */
  detail?: string;
  message: BilingualText;
};

/** A problem as a check finds it, before its message; `reason` is an English-only code for the English message. */
type FoundProblem = Omit<WorkflowProblem, "message" | "severity"> & { severity?: WorkflowProblem["severity"]; reason?: string };

/** The definition and context, with the lookups every check shares. */
type CheckInput = WorkflowDefinition & {
  context: WorkflowPublishContext;
  stepOf: ReadonlyMap<string, WorkflowStep>;
  /** A Stage's category; undefined when the Module has no such Stage. */
  categoryOf: (stage: string) => StageCategory | undefined;
  /** The Step sits in a closed or cancelled Stage. */
  isTerminal: (step: WorkflowStep) => boolean;
};

/**
 * Every problem stopping `definition` from being published in `context`, errors
 * and warnings, in check order. Empty when there is nothing.
 */
export function workflowPublishProblems(definition: WorkflowDefinition, context: WorkflowPublishContext): WorkflowProblem[] {
  const categories = new Map(context.stages.map((s) => [s.key, s.category]));
  const categoryOf = (stage: string) => categories.get(stage);
  const input: CheckInput = {
    ...definition,
    context,
    stepOf: new Map(definition.steps.map((s) => [s.key, s])),
    categoryOf,
    isTerminal: (s) => {
      const category = categoryOf(s.stage);
      return category !== undefined && !isOpenStageCategory(category);
    },
  };
  const found = [
    ...structureProblems(input),
    ...graphProblems(input),
    ...stageProblems(input),
    ...outcomeProblems(input),
    ...builtCheckProblems(input),
    ...cancelProblems(input),
    ...ruleProblems(input),
    ...routingWarnings(input),
  ];
  return found.map(({ reason, ...p }) => ({ ...p, severity: p.severity ?? "error", message: message({ ...p, reason }, definition) }));
}

function structureProblems({ steps, transitions, stepOf }: CheckInput): FoundProblem[] {
  return [
    ...duplicates(steps.map((s) => s.key)).map((step): FoundProblem => ({ code: "duplicate_step", step })),
    ...duplicates(transitions.map((t) => t.key)).map((transition): FoundProblem => ({ code: "duplicate_transition", transition })),
    ...transitions
      .filter((t) => !stepOf.has(t.from) || !stepOf.has(t.to))
      .map((t): FoundProblem => ({ code: "unknown_step", transition: t.key, detail: stepOf.has(t.from) ? t.to : t.from })),
  ];
}

/** Check 1: one Draft Step, every Step reachable from it, every open Step held and with a way out. */
function graphProblems({ steps, transitions, categoryOf, isTerminal }: CheckInput): FoundProblem[] {
  const drafts = steps.filter((s) => categoryOf(s.stage) === "draft");
  const draftProblems: FoundProblem[] =
    drafts.length === 0 ? [{ code: "no_draft_step" }] : drafts.slice(1).map((s): FoundProblem => ({ code: "several_draft_steps", step: s.key }));
  const reached = drafts[0] === undefined ? null : reachable(transitions, drafts[0].key);
  return [
    ...draftProblems,
    ...steps.flatMap((s): FoundProblem[] => {
      const open = !isTerminal(s);
      return [
        ...(reached !== null && !reached.has(s.key) ? [{ code: "unreachable_step", step: s.key } as const] : []),
        ...(open && !transitions.some((t) => t.from === s.key) ? [{ code: "dead_end_step", step: s.key } as const] : []),
        ...(open && s.actor === null ? [{ code: "step_without_actor", step: s.key } as const] : []),
      ];
    }),
  ];
}

/** Check 2: every Step's Stage is the Module's; nothing leaves a terminal Step. */
function stageProblems({ steps, transitions, categoryOf, isTerminal }: CheckInput): FoundProblem[] {
  const terminal = new Set(steps.filter(isTerminal).map((s) => s.key));
  return [
    ...steps.filter((s) => categoryOf(s.stage) === undefined).map((s): FoundProblem => ({ code: "unknown_stage", step: s.key, detail: s.stage })),
    ...transitions.filter((t) => terminal.has(t.from)).map((t): FoundProblem => ({ code: "terminal_step_has_transitions", transition: t.key })),
  ];
}

/**
 * Check 3: a close into a terminal Step sets an outcome of the Type's set
 * (`outcomeSets`, fixed until WF-6), from the Step that issues it; nothing else
 * sets one. A Cancel is checked on its own.
 */
function outcomeProblems({ steps, transitions, context, stepOf, isTerminal }: CheckInput): FoundProblem[] {
  const issues = context.outcomeKind !== "none";
  const set: readonly WorkItemOutcome[] = outcomeSets[context.outcomeKind];
  return [
    ...(issues && !steps.some((s) => s.outcomeMode === "issue_outcome") ? [{ code: "no_issuing_step" } as const] : []),
    ...transitions.flatMap((t): FoundProblem[] => {
      const [from, to] = [stepOf.get(t.from), stepOf.get(t.to)];
      if (from === undefined || to === undefined || t.kind === "cancel") return [];
      const problemAt = (code: WorkflowProblemCode): FoundProblem[] => [{ code, transition: t.key, ...(t.outcome === null ? {} : { detail: t.outcome }) }];
      if (!isTerminal(to)) {
        if (t.kind === "close") return problemAt("close_to_open_step");
        return t.outcome !== null && t.kind !== "send_back" ? problemAt("outcome_on_open_step") : [];
      }
      if (t.kind !== "close") return problemAt("ends_without_close");
      if (t.outcome === null) return problemAt("missing_outcome");
      if (!(set as readonly string[]).includes(t.outcome)) return problemAt("outcome_not_in_set");
      return issues && from.outcomeMode !== "issue_outcome" ? problemAt("outcome_not_from_issuing_step") : [];
    }),
  ];
}

/** Checks 4 and 8 (workflowKindProblems) and 7 (workflowActionFormProblems), as built, on the definition. */
function builtCheckProblems({ steps, transitions, context }: CheckInput): FoundProblem[] {
  const kindProblems = workflowKindProblems(
    steps.map((s) => ({ key: s.key, role: s.actor?.role ?? null })),
    transitions.map((t) => ({ key: t.key, from: t.from, to: t.to, kind: t.kind, outcome: t.outcome })),
  );
  const formProblems = workflowActionFormProblems(
    transitions.map((t) => ({ key: t.key, actionForm: t.actionForm })),
    context.optionListIds === undefined ? {} : { optionListIds: context.optionListIds },
  );
  return [
    ...kindProblems.map((p): FoundProblem => ({ code: p.code, transition: p.transition })),
    ...formProblems.map((p): FoundProblem => ({ code: "invalid_action_form", transition: p.transition, detail: p.key, reason: p.code })),
  ];
}

/** A Cancel leaves only the raiser's own Steps (its Draft Step's role), into a cancelled Stage, with no outcome. */
function cancelProblems({ steps, transitions, stepOf, categoryOf }: CheckInput): FoundProblem[] {
  const raiser = steps.find((s) => categoryOf(s.stage) === "draft")?.actor?.role;
  return transitions
    .filter((t) => t.kind === "cancel")
    .flatMap((t): FoundProblem[] => {
      const [from, to] = [stepOf.get(t.from), stepOf.get(t.to)];
      const codes: WorkflowProblemCode[] = [];
      if (from !== undefined && (raiser === undefined || from.actor?.role !== raiser)) codes.push("cancel_not_by_raiser");
      if (to !== undefined && categoryOf(to.stage) !== "cancelled") codes.push("cancel_not_to_cancelled_stage");
      if (t.outcome !== null) codes.push("cancel_sets_outcome");
      return codes.map((code) => ({ code, transition: t.key }));
    });
}

/** The item attributes a rule may read (`attr`, §4). */
export const workflowRuleAttrs = ["trade", "location", "work_item_type", "revision_no"] as const;

/** The field types that hold Documents, which a "has a Document" rule may name. */
const documentFieldTypes: readonly string[] = ["attachments", "photos"];
/** The field types a set field may set to the moment the Transition is taken. */
const momentFieldTypes: readonly string[] = ["date", "datetime", "time"];
/** The kinds of a move inside one Participant, whose event (with its Action Form answers) is internal to it (§5.1). */
const internalKinds: readonly string[] = ["send", "return"];

/** The comparisons of a condition, at any depth, in the order read. */
function comparisons(rule: Condition): Comparison[] {
  if ("all" in rule) return rule.all.flatMap(comparisons);
  if ("any" in rule) return rule.any.flatMap(comparisons);
  if ("not" in rule) return comparisons(rule.not);
  return [rule];
}

/** The fields of a stored Action Form, by key; none when it isn't a Form schema (check 7 says so). */
function actionFormFields(actionForm: unknown): Map<string, FormField> {
  const parsed = formSchema.safeParse(actionForm);
  return new Map(parsed.success ? formFields(parsed.data).map((f) => [f.key, f]) : []);
}

/** Transitions with one label group share a label and source Step: one button, the condition picking among them (§4). */
const labelGroupOf = (t: WorkflowTransition) => JSON.stringify([t.from, t.label.en, t.label.ar]);

/** The Transitions sharing `t`'s label and source Step, `t` included. */
const sharingLabel = (transitions: readonly WorkflowTransition[], t: WorkflowTransition) =>
  transitions.filter((other) => labelGroupOf(other) === labelGroupOf(t));

/**
 * Check 6, Transition by Transition, and what rules and actions name.
 *
 * Conditions read the Form's latest published Version and the item's attributes.
 * A Validate also reads this Transition's Action Form answers. A Restrict hides
 * the button, before any pop-up is filled, so it reads them only when it picks
 * among Transitions sharing a label and source Step (WF-7, §4), and then only
 * fields every one of their Action Forms asks.
 *
 * Actions write only fields the acting Participant fills at that Step (WF-8):
 * this Transition's Action Form, and the Form Sections changed at its source
 * Step (form-sections.ts); a copy reads from those fields only, never another
 * Participant's answers, and on a move inside one Participant never carries its
 * Action Form answers (internal, V5) into the Form, which every Participant reads
 * once the item leaves. Setting a Member field to a value would name a person.
 *
 * The Steps and Transitions a rule names exist, "been through" a Step names one
 * of the acting Participant's own (its source Step's role), and a Document rule
 * names a Document field.
 */
function ruleProblems({ steps, transitions, context, stepOf, categoryOf }: CheckInput): FoundProblem[] {
  const formFieldOf = new Map(context.form === null ? [] : formFields(context.form).map((f) => [f.key, f]));
  const holders: WorkflowStepHolder[] = steps.map((s) => ({ key: s.key, role: s.actor?.role ?? null, draft: categoryOf(s.stage) === "draft" }));
  const filledAt = (step: string) =>
    new Set((context.form?.sections ?? []).filter((section) => sectionSteps(section, holders).includes(step)).flatMap((section) => section.fields.map((f) => f.key)));
  const transitionKeys = new Set(transitions.map((t) => t.key));

  return transitions.flatMap((t): FoundProblem[] => {
    const ownActionForm = actionFormFields(t.actionForm);
    const problemAt = (code: WorkflowProblemCode, detail: string): FoundProblem => ({ code, transition: t.key, detail });
    const conditionReadProblems = (rule: Condition, readable: (field: string) => boolean): FoundProblem[] =>
      comparisons(rule).flatMap((c): FoundProblem[] => {
        if (c.field !== undefined) return readable(c.field) ? [] : [problemAt("unknown_field", c.field)];
        return (workflowRuleAttrs as readonly string[]).includes(c.attr) ? [] : [problemAt("unknown_attribute", c.attr)];
      });

    const group = sharingLabel(transitions, t);
    const routingFields = group.length < 2 ? new Set<string>() : new Set([...ownActionForm.keys()].filter((key) => group.every((g) => actionFormFields(g.actionForm).has(key))));
    const restrictReads = (field: string) => formFieldOf.has(field) || routingFields.has(field);
    const fieldOf = (field: string) => ownActionForm.get(field) ?? formFieldOf.get(field);

    const fillable = new Set([...filledAt(t.from), ...ownActionForm.keys()]);
    const writeProblems = (field: string): FoundProblem[] => {
      if (fieldOf(field) === undefined) return [problemAt("unknown_field", field)];
      return fillable.has(field) ? [] : [problemAt("field_not_filled_at_step", field)];
    };

    return [
      ...(t.rules?.restrict ?? []).flatMap((r): FoundProblem[] => {
        if (r.type === "condition") return conditionReadProblems(r.condition, restrictReads);
        if (r.type === "not_same_person" && "transition" in r) return transitionKeys.has(r.transition) ? [] : [problemAt("unknown_transition", r.transition)];
        if ((r.type !== "not_same_person" && r.type !== "been_through") || !("step" in r)) return [];
        const named = stepOf.get(r.step);
        if (named === undefined) return [problemAt("unknown_step", r.step)];
        const ownRole = stepOf.get(t.from)?.actor?.role;
        return r.type === "been_through" && named.actor?.role !== ownRole ? [problemAt("been_through_other_participant", r.step)] : [];
      }),
      ...(t.rules?.validate ?? []).flatMap((v): FoundProblem[] => {
        if (v.type === "condition") return conditionReadProblems(v.condition, (field) => fieldOf(field) !== undefined);
        if (v.type !== "has_document" || v.field === undefined) return [];
        const named = fieldOf(v.field);
        if (named === undefined) return [problemAt("unknown_field", v.field)];
        return documentFieldTypes.includes(named.type) ? [] : [problemAt("not_a_document_field", v.field)];
      }),
      ...(t.actions ?? []).flatMap((a): FoundProblem[] => {
        if (a.type === "copy_field") {
          // A move inside one Participant keeps its Action Form answers internal (V5); the Form reaches everyone later.
          const leaks = internalKinds.includes(t.kind) && ownActionForm.has(a.from) && !ownActionForm.has(a.to) && formFieldOf.has(a.to);
          return [...writeProblems(a.from), ...writeProblems(a.to), ...(leaks ? [problemAt("copy_internal_answer", a.from)] : [])];
        }
        if (a.type !== "set_field") return [];
        const problems = writeProblems(a.field);
        if (problems.length > 0) return problems;
        const type = fieldOf(a.field)!.type;
        if (typeof a.value === "object") return momentFieldTypes.includes(type) ? [] : [problemAt("now_not_a_date_field", a.field)];
        return type === "member" ? [problemAt("names_person", a.field)] : [];
      }),
    ];
  });
}

/** The Restrict conditions of a Transition, as one (null: it is offered whatever the answers). */
function routingCondition(t: WorkflowTransition): Condition | null {
  const rules = (t.rules?.restrict ?? []).flatMap((r) => (r.type === "condition" ? [r.condition] : []));
  return rules.length === 0 ? null : rules.length === 1 ? rules[0]! : { all: rules };
}

/** At most this many answer combinations are tried per group of Transitions. */
const maxCombinations = 4096;

/**
 * §4: among Transitions sharing a label and source Step, exactly one should match
 * at run time. Tries the answers that sit on each condition's edges (each value
 * compared with, one either side of a number, another value, no answer) and warns
 * when some match two or more (`condition_overlap`) or none (`condition_gap`),
 * once per group, on its first Transition.
 */
function routingWarnings({ transitions }: CheckInput): FoundProblem[] {
  const groups = new Map<string, WorkflowTransition[]>();
  for (const t of transitions) {
    const group = labelGroupOf(t);
    groups.set(group, [...(groups.get(group) ?? []), t]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .flatMap((group): FoundProblem[] => {
      const rules = group.map(routingCondition);
      let overlap = false;
      let gap = false;
      for (const sources of answerCombinations(rules.flatMap((r) => (r === null ? [] : comparisons(r))))) {
        const matching = rules.filter((r) => r === null || evaluateCondition(r, sources)).length;
        overlap ||= matching > 1;
        gap ||= matching === 0;
        if (overlap && gap) break;
      }
      const detail = group.map((t) => t.key).join(", ");
      return [
        ...(overlap ? [{ code: "condition_overlap", severity: "warning", transition: group[0]!.key, detail } as const] : []),
        ...(gap ? [{ code: "condition_gap", severity: "warning", transition: group[0]!.key, detail } as const] : []),
      ];
    });
}

type Sources = { fields: Record<string, unknown>; attrs: Record<string, unknown> };

/** A text no condition compares with: "some other answer" beside a compared text. */
const anotherText = "\u0000another";

/** The edge answers of `compared`'s comparisons, combined, up to `maxCombinations` of them. */
function* answerCombinations(compared: readonly Comparison[]): Generator<Sources> {
  const candidates = new Map<string, unknown[]>();
  for (const c of compared) {
    const name = c.field !== undefined ? `field:${c.field}` : `attr:${c.attr}`;
    const values = candidates.get(name) ?? [undefined];
    const comparedValues = c.value === undefined ? [] : Array.isArray(c.value) ? c.value : [c.value];
    const ordered = c.op === ">" || c.op === ">=" || c.op === "<" || c.op === "<=";
    for (const v of comparedValues) {
      // A text value compared for equality has another text beside it; a number, its neighbours.
      if (typeof v === "number") values.push(v - 1, v, v + 1);
      else if (typeof v === "boolean") values.push(true, false);
      else values.push(v, ...(ordered ? [] : [anotherText]));
    }
    candidates.set(name, [...new Set(values)]);
  }
  const names = [...candidates.keys()];
  const total = names.reduce((product, name) => product * candidates.get(name)!.length, 1);
  for (let i = 0; i < Math.min(total, maxCombinations); i++) {
    const sources: Sources = { fields: {}, attrs: {} };
    let rest = i;
    for (const name of names) {
      const values = candidates.get(name)!;
      const value = values[rest % values.length];
      rest = Math.floor(rest / values.length);
      const [kind, key] = name.split(":") as ["field" | "attr", string];
      if (kind === "field") sources.fields[key] = value;
      else sources.attrs[key] = value;
    }
    yield sources;
  }
}

function duplicates(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  return [...new Set(keys.filter((k) => seen.has(k) || !seen.add(k)))];
}

/** The Steps reachable from `start` along `transitions` (`start` included). */
function reachable(transitions: readonly WorkflowTransition[], start: string): Set<string> {
  const seen = new Set([start]);
  const toVisit = [start];
  for (let s = toVisit.shift(); s !== undefined; s = toVisit.shift()) {
    for (const t of transitions) {
      if (t.from === s && !seen.has(t.to)) {
        seen.add(t.to);
        toVisit.push(t.to);
      }
    }
  }
  return seen;
}

// Messages ---------------------------------------------------------------------------

/** The quoted names a message uses. `reason` is an English-only code, for the English message only. */
type Names = { step: BilingualText; transition: BilingualText; detail: string; reason: string };

const messages: Record<WorkflowProblemCode, (names: Names) => BilingualText> = {
  duplicate_step: (names) => ({ en: `Two Steps share the key of ${names.step.en}.`, ar: `خطوتان تشتركان في مفتاح ${names.step.ar}.` }),
  duplicate_transition: (names) => ({
    en: `Two Transitions share the key of ${names.transition.en}.`,
    ar: `انتقالان يشتركان في مفتاح ${names.transition.ar}.`,
  }),
  unknown_step: (names) => ({
    en: `${names.transition.en} points to a Step that isn't in this Workflow (${names.detail}).`,
    ar: `${names.transition.ar} يشير إلى خطوة غير موجودة في سير العمل هذا (${names.detail}).`,
  }),
  no_draft_step: () => ({
    en: "The Workflow needs one Draft Step, where items are created.",
    ar: "يحتاج سير العمل إلى خطوة مسودة واحدة تُنشأ فيها العناصر.",
  }),
  several_draft_steps: (names) => ({
    en: `${names.step.en} is a second Draft Step: a Workflow has exactly one.`,
    ar: `${names.step.ar} خطوة مسودة ثانية: لسير العمل خطوة مسودة واحدة فقط.`,
  }),
  unreachable_step: (names) => ({
    en: `${names.step.en} can't be reached from the Draft Step.`,
    ar: `لا يمكن الوصول إلى ${names.step.ar} من خطوة المسودة.`,
  }),
  dead_end_step: (names) => ({
    en: `${names.step.en} has no Transition out, but its Stage is open.`,
    ar: `لا يخرج من ${names.step.ar} أي انتقال، مع أن مرحلتها مفتوحة.`,
  }),
  step_without_actor: (names) => ({
    en: `${names.step.en} needs a Project Role and a Function Permission for whoever holds it.`,
    ar: `تحتاج ${names.step.ar} إلى دور في المشروع وصلاحية لمن يتولاها.`,
  }),
  unknown_stage: (names) => ({
    en: `${names.step.en} is in Stage "${names.detail}", which this Module doesn't have.`,
    ar: `${names.step.ar} في المرحلة "${names.detail}"، وهي ليست من مراحل هذه الوحدة.`,
  }),
  terminal_step_has_transitions: (names) => ({
    en: `${names.transition.en} leaves a closed Step: an item that reaches it is closed.`,
    ar: `${names.transition.ar} يخرج من خطوة مغلقة: العنصر الذي يصلها يُغلق.`,
  }),
  no_issuing_step: () => ({
    en: "No Step issues the outcome: this Work Item Type needs one that does.",
    ar: "لا توجد خطوة تُصدر النتيجة: نوع العنصر هذا يحتاج إلى خطوة تُصدرها.",
  }),
  missing_outcome: (names) => ({
    en: `${names.transition.en} closes the item, so it needs an outcome.`,
    ar: `${names.transition.ar} يُغلق العنصر، لذا يحتاج إلى نتيجة.`,
  }),
  outcome_not_in_set: (names) => ({
    en: `${names.transition.en} sets outcome ${names.detail}, which this Work Item Type doesn't have.`,
    ar: `${names.transition.ar} يضع النتيجة ${names.detail}، وهي ليست من نتائج نوع العنصر هذا.`,
  }),
  outcome_not_from_issuing_step: (names) => ({
    en: `${names.transition.en} sets outcome ${names.detail} from a Step that doesn't issue the outcome.`,
    ar: `${names.transition.ar} يضع النتيجة ${names.detail} من خطوة لا تُصدر النتيجة.`,
  }),
  outcome_on_open_step: (names) => ({
    en: `${names.transition.en} sets outcome ${names.detail} but doesn't close the item.`,
    ar: `${names.transition.ar} يضع النتيجة ${names.detail} لكنه لا يُغلق العنصر.`,
  }),
  close_to_open_step: (names) => ({
    en: `${names.transition.en} is a close, but goes to a Step in an open Stage.`,
    ar: `${names.transition.ar} انتقال إغلاق، لكنه يذهب إلى خطوة في مرحلة مفتوحة.`,
  }),
  ends_without_close: (names) => ({
    en: `${names.transition.en} goes to a closed Step, so it must be a close or a Cancel.`,
    ar: `${names.transition.ar} يذهب إلى خطوة مغلقة، لذا يجب أن يكون إغلاقًا أو إلغاءً.`,
  }),
  return_crosses_participants: (names) => ({
    en: `${names.transition.en} is a Return, so it must stay inside one Participant.`,
    ar: `${names.transition.ar} إعادة، لذا يجب أن يبقى داخل المشارك نفسه.`,
  }),
  submit_stays_inside: (names) => ({
    en: `${names.transition.en} is a Submit, so it must hand the item to another Participant.`,
    ar: `${names.transition.ar} تقديم، لذا يجب أن يسلّم العنصر إلى مشارك آخر.`,
  }),
  send_back_not_to_submitter: (names) => ({
    en: `${names.transition.en} is a Send Back, so it must go back to the Participant that Submitted the item.`,
    ar: `${names.transition.ar} إرجاع إلى المقدّم، لذا يجب أن يعود إلى المشارك الذي قدّم العنصر.`,
  }),
  send_back_sets_outcome: (names) => ({
    en: `${names.transition.en} is a Send Back, which sets no outcome.`,
    ar: `${names.transition.ar} إرجاع إلى المقدّم، ولا يضع أي نتيجة.`,
  }),
  cycle_without_way_back: (names) => ({
    en: `${names.transition.en} closes a loop with no Return or Send Back in it.`,
    ar: `${names.transition.ar} يُكمل حلقة ليس فيها إعادة ولا إرجاع إلى المقدّم.`,
  }),
  loop_across_participants: (names) => ({
    en: `${names.transition.en} is in a loop across Participants without a Send Back.`,
    ar: `${names.transition.ar} ضمن حلقة بين المشاركين دون إرجاع إلى المقدّم.`,
  }),
  invalid_action_form: (names) => ({
    en: `The Action Form of ${names.transition.en} isn't a valid Form: "${names.detail}" (${names.reason}).`,
    ar: `النموذج المنبثق لـ ${names.transition.ar} ليس نموذجًا صالحًا: "${names.detail}".`,
  }),
  cancel_not_by_raiser: (names) => ({
    en: `${names.transition.en} is a Cancel, which only the raiser's own Steps offer.`,
    ar: `${names.transition.ar} إلغاء، ولا تتيحه إلا خطوات مُنشئ العنصر.`,
  }),
  cancel_not_to_cancelled_stage: (names) => ({
    en: `${names.transition.en} is a Cancel, so it must go to a Step in a cancelled Stage.`,
    ar: `${names.transition.ar} إلغاء، لذا يجب أن يذهب إلى خطوة في مرحلة ملغاة.`,
  }),
  cancel_sets_outcome: (names) => ({
    en: `${names.transition.en} is a Cancel, which sets no outcome.`,
    ar: `${names.transition.ar} إلغاء، ولا يضع أي نتيجة.`,
  }),
  unknown_field: (names) => ({
    en: `${names.transition.en} reads field "${names.detail}", which the Form doesn't have where the rule is checked.`,
    ar: `${names.transition.ar} يقرأ الحقل "${names.detail}"، وهو غير موجود في النموذج حيث تُفحص القاعدة.`,
  }),
  unknown_attribute: (names) => ({
    en: `${names.transition.en} reads "${names.detail}", which isn't an item attribute rules can read.`,
    ar: `${names.transition.ar} يقرأ "${names.detail}"، وهي ليست من خصائص العنصر التي تقرؤها القواعد.`,
  }),
  unknown_transition: (names) => ({
    en: `${names.transition.en} points to Transition "${names.detail}", which isn't in this Workflow.`,
    ar: `${names.transition.ar} يذكر الانتقال "${names.detail}"، وهو غير موجود في سير العمل هذا.`,
  }),
  not_a_document_field: (names) => ({
    en: `${names.transition.en} asks for a Document in field "${names.detail}", which doesn't hold Documents.`,
    ar: `${names.transition.ar} يطلب مستندًا في الحقل "${names.detail}"، وهو حقل لا يحمل مستندات.`,
  }),
  field_not_filled_at_step: (names) => ({
    en: `${names.transition.en} writes or copies field "${names.detail}", which the acting Participant doesn't fill at this Step.`,
    ar: `${names.transition.ar} يكتب الحقل "${names.detail}" أو ينسخه، والمشارك المنفّذ لا يعبّئه في هذه الخطوة.`,
  }),
  now_not_a_date_field: (names) => ({
    en: `${names.transition.en} sets field "${names.detail}" to now, but it isn't a date or time.`,
    ar: `${names.transition.ar} يضع الوقت الحالي في الحقل "${names.detail}"، وهو ليس تاريخًا ولا وقتًا.`,
  }),
  copy_internal_answer: (names) => ({
    en: `${names.transition.en} copies its Action Form answer "${names.detail}" into the Form: on a move inside one Participant that answer stays internal, and the Form is read by every Participant once the item leaves it.`,
    ar: `${names.transition.ar} ينسخ إجابة النموذج المنبثق "${names.detail}" إلى النموذج: في انتقال داخل المشارك نفسه تبقى هذه الإجابة داخلية، والنموذج يقرؤه كل مشارك بعد خروج العنصر منه.`,
  }),
  names_person: (names) => ({
    en: `${names.transition.en} sets Member field "${names.detail}" to one person: a Workflow uses Positions only.`,
    ar: `${names.transition.ar} يضع في حقل العضو "${names.detail}" شخصًا بعينه: سير العمل يستخدم المناصب فقط.`,
  }),
  been_through_other_participant: (names) => ({
    en: `${names.transition.en} asks whether the item has been through "${names.detail}", a Step of another Participant: only the acting Participant's own Steps can be asked about.`,
    ar: `${names.transition.ar} يسأل هل مرّ العنصر بالخطوة "${names.detail}"، وهي خطوة لمشارك آخر: لا يُسأل إلا عن خطوات المشارك نفسه.`,
  }),
  condition_overlap: (names) => ({
    en: `The Transitions labelled ${names.transition.en} from one Step (${names.detail}) have conditions that can match together: exactly one should.`,
    ar: `الانتقالات المسمّاة ${names.transition.ar} من الخطوة نفسها (${names.detail}) قد تنطبق شروطها معًا: يجب أن ينطبق واحد فقط.`,
  }),
  condition_gap: (names) => ({
    en: `The Transitions labelled ${names.transition.en} from one Step (${names.detail}) have conditions some answers match none of: taking it would then be refused.`,
    ar: `الانتقالات المسمّاة ${names.transition.ar} من الخطوة نفسها (${names.detail}) لها شروط لا تنطبق على بعض الإجابات: سيُرفض الانتقال حينها.`,
  }),
};

function message(p: FoundProblem, { steps, transitions }: WorkflowDefinition): BilingualText {
  const quoted = (name: BilingualText | undefined, fallback: string): BilingualText =>
    name === undefined ? { en: `"${fallback}"`, ar: `"${fallback}"` } : { en: `"${name.en}"`, ar: `"${name.ar}"` };
  const step = quoted(steps.find((s) => s.key === p.step)?.name, p.step ?? "");
  const transition = quoted(transitions.find((t) => t.key === p.transition)?.label, p.transition ?? "");
  return messages[p.code]({ step, transition, detail: p.detail ?? "", reason: p.reason ?? "" });
}
