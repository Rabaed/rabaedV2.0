import { describe, expect, it } from "vitest";
import conditionCases from "./condition-cases.json" with { type: "json" };
import { condition, evaluateCondition } from "./condition.ts";

const fields = {
  cost_impact: 750000,
  finish: "powder_coated",
  certificates: ["saso", "iso_9001"],
  sample_provided: false,
  delivery_date: "2026-10-03",
  notes: "",
};
const attrs = { trade: "EL" };
const holds = (rule: unknown) => evaluateCondition(condition.parse(rule), { fields, attrs });

describe("evaluateCondition: comparing a value", () => {
  it("= and != compare exactly, false and true included", () => {
    expect(holds({ field: "finish", op: "=", value: "powder_coated" })).toBe(true);
    expect(holds({ field: "finish", op: "=", value: "galvanised" })).toBe(false);
    expect(holds({ field: "sample_provided", op: "=", value: false })).toBe(true);
    expect(holds({ field: "sample_provided", op: "!=", value: true })).toBe(true);
    expect(holds({ field: "finish", op: "!=", value: "powder_coated" })).toBe(false);
  });

  it("= on a multi-select means the same options, in any order", () => {
    expect(holds({ field: "certificates", op: "=", value: ["iso_9001", "saso"] })).toBe(true);
    expect(holds({ field: "certificates", op: "=", value: ["saso"] })).toBe(false);
  });

  it("> >= < <= compare numbers, and ISO dates as dates", () => {
    expect(holds({ field: "cost_impact", op: ">", value: 500000 })).toBe(true);
    expect(holds({ field: "cost_impact", op: ">=", value: 750000 })).toBe(true);
    expect(holds({ field: "cost_impact", op: "<", value: 750000 })).toBe(false);
    expect(holds({ field: "cost_impact", op: "<=", value: 750000 })).toBe(true);
    expect(holds({ field: "delivery_date", op: ">", value: "2026-09-30" })).toBe(true);
    expect(holds({ field: "delivery_date", op: "<", value: "2026-09-30" })).toBe(false);
  });

  it("orders only like with like: two numbers, two dates, two times or two instants", () => {
    const at = (a: unknown, op: string, b: unknown) => evaluateCondition(condition.parse({ field: "x", op, value: b }), { fields: { x: a } });
    expect(at("07:30", "<", "16:00")).toBe(true);
    expect(at("2026-10-03T06:30:00Z", ">", "2026-10-03T06:29:59.999Z")).toBe(true);
    expect(at("2026-10-03T06:30:00Z", "<", "2026-10-03T09:30:00.000Z")).toBe(true);
    // An instant against a date, or plain text: different kinds, so no order.
    expect(at("2026-10-03T06:30:00Z", ">", "2026-10-03")).toBe(false);
    expect(at("10", ">", "9")).toBe(false);
    expect(at("b", ">", "a")).toBe(false);
  });

  it("an ordering never holds across kinds, or on an empty field", () => {
    expect(holds({ field: "finish", op: ">", value: 3 })).toBe(false);
    expect(holds({ field: "cost_impact", op: "<", value: "2026-01-01" })).toBe(false);
    expect(holds({ field: "missing", op: "<", value: 10 })).toBe(false);
    expect(holds({ field: "missing", op: ">=", value: 10 })).toBe(false);
  });

  it("in and not_in: one of a list; a multi-select is in if any option is", () => {
    expect(holds({ field: "finish", op: "in", value: ["galvanised", "powder_coated"] })).toBe(true);
    expect(holds({ field: "finish", op: "not_in", value: ["galvanised", "powder_coated"] })).toBe(false);
    expect(holds({ field: "certificates", op: "in", value: ["ce", "saso"] })).toBe(true);
    expect(holds({ field: "certificates", op: "not_in", value: ["ce"] })).toBe(true);
    expect(holds({ field: "missing", op: "in", value: ["a"] })).toBe(false);
    expect(holds({ field: "missing", op: "not_in", value: ["a"] })).toBe(true);
  });

  it("empty and not_empty: nothing, empty text or no option is empty; No is not", () => {
    expect(holds({ field: "notes", op: "empty" })).toBe(true);
    expect(holds({ field: "missing", op: "empty" })).toBe(true);
    expect(holds({ field: "sample_provided", op: "empty" })).toBe(false);
    expect(holds({ field: "sample_provided", op: "not_empty" })).toBe(true);
    expect(evaluateCondition({ field: "x", op: "empty" }, { fields: { x: [] } })).toBe(true);
  });

  it("reads item attributes as well as Form fields", () => {
    expect(holds({ attr: "trade", op: "in", value: ["EL", "ME"] })).toBe(true);
    // No attributes given: like an empty field.
    expect(evaluateCondition({ attr: "trade", op: "empty" }, { fields })).toBe(true);
  });
});

describe("evaluateCondition: combining rules", () => {
  const big = { field: "cost_impact", op: ">", value: 500000 };
  const electrical = { attr: "trade", op: "in", value: ["EL", "ME"] };
  const galvanised = { field: "finish", op: "=", value: "galvanised" };

  it("all, any and not", () => {
    expect(holds({ all: [big, electrical] })).toBe(true);
    expect(holds({ all: [big, galvanised] })).toBe(false);
    expect(holds({ any: [galvanised, big] })).toBe(true);
    expect(holds({ any: [galvanised] })).toBe(false);
    expect(holds({ not: galvanised })).toBe(true);
  });

  it("nest to any depth", () => {
    expect(holds({ all: [electrical, { any: [galvanised, { not: { not: big } }] }] })).toBe(true);
    expect(holds({ not: { any: [{ all: [big, galvanised] }, { field: "notes", op: "not_empty" }] } })).toBe(true);
  });

  it("an empty all holds and an empty any doesn't", () => {
    expect(holds({ all: [] })).toBe(true);
    expect(holds({ any: [] })).toBe(false);
  });
});

// The shared cases: the database's app.condition_holds runs the same file (seam 2,
// packages/db/test/transition-rules-rls.test.ts), one definition per layer.
describe("evaluateCondition: the cases shared with the database", () => {
  type Case = { name: string; rule: unknown; fields: Record<string, unknown>; actionForm?: Record<string, unknown>; attrs?: Record<string, unknown>; holds: boolean };
  it.each((conditionCases as Case[]).map((c) => [c.name, c] as const))("%s", (_, c) => {
    const sources = { fields: c.fields, ...(c.attrs ? { attrs: c.attrs } : {}), ...(c.actionForm ? { actionForm: c.actionForm } : {}) };
    expect(evaluateCondition(condition.parse(c.rule), sources)).toBe(c.holds);
  });
});

describe("condition (the schema)", () => {
  it("refuses an operator it doesn't know, or a comparison without a value", () => {
    expect(condition.safeParse({ field: "a", op: "~=", value: 1 }).success).toBe(false);
    expect(condition.safeParse({ field: "a", op: "=" }).success).toBe(false);
    expect(condition.safeParse({ field: "a", op: "in", value: "x" }).success).toBe(false);
    expect(condition.safeParse({ field: "a", op: "empty" }).success).toBe(true);
  });

  it("refuses a key that isn't snake_case", () => {
    expect(condition.safeParse({ field: "Sample Provided", op: "empty" }).success).toBe(false);
  });

  it("refuses a rule that is neither a comparison nor all/any/not", () => {
    expect(condition.safeParse({ op: "=", value: 1 }).success).toBe(false);
    expect(condition.safeParse({ all: [{ field: "a", op: "=", value: 1 }], any: [] }).success).toBe(false);
    expect(condition.safeParse("finish = galvanised").success).toBe(false);
  });
});

