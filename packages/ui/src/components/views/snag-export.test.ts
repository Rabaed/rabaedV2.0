import type { WorkItemRow } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { snagExcel, type SnagExportLabels } from "./snag-export.ts";

// Story data only.
const b = (en: string, ar: string) => Object.fromEntries([["en", en], ["ar", ar]]) as { en: string; ar: string };
const row = (rest: Partial<WorkItemRow>): WorkItemRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000100",
  type: { code: "SNG", name: b("Snag", "عيب") },
  title: "Cable tray <not> bonded & loose",
  documentNumber: "TWR-DCL-EL-SNG-011",
  revisionNo: 0,
  stage: { key: "open", name: b("Open", "مفتوحة"), category: "in_progress" },
  trade: { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical", "الكهرباء") },
  location: null,
  stepEnteredAt: "2026-09-01T00:00:00.000Z",
  stepAgeWeeks: 3,
  outcome: null,
  with: { kind: "company", companyName: b("TMC Constructions", "تي إم سي") },
  submissionDate: "2026-09-14T08:30:00.000Z",
  creationDate: null,
  raisedFrom: null,
  ...rest,
});
const labels: SnagExportLabels = {
  documentNumber: "Document Number",
  subject: "Subject",
  type: "Type",
  trade: "Trade",
  location: "Location",
  stage: "Stage",
  raisedFrom: "Raised from",
  with: "With",
  stepAgeWeeks: "Step Age (weeks)",
  raisedManually: "By hand",
  notPickedUp: "Not picked up",
  noNumber: "No number yet",
  fileName: "Snag List",
};

describe("the Snag List's Excel export (RP-629)", () => {
  it("writes a workbook of the rows, with Step Age in weeks and nothing about a due date", () => {
    const file = snagExcel([row({}), row({ id: "00000000-0000-4000-8000-000000000002", stepAgeWeeks: null, documentNumber: null })], "en", labels, []);
    expect(file.name).toBe("Snag List.xml");
    expect(file.content).toContain('<Data ss:Type="String">Step Age (weeks)</Data>');
    expect(file.content).toContain('<Data ss:Type="String">3</Data>');
    expect(file.content).toContain("No number yet");
    expect(file.content.toLowerCase()).not.toMatch(/due|overdue|deadline/);
  });

  it("escapes the Subject, keeps a formula as text, and reads right to left in Arabic", () => {
    const file = snagExcel([row({ title: "=SUM(A1)" }), row({})], "ar", labels, []);
    expect(file.content).toContain("'=SUM(A1)");
    expect(file.content).toContain("Cable tray &lt;not&gt; bonded &amp; loose");
    expect(file.content).toContain("<DisplayRightToLeft/>");
    expect(file.content).toContain("مفتوحة");
  });

  it("names the Source of an item raised from another by its Document Number, or says by hand", () => {
    const from = row({ raisedFrom: { documentNumber: "TWR-TMC-EL-MAR-041", subject: "Cable trays", workItemId: null, outcome: null } });
    expect(snagExcel([from], "en", labels, []).content).toContain("TWR-TMC-EL-MAR-041");
    expect(snagExcel([row({})], "en", labels, []).content).toContain("By hand");
  });
});
