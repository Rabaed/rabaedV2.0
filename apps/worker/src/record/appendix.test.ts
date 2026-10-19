import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { DocumentFact, RecordFacts } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import { APPENDIX_LIMIT_BYTES, appendixOf } from "./appendix.ts";
import type { RecordFiles } from "./files.ts";
import { goldenFacts } from "./golden-fixtures.ts";

// What the appendix makes of each shared Document (RP-147; form-engine.md §6, element 15), for
// the cases seam 1 (apps/api/test/documental-record-appendix.test.ts) can't upload through the
// test api: PDFs a PDF/A can't take as pages, a file whose bytes don't match its fingerprint or
// that is missing, and the production limit.

/** A hand-written PDF of one page with `content`, `filter` naming its stream's compression. */
function pdf(content: string, filter?: "FlateDecode" | "LZWDecode"): Uint8Array {
  const body = filter === "FlateDecode" ? deflateSync(Buffer.from(content)).toString("latin1") : content;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>",
    `<< /Length ${body.length}${filter ? ` /Filter /${filter}` : ""} >>\nstream\n${body}\nendstream`,
  ];
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

/** The facts of a closed item whose Documents are `files`, each in the Form's `datasheet` field, by name. */
function withFiles(files: Record<string, { bytes: Uint8Array; contentType: string; sha256?: string | null }>): { facts: RecordFacts; store: RecordFiles } {
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
  const store: RecordFiles = {
    put: async () => {},
    get: async (key) => {
      const name = key.slice("key/".length);
      return name in files ? files[name]!.bytes : null;
    },
  };
  return { facts: { ...goldenFacts("A", "en"), documents }, store };
}

const ways = async (facts: RecordFacts, store: RecordFiles, limit?: number) =>
  (await appendixOf(facts, store, limit)).entries.map((e) => [e.fileName, e.way, e.pageCount]);

describe("the appendix of a closed item", () => {
  it("takes a PDF's pages when a PDF/A can hold them, and carries one inside the PDF when it can't: LZW, CMYK", async () => {
    const { facts, store } = withFiles({
      "rgb.pdf": { bytes: pdf("0.2 0.6 0.4 rg 10 10 100 100 re f", "FlateDecode"), contentType: "application/pdf" },
      "cmyk.pdf": { bytes: pdf("0 0.5 1 0 k 10 10 100 100 re f", "FlateDecode"), contentType: "application/pdf" },
      "lzw.pdf": { bytes: pdf("0 0 0 rg", "LZWDecode"), contentType: "application/pdf" },
      "not-a.pdf": { bytes: Buffer.from("%PDF-1.7 not really"), contentType: "application/pdf" },
    });
    expect(await ways(facts, store)).toEqual([
      ["rgb.pdf", "pages", 1],
      ["cmyk.pdf", "attached", 0],
      ["lzw.pdf", "attached", 0],
      ["not-a.pdf", "attached", 0],
    ]);
  });

  it("carries a file inside byte for byte, under a unique name, as the record's source", async () => {
    const same = Buffer.from("one");
    const other = Buffer.from("two");
    const { facts } = withFiles({ a: { bytes: same, contentType: "text/plain" } });
    const docs = [
      { ...facts.documents[0]!, fileName: "notes.txt", storageKey: "k1", sha256: hex(same) },
      { ...facts.documents[0]!, fileName: "notes.txt", storageKey: "k2", sha256: hex(other) },
    ];
    const store: RecordFiles = { put: async () => {}, get: async (key) => (key === "k1" ? same : other) };
    const appendix = await appendixOf({ ...facts, documents: docs }, store);
    expect(appendix.attachments.map((a) => [a.name, a.relationship, Buffer.from(a.bytes).toString()])).toEqual([
      ["notes.txt", "Source", "one"],
      ["notes (2).txt", "Source", "two"],
    ]);
  });

  it("only lists, held in Rabaed, a file that would take it past the limit, and carries a smaller one after it", async () => {
    const { facts, store } = withFiles({
      "big.txt": { bytes: Buffer.alloc(900, 1), contentType: "text/plain" },
      "small.txt": { bytes: Buffer.alloc(50, 2), contentType: "text/plain" },
      "first.txt": { bytes: Buffer.alloc(100, 3), contentType: "text/plain" },
    });
    expect((await ways(facts, store, 200)).map(([name, way]) => [name, way])).toEqual([
      ["big.txt", "held"],
      ["small.txt", "attached"],
      ["first.txt", "attached"],
    ]);
    expect(APPENDIX_LIMIT_BYTES).toBe(100 * 1024 * 1024);
  });

  it("refuses a file whose bytes don't match its fingerprint, or that is missing, rather than make the record", async () => {
    const swapped = withFiles({ "swapped.pdf": { bytes: pdf("0 0 0 rg"), contentType: "application/pdf", sha256: "0".repeat(64) } });
    await expect(appendixOf(swapped.facts, swapped.store)).rejects.toThrow("does not match its fingerprint");
    const missing = withFiles({ "gone.pdf": { bytes: pdf("0 0 0 rg"), contentType: "application/pdf" } });
    await expect(appendixOf(missing.facts, { put: async () => {}, get: async () => null })).rejects.toThrow("missing from the file store");
  });

  it("gives a fingerprint to a Document from before fingerprints, from its bytes", async () => {
    const bytes = Buffer.from("old file");
    const { facts, store } = withFiles({ "old.txt": { bytes, contentType: "text/plain", sha256: null } });
    expect((await appendixOf(facts, store)).entries[0]!.sha256).toBe(hex(bytes));
  });
});
