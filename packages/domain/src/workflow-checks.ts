import { workflowActionFormProblems } from "./action-form.ts";
import type { OutcomeKind } from "./chain-bucket.ts";
import type { BilingualText } from "./company.ts";
import { evaluateCondition, type Comparison, type Condition } from "./condition.ts";
import { formFields, formSchema, type FormSchema } from "./form.ts";
import { isOpenStageCategory, type stageCategories } from "./work-item.ts";
import type { WorkflowDefinition, WorkflowStep, WorkflowTransition } from "./workflow-definition.ts";
import { workflowKindProblems, type WorkflowKindProblem } from "./workflow-publish.ts";

// Every publish check of a Workflow Version (workflow-engine.md §1, §4; RP-425,
// spec RP-423), over the definition format (workflow-definition.ts). The builder
// runs it live, the api again on publish, Rabaed Admin on import. Check 5 is
// dropped (ADR 0017); checks 4, 7 and 8 are the built ones (workflowKindProblems,
// workflowActionFormProblems). Each problem has a stable code, the Step or
// Transition it concerns, and its message in English and Arabic.

type StageCategory = (typeof stageCategories)[number];

/** What the checks read besides the definition. */
export type WorkflowPublishContext = {
  /** Who owns the Workflow (ADR 0016): a Library (`company`) or Project Workflow names no person. */
  ownerKind: "rabaed" | "company" | "project";
  /** The Work Item Type's outcome kind: which outcome set its closing Transitions use. */
  outcomeKind: OutcomeKind;
  /** The Module's Stage set (the Project's, or the Rabaed Defaults'). */
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
  // Cancel, and naming no person (spec RP-423)
  "cancel_not_by_raiser",
  "cancel_not_to_cancelled_stage",
  "cancel_sets_outcome",
  "names_person",
  // Check 6, and the Steps rules name
  "unknown_field",
  "unknown_attribute",
  "been_through_other_participant",
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
  /** What else it names: a Stage, a field, an attribute, an outcome code or another Step. */
  detail?: string;
  message: BilingualText;
};

type Found = Omit<WorkflowProblem, "message" | "severity"> & { severity?: WorkflowProblem["severity"] };

const isTerminalCategory = (category: StageCategory) => !isOpenStageCategory(category);

/**
 * Every problem stopping `definition` from being published in `context`, errors
 * and warnings, in check order. Empty when there is nothing.
 */
export function workflowPublishProblems(definition: WorkflowDefinition, context: WorkflowPublishContext): WorkflowProblem[] {
  const found = [
    ...structureProblems(definition),
    ...graphProblems(definition, context),
    ...stageProblems(definition, context),
    ...outcomeProblems(definition, context),
    ...builtProblems(definition, context),
    ...cancelProblems(definition, context),
    ...personProblems(definition, context),
    ...ruleProblems(definition, context),
    ...routingWarnings(definition),
  ];
  return found.map((p) => ({ ...p, severity: p.severity ?? "error", message: message(p, definition) }));
}

function structureProblems({ steps, transitions }: WorkflowDefinition): Found[] {
  const stepKeys = new Set(steps.map((s) => s.key));
  return [
    ...duplicates(steps.map((s) => s.key)).map((step): Found => ({ code: "duplicate_step", step })),
    ...duplicates(transitions.map((t) => t.key)).map((transition): Found => ({ code: "duplicate_transition", transition })),
    ...transitions
      .filter((t) => !stepKeys.has(t.from) || !stepKeys.has(t.to))
      .map((t): Found => ({ code: "unknown_step", transition: t.key, detail: stepKeys.has(t.from) ? t.to : t.from })),
  ];
}

/** Check 1: one Draft Step, every Step reachable from it, every open Step held and with a way out. */
function graphProblems({ steps, transitions }: WorkflowDefinition, context: WorkflowPublishContext): Found[] {
  const category = stageCategoryOf(context);
  const drafts = steps.filter((s) => category(s.stage) === "draft");
  const draftProblems: Found[] =
    drafts.length === 0 ? [{ code: "no_draft_step" }] : drafts.slice(1).map((s): Found => ({ code: "several_draft_steps", step: s.key }));
  const reached = drafts[0] === undefined ? null : reachable(transitions, drafts[0].key);
  return [
    ...draftProblems,
    ...steps.flatMap((s): Found[] => {
      const c = category(s.stage);
      const open = c === undefined || !isTerminalCategory(c);
      return [
        ...(reached !== null && !reached.has(s.key) ? [{ code: "unreachable_step", step: s.key } as const] : []),
        ...(open && !transitions.some((t) => t.from === s.key) ? [{ code: "dead_end_step", step: s.key } as const] : []),
        ...(open && s.actor === null ? [{ code: "step_without_actor", step: s.key } as const] : []),
      ];
    }),
  ];
}

/** Check 2: every Step's Stage is the Module's; nothing leaves a terminal Step. */
function stageProblems({ steps, transitions }: WorkflowDefinition, context: WorkflowPublishContext): Found[] {
  const category = stageCategoryOf(context);
  const terminal = new Set(steps.filter((s) => isTerminal(s, category)).map((s) => s.key));
  return [
    ...steps.filter((s) => category(s.stage) === undefined).map((s): Found => ({ code: "unknown_stage", step: s.key, detail: s.stage })),
    ...transitions.filter((t) => terminal.has(t.from)).map((t): Found => ({ code: "terminal_step_has_transitions", transition: t.key })),
  ];
}

/**
 * The outcome set of each outcome kind. WF-6 (RP-429) makes it editable per Work
 * Item Type; until then, the fixed Review Codes and Inspection Results.
 */
export const outcomeSets: Record<OutcomeKind, readonly string[]> = {
  review_code: ["A", "B", "C", "D"],
  inspection_result: ["passed", "passed_with_comments", "failed"],
  none: ["closed"],
};

/**
 * Check 3: a close into a terminal Step sets an outcome of the Type's set, from
 * the Step that issues it; nothing else sets one. A Cancel is checked on its own.
 */
function outcomeProblems({ steps, transitions }: WorkflowDefinition, context: WorkflowPublishContext): Found[] {
  const category = stageCategoryOf(context);
  const stepOf = new Map(steps.map((s) => [s.key, s]));
  const issues = context.outcomeKind !== "none";
  const set = outcomeSets[context.outcomeKind];
  return [
    ...(issues && !steps.some((s) => s.outcomeMode === "issue_outcome") ? [{ code: "no_issuing_step" } as const] : []),
    ...transitions.flatMap((t): Found[] => {
      const [from, to] = [stepOf.get(t.from), stepOf.get(t.to)];
      if (from === undefined || to === undefined || t.kind === "cancel") return [];
      const at = (code: WorkflowProblemCode): Found[] => [{ code, transition: t.key, ...(t.outcome === null ? {} : { detail: t.outcome }) }];
      if (!isTerminal(to, category)) {
        if (t.kind === "close") return at("close_to_open_step");
        return t.outcome !== null && t.kind !== "send_back" ? at("outcome_on_open_step") : [];
      }
      if (t.kind !== "close") return at("ends_without_close");
      if (t.outcome === null) return at("missing_outcome");
      if (!set.includes(t.outcome)) return at("outcome_not_in_set");
      return issues && from.outcomeMode !== "issue_outcome" ? at("outcome_not_from_issuing_step") : [];
    }),
  ];
}

/** Checks 4 and 8 (workflowKindProblems) and 7 (workflowActionFormProblems), as built, on the definition. */
function builtProblems({ steps, transitions }: WorkflowDefinition, context: WorkflowPublishContext): Found[] {
  const kindProblems = workflowKindProblems(
    steps.map((s) => ({ key: s.key, role: s.actor?.role ?? null })),
    transitions.map((t) => ({ key: t.key, from: t.from, to: t.to, kind: t.kind, outcome: t.outcome })),
  );
  const formProblems = workflowActionFormProblems(
    transitions.map((t) => ({ key: t.key, actionForm: t.actionForm })),
    context.optionListIds === undefined ? {} : { optionListIds: context.optionListIds },
  );
  return [
    ...kindProblems.map((p: WorkflowKindProblem): Found => ({ code: p.code, transition: p.transition })),
    ...formProblems.map((p): Found => ({ code: "invalid_action_form", transition: p.transition, detail: `${p.key} (${p.code})` })),
  ];
}

/** A Cancel leaves only the raiser's own Steps (its Draft Step's role), into a cancelled Stage, with no outcome. */
function cancelProblems({ steps, transitions }: WorkflowDefinition, context: WorkflowPublishContext): Found[] {
  const category = stageCategoryOf(context);
  const stepOf = new Map(steps.map((s) => [s.key, s]));
  const raiser = steps.find((s) => category(s.stage) === "draft")?.actor?.role;
  return transitions
    .filter((t) => t.kind === "cancel")
    .flatMap((t): Found[] => {
      const [from, to] = [stepOf.get(t.from), stepOf.get(t.to)];
      const codes: WorkflowProblemCode[] = [];
      if (from !== undefined && (raiser === undefined || from.actor?.role !== raiser)) codes.push("cancel_not_by_raiser");
      if (to !== undefined && category(to.stage) !== "cancelled") codes.push("cancel_not_to_cancelled_stage");
      if (t.outcome !== null) codes.push("cancel_sets_outcome");
      return codes.map((code) => ({ code, transition: t.key }));
    });
}

/**
 * A Library or Project Workflow names no person (ADR 0016: it is copied and read
 * project-wide): Positions only, in actor rules, assignments and notifications.
 */
function personProblems({ steps, transitions }: WorkflowDefinition, context: WorkflowPublishContext): Found[] {
  if (context.ownerKind === "rabaed") return [];
  return [
    ...steps.filter((s) => s.actor?.member !== undefined).map((s): Found => ({ code: "names_person", step: s.key })),
    ...transitions
      .filter((t) => t.actions?.some((a) => a.type === "assign_to") || t.notifications?.some((n) => n.to === "member"))
      .map((t): Found => ({ code: "names_person", transition: t.key })),
  ];
}

/** The item attributes a rule may read (`attr`, §4). */
export const workflowRuleAttrs = ["trade", "location", "work_item_type", "revision_no"] as const;

/** The comparisons of a condition, at any depth, in the order read. */
function comparisons(rule: Condition): Comparison[] {
  if ("all" in rule) return rule.all.flatMap(comparisons);
  if ("any" in rule) return rule.any.flatMap(comparisons);
  if ("not" in rule) return comparisons(rule.not);
  return [rule];
}

/** The field keys of a stored Action Form; none when it isn't a Form schema (check 7 says so). */
function actionFormKeys(actionForm: unknown): string[] {
  const parsed = formSchema.safeParse(actionForm);
  return parsed.success ? formFields(parsed.data).map((f) => f.key) : [];
}

/**
 * Check 6, Transition by Transition: Restrict conditions and the fields an
 * action sets read the Form's latest published Version (a Restrict is read
 * before the Action Form is filled); Validate conditions and a copied field may
 * also read this Transition's Action Form answers; attributes are the item's.
 * The Steps a rule names exist, and "been through" names one of the acting
 * Participant's own (its source Step's role).
 */
function ruleProblems({ steps, transitions }: WorkflowDefinition, context: WorkflowPublishContext): Found[] {
  const formKeys = new Set(context.form === null ? [] : formFields(context.form).map((f) => f.key));
  const stepOf = new Map(steps.map((s) => [s.key, s]));
  return transitions.flatMap((t): Found[] => {
    const answered = new Set([...formKeys, ...actionFormKeys(t.actionForm)]);
    const at = (code: WorkflowProblemCode, detail: string): Found => ({ code, transition: t.key, detail });
    const reads = (rule: Condition, fields: ReadonlySet<string>): Found[] =>
      comparisons(rule).flatMap((c): Found[] => {
        if (c.field !== undefined) return fields.has(c.field) ? [] : [at("unknown_field", c.field)];
        return (workflowRuleAttrs as readonly string[]).includes(c.attr) ? [] : [at("unknown_attribute", c.attr)];
      });
    const field = (key: string, fields: ReadonlySet<string>): Found[] => (fields.has(key) ? [] : [at("unknown_field", key)]);
    return [
      ...(t.rules?.restrict ?? []).flatMap((r): Found[] => {
        if (r.type === "condition") return reads(r.condition, formKeys);
        if (r.type !== "not_same_person" && r.type !== "been_through") return [];
        const named = stepOf.get(r.step);
        if (named === undefined) return [at("unknown_step", r.step)];
        const ownRole = stepOf.get(t.from)?.actor?.role;
        return r.type === "been_through" && named.actor?.role !== ownRole ? [at("been_through_other_participant", r.step)] : [];
      }),
      ...(t.rules?.validate ?? []).flatMap((v) => (v.type === "condition" ? reads(v.condition, answered) : [])),
      ...(t.actions ?? []).flatMap((a): Found[] => {
        if (a.type === "set_field") return field(a.field, formKeys);
        if (a.type === "copy_field") return [...field(a.from, answered), ...field(a.to, formKeys)];
        return [];
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
const combinationsTried = 4096;

/**
 * §4: among Transitions sharing a label and source Step, exactly one should match
 * at run time. Tries the answers that sit on each condition's edges (each value
 * compared with, one either side of a number, another value, no answer) and warns
 * when some match two or more (`condition_overlap`) or none (`condition_gap`),
 * once per group, on its first Transition.
 */
function routingWarnings({ transitions }: WorkflowDefinition): Found[] {
  const groups = new Map<string, WorkflowTransition[]>();
  for (const t of transitions) {
    const group = JSON.stringify([t.from, t.label.en, t.label.ar]);
    groups.set(group, [...(groups.get(group) ?? []), t]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .flatMap((group): Found[] => {
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

/** The edge answers of `read`'s comparisons, combined, up to `combinationsTried` of them. */
function* answerCombinations(read: readonly Comparison[]): Generator<Sources> {
  const candidates = new Map<string, unknown[]>();
  for (const c of read) {
    const name = c.field !== undefined ? `field:${c.field}` : `attr:${c.attr}`;
    const values = candidates.get(name) ?? [undefined];
    const compared = c.value === undefined ? [] : Array.isArray(c.value) ? c.value : [c.value];
    const ordered = c.op === ">" || c.op === ">=" || c.op === "<" || c.op === "<=";
    for (const v of compared) {
      // A text value compared for equality has another text beside it; a number, its neighbours.
      if (typeof v === "number") values.push(v - 1, v, v + 1);
      else if (typeof v === "boolean") values.push(true, false);
      else values.push(v, ...(ordered ? [] : ["\u0000another"]));
    }
    candidates.set(name, [...new Set(values)]);
  }
  const names = [...candidates.keys()];
  const total = names.reduce((n, name) => n * candidates.get(name)!.length, 1);
  for (let i = 0; i < Math.min(total, combinationsTried); i++) {
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

const stageCategoryOf = (context: WorkflowPublishContext) => {
  const categories = new Map(context.stages.map((s) => [s.key, s.category]));
  return (stage: string) => categories.get(stage);
};

const isTerminal = (s: WorkflowStep, category: (stage: string) => StageCategory | undefined) => {
  const c = category(s.stage);
  return c !== undefined && isTerminalCategory(c);
};

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

/** The quoted names a message uses; `concerned` is the Step's, else the Transition's. */
type Names = { step: BilingualText; transition: BilingualText; concerned: BilingualText; detail: string };

const messages: Record<WorkflowProblemCode, (n: Names) => BilingualText> = {
  duplicate_step: (n) => ({ en: `Two Steps share the key of ${n.step.en}.`, ar: `خطوتان تشتركان في مفتاح ${n.step.ar}.` }),
  duplicate_transition: (n) => ({
    en: `Two Transitions share the key of ${n.transition.en}.`,
    ar: `انتقالان يشتركان في مفتاح ${n.transition.ar}.`,
  }),
  unknown_step: (n) => ({
    en: `${n.transition.en} points to a Step that isn't in this Workflow (${n.detail}).`,
    ar: `${n.transition.ar} يشير إلى خطوة غير موجودة في سير العمل هذا (${n.detail}).`,
  }),
  no_draft_step: () => ({
    en: "The Workflow needs one Draft Step, where items are created.",
    ar: "يحتاج سير العمل إلى خطوة مسودة واحدة تُنشأ فيها العناصر.",
  }),
  several_draft_steps: (n) => ({
    en: `${n.step.en} is a second Draft Step: a Workflow has exactly one.`,
    ar: `${n.step.ar} خطوة مسودة ثانية: لسير العمل خطوة مسودة واحدة فقط.`,
  }),
  unreachable_step: (n) => ({
    en: `${n.step.en} can't be reached from the Draft Step.`,
    ar: `لا يمكن الوصول إلى ${n.step.ar} من خطوة المسودة.`,
  }),
  dead_end_step: (n) => ({
    en: `${n.step.en} has no Transition out, but its Stage is open.`,
    ar: `لا يخرج من ${n.step.ar} أي انتقال، مع أن مرحلتها مفتوحة.`,
  }),
  step_without_actor: (n) => ({
    en: `${n.step.en} needs a Project Role and a Function Permission for whoever holds it.`,
    ar: `تحتاج ${n.step.ar} إلى دور في المشروع وصلاحية لمن يتولاها.`,
  }),
  unknown_stage: (n) => ({
    en: `${n.step.en} is in Stage "${n.detail}", which this Module doesn't have.`,
    ar: `${n.step.ar} في المرحلة "${n.detail}"، وهي ليست من مراحل هذه الوحدة.`,
  }),
  terminal_step_has_transitions: (n) => ({
    en: `${n.transition.en} leaves a closed Step: an item that reaches it is closed.`,
    ar: `${n.transition.ar} يخرج من خطوة مغلقة: العنصر الذي يصلها يُغلق.`,
  }),
  no_issuing_step: () => ({
    en: "No Step issues the outcome: this Work Item Type needs one that does.",
    ar: "لا توجد خطوة تُصدر النتيجة: نوع العنصر هذا يحتاج إلى خطوة تُصدرها.",
  }),
  missing_outcome: (n) => ({
    en: `${n.transition.en} closes the item, so it needs an outcome.`,
    ar: `${n.transition.ar} يُغلق العنصر، لذا يحتاج إلى نتيجة.`,
  }),
  outcome_not_in_set: (n) => ({
    en: `${n.transition.en} sets outcome ${n.detail}, which this Work Item Type doesn't have.`,
    ar: `${n.transition.ar} يضع النتيجة ${n.detail}، وهي ليست من نتائج نوع العنصر هذا.`,
  }),
  outcome_not_from_issuing_step: (n) => ({
    en: `${n.transition.en} sets outcome ${n.detail} from a Step that doesn't issue the outcome.`,
    ar: `${n.transition.ar} يضع النتيجة ${n.detail} من خطوة لا تُصدر النتيجة.`,
  }),
  outcome_on_open_step: (n) => ({
    en: `${n.transition.en} sets outcome ${n.detail} but doesn't close the item.`,
    ar: `${n.transition.ar} يضع النتيجة ${n.detail} لكنه لا يُغلق العنصر.`,
  }),
  close_to_open_step: (n) => ({
    en: `${n.transition.en} is a close, but goes to a Step in an open Stage.`,
    ar: `${n.transition.ar} انتقال إغلاق، لكنه يذهب إلى خطوة في مرحلة مفتوحة.`,
  }),
  ends_without_close: (n) => ({
    en: `${n.transition.en} goes to a closed Step, so it must be a close or a Cancel.`,
    ar: `${n.transition.ar} يذهب إلى خطوة مغلقة، لذا يجب أن يكون إغلاقًا أو إلغاءً.`,
  }),
  return_crosses_participants: (n) => ({
    en: `${n.transition.en} is a Return, so it must stay inside one Participant.`,
    ar: `${n.transition.ar} إعادة، لذا يجب أن يبقى داخل المشارك نفسه.`,
  }),
  submit_stays_inside: (n) => ({
    en: `${n.transition.en} is a Submit, so it must hand the item to another Participant.`,
    ar: `${n.transition.ar} تقديم، لذا يجب أن يسلّم العنصر إلى مشارك آخر.`,
  }),
  send_back_not_to_submitter: (n) => ({
    en: `${n.transition.en} is a Send Back, so it must go back to the Participant that Submitted the item.`,
    ar: `${n.transition.ar} إرجاع إلى المقدّم، لذا يجب أن يعود إلى المشارك الذي قدّم العنصر.`,
  }),
  send_back_sets_outcome: (n) => ({
    en: `${n.transition.en} is a Send Back, which sets no outcome.`,
    ar: `${n.transition.ar} إرجاع إلى المقدّم، ولا يضع أي نتيجة.`,
  }),
  cycle_without_way_back: (n) => ({
    en: `${n.transition.en} closes a loop with no Return or Send Back in it.`,
    ar: `${n.transition.ar} يُكمل حلقة ليس فيها إعادة ولا إرجاع إلى المقدّم.`,
  }),
  loop_across_participants: (n) => ({
    en: `${n.transition.en} is in a loop across Participants without a Send Back.`,
    ar: `${n.transition.ar} ضمن حلقة بين المشاركين دون إرجاع إلى المقدّم.`,
  }),
  invalid_action_form: (n) => ({
    en: `The Action Form of ${n.transition.en} isn't a valid Form: ${n.detail}.`,
    ar: `النموذج المنبثق لـ ${n.transition.ar} ليس نموذجًا صالحًا: ${n.detail}.`,
  }),
  cancel_not_by_raiser: (n) => ({
    en: `${n.transition.en} is a Cancel, which only the raiser's own Steps offer.`,
    ar: `${n.transition.ar} إلغاء، ولا تتيحه إلا خطوات مُنشئ العنصر.`,
  }),
  cancel_not_to_cancelled_stage: (n) => ({
    en: `${n.transition.en} is a Cancel, so it must go to a Step in a cancelled Stage.`,
    ar: `${n.transition.ar} إلغاء، لذا يجب أن يذهب إلى خطوة في مرحلة ملغاة.`,
  }),
  cancel_sets_outcome: (n) => ({
    en: `${n.transition.en} is a Cancel, which sets no outcome.`,
    ar: `${n.transition.ar} إلغاء، ولا يضع أي نتيجة.`,
  }),
  names_person: (n) => ({
    en: `${n.concerned.en} points to one person: a Library or Project Workflow uses Positions only.`,
    ar: `${n.concerned.ar} يشير إلى شخص بعينه: سير عمل المكتبة أو المشروع يستخدم المناصب فقط.`,
  }),
  unknown_field: (n) => ({
    en: `${n.transition.en} reads field "${n.detail}", which the Form doesn't have where the rule is checked.`,
    ar: `${n.transition.ar} يقرأ الحقل "${n.detail}"، وهو غير موجود في النموذج حيث تُفحص القاعدة.`,
  }),
  unknown_attribute: (n) => ({
    en: `${n.transition.en} reads "${n.detail}", which isn't an item attribute rules can read.`,
    ar: `${n.transition.ar} يقرأ "${n.detail}"، وهي ليست من خصائص العنصر التي تقرؤها القواعد.`,
  }),
  been_through_other_participant: (n) => ({
    en: `${n.transition.en} asks whether the item has been through "${n.detail}", a Step of another Participant: only the acting Participant's own Steps can be asked about.`,
    ar: `${n.transition.ar} يسأل هل مرّ العنصر بالخطوة "${n.detail}"، وهي خطوة لمشارك آخر: لا يُسأل إلا عن خطوات المشارك نفسه.`,
  }),
  condition_overlap: (n) => ({
    en: `The Transitions labelled ${n.transition.en} from one Step (${n.detail}) have conditions that can match together: exactly one should.`,
    ar: `الانتقالات المسمّاة ${n.transition.ar} من الخطوة نفسها (${n.detail}) قد تنطبق شروطها معًا: يجب أن ينطبق واحد فقط.`,
  }),
  condition_gap: (n) => ({
    en: `The Transitions labelled ${n.transition.en} from one Step (${n.detail}) have conditions some answers match none of: taking it would then be refused.`,
    ar: `الانتقالات المسمّاة ${n.transition.ar} من الخطوة نفسها (${n.detail}) لها شروط لا تنطبق على بعض الإجابات: سيُرفض الانتقال حينها.`,
  }),
};

function message(p: Found, { steps, transitions }: WorkflowDefinition): BilingualText {
  const quoted = (name: BilingualText | undefined, fallback: string): BilingualText =>
    name === undefined ? { en: `"${fallback}"`, ar: `"${fallback}"` } : { en: `"${name.en}"`, ar: `"${name.ar}"` };
  const step = quoted(steps.find((s) => s.key === p.step)?.name, p.step ?? "");
  const transition = quoted(transitions.find((t) => t.key === p.transition)?.label, p.transition ?? "");
  return messages[p.code]({ step, transition, concerned: p.step === undefined ? transition : step, detail: p.detail ?? "" });
}
