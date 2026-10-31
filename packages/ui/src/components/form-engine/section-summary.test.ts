import type { FormField } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { formSectionSummary } from "./section-summary.ts";

// A name in both languages, built as data (the package has no translations of its own).
const b = (en: string) => Object.fromEntries([["en", en], ["ar", en]]) as { en: string; ar: string };

const field = (key: string, type = "text") => ({ key, type, label: b(key), required: false }) as unknown as FormField;

describe("a folded Form section's one-line summary (RP-1151, gap table row 44)", () => {
  it("is its first two answered fields, joined by a middle dot", () => {
    const answers: Record<string, string> = { manufacturer: "Zumtobel", model: "Linea LED 1200 · 4000 K", spec: "26 51 00" };
    const summary = formSectionSummary([field("manufacturer"), field("model"), field("spec")], (f) => answers[f.key] ?? null);
    expect(summary).toBe("Zumtobel · Linea LED 1200 · 4000 K");
  });

  it("skips fields with no answer and layout fields", () => {
    const answers: Record<string, string> = { model: "Linea", description: "LED linear fixtures" };
    const fields = [field("intro", "instructions"), field("manufacturer"), field("model"), field("heading", "heading"), field("description")];
    expect(formSectionSummary(fields, (f) => answers[f.key] ?? null)).toBe("Linea · LED linear fixtures");
  });

  it("treats an answer of only spaces as none, and keeps one answer alone", () => {
    const answers: Record<string, string> = { manufacturer: "   ", model: "Linea" };
    expect(formSectionSummary([field("manufacturer"), field("model")], (f) => answers[f.key] ?? null)).toBe("Linea");
  });

  it("is null for a section with nothing answered", () => {
    expect(formSectionSummary([field("manufacturer"), field("model")], () => null)).toBeNull();
  });

  it("puts a long answer on one line", () => {
    const answers: Record<string, string> = { description: "First line\nsecond line" };
    expect(formSectionSummary([field("description")], (f) => answers[f.key] ?? null)).toBe("First line second line");
  });
});
