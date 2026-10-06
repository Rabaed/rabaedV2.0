import { z } from "zod";

// The one rule language and evaluator (workflow-engine.md §4; form-engine.md §1).
// Forms use it for `visible_if` and conditional `required`; Workflow Transitions
// will use it for routing. A rule is JSON, never code. Pure, so the browser and
// the server reach the same answer.

export const conditionOps = ["=", "!=", ">", ">=", "<", "<=", "in", "not_in", "empty", "not_empty"] as const;
export type ConditionOp = (typeof conditionOps)[number];

type Scalar = string | number | boolean;

/** One comparison: a Form field or an item attribute (Trade, Location, Type), an operator, and a value. */
export type Comparison = ({ field: string; attr?: never } | { attr: string; field?: never }) &
  ({ op: "empty" | "not_empty"; value?: never } | { op: "in" | "not_in"; value: Scalar[] } | { op: "=" | "!="; value: Scalar | string[] } | { op: ">" | ">=" | "<" | "<="; value: string | number });

export type Condition = Comparison | { all: Condition[] } | { any: Condition[] } | { not: Condition };

const scalar = z.union([z.string(), z.number(), z.boolean()]);
/** A Form field key or an attribute name (snake_case, as Form keys are). */
const ruleKey = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);

const comparison = z
  .strictObject({
    field: ruleKey.optional(),
    attr: ruleKey.optional(),
    op: z.enum(conditionOps),
    value: z.union([scalar, z.array(scalar)]).optional(),
  })
  .superRefine((c, ctx) => {
    if ((c.field === undefined) === (c.attr === undefined)) ctx.addIssue({ code: "custom", message: "Give exactly one of field and attr" });
    const valueFits =
      c.op === "empty" || c.op === "not_empty"
        ? c.value === undefined
        : c.op === "in" || c.op === "not_in"
          ? Array.isArray(c.value)
          : c.op === "=" || c.op === "!="
            ? c.value !== undefined && (!Array.isArray(c.value) || c.value.every((v) => typeof v === "string"))
            : typeof c.value === "string" || typeof c.value === "number";
    if (!valueFits) ctx.addIssue({ code: "custom", message: `The value doesn't fit the operator ${c.op}` });
  }) as unknown as z.ZodType<Comparison>;

export const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    comparison,
    z.strictObject({ all: z.array(condition) }),
    z.strictObject({ any: z.array(condition) }),
    z.strictObject({ not: condition }),
  ]),
);

/** No answer: nothing, empty text, or no option chosen. `false` is an answer (No). */
export const isUnanswered = (value: unknown): boolean =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

/** What a rule reads: the Form's answers by field key, and the item's attributes. */
export type ConditionSources = {
  fields: Readonly<Record<string, unknown>>;
  attrs?: Readonly<Record<string, unknown>>;
};

const sameOptions = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v) => b.includes(v));

function equals(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected) && sameOptions(actual, expected);
  }
  return actual === expected;
}

const isoKinds = [
  { pattern: /^\d{4}-\d{2}-\d{2}$/, sortKey: (v: string) => v },
  { pattern: /^\d{2}:\d{2}(:\d{2})?$/, sortKey: (v: string) => (v.length === 5 ? `${v}:00` : v) },
  { pattern: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, sortKey: (v: string) => Date.parse(v) },
];

/**
 * Orders like with like: two numbers, or two ISO values of one kind (dates,
 * times of day, or UTC instants). Anything else, empty included, has no order: null.
 */
function order(actual: unknown, expected: unknown): number | null {
  if (typeof actual === "number" && typeof expected === "number") return actual - expected;
  if (typeof actual !== "string" || typeof expected !== "string") return null;
  const kind = isoKinds.find((k) => k.pattern.test(actual) && k.pattern.test(expected));
  if (!kind) return null;
  const [a, b] = [kind.sortKey(actual), kind.sortKey(expected)];
  return a < b ? -1 : a > b ? 1 : 0;
}

function compare(c: Comparison, sources: ConditionSources): boolean {
  const actual = c.field !== undefined ? sources.fields[c.field] : sources.attrs?.[c.attr];
  switch (c.op) {
    case "empty":
      return isUnanswered(actual);
    case "not_empty":
      return !isUnanswered(actual);
    case "=":
      return equals(actual, c.value);
    case "!=":
      return !equals(actual, c.value);
    case "in":
    case "not_in": {
      const list: readonly unknown[] = c.value;
      // A multi-select is in the list when any of its options is.
      const found = Array.isArray(actual) ? actual.some((v) => list.includes(v)) : list.includes(actual);
      return c.op === "in" ? found : !found;
    }
    default: {
      const diff = order(actual, c.value);
      if (diff === null) return false;
      return c.op === ">" ? diff > 0 : c.op === ">=" ? diff >= 0 : c.op === "<" ? diff < 0 : diff <= 0;
    }
  }
}

/** Whether a rule reads any item attribute (`attr`), at any depth. */
export function readsAttrs(rule: Condition): boolean {
  if ("all" in rule) return rule.all.some(readsAttrs);
  if ("any" in rule) return rule.any.some(readsAttrs);
  if ("not" in rule) return readsAttrs(rule.not);
  return rule.attr !== undefined;
}

/** The Form field keys a rule reads, at any depth, each once, in the order first read. */
export function conditionFields(rule: Condition): string[] {
  const read = (r: Condition): string[] => {
    if ("all" in r) return r.all.flatMap(read);
    if ("any" in r) return r.any.flatMap(read);
    if ("not" in r) return read(r.not);
    return r.field !== undefined ? [r.field] : [];
  };
  return [...new Set(read(rule))];
}

/** Whether `rule` holds for the given answers and attributes. A missing attribute reads as empty. */
export function evaluateCondition(rule: Condition, sources: ConditionSources): boolean {
  if ("all" in rule) return rule.all.every((r) => evaluateCondition(r, sources));
  if ("any" in rule) return rule.any.some((r) => evaluateCondition(r, sources));
  if ("not" in rule) return !evaluateCondition(rule.not, sources);
  return compare(rule, sources);
}
