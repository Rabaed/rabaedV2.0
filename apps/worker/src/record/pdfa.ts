import { webcrypto } from "node:crypto";
import {
  AFRelationship,
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
} from "pdf-lib";

// PDF/A-3 (ADR 0023): Chromium's PDF made archival, with the Record Data XML
// attached inside it as a KSA e-invoice carries its XML. Chromium already
// embeds every font; this adds what PDF/A-3b asks beyond that: XMP metadata
// matching the document information, an sRGB output intent, a file identifier,
// printable annotations, and each attachment's relationship and type.
// `pdfA3Problems` checks those rules again on any PDF, as the record's tests
// (and later its checks before download, RP-155) do.

export interface PdfA3Attachment {
  readonly name: string;
  readonly mimeType: string;
  readonly description: string;
  readonly bytes: Uint8Array;
}

export interface PdfA3Info {
  readonly title: string;
  /** When it was made: its creation and modification dates. */
  readonly at: Date;
}

const PRODUCER = "Rabaed";
const CREATOR = "Rabaed Documental Record";

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** ISO 8601 to the second, as XMP writes it; the Info dictionary's dates are the same instant. */
const xmpDate = (at: Date) => at.toISOString().replace(/\.\d{3}Z$/, "Z");

function xmp(info: PdfA3Info): string {
  const at = xmpDate(info.at);
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
    "<pdfaid:part>3</pdfaid:part>",
    "<pdfaid:conformance>B</pdfaid:conformance>",
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(info.title)}</rdf:li></rdf:Alt></dc:title>`,
    "<dc:format>application/pdf</dc:format>",
    `<xmp:CreateDate>${at}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${at}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${at}</xmp:MetadataDate>`,
    `<xmp:CreatorTool>${CREATOR}</xmp:CreatorTool>`,
    `<pdf:Producer>${PRODUCER}</pdf:Producer>`,
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n");
}

/**
 * A small ICC v2 display profile for sRGB (its D50-adapted primaries, gamma
 * 2.2), built here rather than shipped as a file: the output intent PDF/A asks
 * for whenever a page paints in DeviceRGB, as Chromium's pages do.
 */
export function srgbIccProfile(): Uint8Array {
  const s15 = (v: number) => {
    const b = new DataView(new ArrayBuffer(4));
    b.setInt32(0, Math.round(v * 65536));
    return new Uint8Array(b.buffer);
  };
  const u32 = (v: number) => {
    const b = new DataView(new ArrayBuffer(4));
    b.setUint32(0, v);
    return new Uint8Array(b.buffer);
  };
  const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  const xyz = (x: number, y: number, z: number) => cat(ascii("XYZ "), u32(0), s15(x), s15(y), s15(z));
  const description = "sRGB (Rabaed)";
  const desc = cat(ascii("desc"), u32(0), u32(description.length + 1), ascii(description), new Uint8Array(1), u32(0), u32(0), new Uint8Array(2 + 1 + 67));
  const cprt = cat(ascii("text"), u32(0), ascii("No copyright, use freely"), new Uint8Array(1));
  const curve = cat(ascii("curv"), u32(0), u32(1), new Uint8Array([0x02, 0x33]), new Uint8Array(2));
  const tags: [string, Uint8Array][] = [
    ["desc", desc],
    ["cprt", cprt],
    ["wtpt", xyz(0.9642, 1, 0.8249)],
    ["rXYZ", xyz(0.4361, 0.2225, 0.0139)],
    ["gXYZ", xyz(0.3851, 0.7169, 0.0971)],
    ["bXYZ", xyz(0.1431, 0.0606, 0.7141)],
    ["rTRC", curve],
    ["gTRC", curve],
    ["bTRC", curve],
  ];
  const pad = (b: Uint8Array) => cat(b, new Uint8Array((4 - (b.length % 4)) % 4));
  let offset = 128 + 4 + tags.length * 12;
  const table: Uint8Array[] = [u32(tags.length)];
  const data: Uint8Array[] = [];
  for (const [sig, body] of tags) {
    table.push(ascii(sig), u32(offset), u32(body.length));
    const padded = pad(body);
    data.push(padded);
    offset += padded.length;
  }
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  view.setUint32(0, offset);
  view.setUint32(8, 0x02100000);
  header.set(ascii("mntr"), 12);
  header.set(ascii("RGB "), 16);
  header.set(ascii("XYZ "), 20);
  // 2026-01-01 00:00:00
  [2026, 1, 1, 0, 0, 0].forEach((v, i) => view.setUint16(24 + i * 2, v));
  header.set(ascii("acsp"), 36);
  header.set(s15(0.9642), 68);
  header.set(s15(1), 72);
  header.set(s15(0.8249), 76);
  return cat(header, ...table, ...data);
}

/** Every annotation printable and never hidden, as PDF/A asks. */
function makeAnnotationsPrintable(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookupMaybe(i, PDFDict);
      if (!annot) continue;
      const flags = annot.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
      // Print on; Invisible, Hidden, ToggleNoView and NoView off.
      annot.set(PDFName.of("F"), PDFNumber.of((flags | 4) & ~(1 | 2 | 32 | 256)));
    }
  }
}

/** `pdf` (Chromium's) as a PDF/A-3b with `attachments` inside it. */
export async function toPdfA3(pdf: Uint8Array, info: PdfA3Info, attachments: readonly PdfA3Attachment[]): Promise<Uint8Array> {
  const at = new Date(Math.floor(info.at.getTime() / 1000) * 1000);
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ctx = doc.context;
  doc.setTitle(info.title, { showInWindowTitleBar: true });
  doc.setCreator(CREATOR);
  doc.setProducer(PRODUCER);
  doc.setCreationDate(at);
  doc.setModificationDate(at);
  for (const a of attachments) {
    await doc.attach(a.bytes, a.name, {
      mimeType: a.mimeType,
      description: a.description,
      creationDate: at,
      modificationDate: at,
      afRelationship: AFRelationship.Data,
    });
  }
  const metadata = ctx.stream(xmp({ ...info, at }), { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), ctx.register(metadata));
  const profile = ctx.register(ctx.stream(srgbIccProfile(), { N: 3 }));
  doc.catalog.set(
    PDFName.of("OutputIntents"),
    ctx.obj([
      ctx.obj({
        Type: "OutputIntent",
        S: "GTS_PDFA1",
        OutputConditionIdentifier: PDFString.of("sRGB"),
        Info: PDFString.of("sRGB IEC61966-2.1"),
        DestOutputProfile: profile,
      }),
    ]),
  );
  makeAnnotationsPrintable(doc);
  const id = PDFHexString.of(Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString("hex"));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
  // pdf-lib's attach() lands in the document at save time.
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

export interface AttachedFile {
  readonly name: string;
  readonly mimeType: string | null;
  readonly relationship: string | null;
  readonly bytes: Uint8Array;
}

const nameOf = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText() : null);
const streamBytes = (s: PDFStream) => (s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents());

/** The files attached inside `pdf` (its EmbeddedFiles name tree, one level), in order. */
export async function attachedFiles(pdf: Uint8Array): Promise<AttachedFile[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const tree = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict)?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const names = tree?.lookupMaybe(PDFName.of("Names"), PDFArray);
  const out: AttachedFile[] = [];
  if (!names) return out;
  for (let i = 1; i < names.size(); i += 2) {
    const spec = names.lookupMaybe(i, PDFDict);
    const file = spec?.lookupMaybe(PDFName.of("EF"), PDFDict)?.lookupMaybe(PDFName.of("F"), PDFStream);
    if (!spec || !file) continue;
    const uf = spec.lookup(PDFName.of("UF"));
    out.push({
      name: uf instanceof PDFHexString || uf instanceof PDFString ? uf.decodeText() : "",
      mimeType: nameOf(file.dict.get(PDFName.of("Subtype"))),
      relationship: nameOf(spec.get(PDFName.of("AFRelationship"))),
      bytes: streamBytes(file),
    });
  }
  return out;
}

function fontsOf(dict: PDFDict | undefined, seen: Set<PDFDict>, out: PDFDict[]) {
  if (!dict) return;
  const fonts = dict.lookupMaybe(PDFName.of("Font"), PDFDict);
  for (const [, ref] of fonts?.entries() ?? []) {
    const font = dict.context.lookupMaybe(ref, PDFDict);
    if (font && !seen.has(font)) {
      seen.add(font);
      out.push(font);
      for (const descendant of font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray)?.asArray() ?? []) {
        const d = dict.context.lookupMaybe(descendant, PDFDict);
        if (d) out.push(d);
      }
    }
  }
  const xobjects = dict.lookupMaybe(PDFName.of("XObject"), PDFDict);
  for (const [, ref] of xobjects?.entries() ?? []) {
    const x = dict.context.lookupMaybe(ref, PDFStream);
    const resources = x?.dict.lookupMaybe(PDFName.of("Resources"), PDFDict);
    if (resources && !seen.has(resources)) {
      seen.add(resources);
      fontsOf(resources, seen, out);
    }
  }
}

/**
 * The PDF/A-3b rules `pdf` breaks, of those a renderer like ours can break:
 * none when it passes. Not a full validator (veraPDF is one); these are the
 * rules that keep the record archival and its attachments declared.
 */
export async function pdfA3Problems(pdf: Uint8Array): Promise<string[]> {
  const problems: string[] = [];
  const head = new TextDecoder("latin1").decode(pdf.subarray(0, 32));
  if (!/^%PDF-1\.[4-7]/.test(head)) problems.push("the header is not %PDF-1.x");
  const second = head.split("\n")[1] ?? "";
  if (!second.startsWith("%") || [...second.slice(1, 5)].some((c) => c.charCodeAt(0) < 128)) problems.push("no binary comment after the header");
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch {
    return [...problems, "it does not open"];
  }
  const ctx = doc.context;
  const catalog = doc.catalog;
  if (ctx.trailerInfo.Encrypt) problems.push("it is encrypted");
  if (!ctx.trailerInfo.ID) problems.push("no file identifier (trailer ID)");

  const metadata = catalog.lookupMaybe(PDFName.of("Metadata"), PDFStream);
  const xmpText = metadata ? new TextDecoder().decode(streamBytes(metadata)) : "";
  if (!/<pdfaid:part>3<\/pdfaid:part>|pdfaid:part="3"/.test(xmpText)) problems.push("the XMP metadata does not say PDF/A-3");
  if (!/<pdfaid:conformance>[ABU]<\/pdfaid:conformance>|pdfaid:conformance="[ABU]"/.test(xmpText)) problems.push("the XMP metadata names no PDF/A conformance");

  const intents = catalog.lookupMaybe(PDFName.of("OutputIntents"), PDFArray);
  const intent = intents?.asArray().map((o) => ctx.lookupMaybe(o, PDFDict)).find((d) => nameOf(d?.get(PDFName.of("S"))) === "GTS_PDFA1");
  const profile = intent?.lookupMaybe(PDFName.of("DestOutputProfile"), PDFStream);
  if (!profile) problems.push("no PDF/A output intent with an ICC profile");
  else {
    const icc = streamBytes(profile);
    if (new TextDecoder("latin1").decode(icc.subarray(36, 40)) !== "acsp") problems.push("the output intent's profile is not ICC");
  }

  if (catalog.lookupMaybe(PDFName.of("Names"), PDFDict)?.get(PDFName.of("JavaScript"))) problems.push("it carries JavaScript");

  const seen = new Set<PDFDict>();
  const fonts: PDFDict[] = [];
  for (const page of doc.getPages()) fontsOf(page.node.Resources(), seen, fonts);
  for (const font of fonts) {
    const subtype = nameOf(font.get(PDFName.of("Subtype")));
    if (subtype === "Type0" || subtype === "Type3") continue;
    const descriptor = font.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    const embedded = ["FontFile", "FontFile2", "FontFile3"].some((k) => descriptor?.get(PDFName.of(k)));
    if (!embedded) problems.push(`the font ${nameOf(font.get(PDFName.of("BaseFont"))) ?? "?"} is not embedded`);
  }

  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    for (const o of annots?.asArray() ?? []) {
      const annot = ctx.lookupMaybe(o, PDFDict);
      if (!annot) continue;
      const flags = annot.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
      if (!(flags & 4) || flags & (1 | 2 | 32 | 256)) problems.push("an annotation is not printable");
      const rect = annot.lookupMaybe(PDFName.of("Rect"), PDFArray)?.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) ?? [0, 0, 0, 0];
      const area = Math.abs((rect[2]! - rect[0]!) * (rect[3]! - rect[1]!));
      if (area > 0 && nameOf(annot.get(PDFName.of("Subtype"))) !== "Link" && !annot.get(PDFName.of("AP"))) {
        problems.push("an annotation has no appearance");
      }
    }
  }

  const af = catalog.lookupMaybe(PDFName.of("AF"), PDFArray);
  const afRefs = new Set((af?.asArray() ?? []).map((o) => (o instanceof PDFRef ? o.toString() : "")));
  const tree = catalog.lookupMaybe(PDFName.of("Names"), PDFDict)?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const names = tree?.lookupMaybe(PDFName.of("Names"), PDFArray);
  for (let i = 1; i < (names?.size() ?? 0); i += 2) {
    const ref = names!.get(i);
    const spec = names!.lookupMaybe(i, PDFDict);
    const file = spec?.lookupMaybe(PDFName.of("EF"), PDFDict)?.lookupMaybe(PDFName.of("F"), PDFStream);
    if (!spec?.get(PDFName.of("AFRelationship"))) problems.push("an attachment has no AFRelationship");
    if (!file?.dict.get(PDFName.of("Subtype"))) problems.push("an attachment has no MIME type");
    if (!file?.dict.lookupMaybe(PDFName.of("Params"), PDFDict)?.get(PDFName.of("ModDate"))) problems.push("an attachment has no modification date");
    if (!(ref instanceof PDFRef) || !afRefs.has(ref.toString())) problems.push("an attachment is not listed in the document's AF");
  }
  return problems;
}
