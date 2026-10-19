import { describe, expect, it } from "vitest";
import { formSchema } from "./form.ts";

// A Form Version's `pdf` block (RP-650, ADR 0023; form-engine.md §6): its Disclaimer in both
// languages and whether the record shows the review duration. Information only, never an SLA.

const sections = [{ key: "s", title: { en: "S", ar: "س" }, fields: [{ key: "a", type: "text", label: { en: "A", ar: "أ" } }] }];

describe("a Form Version's pdf block", () => {
  it("keeps the Disclaimer and the review duration choice", () => {
    const pdf = { disclaimer: { en: "Issued for the record.", ar: "صادر للسجل." }, show_review_duration: true };
    expect(formSchema.parse({ sections, pdf }).pdf).toEqual(pdf);
  });

  it("is optional, and so is each of its parts", () => {
    expect(formSchema.parse({ sections }).pdf).toBeUndefined();
    expect(formSchema.parse({ sections, pdf: {} }).pdf).toEqual({});
  });

  it("takes a Disclaimer of up to 2000 characters, in both languages and never empty", () => {
    const long = "x".repeat(2000);
    expect(formSchema.safeParse({ sections, pdf: { disclaimer: { en: long, ar: long } } }).success).toBe(true);
    expect(formSchema.safeParse({ sections, pdf: { disclaimer: { en: `${long}x`, ar: long } } }).success).toBe(false);
    expect(formSchema.safeParse({ sections, pdf: { disclaimer: { en: "Text", ar: " " } } }).success).toBe(false);
    expect(formSchema.safeParse({ sections, pdf: { disclaimer: { en: "Text" } } }).success).toBe(false);
  });

  it("refuses anything else in it", () => {
    expect(formSchema.safeParse({ sections, pdf: { due_in_days: 7 } }).success).toBe(false);
    expect(formSchema.safeParse({ sections, pdf: { show_review_duration: "yes" } }).success).toBe(false);
  });
});
