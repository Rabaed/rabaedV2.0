import { defaultListColumns, type WorkItemRow } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { exportFile } from "./work-item-export.ts";

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
const headerOf = (key: string) => ({ documentNumber: "Submittal No.", subject: "Title", revision: "Rev", owner: "Current owner" })[key] ?? key;
const only = (...keys: string[]) => defaultListColumns.map((c) => ({ ...c, shown: keys.includes(c.key) }));

describe("Export (RP-409)", () => {
  it("writes the shown columns only, in their order, as CSV with a BOM for Excel and every value quoted", async () => {
    const file = exportFile([row], only("documentNumber", "subject", "revision", "owner"), "csv", { locale: "en", labels, filters, headerOf, name: "submittals" });
    expect(file.name).toBe("submittals.csv");
    expect(file.type).toBe("text/csv;charset=utf-8");
    expect(file.content).toBe(
      '﻿"Submittal No.","Title","Rev","Current owner"\r\n"TWR-MAR-0003","Cable ""tray"", galvanised","R1","Design Consultants"\r\n',
    );
  });

  it("never writes a hidden column: here the Creation Date, which this viewer doesn't read, nor the Stage", async () => {
    const file = exportFile([row], only("subject", "created"), "csv", { locale: "ar", labels, filters, headerOf, name: "submittals" });
    // The Submission Date stands in for another Company's item, Latin digits in Arabic.
    expect(file.content).toContain('"14 سبتمبر 2026"');
    expect(file.content).not.toContain("بانتظار");
  });

  it("writes Excel as a spreadsheet of text cells, every value escaped", async () => {
    const file = exportFile([row], only("subject"), "excel", { locale: "en", labels, filters, headerOf, name: "submittals" });
    expect(file.name).toBe("submittals.xls");
    expect(file.type).toBe("application/vnd.ms-excel");
    expect(file.content).toContain('<Cell><Data ss:Type="String">Cable &quot;tray&quot;, galvanised</Data></Cell>');
    expect(file.content).toContain('<Worksheet ss:Name="submittals">');
  });
});
