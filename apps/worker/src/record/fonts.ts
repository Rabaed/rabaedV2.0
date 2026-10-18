import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// The record's fonts (ADR 0023). In AWS the worker reads the licensed Thmanyah
// Sans files from the private fonts prefix of the build assets bucket at
// start-up (never from the repo or the image; CLAUDE.md); locally, in CI and
// in tests, and wherever those files are missing, the free IBM Plex Sans
// Arabic, which also covers Latin. Either is inlined into the page as data
// URLs, so Chromium needs no network and embeds them in the PDF.

export interface RecordFonts {
  /** The CSS font-family the layout uses first. */
  readonly family: string;
  /** The @font-face rules, with the files inside. */
  readonly css: string;
}

const require = createRequire(import.meta.url);
const SUBSETS = ["arabic", "latin", "latin-ext"];

/** IBM Plex Sans Arabic, regular and bold, Arabic and Latin. */
export function fallbackFonts(): RecordFonts {
  const dir = dirname(require.resolve("@fontsource/ibm-plex-sans-arabic/400.css"));
  const rules: string[] = [];
  for (const weight of [400, 700]) {
    const css = readFileSync(join(dir, `${weight}.css`), "utf8");
    for (const block of css.split("@font-face").slice(1)) {
      const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block)?.[1];
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
      if (!file || !SUBSETS.some((s) => file.includes(`-${s}-${weight}-`))) continue;
      const data = readFileSync(join(dir, "files", file)).toString("base64");
      rules.push(
        `@font-face { font-family: 'Record Sans'; font-style: normal; font-weight: ${weight}; ` +
          `src: url(data:font/woff2;base64,${data}) format('woff2');${range ? ` unicode-range: ${range};` : ""} }`,
      );
    }
  }
  return { family: "Record Sans", css: rules.join("\n") };
}

const thmanyahFile = /^thmanyahsans-(regular|bold)\.woff2$/i;
const WEIGHTS: Record<string, number> = { regular: 400, bold: 700 };

/**
 * Thmanyah Sans from `files` (name → bytes, as listed under fonts/thmanyah/),
 * with IBM Plex Sans Arabic behind it; the fallback alone when neither weight is there.
 */
export function thmanyahFonts(files: ReadonlyMap<string, Uint8Array>): RecordFonts {
  const fallback = fallbackFonts();
  const rules: string[] = [];
  for (const [name, bytes] of files) {
    const m = thmanyahFile.exec(name);
    if (!m) continue;
    rules.push(
      `@font-face { font-family: 'Record Thmanyah'; font-style: normal; font-weight: ${WEIGHTS[m[1]!.toLowerCase()]}; ` +
        `src: url(data:font/woff2;base64,${Buffer.from(bytes).toString("base64")}) format('woff2'); }`,
    );
  }
  if (rules.length === 0) return fallback;
  return { family: "'Record Thmanyah', 'Record Sans'", css: `${rules.join("\n")}\n${fallback.css}` };
}
