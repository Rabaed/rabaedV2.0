import { describe, expect, it } from "vitest";
import { formSchema, validateAnswers, type FormSchema } from "./form.ts";

// Numbers and contact details (RP-264): number, currency, email and phone fields.

const label = (en: string) => ({ en, ar: en });

const schema: FormSchema = formSchema.parse({
  sections: [
    {
      key: "supply",
      title: label("Supply"),
      fields: [
        { key: "quantity", type: "number", label: label("Quantity"), unit: "m²", min: 0, max: 5000, decimals: 2, required: true },
        { key: "floors", type: "number", label: label("Floors"), decimals: 0 },
        { key: "offset", type: "number", label: label("Offset") },
        { key: "unit_price", type: "currency", label: label("Unit price"), min: 0, required: true },
        { key: "fee_usd", type: "currency", currency: "USD", label: label("Fee") },
        { key: "contact_email", type: "email", label: label("Email"), required: true },
        { key: "contact_phone", type: "phone", label: label("Phone") },
      ],
    },
    // The Built-in Field every Form places; Trade is required even in a draft.
    { key: "classification", title: label("Classification"), fields: [{ key: "trade", type: "trade", label: label("Trade") }] },
  ],
});

const trade = { trade: "00000000-0000-4000-8000-000000000001" };

const errorsOf = (answers: Record<string, unknown>, mode: "draft" | "complete" = "draft") => {
  const result = validateAnswers(schema, { ...trade, ...answers }, mode);
  return result.ok ? [] : result.errors;
};
const cleanOf = (answers: Record<string, unknown>) => {
  const result = validateAnswers(schema, { ...trade, ...answers }, "draft");
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const { trade: _trade, ...own } = result.answers;
  return own;
};

describe("number fields", () => {
  it("take a number, stored as a number", () => {
    expect(cleanOf({ quantity: 12.5, floors: 3, offset: -0.125 })).toEqual({ quantity: 12.5, floors: 3, offset: -0.125 });
  });

  it("take their limits themselves: min and max are allowed", () => {
    expect(errorsOf({ quantity: 0 })).toEqual([]);
    expect(errorsOf({ quantity: 5000 })).toEqual([]);
  });

  it("refuse a number below min or above max", () => {
    expect(errorsOf({ quantity: -0.01 })).toEqual([{ key: "quantity", code: "below_min" }]);
    expect(errorsOf({ quantity: 5000.01 })).toEqual([{ key: "quantity", code: "above_max" }]);
  });

  it("refuse more decimal places than the field allows", () => {
    expect(errorsOf({ quantity: 1.25 })).toEqual([]);
    expect(errorsOf({ quantity: 1.255 })).toEqual([{ key: "quantity", code: "too_many_decimals" }]);
    expect(errorsOf({ floors: 2.5 })).toEqual([{ key: "floors", code: "too_many_decimals" }]);
    expect(errorsOf({ quantity: 1e-7 })).toEqual([{ key: "quantity", code: "too_many_decimals" }]);
  });

  it("take any decimals when the field sets none", () => {
    expect(errorsOf({ offset: 0.123456 })).toEqual([]);
  });

  it("refuse anything but a number: text, even of digits, is the wrong type", () => {
    for (const quantity of ["12", "12.5", true, [12], { value: 12 }]) {
      expect(errorsOf({ quantity }), JSON.stringify(quantity)).toEqual([{ key: "quantity", code: "wrong_type" }]);
    }
  });

  it("count 0 as an answer, not an empty field", () => {
    expect(errorsOf({ quantity: 0, unit_price: 0, contact_email: "a@b.sa" }, "complete")).toEqual([]);
  });
});

describe("currency fields", () => {
  it("are in SAR unless the field says otherwise", () => {
    const fields = schema.sections[0]!.fields;
    expect(fields.find((f) => f.key === "unit_price")).toMatchObject({ currency: "SAR" });
    expect(fields.find((f) => f.key === "fee_usd")).toMatchObject({ currency: "USD" });
  });

  it("take an amount, with at most the currency's decimals (halalas for SAR)", () => {
    expect(cleanOf({ unit_price: 1250.75 })).toEqual({ unit_price: 1250.75 });
    expect(errorsOf({ unit_price: 1250.755 })).toEqual([{ key: "unit_price", code: "too_many_decimals" }]);
  });

  it("refuse an amount outside their limits, or one that isn't a number", () => {
    expect(errorsOf({ unit_price: -1 })).toEqual([{ key: "unit_price", code: "below_min" }]);
    expect(errorsOf({ unit_price: "SAR 12" })).toEqual([{ key: "unit_price", code: "wrong_type" }]);
  });
});

describe("email fields", () => {
  it("take an email address, without the spaces around it", () => {
    expect(cleanOf({ contact_email: "site.engineer@contractor.example" })).toEqual({ contact_email: "site.engineer@contractor.example" });
    expect(cleanOf({ contact_email: " pm@rabaed.sa " })).toEqual({ contact_email: "pm@rabaed.sa" });
  });

  it("refuse text that isn't an email address", () => {
    for (const contact_email of ["pm", "pm@", "@rabaed.sa", "pm@rabaed", "pm rabaed@x.sa", "pm@@rabaed.sa", `${"x".repeat(250)}@x.sa`]) {
      expect(errorsOf({ contact_email }), contact_email).toEqual([{ key: "contact_email", code: "invalid_format" }]);
    }
  });

  it("refuse a value that isn't text", () => {
    expect(errorsOf({ contact_email: 42 })).toEqual([{ key: "contact_email", code: "wrong_type" }]);
  });
});

describe("phone fields", () => {
  it("take KSA numbers, written the usual ways, as typed", () => {
    for (const contact_phone of [
      "0501234567",
      "050 123 4567",
      "050-123-4567",
      "+966501234567",
      "+966 50 123 4567",
      "00966501234567",
      "011 234 5678",
      "+966 11 234 5678",
      "800 123 4567",
      "920012345",
    ]) {
      expect(cleanOf({ contact_phone }), contact_phone).toEqual({ contact_phone });
    }
  });

  it("take international numbers with their country code", () => {
    for (const contact_phone of ["+44 20 7946 0958", "+1 (212) 555-0100", "+971 4 123 4567", "0044 20 7946 0958"]) {
      expect(errorsOf({ contact_phone }), contact_phone).toEqual([]);
    }
  });

  it("refuse what isn't a phone number", () => {
    for (const contact_phone of [
      "050123456", // a digit short
      "05012345678", // a digit long
      "0601234567", // no such KSA prefix
      "+966 60 123 4567",
      "+966 50 123 456",
      "966501234567", // a country code needs + or 00
      "+44",
      "+0 123 456 789",
      "+1234567890123456", // longer than any number
      "call me",
      "050 123 4567 ext 2",
      "٠٥٠١٢٣٤٥٦٧", // Arabic-Indic digits: Rabaed keeps Latin ones
    ]) {
      expect(errorsOf({ contact_phone }), contact_phone).toEqual([{ key: "contact_phone", code: "invalid_format" }]);
    }
  });

  it("refuse a value that isn't text", () => {
    expect(errorsOf({ contact_phone: 501234567 })).toEqual([{ key: "contact_phone", code: "wrong_type" }]);
  });
});

describe("draft vs complete with numbers and contact details", () => {
  it("a draft skips required, but still refuses a bad value", () => {
    expect(errorsOf({})).toEqual([]);
    expect(errorsOf({ quantity: 9999, contact_email: "pm" })).toEqual([
      { key: "quantity", code: "above_max" },
      { key: "contact_email", code: "invalid_format" },
    ]);
  });

  it("complete lists each required field still empty, in Form order", () => {
    expect(errorsOf({ contact_phone: "0501234567" }, "complete")).toEqual([
      { key: "quantity", code: "required" },
      { key: "unit_price", code: "required" },
      { key: "contact_email", code: "required" },
    ]);
    expect(errorsOf({ quantity: 1, unit_price: 1, contact_email: "   " }, "complete")).toEqual([
      { key: "contact_email", code: "required" },
    ]);
  });
});

describe("formSchema for numbers and contact details", () => {
  const parse = (field: Record<string, unknown>) =>
    formSchema.safeParse({ sections: [{ key: "s", title: label("S"), fields: [{ key: "f", label: label("F"), ...field }] }] }).success;

  it("refuses a min above the max", () => {
    expect(parse({ type: "number", min: 10, max: 1 })).toBe(false);
    expect(parse({ type: "currency", min: 10, max: 1 })).toBe(false);
    expect(parse({ type: "number", min: 1, max: 1 })).toBe(true);
  });

  it("refuses decimals that aren't a small whole number", () => {
    expect(parse({ type: "number", decimals: -1 })).toBe(false);
    expect(parse({ type: "number", decimals: 1.5 })).toBe(false);
    expect(parse({ type: "number", decimals: 7 })).toBe(false);
    expect(parse({ type: "number", decimals: 6 })).toBe(true);
  });

  it("refuses a currency that isn't an ISO 4217 code", () => {
    expect(parse({ type: "currency", currency: "sar" })).toBe(false);
    expect(parse({ type: "currency", currency: "XYZ" })).toBe(false);
    expect(parse({ type: "currency", currency: "EUR" })).toBe(true);
  });

  it("refuses an empty unit", () => {
    expect(parse({ type: "number", unit: " " })).toBe(false);
  });
});
