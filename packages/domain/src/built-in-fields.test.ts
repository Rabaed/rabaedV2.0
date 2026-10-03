import { describe, expect, it } from "vitest";
import { formSchema, formSchemaProblems, scopesFittingTrade, validateAnswers, type FormSchema } from "./form.ts";

// Seam 3: the Built-in Fields (form-engine.md §1; RP-270). Trade, Location and
// Scopes sit inside every Form, where the Form places them; no Form can remove
// them or make Trade and Location optional, because visibility and Consultant
// routing depend on them.

const label = (en: string) => ({ en, ar: en });

const trade = { electrical: "0190a1b2-0000-7000-8000-000000000001", mechanical: "0190a1b2-0000-7000-8000-000000000002" };
const location = "0190a1b2-0000-7000-8000-000000000010";
const scope = {
  lighting: "0190a1b2-0000-7000-8000-000000000101",
  indoor: "0190a1b2-0000-7000-8000-000000000102",
  power: "0190a1b2-0000-7000-8000-000000000103",
  hvac: "0190a1b2-0000-7000-8000-000000000201",
};
const scopes = [
  { id: scope.lighting, tradeId: trade.electrical, parentId: null },
  { id: scope.indoor, tradeId: trade.electrical, parentId: scope.lighting },
  { id: scope.power, tradeId: trade.electrical, parentId: null },
  { id: scope.hvac, tradeId: trade.mechanical, parentId: null },
];

const builtIns = [
  { key: "trade", type: "trade", label: label("Trade") },
  { key: "location", type: "location", label: label("Location") },
  { key: "scopes", type: "scopes", label: label("Scopes") },
];

/** A Form with the Built-in Fields placed mid-Form, between its own fields. */
const withBuiltIns = (fields: unknown[] = builtIns) =>
  formSchema.parse({
    sections: [
      { key: "material", title: label("Material"), fields: [{ key: "manufacturer", type: "text", label: label("Manufacturer") }] },
      { key: "classification", title: label("Classification"), fields },
      { key: "notes", title: label("Notes"), fields: [{ key: "description", type: "textarea", label: label("Description") }] },
    ],
  });

const schema: FormSchema = withBuiltIns();

describe("formSchemaProblems: the Built-in Fields", () => {
  it("accepts a Form that places all of them, anywhere", () => {
    expect(formSchemaProblems(schema)).toEqual([]);
    // Labelled as the Form wants, with help.
    const relabelled = withBuiltIns([
      { key: "scopes", type: "scopes", label: label("Work scope"), required: true },
      { key: "location", type: "location", label: label("Area"), help: label("Where it is installed.") },
      { key: "trade", type: "trade", label: label("Discipline") },
    ]);
    expect(formSchemaProblems(relabelled)).toEqual([]);
  });

  it("refuses a Form without them, naming each one missing", () => {
    const without = formSchema.parse({
      sections: [{ key: "material", title: label("Material"), fields: [{ key: "manufacturer", type: "text", label: label("Manufacturer") }] }],
    });
    expect(formSchemaProblems(without)).toEqual([
      { key: "trade", code: "built_in_missing" },
      { key: "location", code: "built_in_missing" },
      { key: "scopes", code: "built_in_missing" },
    ]);
    expect(formSchemaProblems(withBuiltIns([builtIns[0], builtIns[2]]))).toEqual([{ key: "location", code: "built_in_missing" }]);
  });

  it("refuses Trade or Location made optional", () => {
    expect(
      formSchemaProblems(
        withBuiltIns([
          { ...builtIns[0], required: false },
          { ...builtIns[1], required: false },
          builtIns[2],
        ]),
      ),
    ).toEqual([
      { key: "trade", code: "built_in_optional" },
      { key: "location", code: "built_in_optional" },
    ]);
  });

  it("refuses one placed twice", () => {
    expect(formSchemaProblems(withBuiltIns([...builtIns, builtIns[0]]))).toEqual([{ key: "trade", code: "built_in_repeated" }]);
  });

  it("refuses a Built-in Field under another key: answers and visibility find it by its own", () => {
    expect(() => withBuiltIns([{ ...builtIns[0], key: "discipline" }, builtIns[1], builtIns[2]])).toThrow();
  });
});

describe("validateAnswers: Trade and Location", () => {
  it("requires Trade even in a Draft: no Work Item exists without one", () => {
    expect(validateAnswers(schema, {}, "draft", { scopes })).toEqual({ ok: false, errors: [{ key: "trade", code: "required" }] });
    expect(validateAnswers(schema, { trade: trade.electrical }, "draft", { scopes })).toEqual({
      ok: true,
      answers: { trade: trade.electrical },
    });
  });

  it("requires Location to leave Draft", () => {
    expect(validateAnswers(schema, { trade: trade.electrical }, "complete", { scopes })).toEqual({
      ok: false,
      errors: [{ key: "location", code: "required" }],
    });
    const answers = { trade: trade.electrical, location };
    expect(validateAnswers(schema, answers, "complete", { scopes })).toEqual({ ok: true, answers });
  });

  it("requires both whatever the schema says", () => {
    const optional = withBuiltIns([
      { ...builtIns[0], required: false },
      { ...builtIns[1], required: false },
      builtIns[2],
    ]);
    expect(validateAnswers(optional, {}, "complete", { scopes })).toEqual({
      ok: false,
      errors: [
        { key: "trade", code: "required" },
        { key: "location", code: "required" },
      ],
    });
  });

  it("takes each as one value's id", () => {
    for (const value of [42, "Electrical", [trade.electrical], { id: trade.electrical }]) {
      expect(validateAnswers(schema, { trade: value, location: value }, "draft", { scopes }), JSON.stringify(value)).toEqual({
        ok: false,
        errors: [
          { key: "trade", code: "wrong_type" },
          { key: "location", code: "wrong_type" },
        ],
      });
    }
  });
});

describe("validateAnswers: Scopes, filtered by the chosen Trade", () => {
  const check = (chosen: unknown, mode: "draft" | "complete" = "draft", tradeId = trade.electrical) =>
    validateAnswers(schema, { trade: tradeId, location, scopes: chosen }, mode, { scopes });

  it("accepts Scopes of the chosen Trade, and Sub-scopes of a chosen Scope", () => {
    const chosen = [scope.lighting, scope.indoor, scope.power];
    expect(check(chosen)).toEqual({ ok: true, answers: { trade: trade.electrical, location, scopes: chosen } });
  });

  it("refuses a Scope of another Trade", () => {
    expect(check([scope.lighting, scope.hvac])).toEqual({ ok: false, errors: [{ key: "scopes", code: "unknown_option" }] });
    expect(check([scope.hvac], "draft", trade.mechanical).ok).toBe(true);
  });

  it("refuses a Sub-scope whose Scope isn't chosen", () => {
    expect(check([scope.indoor])).toEqual({ ok: false, errors: [{ key: "scopes", code: "unknown_option" }] });
  });

  it("refuses an id that isn't one of the Project's Scopes", () => {
    expect(check(["0190a1b2-0000-7000-8000-000000000999"])).toEqual({
      ok: false,
      errors: [{ key: "scopes", code: "unknown_option" }],
    });
  });

  it("takes a list of distinct ids", () => {
    for (const chosen of [scope.lighting, [42], ["Lighting"], [scope.lighting, scope.lighting]]) {
      expect(check(chosen), JSON.stringify(chosen)).toEqual({ ok: false, errors: [{ key: "scopes", code: "wrong_type" }] });
    }
  });

  it("drops an empty list, and requires one only where the Form does", () => {
    expect(check([])).toEqual({ ok: true, answers: { trade: trade.electrical, location } });
    expect(check([], "complete").ok).toBe(true);
    const required = withBuiltIns([builtIns[0], builtIns[1], { ...builtIns[2], required: true }]);
    expect(validateAnswers(required, { trade: trade.electrical, location, scopes: [] }, "complete", { scopes })).toEqual({
      ok: false,
      errors: [{ key: "scopes", code: "required" }],
    });
  });
});

describe("scopesFittingTrade", () => {
  it("keeps the chosen Scopes of the new Trade, and Sub-scopes only under a kept Scope", () => {
    const chosen = [scope.lighting, scope.indoor, scope.hvac];
    expect(scopesFittingTrade(chosen, trade.electrical, scopes)).toEqual([scope.lighting, scope.indoor]);
    expect(scopesFittingTrade(chosen, trade.mechanical, scopes)).toEqual([scope.hvac]);
    expect(scopesFittingTrade(chosen, "", scopes)).toEqual([]);
    expect(scopesFittingTrade([scope.indoor], trade.electrical, scopes)).toEqual([]);
  });
});
