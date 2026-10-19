import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RecordLanguage } from "@rabaed/domain";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fallbackFonts } from "./fonts.ts";
import { fixtureImages, goldenData, type GoldenCode } from "./golden-fixtures.ts";
import { recordHtml } from "./layout.ts";
import { launch, screenshotHtml } from "./render.ts";

// Golden screenshots of the Documental Record's layout (RP-151; form-engine.md §6): a
// Material Approval Request at Code A, a Drawing Approval Request at Code C and a Document
// Approval Sheet at Code D, bilingual and in a single language, drawn in Chromium at A4 width
// and compared with the committed baselines, as the story tests compare theirs.
//
// The owner's MAR, DAR and DAS samples are not in the repository, so the baselines are this
// layout's own render, kept for the layout not to change unseen. They are per platform:
// font rasterisation differs by OS, and a platform with no baselines yet is rendered but not
// compared (the CI baselines are made on Linux by the update-screenshots run). To remake them
// after a layout change: UPDATE_RECORD_SCREENSHOTS=1 pnpm vitest run --project unit golden.

const here = dirname(fileURLToPath(import.meta.url));
const baselineDir = (name: string) => join(here, "__screenshots__", process.platform, `${name}.png`);
const update = process.env.UPDATE_RECORD_SCREENSHOTS === "1";

/** A pixel counts as different when a channel is off by more than this. */
const CHANNEL_TOLERANCE = 28;
/** The share of pixels that may differ before the screenshot fails. */
const MAX_DIFFERING_SHARE = 0.004;

const cases: { name: string; code: GoldenCode; language: RecordLanguage }[] = [
  { name: "mar-code-a-bilingual", code: "A", language: "bilingual" },
  { name: "mar-code-a-ar", code: "A", language: "ar" },
  { name: "dar-code-c-bilingual", code: "C", language: "bilingual" },
  { name: "dar-code-c-en", code: "C", language: "en" },
  { name: "das-code-d-bilingual", code: "D", language: "bilingual" },
  { name: "das-code-d-ar", code: "D", language: "ar" },
];

let browser: Browser;
beforeAll(async () => {
  browser = await launch({});
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** The share of pixels that differ between two PNGs, worked out in a page (no image library needed). */
async function differingShare(a: Uint8Array, b: Uint8Array): Promise<{ share: number; sameSize: boolean }> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const url = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    // The comparison runs in the page (the worker's types have no DOM), as a script.
    const script = `(async () => {
      const load = (src) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("image did not load"));
        image.src = src;
      });
      const [x, y] = await Promise.all([load(${JSON.stringify(url(a))}), load(${JSON.stringify(url(b))})]);
      if (x.width !== y.width || x.height !== y.height) return { share: 1, sameSize: false };
      const pixels = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, image.width, image.height).data;
      };
      const p = pixels(x);
      const q = pixels(y);
      let differing = 0;
      for (let i = 0; i < p.length; i += 4) {
        if (Math.abs(p[i] - q[i]) > ${CHANNEL_TOLERANCE} || Math.abs(p[i + 1] - q[i + 1]) > ${CHANNEL_TOLERANCE} || Math.abs(p[i + 2] - q[i + 2]) > ${CHANNEL_TOLERANCE}) differing++;
      }
      return { share: differing / (p.length / 4), sameSize: true };
    })()`;
    return (await page.evaluate(script)) as { share: number; sameSize: boolean };
  } finally {
    await context.close();
  }
}

describe("the record's layout, as golden screenshots", () => {
  for (const { name, code, language } of cases) {
    it(`${name}`, async () => {
      const png = await screenshotHtml(browser, recordHtml(goldenData(code, language), fallbackFonts(), fixtureImages));
      expect(png.length).toBeGreaterThan(10_000);
      const baseline = baselineDir(name);
      if (update) {
        mkdirSync(dirname(baseline), { recursive: true });
        writeFileSync(baseline, png);
        return;
      }
      if (!existsSync(baseline)) return; // no baseline for this platform yet
      const { share, sameSize } = await differingShare(readFileSync(baseline), png);
      expect(sameSize, "the page is the size of its baseline").toBe(true);
      expect(share, `share of pixels that differ from ${baseline}`).toBeLessThanOrEqual(MAX_DIFFERING_SHARE);
    }, 60_000);
  }
});

describe("the layout's content, from the same fixtures", () => {
  const html = (code: GoldenCode, language: RecordLanguage) => recordHtml(goldenData(code, language), fallbackFonts(), fixtureImages);

  it("prints a Code D Revision's source and the rejected mark", () => {
    const text = html("D", "en");
    expect(text).toContain("Revision of");
    expect(text).toContain("closed at Code C on");
    expect(text).toContain("stroke=\"#b3261e\"");
  });

  it("prints a single language only", () => {
    expect(html("A", "en")).not.toMatch(/[؀-ۿ]/);
    expect(html("A", "ar")).not.toContain("Final decision");
    expect(html("A", "bilingual")).toContain("Final decision");
  });

  it("loads nothing outside itself", () => {
    expect(html("A", "bilingual")).not.toMatch(/(src|href)="https?:/);
  });
});
