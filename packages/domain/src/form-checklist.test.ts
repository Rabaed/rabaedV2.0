import { describe, expect, it } from "vitest";
import { checklistSummaryText, formatFormValue } from "./form-display.ts";
import { publishProblems } from "./form-publish.ts";
import {
  answerFields,
  checklistItemFilesKey,
  checklistSummary,
  formSchema,
  isNegativeAnswer,
  validateAnswers,
  type ChecklistField,
  type FormSchema,
} from "./form.ts";

// The `checklist` field (RP-285, spec RP-278; form-engine.md §3): inspections
// recorded item by item. Each item has an answer set, and a comment and a photo
// that are off, optional or required on a negative answer. Answers are stored
// per item (answer, comment); photos are Documents tied to the field and item.

const label = (en: string) => ({ en, ar: en });
const item = (key: string, extra: Record<string, unknown> = {}) => ({ key, text: label(`Check ${key}`), ...extra });

const rebar = item("rebar_cover", { answers: "pass_fail_na", comment: "required_on_negative", photo: "required_on_negative" });
const formwork = item("formwork", { answers: "pass_fail_na", comment: "optional" });
const permit = item("permit_on_site", { answers: "yes_no_na", comment: "off" });
const cleaning = item("cleaning", { answers: "pass_fail_na", photo: "optional" });

const checklist = { key: "pour_check", type: "checklist", label: label("Pour check"), items: [rebar, formwork, permit, cleaning] };

const build = (fields: unknown[]): FormSchema =>
  formSchema.parse({
    sections: [
      { key: "main", title: label("Main"), fields },
      {
        key: "classification",
        title: label("Classification"),
        fields: [
          { key: "trade", type: "trade", label: label("Trade"), required: true },
          { key: "location", type: "location", label: label("Location"), required: true },
          { key: "scopes", type: "scopes", label: label("Scopes") },
        ],
      },
    ],
  });

const base = { trade: "0199a3b0-0000-7000-8000-000000000001", location: "0199a3b0-0000-7000-8000-000000000002" };
const schema = build([checklist]);
const field = answerFields(schema).find((f) => f.key === "pour_check") as ChecklistField;
const validate = (pour_check: unknown, mode: "draft" | "complete" = "complete", files: Record<string, number> = {}, s = schema) =>
  validateAnswers(s, { ...base, ...(pour_check === undefined ? {} : { pour_check }) }, mode, { files });
const errorsOf = (result: ReturnType<typeof validate>) => (result.ok ? [] : result.errors);

describe("a checklist's schema", () => {
  it("has items with a key, text in both languages, an answer set and comment and photo rules", () => {
    expect(field.items[0]).toMatchObject({ key: "rebar_cover", answers: "pass_fail_na", comment: "required_on_negative", photo: "required_on_negative" });
  });

  it("defaults an item to Pass / Fail / N/A, an optional comment and no photo", () => {
    const bare = build([{ key: "c", type: "checklist", label: label("C"), items: [item("a")] }]);
    expect((answerFields(bare).find((f) => f.key === "c") as ChecklistField).items[0]).toMatchObject({
      answers: "pass_fail_na",
      comment: "optional",
      photo: "off",
    });
  });

  it("refuses no items, repeated item keys and an unknown answer set or rule", () => {
    expect(() => build([{ ...checklist, items: [] }])).toThrow();
    expect(() => build([{ ...checklist, items: [item("a"), item("a")] }])).toThrow();
    expect(() => build([{ ...checklist, items: [item("a", { answers: "maybe" })] }])).toThrow();
    expect(() => build([{ ...checklist, items: [item("a", { photo: "always" })] }])).toThrow();
  });

  it("can't be read by a condition, like a file field", () => {
    const reading = build([checklist, { key: "note", type: "text", label: label("Note"), visible_if: { field: "pour_check", op: "not_empty" } }]);
    expect(publishProblems(reading).map((p) => p.code)).toContain("unknown_reference");
  });
});

describe("a checklist's answers", () => {
  it("are an answer, and a comment, for each item answered", () => {
    const answers = { rebar_cover: { answer: "pass" }, formwork: { answer: "fail", comment: "Gap at the corner" }, permit_on_site: { answer: "na" } };
    expect(validate(answers)).toEqual({ ok: true, answers: { ...base, pour_check: answers } });
  });

  it("take the answers of the item's own set: Yes / No / N/A or Pass / Fail / N/A", () => {
    expect(errorsOf(validate({ permit_on_site: { answer: "pass" } }, "draft"))).toEqual([
      { key: "pour_check", code: "unknown_option", item: "permit_on_site" },
    ]);
    expect(errorsOf(validate({ rebar_cover: { answer: "yes" } }, "draft"))).toEqual([
      { key: "pour_check", code: "unknown_option", item: "rebar_cover" },
    ]);
    expect(validate({ permit_on_site: { answer: "no" }, formwork: { answer: "fail" } }, "draft").ok).toBe(true);
  });

  it("refuse an item the checklist doesn't have, and answers that aren't objects", () => {
    expect(errorsOf(validate({ welding: { answer: "pass" } }, "draft"))).toEqual([{ key: "pour_check", code: "unknown_field", item: "welding" }]);
    expect(errorsOf(validate("pass", "draft"))).toEqual([{ key: "pour_check", code: "wrong_type" }]);
    expect(errorsOf(validate([], "draft"))).toEqual([{ key: "pour_check", code: "wrong_type" }]);
    expect(errorsOf(validate({ formwork: "pass" }, "draft"))).toEqual([{ key: "pour_check", code: "wrong_type", item: "formwork" }]);
    expect(errorsOf(validate({ formwork: { answer: 1 } }, "draft"))).toEqual([{ key: "pour_check", code: "wrong_type", item: "formwork" }]);
  });

  it("take a comment only where the item has comments, at most 1000 characters", () => {
    expect(errorsOf(validate({ permit_on_site: { answer: "yes", comment: "Seen" } }, "draft"))).toEqual([
      { key: "pour_check", code: "wrong_type", item: "permit_on_site" },
    ]);
    expect(errorsOf(validate({ formwork: { answer: "pass", comment: "x".repeat(1001) } }, "draft"))).toEqual([
      { key: "pour_check", code: "too_long", item: "formwork" },
    ]);
    expect(errorsOf(validate({ formwork: { answer: "pass", comment: 5 } }, "draft"))).toEqual([
      { key: "pour_check", code: "wrong_type", item: "formwork" },
    ]);
  });

  it("drop an item with nothing in it, and a blank comment", () => {
    expect(validate({ formwork: { comment: "  " }, cleaning: {}, permit_on_site: { answer: "yes" } }, "draft")).toEqual({
      ok: true,
      answers: { ...base, pour_check: { permit_on_site: { answer: "yes" } } },
    });
    expect(validate({ formwork: {} }, "draft")).toEqual({ ok: true, answers: base });
  });

  it("keep a comment typed before the answer, in a Draft", () => {
    expect(validate({ formwork: { comment: "Check again" } }, "draft")).toEqual({
      ok: true,
      answers: { ...base, pour_check: { formwork: { comment: "Check again" } } },
    });
  });

  it("are cleared with the field when it is hidden", () => {
    const hidden = build([
      { key: "go", type: "yes_no", label: label("Go"), required: false },
      { ...checklist, visible_if: { field: "go", op: "=", value: true } },
    ]);
    expect(validateAnswers(hidden, { ...base, go: false, pour_check: { formwork: { answer: "fail" } } }, "complete")).toEqual({
      ok: true,
      answers: { ...base, go: false },
    });
  });
});

describe("negative answers", () => {
  it("are No and Fail, and no other", () => {
    expect(["no", "fail"].every(isNegativeAnswer)).toBe(true);
    expect(["yes", "pass", "na"].some(isNegativeAnswer)).toBe(false);
  });

  it("without the comment the item requires block leaving Draft, per item", () => {
    const answers = { rebar_cover: { answer: "fail" }, formwork: { answer: "fail" }, permit_on_site: { answer: "no" } };
    expect(errorsOf(validate(answers, "complete", { "pour_check.rebar_cover": 1 }))).toEqual([
      { key: "pour_check", code: "comment_required", item: "rebar_cover" },
    ]);
  });

  it("without the photo the item requires block leaving Draft, per item", () => {
    expect(errorsOf(validate({ rebar_cover: { answer: "fail", comment: "Cover 15 mm" } }))).toEqual([
      { key: "pour_check", code: "photo_required", item: "rebar_cover" },
    ]);
    expect(validate({ rebar_cover: { answer: "fail", comment: "Cover 15 mm" } }, "complete", { "pour_check.rebar_cover": 1 }).ok).toBe(true);
  });

  it("each missing piece is its own error, item by item in the checklist's order", () => {
    expect(errorsOf(validate({ rebar_cover: { answer: "fail" }, formwork: { answer: "fail" } }))).toEqual([
      { key: "pour_check", code: "comment_required", item: "rebar_cover" },
      { key: "pour_check", code: "photo_required", item: "rebar_cover" },
    ]);
  });

  it("don't count a blank comment", () => {
    expect(errorsOf(validate({ rebar_cover: { answer: "fail", comment: "   " } }, "complete", { "pour_check.rebar_cover": 1 }))).toEqual([
      { key: "pour_check", code: "comment_required", item: "rebar_cover" },
    ]);
  });

  it("are free to save in a Draft, evidence or not", () => {
    expect(validate({ rebar_cover: { answer: "fail" } }, "draft").ok).toBe(true);
  });

  it("need nothing from a positive or N/A answer, and an optional item's evidence is never required", () => {
    expect(validate({ rebar_cover: { answer: "pass" }, formwork: { answer: "fail" }, cleaning: { answer: "fail" } }).ok).toBe(true);
    expect(validate({ rebar_cover: { answer: "na" } }).ok).toBe(true);
  });

  it("need no photo counted when the answer is changed to a positive one", () => {
    expect(validate({ rebar_cover: { answer: "pass" } }, "complete", {}).ok).toBe(true);
  });
});

describe("required", () => {
  const needed = build([{ ...checklist, required: true }]);

  it("asks every item for an answer when the item leaves Draft", () => {
    expect(errorsOf(validate({ rebar_cover: { answer: "pass" } }, "complete", {}, needed))).toEqual([
      { key: "pour_check", code: "required", item: "formwork" },
      { key: "pour_check", code: "required", item: "permit_on_site" },
      { key: "pour_check", code: "required", item: "cleaning" },
    ]);
  });

  it("asks nothing in a Draft", () => {
    expect(validate(undefined, "draft", {}, needed).ok).toBe(true);
  });

  it("is met by an answer to every item, N/A included", () => {
    const all = { rebar_cover: { answer: "na" }, formwork: { answer: "pass" }, permit_on_site: { answer: "yes" }, cleaning: { answer: "na" } };
    expect(validate(all, "complete", {}, needed).ok).toBe(true);
  });

  it("is not asked of a checklist that isn't required: items may be left", () => {
    expect(validate({ formwork: { answer: "pass" } }).ok).toBe(true);
    expect(validate(undefined).ok).toBe(true);
  });
});

describe("the summary", () => {
  const answers = {
    rebar_cover: { answer: "pass" },
    formwork: { answer: "fail", comment: "Gap" },
    permit_on_site: { answer: "yes" },
    cleaning: { answer: "na" },
  };

  it("counts each answer, and the items not answered yet", () => {
    expect(checklistSummary(field, answers)).toEqual({
      counts: [
        { answer: "pass", count: 1 },
        { answer: "fail", count: 1 },
        { answer: "yes", count: 1 },
        { answer: "no", count: 0 },
        { answer: "na", count: 1 },
      ],
      unanswered: 0,
    });
    expect(checklistSummary(field, { formwork: { answer: "pass" } }).unanswered).toBe(3);
    expect(checklistSummary(field, undefined)).toMatchObject({ unanswered: 4 });
  });

  it("is derived, never stored: the validator keeps no counts", () => {
    expect(validate(answers)).toEqual({ ok: true, answers: { ...base, pour_check: answers } });
  });

  it("reads like 18 Pass / 2 Fail / 1 N/A, in the viewer's language, with Latin digits", () => {
    const big = build([
      {
        key: "c",
        type: "checklist",
        label: label("C"),
        items: Array.from({ length: 21 }, (_, i) => item(`i${i}`)),
      },
    ]);
    const bigField = answerFields(big).find((f) => f.key === "c") as ChecklistField;
    const value = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`i${i}`, { answer: i < 18 ? "pass" : i < 20 ? "fail" : "na" }]),
    );
    expect(checklistSummaryText(checklistSummary(bigField, value), "en")).toBe("18 Pass / 2 Fail / 1 N/A");
    expect(checklistSummaryText(checklistSummary(bigField, value), "ar")).toBe("18 مقبول / 2 مرفوض / 1 لا ينطبق");
    expect(formatFormValue(bigField, value, "en")).toBe("18 Pass / 2 Fail / 1 N/A");
  });

  it("leaves out answers nobody gave, and says how many items are not answered", () => {
    expect(checklistSummaryText(checklistSummary(field, answers), "en")).toBe("1 Pass / 1 Fail / 1 Yes / 1 N/A");
    expect(checklistSummaryText(checklistSummary(field, { formwork: { answer: "pass" } }), "en")).toBe("1 Pass / 3 not answered");
    expect(checklistSummaryText(checklistSummary(field, undefined), "en")).toBe("Not answered");
    expect(checklistSummaryText(checklistSummary(field, undefined), "ar")).toBe("لم تتم الإجابة");
  });
});

describe("the files of an item", () => {
  it("are counted by the field's key and the item's, which can't clash with a field's own", () => {
    expect(checklistItemFilesKey("pour_check", "rebar_cover")).toBe("pour_check.rebar_cover");
  });
});
