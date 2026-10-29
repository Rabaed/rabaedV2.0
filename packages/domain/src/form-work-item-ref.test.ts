import { describe, expect, it } from "vitest";
import { formatFormValue } from "./form-display.ts";
import { formSchema, linkAccepts, requiredByProject, validateAnswers, type FormSchema, type ValidationContext } from "./form.ts";
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
  it("takes the usual field settings, and no limit by Type or outcome unless it says `accepts`", () => {
    expect(build([related()]).sections[0]!.fields[0]).toMatchObject({ type: "work_item_ref", required: false });
    expect(build([related()]).sections[0]!.fields[0]).not.toHaveProperty("accepts");
    expect(build([related({ required: true })]).sections[0]!.fields[0]).toMatchObject({ required: true });
  });

  it("takes `accepts`: Modules, Work Item Types and/or outcomes, each at least one, no duplicates (RP-82, RP-1080)", () => {
    for (const accepts of [
      { outcomes: ["A", "B"] },
      { types: ["MAR"] },
      { types: ["MAR", "SAR"], outcomes: ["A"] },
      { outcomes: ["passed_with_comments"] },
      { modules: ["submittals"], outcomes: ["A", "B"] },
      { modules: ["submittals", "drawings"] },
    ]) {
      expect(build([related({ accepts })]).sections[0]!.fields[0]).toMatchObject({ accepts });
    }
    for (const accepts of [
      {},
      { types: [] },
      { outcomes: [] },
      { outcomes: ["A", "A"] },
      { types: ["MAR", "MAR"] },
      { types: ["mar"] },
      { outcomes: ["1A"] },
      { outcomes: ["cancelled"] },
      { outcomes: ["A"], stages: ["passed"] },
      { modules: [] },
      { modules: ["submittals", "submittals"] },
      { modules: ["Submittals"] },
      { modules: ["made_up"] },
    ]) {
      expect(formSchema.safeParse({ sections: [{ key: "main", title: label("Main"), fields: [related({ accepts })] }, classification] }).success).toBe(false);
    }
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

  describe("with `accepts`, checked against the Types and their outcomes when publishing passes them", () => {
    const types = new Map([
      ["MAR", new Set(["A", "B", "C", "D"])],
      ["WIR", new Set(["passed", "passed_with_comments", "failed"])],
    ]);
    const problemsOf = (accepts: unknown) => publishProblems(build([related({ accepts })]), [], { types });

    it("passes Types that exist, and outcomes one of them has", () => {
      expect(problemsOf({ outcomes: ["A", "B"] })).toEqual([]);
      expect(problemsOf({ types: ["MAR", "WIR"] })).toEqual([]);
      expect(problemsOf({ types: ["WIR"], outcomes: ["passed"] })).toEqual([]);
      expect(problemsOf({ modules: ["submittals"], outcomes: ["A", "B"] })).toEqual([]);
    });

    it("refuses a Type that doesn't exist, and an outcome no Type it names (or none at all) has", () => {
      expect(problemsOf({ types: ["NCR"] })).toEqual([{ key: "related", code: "unknown_link_type" }]);
      expect(problemsOf({ outcomes: ["E"] })).toEqual([{ key: "related", code: "unknown_link_outcome" }]);
      expect(problemsOf({ types: ["WIR"], outcomes: ["A"] })).toEqual([{ key: "related", code: "unknown_link_outcome" }]);
    });

    it("isn't checked without the Types", () => {
      expect(publishProblems(build([related({ accepts: { types: ["NCR"], outcomes: ["E"] } })]))).toEqual([]);
    });
  });
});

describe("linkAccepts: whether a link question's `accepts` takes an item (RP-82)", () => {
  const closedA = { module: "submittals", type: "MAR", outcome: "A", closed: true };

  it("takes any item without `accepts`", () => {
    expect(linkAccepts(undefined, { module: "submittals", type: "MAR", outcome: null, closed: false })).toBe(true);
  });

  it("with outcomes, takes only a closed item with one of them", () => {
    const accepts = { outcomes: ["A", "B"] };
    expect(linkAccepts(accepts, closedA)).toBe(true);
    expect(linkAccepts(accepts, { module: "submittals", type: "SAR", outcome: "B", closed: true })).toBe(true);
    expect(linkAccepts(accepts, { module: "submittals", type: "MAR", outcome: "C", closed: true })).toBe(false);
    expect(linkAccepts(accepts, { module: "submittals", type: "MAR", outcome: null, closed: false })).toBe(false);
    expect(linkAccepts(accepts, { module: "submittals", type: "MAR", outcome: "A", closed: false })).toBe(false);
  });

  it("with Types, takes only an item of one of them, open or closed unless outcomes are named too", () => {
    expect(linkAccepts({ types: ["MAR"] }, { module: "submittals", type: "MAR", outcome: null, closed: false })).toBe(true);
    expect(linkAccepts({ types: ["MAR"] }, { module: "submittals", type: "DAR", outcome: "A", closed: true })).toBe(false);
    expect(linkAccepts({ types: ["MAR"], outcomes: ["A"] }, closedA)).toBe(true);
    expect(linkAccepts({ types: ["DAR"], outcomes: ["A"] }, closedA)).toBe(false);
  });

  // RP-1080: a WIR closes with Code A–D too (RP-673), so the WIR's Approved submittals names its Module.
  it("with Modules, takes only an item of a Type in one of them; outcomes narrow it as ever", () => {
    const closedWirA = { module: "inspections", type: "WIR", outcome: "A", closed: true };
    const accepts = { modules: ["submittals" as const], outcomes: ["A", "B"] };
    expect(linkAccepts(accepts, closedA)).toBe(true);
    expect(linkAccepts(accepts, closedWirA)).toBe(false);
    expect(linkAccepts(accepts, { ...closedA, outcome: "C" })).toBe(false);
    expect(linkAccepts({ modules: ["submittals"] }, { module: "submittals", type: "MAR", outcome: null, closed: false })).toBe(true);
    expect(linkAccepts({ modules: ["submittals"], types: ["DAR"] }, closedA)).toBe(false);
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

  it("takes only the items the filler could have found for that field (linkable), like an unknown option otherwise", () => {
    const linkable = { related: new Set([a]) };
    expect(errorsOf(schema, { related: [a] }, "draft", { linkable })).toEqual([]);
    expect(errorsOf(schema, { related: [a, b] }, "draft", { linkable })).toEqual([{ key: "related", code: "unknown_option" }]);
    // Another field's items are not this one's: each link question has its own (its `accepts`).
    expect(errorsOf(schema, { related: [a] }, "draft", { linkable: { other: new Set([a]) } })).toEqual([{ key: "related", code: "unknown_option" }]);
  });

  it("saves again a chosen item the filler can't see, as it came: number and Subject, never checked as an id", () => {
    const result = validateAnswers(schema, { ...trade, related: [hidden, a] }, "draft", { linkable: { related: new Set([a]) } });
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

describe("requiredByProject: a link question the Project makes required (RP-82)", () => {
  const schema = build([related(), { key: "notes", type: "text", label: label("Notes") }]);

  it("makes the named link questions required, and nothing else", () => {
    const required = requiredByProject(schema, ["related", "notes", "missing"]);
    expect(errorsOf(required, {}, "complete")).toEqual([{ key: "related", code: "required" }]);
    expect(errorsOf(required, { related: [a] }, "complete")).toEqual([]);
    expect(errorsOf(required, {}, "draft")).toEqual([]);
  });

  it("leaves the schema as it is with none, and never touches the one given", () => {
    expect(requiredByProject(schema, [])).toBe(schema);
    requiredByProject(schema, ["related"]);
    expect(errorsOf(schema, {}, "complete")).toEqual([]);
  });

  it("makes it always required, even where its own conditional rule wouldn't", () => {
    const conditional = build([{ key: "relies", type: "yes_no", label: label("Relies") }, related({ required: { field: "relies", op: "=", value: true } })]);
    const required = requiredByProject(conditional, ["related"]);
    expect(errorsOf(required, { relies: false }, "complete")).toEqual([{ key: "related", code: "required" }]);
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

  it("reads each chosen item as its Document Number (left to right) and Subject, never an id", () => {
    const targets = { [a]: { documentNumber: "RGT-MAR-0003", subject: "Copper cables" } };
    expect(formatFormValue(field, [a, hidden], "en", undefined, [], targets)).toBe("\u2066RGT-MAR-0003\u2069 Copper cables, \u2066RGT-MAR-0007\u2069 Cable trays");
    expect(formatFormValue(field, [b], "en", undefined, [], targets)).toBe("");
  });
});
