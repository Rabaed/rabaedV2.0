import jsQRModule from "jsqr";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { qrCode, qrSvg } from "./qr.ts";
import { launch } from "./render.ts";

// The record's QR must scan, not only decode in our own reader: jsQR, an independent decoder, reads the
// symbol back as pixels (RP-151). The encoder only ever makes level M, versions 1 to 10, so every version it
// can pick for a record link is read, from a short link to the longest one it takes (213 bytes).

// jsqr is CommonJS: under Node's ESM resolution the import is its `module.exports`, whose `default` is the decoder.
type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { data: string } | null;
const jsQR = ((jsQRModule as unknown as { default?: JsQr }).default ?? jsQRModule) as unknown as JsQr;

// 43 characters, as randomBytes(32) in base64url; made at run time so no token-shaped literal is committed.
const token = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256)).toString("base64url");
const link = (origin: string) => `${origin}/verify/${token}`;

/** The matrix as RGBA pixels with the four-module quiet zone the layout draws, `scale` pixels to a module. */
function rasterise(text: string, scale: number): { data: Uint8ClampedArray; width: number } {
  const { modules, size } = qrCode(text);
  const quiet = 4;
  const width = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const dark = modules[Math.floor(y / scale) - quiet]?.[Math.floor(x / scale) - quiet];
      if (dark) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return { data, width };
}

const scan = (pixels: { data: Uint8ClampedArray; width: number }) => jsQR(pixels.data, pixels.width, pixels.width, { inversionAttempts: "dontInvert" })?.data;

describe("the record's QR scans", () => {
  const origins = [
    "https://a.co", // a short link
    "https://rabaed.test", // the tests'
    "https://app.rabaed.com", // production's
    `https://${"project-with-a-long-name.".repeat(3)}customer.example.com`, // a long customer domain
  ];

  it.each(origins)("reads back the verification link of %s exactly, at each scale a printer might use", (origin) => {
    for (const scale of [3, 4, 6, 10]) expect(scan(rasterise(link(origin), scale)), `scale ${scale}`).toBe(link(origin));
  });

  it("reads every length the encoder takes, 1 to 213 bytes, so every version 1 to 10: a link from its shortest, anything shorter as text", () => {
    const versions = new Set<number>();
    const minimum = `https://h/verify/${token}`.length;
    for (let bytes = 1; bytes <= 213; bytes++) {
      const payload = bytes >= minimum ? `https://${"h".repeat(bytes - minimum + 1)}/verify/${token}` : "x".repeat(bytes);
      expect(payload.length).toBe(bytes);
      versions.add(qrCode(payload).version);
      expect(scan(rasterise(payload, 4)), `${bytes} bytes`).toBe(payload);
    }
    expect([...versions].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("the QR as the layout draws it (an SVG at 110 px in Chromium)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launch({});
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  /** The SVG drawn to a canvas in a page, at `px` wide: its pixels as the browser rasterises them (anti-aliasing included). */
  async function drawn(text: string, px: number): Promise<{ data: Uint8ClampedArray; width: number }> {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const svg = qrSvg(text, px);
      const script = `(async () => {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)}; });
        const canvas = document.createElement("canvas");
        canvas.width = ${px};
        canvas.height = ${px};
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, ${px}, ${px});
        return Array.from(ctx.getImageData(0, 0, ${px}, ${px}).data);
      })()`;
      return { data: Uint8ClampedArray.from((await page.evaluate(script)) as number[]), width: px };
    } finally {
      await context.close();
    }
  }

  it.each(["https://rabaed.test", "https://app.rabaed.com", `https://${"project-with-a-long-name.".repeat(3)}customer.example.com`])(
    "reads %s back from the 110 px symbol the layout prints, and from a larger print of it",
    async (origin) => {
      expect(scan(await drawn(link(origin), 110))).toBe(link(origin));
      expect(scan(await drawn(link(origin), 330))).toBe(link(origin));
    },
    60_000,
  );
});
