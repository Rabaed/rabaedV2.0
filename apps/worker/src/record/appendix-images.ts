import { concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, type PDFDocument, type PDFImage, type PDFPage } from "pdf-lib";
import { appendixImageHtml } from "./appendix-layout.ts";
import type { PdfRenderer } from "./render.ts";

// The appendix's image pages (RP-957; form-engine.md §6, element 15), drawn into their frames after
// Chromium has laid the record out, so the images never go to Chromium together: at the 100 MB
// limit their data URLs would not even fit through its pipe, and it would hold every one decoded at
// once. A JPEG or a PNG is drawn with pdf-lib: a JPEG's bytes go into the PDF as they are (never
// decoded), turned as its EXIF orientation says, as Chromium shows it. Any other image (WebP, GIF,
// a CMYK or 12-bit JPEG, which a PDF/A with an sRGB output intent can't hold as it is) is drawn by
// Chromium alone, on a page the size of the frame, and that page is drawn into the frame: one image
// at a time. Either way it is fitted whole and centred, as `object-fit: contain` fits it.

/** The most bytes of an image only Chromium can draw: past it the image travels attached, as its data URL would not fit through Chromium's pipe. */
export const MAX_RENDERED_IMAGE_BYTES = 48 * 1024 * 1024;

/** An image pdf-lib draws as it is. */
type Drawable = { readonly type: "jpeg"; readonly orientation: number } | { readonly type: "png" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Baseline, extended and progressive: the DCT a PDF reader decodes. */
const DRAWABLE_SOF = new Set([0xc0, 0xc1, 0xc2]);

/** Whether pdf-lib can draw `bytes` as they are: a PNG, or an 8-bit grey or RGB JPEG (with its EXIF orientation). Null otherwise. */
export function pdfLibImageOf(bytes: Uint8Array): Drawable | null {
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return { type: "png" };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const code = bytes[at + 1]!;
    if (code === 0xff) {
      at++;
      continue;
    }
    // Codes that stand alone, with no length.
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    const body = at + 4;
    if (code === 0xe1 && Buffer.from(bytes.subarray(body, body + 6)).toString("latin1") === "Exif\0\0") orientation = exifOrientation(bytes.subarray(body + 6, at + 2 + length));
    // A frame header: DCT, its precision and its components.
    if (code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc) {
      const precision = bytes[body];
      const components = bytes[body + 5];
      return DRAWABLE_SOF.has(code) && precision === 8 && (components === 1 || components === 3) ? { type: "jpeg", orientation } : null;
    }
    if (code === 0xda || code === 0xd9) return null;
    at += 2 + length;
  }
  return null;
}

/** The orientation (1–8) an EXIF block's first image directory gives; 1 when it gives none. */
function exifOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const little = tiff[0] === 0x49;
  const u16 = (i: number) => (i + 2 <= tiff.length ? (little ? tiff[i]! | (tiff[i + 1]! << 8) : (tiff[i]! << 8) | tiff[i + 1]!) : 0);
  const u32 = (i: number) => (u16(little ? i + 2 : i) * 0x10000 + u16(little ? i : i + 2)) >>> 0;
  const directory = u32(4);
  const count = u16(directory);
  for (let n = 0; n < count; n++) {
    const entry = directory + 2 + n * 12;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

interface Frame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where each EXIF orientation puts the stored image in the shown one: the shown box's x and y (0 to
 * 1, y up) from the stored image's u and v (its columns, and its rows from the bottom), as
 * [x from u, x from v, x's offset, y from u, y from v, y's offset].
 */
const ORIENTATIONS: Record<number, readonly [number, number, number, number, number, number]> = {
  1: [1, 0, 0, 0, 1, 0],
  2: [-1, 0, 1, 0, 1, 0],
  3: [-1, 0, 1, 0, -1, 1],
  4: [1, 0, 0, 0, -1, 1],
  5: [0, -1, 1, -1, 0, 1],
  6: [0, 1, 0, -1, 0, 1],
  7: [0, 1, 0, 1, 0, 0],
  8: [0, -1, 1, 1, 0, 0],
};

/** The matrix that draws a `width` × `height` image (as stored) whole and centred in `frame`, as `orientation` shows it. */
export function fittedMatrix(frame: Frame, width: number, height: number, orientation: number): [number, number, number, number, number, number] {
  const sideways = orientation >= 5;
  const shownWidth = sideways ? height : width;
  const shownHeight = sideways ? width : height;
  const scale = Math.min(frame.width / shownWidth, frame.height / shownHeight);
  const w = shownWidth * scale;
  const h = shownHeight * scale;
  const x = frame.x + (frame.width - w) / 2;
  const y = frame.y + (frame.height - h) / 2;
  const [xu, xv, x0, yu, yv, y0] = ORIENTATIONS[orientation] ?? ORIENTATIONS[1]!;
  return [w * xu, h * yu, w * xv, h * yv, x + w * x0, y + h * y0];
}

/** Draws the image `bytes` (of `contentType`) into `frame` on `page` of `out`: with pdf-lib when it can, else drawn by Chromium alone. */
export async function drawImage(out: PDFDocument, page: PDFPage, frame: Frame, bytes: Uint8Array, contentType: string, renderer: PdfRenderer): Promise<void> {
  const kind = pdfLibImageOf(bytes);
  let image: PDFImage | undefined;
  try {
    // pdf-lib reads a JPEG through its whole ArrayBuffer, not the view: a pooled Buffer is copied out first.
    if (kind?.type === "jpeg") image = await out.embedJpg(bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : new Uint8Array(bytes));
    else if (kind?.type === "png") image = await out.embedPng(bytes);
  } catch {
    // Not what it starts as: Chromium draws what it can of it (an empty frame, as before RP-957).
    image = undefined;
  }
  if (image) {
    const name = page.node.newXObject("Image", image.ref);
    const matrix = fittedMatrix(frame, image.width, image.height, kind?.type === "jpeg" ? kind.orientation : 1);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix), drawObject(name), popGraphicsState());
    // Into the document now, so a PNG's decoded pixels are not kept until the save.
    await image.embed();
    return;
  }
  // A large file that starts as a JPEG or PNG but doesn't read as one: its frame stays empty, as
  // Chromium would leave it, rather than a data URL too large for Chromium's pipe failing the job.
  if (kind !== null && bytes.length > MAX_RENDERED_IMAGE_BYTES) return;
  const alone = await renderer.render(appendixImageHtml(`data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`));
  const [drawn] = await out.embedPdf(alone, [0]);
  page.drawPage(drawn!, { x: frame.x, y: frame.y, width: frame.width, height: frame.height });
  await drawn!.embed();
}
