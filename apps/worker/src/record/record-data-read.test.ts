import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fallbackFonts } from "./fonts.ts";
import { fixtureImages, goldenData, goldenRecord, type GoldenCode } from "./golden-fixtures.ts";
import { recordHtml } from "./layout.ts";
import { photoFingerprints, recordPhotos, sectionsWithFingerprints, withFingerprints } from "./photo-fingerprints.ts";
import { parseRecord, parseRecordData } from "./record-data-read.ts";
import { recordDataXml, type RecordData, type RecordImages } from "./record-data.ts";

// Re-produce reads the stored Record Data back (RP-155): what it reads must print the
// same pages, and write the same document, as what was stored. Whoever adds to
// recordDataXml (RP-650, RP-147) extends the reader until these pass again. They run over
// the golden records (RP-151): every Code, in each record language, with the Form, tables,
// checklists, photos, Parties and the approval flow.

const codes: GoldenCode[] = ["A", "B", "C", "D", "owner", "cancelled", "rabaed-cancelled"];
const languages = ["bilingual", "ar", "en"] as const;
const cases = codes.flatMap((code) => languages.map((language) => [code, language] as const));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The golden record as the job writes it: each photo's image fingerprinted (here from its storage key). */
function fingerprinted(data: RecordData): RecordData {
  const keys = [...data.sections.flatMap((s) => s.blocks), ...data.classification].flatMap((b) => recordPhotos([b])).map((p) => p.storageKey);
  const fingerprints = new Map(keys.map((k) => [k, sha(k)]));
  return { ...data, classification: withFingerprints(data.classification, fingerprints), sections: sectionsWithFingerprints(data.sections, fingerprints) };
}

/** An appendix of every kind, its pages placed (RP-147). */
const APPENDIX: RecordData["appendix"] = [
  { way: "pages", fileName: "Shop drawing.pdf", sha256: sha("a"), pageCount: 3, pages: { first: 9, last: 11 } },
  { way: "pages", fileName: "Site photo.jpg", sha256: sha("b"), pageCount: 1, pages: { first: 12, last: 12 } },
  { way: "attached", fileName: "Model.dwg", sha256: sha("c"), tooManyPages: false },
  { way: "attached", fileName: "Long.pdf", sha256: sha("d"), tooManyPages: true },
  { way: "held", fileName: "Survey.zip", sha256: sha("e") },
];

/**
 * A golden record as the job stores it: every image it prints (Form photos, logos, Signatures,
 * Stamps) fingerprinted, here from its storage key, the pages page 1 points to and the appendix placed.
 */
function stored(code: GoldenCode, language: RecordData["language"]): { data: RecordData; marks: RecordImages; keyBySha: Map<string, string> } {
  const first = goldenRecord(code, language);
  const photoKeys = recordPhotos([...first.data.sections.flatMap((s) => s.blocks), ...first.data.classification]).map((p) => p.storageKey);
  const keys = [...photoKeys, ...first.images.logos, ...first.images.signatures, ...first.images.stamps].filter((k): k is string => k !== null);
  const { data, images } = goldenRecord(code, language, new Map(keys.map((k) => [k, sha(k)])));
  const pages = { comments: data.comments.length > 0 ? 4 : null, reply: data.reply?.cut && data.cards.length > 0 ? 6 : null };
  return { data: { ...data, pages, appendix: APPENDIX }, marks: images, keyBySha: new Map(keys.map((k) => [sha(k), k])) };
}

const fonts = fallbackFonts();

describe("parseRecordData", () => {
  it.each(cases)("writes the same document back from what it reads: Code %s, %s", (code, language) => {
    const xml = recordDataXml(stored(code, language).data);
    expect(recordDataXml(parseRecordData(xml))).toBe(xml);
  });

  it.each(cases)("reads Record Data that prints the same pages, with the same logos, Signatures and Stamps: Code %s, %s", (code, language) => {
    const { data, marks, keyBySha } = stored(code, language);
    const read = parseRecord(recordDataXml(data), { keyOf: (fingerprint) => keyBySha.get(fingerprint) ?? null });
    expect(read.marks).toEqual(marks);
    expect(recordHtml(read.data, fonts, fixtureImages, read.marks)).toBe(recordHtml(data, fonts, fixtureImages, marks));
  });

  it("flags a logo, Signature or Stamp it could not find again as not printed", () => {
    const { data } = stored("B", "en");
    const read = parseRecord(recordDataXml(data));
    expect([...read.marks.logos, ...read.marks.signatures, ...read.marks.stamps].every((k) => k === null)).toBe(true);
    expect(read.data.cards.some((c) => c.signature && c.signatureSha256)).toBe(true);
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
    expect(() => parseRecordData(xml.replace("record-data/4", "record-data/3"))).toThrow(/not a Record Data document/);
    expect(() => parseRecordData("<recordData")).toThrow();
  });
});
