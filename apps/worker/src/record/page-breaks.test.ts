import { createHash } from "node:crypto";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendixOf, renderWithAppendix } from "./appendix.ts";
import type { RecordFiles } from "./files.ts";
import { fallbackFonts } from "./fonts.ts";
import { fixtureImages, goldenFacts, goldenRecord, type GoldenCode } from "./golden-fixtures.ts";
import { renderRecord } from "./pages.ts";
import { chromiumRenderer, type PdfRenderer } from "./render.ts";

// Where the record's pages break (RP-1076; form-engine.md §6): a Signature card moves to the next
// page only when it does not fit, and the appendix's heading and intro print with its first Document.
// Each part looked for is wrapped in a link, which changes nothing in the layout; Chromium gives
// each link an annotation on the page it is drawn on, so the page of each part can be read back.

let renderer: PdfRenderer;
beforeAll(() => {
  renderer = chromiumRenderer();
});
afterAll(async () => {
  await renderer?.close();
});

const MARK = "https://mark.test/";
const link = (name: string, inner: string) => `<a href="${MARK}${name}">${inner}</a>`;

/** The record's HTML with its Signatures heading, each card's number and the appendix's heading, intro and first Document linked. */
function marked(html: string): string {
  const at = html.indexOf('<section class="appendix">');
  const [before, appendix] = at < 0 ? [html, ""] : [html.slice(0, at), html.slice(at)];
  return (
    before
      .replace(/(<section class="signatures"><h2 class="part">)([\s\S]*?)(<\/h2>)/, (_, a: string, h: string, b: string) => `${a}${link("signatures", h)}${b}`)
      .replace(/<div class="card-head"><span class="num">(\d+)<\/span>/g, (_, n: string) => `<div class="card-head">${link(`card-${n}`, `<span class="num">${n}</span>`)}`) +
    appendix
      .replace(/(<h2 class="part">)([\s\S]*?)(<\/h2>)/, (_, a: string, h: string, b: string) => `${a}${link("appendix", h)}${b}`)
      .replace(/(<div class="lead">)(<div[^>]*>)/, (_, a: string, d: string) => `${a}${d}${link("appendix-intro", ".")}`)
      .replace(/<td class="n">1<\/td>/, `<td class="n">${link("appendix-document-1", "1")}</td>`)
  );
}

/** A renderer that draws the record with its parts linked. */
const marking = (): PdfRenderer => ({ render: (html) => renderer.render(marked(html)), close: async () => undefined });

/** The page (from 1) each linked part starts on. */
function pagesOfMarks(doc: PDFDocument): Map<string, number> {
  const pages = new Map<string, number>();
  doc.getPages().forEach((page, index) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    for (const ref of annots?.asArray() ?? []) {
      const annot = doc.context.lookupMaybe(ref, PDFDict);
      const name = annot?.lookupMaybe(PDFName.of("A"), PDFDict)?.lookupMaybe(PDFName.of("URI"), PDFString)?.decodeText().slice(MARK.length);
      // A part pushed to the next page can leave a link of no height where its top margin was.
      const [, y1, , y2] = annot?.lookupMaybe(PDFName.of("Rect"), PDFArray)?.asArray().map((n) => Number(n.toString())) ?? [];
      if (name && Math.abs((y2 ?? 0) - (y1 ?? 0)) > 1 && !pages.has(name)) pages.set(name, index + 1);
    }
  });
  return pages;
}

async function drawn(code: GoldenCode, language: "bilingual" | "en" | "ar") {
  const { data, images } = goldenRecord(code, language);
  const { pdf } = await renderRecord(marking(), data, fallbackFonts(), fixtureImages, images);
  return pagesOfMarks(await PDFDocument.load(pdf));
}

/** Golden A with one Document the record carries inside it: the appendix is its list alone, with no page. */
async function withAttachedFile() {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const files: RecordFiles = { put: async () => {}, get: async () => bytes, sha256: async () => sha256 };
  const document = { fileName: "UAT-datasheet.zip", contentType: "application/zip", size: bytes.length, storageKey: "key/x", sha256, fieldKey: "datasheet", itemKey: null, takenAt: null };
  const appendix = await appendixOf({ ...goldenFacts("A", "bilingual"), documents: [document] }, files);
  expect(appendix.entries.map((e) => e.way)).toEqual(["attached"]);
  const { data, images } = goldenRecord("A", "bilingual");
  const made = await renderWithAppendix(marking(), data, fallbackFonts(), fixtureImages, images, appendix);  return pagesOfMarks(made.doc);
}

// Each test draws a record two or three times with Chromium: slower on CI than locally.
describe("where the record's pages break (RP-1076)", { timeout: 60_000 }, () => {
  it("prints a Signature card on the page that has room for it: only a card that does not fit moves on", async () => {
    // Golden B in English: the Signatures start at the top of page 3, with room for three cards.
    const pages = await drawn("B", "en");
    expect(pages.get("signatures")).toBe(pages.get("card-1"));
    expect([pages.get("card-2"), pages.get("card-3")]).toEqual([pages.get("card-1"), pages.get("card-1")]);
  });

  it("keeps the Signatures heading with the first card", async () => {
    for (const [code, language] of [["A", "bilingual"], ["B", "bilingual"], ["C", "en"]] as const) {
      const pages = await drawn(code, language);
      expect(pages.get("signatures"), `${code} ${language}`).toBe(pages.get("card-1"));
    }
  });

  it("prints the appendix's heading, its intro and its first Document on one page", async () => {
    const pages = await withAttachedFile();    expect(pages.get("appendix")).toBeDefined();
    expect([pages.get("appendix-intro"), pages.get("appendix-document-1")]).toEqual([pages.get("appendix"), pages.get("appendix")]);
  });
});
