import { describe, expect, it } from "vitest";
import { formSchema, type FormSchema } from "./form.ts";
import { formSchemaProblems, publishProblems } from "./form-publish.ts";

// Seam 3: the publish-time checks (form-engine.md §7; RP-271). A Form Version
// that fails them never reaches a Project: duplicate keys, conditions that read
// missing fields or each other in a circle, required fields that can never
// show, missing Built-in Fields, and a key reused for another type in a later
// Version of the same Form.

const label = (en: string) => ({ en, ar: en });

const classification = {
  key: "classification",
  title: label("Classification"),
  fields: [
    { key: "trade", type: "trade", label: label("Trade") },
    { key: "location", type: "location", label: label("Location") },
    { key: "scopes", type: "scopes", label: label("Scopes") },
  ],
};

/** A Form with the given sections, then the Built-in Fields. */
const form = (...sections: unknown[]): FormSchema => formSchema.parse({ sections: [...sections, classification] });
const section = (key: string, fields: unknown[], extra: object = {}) => ({ key, title: label(key), fields, ...extra });
const text = (key: string, extra: object = {}) => ({ key, type: "text", label: label(key), ...extra });
const yesNo = (key: string, extra: object = {}) => ({ key, type: "yes_no", label: label(key), ...extra });
const select = (key: string, values: string[], extra: object = {}) => ({
  key,
  type: "select",
  label: label(key),
  options: values.map((value) => ({ value, label: label(value) })),
  ...extra,
});

const sample = form(
  section("sample", [
    yesNo("sample_provided", { required: true }),
    text("sample_reference", { required: true, visible_if: { field: "sample_provided", op: "=", value: true } }),
    select("finish", ["galvanised", "other"]),
    text("finish_details", { required: { field: "finish", op: "=", value: "other" } }),
  ]),
  section("lab", [text("lab_name", { required: true })], { visible_if: { field: "finish", op: "=", value: "other" } }),
);

describe("publishProblems: one schema", () => {
  it("accepts a Form whose conditions read existing fields and can all show", () => {
    expect(publishProblems(sample)).toEqual([]);
  });

  it("runs the Built-in Field checks too", () => {
    const without = formSchema.parse({ sections: [section("sample", [text("manufacturer")])] });
    expect(publishProblems(without).map((p) => p.code)).toEqual(["built_in_missing", "built_in_missing", "built_in_missing"]);
  });

  describe("unique keys", () => {
    it("refuses a field key used twice, in one section or across two", () => {
      expect(publishProblems(form(section("a", [text("model"), text("model")])))).toEqual([{ key: "model", code: "duplicate_key" }]);
      expect(publishProblems(form(section("a", [text("model")]), section("b", [yesNo("model")])))).toEqual([
        { key: "model", code: "duplicate_key" },
      ]);
    });

    it("refuses a section key used twice, or shared with a field", () => {
      expect(publishProblems(form(section("a", [text("x")]), section("a", [text("y")])))).toEqual([{ key: "a", code: "duplicate_key" }]);
      expect(publishProblems(form(section("model", [text("model")])))).toEqual([{ key: "model", code: "duplicate_key" }]);
    });

    it("counts layout fields: their keys are keys too", () => {
      const heading = { key: "model", type: "heading", text: label("Model") };
      expect(publishProblems(form(section("a", [heading, text("model")])))).toEqual([{ key: "model", code: "duplicate_key" }]);
    });
  });

  describe("conditions reference existing fields", () => {
    it("refuses a visible_if, on a field or a section, that reads a missing field", () => {
      const onField = form(section("a", [text("x", { visible_if: { field: "nope", op: "not_empty" } })]));
      expect(publishProblems(onField)).toEqual([{ key: "x", code: "unknown_reference" }]);
      const onSection = form(section("a", [text("x")], { visible_if: { all: [{ field: "x", op: "empty" }, { field: "nope", op: "empty" }] } }));
      expect(publishProblems(onSection)).toEqual(expect.arrayContaining([{ key: "a", code: "unknown_reference" }]));
    });

    it("refuses a conditional required that reads a missing field", () => {
      const schema = form(section("a", [text("x", { required: { not: { field: "nope", op: "empty" } } })]));
      expect(publishProblems(schema)).toEqual([{ key: "x", code: "unknown_reference" }]);
    });

    it("refuses a condition that reads a layout field or a section: they hold no answer", () => {
      const heading = { key: "about", type: "heading", text: label("About") };
      const schema = form(section("a", [heading, text("x", { visible_if: { field: "about", op: "not_empty" } })]));
      expect(publishProblems(schema)).toEqual([{ key: "x", code: "unknown_reference" }]);
      const readsSection = form(section("a", [yesNo("y")]), section("b", [text("x", { visible_if: { field: "a", op: "empty" } })]));
      expect(publishProblems(readsSection)).toEqual([{ key: "x", code: "unknown_reference" }]);
    });

    it("lets a condition read a Built-in Field, which is a Form field like any other", () => {
      const schema = form(section("a", [text("x", { visible_if: { field: "trade", op: "not_empty" } })]));
      expect(publishProblems(schema)).toEqual([]);
    });
  });

  describe("no circular conditions", () => {
    it("refuses a field shown only if it is answered itself", () => {
      const schema = form(section("a", [text("x", { visible_if: { field: "x", op: "not_empty" } })]));
      expect(publishProblems(schema)).toEqual([{ key: "x", code: "condition_cycle" }]);
    });

    it("refuses two fields shown only if the other is, naming each", () => {
      const schema = form(
        section("a", [
          yesNo("x", { visible_if: { field: "y", op: "=", value: true } }),
          yesNo("y", { visible_if: { field: "x", op: "=", value: true } }),
          text("z"),
        ]),
      );
      expect(publishProblems(schema)).toEqual([
        { key: "x", code: "condition_cycle" },
        { key: "y", code: "condition_cycle" },
      ]);
    });

    it("refuses a section shown only by an answer inside it", () => {
      const schema = form(section("a", [yesNo("x")], { visible_if: { field: "x", op: "=", value: true } }));
      expect(publishProblems(schema)).toEqual([
        { key: "a", code: "condition_cycle" },
        { key: "x", code: "condition_cycle" },
      ]);
    });

    it("allows a chain, and a conditional required that reads the field itself", () => {
      const schema = form(
        section("a", [
          yesNo("x"),
          yesNo("y", { visible_if: { field: "x", op: "=", value: true } }),
          text("z", { visible_if: { field: "y", op: "=", value: true }, required: { field: "z", op: "empty" } }),
        ]),
      );
      expect(publishProblems(schema)).toEqual([]);
    });
  });

  describe("no required field in a section that can never show", () => {
    it("refuses one in a section shown only by an option the field doesn't have", () => {
      const schema = form(
        section("a", [select("finish", ["galvanised", "other"])]),
        section("b", [text("details", { required: true }), text("notes")], { visible_if: { field: "finish", op: "=", value: "painted" } }),
      );
      expect(publishProblems(schema)).toEqual([{ key: "details", code: "required_never_shown" }]);
    });

    it("refuses one whose section's rule contradicts itself", () => {
      const schema = form(
        section("a", [yesNo("x")]),
        section("b", [text("details", { required: { field: "x", op: "=", value: true } })], {
          visible_if: { all: [{ field: "x", op: "=", value: true }, { field: "x", op: "=", value: false }] },
        }),
      );
      expect(publishProblems(schema)).toEqual([{ key: "details", code: "required_never_shown" }]);
    });

    it("refuses one behind a field that can never show: it reads as cleared", () => {
      const schema = form(
        section("a", [select("finish", ["galvanised"]), yesNo("x", { visible_if: { field: "finish", op: "=", value: "painted" } })]),
        section("b", [text("details", { required: true })], { visible_if: { field: "x", op: "=", value: true } }),
      );
      expect(publishProblems(schema)).toEqual([{ key: "details", code: "required_never_shown" }]);
    });

    it("refuses a required field whose own rule can never hold", () => {
      const schema = form(section("a", [yesNo("x"), text("details", { required: true, visible_if: { field: "x", op: "in", value: ["maybe"] } })]));
      expect(publishProblems(schema)).toEqual([{ key: "details", code: "required_never_shown" }]);
    });

    it("allows optional fields there, and rules it can't rule out (free text, numbers, dates)", () => {
      const optional = form(
        section("a", [select("finish", ["galvanised"])]),
        section("b", [text("notes")], { visible_if: { field: "finish", op: "=", value: "painted" } }),
      );
      expect(publishProblems(optional)).toEqual([]);
      const freeText = form(
        section("a", [text("finish")]),
        section("b", [text("details", { required: true })], { visible_if: { field: "finish", op: "=", value: "painted" } }),
      );
      expect(publishProblems(freeText)).toEqual([]);
    });

    it("works out multi-selects too", () => {
      const multi = { key: "tests", type: "multi_select", label: label("Tests"), options: ["fire", "load"].map((value) => ({ value, label: label(value) })) };
      const reachable = form(section("a", [multi]), section("b", [text("details", { required: true })], { visible_if: { field: "tests", op: "=", value: ["load", "fire"] } }));
      expect(publishProblems(reachable)).toEqual([]);
      const unreachable = form(section("a", [multi]), section("b", [text("details", { required: true })], { visible_if: { field: "tests", op: "in", value: ["acoustic"] } }));
      expect(publishProblems(unreachable)).toEqual([{ key: "details", code: "required_never_shown" }]);
    });
  });
});

describe("publishProblems: keys are forever, across Versions", () => {
  const version1 = form(section("a", [text("model"), yesNo("tested"), { key: "about", type: "heading", text: label("About") }]));

  it("accepts a later Version that keeps, drops or adds keys", () => {
    const version2 = form(section("a", [text("model", { required: true }), text("colour")]));
    expect(publishProblems(version2, [version1])).toEqual([]);
  });

  it("refuses a key reused for a field of another type, in any later Version", () => {
    const version2 = form(section("a", [text("colour")]));
    const version3 = form(section("a", [select("model", ["a", "b"]), text("colour")]));
    expect(publishProblems(version3, [version1, version2])).toEqual([{ key: "model", code: "key_type_changed" }]);
  });

  it("remembers a dropped key: it comes back with its old type, or not at all", () => {
    const version2 = form(section("a", [text("model")]));
    expect(publishProblems(form(section("a", [text("tested")])), [version1, version2])).toEqual([
      { key: "tested", code: "key_type_changed" },
    ]);
    expect(publishProblems(form(section("a", [yesNo("tested")])), [version1, version2])).toEqual([]);
  });

  it("counts layout fields' types as well", () => {
    expect(publishProblems(form(section("a", [text("about")])), [version1])).toEqual([{ key: "about", code: "key_type_changed" }]);
  });
});

describe("formSchemaProblems", () => {
  it("is publishProblems for a first Version", () => {
    const broken = form(section("a", [text("x", { visible_if: { field: "x", op: "not_empty" } }), text("x")]));
    expect(formSchemaProblems(broken)).toEqual(publishProblems(broken, []));
    expect(formSchemaProblems(broken).length).toBeGreaterThan(0);
  });
});
