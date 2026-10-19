import { PDFDocument } from "pdf-lib";
import type { RecordFonts } from "./fonts.ts";
import { recordHtml, type RecordCut } from "./layout.ts";
import type { RecordData } from "./record-data.ts";
import type { PdfRenderer } from "./render.ts";

// The pages page 1 points to (form-engine.md §6, elements 5 and 6): where the Review Comments
// start, and the page of the issuing card that holds the reply's full text. Chromium has no
// `target-counter`, so the record is drawn up to that part and its pages are counted: the
// Comments always start a page; a card never breaks across one (`break-inside: avoid`), so
// it is on the last page of a draw that ends with it. Then the record is drawn once more, with
// the pages it names, and the Record Data holds them, as it holds everything the pages print.
// A record with neither (no Comments, a reply page 1 prints whole) is drawn once.

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
): Promise<{ data: RecordData; pdf: Uint8Array }> {
  // The pointer to the reply's full text is printed only when page 1 cut it short (replyExcerpt ends it with "…").
  const issuing = data.reply?.endsWith("…") ? data.cards.length - 1 : -1;
  if (data.comments.length === 0 && issuing < 0) return { data, pdf: await renderer.render(recordHtml(data, fonts, images)) };
  const probe = { ...data, pages: { comments: data.comments.length > 0 ? PROBE_PAGE : null, reply: issuing >= 0 ? PROBE_PAGE : null } };
  const count = (cut: RecordCut) => pagesOf(renderer, recordHtml(probe, fonts, images, cut));
  const comments = data.comments.length > 0 ? (await count({ beforeComments: true })) + 1 : null;
  // The issuing card is the last: never broken across pages, it ends, so starts, on the probe's last page
  // (one taller than a page, Remarks of thousands of characters, starts a page earlier: a rare miss of one).
  const reply = issuing >= 0 ? await count({ card: issuing, withCard: true }) : null;
  const placed = { ...data, pages: { comments, reply } };
  return { data: placed, pdf: await renderer.render(recordHtml(placed, fonts, images)) };
}
