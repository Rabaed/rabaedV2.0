import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openSpreadsheet, SpreadsheetError, spreadsheetLimits, type SpreadsheetFile } from "./spreadsheet.ts";

// The fixtures are made-up registers, built by test/fixtures/registers/make-fixtures.py.
const fixture = (fileName: string): SpreadsheetFile => ({
  fileName,
  bytes: readFileSync(new URL(`../../test/fixtures/registers/${fileName}`, import.meta.url)),
});

const csv = (fileName: string, text: string): SpreadsheetFile => ({ fileName, bytes: Buffer.from(text, "utf8") });

/** The refusal `read` throws: its reason and details. */
async function refusal(read: () => unknown): Promise<{ reason: string; details: unknown }> {
  try {
    await read();
  } catch (error) {
    if (error instanceof SpreadsheetError) return { reason: error.reason, details: error.details };
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("an .xlsx register", () => {
  it("lists its sheets in order", async () => {
    expect((await openSpreadsheet(fixture("register.xlsx"))).sheets).toEqual(["Notes", "Register"]);
  });

  it("reads a chosen sheet from a header row below a title block: Arabic and English as written, an empty row skipped", async () => {
    const register = await openSpreadsheet(fixture("register.xlsx"));
    expect(register.table({ sheet: "Register", headerRow: 4 })).toEqual({
      sheet: "Register",
      headerRow: 4,
      headers: ["No.", "Subject", "الموضوع", "Trade", "", "Planned"],
      rows: [
        { rowNo: 5, values: ["0012", "Shop drawings: lobby ceiling", "مخططات تنفيذية: سقف الردهة", "Architectural", "Ceilings", "2026-03-15"] },
        { rowNo: 6, values: ["7", "Fire pump datasheet", "بيانات مضخة الحريق", "Mechanical", "Fire fighting", "2026-04-02 09:30"] },
        { rowNo: 8, values: ["1.5", "  Cable trays, level 3  ", "حوامل الكابلات", "Electrical", "", ""] },
      ],
    });
  });

  it("keeps the column under a header merged over two (an empty header, its values read)", async () => {
    const { headers, rows } = (await openSpreadsheet(fixture("register.xlsx"))).table({ sheet: "Register", headerRow: 4 });
    expect(headers.slice(3, 5)).toEqual(["Trade", ""]);
    expect(rows.map((row) => row.values[4])).toEqual(["Ceilings", "Fire fighting", ""]);
  });

  it("reads the first sheet from row 1 when nothing is chosen", async () => {
    expect((await openSpreadsheet(fixture("register.xlsx"))).table()).toEqual({ sheet: "Notes", headerRow: 1, headers: ["Read me first"], rows: [] });
  });

  it("counts only the rows below the chosen header row", async () => {
    const register = await openSpreadsheet(fixture("register.xlsx"));
    const fromTitle = register.table({ sheet: "Register", headerRow: 1 });
    expect(fromTitle.headers[0]).toBe("Tower Project: Submittal Register");
    expect(fromTitle.rows.map((row) => row.rowNo)).toEqual([2, 4, 5, 6, 8]);
  });
});

describe("a .csv register", () => {
  it("is one sheet named after the file", async () => {
    expect((await openSpreadsheet(fixture("register-comma.csv"))).sheets).toEqual(["register-comma"]);
  });

  it("reads UTF-8 with a BOM, comma-delimited, with a title line, an empty line and a quoted field", async () => {
    expect((await openSpreadsheet(fixture("register-comma.csv"))).table({ headerRow: 2 })).toEqual({
      sheet: "register-comma",
      headerRow: 2,
      headers: ["No.", "Subject", "الموضوع", "Trade", ""],
      rows: [
        { rowNo: 3, values: ["0012", "Shop drawings: lobby ceiling", "مخططات تنفيذية: سقف الردهة", "Architectural", "Ceilings"] },
        { rowNo: 5, values: ["7", "Fire pump datasheet, rev 2", "بيانات مضخة الحريق\r\nالمراجعة 2", "Mechanical", "Fire fighting"] },
      ],
    });
  });

  it("reads UTF-8 without a BOM, semicolon-delimited, keeping the commas inside its values", async () => {
    expect((await openSpreadsheet(fixture("register-semicolon.csv"))).table({ sheet: "register-semicolon" })).toEqual({
      sheet: "register-semicolon",
      headerRow: 1,
      headers: ["Subject", "Trade", "Scopes"],
      rows: [
        { rowNo: 2, values: ["Doors, frames and ironmongery", "Architectural", "Doors, Ironmongery"] },
        { rowNo: 3, values: ["لوحات التوزيع، الدور الأرضي", "Electrical", "Panels"] },
      ],
    });
  });

  it("pads a short row to the width of the table", async () => {
    const { rows } = (await openSpreadsheet(csv("short.csv", "Subject,Trade,Location\nPanels\n"))).table();
    expect(rows).toEqual([{ rowNo: 2, values: ["Panels", "", ""] }]);
  });

  it("refuses a file that isn't UTF-8 (Arabic saved as Windows-1256)", async () => {
    expect(await refusal(() => openSpreadsheet(fixture("register-windows-1256.csv")))).toEqual({ reason: "not_utf8", details: undefined });
  });

  it("refuses quotes it can't read", async () => {
    expect((await refusal(() => openSpreadsheet(csv("broken.csv", 'Subject\n"never closed\n')))).reason).toBe("unreadable");
  });
});

describe("the limits", () => {
  const { maxBytes, maxDataRows } = spreadsheetLimits;

  it("are 10 MB and 2,000 data rows", () => {
    expect(spreadsheetLimits).toMatchObject({ maxBytes: 10 * 1024 * 1024, maxDataRows: 2000 });
  });

  it("refuse a file over 10 MB, before reading it", async () => {
    const big = { fileName: "big.xlsx", bytes: new Uint8Array(maxBytes + 1) };
    expect(await refusal(() => openSpreadsheet(big))).toEqual({ reason: "too_large", details: { bytes: maxBytes + 1, maxBytes } });
  });

  it("let a file of exactly 10 MB through", async () => {
    const header = "Subject\n";
    const file = csv("exact.csv", header + "x".repeat(maxBytes - header.length));
    expect(file.bytes.length).toBe(maxBytes);
    expect((await openSpreadsheet(file)).table().rows).toHaveLength(1);
  });

  it("refuse a sheet of 2,001 data rows", async () => {
    const register = await openSpreadsheet(fixture("too-many-rows.xlsx"));
    expect(await refusal(() => register.table())).toEqual({ reason: "too_many_rows", details: { rows: maxDataRows + 1, maxDataRows } });
  });

  it("let 2,000 data rows through, not counting empty rows or the rows above the header", async () => {
    const lines = ["Tower Project", "", "Subject", ...Array.from({ length: maxDataRows }, (_, n) => (n % 500 === 0 ? `Submittal ${n}\n,` : `Submittal ${n}`))];
    const { rows } = (await openSpreadsheet(csv("exactly.csv", lines.join("\n")))).table({ headerRow: 3 });
    expect(rows).toHaveLength(maxDataRows);
  });

  it("refuse an .xlsx that unpacks to more than the limit, however small on disk", async () => {
    const file = fixture("inflated.xlsx");
    expect(file.bytes.length).toBeLessThan(1024 * 1024);
    expect((await refusal(() => openSpreadsheet(file))).reason).toBe("too_large_unpacked");
  });
});

describe("a file it can't read", () => {
  it("is refused when it isn't .xlsx or .csv, the old .xls included", async () => {
    for (const fileName of ["register.xls", "register.pdf", "register"]) {
      expect((await refusal(() => openSpreadsheet({ fileName, bytes: Buffer.from("not a register") }))).reason).toBe("unsupported_type");
    }
  });

  it("is refused when an .xlsx isn't one", async () => {
    expect((await refusal(() => openSpreadsheet({ fileName: "register.xlsx", bytes: Buffer.from("plain text, not a workbook") }))).reason).toBe("unreadable");
  });

  it("names the extension in any case", async () => {
    expect((await openSpreadsheet({ ...fixture("register.xlsx"), fileName: "REGISTER.XLSX" })).sheets).toEqual(["Notes", "Register"]);
  });
});

describe("a choice the file doesn't have", () => {
  it("refuses a sheet that isn't there", async () => {
    const register = await openSpreadsheet(fixture("register.xlsx"));
    expect((await refusal(() => register.table({ sheet: "Sheet9" }))).reason).toBe("sheet_not_found");
  });

  it("refuses a header row past the last row, or not a row at all", async () => {
    const register = await openSpreadsheet(fixture("register.xlsx"));
    for (const headerRow of [9, 0, -1, 1.5]) {
      expect((await refusal(() => register.table({ sheet: "Register", headerRow }))).reason).toBe("header_row_not_found");
    }
  });

  it("refuses an empty header row", async () => {
    const register = await openSpreadsheet(fixture("register.xlsx"));
    expect((await refusal(() => register.table({ sheet: "Register", headerRow: 3 }))).reason).toBe("empty_header_row");
  });
});
