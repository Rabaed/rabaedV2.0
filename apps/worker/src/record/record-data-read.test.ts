import { describe, expect, it } from "vitest";
import { fallbackFonts } from "./fonts.ts";
import { recordHtml } from "./layout.ts";
import { parseRecordData } from "./record-data-read.ts";
import { LAYOUT_VERSION, recordDataXml, type RecordData } from "./record-data.ts";

// Re-produce reads the stored Record Data back (RP-155): what it reads must print the
// same pages, and write the same document, as what was stored. Whoever adds to
// recordDataXml (RP-151, RP-650, RP-147) extends the reader until these pass again.

const data: RecordData = {
  layoutVersion: LAYOUT_VERSION,
  language: "bilingual",
  projectName: { en: "Tower & Co <1>", ar: "برج الرياض" },
  type: { code: "MAR", name: { en: 'Material "Approval"', ar: "اعتماد مواد" } },
  documentNumber: "RB-MAR-0001",
  revisionNo: 2,
  subject: "Cable trays > 300 mm, it's galvanised",
  outcome: "A",
  closedAt: "2026-10-01T10:00:00.000Z",
  transitions: [
    {
      kind: "send",
      fromStepId: "a",
      toStepId: "b",
      label: { en: "Send for review", ar: "إرسال للمراجعة" },
      at: "2026-10-01T09:00:00.000Z",
      memberName: { en: "Omar Haddad", ar: "عمر حداد" },
      positions: [
        { en: "Engineer", ar: "مهندس" },
        { en: "Lead", ar: "قائد" },
      ],
      companyName: { en: "C1 & Sons", ar: "الشركة الأولى" },
      contentSha256: "ab".repeat(32),
    },
    {
      kind: "close",
      fromStepId: "b",
      toStepId: "c",
      label: { en: "Approve", ar: "اعتماد" },
      at: "2026-10-01T10:00:00.000Z",
      memberName: { en: "Huda Harbi", ar: "هدى حربي" },
      positions: [],
      companyName: { en: "K1", ar: "ك1" },
      contentSha256: null,
    },
  ],
  verification: { code: "ABCD-EFGH", link: "https://rabaed.test/verify/a_b-c?x=1&y=2" },
};

describe("parseRecordData", () => {
  it("writes the same document back from what it reads", () => {
    const xml = recordDataXml(data);
    expect(recordDataXml(parseRecordData(xml))).toBe(xml);
  });

  it("reads Record Data that prints the same pages", () => {
    const fonts = fallbackFonts();
    expect(recordHtml(parseRecordData(recordDataXml(data)), fonts)).toBe(recordHtml(data, fonts));
  });

  it("reads a Document Number that is missing", () => {
    expect(parseRecordData(recordDataXml({ ...data, documentNumber: null })).documentNumber).toBeNull();
  });

  it("refuses a document that is not Record Data of this version", () => {
    expect(() => parseRecordData("<other/>")).toThrow(/not a Record Data document/);
    expect(() => parseRecordData(recordDataXml(data).replace("record-data/1", "record-data/2"))).toThrow(/not a Record Data document/);
    expect(() => parseRecordData("<recordData")).toThrow();
  });
});
