import { chromium, type Browser } from "playwright-core";

// Headless Chromium (ADR 0023): the one Rabaed layout is HTML and CSS, and
// Chromium shapes Arabic, mixes RTL and LTR and embeds the fonts. The page is
// loaded with no network at all: everything it needs (its fonts too) is inside
// the HTML, so a record never depends on anything outside it.

export interface PdfRenderer {
  /** An A4 PDF of `html`. */
  render(html: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface ChromiumOptions {
  /** A Chromium or Chrome to run instead of Playwright's own (CHROMIUM_PATH). */
  readonly executablePath?: string;
}

export async function launch({ executablePath }: ChromiumOptions): Promise<Browser> {
  if (executablePath) return chromium.launch({ executablePath });
  try {
    return await chromium.launch();
  } catch (error) {
    // No Playwright browser installed (a machine or CI job that never ran
    // `playwright install`): the system's Chrome, which GitHub's runners have.
    try {
      return await chromium.launch({ channel: "chrome" });
    } catch {
      throw error;
    }
  }
}

/**
 * The layout as one tall PNG at A4 width, in print media: what the golden screenshots compare
 * (golden.test.ts) and the UI ticket shows. The page's margins are drawn as padding, since a
 * screenshot has no paper.
 */
export async function screenshotHtml(browser: Browser, html: string): Promise<Uint8Array> {
  const context = await browser.newContext({ javaScriptEnabled: false, offline: true, viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.emulateMedia({ media: "print" });
    await page.setContent(html.replace("</head>", "<style>html { padding: 16mm 13mm; }</style></head>"), { waitUntil: "load" });
    await page.evaluate("document.fonts.ready.then(() => true)").catch(() => undefined);
    return new Uint8Array(await page.screenshot({ fullPage: true, type: "png" }));
  } finally {
    await context.close();
  }
}

/** A renderer that starts Chromium at its first page and keeps it for the next. */
export function chromiumRenderer(options: ChromiumOptions = {}): PdfRenderer {
  let browser: Promise<Browser> | undefined;
  return {
    async render(html) {
      browser ??= launch(options).catch((error: unknown) => {
        browser = undefined;
        throw error;
      });
      const context = await (await browser).newContext({ javaScriptEnabled: false, offline: true });
      try {
        const page = await context.newPage();
        // Nothing leaves the page: no request but the page itself is made.
        await page.route("**/*", (route) => route.abort());
        await page.setContent(html, { waitUntil: "load" });
        // Every font face in use loaded before printing (the faces are inside the page).
        await page.evaluate("document.fonts.ready.then(() => true)").catch(() => undefined);
        return new Uint8Array(await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
      } finally {
        await context.close();
      }
    },
    async close() {
      const open = browser;
      browser = undefined;
      if (open) await (await open).close().catch(() => undefined);
    },
  };
}
