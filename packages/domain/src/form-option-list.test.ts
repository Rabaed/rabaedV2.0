import { describe, expect, it } from "vitest";
import { formatFormValue, formatTableCell } from "./form-display.ts";
import { formSchema, validateAnswers, type FormSchema, type ValidationContext } from "./form.ts";
import { publishProblems } from "./form-publish.ts";
import type { OptionList, OptionNode } from "./option-list.ts";

// The `option_list` field, also as a table column (RP-282, spec RP-278): choices
// from an Option List that stays live, down to the depth the field asks for.

const label = (en: string, ar = en) => ({ en, ar });
const node = (value: string, options: OptionNode[] = [], retired = false): OptionNode => ({
  id: `00000000-0000-4000-8000-${value.padStart(12, "0").slice(-12)}`,
  value,
  label: label(value, `${value} ع`),
  retired,
  options,
});

const listId = "00000000-0000-4000-8000-0000000000a1";
// Three levels: cables > copper > (2-5mm, 10mm); cables > fibre (a leaf at level 2);
// trays (a leaf at level 1); a retired option at each place that matters.
const list: OptionList = {
  id: listId,
  name: label("Materials"),
  options: [
    node("cables", [node("copper", [node("two5", [], false), node("ten", [], true)]), node("fibre")]),
    node("trays"),
    node("old", [node("old-child")], true),
  ],
};
const lists = [list];

const field = (extra: Record<string, unknown> = {}) => ({
  key: "material",
  type: "option_list",
  label: label("Material"),
  list: listId,
  ...extra,
});
const build = (fields: unknown[]): FormSchema =>
  formSchema.parse({
    sections: [
      { key: "main", title: label("Main"), fields },
      { key: "classification", title: label("Classification"), fields: [{ key: "trade", type: "trade", label: label("Trade") }] },
    ],
  });
const trade = { trade: "00000000-0000-4000-8000-000000000001" };

const errorsOf = (
  schema: FormSchema,
  answers: Record<string, unknown>,
  mode: "draft" | "complete" = "draft",
  context: ValidationContext = {},
) => {
  const result = validateAnswers(schema, { ...trade, ...answers }, mode, { optionLists: lists, ...context });
  return result.ok ? [] : result.errors;
};

describe("the option_list field's settings", () => {
  it("defaults to a single choice, one level deep, and refuses a depth outside 1 to 3", () => {
    const parsed = build([field()]).sections[0]!.fields[0];
    expect(parsed).toMatchObject({ type: "option_list", multiple: false, depth: 1 });
    expect(() => build([field({ depth: 0 })])).toThrow();
    expect(() => build([field({ depth: 4 })])).toThrow();
    expect(() => build([field({ list: "not-an-id" })])).toThrow();
  });
});

describe("a single choice", () => {
  const schema = build([field({ depth: 3 })]);

  it("takes an option reached at its depth, and stores its value", () => {
    const result = validateAnswers(schema, { ...trade, material: "two5" }, "complete", { optionLists: lists });
    expect(result).toEqual({ ok: true, answers: { ...trade, material: "two5" } });
  });

  it("takes a branch that ends sooner, because nothing lies deeper", () => {
    expect(errorsOf(schema, { material: "fibre" }, "complete")).toEqual([]);
    expect(errorsOf(schema, { material: "trays" }, "complete")).toEqual([]);
  });

  it("refuses an option that isn't in the list, or isn't text", () => {
    expect(errorsOf(schema, { material: "nothing" })).toEqual([{ key: "material", code: "unknown_option" }]);
    expect(errorsOf(schema, { material: 7 })).toEqual([{ key: "material", code: "wrong_type" }]);
    expect(errorsOf(schema, { material: ["two5"] })).toEqual([{ key: "material", code: "wrong_type" }]);
  });

  it("refuses a list that doesn't exist", () => {
    expect(errorsOf(schema, { material: "two5" }, "draft", { optionLists: [] })).toEqual([{ key: "material", code: "unknown_option" }]);
  });

  it("stops short only when leaving Draft: a Draft may be half way down", () => {
    expect(errorsOf(schema, { material: "cables" }, "draft")).toEqual([]);
    expect(errorsOf(schema, { material: "cables" }, "complete")).toEqual([{ key: "material", code: "too_shallow" }]);
    expect(errorsOf(schema, { material: "copper" }, "complete")).toEqual([{ key: "material", code: "too_shallow" }]);
  });

  it("doesn't offer options below its depth", () => {
    const shallow = build([field({ depth: 2 })]);
    expect(errorsOf(shallow, { material: "two5" })).toEqual([{ key: "material", code: "unknown_option" }]);
    expect(errorsOf(shallow, { material: "copper" }, "complete")).toEqual([]);
    const oneLevel = build([field()]);
    expect(errorsOf(oneLevel, { material: "cables" }, "complete")).toEqual([]);
    expect(errorsOf(oneLevel, { material: "copper" })).toEqual([{ key: "material", code: "unknown_option" }]);
  });

  it("treats a branch whose options are all retired as ending there", () => {
    const deep = build([field({ depth: 3 })]);
    const oneRetiredChild: OptionList = { ...list, options: [node("a", [node("b", [], true)])] };
    expect(errorsOf(deep, { material: "a" }, "complete", { optionLists: [oneRetiredChild] })).toEqual([]);
  });

  it("is required when it says so, an empty answer counts as none", () => {
    const required = build([field({ required: true })]);
    expect(errorsOf(required, {}, "complete")).toEqual([{ key: "material", code: "required" }]);
    expect(errorsOf(required, { material: "" }, "complete")).toEqual([{ key: "material", code: "required" }]);
    expect(errorsOf(required, {}, "draft")).toEqual([]);
  });
});

describe("retired options", () => {
  const schema = build([field({ depth: 3 })]);

  it("are refused for a new choice, at any level on the way", () => {
    expect(errorsOf(schema, { material: "ten" })).toEqual([{ key: "material", code: "unknown_option" }]);
    expect(errorsOf(schema, { material: "old" })).toEqual([{ key: "material", code: "unknown_option" }]);
    expect(errorsOf(schema, { material: "old-child" })).toEqual([{ key: "material", code: "unknown_option" }]);
  });

  it("stay valid on an answer that already holds them, and save again unchanged", () => {
    const held = { material: "ten" };
    expect(errorsOf(schema, held, "draft", { held })).toEqual([]);
    expect(errorsOf(schema, held, "complete", { held })).toEqual([]);
    const result = validateAnswers(schema, { ...trade, ...held }, "draft", { optionLists: lists, held });
    expect(result).toEqual({ ok: true, answers: { ...trade, ...held } });
  });

  it("don't make another retired option valid, and the answer can be changed away from them", () => {
    expect(errorsOf(schema, { material: "old-child" }, "draft", { held: { material: "ten" } })).toEqual([
      { key: "material", code: "unknown_option" },
    ]);
    expect(errorsOf(schema, { material: "fibre" }, "complete", { held: { material: "ten" } })).toEqual([]);
  });

  it("don't excuse an answer that stops short of the depth when leaving Draft, even if held", () => {
    const deep = build([field({ depth: 3 })]);
    const held = { material: "cables" };
    expect(errorsOf(deep, held, "draft", { held })).toEqual([]);
    expect(errorsOf(deep, held, "complete", { held })).toEqual([{ key: "material", code: "too_shallow" }]);
  });

  it("can't be gone deeper into, so a held one on the way down is deep enough", () => {
    const deep = build([field({ depth: 3 })]);
    const held = { material: "old" };
    expect(errorsOf(deep, held, "complete", { held })).toEqual([]);
    expect(errorsOf(deep, held, "complete")).toEqual([{ key: "material", code: "unknown_option" }]);
  });
});

describe("multiple choice", () => {
  const schema = build([field({ multiple: true, depth: 2 })]);

  it("takes a list of options, in the order chosen", () => {
    const result = validateAnswers(schema, { ...trade, material: ["trays", "copper"] }, "complete", { optionLists: lists });
    expect(result).toEqual({ ok: true, answers: { ...trade, material: ["trays", "copper"] } });
  });

  it("refuses a single value, a repeat, and any option that isn't allowed", () => {
    expect(errorsOf(schema, { material: "trays" })).toEqual([{ key: "material", code: "wrong_type" }]);
    expect(errorsOf(schema, { material: ["trays", "trays"] })).toEqual([{ key: "material", code: "wrong_type" }]);
    expect(errorsOf(schema, { material: ["trays", "ten"] })).toEqual([{ key: "material", code: "unknown_option" }]);
    expect(errorsOf(schema, { material: ["cables"] }, "complete")).toEqual([{ key: "material", code: "too_shallow" }]);
  });

  it("keeps a retired option an answer holds while the rest change", () => {
    const deep = build([field({ multiple: true, depth: 3 })]);
    expect(errorsOf(deep, { material: ["ten", "trays"] }, "complete", { held: { material: ["ten", "fibre"] } })).toEqual([]);
    expect(errorsOf(deep, { material: ["old-child"] }, "draft", { held: { material: ["ten"] } })).toEqual([
      { key: "material", code: "unknown_option" },
    ]);
  });

  it("is required when it says so, and an empty list counts as none", () => {
    const required = build([field({ multiple: true, required: true })]);
    expect(errorsOf(required, { material: [] }, "complete")).toEqual([{ key: "material", code: "required" }]);
  });
});

describe("as a table column", () => {
  const schema = build([
    {
      key: "items",
      type: "table",
      label: label("Items"),
      columns: [
        { key: "qty", type: "number", label: label("Quantity") },
        { key: "kind", type: "option_list", label: label("Kind"), list: listId, depth: 2, required: true },
      ],
    },
  ]);

  it("checks each cell against the list, with its row and column", () => {
    const rows = [{ qty: 1, kind: "trays" }, { qty: 2, kind: "nothing" }, { qty: 3, kind: "ten" }];
    expect(errorsOf(schema, { items: rows })).toEqual([
      { key: "items", code: "unknown_option", row: 1, column: "kind" },
      { key: "items", code: "unknown_option", row: 2, column: "kind" },
    ]);
  });

  it("keeps a retired option the saved rows already hold in that column", () => {
    const rows = [{ qty: 3, kind: "old" }];
    expect(errorsOf(schema, { items: rows }, "draft", { held: { items: rows } })).toEqual([]);
    expect(errorsOf(schema, { items: [{ kind: "old" }, { kind: "ten" }] }, "draft", { held: { items: rows } })).toEqual([
      { key: "items", code: "unknown_option", row: 1, column: "kind" },
    ]);
  });

  it("asks for the depth when leaving Draft, and for a required cell", () => {
    expect(errorsOf(schema, { items: [{ kind: "cables" }] }, "complete")).toEqual([{ key: "items", code: "too_shallow", row: 0, column: "kind" }]);
    expect(errorsOf(schema, { items: [{ kind: "fibre" }] }, "complete")).toEqual([]);
    const deeper = build([
      {
        key: "items",
        type: "table",
        label: label("Items"),
        columns: [{ key: "kind", type: "option_list", label: label("Kind"), list: listId, depth: 3 }],
      },
    ]);
    expect(errorsOf(deeper, { items: [{ kind: "cables" }] }, "complete")).toEqual([
      { key: "items", code: "too_shallow", row: 0, column: "kind" },
    ]);
    expect(errorsOf(schema, { items: [{ qty: 1 }] }, "complete")).toEqual([{ key: "items", code: "required", row: 0, column: "kind" }]);
  });
});

describe("publishing", () => {
  const known = new Set([listId]);
  const missing = "00000000-0000-4000-8000-0000000000ff";
  const withTrade = (fields: unknown[]) => build(fields);

  it("refuses a field or a table column whose list doesn't exist", () => {
    const table = {
      key: "items",
      type: "table",
      label: label("Items"),
      columns: [{ key: "kind", type: "option_list", label: label("Kind"), list: missing }],
    };
    const problems = publishProblems(withTrade([field({ list: missing }), table]), [], { optionListIds: known });
    expect(problems.filter((p) => p.code === "unknown_option_list")).toEqual([
      { key: "material", code: "unknown_option_list" },
      { key: "items", code: "unknown_option_list" },
    ]);
  });

  it("takes a list that exists, and doesn't look when it isn't told which exist", () => {
    const problems = (ids?: ReadonlySet<string>) =>
      publishProblems(withTrade([field()]), [], ids && { optionListIds: ids }).filter((p) => p.code === "unknown_option_list");
    expect(problems(known)).toEqual([]);
    expect(problems()).toEqual([]);
  });
});

describe("reading an answer", () => {
  const parsed = build([field({ depth: 3 }), field({ key: "several", multiple: true, depth: 3 })]).sections[0]!.fields;
  const [single, several] = parsed as [Parameters<typeof formatFormValue>[0], Parameters<typeof formatFormValue>[0]];

  it("shows the path to the option in the viewer's language", () => {
    expect(formatFormValue(single, "two5", "en", undefined, lists)).toBe("cables › copper › two5");
    expect(formatFormValue(single, "two5", "ar", undefined, lists)).toBe("cables ع ‹ copper ع ‹ two5 ع");
  });

  it("marks a retired option, wherever it sits on the path", () => {
    expect(formatFormValue(single, "ten", "en", undefined, lists)).toBe("cables › copper › ten (retired)");
    expect(formatFormValue(single, "old-child", "ar", undefined, lists)).toBe("old ع ‹ old-child ع (موقوف)");
  });

  it("lists several, and shows the value as stored when the list can't name it", () => {
    expect(formatFormValue(several, ["trays", "fibre"], "en", undefined, lists)).toBe("trays, cables › fibre");
    expect(formatFormValue(single, "gone", "en", undefined, lists)).toBe("gone");
    expect(formatFormValue(single, "trays", "en")).toBe("trays");
  });

  it("reads a table cell the same way", () => {
    const column = { key: "kind", type: "option_list", label: label("Kind"), list: listId, depth: 2, required: false } as const;
    expect(formatTableCell(column, "fibre", "en", lists)).toBe("cables › fibre");
  });
});
