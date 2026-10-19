import { PDFDocument } from "pdf-lib";
import type { RecordFonts } from "./fonts.ts";
import { recordHtml, type RecordCut } from "./layout.ts";
import type { RecordData } from "./record-data.ts";
import type { PdfRenderer } from "./render.ts";

// The pages page 1 points to (form-engine.md §6, elements 5 and 6): where the Review Comments
// start, and the page of the issuing card that holds the reply's full text. Chromium has no
// `target-counter`, so the record is drawn up to that part and its pages are counted: the
// Comments always start a page; a card never breaks across one (`break-inside: avoid`), so
// it starts on the last page of a draw that ends with it, unless that draw is a page longer
// than the one that ends just before it. Then the record is drawn once more, with the pages
// it names, and the Record Data holds them, as it holds everything the pages print.

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
  const issuing = data.reply === null ? -1 : data.cards.length - 1;
  if (data.comments.length === 0 && issuing < 0) return { data, pdf: await renderer.render(recordHtml(data, fonts, images)) };
  const probe = { ...data, pages: { comments: data.comments.length > 0 ? PROBE_PAGE : null, reply: issuing >= 0 ? PROBE_PAGE : null } };
  const count = (cut: RecordCut) => pagesOf(renderer, recordHtml(probe, fonts, images, cut));
  const comments = data.comments.length > 0 ? (await count({ beforeComments: true })) + 1 : null;
  let reply: number | null = null;
  if (issuing >= 0) {
    const before = await count({ card: issuing, withCard: false });
    const through = await count({ card: issuing, withCard: true });
    reply = through > before ? before + 1 : before;
  }
  const placed = { ...data, pages: { comments, reply } };
  return { data: placed, pdf: await renderer.render(recordHtml(placed, fonts, images)) };
}
