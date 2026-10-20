import type { AppendixEntry, RecordData } from "./record-data.ts";
import { headingHtml, html, ltr, WORDS, type Word } from "./record-text.ts";

// The appendix's part of the one layout (form-engine.md §6, element 15; RP-147), after the
// Disclaimer: the list of its files, each by name and fingerprint with where the record holds it,
// then a page for each page of a shared PDF and for each shared image, in the list's order. Each
// page's frame is left empty here and drawn into afterwards (appendix.ts): a PDF's page, or an
// image (RP-957: so Chromium never holds the appendix's images), so the frame is at a fixed place
// on its page: the layout's top and side margins (layout.ts `@page`, 16 mm and 13 mm) and the
// caption above it. Chromium prints the running header and the footer (page X of Y) on these
// pages as on every other.

/** Where the frame of an appended page is, from the page's top left corner (millimetres). */
export const APPENDIX_FRAME_MM = { top: 16 + 8, left: 13, width: 184, height: 245 } as const;

export const APPENDIX_CSS = `
.appendix .lead { color: #444; font-size: 8pt; margin-bottom: 3mm; }
.appendix td.fp { font-size: 6.5pt; word-break: break-all; width: 52mm; }
.appendix td.where { width: 38mm; }
.appendix-page { break-before: page; height: ${8 + APPENDIX_FRAME_MM.height}mm; overflow: hidden; }
.appendix-caption { height: 8mm; display: flex; align-items: center; gap: 2mm; font-size: 8pt; color: #444; border-bottom: 0.5pt solid #ccc; white-space: nowrap; overflow: hidden; }
.appendix-caption .num { display: inline-block; min-width: 5mm; height: 5mm; border-radius: 1mm; background: #111; color: #fff; text-align: center; font-weight: 700; }
.appendix-frame { height: ${APPENDIX_FRAME_MM.height}mm; }
`;

/**
 * A page the size of an appended page's frame with only `src` on it, fitted as it is shown: for an
 * image the record can't draw itself (appendix.ts), drawn by Chromium alone and then into its frame.
 */
export function appendixImageHtml(src: string): string {
  const { width, height } = APPENDIX_FRAME_MM;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${width}mm ${height}mm; margin: 0; }
html, body { margin: 0; }
.frame { width: ${width}mm; height: ${height}mm; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.frame img { width: 100%; height: 100%; object-fit: contain; display: block; }
</style></head><body><div class="frame"><img src="${src}" alt=""></div></body></html>`;
}

/** The appendix: its list, and (unless `withPages` is false, for the render that finds where its pages start) its pages. */
export function appendixHtml(data: RecordData, withPages = true): string {
  if (data.appendix.length === 0) return "";
  const language = data.language;
  const locales = language === "bilingual" ? (["ar", "en"] as const) : ([language] as const);
  const dirOf = (l: "ar" | "en") => (l === "ar" ? "rtl" : "ltr");
  const heading = (word: Word) => headingHtml(word, language);
  /** A sentence in each of the record's languages, each on its own line. */
  const sentence = (fn: (l: "ar" | "en") => string) => locales.map((l) => `<div class="line" lang="${l}" dir="${dirOf(l)}">${fn(l)}</div>`).join("");
  const where = (f: AppendixEntry) => {
    switch (f.way) {
      case "pages": {
        const range = f.pages;
        return sentence((l) =>
          !range
            ? WORDS.pages[l]
            : range.first === range.last
              ? `${WORDS.page[l]} ${ltr(String(range.first))}`
              : `${WORDS.pages[l]} ${ltr(String(range.first))}–${ltr(String(range.last))}`,
        );
      }
      case "attached":
        return sentence((l) => html(WORDS[f.tooManyPages ? "tooManyPages" : "attachedInside"][l]));
      case "held":
        return sentence((l) => html(WORDS.heldInRabaed[l]));
    }
  };

  const list = `<section class="after-start appendix"><h2 class="part">${heading("appendix")}</h2>
<div class="lead">${sentence((l) => html(WORDS.howToOpen[l]))}</div>
<table><thead><tr><th>#</th><th>${heading("documentName")}</th><th>${heading("fingerprint")}</th><th>${heading("inThisRecord")}</th></tr></thead><tbody>${data.appendix
    .map(
      (f, i) =>
        `<tr><td class="n">${i + 1}</td><td><bdi dir="ltr">${html(f.fileName)}</bdi></td><td class="fp">${ltr(f.sha256)}</td><td class="where">${where(f)}</td></tr>`,
    )
    .join("")}</tbody></table></section>`;
  if (!withPages) return list;

  const caption = (n: number, f: AppendixEntry & { way: "pages" }, k: number) =>
    `<div class="appendix-caption"><span class="num">${n}</span><bdi dir="ltr">${html(f.fileName)}</bdi><span>·</span>${locales
      .map((l) => `<span lang="${l}" dir="${dirOf(l)}">${WORDS.page[l]} ${ltr(String(k))} ${WORDS.of[l]} ${ltr(String(f.pageCount))}</span>`)
      .join("<span>·</span>")}</div>`;
  const pages = data.appendix
    .flatMap((f, i) =>
      f.way !== "pages"
        ? []
        : Array.from({ length: f.pageCount }, (_, k) => `<section class="appendix-page">${caption(i + 1, f, k + 1)}<div class="appendix-frame"></div></section>`),
    )
    .join("");
  return `${list}${pages}`;
}
