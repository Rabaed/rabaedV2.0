import { isAnnotatedCopy, type DocumentSummary } from "@rabaed/domain";

/**
 * The Submittal Panel's Attachments (RP-1068, spec RP-1054, README §7, owner decision C3): what a
 * file previews as, zoom, the page shown, and which layer Esc closes. Plain data, tested on its own.
 */

/** A PDF renders its pages (pdf.js), an image shows the photo; anything else is Download only. */
export type SubmittalPanelAttachmentKind = "pdf" | "image" | "other";

/** The images a browser draws, as the item page's thumbnails show them (`use-documents.ts`). */
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function attachmentKind(contentType: string): SubmittalPanelAttachmentKind {
  if (contentType === "application/pdf") return "pdf";
  return imageTypes.has(contentType) ? "image" : "other";
}

/** Zoom steps, as the design has them (`drawer.js`): 10% in the inline preview, 25% in Open large. */
export const attachmentZoomStep = { preview: 10, large: 25 } as const;
const minZoom = 50;
const maxZoom = 300;

/** The zoom after a step (`delta`, negative to zoom out), kept between 50% and 300%. */
export function attachmentZoom(zoom: number, delta: number): number {
  return Math.min(maxZoom, Math.max(minZoom, zoom + delta));
}

/** The layer Esc closes: Open large before the inline preview; null leaves Esc to the panel. */
export function attachmentLayerToClose(open: { large: string | null; preview: string | null }): "large" | "preview" | null {
  if (open.large !== null) return "large";
  return open.preview !== null ? "preview" : null;
}

/** The page shown (1-based): the last whose top has reached the top of the scroll area. */
export function attachmentPageAt(scrollTop: number, pageTops: readonly number[]): number {
  let page = 1;
  pageTops.forEach((top, i) => {
    if (top <= scrollTop) page = i + 1;
  });
  return page;
}

/**
 * The files the section lists: every Document the viewer reads (the api leaves out what they may
 * not see), the Form's fields' files too, in order; a photo's annotated copy is shown beside its
 * original by the photo tool, never as a file of its own.
 */
export function submittalPanelAttachmentDocuments(documents: readonly DocumentSummary[]): DocumentSummary[] {
  return documents.filter((d) => !isAnnotatedCopy(d));
}
