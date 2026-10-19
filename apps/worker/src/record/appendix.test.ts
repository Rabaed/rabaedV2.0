import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { DocumentFact, RecordFacts } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import { APPENDIX_LIMIT_BYTES, appendixOf, MAX_APPENDIX_PDF_PAGES, MAX_DECODED_STREAM_BYTES } from "./appendix.ts";
import type { RecordFiles } from "./files.ts";
import { goldenFacts } from "./golden-fixtures.ts";

// What the appendix makes of each shared Document (RP-147; form-engine.md §6, element 15), for
// the cases seam 1 (apps/api/test/documental-record-appendix.test.ts) can't upload through the
// test api: PDFs the record can't give as pages, the caps that keep the 1 GiB worker safe, the
// size limit counting everything, a file whose bytes don't match its fingerprint or that is
// missing, and a Document from before fingerprints.

/** A hand-written PDF: one page per entry of `contents` (null: a page with no content), each stream compressed by `filter`. */
function pdf(contents: readonly (string | null)[], filter?: "FlateDecode" | "LZWDecode"): Buffer {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids: string[] = [];
  for (const content of contents) {
    const pageNo = objects.length + 1;
    kids.push(`${pageNo} 0 R`);
    if (content === null) {
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>`);
      continue;
    }
    const body = filter === "FlateDecode" ? deflateSync(Buffer.from(content)).toString("latin1") : content;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${pageNo + 1} 0 R /Resources << >> >>`);
    objects.push(`<< /Length ${body.length}${filter ? ` /Filter /${filter}` : ""} >>\nstream\n${body}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

interface StoredFile {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** The fingerprint the Document holds: its bytes' unless set (null: before RP-618). */
  readonly sha256?: string | null;
}

/** The facts of a closed item whose Documents are `files`, each in the Form's `datasheet` field, by name, and a store that holds them. */
function withFiles(files: Record<string, StoredFile>): { facts: RecordFacts; store: RecordFiles & { reads: string[] } } {
  const documents: DocumentFact[] = Object.entries(files).map(([name, f]) => ({
    fileName: name,
    contentType: f.contentType,
    size: f.bytes.length,
    storageKey: `key/${name}`,
    sha256: f.sha256 === undefined ? hex(f.bytes) : f.sha256,
    fieldKey: "datasheet",
    itemKey: null,
    takenAt: null,
  }));
  const reads: string[] = [];
  const bytesOf = (key: string) => files[key.slice("key/".length)]?.bytes ?? null;
  const store = {
    reads,
    put: async () => {},
    get: async (key: string) => {
      reads.push(key);
      return bytesOf(key);
    },
    sha256: async (key: string) => {
      const bytes = bytesOf(key);
      return bytes ? hex(bytes) : null;
    },
  };
  return { facts: { ...goldenFacts("A", "en"), documents }, store };
}

const ways = async (facts: RecordFacts, store: RecordFiles, limit?: number) =>
  (await appendixOf(facts, store, limit)).entries.map((e) => [e.fileName, e.way]);

describe("the appendix of a closed item", () => {
  it("gives a PDF's pages when a PDF/A can hold them, and carries one inside the PDF when it can't: LZW, CMYK, not a PDF", async () => {
    const { facts, store } = withFiles({
      "rgb.pdf": { bytes: pdf(["0.2 0.6 0.4 rg 10 10 100 100 re f", null], "FlateDecode"), contentType: "application/pdf" },
      "cmyk.pdf": { bytes: pdf(["0 0.5 1 0 k 10 10 100 100 re f"], "FlateDecode"), contentType: "application/pdf" },
      "lzw.pdf": { bytes: pdf(["0 0 0 rg"], "LZWDecode"), contentType: "application/pdf" },
      "not-a.pdf": { bytes: Buffer.from("%PDF-1.7 not really"), contentType: "application/pdf" },
    });
    const { entries } = await appendixOf(facts, store);
    expect(entries.map((e) => [e.fileName, e.way, e.way === "pages" ? e.pageCount : e.way === "attached" ? e.tooManyPages : null])).toEqual([
      ["rgb.pdf", "pages", 2],
      ["cmyk.pdf", "attached", false],
      ["lzw.pdf", "attached", false],
      ["not-a.pdf", "attached", false],
    ]);
  });

  it("carries a PDF whose content stream decodes past the cap, without decoding it whole", async () => {
    // Spaces compress a thousandfold: a small file that would inflate past the cap.
    const bomb = " ".repeat(MAX_DECODED_STREAM_BYTES + 1024);
    const { facts, store } = withFiles({ "bomb.pdf": { bytes: pdf([bomb], "FlateDecode"), contentType: "application/pdf" } });
    expect(await ways(facts, store)).toEqual([["bomb.pdf", "attached"]]);
  });

  it(`carries a PDF of more than ${MAX_APPENDIX_PDF_PAGES} pages, and says it has too many pages to show`, async () => {
    const { facts, store } = withFiles({
      "long.pdf": { bytes: pdf(Array.from({ length: MAX_APPENDIX_PDF_PAGES + 1 }, () => null)), contentType: "application/pdf" },
      "at-the-cap.pdf": { bytes: pdf(Array.from({ length: MAX_APPENDIX_PDF_PAGES }, () => null)), contentType: "application/pdf" },
    });
    const { entries, attachments } = await appendixOf(facts, store);
    expect(entries.map((e) => [e.fileName, e.way, e.way === "attached" && e.tooManyPages])).toEqual([
      ["long.pdf", "attached", true],
      ["at-the-cap.pdf", "pages", false],
    ]);
    expect(attachments.map((a) => a.name)).toEqual(["long.pdf"]);
  });

  it("carries a file inside byte for byte, under a unique name, as the record's source", async () => {
    const same = Buffer.from("one");
    const other = Buffer.from("two");
    const { facts } = withFiles({ a: { bytes: same, contentType: "text/plain" } });
    const docs = [
      { ...facts.documents[0]!, fileName: "notes.txt", storageKey: "k1", sha256: hex(same) },
      { ...facts.documents[0]!, fileName: "notes.txt", storageKey: "k2", sha256: hex(other) },
    ];
    const store: RecordFiles = { put: async () => {}, get: async (key) => (key === "k1" ? same : other), sha256: async () => null };
    const appendix = await appendixOf({ ...facts, documents: docs }, store);
    expect(appendix.attachments.map((a) => [a.name, a.relationship, Buffer.from(a.bytes).toString()])).toEqual([
      ["notes.txt", "Source", "one"],
      ["notes (2).txt", "Source", "two"],
    ]);
  });

  it("counts pages, images and attached files alike toward the limit: in order, each that fits is carried, each that doesn't is held, and a smaller one after is still carried", async () => {
    const page = pdf(["0 0 0 rg 10 10 50 50 re f"]);
    const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 1)]);
    const { facts, store } = withFiles({
      "plan.pdf": { bytes: page, contentType: "application/pdf" },
      "photo.png": { bytes: image, contentType: "image/png" },
      "big.txt": { bytes: Buffer.alloc(400, 2), contentType: "text/plain" },
      "small.txt": { bytes: Buffer.alloc(50, 3), contentType: "text/plain" },
    });
    // The PDF and the image alone leave less room than the big file needs, but enough for the small one.
    const limit = page.length + image.length + 100;
    expect(await ways(facts, store, limit)).toEqual([
      ["plan.pdf", "pages"],
      ["photo.png", "pages"],
      ["big.txt", "held"],
      ["small.txt", "attached"],
    ]);
    // Without the pages and the image counted, the big file would have fitted.
    expect(400 + 50).toBeLessThan(limit);
    expect(APPENDIX_LIMIT_BYTES).toBe(100 * 1024 * 1024);
  });

  it("refuses a file whose bytes don't match its fingerprint, or that is missing, rather than make the record", async () => {
    const swapped = withFiles({ "swapped.pdf": { bytes: pdf(["0 0 0 rg"]), contentType: "application/pdf", sha256: "0".repeat(64) } });
    await expect(appendixOf(swapped.facts, swapped.store)).rejects.toThrow("does not match its fingerprint");
    const missing = withFiles({ "gone.pdf": { bytes: pdf(["0 0 0 rg"]), contentType: "application/pdf" } });
    const empty: RecordFiles = { put: async () => {}, get: async () => null, sha256: async () => null };
    await expect(appendixOf(missing.facts, empty)).rejects.toThrow("missing from the file store");
    // A held one is read only when it has no fingerprint to list.
    const unread = withFiles({ "gone.txt": { bytes: Buffer.from("x"), contentType: "text/plain", sha256: null } });
    await expect(appendixOf(unread.facts, empty, 0)).rejects.toThrow("missing from the file store");
  });

  it("fingerprints a Document from before fingerprints from its stored bytes, a held one without reading it whole", async () => {
    const old = Buffer.from("old file");
    const held = Buffer.alloc(500, 4);
    const { facts, store } = withFiles({
      "old.txt": { bytes: old, contentType: "text/plain", sha256: null },
      "held.txt": { bytes: held, contentType: "text/plain", sha256: null },
    });
    const { entries } = await appendixOf(facts, store, 100);
    expect(entries.map((e) => [e.fileName, e.way, e.sha256])).toEqual([
      ["old.txt", "attached", hex(old)],
      ["held.txt", "held", hex(held)],
    ]);
    expect(store.reads).toEqual(["key/old.txt"]);
  });
});
