import { describe, expect, it } from "vitest";
import { formSchema, type FormSchema } from "./form.ts";
import { publishProblems } from "./form-publish.ts";
import { changedOutside, editableSections, sectionsFilledBy, type WorkflowStepHolder } from "./form-sections.ts";

// Seam 3: who fills which Form Section (form-engine.md §4, "Settled 2026-10-05
// (part 3)"; RP-301). A Form Section names the Workflow Steps where it is edited
// (`editable_at`); publishing refuses a Step the Type's Workflow doesn't have,
// and a section whose Steps are held by two different Participant roles.

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

const form = (...sections: unknown[]): FormSchema => formSchema.parse({ sections: [classification, ...sections] });
const section = (key: string, fields: unknown[], extra: object = {}) => ({ key, title: label(key), fields, ...extra });
const text = (key: string, extra: object = {}) => ({ key, type: "text", label: label(key), ...extra });

/** The MAR's Workflow: the Contractor's Draft and review, the Consultant's review, then the end. */
const mar: WorkflowStepHolder[] = [
  { key: "draft", role: "contractor", draft: true },
  { key: "internal_review", role: "contractor", draft: false },
  { key: "consultant_review", role: "consultant", draft: false },
  { key: "approved", role: null, draft: false },
  { key: "revise_resubmit", role: null, draft: false },
];

describe("editable_at on a Form Section", () => {
  it("is a list of Step keys, and may be left out", () => {
    const schema = form(section("verification", [text("note")], { editable_at: ["consultant_review"] }), section("material", [text("model")]));
    expect(schema.sections[1]!.editable_at).toEqual(["consultant_review"]);
    expect(schema.sections[2]!.editable_at).toBeUndefined();
    expect(formSchema.safeParse({ sections: [section("s", [text("a")], { editable_at: [] })] }).success).toBe(false);
    expect(formSchema.safeParse({ sections: [section("s", [text("a")], { editable_at: ["Not a key"] })] }).success).toBe(false);
  });
});

describe("publishProblems: editable_at against the Type's Workflow", () => {
  it("accepts Steps the Workflow has, held by one Participant role", () => {
    const schema = form(
      section("verification", [text("note")], { editable_at: ["consultant_review"] }),
      section("material", [text("model")], { editable_at: ["draft", "internal_review"] }),
      section("other", [text("remarks")]),
    );
    expect(publishProblems(schema, [], { workflows: [mar] })).toEqual([]);
  });

  it("refuses a Step key the Workflow doesn't have, naming the section", () => {
    const schema = form(section("verification", [text("note")], { editable_at: ["consultant_review", "site_visit"] }));
    expect(publishProblems(schema, [], { workflows: [mar] })).toEqual([{ key: "verification", code: "unknown_step" }]);
  });

  it("refuses Steps held by two different Participant roles in one section", () => {
    const schema = form(section("verification", [text("note")], { editable_at: ["internal_review", "consultant_review"] }));
    expect(publishProblems(schema, [], { workflows: [mar] })).toEqual([{ key: "verification", code: "mixed_roles" }]);
  });

  it("checks against every Workflow of the Types that use the Form, naming each section once", () => {
    const shorter = mar.filter((s) => s.key !== "internal_review");
    const schema = form(section("material", [text("model")], { editable_at: ["draft", "internal_review"] }));
    expect(publishProblems(schema, [], { workflows: [mar, shorter, shorter] })).toEqual([{ key: "material", code: "unknown_step" }]);
  });

  it("isn't checked without the Workflows", () => {
    const schema = form(section("verification", [text("note")], { editable_at: ["site_visit"] }));
    expect(publishProblems(schema)).toEqual([]);
  });
});

describe("editableSections: what the acting Member may change now", () => {
  const schema = form(
    section("material", [text("model")]),
    section("review", [text("review_note")], { editable_at: ["internal_review"] }),
    section("verification", [text("note")], { editable_at: ["consultant_review"] }),
  );

  it("is the raiser's sections at the Draft, and those naming it", () => {
    expect([...editableSections(schema, mar, { step: "draft", canSave: true })]).toEqual(["classification", "material"]);
  });

  it("follows the Step: a section naming only a later raiser's Step opens there", () => {
    expect([...editableSections(schema, mar, { step: "internal_review", canSave: true })]).toEqual(["classification", "material", "review"]);
  });

  it("is none when they may not save at all", () => {
    expect([...editableSections(schema, mar, { step: "draft", canSave: false })]).toEqual([]);
  });
});

describe("sectionsFilledBy: sections another Participant fills", () => {
  it("names the role of each section whose Steps aren't the raiser's", () => {
    const schema = form(
      section("material", [text("model")], { editable_at: ["internal_review"] }),
      section("verification", [text("note")], { editable_at: ["consultant_review"] }),
    );
    expect(sectionsFilledBy(schema, mar)).toEqual({ verification: "consultant" });
  });
});

describe("changedOutside: answers changed in sections that aren't editable", () => {
  const schema = form(
    section("material", [text("model"), { key: "colours", type: "multi_select", label: label("Colours"), options: ["red", "blue"].map((value) => ({ value, label: label(value) })) }]),
    section("verification", [
      text("note"),
      { key: "checked", type: "yes_no", label: label("Checked") },
      { key: "twice", type: "calculated", label: label("Twice"), formula: "qty + qty" },
      { key: "qty", type: "number", label: label("Quantity") },
    ], { editable_at: ["consultant_review"] }),
  );
  const editable = new Set(["classification", "material"]);

  it("is none when only editable sections change", () => {
    expect(changedOutside(schema, editable, { model: "A" }, { model: "B", colours: ["red"] })).toEqual([]);
  });

  it("names a section given an answer, or losing one", () => {
    expect(changedOutside(schema, editable, {}, { model: "B", note: "ok" })).toEqual(["verification"]);
    expect(changedOutside(schema, editable, { checked: false }, {})).toEqual(["verification"]);
    expect(changedOutside(schema, editable, { checked: false }, { checked: true })).toEqual(["verification"]);
  });

  it("is none when a locked section's answers come back as they were", () => {
    const held = { note: "ok", checked: true, qty: 2, twice: 4 };
    expect(changedOutside(schema, editable, held, { ...held, model: "B" })).toEqual([]);
  });

  it("doesn't count a calculated result, which follows the answers it reads", () => {
    expect(changedOutside(schema, editable, { twice: 4 }, {})).toEqual([]);
  });

  it("reads an empty answer as none", () => {
    expect(changedOutside(schema, editable, {}, { note: "", checked: null })).toEqual([]);
  });

  it("reads a list's options in any order", () => {
    const locked = new Set(["classification", "verification"]);
    expect(changedOutside(schema, locked, { colours: ["red", "blue"] }, { colours: ["blue", "red"] })).toEqual([]);
  });
});
