import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from "pdf-lib";
import { asn1js, commonNameOf, OID, parseCertificate, pkijs, sha256, signedAttributesDer, signingCertificateV2, toArrayBuffer, toBytes } from "./pki.ts";
import type { SealSigner } from "./signer.ts";
import type { TimestampAuthority } from "./timestamp.ts";

// The seal (ADR 0023): PAdES B-LT over the whole PDF/A-3. An invisible
// signature field holds a detached CAdES signature (ETSI.CAdES.detached) by the
// sealing signer, with the ESS signing-certificate-v2 PAdES asks for and an
// RFC 3161 timestamp over the signature value; an incremental update then adds
// the Document Security Store with every certificate needed to validate it
// later (B-LT). Any byte changed in what was signed breaks the seal.

/** Room for the CMS: the signer's and the authority's certificates and the token. */
const CONTENTS_BYTES = 24 * 1024;
const BYTE_RANGE_PLACEHOLDER = "/ByteRange [ 0 1234567890 1234567890 1234567890 ]";

const latin1 = new TextDecoder("latin1");
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The PDF with an empty seal: its /Contents zeros and a placeholder /ByteRange, written whole (no object streams). */
async function withSignatureField(pdf: Uint8Array, at: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ctx = doc.context;
  const byteRange = PDFArray.withContext(ctx);
  byteRange.push(PDFNumber.of(0));
  for (let i = 0; i < 3; i++) byteRange.push(PDFName.of("BYTE_RANGE"));
  const signature = ctx.register(
    ctx.obj({
      Type: "Sig",
      Filter: "Adobe.PPKLite",
      SubFilter: "ETSI.CAdES.detached",
      ByteRange: byteRange,
      Contents: PDFHexString.of("0".repeat(CONTENTS_BYTES * 2)),
      M: PDFString.fromDate(at),
      Name: PDFString.of("Rabaed"),
      Reason: PDFString.of("Documental Record issued electronically through Rabaed"),
    }),
  );
  const page = doc.getPage(0);
  // Invisible (no area), printable and locked: PDF/A needs no appearance for it.
  const widget = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      Rect: [0, 0, 0, 0],
      V: signature,
      T: PDFString.of("Rabaed seal"),
      F: 132,
      P: page.ref,
    }),
  );
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) annots.push(widget);
  else page.node.set(PDFName.of("Annots"), ctx.obj([widget]));
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [widget], SigFlags: 3 }));
  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  // pdf-lib writes a name; the placeholder has the final range's width.
  const text = latin1.decode(bytes);
  const written = /\/ByteRange\s*\[\s*0\s+\/BYTE_RANGE\s+\/BYTE_RANGE\s+\/BYTE_RANGE\s*\]/.exec(text);
  if (!written) throw new Error("the seal's byte range was not written");
  if (written[0].length < BYTE_RANGE_PLACEHOLDER.length) throw new Error("the seal's byte range placeholder is too long");
  const padded = BYTE_RANGE_PLACEHOLDER.padEnd(written[0].length, " ");
  return concat(bytes.subarray(0, written.index), ascii(padded), bytes.subarray(written.index + written[0].length));
}

interface Placeholder {
  /** Where `<` of /Contents starts, and just past its `>`. */
  readonly contentsStart: number;
  readonly contentsEnd: number;
  readonly byteRangeAt: number;
  readonly byteRangeLength: number;
}

function findPlaceholder(pdf: Uint8Array): Placeholder {
  const text = latin1.decode(pdf);
  const zeros = `<${"0".repeat(CONTENTS_BYTES * 2)}>`;
  const contentsStart = text.lastIndexOf(zeros);
  const byteRangeAt = text.lastIndexOf("/ByteRange [ 0 1234567890");
  if (contentsStart < 0 || byteRangeAt < 0) throw new Error("no seal placeholder");
  const byteRangeLength = text.indexOf("]", byteRangeAt) + 1 - byteRangeAt;
  return { contentsStart, contentsEnd: contentsStart + zeros.length, byteRangeAt, byteRangeLength };
}

const digestAlgorithm = () => new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256, algorithmParams: new asn1js.Null() });

/** The detached CMS for `digest`, signed by `signer`, with the timestamp over its signature value. */
async function cadesSignature(digest: Uint8Array, signer: SealSigner, timestamps: TimestampAuthority): Promise<Uint8Array> {
  const [first, ...issuers] = signer.certificates;
  if (!first) throw new Error("the sealing signer has no certificate");
  const certificate = parseCertificate(first);
  const signedAttrs = [
    new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
    new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: toArrayBuffer(digest) })] }),
    await signingCertificateV2(first),
  ];
  const signature = await signer.sign(signedAttributesDer(signedAttrs));
  const token = await timestamps.timestamp(await sha256(signature));
  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [digestAlgorithm()],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    certificates: [certificate, ...issuers.map(parseCertificate)],
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: certificate.issuer, serialNumber: certificate.serialNumber }),
        digestAlgorithm: digestAlgorithm(),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: signedAttrs }),
        signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256WithRsa, algorithmParams: new asn1js.Null() }),
        signature: new asn1js.OctetString({ valueHex: toArrayBuffer(signature) }),
        unsignedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 1,
          attributes: [new pkijs.Attribute({ type: OID.signatureTimeStampToken, values: [asn1js.fromBER(toArrayBuffer(token)).result] })],
        }),
      }),
    ],
  });
  return toBytes(new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) }).toSchema().toBER(false));
}

/** The certificates in the CMS and in its timestamp token: what a validator needs years later. */
function certificatesOf(cms: Uint8Array): Uint8Array[] {
  const signed = new pkijs.SignedData({ schema: pkijs.ContentInfo.fromBER(toArrayBuffer(cms)).content });
  const own = (signed.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
  const tokenAttr = signed.signerInfos[0]?.unsignedAttrs?.attributes.find((a) => a.type === OID.signatureTimeStampToken);
  const token = tokenAttr ? new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: tokenAttr.values[0] }).content }) : null;
  const tsa = (token?.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
  const seen = new Set<string>();
  return [...own, ...tsa]
    .map((c) => toBytes(c.toSchema(true).toBER(false)))
    .filter((der) => {
      const key = Buffer.from(der).toString("base64");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Appends an incremental update adding the Document Security Store (B-LT): the certificates, as streams. */
async function withDss(pdf: Uint8Array, certificates: Uint8Array[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ctx = doc.context;
  const text = latin1.decode(pdf);
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1]);
  if (!Number.isFinite(prev)) throw new Error("the sealed PDF has no cross-reference table");
  const rootRef = ctx.trailerInfo.Root as PDFRef;
  let next = ctx.largestObjectNumber + 1;
  const parts: Uint8Array[] = [ascii("\n")];
  let offset = pdf.length + 1;
  const offsets: [number, number, number][] = [];
  const write = (objectNumber: number, generation: number, body: Uint8Array) => {
    offsets.push([objectNumber, generation, offset]);
    const head = ascii(`${objectNumber} ${generation} obj\n`);
    const tail = ascii("\nendobj\n");
    parts.push(head, body, tail);
    offset += head.length + body.length + tail.length;
  };
  const certRefs: string[] = [];
  for (const der of certificates) {
    const n = next++;
    certRefs.push(`${n} 0 R`);
    write(n, 0, concat(ascii(`<< /Length ${der.length} >>\nstream\n`), der, ascii("\nendstream")));
  }
  const dss = next++;
  write(dss, 0, ascii(`<< /Type /DSS /Certs [${certRefs.join(" ")}] >>`));
  const catalog = ctx.lookup(rootRef, PDFDict).clone(ctx);
  catalog.set(PDFName.of("DSS"), PDFRef.of(dss));
  write(rootRef.objectNumber, rootRef.generationNumber, ascii(catalog.toString()));

  const xrefAt = offset;
  const lines = ["xref", "0 1", "0000000000 65535 f\r"];
  for (const [n, g, at] of offsets.toSorted((a, b) => a[0] - b[0])) {
    lines.push(`${n} 1`, `${String(at).padStart(10, "0")} ${String(g).padStart(5, "0")} n\r`);
  }
  const trailer = PDFDict.withContext(ctx);
  trailer.set(PDFName.of("Size"), PDFNumber.of(next));
  trailer.set(PDFName.of("Root"), rootRef);
  if (ctx.trailerInfo.Info) trailer.set(PDFName.of("Info"), ctx.trailerInfo.Info as PDFRef);
  if (ctx.trailerInfo.ID) trailer.set(PDFName.of("ID"), ctx.trailerInfo.ID as PDFArray);
  trailer.set(PDFName.of("Prev"), PDFNumber.of(prev));
  lines.push("trailer", trailer.toString(), "startxref", String(xrefAt), "%%EOF", "");
  parts.push(ascii(lines.join("\n")));
  return concat(pdf, ...parts);
}

/** Seals `pdf` (a PDF/A-3) at `at`: PAdES B-LT, by `signer`, timestamped by `timestamps`. */
export async function sealPdf(pdf: Uint8Array, { signer, timestamps, at }: { signer: SealSigner; timestamps: TimestampAuthority; at: Date }): Promise<Uint8Array> {
  const prepared = await withSignatureField(pdf, at);
  const p = findPlaceholder(prepared);
  const range = [0, p.contentsStart, p.contentsEnd, prepared.length - p.contentsEnd];
  const rangeText = `/ByteRange [ ${range.join(" ")} ]`.padEnd(p.byteRangeLength, " ");
  if (rangeText.length !== p.byteRangeLength) throw new Error("the seal's byte range does not fit");
  const ranged = concat(prepared.subarray(0, p.byteRangeAt), ascii(rangeText), prepared.subarray(p.byteRangeAt + p.byteRangeLength));
  const digest = await sha256(concat(ranged.subarray(0, p.contentsStart), ranged.subarray(p.contentsEnd)));
  const cms = await cadesSignature(digest, signer, timestamps);
  if (cms.length > CONTENTS_BYTES) throw new Error("the seal's signature is larger than its room");
  const hex = Buffer.from(cms).toString("hex").padEnd(CONTENTS_BYTES * 2, "0");
  const signed = concat(ranged.subarray(0, p.contentsStart + 1), ascii(hex), ranged.subarray(p.contentsEnd - 1));
  return withDss(signed, certificatesOf(cms));
}

/**
 * Where a sealed PDF is most likely to be changed unnoticed, by offset: its start, the
 * middle of what was signed, the last byte before the signature, the signature itself, its
 * zero padding, the first byte after it, and the Document Security Store update after the
 * signed revision (its start, middle and end). For the tests that change one byte at each.
 */
export function sealTamperOffsets(pdf: Uint8Array): Record<string, number> {
  const m = /\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)/.exec(latin1.decode(pdf));
  if (!m) throw new Error("no seal");
  const [contentsStart, afterContents, rest] = m.slice(1).map(Number) as [number, number, number];
  const signedEnd = afterContents + rest;
  return {
    start: 20,
    "middle of what was signed": Math.floor(contentsStart / 2),
    "last byte before the signature": contentsStart - 1,
    "the signature": contentsStart + 40,
    "the signature's padding": afterContents - 3,
    "first byte after the signature": afterContents,
    "middle after the signature": afterContents + Math.floor((signedEnd - afterContents) / 2),
    "start of the security store update": signedEnd + 2,
    "middle of the security store update": Math.floor((signedEnd + pdf.length) / 2),
    "end of the file": pdf.length - 8,
  };
}

/** `pdf` with the byte at `index` changed: a digit for another inside hex, so it still reads as hex. */
export function withByteChanged(pdf: Uint8Array, index: number): Uint8Array {
  const changed = pdf.slice();
  changed[index] = changed[index] === 0x30 ? 0x31 : changed[index]! ^ 0x01;
  return changed;
}

export interface SealCheck {
  /** The signature covers every byte of the signed revision but its own, and verifies, and so does its timestamp. */
  readonly valid: boolean;
  /** Why not, when it isn't. */
  readonly problem: string | null;
  /** The sealing certificate's common name. */
  readonly signer: string | null;
  /** When the timestamp authority says it was sealed. */
  readonly timestampedAt: Date | null;
  readonly subFilter: string | null;
  /** The Document Security Store's certificates (B-LT). */
  readonly dssCertificates: number;
}

const invalid = (problem: string, rest: Partial<SealCheck> = {}): SealCheck => ({
  valid: false,
  problem,
  signer: null,
  timestampedAt: null,
  subFilter: null,
  dssCertificates: 0,
  ...rest,
});

/** Checks the PDF's seal: what a reader such as Adobe Reader checks, but trusting the certificate it carries. */
export async function verifySeal(pdf: Uint8Array): Promise<SealCheck> {
  const text = latin1.decode(pdf);
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  if (!m) return invalid("no seal");
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if (a !== 0 || c <= b || c + d > pdf.length || pdf[b] !== 0x3c || pdf[c - 1] !== 0x3e) return invalid("the seal does not cover the file");
  const subFilter = /\/SubFilter\s*\/([A-Za-z.]+)/.exec(text)?.[1] ?? null;
  // /Contents is exactly the CMS's DER, then zeros: a byte changed in its padding breaks the seal too.
  const contentsHex = latin1.decode(pdf.subarray(b + 1, c - 1));
  if (contentsHex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(contentsHex)) return invalid("the seal's signature is not hexadecimal", { subFilter });
  const contents = new Uint8Array(Buffer.from(contentsHex, "hex"));
  const read = asn1js.fromBER(toArrayBuffer(contents));
  if (read.offset === -1) return invalid("the seal does not read", { subFilter });
  if (contents.subarray(read.offset).some((x) => x !== 0)) return invalid("the seal's signature has bytes after it", { subFilter });
  const cms = contents.slice(0, read.offset);
  let dssCertificates: number;
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    const dss = doc.catalog.lookupMaybe(PDFName.of("DSS"), PDFDict);
    dssCertificates = dss?.lookupMaybe(PDFName.of("Certs"), PDFArray)?.size() ?? 0;
  } catch {
    return invalid("the PDF does not open", { subFilter });
  }
  try {
    const signed = new pkijs.SignedData({ schema: pkijs.ContentInfo.fromBER(toArrayBuffer(cms)).content });
    const data = concat(pdf.subarray(0, b), pdf.subarray(c, c + d));
    const ok = await signed.verify({ signer: 0, data: toArrayBuffer(data), checkChain: false, extendedMode: true });
    const signerCert = ok.signerCertificate ?? null;
    const name = signerCert ? commonNameOf(signerCert) : null;
    if (!ok.signatureVerified) return invalid("the signature does not match the file", { signer: name, subFilter, dssCertificates });
    const signerInfo = signed.signerInfos[0]!;
    const tokenAttr = signerInfo.unsignedAttrs?.attributes.find((x) => x.type === OID.signatureTimeStampToken);
    if (!tokenAttr) return invalid("no timestamp", { signer: name, subFilter, dssCertificates });
    const token = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: tokenAttr.values[0] }).content });
    const signatureValue = toBytes(signerInfo.signature.getValue());
    // Checks the token's own signature and that it timestamps this signature value.
    const tokenOk = await token.verify({ signer: 0, data: toArrayBuffer(signatureValue), checkChain: false, extendedMode: true });
    const info = pkijs.TSTInfo.fromBER((token.encapContentInfo.eContent as asn1js.OctetString).getValue());
    const imprint = toBytes(info.messageImprint.hashedMessage.getValue());
    const expected = await sha256(signatureValue);
    if (!tokenOk.signatureVerified || Buffer.compare(Buffer.from(imprint), Buffer.from(expected)) !== 0) {
      return invalid("the timestamp does not match the signature", { signer: name, subFilter, dssCertificates });
    }
    // After what was signed comes only the Document Security Store update the seal wrote, byte for byte:
    // any other change, or another revision, breaks the seal.
    if (c + d < pdf.length) {
      const expectedFile = await withDss(pdf.slice(0, c + d), certificatesOf(cms));
      if (Buffer.compare(Buffer.from(expectedFile), Buffer.from(pdf)) !== 0) {
        return invalid("the file was changed after it was sealed", { signer: name, subFilter, dssCertificates });
      }
    }
    return { valid: true, problem: null, signer: name, timestampedAt: info.genTime, subFilter, dssCertificates };
  } catch (error) {
    return invalid(`the seal does not read: ${error instanceof Error ? error.message : String(error)}`, { subFilter, dssCertificates });
  }
}
