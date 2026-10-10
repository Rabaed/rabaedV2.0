import { defaultListColumns, type WorkItemRow } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { asText, exportFile, shownColumns, wholeTableColumns } from "./work-item-export.ts";

// Story data only.
const b = (en: string, ar: string) => Object.fromEntries([["en", en], ["ar", ar]]) as { en: string; ar: string };
const row: WorkItemRow = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000100",
  type: { code: "MAR", name: b("Material Submittal", "اعتماد مواد") },
  title: 'Cable "tray", galvanised',
  documentNumber: "TWR-MAR-0003 Rev 1",
  revisionNo: 1,
  stage: { key: "pending_approval", name: b("Pending Approval", "بانتظار الاعتماد"), category: "in_progress" },
  trade: { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical Works", "أعمال كهربائية") },
  location: null,
  stepEnteredAt: "2026-09-01T00:00:00.000Z",
  stepAgeWeeks: 2,
  outcome: null,
  with: { kind: "company", companyName: b("Design Consultants", "التصاميم الاستشارية") },
  submissionDate: "2026-09-14T08:30:00.000Z",
  creationDate: null,
};
const labels = {
  noNumber: "No number yet",
  revisionNoNumber: (r: string) => `Revision ${r}: no number yet`,
  unclaimed: "unclaimed",
  cancelled: "Cancelled",
  code: (c: string) => `Code ${c}`,
  revision: (n: string) => `R${n}`,
};
const filters = { outcomes: [], locations: [] };
const headerOf = (key: string) => ({ documentNumber: "Submittal No.", subject: "Title", revision: "Rev", owner: "Current owner", created: "Created" })[key] ?? key;
const context = (locale: "en" | "ar") => ({ locale, labels, filters, headerOf, name: "Submittals" });
const only = (...keys: string[]) => defaultListColumns.map((c) => ({ ...c, shown: keys.includes(c.key) }));
const whole = { typeName: "Work Item Type", location: "Location", creationDate: "Creation Date", submissionDate: "Submission Date", project: "Project" };

describe("Export (RP-409)", () => {
  it("writes what you see: the shown columns only, in their order, as CSV with a BOM and every value quoted", () => {
    const file = exportFile([row], shownColumns(only("documentNumber", "subject", "revision", "owner"), context("en")), "csv", context("en"));
    expect(file.name).toBe("Submittals.csv");
    expect(file.type).toBe("text/csv;charset=utf-8");
    expect(file.content).toBe(
      '﻿"Submittal No.","Title","Rev","Current owner"\r\n"TWR-MAR-0003","Cable ""tray"", galvanised","R1","Design Consultants"\r\n',
    );
  });

  it("never writes a hidden column in what you see; a date in the List's style, Latin digits in Arabic", () => {
    const file = exportFile([row], shownColumns(only("subject", "created"), context("ar")), "csv", context("ar"));
    expect(file.content).toContain('"14 سبتمبر 2026"');
    expect(file.content).not.toContain("بانتظار");
  });

  it("writes the whole table: every List column and the fields it keeps besides, as the viewer reads them", () => {
    const file = exportFile([row], wholeTableColumns(context("en"), whole, "Riyadh Gate Tower"), "csv", context("en"));
    const [head, line] = file.content.slice(1).split("\r\n");
    expect(head!.split(",")).toHaveLength(14 + 5);
    expect(head).toContain('"Submission Date","Project"');
    // No Creation Date for another Company's reader: an empty cell, never a guess.
    expect(line).toContain('"","14 Sep 2026","Riyadh Gate Tower"');
  });

  it("keeps a would-be formula as text, in every column and both formats", () => {
    for (const evil of ["=HYPERLINK(1)", "+1", "-2", "@SUM(A1)", "\tx", "\rx"]) expect(asText(evil)).toBe(`'${evil}`);
    expect(asText("Cable")).toBe("Cable");
    const nasty = { ...row, title: "=cmd|' /C calc'!A0" };
    expect(exportFile([nasty], shownColumns(only("subject"), context("en")), "csv", context("en")).content).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(exportFile([nasty], shownColumns(only("subject"), context("en")), "excel", context("en")).content).toContain("'=cmd|");
  });

  it("writes Excel as a workbook Excel opens without a warning: text cells escaped, dates as dates, right to left in Arabic", () => {
    const en = exportFile([row], shownColumns(only("subject", "created"), context("en")), "excel", context("en"));
    expect(en.name).toBe("Submittals.xml");
    expect(en.content).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(en.content).toContain('<Cell><Data ss:Type="String">Cable &quot;tray&quot;, galvanised</Data></Cell>');
    expect(en.content).toContain('<Data ss:Type="DateTime">2026-09-14T00:00:00.000</Data>');
    expect(en.content).not.toContain("DisplayRightToLeft");
    expect(exportFile([row], shownColumns(only("subject"), context("ar")), "excel", context("ar")).content).toContain("<DisplayRightToLeft/>");
  });
});
