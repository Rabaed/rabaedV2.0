import { createHash } from "node:crypto";
import type { DocumentFact } from "@rabaed/db";
import { decodePDFRawStream, PDFArray, PDFContentStream, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from "pdf-lib";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendixOf, MAX_RENDERED_IMAGE_BYTES, renderWithAppendix } from "./appendix.ts";
import type { RecordFiles } from "./files.ts";
import { fallbackFonts } from "./fonts.ts";
import { fixtureImages, goldenFacts, goldenRecord } from "./golden-fixtures.ts";
import { chromiumRenderer, launch, type PdfRenderer } from "./render.ts";

// How the appendix's pages are drawn (RP-957): an image the record can draw as it is (a JPEG or
// a PNG) is drawn into its page's frame with pdf-lib after Chromium has laid the pages out, so
// Chromium never holds the appendix's images (at the 100 MB limit they would not even fit
// through its pipe); any other image is drawn by Chromium alone on a page of its own, one at a
// time. Each file is read again from the store when it is drawn, so none is held in memory
// between the appendix's check and its page.

const hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** One red pixel, as a GIF. */
const GIF = Buffer.from("R0lGODlhAQABAIAAAP8AAP///ywAAAAAAQABAAACAkQBADs=", "base64");

/** `jpeg` with an EXIF block saying it is turned by `orientation` (1–8), right after its start. */
function withOrientation(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), length, payload, jpeg.subarray(2)]);
}

let browser: Browser;
let renderer: PdfRenderer;
/** A 40 × 30 JPEG of one colour, as Chromium encodes it. */
let jpeg: Buffer;
/** An 8 × 6 PNG of one colour. */
let png: Buffer;
beforeAll(async () => {
  browser = await launch({});
  const page = await (await browser.newContext()).newPage();
  const url = (await page.evaluate(
    `(() => { const c = document.createElement("canvas"); c.width = 40; c.height = 30; const x = c.getContext("2d"); x.fillStyle = "#c81e78"; x.fillRect(0, 0, 40, 30); return c.toDataURL("image/jpeg", 0.9); })()`,
  )) as string;
  jpeg = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  const pngUrl = (await page.evaluate(
    `(() => { const c = document.createElement("canvas"); c.width = 8; c.height = 6; const x = c.getContext("2d"); x.fillStyle = "#1e78c8"; x.fillRect(0, 0, 8, 6); return c.toDataURL("image/png"); })()`,
  )) as string;
  png = Buffer.from(pngUrl.slice(pngUrl.indexOf(",") + 1), "base64");
  renderer = chromiumRenderer();
});
afterAll(async () => {
  await renderer.close();
  await browser.close();
});

/** A store holding `files` by name; `swap` changes a file's bytes after it has been read once. */
function store(files: Record<string, Uint8Array>, swap?: { name: string; bytes: Uint8Array }): RecordFiles & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    put: async () => {},
    get: async (key) => {
      const name = key.slice("key/".length);
      const again = reads.includes(key);
      reads.push(key);
      return again && swap?.name === name ? swap.bytes : (files[name] ?? null);
    },
    sha256: async (key) => {
      const bytes = files[key.slice("key/".length)];
      return bytes ? hex(bytes) : null;
    },
  };
}

function documents(files: Record<string, { bytes: Uint8Array; contentType: string }>): DocumentFact[] {
  return Object.entries(files).map(([name, f]) => ({
    fileName: name,
    contentType: f.contentType,
    size: f.bytes.length,
    storageKey: `key/${name}`,
    sha256: hex(f.bytes),
    fieldKey: "datasheet",
    itemKey: null,
    takenAt: null,
  }));
}

/** The record of golden A with `files` in its appendix, drawn; and every HTML Chromium was given. */
async function drawn(files: Record<string, { bytes: Uint8Array; contentType: string }>, swap?: { name: string; bytes: Uint8Array }) {
  const files_ = store(Object.fromEntries(Object.entries(files).map(([n, f]) => [n, f.bytes])), swap);
  const facts = { ...goldenFacts("A", "en"), documents: documents(files) };
  const appendix = await appendixOf(facts, files_);
  const htmls: string[] = [];
  const spy: PdfRenderer = {
    render: (html) => {
      htmls.push(html);
      return renderer.render(html);
    },
    close: async () => undefined,
  };
  const { data, images } = goldenRecord("A", "en");
  const made = await renderWithAppendix(spy, data, fallbackFonts(), fixtureImages, images, appendix);
  const pages = (name: string) => {
    const entry = made.data.appendix.find((f) => f.fileName === name)!;
    return entry.way === "pages" ? entry.pages! : null;
  };
  return { ...made, htmls, pages, reads: files_.reads };
}

/** A page's content, decoded, in drawing order. */
function contentOf(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.Contents();
  const parts = contents instanceof PDFArray ? contents.asArray().map((p) => doc.context.lookup(p)) : [contents];
  return parts
    .map((p) => (p instanceof PDFRawStream ? decodePDFRawStream(p).decode() : p instanceof PDFContentStream ? p.getUnencodedContents() : new Uint8Array()))
    .map((b) => Buffer.from(b).toString("latin1"))
    .join("\n");
}

/** The last XObject a page draws, with the matrix it is drawn with. */
function lastDrawn(doc: PDFDocument, index: number): { matrix: number[]; object: PDFStream } {
  const all = [...contentOf(doc, index).matchAll(/((?:-?[\d.]+\s+){6})cm\s+\/(\S+)\s+Do/g)];
  const last = all.at(-1)!;
  const xobjects = doc.getPage(index).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
  return { matrix: last[1]!.trim().split(/\s+/).map(Number), object: xobjects.lookup(PDFName.of(last[2]!), PDFStream) };
}

const isImage = (s: PDFStream) => s.dict.lookup(PDFName.of("Subtype")) === PDFName.of("Image");

describe("the appendix's image pages (RP-957)", () => {
  it("draws a JPEG with pdf-lib, its bytes as uploaded, and never gives it to Chromium", async () => {
    const made = await drawn({ "photo.jpg": { bytes: jpeg, contentType: "image/jpeg" } });
    const base64 = jpeg.toString("base64");
    expect(made.htmls.length).toBeGreaterThan(0);
    for (const html of made.htmls) expect(html).not.toContain(base64.slice(0, 200));
    const { object } = lastDrawn(made.doc, made.pages("photo.jpg")!.first - 1);
    expect(isImage(object)).toBe(true);
    expect(object.dict.lookup(PDFName.of("Filter"))).toBe(PDFName.of("DCTDecode"));
    expect(Buffer.from((object as PDFRawStream).contents).equals(jpeg)).toBe(true);
  });

  it("fits the image in its frame, as it is shown: turned as its EXIF orientation says", async () => {
    const made = await drawn({
      "upright.jpg": { bytes: jpeg, contentType: "image/jpeg" },
      "turned.jpg": { bytes: withOrientation(jpeg, 6), contentType: "image/jpeg" },
      "mirrored.jpg": { bytes: withOrientation(jpeg, 2), contentType: "image/jpeg" },
    });
    // Upright: 40 wide, 30 high, as stored.
    const [a, b, c, d] = lastDrawn(made.doc, made.pages("upright.jpg")!.first - 1).matrix;
    expect([b, c]).toEqual([0, 0]);
    expect(a! / d!).toBeCloseTo(40 / 30, 3);
    // Orientation 6 (turned a quarter clockwise): shown 30 wide and 40 high, the image's columns running down the page.
    const turned = lastDrawn(made.doc, made.pages("turned.jpg")!.first - 1).matrix;
    expect([turned[0], turned[3]]).toEqual([0, 0]);
    expect(turned[1]!).toBeLessThan(0);
    expect(turned[2]! / -turned[1]!).toBeCloseTo(30 / 40, 3);
    // Orientation 2 (mirrored): drawn right to left.
    const mirrored = lastDrawn(made.doc, made.pages("mirrored.jpg")!.first - 1).matrix;
    expect(mirrored[0]!).toBeLessThan(0);
    expect(mirrored[0]! / mirrored[3]!).toBeCloseTo(-40 / 30, 3);
  });

  it("draws a PNG with pdf-lib too", async () => {
    const made = await drawn({ "plan.png": { bytes: png, contentType: "image/png" } });
    for (const html of made.htmls) expect(html).not.toContain(png.toString("base64"));
    const { object } = lastDrawn(made.doc, made.pages("plan.png")!.first - 1);
    expect(isImage(object)).toBe(true);
    expect([object.dict.lookup(PDFName.of("Width"))?.toString(), object.dict.lookup(PDFName.of("Height"))?.toString()]).toEqual(["8", "6"]);
  });

  it("has Chromium draw any other image alone, on a page of its own, and embeds that page", async () => {
    const made = await drawn({
      "a.jpg": { bytes: jpeg, contentType: "image/jpeg" },
      "dot.gif": { bytes: GIF, contentType: "image/gif" },
    });
    const withGif = made.htmls.filter((h) => h.includes(GIF.toString("base64")));
    expect(withGif).toHaveLength(1);
    // That page holds the image only: none of the record's text.
    expect(withGif[0]).not.toContain("dot.gif");
    const { object } = lastDrawn(made.doc, made.pages("dot.gif")!.first - 1);
    expect(object.dict.lookup(PDFName.of("Subtype"))).toBe(PDFName.of("Form"));
  });

  it("still gives the page of an image it can't read, with its frame empty", async () => {
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]);
    const made = await drawn({ "broken.png": { bytes: broken, contentType: "image/png" } });
    expect(made.pages("broken.png")).not.toBeNull();
    expect(made.doc.getPageCount()).toBe(made.pages("broken.png")!.last);
  });

  it("reads each file again when it draws it, and refuses one whose bytes changed since", async () => {
    const made = await drawn({ "photo.jpg": { bytes: jpeg, contentType: "image/jpeg" } });
    expect(made.reads).toEqual(["key/photo.jpg", "key/photo.jpg"]);
    await expect(drawn({ "photo.jpg": { bytes: jpeg, contentType: "image/jpeg" } }, { name: "photo.jpg", bytes: withOrientation(jpeg, 3) })).rejects.toThrow(
      "does not match its fingerprint",
    );
  });

  it(`carries an image only Chromium can draw inside the PDF when it is past ${MAX_RENDERED_IMAGE_BYTES / 1024 / 1024} MB`, async () => {
    const big = Buffer.concat([GIF, Buffer.alloc(MAX_RENDERED_IMAGE_BYTES)]);
    const facts = { ...goldenFacts("A", "en"), documents: documents({ "big.gif": { bytes: big, contentType: "image/gif" }, "big.jpg": { bytes: Buffer.concat([jpeg, Buffer.alloc(MAX_RENDERED_IMAGE_BYTES)]), contentType: "image/jpeg" } }) };
    const files = store({ "big.gif": big, "big.jpg": Buffer.concat([jpeg, Buffer.alloc(MAX_RENDERED_IMAGE_BYTES)]) });
    const { entries } = await appendixOf(facts, files);
    expect(entries.map((e) => [e.fileName, e.way])).toEqual([
      ["big.gif", "attached"],
      ["big.jpg", "pages"],
    ]);
  });
});
