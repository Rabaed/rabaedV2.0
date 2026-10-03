import { describe, expect, it } from "vitest";
import { photoContentTypes } from "./document.ts";
import { formatFormValue } from "./form-display.ts";
import { answerFields, fileFieldContentTypes, formSchema, isFileField, validateAnswers, type FormSchema } from "./form.ts";
import { publishProblems } from "./form-publish.ts";

// The `photos` field (RP-284, spec RP-278): site staff take photos straight into
// the Form. It is a named file field (RP-281) that takes images only; its files
// are Documents, never answers, counted when the item leaves Draft.

const label = (en: string) => ({ en, ar: en });

const samplePhotos = { key: "sample_photos", type: "photos", label: label("Sample photos"), required: true, maxFiles: 4 };
const sitePhotos = { key: "site_photos", type: "photos", label: label("Site photos"), minFiles: 2 };

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
const schema = build([samplePhotos, sitePhotos]);
const field = (key: string) => answerFields(schema).find((f) => f.key === key)!;

describe("a photos field's schema", () => {
  it("takes a minimum and maximum of photos", () => {
    expect(field("sample_photos")).toMatchObject({ type: "photos", required: true, maxFiles: 4 });
    expect(field("site_photos")).toMatchObject({ minFiles: 2 });
  });

  it("refuses a minimum above the maximum", () => {
    expect(() => build([{ ...sitePhotos, minFiles: 5, maxFiles: 4 }])).toThrow();
  });

  it("takes images only, whatever its Form says", () => {
    expect(field("sample_photos")).not.toHaveProperty("contentTypes");
    expect(fileFieldContentTypes(field("sample_photos") as never)).toEqual(photoContentTypes);
    expect(photoContentTypes.every((t) => t.startsWith("image/"))).toBe(true);
  });

  it("is a file field, as an attachments field is", () => {
    expect(isFileField(field("sample_photos"))).toBe(true);
    expect(isFileField(build([{ key: "d", type: "attachments", label: label("D") }]).sections[0]!.fields[0]!)).toBe(true);
    expect(isFileField(build([{ key: "t", type: "text", label: label("T") }]).sections[0]!.fields[0]!)).toBe(false);
  });
});

describe("a photos field's answers", () => {
  it("are never stored: the photos are Documents", () => {
    expect(validateAnswers(schema, { ...base, sample_photos: "photo.jpg" }, "draft")).toEqual({
      ok: false,
      errors: [{ key: "sample_photos", code: "wrong_type" }],
    });
    expect(validateAnswers(schema, base, "draft")).toEqual({ ok: true, answers: base });
  });
});

describe("leaving Draft", () => {
  const complete = (files: Record<string, number>) => validateAnswers(schema, base, "complete", { files });

  it("needs a confirmed photo in a required field, and the minimum in any", () => {
    expect(complete({ site_photos: 2 })).toEqual({ ok: false, errors: [{ key: "sample_photos", code: "required" }] });
    expect(complete({ sample_photos: 1, site_photos: 1 })).toEqual({ ok: false, errors: [{ key: "site_photos", code: "too_few_files" }] });
    expect(complete({ sample_photos: 1, site_photos: 2 })).toEqual({ ok: true, answers: base });
  });
});

describe("publishing a photos field", () => {
  it("is accepted, and can't be read by a condition: it holds no answer", () => {
    expect(publishProblems(schema)).toEqual([]);
    const reads = build([samplePhotos, { key: "note", type: "text", label: label("Note"), visible_if: { field: "sample_photos", op: "not_empty" } }]);
    expect(publishProblems(reads)).toContainEqual(expect.objectContaining({ key: "note" }));
  });
});

describe("reading a photos field", () => {
  it("has no answer to show: the page shows its photos", () => {
    expect(formatFormValue(field("sample_photos"), undefined, "en")).toBe("");
  });
});
