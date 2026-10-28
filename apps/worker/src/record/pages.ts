import { PDFDocument } from "pdf-lib";
import type { RecordFonts } from "./fonts.ts";
import { recordHtml, type RecordCut } from "./layout.ts";
import type { RecordData, RecordImages } from "./record-data.ts";
import type { PdfRenderer } from "./render.ts";

// The pages page 1 points to (form-engine.md §6, elements 5 and 6): where the Review Comments
// start, and where the reply's full text is, in the answers of the issuing card. Chromium has no
// `target-counter`, so the record is drawn up to that part and its pages are counted. Each starts
// on the last page of its draw: the Comments run on after the Documents (RP-1059), and their
// heading, first author and first Comment print together, so a draw that stops after them ends on
// the page they start on; the issuing card's answers follow its head with nothing between, so they
// start on the last page of a draw that stops after its head. Then the record is drawn once more, with the pages
// it names, and the Record Data holds them, as it holds everything the pages print. A record
// with neither (no Comments, a reply page 1 prints whole) is drawn once.

/** A placeholder as wide as a page number, so a probe's page 1 wraps as the record's does. */
const PROBE_PAGE = 88;

async function pagesOf(renderer: PdfRenderer, html: string): Promise<number> {
  const pdf = await PDFDocument.load(await renderer.render(html), { updateMetadata: false });
  return pdf.getPageCount();
}

/** The record's PDF, and its Record Data with the pages its pointers name. */
export async function renderRecord(
  renderer: PdfRenderer,
  data: RecordData,
  fonts: RecordFonts,
  images: ReadonlyMap<string, string>,
  marks: RecordImages,
): Promise<{ data: RecordData; pdf: Uint8Array }> {
  const hasComments = data.comments.length > 0;
  const pointsToReply = data.reply?.cut === true && data.cards.length > 0;
  if (!hasComments && !pointsToReply) return { data, pdf: await renderer.render(recordHtml(data, fonts, images, marks)) };
  const probe = { ...data, pages: { comments: hasComments ? PROBE_PAGE : null, reply: pointsToReply ? PROBE_PAGE : null } };
  const count = (cut: RecordCut) => pagesOf(renderer, recordHtml(probe, fonts, images, marks, cut));
  const comments = hasComments ? await count({ commentsStart: true }) : null;
  const reply = pointsToReply ? await count({ replyCard: true }) : null;
  const placed = { ...data, pages: { comments, reply } };
  return { data: placed, pdf: await renderer.render(recordHtml(placed, fonts, images, marks)) };
}
