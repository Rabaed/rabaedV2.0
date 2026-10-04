import { describe, expect, it } from "vitest";
import { formatFormValue } from "./form-display.ts";
import { formSchema, validateAnswers, type FormSchema, type ValidationContext } from "./form.ts";
import { publishProblems } from "./form-publish.ts";

// Seam 3: the link question, `work_item_ref` (RP-293, spec RP-289; form-engine.md
// part 2b). Its answer is a list of Work Item ids, any length, no duplicates. A
// chosen item the reader can't see comes back as its Document Number and Subject
// (ADR 0012), and saves again as it came.

const label = (en: string) => ({ en, ar: `${en} ع` });
const classification = {
  key: "classification",
  title: label("Classification"),
  fields: [
    { key: "trade", type: "trade", label: label("Trade") },
    { key: "location", type: "location", label: label("Location") },
    { key: "scopes", type: "scopes", label: label("Scopes") },
  ],
};
const build = (fields: unknown[]): FormSchema =>
  formSchema.parse({ sections: [{ key: "main", title: label("Main"), fields }, classification] });
const related = (extra: Record<string, unknown> = {}) => ({ key: "related", type: "work_item_ref", label: label("Related submittals"), ...extra });

const trade = { trade: "00000000-0000-4000-8000-000000000001", location: "00000000-0000-4000-8000-000000000002" };
const a = "00000000-0000-4000-8000-0000000000a1";
const b = "00000000-0000-4000-8000-0000000000b2";
const hidden = { documentNumber: "RGT-MAR-0007", subject: "Cable trays" };

const errorsOf = (schema: FormSchema, answers: Record<string, unknown>, mode: "draft" | "complete" = "draft", context: ValidationContext = {}) => {
  const result = validateAnswers(schema, { ...trade, ...answers }, mode, context);
  return result.ok ? [] : result.errors;
};

describe("the work_item_ref field's settings", () => {
  it("takes the usual field settings and nothing about Types or outcomes", () => {
    expect(build([related()]).sections[0]!.fields[0]).toMatchObject({ type: "work_item_ref", required: false });
    expect(build([related({ required: true })]).sections[0]!.fields[0]).toMatchObject({ required: true });
  });

  it("passes the publish checks like any field", () => {
    const schema = formSchema.parse({
      sections: [
        { key: "main", title: label("Main"), fields: [related({ required: { field: "relies", op: "=", value: true } }), { key: "relies", type: "yes_no", label: label("Relies") }] },
        { ...classification, fields: [...classification.fields] },
      ],
    });
    expect(publishProblems(schema)).toEqual([]);
  });
});

describe("a work_item_ref answer", () => {
  const schema = build([related()]);

  it("takes a list of item ids, of any length, and stores it as given", () => {
    const result = validateAnswers(schema, { ...trade, related: [a, b] }, "complete");
    expect(result).toEqual({ ok: true, answers: { ...trade, related: [a, b] } });
    expect(errorsOf(schema, { related: [a] })).toEqual([]);
    expect(errorsOf(schema, { related: [] })).toEqual([]);
  });

  it("refuses anything but a list of ids, and the same item twice", () => {
    for (const value of [a, [a, a], ["not-an-id"], [42], [{ id: a }], { [a]: true }]) {
      expect(errorsOf(schema, { related: value })).toEqual([{ key: "related", code: "wrong_type" }]);
    }
  });

  it("takes only the items the filler could have found (linkable), like an unknown option otherwise", () => {
    const linkable = new Set([a]);
    expect(errorsOf(schema, { related: [a] }, "draft", { linkable })).toEqual([]);
    expect(errorsOf(schema, { related: [a, b] }, "draft", { linkable })).toEqual([{ key: "related", code: "unknown_option" }]);
  });

  it("saves again a chosen item the filler can't see, as it came: number and Subject, never checked as an id", () => {
    const result = validateAnswers(schema, { ...trade, related: [hidden, a] }, "draft", { linkable: new Set([a]) });
    expect(result).toEqual({ ok: true, answers: { ...trade, related: [hidden, a] } });
    expect(errorsOf(schema, { related: [hidden, hidden] })).toEqual([{ key: "related", code: "wrong_type" }]);
    expect(errorsOf(schema, { related: [{ ...hidden, id: a }] })).toEqual([{ key: "related", code: "wrong_type" }]);
  });
});

describe("a required work_item_ref", () => {
  const schema = build([related({ required: true })]);

  it("needs at least one item to leave Draft, and none in a Draft", () => {
    expect(errorsOf(schema, {}, "complete")).toEqual([{ key: "related", code: "required" }]);
    expect(errorsOf(schema, { related: [] }, "complete")).toEqual([{ key: "related", code: "required" }]);
    expect(errorsOf(schema, { related: [a] }, "complete")).toEqual([]);
    expect(errorsOf(schema, { related: [hidden] }, "complete")).toEqual([]);
    expect(errorsOf(schema, {}, "draft")).toEqual([]);
  });
});

describe("conditions", () => {
  const schema = build([
    { key: "relies", type: "yes_no", label: label("Relies on other submittals") },
    related({ required: true, visible_if: { field: "relies", op: "=", value: true } }),
    { key: "why", type: "text", label: label("Why"), visible_if: { field: "related", op: "not_empty" } },
  ]);

  it("clears the answer of a hidden link question, and doesn't require it", () => {
    const result = validateAnswers(schema, { ...trade, relies: false, related: [a] }, "complete");
    expect(result).toEqual({ ok: true, answers: { ...trade, relies: false } });
  });

  it("lets a rule read whether items were chosen", () => {
    expect(errorsOf(schema, { relies: true, related: [a], why: "Same trays" }, "complete")).toEqual([]);
    const result = validateAnswers(schema, { ...trade, relies: true, related: [], why: "Same trays" }, "draft");
    expect(result).toEqual({ ok: true, answers: { ...trade, relies: true } });
  });
});

describe("formatFormValue", () => {
  const field = build([related()]).sections[0]!.fields[0]! as Parameters<typeof formatFormValue>[0];

  it("reads each chosen item as its Document Number and Subject, never an id", () => {
    const targets = { [a]: { documentNumber: "RGT-MAR-0003", subject: "Copper cables" } };
    expect(formatFormValue(field, [a, hidden], "en", undefined, [], targets)).toBe("RGT-MAR-0003 Copper cables, RGT-MAR-0007 Cable trays");
    expect(formatFormValue(field, [b], "en", undefined, [], targets)).toBe("");
  });
});
