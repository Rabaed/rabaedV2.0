import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { RecordFacts } from "@rabaed/db";
import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream, type PDFPage } from "pdf-lib";
import { APPENDIX_FRAME_MM } from "./appendix-layout.ts";
import type { RecordFiles } from "./files.ts";
import type { RecordFonts } from "./fonts.ts";
import { attachmentFieldKeysOf, isListedDocument } from "./form-content.ts";
import { recordHtml } from "./layout.ts";
import { renderRecord } from "./pages.ts";
import { fontProblems, type PdfA3Attachment } from "./pdfa.ts";
import type { AppendixEntry, RecordData, RecordImages } from "./record-data.ts";
import type { PdfRenderer } from "./render.ts";

// The record's appendix (ADR 0023; form-engine.md §6, element 15; workflow-engine.md §7 step 3;
// RP-147). It holds the whole submission: the shared Documents the Documents list names (the
// Attachments System Field and the Form's `attachments` fields; a Form photo is printed in the
// Form's grid instead), in Form order: the Form's fields in their order, each field's files in
// the order they were added, then the Attachments System Field's. Each one is, in that order:
//
// - given as pages: a PDF's own pages, each drawn into a page of the record, or an image on a
//   page of its own;
// - carried inside the PDF/A-3 as its source file (AFRelationship Source), opened from the
//   reader's paperclip: any other file, and, the one exception to "as pages", a PDF the record
//   can't give as pages (a font not embedded, LZW, CMYK, encrypted, unreadable, a content stream
//   past MAX_DECODED_STREAM_BYTES, or more than MAX_APPENDIX_PDF_PAGES pages), byte for byte;
// - or only listed, held in Rabaed, when carrying it would take the appendix past the size limit
//   (100 MB in production). Everything carried counts: pages, images and attached files alike,
//   by their stored size, so the record still opens on a phone. The walk is greedy, in the fixed
//   order: a file that doesn't fit is held, and a smaller one after it is still carried.
//
// Each is listed with its name and fingerprint (RP-618), as the Record Data lists it; a Document
// from before RP-618 is fingerprinted from its stored bytes (a held one streamed, never held in
// memory). Which Documents are shared is the facts' to say (app.documents_shared_before_close);
// a file whose bytes don't match its fingerprint, or that is missing from the store, fails the job
// (retried, then dead-lettered) rather than a record holding something other than what was
// submitted.
//
// Two entry points, for whatever makes the record's PDF (job.ts today): `appendixOf(facts,
// files, limit)` before rendering, then `renderWithAppendix(...)` in place of pages.ts's
// `renderRecord` (it calls it), and `Appendix.attachments` after the Record Data in the PDF/A-3
// step. Nothing else here makes or seals a PDF.

/** What the appendix carries in all, at most, in production: past it a file is only listed (spec RP-632). */
export const APPENDIX_LIMIT_BYTES = 100 * 1024 * 1024;

/** The most pages of one PDF the record gives as pages; a longer PDF travels attached (the 1 GiB worker draws them all). */
export const MAX_APPENDIX_PDF_PAGES = 300;

/** The most bytes one of a PDF's content streams may decode to before it is checked; past it the PDF travels attached. */
export const MAX_DECODED_STREAM_BYTES = 50 * 1024 * 1024;

/** The image types Chromium draws on a page; any other image (HEIC, DWG's `image/vnd.dwg`) travels as a file. */
const PAGE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface Appendix {
  readonly entries: readonly AppendixEntry[];
  /** The PDF of each entry given as PDF pages, by its index in `entries`: opened once, embedded once (renderWithAppendix). */
  readonly pdfs: ReadonlyMap<number, PDFDocument>;
  /** The data URL of each image given a page, by its storage key. */
  readonly images: ReadonlyMap<string, string>;
  /** The storage key of the image each entry draws on its page, in the entries' order (RecordImages.appendix): never in the Record Data. */
  readonly imageKeys: readonly (string | null)[];
  /** The files carried inside the PDF, in the list's order. */
  readonly attachments: readonly PdfA3Attachment[];
}

/** The appendix of a closed item: what each shared Document becomes, under `limitBytes` in all. */
export async function appendixOf(facts: RecordFacts, files: RecordFiles, limitBytes: number = APPENDIX_LIMIT_BYTES): Promise<Appendix> {
  const fields = [...attachmentFieldKeysOf(facts)];
  const rank = (fieldKey: string | null) => (fieldKey === null ? fields.length : fields.indexOf(fieldKey));
  const listed = facts.documents
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => isListedDocument(d, new Set(fields)))
    .sort((a, b) => rank(a.d.fieldKey) - rank(b.d.fieldKey) || a.i - b.i)
    .map(({ d }) => d);

  const entries: AppendixEntry[] = [];
  const pdfs = new Map<number, PDFDocument>();
  const images = new Map<string, string>();
  const imageKeys: (string | null)[] = [];
  const attachments: PdfA3Attachment[] = [];
  const names = new Set<string>();
  const missing = (d: { fileName: string }) => new Error(`the shared Document ${d.fileName} is missing from the file store`);
  let carried = 0;
  for (const d of listed) {
    imageKeys.push(null);
    if (carried + d.size > limitBytes) {
      const sha256 = d.sha256 ?? (await files.sha256(d.storageKey));
      if (sha256 === null) throw missing(d);
      entries.push({ way: "held", fileName: d.fileName, sha256 });
      continue;
    }
    const bytes = await files.get(d.storageKey);
    if (!bytes) throw missing(d);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (d.sha256 !== null && sha256 !== d.sha256) throw new Error(`the shared Document ${d.fileName} does not match its fingerprint`);
    carried += bytes.length;
    const file = { fileName: d.fileName, sha256 };
    const pdf = d.contentType === "application/pdf" ? await pageable(bytes) : null;
    if (pdf instanceof PDFDocument) {
      pdfs.set(entries.length, pdf);
      entries.push({ ...file, way: "pages", pageCount: pdf.getPageCount(), pages: null });
    } else if (PAGE_IMAGE_TYPES.has(d.contentType)) {
      images.set(d.storageKey, `data:${d.contentType};base64,${Buffer.from(bytes).toString("base64")}`);
      imageKeys[entries.length] = d.storageKey;
      entries.push({ ...file, way: "pages", pageCount: 1, pages: null });
    } else {
      entries.push({ ...file, way: "attached", tooManyPages: pdf === "too many pages" });
      attachments.push({
        name: uniqueName(d.fileName, names),
        mimeType: d.contentType,
        description: `Appendix ${entries.length}: ${d.fileName}`,
        bytes,
        // eslint-disable-next-line rabaed/no-avoid-terms -- ISO 32000's AFRelationship, as pdfa.ts writes it
        relationship: "Source",
      });
    }
  }
  return { entries, pdfs, images, imageKeys, attachments };
}

/** `name`, or `name (2)`… when an earlier file took it: the PDF's attachments are named uniquely. */
function uniqueName(name: string, taken: Set<string>): string {
  let unique = name;
  for (let n = 2; taken.has(unique); n++) unique = name.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`);
  taken.add(unique);
  return unique;
}

/**
 * The PDF, when its pages can be drawn into a PDF/A-3 as they are: it opens unencrypted, has
 * pages whose content is streams, embeds its fonts, uses neither LZW nor CMYK (the record's output
 * intent is sRGB), and no content stream decodes past MAX_DECODED_STREAM_BYTES. Null otherwise:
 * the file travels inside the record instead; "too many pages" past MAX_APPENDIX_PDF_PAGES (checked
 * first, so a long PDF is never decoded). Not a full validator (veraPDF is one); these are the
 * rules a submitted PDF most often breaks.
 */
async function pageable(bytes: Uint8Array): Promise<PDFDocument | "too many pages" | null> {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() > MAX_APPENDIX_PDF_PAGES) return "too many pages";
    if (pdf.getPageCount() === 0 || fontProblems(pdf).length > 0 || breaksPdfA(pdf)) return null;
    // Each page's content is a stream or an array of them, as pdf-lib embeds it (once, in renderWithAppendix).
    for (const i of drawnPages(pdf)) {
      const contents = pdf.getPage(i).node.Contents();
      const parts = contents instanceof PDFArray ? contents.asArray().map((p) => pdf.context.lookup(p)) : [contents];
      if (!parts.every((p) => p instanceof PDFStream)) return null;
    }
    return pdf;
  } catch {
    return null;
  }
}

/** The pages of `pdf` that draw anything: a page with no content is blank, and stays a blank frame. */
const drawnPages = (pdf: PDFDocument) => pdf.getPageIndices().filter((i) => pdf.getPage(i).node.Contents() !== undefined);

const CMYK_OPERATOR = /(?:^|\s)-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+[kK](?=\s|$)/;

/** The largest a stream in these filters can decode to, per encoded byte (RunLength's worst case). */
const WORST_EXPANSION = 128;

/** A content stream's decoded text, or null when it would decode past the cap (or can't be decoded). */
function decoded(stream: PDFRawStream): string | null {
  // eslint-disable-next-line rabaed/no-avoid-terms -- ISO 32000's name for a stream's compression
  const compression = stream.dict.lookup(PDFName.of("Filter"));
  try {
    if (compression === undefined) return Buffer.from(stream.contents).toString("latin1");
    // Flate, the usual one, inflated with a ceiling: zlib stops at it rather than holding the rest.
    if (compression === PDFName.of("FlateDecode")) return inflateSync(stream.contents, { maxOutputLength: MAX_DECODED_STREAM_BYTES }).toString("latin1");
    if (stream.contents.length * WORST_EXPANSION > MAX_DECODED_STREAM_BYTES) return null;
    return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  } catch {
    return null;
  }
}

/** Whether any stream of `pdf` is LZW-compressed, paints in CMYK (a colour space or the k/K operators), or decodes past the cap. */
function breaksPdfA(pdf: PDFDocument): boolean {
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && usesCmyk(object)) return true;
    if (!(object instanceof PDFRawStream)) continue;
    // eslint-disable-next-line rabaed/no-avoid-terms -- ISO 32000's name for a stream's compression
    const compression = object.dict.lookup(PDFName.of("Filter"));
    const filters = compression instanceof PDFArray ? compression.asArray() : [compression];
    if (filters.some((f) => f === PDFName.of("LZWDecode"))) return true;
    if (usesCmyk(object.dict)) return true;
    const subtype = object.dict.lookup(PDFName.of("Subtype"));
    // Content streams: a page's (no Subtype) and a form's. Images and fonts paint no operators.
    if (subtype !== undefined && subtype !== PDFName.of("Form")) continue;
    if (object.dict.lookup(PDFName.of("Length1")) !== undefined) continue;
    const text = decoded(object);
    if (text === null || CMYK_OPERATOR.test(text) || text.includes("/DeviceCMYK")) return true;
  }
  return false;
}

function usesCmyk(dict: PDFDict): boolean {
  const space = dict.lookup(PDFName.of("ColorSpace"));
  if (space === PDFName.of("DeviceCMYK")) return true;
  if (space instanceof PDFDict) return space.values().some((v) => dict.context.lookup(v) === PDFName.of("DeviceCMYK"));
  return false;
}

/** Where a rendered page's frame is, in its PDF points, for an appended PDF's page to be drawn into. */
function frameOf(page: PDFPage): { x: number; y: number; width: number; height: number } {
  const mm = 72 / 25.4;
  const { height } = page.getSize();
  return {
    x: APPENDIX_FRAME_MM.left * mm,
    y: height - (APPENDIX_FRAME_MM.top + APPENDIX_FRAME_MM.height) * mm,
    width: APPENDIX_FRAME_MM.width * mm,
    height: APPENDIX_FRAME_MM.height * mm,
  };
}

/** A placeholder page number as wide as the record's, for the render that finds where the appendix's pages start. */
const PROBE_PAGE = 888;

/**
 * The record's PDF with its appendix, and its Record Data with the pages the appendix's list
 * names. The record is rendered as pages.ts renders it (with the pages page 1 points to); when
 * the appendix gives pages, it is drawn once more up to the end of its list (the `appendixList`
 * cut), to count where they start, then once with those numbers, and each appended PDF's pages
 * are embedded and drawn into their frames.
 */
export async function renderWithAppendix(
  renderer: PdfRenderer,
  record: RecordData,
  fonts: RecordFonts,
  recordImages: ReadonlyMap<string, string>,
  recordMarks: RecordImages,
  { entries, pdfs, images: appendixImages, imageKeys }: Appendix,
): Promise<{ data: RecordData; pdf: Uint8Array }> {
  const data = { ...record, appendix: entries };
  const images = new Map([...recordImages, ...appendixImages]);
  const marks: RecordImages = { ...recordMarks, appendix: imageKeys };
  const givesPages = entries.some((f) => f.way === "pages");
  const probe = { ...data, appendix: entries.map((f) => (f.way === "pages" ? { ...f, pages: { first: PROBE_PAGE, last: PROBE_PAGE } } : f)) };
  const rendered = await renderRecord(renderer, givesPages ? probe : data, fonts, images, marks);
  if (!givesPages) return rendered;

  const listEnds = (await PDFDocument.load(await renderer.render(recordHtml(rendered.data, fonts, images, marks, { appendixList: true })), { updateMetadata: false })).getPageCount();
  let next = listEnds + 1;
  const appendix = entries.map((f) => {
    if (f.way !== "pages") return f;
    const pages = { first: next, last: next + f.pageCount - 1 };
    next += f.pageCount;
    return { ...f, pages };
  });
  const placed = { ...rendered.data, appendix };
  const out = await PDFDocument.load(await renderer.render(recordHtml(placed, fonts, images, marks)), { updateMetadata: false });
  if (out.getPageCount() !== next - 1) throw new Error(`the appendix's pages did not land where its list says (${out.getPageCount()} pages, ${next - 1} expected)`);

  for (const [index, source] of pdfs) {
    const entry = appendix[index]!;
    if (entry.way !== "pages" || !entry.pages) continue;
    const drawn = drawnPages(source);
    const embedded = await out.embedPdf(source, drawn);
    embedded.forEach((page, j) => {
      const k = drawn[j]!;
      const target = out.getPage(entry.pages!.first - 1 + k);
      const frame = frameOf(target);
      const turn = ((source.getPage(k).getRotation().angle % 360) + 360) % 360;
      const sideways = turn === 90 || turn === 270;
      // As a reader shows it: a page's /Rotate turns it clockwise.
      const shownWidth = sideways ? page.height : page.width;
      const shownHeight = sideways ? page.width : page.height;
      const scale = Math.min(frame.width / shownWidth, frame.height / shownHeight);
      const x0 = frame.x + (frame.width - shownWidth * scale) / 2;
      const y0 = frame.y + (frame.height - shownHeight * scale) / 2;
      const w = page.width * scale;
      const h = page.height * scale;
      const origin = turn === 90 ? { x: x0, y: y0 + w } : turn === 180 ? { x: x0 + w, y: y0 + h } : turn === 270 ? { x: x0 + h, y: y0 } : { x: x0, y: y0 };
      target.drawPage(page, { ...origin, xScale: scale, yScale: scale, rotate: degrees(-turn) });
    });
  }
  return { data: placed, pdf: await out.save({ useObjectStreams: false }) };
}
