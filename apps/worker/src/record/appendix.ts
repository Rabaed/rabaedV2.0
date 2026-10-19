import { createHash } from "node:crypto";
import type { RecordFacts } from "@rabaed/db";
import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, type PDFPage } from "pdf-lib";
import { APPENDIX_FRAME_MM } from "./appendix-layout.ts";
import type { RecordFiles } from "./files.ts";
import type { RecordFonts } from "./fonts.ts";
import { attachmentFieldKeysOf, isListedDocument } from "./form-content.ts";
import { recordHtml } from "./layout.ts";
import { renderRecord } from "./pages.ts";
import { fontProblems, type PdfA3Attachment } from "./pdfa.ts";
import type { AppendixEntry, RecordData } from "./record-data.ts";
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
//   reader's paperclip: any other file, and a PDF whose pages a PDF/A can't hold as they are (a
//   font not embedded, LZW, CMYK, encrypted or unreadable as a PDF), byte for byte;
// - or, once what the appendix carries would pass the size limit (100 MB in production), only
//   listed, held in Rabaed. A smaller file after it may still be carried.
//
// Each is listed with its name and fingerprint (RP-618), as the Record Data lists it. Which
// Documents are shared is the facts' to say (app.documental_record_facts: the ones the other
// Participants saw, never one only its holder saw); a file whose bytes don't match its
// fingerprint, or that is missing from the store, fails the job (retried, then dead-lettered),
// rather than a record holding something other than what was submitted.
//
// Two entry points, for whatever makes the record's PDF (job.ts today): `appendixOf(facts,
// files, limit)` before rendering, then `renderWithAppendix(...)` in place of pages.ts's
// `renderRecord` (it calls it), and `Appendix.attachments` after the Record Data in the PDF/A-3
// step. Nothing else here makes or seals a PDF.

/** What the appendix carries in all, at most, in production: past it a file is only listed (spec RP-632). */
export const APPENDIX_LIMIT_BYTES = 100 * 1024 * 1024;

/** The image types Chromium draws on a page; any other image (HEIC, DWG's `image/vnd.dwg`) travels as a file. */
const PAGE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface Appendix {
  readonly entries: readonly AppendixEntry[];
  /** The PDF of each entry given as PDF pages, by its index in `entries`. */
  readonly pdfs: ReadonlyMap<number, PDFDocument>;
  /** The data URL of each image given a page, by its key. */
  readonly images: ReadonlyMap<string, string>;
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
  const attachments: PdfA3Attachment[] = [];
  const names = new Set<string>();
  let carried = 0;
  for (const d of listed) {
    const entry = { fileName: d.fileName, sha256: d.sha256, pages: null, pageCount: 0, imageKey: null };
    if (carried + d.size > limitBytes) {
      entries.push({ ...entry, way: "held" });
      continue;
    }
    const bytes = await files.get(d.storageKey);
    if (!bytes) throw new Error(`the shared Document ${d.fileName} is missing from the file store`);
    const fingerprint = createHash("sha256").update(bytes).digest("hex");
    if (d.sha256 !== null && fingerprint !== d.sha256) throw new Error(`the shared Document ${d.fileName} does not match its fingerprint`);
    carried += bytes.length;
    const pdf = d.contentType === "application/pdf" ? await pageable(bytes) : null;
    if (pdf) {
      pdfs.set(entries.length, pdf);
      entries.push({ ...entry, sha256: fingerprint, way: "pages", pageCount: pdf.getPageCount() });
    } else if (PAGE_IMAGE_TYPES.has(d.contentType)) {
      images.set(d.storageKey, `data:${d.contentType};base64,${Buffer.from(bytes).toString("base64")}`);
      entries.push({ ...entry, sha256: fingerprint, way: "pages", pageCount: 1, imageKey: d.storageKey });
    } else {
      entries.push({ ...entry, sha256: fingerprint, way: "attached" });
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
  return { entries, pdfs, images, attachments };
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
 * pages, embeds its fonts, and uses neither LZW nor CMYK (the record's output intent is sRGB).
 * Null otherwise: the file travels inside the record instead. Not a full validator (veraPDF
 * is one); these are the rules a submitted PDF most often breaks.
 */
async function pageable(bytes: Uint8Array): Promise<PDFDocument | null> {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() === 0 || fontProblems(pdf).length > 0 || breaksPdfA(pdf)) return null;
    // Its pages can be embedded at all (a broken content stream can't). pdf-lib embeds lazily, so each is embedded now.
    for (const page of await (await PDFDocument.create()).embedPdf(pdf, drawnPages(pdf))) await page.embed();
    return pdf;
  } catch {
    return null;
  }
}

/** The pages of `pdf` that draw anything: a page with no content is blank, and stays a blank frame. */
const drawnPages = (pdf: PDFDocument) => pdf.getPageIndices().filter((i) => pdf.getPage(i).node.Contents() !== undefined);

const CMYK_OPERATOR = /(?:^|\s)-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+[kK](?=\s|$)/;

/** Whether any stream of `pdf` is LZW-compressed or paints in CMYK (a colour space or the k/K operators). */
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
    const text = Buffer.from(decodePDFRawStream(object).decode()).toString("latin1");
    if (CMYK_OPERATOR.test(text) || text.includes("/DeviceCMYK")) return true;
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
 * the appendix gives pages, it is drawn once more up to the end of its list, to count where they
 * start, then once with those numbers, and each appended PDF's pages are drawn into their frames.
 */
export async function renderWithAppendix(
  renderer: PdfRenderer,
  record: RecordData,
  fonts: RecordFonts,
  recordImages: ReadonlyMap<string, string>,
  { entries, pdfs, images: appendixImages }: Appendix,
): Promise<{ data: RecordData; pdf: Uint8Array }> {
  const data = { ...record, appendix: entries };
  const images = new Map([...recordImages, ...appendixImages]);
  const givesPages = data.appendix.some((f) => f.way === "pages");
  const probe = { ...data, appendix: data.appendix.map((f) => (f.way === "pages" ? { ...f, pages: { first: PROBE_PAGE, last: PROBE_PAGE } } : f)) };
  const rendered = await renderRecord(renderer, givesPages ? probe : data, fonts, images);
  if (!givesPages) return rendered;

  const listEnds = (await PDFDocument.load(await renderer.render(recordHtml(rendered.data, fonts, images, undefined, false)), { updateMetadata: false })).getPageCount();
  let next = listEnds + 1;
  const appendix = data.appendix.map((f) => {
    if (f.way !== "pages") return f;
    const pages = { first: next, last: next + f.pageCount - 1 };
    next += f.pageCount;
    return { ...f, pages };
  });
  const placed = { ...rendered.data, appendix };
  const out = await PDFDocument.load(await renderer.render(recordHtml(placed, fonts, images)), { updateMetadata: false });
  if (out.getPageCount() !== next - 1) throw new Error(`the appendix's pages did not land where its list says (${out.getPageCount()} pages, ${next - 1} expected)`);

  for (const [index, source] of pdfs) {
    const at = appendix[index]!.pages!.first - 1;
    const drawn = drawnPages(source);
    const embedded = await out.embedPdf(source, drawn);
    embedded.forEach((page, j) => {
      const k = drawn[j]!;
      const target = out.getPage(at + k);
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
