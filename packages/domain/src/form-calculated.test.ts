import { describe, expect, it } from "vitest";
import { formatFormValue } from "./form-display.ts";
import { formField, formSchema, formVisibility, validateAnswers, type AnswerField, type FormSchema } from "./form.ts";
import { publishProblems } from "./form-publish.ts";

// The `calculated` field (RP-283, spec RP-278; form-engine.md §2.4): a number
// worked out from other numeric fields by one formula evaluator, the same in the
// browser (live) and on the server, which ignores any value the client sent.

const label = (en: string) => ({ en, ar: en });

const number = (key: string, extra: Record<string, unknown> = {}) => ({ key, type: "number", label: label(key), ...extra });
const calculated = (key: string, formula: string, extra: Record<string, unknown> = {}) => ({
  key,
  type: "calculated",
  label: label(key),
  formula,
  ...extra,
});

const itemsTable = {
  key: "items",
  type: "table",
  label: label("Items"),
  columns: [
    { key: "fixture", type: "text", label: label("Fixture") },
    { key: "quantity", type: "number", label: label("Quantity") },
    { key: "price", type: "currency", label: label("Price") },
  ],
};

const trade = { trade: "00000000-0000-4000-8000-000000000001" };
const classification = { key: "classification", title: label("Classification"), fields: [{ key: "trade", type: "trade", label: label("Trade") }] };

const build = (fields: unknown[]): FormSchema =>
  formSchema.parse({ sections: [{ key: "main", title: label("Main"), fields }, classification] });

/** The value the validator stores for `key`, given the other answers. */
function stored(fields: unknown[], answers: Record<string, unknown>, key = "result"): unknown {
  const result = validateAnswers(build(fields), { ...trade, ...answers }, "draft");
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.answers[key];
}

/** The result of `formula` over `answers`, with the numbers a, b and c and the items table. */
const evaluate = (formula: string, answers: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  stored([number("a"), number("b"), number("c"), itemsTable, calculated("result", formula, extra)], answers);

describe("a formula", () => {
  it("adds, subtracts, multiplies and divides", () => {
    expect(evaluate("a + b", { a: 2, b: 3 })).toBe(5);
    expect(evaluate("a - b", { a: 2, b: 3 })).toBe(-1);
    expect(evaluate("a * b", { a: 2, b: 3 })).toBe(6);
    expect(evaluate("a / b", { a: 3, b: 4 })).toBe(0.75);
  });

  it("takes the signs as written: × ÷ and the minus sign", () => {
    expect(evaluate("a × b", { a: 2, b: 3 })).toBe(6);
    expect(evaluate("a ÷ b", { a: 6, b: 3 })).toBe(2);
    expect(evaluate("a − b", { a: 6, b: 3 })).toBe(3);
  });

  it("multiplies and divides before adding and subtracting, left to right", () => {
    expect(evaluate("a + b * c", { a: 1, b: 2, c: 3 })).toBe(7);
    expect(evaluate("a - b - c", { a: 10, b: 2, c: 3 })).toBe(5);
    expect(evaluate("a / b / c", { a: 12, b: 2, c: 3 })).toBe(2);
  });

  it("works out parentheses first", () => {
    expect(evaluate("(a + b) * c", { a: 1, b: 2, c: 3 })).toBe(9);
    expect(evaluate("a * (b - (c + 1))", { a: 2, b: 10, c: 3 })).toBe(12);
  });

  it("takes numbers and a leading minus", () => {
    expect(evaluate("a / b * 100", { a: 1, b: 8 })).toBe(12.5);
    expect(evaluate("-a + 0.5", { a: 2 })).toBe(-1.5);
  });

  it("sums a table's column, skipping rows without a number in it", () => {
    const items = [{ fixture: "Downlight", quantity: 12 }, { fixture: "Panel" }, { quantity: 30.5 }];
    expect(evaluate("sum(items.quantity)", { items })).toBe(42.5);
    expect(evaluate("sum(items.quantity) * a", { items, a: 2 })).toBe(85);
  });

  it("reads another calculated field, whatever their order in the Form", () => {
    const fields = [calculated("result", "subtotal * 1.15"), number("a"), number("b"), calculated("subtotal", "a + b")];
    expect(stored(fields, { a: 60, b: 40 })).toBe(115);
    expect(stored(fields, { a: 60, b: 40 }, "subtotal")).toBe(100);
  });
});

describe("the result", () => {
  it("is rounded to the field's decimals, halves away from zero", () => {
    expect(evaluate("a / b", { a: 1, b: 3 }, { decimals: 2 })).toBe(0.33);
    expect(evaluate("a / b", { a: 2, b: 3 }, { decimals: 0 })).toBe(1);
    expect(evaluate("a * b", { a: 1.005, b: 1 }, { decimals: 2 })).toBe(1.01);
    expect(evaluate("a * b", { a: -2.5, b: 1 }, { decimals: 0 })).toBe(-3);
  });

  it("has two decimals when the field sets none", () => {
    expect(evaluate("a / b", { a: 2, b: 3 })).toBe(0.67);
    expect(evaluate("a + b", { a: 0.1, b: 0.2 })).toBe(0.3);
  });

  it("is empty after a division by zero", () => {
    expect(evaluate("a / b", { a: 1, b: 0 })).toBeUndefined();
    expect(evaluate("a / (b - c)", { a: 1, b: 2, c: 2 })).toBeUndefined();
  });

  it("is empty when an input is missing, but 0 is an input", () => {
    expect(evaluate("a + b", { a: 1 })).toBeUndefined();
    expect(evaluate("a + b", { a: 1, b: 0 })).toBe(1);
    expect(evaluate("sum(items.quantity)", {})).toBeUndefined();
    expect(evaluate("sum(items.quantity)", { items: [{ fixture: "Panel" }] })).toBeUndefined();
  });

  it("is empty when it reads an empty calculated field", () => {
    const fields = [number("a"), number("b"), calculated("rate", "a / b"), calculated("result", "rate * 100")];
    expect(stored(fields, { a: 1, b: 0 })).toBeUndefined();
  });

  it("is empty when an input is hidden, because a hidden field reads as cleared", () => {
    const fields = [
      { key: "has_discount", type: "yes_no", label: label("Discount?") },
      number("discount", { visible_if: { field: "has_discount", op: "=", value: true } }),
      number("a"),
      calculated("result", "a - discount"),
    ];
    expect(stored(fields, { a: 100, has_discount: true, discount: 10 })).toBe(90);
    expect(stored(fields, { a: 100, has_discount: false, discount: 10 })).toBeUndefined();
  });
});

describe("the server's result", () => {
  const fields = [number("a"), number("b"), calculated("result", "a * b")];

  it("replaces any value the client sent", () => {
    expect(stored(fields, { a: 2, b: 3, result: 1000 })).toBe(6);
  });

  it("clears a value the client sent when the result is empty, even one of the wrong type", () => {
    expect(stored(fields, { a: 2, result: 1000 })).toBeUndefined();
    expect(stored(fields, { a: 2, b: 3, result: "lots" })).toBe(6);
  });

  it("is cleared when the calculated field is hidden", () => {
    const hidden = [number("a"), number("b"), calculated("result", "a * b", { visible_if: { field: "a", op: ">", value: 10 } })];
    expect(stored(hidden, { a: 2, b: 3 })).toBeUndefined();
    expect(stored(hidden, { a: 20, b: 3 })).toBe(60);
  });

  it("can be read by a condition", () => {
    const withApproval = [
      ...fields,
      { key: "approver", type: "text", label: label("Approver"), visible_if: { field: "result", op: ">", value: 1000 } },
    ];
    const answers = { ...trade, a: 50, b: 30, approver: "Head of procurement" };
    expect(formVisibility(build(withApproval), answers).fields.has("approver")).toBe(true);
    expect(formVisibility(build(withApproval), { ...answers, b: 3 }).fields.has("approver")).toBe(false);
  });
});

describe("a required calculated field", () => {
  const fields = [number("a"), number("b"), calculated("result", "a / b", { required: true })];
  const check = (answers: Record<string, unknown>, mode: "draft" | "complete") => validateAnswers(build(fields), { ...trade, ...answers }, mode);

  it("that is empty blocks leaving Draft", () => {
    expect(check({ a: 1, b: 0 }, "complete")).toEqual({ ok: false, errors: [{ key: "result", code: "required" }] });
    expect(check({ a: 1 }, "complete")).toEqual({ ok: false, errors: [{ key: "result", code: "required" }] });
  });

  it("doesn't block a Save draft, nor leaving Draft once it has a result", () => {
    expect(check({ a: 1, b: 0 }, "draft").ok).toBe(true);
    expect(check({ a: 1, b: 4, result: 99 }, "complete")).toEqual({ ok: true, answers: { ...trade, a: 1, b: 4, result: 0.25 } });
  });
});

describe("a calculated field's schema", () => {
  const parse = (formula: unknown, extra: Record<string, unknown> = {}) =>
    formField.safeParse({ key: "result", type: "calculated", label: label("Result"), formula, ...extra }).success;

  it("takes a formula of numbers, keys, + − × ÷, parentheses and sum(table.column)", () => {
    expect(parse("(a + b) × c ÷ 2 − sum(items.quantity)")).toBe(true);
  });

  it("refuses a formula that doesn't parse", () => {
    for (const formula of ["", "a +", "(a + b", "a b", "a ^ 2", "sum(items)", "sum(items.quantity", "max(a, b)", "A + b", "1,5 * a", "a.b", 3]) {
      expect(parse(formula), String(formula)).toBe(false);
    }
  });

  it("takes decimals from 0 to 6 and a unit", () => {
    expect(parse("a", { decimals: 0, unit: "%" })).toBe(true);
    expect(parse("a", { decimals: 7 })).toBe(false);
  });
});

describe("publishing a calculated field", () => {
  const problems = (fields: unknown[]) =>
    publishProblems(
      formSchema.parse({
        sections: [
          { key: "main", title: label("Main"), fields },
          {
            key: "classification",
            title: label("Classification"),
            fields: [
              { key: "trade", type: "trade", label: label("Trade") },
              { key: "location", type: "location", label: label("Location") },
              { key: "scopes", type: "scopes", label: label("Scopes") },
            ],
          },
        ],
      }),
    );

  it("takes numbers, amounts, other calculated fields and a table's number and currency columns", () => {
    const fields = [
      number("a"),
      { key: "fee", type: "currency", label: label("Fee") },
      itemsTable,
      calculated("subtotal", "a * fee + sum(items.price)"),
      calculated("result", "subtotal + sum(items.quantity)"),
    ];
    expect(problems(fields)).toEqual([]);
  });

  it("refuses a formula that reads an unknown key, a field that isn't a number, or a column that isn't one", () => {
    expect(problems([number("a"), calculated("result", "a + missing")])).toEqual([{ key: "result", code: "unknown_reference" }]);
    expect(problems([{ key: "note", type: "text", label: label("Note") }, calculated("result", "note * 2")])).toEqual([
      { key: "result", code: "unknown_reference" },
    ]);
    expect(problems([itemsTable, calculated("result", "items * 2")])).toEqual([{ key: "result", code: "unknown_reference" }]);
    expect(problems([itemsTable, calculated("result", "sum(items.fixture)")])).toEqual([{ key: "result", code: "unknown_reference" }]);
    expect(problems([itemsTable, calculated("result", "sum(items.weight)")])).toEqual([{ key: "result", code: "unknown_reference" }]);
    expect(problems([number("a"), calculated("result", "sum(a.b)")])).toEqual([{ key: "result", code: "unknown_reference" }]);
  });

  it("refuses formulas that read themselves, directly or through other calculated fields", () => {
    expect(problems([calculated("result", "result + 1")])).toEqual([{ key: "result", code: "formula_cycle" }]);
    expect(problems([number("a"), calculated("x", "y + a"), calculated("y", "x * 2"), calculated("z", "x + 1")])).toEqual([
      { key: "x", code: "formula_cycle" },
      { key: "y", code: "formula_cycle" },
    ]);
  });

  it("refuses a field whose showing depends on its own answer through a formula", () => {
    const fields = [number("a", { visible_if: { field: "total", op: ">", value: 0 } }), calculated("total", "a * 2")];
    expect(problems(fields)).toEqual([
      { key: "a", code: "condition_cycle" },
      { key: "total", code: "condition_cycle" },
    ]);
  });
});

describe("a calculated answer as read", () => {
  const field = formField.parse(calculated("result", "a", { decimals: 2, unit: "m²" })) as AnswerField;

  it("shows the field's decimals and unit, in Latin digits", () => {
    expect(formatFormValue(field, 1250.5, "en")).toBe("1,250.50 m²");
    expect(formatFormValue(field, 1250.5, "ar")).toMatch(/^[^٠-٩]*1,250\.50 m²$/);
  });
});
