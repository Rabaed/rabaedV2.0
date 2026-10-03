import { describe, expect, it } from "vitest";
import { formatFormValue } from "./form-display.ts";
import { answerFields, formSchema, validateAnswers, type FormSchema } from "./form.ts";
import { publishProblems } from "./form-publish.ts";

// Named `attachments` fields (RP-281, spec RP-278): a Form asks for specific
// files, such as a required Datasheet. The files are Documents tied to the field
// by its key, never answers; the validator counts the confirmed ones it is given.

const label = (en: string) => ({ en, ar: en });

const datasheet = {
  key: "datasheet",
  type: "attachments",
  label: label("Datasheet (PDF)"),
  required: true,
  contentTypes: ["application/pdf"],
};
const photos = { key: "sample_photos", type: "attachments", label: label("Sample photos"), minFiles: 2, maxFiles: 4 };

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

const trade = "0199a3b0-0000-7000-8000-000000000001";
const base = { trade, location: "0199a3b0-0000-7000-8000-000000000002" };
const schema = build([datasheet, photos]);

describe("an attachments field's schema", () => {
  it("takes allowed content types and a minimum and maximum of files", () => {
    const field = answerFields(schema).find((f) => f.key === "datasheet");
    expect(field).toMatchObject({ type: "attachments", required: true, contentTypes: ["application/pdf"] });
    expect(answerFields(schema).find((f) => f.key === "sample_photos")).toMatchObject({ minFiles: 2, maxFiles: 4 });
  });

  it("refuses a minimum above the maximum, a content type that isn't one, and no content types at all", () => {
    expect(() => build([{ ...photos, minFiles: 5, maxFiles: 4 }])).toThrow();
    expect(() => build([{ ...datasheet, contentTypes: ["pdf"] }])).toThrow();
    expect(() => build([{ ...datasheet, contentTypes: [] }])).toThrow();
  });
});

describe("an attachments field's answers", () => {
  it("are never stored: the files are Documents", () => {
    expect(validateAnswers(schema, { ...base, datasheet: "datasheet.pdf" }, "draft")).toEqual({
      ok: false,
      errors: [{ key: "datasheet", code: "wrong_type" }],
    });
    expect(validateAnswers(schema, base, "draft")).toEqual({ ok: true, answers: base });
  });

  it("don't need files in a draft", () => {
    expect(validateAnswers(schema, base, "draft", { files: {} }).ok).toBe(true);
  });
});

describe("leaving Draft", () => {
  const complete = (files: Record<string, number> | undefined) => validateAnswers(schema, base, "complete", files ? { files } : {});

  it("needs a confirmed file in a required field", () => {
    expect(complete({ sample_photos: 2 })).toEqual({ ok: false, errors: [{ key: "datasheet", code: "required" }] });
    expect(complete({ datasheet: 1, sample_photos: 2 })).toEqual({ ok: true, answers: base });
  });

  it("needs at least the minimum of files, in an optional field that has any", () => {
    expect(complete({ datasheet: 1, sample_photos: 1 })).toEqual({ ok: false, errors: [{ key: "sample_photos", code: "too_few_files" }] });
  });

  it("counts no files when none are given", () => {
    expect(complete(undefined)).toEqual({
      ok: false,
      errors: [
        { key: "datasheet", code: "required" },
        { key: "sample_photos", code: "too_few_files" },
      ],
    });
  });

  it("doesn't ask for the files of a field that isn't shown", () => {
    const conditional = build([
      { key: "imported", type: "yes_no", label: label("Imported") },
      { ...datasheet, key: "certificate", visible_if: { field: "imported", op: "=", value: true } },
    ]);
    expect(validateAnswers(conditional, { ...base, imported: false }, "complete", { files: {} }).ok).toBe(true);
    expect(validateAnswers(conditional, { ...base, imported: true }, "complete", { files: {} })).toEqual({
      ok: false,
      errors: [{ key: "certificate", code: "required" }],
    });
  });
});

describe("publishing an attachments field", () => {
  it("is accepted", () => {
    expect(publishProblems(schema)).toEqual([]);
  });

  it("can't be read by a condition: it holds no answer", () => {
    const reads = build([datasheet, { key: "note", type: "text", label: label("Note"), visible_if: { field: "datasheet", op: "not_empty" } }]);
    expect(publishProblems(reads)).toContainEqual(expect.objectContaining({ key: "note" }));
  });
});

describe("reading an attachments field", () => {
  it("has no answer to show: the page lists its files", () => {
    expect(formatFormValue(answerFields(schema)[0]!, undefined, "en")).toBe("");
  });
});
