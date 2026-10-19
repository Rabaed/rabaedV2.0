import { inflateSync } from "node:zlib";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";

// The images a PDF holds, as the record job and its tests read them back: each image
// XObject's size and its first pixel's colour, for those stored as 8-bit samples (Flate or
// none). Enough to tell which Signature or Stamp a record printed, and for RP-155's check
// that every signer's Signature is there; not a renderer.

export interface PdfImage {
  readonly width: number;
  readonly height: number;
  /** The first pixel's samples (three for RGB, one for grey); null when the image is compressed another way. */
  readonly firstPixel: readonly number[] | null;
}

const num = (dict: PDFDict, key: string) => {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : 0;
};

export async function pdfImages(bytes: Uint8Array): Promise<PdfImage[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const out: PdfImage[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    if (dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const width = num(dict, "Width");
    const height = num(dict, "Height");
    // eslint-disable-next-line rabaed/no-avoid-terms -- ISO 32000's name for a stream's compression
    const compression = dict.lookup(PDFName.of("Filter"));
    let samples: Uint8Array | null = null;
    try {
      if (compression === undefined) samples = object.contents;
      else if (compression === PDFName.of("FlateDecode")) samples = inflateSync(object.contents);
    } catch {
      samples = null;
    }
    const components = dict.lookup(PDFName.of("ColorSpace")) === PDFName.of("DeviceGray") ? 1 : 3;
    out.push({ width, height, firstPixel: samples && samples.length >= components ? [...samples.subarray(0, components)] : null });
  }
  return out;
}
