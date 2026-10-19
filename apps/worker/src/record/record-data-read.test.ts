import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fallbackFonts } from "./fonts.ts";
import { goldenData, type GoldenCode } from "./golden-fixtures.ts";
import { recordHtml } from "./layout.ts";
import { photoFingerprints, recordPhotos, sectionsWithFingerprints, withFingerprints } from "./photo-fingerprints.ts";
import { parseRecordData } from "./record-data-read.ts";
import { recordDataXml, type RecordData } from "./record-data.ts";

// Re-produce reads the stored Record Data back (RP-155): what it reads must print the
// same pages, and write the same document, as what was stored. Whoever adds to
// recordDataXml (RP-650, RP-147) extends the reader until these pass again. They run over
// the golden records (RP-151): every Code, in each record language, with the Form, tables,
// checklists, photos, Parties and the approval flow.

const codes: GoldenCode[] = ["A", "C", "D"];
const languages = ["bilingual", "ar", "en"] as const;
const cases = codes.flatMap((code) => languages.map((language) => [code, language] as const));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The golden record as the job writes it: each photo's image fingerprinted (here from its storage key). */
function fingerprinted(data: RecordData): RecordData {
  const keys = [...data.sections.flatMap((s) => s.blocks), ...data.classification].flatMap((b) => recordPhotos([b])).map((p) => p.storageKey);
  const fingerprints = new Map(keys.map((k) => [k, sha(k)]));
  return { ...data, classification: withFingerprints(data.classification, fingerprints), sections: sectionsWithFingerprints(data.sections, fingerprints) };
}

const fonts = fallbackFonts();

describe("parseRecordData", () => {
  it.each(cases)("writes the same document back from what it reads: Code %s, %s", (code, language) => {
    const xml = recordDataXml(fingerprinted(goldenData(code, language)));
    expect(recordDataXml(parseRecordData(xml))).toBe(xml);
  });

  it.each(cases)("reads Record Data that prints the same pages: Code %s, %s", (code, language) => {
    const data = fingerprinted(goldenData(code, language));
    expect(recordHtml(parseRecordData(recordDataXml(data)), fonts)).toBe(recordHtml(data, fonts));
  });

  it("prints the same pages when the outcome is named rather than a short Code, and its look and chips are derived", () => {
    const base = goldenData("A", "bilingual");
    const named: RecordData = {
      ...base,
      outcome: { code: "passed", name: { ar: "ناجح", en: "Passed" }, look: null },
      chips: [
        { code: "passed", name: { ar: "ناجح", en: "Passed" }, issued: true },
        { code: "failed", name: { ar: "راسب", en: "Failed" }, issued: false },
      ],
    };
    const xml = recordDataXml(named);
    const read = parseRecordData(xml);
    expect(recordDataXml(read)).toBe(xml);
    expect(recordHtml(read, fonts)).toBe(recordHtml(named, fonts));
    // The look only marks the approval flow's last entry, and is read from that mark.
    for (const code of ["C", "D"] as const) {
      const coded = goldenData(code, "en");
      expect(parseRecordData(recordDataXml(coded)).outcome.look).toBe(coded.outcome.look);
    }
  });

  it("carries each printed photo's fingerprint, and reads it back for a Re-produce to find the file by", () => {
    const data = fingerprinted(goldenData("A", "en"));
    const written = recordPhotos([...data.sections.flatMap((s) => s.blocks), ...data.classification]);
    expect(written.length).toBeGreaterThan(0);
    expect(written.every((p) => p.sha256 === sha(p.storageKey))).toBe(true);
    const xml = recordDataXml(data);
    expect(xml.match(/<photo [^>]*sha256="[0-9a-f]{64}"/g)).toHaveLength(written.length);
    const asked: string[] = [];
    const read = parseRecordData(xml, {
      keyOf: (fingerprint) => {
        asked.push(fingerprint);
        return `key:${fingerprint}`;
      },
    });
    const photos = recordPhotos([...read.sections.flatMap((s) => s.blocks), ...read.classification]);
    expect(photos.map((p) => p.storageKey)).toEqual(photos.map((p) => `key:${p.sha256}`));
    expect(new Set(asked)).toEqual(photoFingerprints([...read.sections.flatMap((s) => s.blocks), ...read.classification]));
    // Two photos of one name are told apart by their fingerprints.
    const sameName = withFingerprints(
      [{ kind: "photos", label: { en: "Photos" }, photos: [1, 2].map((n) => ({ fileName: "IMG_0001.jpg", takenAt: null, storageKey: `k${n}`, sha256: null })) }],
      new Map([["k1", sha("one")], ["k2", sha("two")]]),
    );
    expect(photoFingerprints(sameName)).toEqual(new Set([sha("one"), sha("two")]));
  });

  it("leaves a photo the job did not inline without a fingerprint", () => {
    const data = goldenData("A", "en");
    expect(photoFingerprints([...data.sections.flatMap((s) => s.blocks), ...data.classification]).size).toBe(0);
    expect(recordDataXml(data)).not.toContain("sha256=");
  });

  it("refuses a document that is not Record Data of this version", () => {
    const xml = recordDataXml(goldenData("A", "en"));
    expect(() => parseRecordData("<other/>")).toThrow(/not a Record Data document/);
    expect(() => parseRecordData(xml.replace("record-data/2", "record-data/3"))).toThrow(/not a Record Data document/);
    expect(() => parseRecordData("<recordData")).toThrow();
  });
});
