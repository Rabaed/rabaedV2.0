import { describe, expect, it } from "vitest";
import { formatFormValue } from "./form-display.ts";
import { formSchema, validateAnswers, type FormSchema, type ValidationContext } from "./form.ts";
import { publishProblems } from "./form-publish.ts";

// Seam 3: the `approved_supplier` field (RP-595, spec RP-598; form-engine.md §2.12).
// Its answer is a supplier's id from the Project's Approved Supplier List. A new
// choice must be approved and of the item's Trade; one the item already holds stays
// (also withdrawn), until the Trade changes, which clears it.

const label = (en: string) => ({ en, ar: `${en} ع` });
const schema: FormSchema = formSchema.parse({
  sections: [
    { key: "main", title: label("Main"), fields: [{ key: "supplier", type: "approved_supplier", label: label("Supplier"), required: true }] },
    {
      key: "classification",
      title: label("Classification"),
      fields: [
        { key: "trade", type: "trade", label: label("Trade") },
        { key: "location", type: "location", label: label("Location") },
        { key: "scopes", type: "scopes", label: label("Scopes") },
      ],
    },
  ],
});

const civil = "00000000-0000-4000-8000-0000000000c1";
const electrical = "00000000-0000-4000-8000-0000000000e1";
const location = "00000000-0000-4000-8000-000000000002";
const acme = "00000000-0000-4000-8000-0000000000a1";
const gone = "00000000-0000-4000-8000-0000000000a2";
const volt = "00000000-0000-4000-8000-0000000000a3";
const suppliers: ValidationContext["suppliers"] = [
  { id: acme, tradeId: civil, status: "approved" },
  { id: gone, tradeId: civil, status: "withdrawn" },
  { id: volt, tradeId: electrical, status: "approved" },
];

const check = (answers: Record<string, unknown>, context: ValidationContext = {}, mode: "draft" | "complete" = "draft") =>
  validateAnswers(schema, { trade: civil, location, ...answers }, mode, { suppliers, ...context });

describe("the approved_supplier field", () => {
  it("passes the publish checks", () => {
    expect(publishProblems(schema)).toEqual([]);
  });

  it("takes an approved supplier of the item's Trade", () => {
    expect(check({ supplier: acme })).toEqual({ ok: true, answers: { trade: civil, location, supplier: acme } });
  });

  it("refuses another Trade's supplier, a withdrawn one and a made-up id as unknown_option", () => {
    for (const supplier of [volt, gone, "00000000-0000-4000-8000-0000000000ff"]) {
      expect(check({ supplier })).toEqual({ ok: false, errors: [{ key: "supplier", code: "unknown_option" }] });
    }
    expect(check({ supplier: 7 })).toEqual({ ok: false, errors: [{ key: "supplier", code: "wrong_type" }] });
  });

  it("keeps a withdrawn supplier the item already holds, also leaving Draft", () => {
    expect(check({ supplier: gone }, { held: { supplier: gone } }, "complete")).toMatchObject({ ok: true });
  });

  it("is required to leave Draft, per field", () => {
    expect(check({}, {}, "complete")).toEqual({ ok: false, errors: [{ key: "supplier", code: "required" }] });
    expect(check({})).toMatchObject({ ok: true });
  });

  it("clears the held supplier when the Trade changes to another's, and refuses a new one of the old Trade", () => {
    const toElectrical = validateAnswers(schema, { trade: electrical, location, supplier: acme }, "draft", { suppliers, held: { supplier: acme } });
    expect(toElectrical).toEqual({ ok: true, answers: { trade: electrical, location } });
    const fresh = validateAnswers(schema, { trade: electrical, location, supplier: acme }, "draft", { suppliers });
    expect(fresh).toEqual({ ok: false, errors: [{ key: "supplier", code: "unknown_option" }] });
  });

  it("reads as the supplier's name, in either language, whatever its status", () => {
    const field = schema.sections[0]!.fields[0]!;
    if (field.type !== "approved_supplier") throw new Error("not the field");
    const named = [{ id: gone, tradeId: civil, status: "withdrawn" as const, name: { en: "Old Co", ar: "الشركة القديمة" } }];
    expect(formatFormValue(field, gone, "ar", undefined, [], {}, named)).toBe("الشركة القديمة");
    expect(formatFormValue(field, gone, "en", undefined, [], {}, named)).toBe("Old Co");
  });
});
