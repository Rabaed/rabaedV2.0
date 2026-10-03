import { describe, expect, it } from "vitest";
import { formatFormValue, parseNumberInput, toLatinDigits } from "./form-display.ts";
import { answerFields, formSchema, type AnswerField } from "./form.ts";

// How numbers, amounts and contact details read (RP-264): Latin digits, the
// viewer's grouping, units and currencies beside the number.

const label = (en: string) => ({ en, ar: en });
const fields = answerFields(
  formSchema.parse({
    sections: [
      {
        key: "s",
        title: label("S"),
        fields: [
          { key: "quantity", type: "number", label: label("Quantity"), unit: "m²", decimals: 2 },
          { key: "offset", type: "number", label: label("Offset") },
          { key: "weight", type: "number", label: label("Weight"), unit: "طن" },
          { key: "price", type: "currency", label: label("Price") },
          { key: "email", type: "email", label: label("Email") },
          { key: "phone", type: "phone", label: label("Phone") },
        ],
      },
    ],
  }),
);
const field = (key: string) => fields.find((f) => f.key === key) as AnswerField;
const noArabicIndic = /[٠-٩۰-۹]/;

describe("formatFormValue for numbers and amounts", () => {
  it("shows a number grouped, to the field's decimals, with its unit", () => {
    expect(formatFormValue(field("quantity"), 1234.5, "en")).toBe("1,234.50 m²");
    expect(formatFormValue(field("offset"), -0.125, "en")).toBe("-0.125");
    expect(formatFormValue(field("offset"), 1500, "en")).toBe("1,500");
  });

  it("uses Latin digits in Arabic, the unit after the number", () => {
    const quantity = formatFormValue(field("quantity"), 1234.5, "ar");
    expect(quantity).not.toMatch(noArabicIndic);
    expect(quantity).toMatch(/1,234\.50 m²$/);
    expect(formatFormValue(field("weight"), 12.5, "ar")).toBe("12.5 طن");
  });

  it("shows an amount in its currency, in the viewer's language", () => {
    // Intl puts a no-break space between the code and the amount.
    expect(formatFormValue(field("price"), 1250.75, "en")).toMatch(/^SAR\s1,250\.75$/);
    const ar = formatFormValue(field("price"), 1250.75, "ar");
    expect(ar).not.toMatch(noArabicIndic);
    expect(ar).toContain("1,250.75");
    expect(ar).toContain("ر.س");
  });

  it("shows a value it can't read as it is", () => {
    expect(formatFormValue(field("quantity"), "12 m", "en")).toBe("12 m");
  });
});

describe("formatFormValue for contact details", () => {
  it("shows email addresses and phone numbers exactly as typed", () => {
    expect(formatFormValue(field("email"), "PM@Contractor.sa", "ar")).toBe("PM@Contractor.sa");
    expect(formatFormValue(field("phone"), "+966 50 123 4567", "ar")).toBe("+966 50 123 4567");
  });
});

describe("parseNumberInput: what the filler typed in a number field", () => {
  it("reads Latin digits, a sign, a decimal point and thousands commas", () => {
    expect(parseNumberInput("12")).toBe(12);
    expect(parseNumberInput(" -12.5 ")).toBe(-12.5);
    expect(parseNumberInput("1,234.50")).toBe(1234.5);
    expect(parseNumberInput("12.")).toBe(12);
    expect(parseNumberInput(".5")).toBe(0.5);
  });

  it("reads Arabic-Indic digits and separators, as an Arabic keyboard types them", () => {
    expect(parseNumberInput("١٢٣٤٫٥")).toBe(1234.5);
    expect(parseNumberInput("١٬٢٣٤")).toBe(1234);
    expect(parseNumberInput("۱۲")).toBe(12);
    expect(parseNumberInput("−3")).toBe(-3);
  });

  it("shows what an Arabic keyboard typed in Latin digits, separators included", () => {
    expect(toLatinDigits("١٢٣٤٫٥")).toBe("1234.5");
    expect(toLatinDigits("١٬٢٣٤")).toBe("1,234");
    expect(toLatinDigits("+٩٦٦ ٥٠ ۱۲۳")).toBe("+966 50 123");
  });

  it("gives null for what isn't a number", () => {
    for (const text of ["", " ", "-", ".", "12a", "1.2.3", "SAR 12", "1e5", "--1"]) {
      expect(parseNumberInput(text), text).toBeNull();
    }
  });
});
