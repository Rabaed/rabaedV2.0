import { conditionFields, evaluateCondition, type Condition } from "./condition.ts";
import { builtInFieldTypes, formFields, isAnswerField, isBuiltInField, type FormField, type FormSchema, type FormSection } from "./form.ts";

// The publish-time checks (form-engine.md §7; RP-271). Publishing freezes a Form
// Version for good, so a schema that would break Work Items is refused first:
// duplicate keys, conditions that read missing fields or each other in a
// circle, required fields that can never show, Built-in Fields missing or
// switched off, and a key reused for another type in a later Version. Pure, like
// the validator, so the builder (part 5) can run the same checks live.

export const schemaProblemCodes = [
  "duplicate_key",
  "unknown_reference",
  "condition_cycle",
  "required_never_shown",
  "built_in_missing",
  "built_in_repeated",
  "built_in_optional",
  "built_in_hidden",
  "key_type_changed",
] as const;
export type SchemaProblemCode = (typeof schemaProblemCodes)[number];

/**
 * One problem with a schema, about its section or field `key`.
 * `duplicate_key`: a key used by two sections or fields (layout fields included).
 * `unknown_reference`: a condition reads a key that is no answer field.
 * `condition_cycle`: whether it shows depends, in the end, on its own answer.
 * `required_never_shown`: required, but no answers can ever show it.
 * `key_type_changed`: an earlier Version used the key for another type.
 */
export type SchemaProblem = { key: string; code: SchemaProblemCode };

/**
 * What stops a schema from being published as a Form's first Version. Empty
 * when there is nothing. Problems come check by check, each in Form order.
 */
export function formSchemaProblems(schema: FormSchema): SchemaProblem[] {
  const builtIns = builtInProblems(schema);
  const repeatedBuiltIns = new Set(builtIns.filter((p) => p.code === "built_in_repeated").map((p) => p.key));
  return [
    ...duplicateKeys(schema).filter((key) => !repeatedBuiltIns.has(key)).map((key) => problem(key, "duplicate_key")),
    ...unknownReferences(schema).map((key) => problem(key, "unknown_reference")),
    ...conditionCycles(schema).map((key) => problem(key, "condition_cycle")),
    ...requiredNeverShown(schema).map((key) => problem(key, "required_never_shown")),
    ...builtIns,
  ];
}

/**
 * What stops `schema` from being published as the next Version of a Form whose
 * Versions so far are `earlier`: the checks of formSchemaProblems, and keys are
 * forever: a field key an earlier Version used, even one dropped since, comes
 * back with the same type or not at all, because answers are stored by key.
 */
export function publishProblems(schema: FormSchema, earlier: readonly FormSchema[] = []): SchemaProblem[] {
  const typeOf = new Map(earlier.flatMap((version) => formFields(version).map((f) => [f.key, f.type] as const)));
  const changed = formFields(schema).filter((f) => typeOf.has(f.key) && typeOf.get(f.key) !== f.type);
  return [...formSchemaProblems(schema), ...changed.map((f) => problem(f.key, "key_type_changed"))];
}

const problem = (key: string, code: SchemaProblemCode): SchemaProblem => ({ key, code });

/** A section, then its fields, in Form order: everything that has a key. */
const keyed = (schema: FormSchema): (FormSection | FormField)[] => schema.sections.flatMap((s) => [s, ...s.fields]);

/** The conditions a section or field shows by. Built-in Fields have none: they always show. */
const visibleIf = (item: FormSection | FormField): Condition | undefined => ("visible_if" in item ? item.visible_if : undefined);

/** The rules a section or field reads: `visible_if`, and a conditional `required`. */
function rulesOf(item: FormSection | FormField): Condition[] {
  const required = "required" in item && typeof item.required === "object" ? [item.required] : [];
  return [visibleIf(item), ...required].filter((rule): rule is Condition => rule !== undefined);
}

/** Keys used more than once, across sections and fields, once each. */
function duplicateKeys(schema: FormSchema): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { key } of keyed(schema)) (seen.has(key) ? repeated : seen).add(key);
  return [...repeated];
}

/** Sections and fields with a rule that reads a key that is no answer field. */
function unknownReferences(schema: FormSchema): string[] {
  const answerKeys = new Set(formFields(schema).filter(isAnswerField).map((f) => f.key));
  return keyed(schema)
    .filter((item) => rulesOf(item).some((rule) => conditionFields(rule).some((key) => !answerKeys.has(key))))
    .map((item) => item.key);
}

/**
 * Sections and fields whose showing depends on their own answer, through
 * `visible_if`: a field shows by its section's rule and its own, and a rule by
 * the fields it reads. A conditional `required` reads answers but hides
 * nothing, so it makes no cycle.
 */
function conditionCycles(schema: FormSchema): string[] {
  const node = (kind: "section" | "field", key: string) => `${kind}:${key}`;
  const dependsOn = new Map<string, string[]>();
  for (const s of schema.sections) {
    dependsOn.set(node("section", s.key), (s.visible_if ? conditionFields(s.visible_if) : []).map((k) => node("field", k)));
    for (const f of s.fields) {
      if (isBuiltInField(f)) continue;
      const own = visibleIf(f);
      dependsOn.set(node("field", f.key), [node("section", s.key), ...(own ? conditionFields(own) : []).map((k) => node("field", k))]);
    }
  }
  const reachesItself = (start: string) => {
    const stack = [...(dependsOn.get(start) ?? [])];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next === start) return true;
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(...(dependsOn.get(next) ?? []));
    }
    return false;
  };
  return schema.sections
    .flatMap((s) => [node("section", s.key), ...s.fields.map((f) => node("field", f.key))])
    .filter((n, i, all) => all.indexOf(n) === i && reachesItself(n))
    .map((n) => n.slice(n.indexOf(":") + 1));
}

/** Rules over more combinations of answers than this are taken to be able to hold. */
const maxCombinations = 4096;
/** A multi-select with more options than this is taken to be able to hold any rule. */
const maxMultiSelectOptions = 8;

/**
 * Every answer a field can hold, unanswered included, when there are few
 * enough to try them all: Yes/No and choices. Null for the rest (text, numbers,
 * dates, Built-in Fields' ids), whose rules are taken to be able to hold.
 */
function possibleAnswers(field: FormField): unknown[] | null {
  switch (field.type) {
    case "yes_no":
      return [undefined, true, false];
    case "select":
      return [undefined, ...field.options.map((o) => o.value)];
    case "multi_select": {
      const values = field.options.map((o) => o.value);
      if (values.length > maxMultiSelectOptions) return null;
      return Array.from({ length: 2 ** values.length }, (_, bits) => values.filter((_, i) => bits & (1 << i)));
    }
    default:
      return null;
  }
}

/**
 * Required fields that no answers can ever show: in a section, or behind a
 * rule, that can never hold. A rule never holds when no combination of the
 * answers it reads makes it hold; a field that never shows reads as cleared,
 * so whatever depends on it is worked out again until nothing changes. Only
 * what is certain is refused: a rule over free text is taken to be able to hold.
 */
function requiredNeverShown(schema: FormSchema): string[] {
  const byKey = new Map(formFields(schema).map((f) => [f.key, f]));
  const hiddenSections = new Set<string>();
  const hiddenFields = new Set<string>();

  const canHold = (rule: Condition): boolean => {
    const keys = conditionFields(rule);
    const choices: unknown[][] = [];
    for (const key of keys) {
      const field = byKey.get(key);
      const answers = field === undefined || !isAnswerField(field) || hiddenFields.has(key) ? [undefined] : possibleAnswers(field);
      if (answers === null) return true;
      choices.push(answers);
    }
    if (choices.reduce((n, c) => n * c.length, 1) > maxCombinations) return true;
    const tryFrom = (i: number, fields: Record<string, unknown>): boolean =>
      i === keys.length
        ? evaluateCondition(rule, { fields })
        : choices[i]!.some((answer) => tryFrom(i + 1, { ...fields, [keys[i]!]: answer }));
    return tryFrom(0, {});
  };

  for (let changed = true; changed; ) {
    changed = false;
    for (const s of schema.sections) {
      if (!hiddenSections.has(s.key) && s.visible_if && !canHold(s.visible_if)) {
        hiddenSections.add(s.key);
        changed = true;
      }
      for (const f of s.fields) {
        if (isBuiltInField(f) || hiddenFields.has(f.key)) continue;
        const own = visibleIf(f);
        if (hiddenSections.has(s.key) || (own && !canHold(own))) {
          hiddenFields.add(f.key);
          changed = true;
        }
      }
    }
  }

  return formFields(schema)
    .filter((f) => hiddenFields.has(f.key) && isAnswerField(f) && "required" in f && f.required !== false)
    .map((f) => f.key);
}

/** Each Built-in Field placed exactly once, never in a section that can be hidden, with Trade and Location required. */
function builtInProblems(schema: FormSchema): SchemaProblem[] {
  return builtInFieldTypes.flatMap((type): SchemaProblem[] => {
    const placed = schema.sections.flatMap((s) => s.fields.filter((f) => f.type === type).map((f) => ({ field: f, section: s })));
    if (placed.length === 0) return [problem(type, "built_in_missing")];
    if (placed.length > 1) return [problem(type, "built_in_repeated")];
    const { field, section } = placed[0]!;
    if (section.visible_if) return [problem(type, "built_in_hidden")];
    if (type !== "scopes" && isBuiltInField(field) && !field.required) return [problem(type, "built_in_optional")];
    return [];
  });
}
