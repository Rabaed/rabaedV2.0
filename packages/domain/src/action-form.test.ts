import { describe, expect, it } from "vitest";
import { actionFormProblems, workflowActionFormProblems } from "./action-form.ts";
import { formSchema, validateAnswers, type FormSchema } from "./form.ts";

// Seam 3: Action Forms built from Form schemas (form-engine.md §4, part 3;
// workflow-engine.md publish check 7; RP-300). A Transition's Action Form is a
// Form schema, checked by the same publish checks and filled through the same
// validator, less what an Action Form can't hold: Built-in Fields, files, and
// answers naming people, Companies or other items (its answers go in the
// Transition event's payload, which every viewer of a shared event reads).

const label = (en: string) => ({ en, ar: en });
const schema = (...fields: unknown[]): FormSchema =>
  formSchema.parse({ sections: [{ key: "action", title: label("Action"), fields }] });
const reason = { key: "reason", type: "textarea", required: true, maxLength: 2000, label: label("Reason") };

describe("actionFormProblems", () => {
  it("takes a Form schema with no Built-in Fields", () => {
    expect(actionFormProblems(schema(reason))).toEqual([]);
  });

  it("runs the Form's publish checks", () => {
    expect(
      actionFormProblems(
        schema(reason, { key: "reason", type: "text", label: label("Again") }, {
          key: "note",
          type: "text",
          label: label("Note"),
          visible_if: { field: "missing", op: "=", value: true },
        }),
      ),
    ).toEqual([
      { key: "reason", code: "duplicate_key" },
      { key: "note", code: "unknown_reference" },
    ]);
  });

  it("refuses fields an Action Form can't hold", () => {
    const problems = actionFormProblems(
      schema(
        { key: "trade", type: "trade", label: label("Trade") },
        { key: "who", type: "member", label: label("Who") },
        { key: "company", type: "participant", label: label("Company") },
        { key: "related", type: "work_item_ref", label: label("Related") },
        { key: "files", type: "attachments", label: label("Files") },
        { key: "pictures", type: "photos", label: label("Pictures") },
      ),
    );
    expect(problems).toEqual(
      ["trade", "who", "company", "related", "files", "pictures"].map((key) => ({ key, code: "not_in_action_form" })),
    );
  });

  it("takes a checklist whose items ask no photos, and refuses one asking photos (RP-516: files are Documents)", () => {
    const checklist = (photo: string) => ({
      key: "checks",
      type: "checklist",
      label: label("Checks"),
      items: [
        { key: "sample", text: label("Sample checked"), answers: "yes_no_na" },
        { key: "matches", text: label("Matches specification"), photo },
      ],
    });
    expect(actionFormProblems(schema(checklist("off")))).toEqual([]);
    expect(actionFormProblems(schema(checklist("optional")))).toEqual([{ key: "checks", code: "not_in_action_form" }]);
    expect(actionFormProblems(schema(checklist("required_on_negative")))).toEqual([{ key: "checks", code: "not_in_action_form" }]);
  });

  it("refuses the keys the engine writes in the Transition's payload", () => {
    expect(
      actionFormProblems(
        schema(
          { key: "document_number", type: "text", label: label("Number") },
          { key: "outcome", type: "text", label: label("Outcome") },
          { key: "internal_note", type: "textarea", label: label("Note") },
        ),
      ),
    ).toEqual(["document_number", "outcome", "internal_note"].map((key) => ({ key, code: "reserved_key" })));
  });
});

describe("workflowActionFormProblems (publish check 7)", () => {
  it("passes a Workflow whose Transitions have valid Action Forms or none", () => {
    expect(
      workflowActionFormProblems([
        { key: "send_for_review", actionForm: null },
        { key: "return", actionForm: { sections: [{ key: "return", title: label("Return"), fields: [reason] }] } },
      ]),
    ).toEqual([]);
  });

  it("names the Transition of each problem, and refuses what isn't a Form schema at all", () => {
    expect(
      workflowActionFormProblems([
        { key: "return", actionForm: { sections: [] } },
        { key: "submit", actionForm: { sections: [{ key: "s", title: label("S"), fields: [{ key: "trade", type: "trade", label: label("T") }] }] } },
      ]),
    ).toEqual([
      { transition: "return", key: "sections", code: "invalid_schema" },
      { transition: "submit", key: "trade", code: "not_in_action_form" },
    ]);
  });
});

describe("filling an Action Form", () => {
  it("goes through the Form's validator: a Return without its reason is refused, unknown answers too", () => {
    const form = schema(reason);
    expect(validateAnswers(form, { reason: "   " }, "complete")).toEqual({ ok: false, errors: [{ key: "reason", code: "required" }] });
    expect(validateAnswers(form, { reason: "Wrong tray size", extra: "x" }, "complete")).toMatchObject({
      ok: false,
      errors: [{ key: "extra", code: "unknown_field" }],
    });
    expect(validateAnswers(form, { reason: "Wrong tray size" }, "complete")).toEqual({ ok: true, answers: { reason: "Wrong tray size" } });
  });

  // The database's backstop (app.action_form_fits) counts an answer missing as this does.
  it("counts null, an empty text or list as missing, and an empty object as an answer of the wrong type", () => {
    const form = schema(reason);
    for (const missing of [null, "", [], "  "]) {
      expect(validateAnswers(form, { reason: missing }, "complete"), JSON.stringify(missing)).toEqual({
        ok: false,
        errors: [{ key: "reason", code: "required" }],
      });
    }
    expect(validateAnswers(form, { reason: {} }, "complete")).toEqual({ ok: false, errors: [{ key: "reason", code: "wrong_type" }] });
  });
});
