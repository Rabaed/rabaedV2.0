import { describe, expect, it } from "vitest";
import { fallbackFonts } from "./fonts.ts";
import { goldenData, type GoldenCode } from "./golden-fixtures.ts";
import { recordHtml } from "./layout.ts";
import { parseRecordData } from "./record-data-read.ts";
import { recordDataXml } from "./record-data.ts";

// Re-produce reads the stored Record Data back (RP-155): what it reads must print the
// same pages, and write the same document, as what was stored. Whoever adds to
// recordDataXml (RP-650, RP-147) extends the reader until these pass again. They run over
// the golden records (RP-151): every Code, in each record language, with the Form, tables,
// checklists, photos, Parties and the approval flow.

const codes: GoldenCode[] = ["A", "C", "D"];
const languages = ["bilingual", "ar", "en"] as const;
const cases = codes.flatMap((code) => languages.map((language) => [code, language] as const));

describe("parseRecordData", () => {
  it.each(cases)("writes the same document back from what it reads: Code %s, %s", (code, language) => {
    const xml = recordDataXml(goldenData(code, language));
    expect(recordDataXml(parseRecordData(xml))).toBe(xml);
  });

  it.each(cases)("reads Record Data that prints the same pages: Code %s, %s", (code, language) => {
    const data = goldenData(code, language);
    const fonts = fallbackFonts();
    expect(recordHtml(parseRecordData(recordDataXml(data)), fonts)).toBe(recordHtml(data, fonts));
  });

  it("finds a photo's image again by its name and time, once each", () => {
    const xml = recordDataXml(goldenData("A", "en"));
    const names: string[] = [];
    const data = parseRecordData(xml, {
      keyOf: (fileName, takenAt) => {
        names.push(`${fileName}|${takenAt}`);
        return `key:${fileName}`;
      },
    });
    const photos = [...data.sections, { blocks: data.classification }].flatMap((s) => s.blocks).flatMap((b) => (b.kind === "photos" ? b.photos : b.kind === "checklist" ? b.items.flatMap((i) => i.photos) : []));
    expect(photos.length).toBeGreaterThan(0);
    expect(photos.every((p) => p.storageKey === `key:${p.fileName}`)).toBe(true);
    expect(names.length).toBe(photos.length);
  });

  it("refuses a document that is not Record Data of this version", () => {
    const xml = recordDataXml(goldenData("A", "en"));
    expect(() => parseRecordData("<other/>")).toThrow(/not a Record Data document/);
    expect(() => parseRecordData(xml.replace("record-data/2", "record-data/3"))).toThrow(/not a Record Data document/);
    expect(() => parseRecordData("<recordData")).toThrow();
  });
});
