import { formatNumber, stepAgeLabel, type SnagReportContent, type SnagReportItem } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { fallbackFonts } from "../record/fonts.ts";
import { snagReportHtml } from "./layout.ts";

// The Snag report's layout (RP-677; ADR 0023): one language as the viewer reads, Latin digits, Document
// Numbers left to right, Step Age in weeks and no due date anywhere.

const fonts = fallbackFonts();

const item = (over: Partial<SnagReportItem> = {}): SnagReportItem => ({
  documentNumber: "PRJ-SNG-001-0001",
  subject: "Cable tray not bonded <b>",
  type: { en: "Snag", ar: "ملاحظة" },
  trade: { en: "Electrical", ar: "الكهرباء" },
  location: { en: "Level 3", ar: "الدور الثالث" },
  stage: { en: "In Progress", ar: "قيد التنفيذ" },
  with: { en: "Ali Sonour", ar: "علي سنور" },
  stepAgeWeeks: 3,
  photo: null,
  ...over,
});

const content = (items: SnagReportItem[], capped = false): SnagReportContent => ({
  projectName: { en: "Tower A", ar: "البرج أ" },
  items,
  capped,
});

const at = new Date("2027-01-05T09:00:00Z");

describe("snagReportHtml", () => {
  it("prints an English report left to right, with the Document Number isolated left to right", () => {
    const out = snagReportHtml(content([item()]), "en", fonts, new Map(), at);
    expect(out).toContain('<html lang="en" dir="ltr">');
    expect(out).toContain('<bdi dir="ltr" class="ltr">PRJ-SNG-001-0001</bdi>');
    expect(out).toContain("Tower A");
    expect(out).toContain("3 weeks");
    expect(out).not.toContain("ملاحظة");
  });

  it("prints an Arabic report right to left, in Arabic, with Latin digits", () => {
    const out = snagReportHtml(content([item()]), "ar", fonts, new Map(), at);
    expect(out).toContain('<html lang="ar" dir="rtl">');
    expect(out).toContain("البرج أ");
    expect(out).toContain("الدور الثالث");
    expect(out).toContain("3 أسابيع");
    expect(out).toContain('<bdi dir="ltr" class="ltr">PRJ-SNG-001-0001</bdi>');
    expect(out).not.toMatch(/[٠-٩]/);
    expect(out).not.toContain("Electrical");
  });

  it("escapes the viewer's own text", () => {
    const out = snagReportHtml(content([item()]), "en", fonts, new Map(), at);
    expect(out).toContain("Cable tray not bonded &lt;b&gt;");
    expect(out).not.toContain("<b>");
  });

  it("shows the weeks only for an item with a Step Age, and never a due date or 'overdue'", () => {
    const out = snagReportHtml(content([item({ stepAgeWeeks: null }), item({ stepAgeWeeks: 1 })]), "en", fonts, new Map(), at);
    expect(out).toContain("1 week at this step<");
    expect(out).not.toMatch(/overdue|due date|deadline|متأخر|موعد/i);
  });

  it("words the Step Age as the app does, in every Arabic plural form (RP-1005)", () => {
    const words: [number, string][] = [
      [1, "أسبوع واحد في هذه الخطوة"],
      [2, "أسبوعان في هذه الخطوة"],
      [3, "3 أسابيع في هذه الخطوة"],
      [11, "11 أسبوعًا في هذه الخطوة"],
      [100, "100 أسبوع في هذه الخطوة"],
    ];
    for (const [weeks, said] of words) {
      const out = snagReportHtml(content([item({ stepAgeWeeks: weeks })]), "ar", fonts, new Map(), at);
      expect(out).toContain(`>${said}<`);
      expect(said).toBe(stepAgeLabel(weeks, "ar"));
    }
  });

  it("prints the item count through formatNumber, Latin digits in both languages (RP-1005)", () => {
    const many = content(Array.from({ length: 1200 }, () => item()));
    for (const locale of ["en", "ar"] as const) {
      const out = snagReportHtml(many, locale, fonts, new Map(), at);
      expect(out).toContain(`<bdi dir="ltr" class="ltr">${formatNumber(1200, locale)}</bdi>`);
    }
    expect(formatNumber(1200, "ar")).toMatch(/^1[^0-9]200$/);
  });

  it("draws a photo only where the job read one, and says when the report stopped at its cap", () => {
    const photo = { storageKey: "projects/p/doc/1", contentType: "image/jpeg", size: 10 };
    const out = snagReportHtml(content([item({ photo }), item({ photo: { ...photo, storageKey: "other" } })], true), "en", fonts, new Map([["projects/p/doc/1", "data:image/jpeg;base64,AAAA"]]), at);
    expect(out.match(/<img /g)).toHaveLength(1);
    expect(out).toContain("data:image/jpeg;base64,AAAA");
    expect(out).toContain('class="capped"');
  });
});
