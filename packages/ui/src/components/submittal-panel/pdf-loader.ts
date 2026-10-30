/**
 * pdf.js for the Attachments preview (RP-1068, owner decision C3), in the browser only: it is
 * imported when a PDF is first opened, never while the server renders the page (pdf.js reaches
 * for the canvas when it loads). The worker is this package's own copy of pdf.js's, served by
 * whichever bundler builds the app (Next) or the stories (Vite), so it comes from the app's origin.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

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
  /** Each page's width over its height, in page order. */
  aspects: readonly number[];
  /**
   * Draws page `page` (1-based) `width` CSS pixels wide, sharp on this screen. `done` rejects
   * once cancelled, which `isCancelled` tells apart from a failure.
   */
  render: (page: number, canvas: HTMLCanvasElement, width: number) => PdfRender;
  destroy: () => void;
};

/**
 * Opens a PDF from its bytes. The whole file is read before it is opened, rather than pdf.js
 * asking the file store for parts of it later, after the signed URL has expired (5 minutes) and
 * with range requests the file store's CORS doesn't answer.
 */
export async function openPdf(bytes: ArrayBuffer): Promise<LoadedPdf> {
  const lib = await loadPdfJs();
  // pdf.js moves the bytes it is given to its worker: give it a copy, the caller keeps the file.
  const loading = lib.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  let doc: PDFDocumentProxy;
  const aspects: number[] = [];
  try {
    doc = await loading.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const viewport = (await doc.getPage(n)).getViewport({ scale: 1 });
      aspects.push(viewport.width / viewport.height);
    }
  } catch (error) {
    void loading.destroy();
    throw error;
  }
  return {
    pages: doc.numPages,
    aspects,
    render(page, canvas, width) {
      let cancelled = false;
      let drawing: { cancel: () => void } | undefined;
      const done = (async () => {
        const pdfPage = await doc.getPage(page);
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
