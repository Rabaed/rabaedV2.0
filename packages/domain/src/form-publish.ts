import { conditionFields, evaluateCondition, type Condition } from "./condition.ts";
import {
  builtInFieldTypes,
  calculatedReferences,
  formFields,
  isAnswerField,
  isBuiltInField,
  isCalculatedField,
  type FormField,
  type FormSchema,
  type FormSection,
} from "./form.ts";

// The publish-time checks (form-engine.md §7; RP-271). Publishing freezes a Form
// Version for good, so a schema that would break Work Items is refused first:
// duplicate keys, conditions and formulas that read missing fields or each
// other in a circle, required fields that can never show, Built-in Fields missing or
// switched off, and a key reused for another type in a later Version. Pure, like
// the validator, so the builder (part 5) can run the same checks live.

export const schemaProblemCodes = [
  "duplicate_key",
  "unknown_reference",
  "condition_cycle",
  "formula_cycle",
  "required_never_shown",
  "built_in_missing",
  "built_in_repeated",
  "built_in_optional",
  "built_in_hidden",
  "key_type_changed",
  "unknown_option_list",
] as const;
export type SchemaProblemCode = (typeof schemaProblemCodes)[number];

/** One problem with a schema, about its section or field `key`. The codes are explained in form-engine.md §7. */
export type SchemaProblem = { key: string; code: SchemaProblemCode };

/** What the database knows, which the schema is checked against. */
export type PublishContext = {
  /** The ids of the Option Lists that exist. Without them the lists a schema names aren't checked. */
  optionListIds?: ReadonlySet<string>;
};

/**
 * What stops a schema from being published as a Form's first Version. Empty
 * when there is nothing. Problems come check by check, each in Form order.
 */
export function formSchemaProblems(schema: FormSchema, context: PublishContext = {}): SchemaProblem[] {
  const builtIns = builtInProblems(schema);
  const repeatedBuiltIns = new Set(builtIns.filter((p) => p.code === "built_in_repeated").map((p) => p.key));
  const inFormulaCycles = formulaCycles(schema);
  return [
    ...duplicateKeys(schema).filter((key) => !repeatedBuiltIns.has(key)).map((key) => problem(key, "duplicate_key")),
    ...unknownReferences(schema).map((key) => problem(key, "unknown_reference")),
    ...inFormulaCycles.map((key) => problem(key, "formula_cycle")),
    ...conditionCycles(schema)
      .filter((key) => !inFormulaCycles.includes(key))
      .map((key) => problem(key, "condition_cycle")),
    ...requiredNeverShown(schema).map((key) => problem(key, "required_never_shown")),
    ...builtIns,
    ...(context.optionListIds ? unknownOptionLists(schema, context.optionListIds).map((key) => problem(key, "unknown_option_list")) : []),
  ];
}

/**
 * What stops `schema` from being published as the next Version of a Form whose
 * Versions so far are `earlier`: the checks of formSchemaProblems, and keys are
 * forever: a field key an earlier Version used, even one dropped since, comes
 * back with the same type or not at all, because answers are stored by key.
 */
export function publishProblems(schema: FormSchema, earlier: readonly FormSchema[] = [], context: PublishContext = {}): SchemaProblem[] {
  const typeOf = new Map(earlier.flatMap((version) => formFields(version).map((f) => [f.key, f.type] as const)));
  const changed = formFields(schema).filter((f) => typeOf.has(f.key) && typeOf.get(f.key) !== f.type);
  return [...formSchemaProblems(schema, context), ...changed.map((f) => problem(f.key, "key_type_changed"))];
}

const problem = (key: string, code: SchemaProblemCode): SchemaProblem => ({ key, code });

/** A section, then its fields, in Form order: everything that has a key. */
const sectionsAndFields = (schema: FormSchema): (FormSection | FormField)[] => schema.sections.flatMap((s) => [s, ...s.fields]);

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
  for (const { key } of sectionsAndFields(schema)) (seen.has(key) ? repeated : seen).add(key);
  return [...repeated];
}

/**
 * Sections and fields with a rule that reads a key that holds no answer (a
 * layout or `attachments` field, or none), and calculated fields whose formula
 * reads one that holds no number: a key that isn't a `number`, `currency` or
 * `calculated` field, or a `sum` over a column that isn't a table's `number` or
 * `currency` column.
 */
function unknownReferences(schema: FormSchema): string[] {
  const fields = formFields(schema);
  const answerKeys = new Set(fields.filter((f) => isAnswerField(f) && f.type !== "attachments").map((f) => f.key));
  const numberKeys = new Set(fields.filter((f) => f.type === "number" || f.type === "currency" || f.type === "calculated").map((f) => f.key));
  const holdsNumbers = ({ key, column }: { key: string; column?: string }) => {
    if (column === undefined) return numberKeys.has(key);
    const table = fields.find((f) => f.key === key);
    return table?.type === "table" && table.columns.some((c) => c.key === column && (c.type === "number" || c.type === "currency"));
  };
  return sectionsAndFields(schema)
    .filter(
      (item) =>
        rulesOf(item).some((rule) => conditionFields(rule).some((key) => !answerKeys.has(key))) ||
        ("type" in item && isCalculatedField(item) && !calculatedReferences(item).every(holdsNumbers)),
    )
    .map((item) => item.key);
}

/** Whether `start` is reached again by following `dependsOn` from it. */
function reachesItself(dependsOn: ReadonlyMap<string, readonly string[]>, start: string): boolean {
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
}

/** Calculated fields whose result depends, in the end, on itself, through formulas alone. */
function formulaCycles(schema: FormSchema): string[] {
  const calculated = formFields(schema).filter(isCalculatedField);
  const dependsOn = new Map(calculated.map((f) => [f.key, calculatedReferences(f).map((r) => r.key)]));
  return calculated.filter((f, i) => calculated.findIndex((o) => o.key === f.key) === i && reachesItself(dependsOn, f.key)).map((f) => f.key);
}

/**
 * Sections and fields whose showing depends on their own answer, through
 * `visible_if`: a field shows by its section's rule and its own, a rule by the
 * fields it reads, and a calculated field's answer by those its formula reads.
 * A conditional `required` reads answers but hides nothing, so it makes no cycle.
 */
function conditionCycles(schema: FormSchema): string[] {
  const node = (kind: "section" | "field", key: string) => `${kind}:${key}`;
  const dependsOn = new Map<string, string[]>();
  for (const s of schema.sections) {
    dependsOn.set(node("section", s.key), (s.visible_if ? conditionFields(s.visible_if) : []).map((k) => node("field", k)));
    for (const f of s.fields) {
      if (isBuiltInField(f)) continue;
      const own = visibleIf(f);
      const reads = [...(own ? conditionFields(own) : []), ...(isCalculatedField(f) ? calculatedReferences(f).map((r) => r.key) : [])];
      dependsOn.set(node("field", f.key), [node("section", s.key), ...reads.map((k) => node("field", k))]);
    }
  }
  const inFormOrder = schema.sections.flatMap((s) => [
    { id: node("section", s.key), key: s.key },
    ...s.fields.map((f) => ({ id: node("field", f.key), key: f.key })),
  ]);
  return inFormOrder.filter(({ id }, i) => inFormOrder.findIndex((n) => n.id === id) === i && reachesItself(dependsOn, id)).map((n) => n.key);
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

  // Form conditions read fields only (form.ts refuses `attr`), so answers are all a rule needs.
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

/** Fields (a table for its columns) that name an Option List that doesn't exist. */
function unknownOptionLists(schema: FormSchema, known: ReadonlySet<string>): string[] {
  return formFields(schema)
    .filter((f) => {
      if (f.type === "option_list") return !known.has(f.list);
      return f.type === "table" && f.columns.some((c) => c.type === "option_list" && !known.has(c.list));
    })
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
