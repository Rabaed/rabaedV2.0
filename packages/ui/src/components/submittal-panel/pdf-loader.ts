/**
 * pdf.js for the Attachments preview (RP-1068, owner decision C3), in the browser only: it is
 * imported when a PDF is first opened, never while the server renders the page (pdf.js reaches
 * for the canvas when it loads). The worker is this package's own copy of pdf.js's, served by
 * whichever bundler builds the app (Next) or the stories (Vite), so it comes from the app's origin.
 */
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let pdfjs: Promise<PdfJs> | undefined;

function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return lib;
  });
  return pdfjs;
}

/** The most pixels one page's canvas is given. */
const maxCanvasPixels = 16_000_000;

/** A page drawing that can be stopped, when the zoom or the page changes before it is done. */
export type PdfRender = { done: Promise<void>; cancel: () => void };

export type LoadedPdf = {
  pages: number;
  /**
   * Page `page`'s width over its height: its own once it has been read to be drawn, until then
   * the first page's (most sets keep one sheet size, so a page's box rarely changes when drawn).
   */
  aspect: (page: number) => number;
  /**
   * Draws page `page` (1-based) `width` CSS pixels wide, sharp on this screen; its `aspect` is
   * its own by then. `done` rejects once cancelled, which `isCancelled` tells apart from a failure.
   */
  render: (page: number, canvas: HTMLCanvasElement, width: number) => PdfRender;
  destroy: () => void;
};

/** A page's width over its height, at its own size. */
function aspectOf(page: PDFPageProxy): number {
  const viewport = page.getViewport({ scale: 1 });
  return viewport.width / viewport.height;
}

/**
 * Opens a PDF from its bytes. The whole Document is read before it is opened, rather than pdf.js
 * asking the file store for parts of it later, after the signed URL has expired (5 minutes) and
 * with range requests the file store's CORS doesn't answer. Only the first page is read here;
 * every other page is read when it is drawn, and let go of once drawn.
 */
export async function openPdf(bytes: ArrayBuffer): Promise<LoadedPdf> {
  const lib = await loadPdfJs();
  // pdf.js moves the bytes it is given to its worker: give it a copy, the caller keeps the Document.
  const loading = lib.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  let doc: PDFDocumentProxy;
  const aspects = new Map<number, number>();
  try {
    doc = await loading.promise;
    const first = await doc.getPage(1);
    aspects.set(1, aspectOf(first));
    first.cleanup();
  } catch (error) {
    void loading.destroy();
    throw error;
  }
  const firstAspect = aspects.get(1)!;
  return {
    pages: doc.numPages,
    aspect: (page) => aspects.get(page) ?? firstAspect,
    render(page, canvas, width) {
      let cancelled = false;
      let drawing: { cancel: () => void } | undefined;
      const done = (async () => {
        const pdfPage = await doc.getPage(page);
        try {
          aspects.set(page, aspectOf(pdfPage));
          if (cancelled) throw new lib.RenderingCancelledException("cancelled");
          const base = pdfPage.getViewport({ scale: 1 });
          const sharp = (width / base.width) * (window.devicePixelRatio || 1);
          // No larger than a browser draws (Safari leaves a canvas over ~16.7M pixels blank): a big sheet zoomed in is a little softer instead.
          const scale = Math.min(sharp, Math.sqrt(maxCanvasPixels / (base.width * base.height)));
          const viewport = pdfPage.getViewport({ scale });
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const render = pdfPage.render({ canvas, viewport });
          drawing = render;
          await render.promise;
        } finally {
          // The page's parsed resources go once it is drawn (or stopped): the canvas keeps the picture.
          pdfPage.cleanup();
        }
      })();
      return {
        done,
        cancel: () => {
          cancelled = true;
          drawing?.cancel();
        },
      };
    },
    destroy: () => void loading.destroy(),
  };
}

/** Whether a page drawing stopped because it was cancelled, not because it failed. */
export function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}
