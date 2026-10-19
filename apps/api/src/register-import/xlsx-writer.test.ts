import { inflateRawSync } from "node:zlib";
import { writeXlsx } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { openSpreadsheet } from "./spreadsheet.ts";

// The .xlsx the Submittal Register Import's downloads are written with (RP-644, @rabaed/domain
// writeXlsx), read back by the import's own reader: a rejected-rows sheet goes straight back in.

/** Each zip entry's name, DOS date and time, and its bytes. */
function entries(bytes: Uint8Array): { name: string; date: number; time: number; text: string }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const time = view.getUint16(at + 10, true);
    const date = view.getUint16(at + 12, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const data = bytes.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size);
    out.push({ name, date, time, text: new TextDecoder().decode(method === 8 ? inflateRawSync(data) : data) });
    at += 30 + nameLength + extra + size;
  }
  return out;
}

describe("an .xlsx written for a download", () => {
  const rows = [
    ["No.", "Description", "Reasons"],
    ["7", "لوحات التوزيع", "Subject empty\nType ‘XYZ’ unknown"],
    ["", "A & B <tags> \"quoted\"", ""],
  ];

  it("reads back as written, Arabic, line breaks and markup characters too", async () => {
    const book = await openSpreadsheet({ fileName: "rejected.xlsx", bytes: Buffer.from(writeXlsx({ name: "Rejected rows", rows })) });
    expect(book.sheets).toEqual(["Rejected rows"]);
    expect(book.table({ sheet: "Rejected rows", headerRow: 1 })).toEqual({
      sheet: "Rejected rows",
      headerRow: 1,
      headers: rows[0],
      rows: [
        { rowNo: 2, values: rows[1] },
        { rowNo: 3, values: rows[2] },
      ],
    });
  });

  it("says no time: no document properties, every entry dated 1980-01-01 00:00", () => {
    const parts = entries(writeXlsx({ name: "Log", rows, rightToLeft: true }));
    expect(parts.map((p) => p.name)).not.toContain("docProps/core.xml");
    expect(parts.map((p) => p.name).filter((n) => n.startsWith("docProps/"))).toEqual([]);
    for (const part of parts) {
      expect(part, part.name).toMatchObject({ date: (0 << 9) | (1 << 5) | 1, time: 0 });
      expect(part.text).not.toMatch(/dcterms|created|modified|\d{4}-\d{2}-\d{2}T/);
    }
    expect(parts.find((p) => p.name === "xl/worksheets/sheet1.xml")!.text).toContain('rightToLeft="1"');
  });

  it("names its sheet as Excel allows", async () => {
    const book = await openSpreadsheet({ fileName: "x.xlsx", bytes: Buffer.from(writeXlsx({ name: "a/b: [rejected] rows that go on and on", rows })) });
    expect(book.sheets).toEqual(["a b   rejected  rows that go on"]);
  });
});
