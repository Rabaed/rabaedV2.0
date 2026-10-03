import { describe, expect, it } from "vitest";
import { formatFormValue, formatTableCell } from "./form-display.ts";
import { formSchema, tableTotals, validateAnswers, type FormSchema } from "./form.ts";
import { publishProblems } from "./form-publish.ts";

// The `table` field (RP-280, spec RP-278): rows with typed columns, row limits
// and totals. Every cell is checked by its column's type, in draft and complete mode.

const label = (en: string) => ({ en, ar: en });

const itemsTable = {
  key: "items",
  type: "table",
  label: label("Items"),
  minRows: 1,
  maxRows: 3,
  columns: [
    { key: "fixture", type: "text", label: label("Fixture type"), required: true, maxLength: 20 },
    { key: "quantity", type: "number", label: label("Quantity"), min: 0, decimals: 1, total: true, required: true },
    { key: "unit_price", type: "currency", label: label("Unit price"), min: 0, total: true },
    { key: "delivery", type: "date", label: label("Delivery") },
    { key: "tested", type: "yes_no", label: label("Tested") },
    {
      key: "finish",
      type: "select",
      label: label("Finish"),
      options: [
        { value: "galvanised", label: label("Galvanised") },
        { value: "powder_coated", label: label("Powder coated") },
      ],
    },
  ],
};

const build = (fields: unknown[]): FormSchema =>
  formSchema.parse({
    sections: [
      { key: "main", title: label("Main"), fields },
      { key: "classification", title: label("Classification"), fields: [{ key: "trade", type: "trade", label: label("Trade") }] },
    ],
  });

const schema = build([itemsTable]);
const trade = { trade: "00000000-0000-4000-8000-000000000001" };

const check = (answers: Record<string, unknown>, mode: "draft" | "complete" = "draft", on: FormSchema = schema) =>
  validateAnswers(on, { ...trade, ...answers }, mode);
const errorsOf = (answers: Record<string, unknown>, mode: "draft" | "complete" = "draft", on: FormSchema = schema) => {
  const result = check(answers, mode, on);
  return result.ok ? [] : result.errors;
};
const cleanOf = (answers: Record<string, unknown>, mode: "draft" | "complete" = "draft") => {
  const result = check(answers, mode);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const { trade: _trade, ...own } = result.answers;
  return own;
};

const row = { fixture: "Downlight", quantity: 12 };

describe("a table's answers", () => {
  it("are a list of row objects keyed by column key, stored exactly as given", () => {
    const rows = [
      { fixture: "Downlight", quantity: 12.5, unit_price: 80.25, delivery: "2026-10-03", tested: false, finish: "galvanised" },
      { fixture: "Panel", quantity: 0 },
    ];
    expect(cleanOf({ items: rows })).toEqual({ items: rows });
  });

  it("drop empty cells and rows with nothing in them, but keep No", () => {
    expect(cleanOf({ items: [{ fixture: "Downlight", quantity: undefined, delivery: "", tested: false }, {}, { fixture: "" }] })).toEqual({
      items: [{ fixture: "Downlight", tested: false }],
    });
  });

  it("with no rows are no answer at all", () => {
    expect(cleanOf({ items: [] })).toEqual({});
    expect(cleanOf({ items: [{}] })).toEqual({});
  });

  it("must be a list of objects", () => {
    expect(errorsOf({ items: "three" })).toEqual([{ key: "items", code: "wrong_type" }]);
    expect(errorsOf({ items: { fixture: "Downlight" } })).toEqual([{ key: "items", code: "wrong_type" }]);
    expect(errorsOf({ items: [row, "Panel", [1]] })).toEqual([
      { key: "items", code: "wrong_type", row: 1 },
      { key: "items", code: "wrong_type", row: 2 },
    ]);
  });

  it("refuse a column the table doesn't have, naming the cell", () => {
    expect(errorsOf({ items: [{ ...row, colour: "red" }] })).toEqual([{ key: "items", code: "unknown_field", row: 0, column: "colour" }]);
  });
});

describe("a cell", () => {
  it("is refused when it isn't its column's type, naming the row and column", () => {
    expect(errorsOf({ items: [row, { fixture: 5, quantity: "12" }] })).toEqual([
      { key: "items", code: "wrong_type", row: 1, column: "fixture" },
      { key: "items", code: "wrong_type", row: 1, column: "quantity" },
    ]);
    expect(errorsOf({ items: [{ ...row, tested: "yes" }] })).toEqual([{ key: "items", code: "wrong_type", row: 0, column: "tested" }]);
    expect(errorsOf({ items: [{ ...row, unit_price: true }] })).toEqual([{ key: "items", code: "wrong_type", row: 0, column: "unit_price" }]);
  });

  it("is checked by its column's limits, decimals, format and options", () => {
    expect(errorsOf({ items: [{ ...row, quantity: -1 }] })).toEqual([{ key: "items", code: "below_min", row: 0, column: "quantity" }]);
    expect(errorsOf({ items: [{ ...row, quantity: 1.25 }] })).toEqual([{ key: "items", code: "too_many_decimals", row: 0, column: "quantity" }]);
    expect(errorsOf({ items: [{ ...row, unit_price: 1.005 }] })).toEqual([{ key: "items", code: "too_many_decimals", row: 0, column: "unit_price" }]);
    expect(errorsOf({ items: [{ ...row, fixture: "x".repeat(21) }] })).toEqual([{ key: "items", code: "too_long", row: 0, column: "fixture" }]);
    expect(errorsOf({ items: [{ ...row, delivery: "03/10/2026" }] })).toEqual([{ key: "items", code: "invalid_format", row: 0, column: "delivery" }]);
    expect(errorsOf({ items: [{ ...row, finish: "painted" }] })).toEqual([{ key: "items", code: "unknown_option", row: 0, column: "finish" }]);
  });

  it("is required only when the table is complete", () => {
    expect(errorsOf({ items: [{ delivery: "2026-10-03" }] })).toEqual([]);
    expect(errorsOf({ items: [{ delivery: "2026-10-03" }] }, "complete")).toEqual([
      { key: "items", code: "required", row: 0, column: "fixture" },
      { key: "items", code: "required", row: 0, column: "quantity" },
    ]);
    expect(errorsOf({ items: [{ ...row, quantity: 0 }] }, "complete")).toEqual([]);
  });
});

describe("row limits", () => {
  it("are enforced in complete mode: too few rows, with no rows at all too", () => {
    expect(errorsOf({}, "complete", build([{ ...itemsTable, required: false }]))).toEqual([{ key: "items", code: "too_few_rows" }]);
    expect(errorsOf({ items: [{}] }, "complete", build([{ ...itemsTable, required: false }]))).toEqual([{ key: "items", code: "too_few_rows" }]);
    const two = build([{ ...itemsTable, minRows: 2 }]);
    expect(errorsOf({ items: [row] }, "complete", two)).toEqual([{ key: "items", code: "too_few_rows" }]);
    expect(errorsOf({ items: [row, row] }, "complete", two)).toEqual([]);
  });

  it("are enforced in complete mode: too many rows", () => {
    expect(errorsOf({ items: [row, row, row] }, "complete")).toEqual([]);
    expect(errorsOf({ items: [row, row, row, row] }, "complete")).toEqual([{ key: "items", code: "too_many_rows" }]);
  });

  it("are not enforced in a draft, where rows are still being added", () => {
    expect(errorsOf({}, "draft")).toEqual([]);
    expect(errorsOf({ items: [row, row, row, row] }, "draft")).toEqual([]);
  });

  it("never allow more than 200 rows, even in a draft", () => {
    const many = Array.from({ length: 201 }, () => row);
    expect(errorsOf({ items: many }, "draft", build([{ ...itemsTable, maxRows: undefined }]))).toEqual([{ key: "items", code: "too_many_rows" }]);
  });

  it("a required table with no rows is required", () => {
    expect(errorsOf({}, "complete", build([{ ...itemsTable, required: true }]))).toEqual([{ key: "items", code: "required" }]);
  });

  it("an optional table without a minimum may stay empty", () => {
    expect(errorsOf({}, "complete", build([{ ...itemsTable, minRows: undefined }]))).toEqual([]);
  });
});

describe("conditions and hidden tables", () => {
  const conditional = build([
    { key: "has_items", type: "yes_no", label: label("Has items") },
    { ...itemsTable, minRows: 1, visible_if: { field: "has_items", op: "=", value: true } },
  ]);

  it("a table that isn't shown is cleared, not checked", () => {
    const result = check({ has_items: false, items: [{ fixture: 5 }] }, "complete", conditional);
    expect(result.ok && result.answers).toEqual({ ...trade, has_items: false });
  });

  it("a shown table is checked", () => {
    expect(errorsOf({ has_items: true }, "complete", conditional)).toEqual([{ key: "items", code: "too_few_rows" }]);
  });

  it("another field can show by whether the table has rows", () => {
    const after = build([
      itemsTable,
      { key: "notes", type: "text", label: label("Notes"), visible_if: { field: "items", op: "not_empty" } },
    ]);
    expect(check({ notes: "x" }, "draft", after).ok && "notes" in (check({ notes: "x" }, "draft", after) as { answers: object }).answers).toBe(false);
    const shown = check({ items: [row], notes: "x" }, "draft", after);
    expect(shown.ok && shown.answers.notes).toBe("x");
  });
});

describe("totals", () => {
  it("add up each number and currency column marked with a total", () => {
    expect(tableTotals(schema.sections[0]!.fields[0] as never, [{ quantity: 12.5, unit_price: 80.25 }, { quantity: 7.5 }, { fixture: "x" }])).toEqual({
      quantity: 20,
      unit_price: 80.25,
    });
  });

  it("round to the column's decimals, so 0.1 + 0.2 is 0.3", () => {
    const field = build([
      { key: "t", type: "table", label: label("T"), columns: [{ key: "n", type: "number", label: label("N"), decimals: 1, total: true }] },
    ]).sections[0]!.fields[0]!;
    expect(tableTotals(field as never, [{ n: 0.1 }, { n: 0.2 }])).toEqual({ n: 0.3 });
  });

  it("are empty for a table with no rows, and skip columns without a total", () => {
    const field = schema.sections[0]!.fields[0] as never;
    expect(tableTotals(field, [])).toEqual({});
    expect(tableTotals(field, undefined)).toEqual({});
    expect(Object.keys(tableTotals(field, [row]))).toEqual(["quantity"]);
  });

  it("ignore cells that aren't numbers", () => {
    expect(tableTotals(schema.sections[0]!.fields[0] as never, [{ quantity: "5" }, { quantity: 3 }])).toEqual({ quantity: 3 });
  });
});

describe("the table's schema", () => {
  const table = (extra: Record<string, unknown>) => ({ ...itemsTable, ...extra });

  it("takes text, number, currency, date, yes_no and select columns", () => {
    expect(() => build([itemsTable])).not.toThrow();
  });

  it("takes no files, people, checklists or nested tables in columns", () => {
    for (const type of ["attachments", "photos", "member", "participant", "checklist", "table", "work_item_ref"]) {
      expect(() => build([table({ columns: [{ key: "c", type, label: label("C") }] })]), type).toThrow();
    }
  });

  it("refuses duplicate column keys, no columns, and a minimum above the maximum", () => {
    const dup = { key: "fixture", type: "text", label: label("Again") };
    expect(() => build([table({ columns: [itemsTable.columns[0], dup] })])).toThrow();
    expect(() => build([table({ columns: [] })])).toThrow();
    expect(() => build([table({ minRows: 4, maxRows: 3 })])).toThrow();
    expect(() => build([table({ maxRows: 201 })])).toThrow();
  });

  it("keeps its key forever: a later Version can't reuse it for another type", () => {
    const next = build([{ key: "items", type: "text", label: label("Items") }]);
    expect(publishProblems(next, [schema]).filter((p) => p.code === "key_type_changed")).toEqual([{ key: "items", code: "key_type_changed" }]);
  });
});

describe("reading a table", () => {
  const field = schema.sections[0]!.fields[0] as Parameters<typeof formatFormValue>[0];
  const column = (key: string) => (field as { columns: Parameters<typeof formatTableCell>[0][] }).columns.find((c) => c.key === key)!;

  it("summarises its rows for the history", () => {
    expect(formatFormValue(field, [row], "en")).toBe("1 row");
    expect(formatFormValue(field, [row, row, row], "en")).toBe("3 rows");
    expect(formatFormValue(field, [row, row], "ar")).toBe("صفان");
    expect(formatFormValue(field, [row, row, row], "ar")).toBe("3 صفوف");
  });

  it("shows a cell by its column's type, in the viewer's language", () => {
    expect(formatTableCell(column("quantity"), 1250.5, "en")).toBe("1,250.5");
    expect(formatTableCell(column("unit_price"), 80.25, "en")).toBe("SAR 80.25");
    expect(formatTableCell(column("tested"), true, "ar")).toBe("نعم");
    expect(formatTableCell(column("tested"), false, "en")).toBe("No");
    expect(formatTableCell(column("finish"), "galvanised", "en")).toBe("Galvanised");
    expect(formatTableCell(column("fixture"), "Downlight", "en")).toBe("Downlight");
    expect(formatTableCell(column("fixture"), undefined, "en")).toBe("");
  });
});
