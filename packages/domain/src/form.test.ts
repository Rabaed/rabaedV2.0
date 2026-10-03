import { describe, expect, it } from "vitest";
import { formSchema, validateAnswers, type FormSchema } from "./form.ts";

const label = (en: string) => ({ en, ar: en });

const schema: FormSchema = formSchema.parse({
  sections: [
    {
      key: "material",
      title: label("Material"),
      fields: [
        { key: "manufacturer", type: "text", label: label("Manufacturer"), required: true },
        { key: "model", type: "text", label: label("Model"), maxLength: 10 },
      ],
    },
    {
      key: "notes",
      title: label("Notes"),
      fields: [{ key: "description", type: "textarea", label: label("Description"), required: true }],
    },
  ],
});

describe("validateAnswers in draft mode (types only)", () => {
  it("accepts a draft with required fields still empty", () => {
    expect(validateAnswers(schema, {}, "draft")).toEqual({ ok: true, answers: {} });
    expect(validateAnswers(schema, { model: "X1" }, "draft")).toEqual({ ok: true, answers: { model: "X1" } });
  });

  it("refuses a value of the wrong type, naming the field", () => {
    expect(validateAnswers(schema, { manufacturer: 42, description: ["a"] }, "draft")).toEqual({
      ok: false,
      errors: [
        { key: "manufacturer", code: "wrong_type" },
        { key: "description", code: "wrong_type" },
      ],
    });
  });

  it("refuses text longer than the field allows", () => {
    expect(validateAnswers(schema, { model: "12345678901" }, "draft")).toEqual({
      ok: false,
      errors: [{ key: "model", code: "too_long" }],
    });
    expect(validateAnswers(schema, { model: "1234567890" }, "draft").ok).toBe(true);
  });

  it("caps text and textarea fields without their own limit", () => {
    expect(validateAnswers(schema, { manufacturer: "x".repeat(501) }, "draft")).toMatchObject({ ok: false });
    expect(validateAnswers(schema, { manufacturer: "x".repeat(500) }, "draft").ok).toBe(true);
    expect(validateAnswers(schema, { description: "x".repeat(4001) }, "draft")).toMatchObject({ ok: false });
    expect(validateAnswers(schema, { description: "x".repeat(4000) }, "draft").ok).toBe(true);
  });

  it("refuses answers to fields the Form doesn't have", () => {
    expect(validateAnswers(schema, { colour: "red" }, "draft")).toEqual({
      ok: false,
      errors: [{ key: "colour", code: "unknown_field" }],
    });
  });

  it("keeps values exactly as typed, and drops empty ones", () => {
    const typed = "  Galvanised\n300 mm  ";
    expect(validateAnswers(schema, { description: typed, manufacturer: "", model: null }, "draft")).toEqual({
      ok: true,
      answers: { description: typed },
    });
  });

  it("refuses answers that aren't an object of fields", () => {
    for (const answers of [null, [], "text", 3]) {
      expect(validateAnswers(schema, answers, "draft")).toEqual({ ok: false, errors: [{ key: "", code: "wrong_type" }] });
    }
  });
});

describe("validateAnswers in complete mode (types and required)", () => {
  it("lists every required field still empty, in Form order", () => {
    expect(validateAnswers(schema, { model: "X1" }, "complete")).toEqual({
      ok: false,
      errors: [
        { key: "manufacturer", code: "required" },
        { key: "description", code: "required" },
      ],
    });
  });

  it("counts a value of only spaces as empty", () => {
    expect(validateAnswers(schema, { manufacturer: "   ", description: "ok" }, "complete")).toEqual({
      ok: false,
      errors: [{ key: "manufacturer", code: "required" }],
    });
  });

  it("reports type errors too, one per field", () => {
    expect(validateAnswers(schema, { manufacturer: 1 }, "complete")).toEqual({
      ok: false,
      errors: [
        { key: "manufacturer", code: "wrong_type" },
        { key: "description", code: "required" },
      ],
    });
  });

  it("accepts a complete Form", () => {
    const answers = { manufacturer: "ACME", description: "Cable trays" };
    expect(validateAnswers(schema, answers, "complete")).toEqual({ ok: true, answers });
  });
});

describe("formSchema", () => {
  it("refuses a field type it doesn't know", () => {
    expect(
      formSchema.safeParse({
        sections: [{ key: "a", title: label("A"), fields: [{ key: "x", type: "hologram", label: label("X") }] }],
      }).success,
    ).toBe(false);
  });

  it("refuses keys that aren't snake_case", () => {
    expect(
      formSchema.safeParse({
        sections: [{ key: "a", title: label("A"), fields: [{ key: "Model No", type: "text", label: label("X") }] }],
      }).success,
    ).toBe(false);
  });
});
