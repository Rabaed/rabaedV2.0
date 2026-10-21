import { createHash } from "node:crypto";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFString } from "pdf-lib";
import { ascii, bufferOf, concat, incrementalUpdate, lastMatch, lastRevision, latin1, resolveAs, type IndirectObject, type Revision, type Update } from "./pdf-revision.ts";
import {
  asn1js,
  commonNameOf,
  distinct,
  OID,
  parseCertificate,
  pkijs,
  sha256,
  signedAttributesDer,
  signedDataCertificates,
  signingCertificateV2,
  toArrayBuffer,
  toBytes,
} from "./pki.ts";
import { longTermProblems, mergeRevocationData, type RevocationData } from "./revocation.ts";
import type { SealSigner } from "./signer.ts";
import { tokenCertificates, type TimestampAuthority } from "./timestamp.ts";

// The seal (ADR 0023): PAdES B-LT over the whole PDF/A-3. An invisible
// signature field holds a detached CAdES signature (ETSI.CAdES.detached) by the
// sealing signer, with the ESS signing-certificate-v2 PAdES asks for and an
// RFC 3161 timestamp over the signature value; an incremental update then adds
// the Document Security Store with every certificate needed to validate it
// later and, for each but a root, an OCSP answer or CRL fetched just after the
// timestamp saying it was not revoked (B-LT, RP-669; revocation.ts). Any byte
// changed in what was signed, or in that update, breaks the seal.

/** Room for the CMS: the signer's and the authority's certificates and the token. */
const CONTENTS_BYTES = 24 * 1024;
/** As wide as any final byte range of a file under 10 GB. */
const BYTE_RANGE_PLACEHOLDER = "/ByteRange [ 0 1234567890 1234567890 1234567890 ]";


/** `pdf` with its last cross-reference a classic table, to append to: as it is, or written once again when it isn't. */
async function withClassicTable(pdf: Uint8Array): Promise<{ pdf: Uint8Array; revision: Revision }> {
  const revision = lastRevision(pdf);
  if (revision) return { pdf, revision };
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const written = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { pdf: written, revision: lastRevision(written)! };
}

/** The first page of the page tree, and its reference. */
function firstPage(revision: Revision): { ref: PDFRef; page: PDFDict } {
  const catalog = resolveAs(revision, revision.root, PDFDict);
  let ref = catalog.get(PDFName.of("Pages"));
  for (let depth = 0; depth < 64 && ref instanceof PDFRef; depth++) {
    const node = resolveAs(revision, ref, PDFDict);
    if (node.get(PDFName.of("Type")) === PDFName.of("Page")) return { ref, page: node };
    ref = resolveAs(revision, node.get(PDFName.of("Kids")), PDFArray).get(0);
  }
  throw new Error("the PDF has no first page");
}

interface SignatureUpdate extends Update {
  /** Where `<` of /Contents is in the whole file, and just past its `>`. */
  readonly contentsStart: number;
  readonly contentsEnd: number;
  /** Where the /ByteRange placeholder is in the whole file. */
  readonly byteRangeAt: number;
}

/**
 * The incremental update that adds an empty seal after `revision` (a file of `length` bytes): an
 * invisible signature field on the first page, its /Contents zeros and a placeholder /ByteRange.
 */
function signatureUpdate(revision: Revision, length: number, at: Date): SignatureUpdate {
  const ctx = revision.context;
  const signature = PDFRef.of(revision.largestObjectNumber + 1);
  const widget = PDFRef.of(revision.largestObjectNumber + 2);
  const fields = ctx.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "ETSI.CAdES.detached",
    M: PDFString.fromDate(at),
    Name: PDFString.of("Rabaed"),
    Reason: PDFString.of("Documental Record issued electronically through Rabaed"),
  }).toString();
  if (!fields.startsWith("<<\n")) throw new Error("the seal's dictionary was not written");
  const head = `<<\n${BYTE_RANGE_PLACEHOLDER}\n/Contents <`;
  const zeros = "0".repeat(CONTENTS_BYTES * 2);
  const objects: IndirectObject[] = [{ ref: signature, body: ascii(`${head}${zeros}>\n${fields.slice(3)}`) }];

  const { ref: pageRef, page } = firstPage(revision);
  // Invisible (no area), printable and locked: PDF/A needs no appearance for it.
  const widgetDict = ctx.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: [0, 0, 0, 0],
    V: signature,
    T: PDFString.of("Rabaed seal"),
    F: 132,
    P: pageRef,
  });
  objects.push({ ref: widget, body: ascii(widgetDict.toString()) });
  const annots = page.get(PDFName.of("Annots"));
  if (annots instanceof PDFRef) {
    const array = resolveAs(revision, annots, PDFArray);
    array.push(widget);
    objects.push({ ref: annots, body: ascii(array.toString()) });
  } else {
    if (annots instanceof PDFArray) annots.push(widget);
    else page.set(PDFName.of("Annots"), ctx.obj([widget]));
    objects.push({ ref: pageRef, body: ascii(page.toString()) });
  }
  const catalog = resolveAs(revision, revision.root, PDFDict);
  catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [widget], SigFlags: 3 }));
  objects.push({ ref: revision.root, body: ascii(catalog.toString()) });

  const update = incrementalUpdate(revision, length, objects);
  const signatureAt = update.bodyAt[0]!;
  const contentsStart = signatureAt + head.length - 1;
  // The body starts `<<\n`, then the placeholder.
  return { ...update, contentsStart, contentsEnd: contentsStart + zeros.length + 2, byteRangeAt: signatureAt + "<<\n".length };
}

/** The SHA-256 of `parts`, read where they are. */
function digestOf(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

const digestAlgorithm = () => new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256, algorithmParams: new asn1js.Null() });

/** The detached CMS for `digest`, signed by `signer`, with the timestamp `token` over its signature value. */
async function cadesSignature(digest: Uint8Array, signer: SealSigner, timestamps: TimestampAuthority): Promise<{ cms: Uint8Array; token: Uint8Array }> {
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
  const cms = toBytes(new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) }).toSchema().toBER(false));
  return { cms, token };
}

/** The certificates in the CMS and in its timestamp token: the seal's chain and the timestamp authority's. */
function certificatesOf(cms: Uint8Array): Uint8Array[] {
  const signed = new pkijs.SignedData({ schema: pkijs.ContentInfo.fromBER(toArrayBuffer(cms)).content });
  const tokenAttr = signed.signerInfos[0]?.unsignedAttrs?.attributes.find((a) => a.type === OID.signatureTimeStampToken);
  const token = tokenAttr ? toBytes(tokenAttr.values[0]!.toBER(false)) : null;
  return distinct([...signedDataCertificates(signed), ...(token ? tokenCertificates(token) : [])]);
}

/** What the Document Security Store holds: certificates, CRLs and OCSP answers (DER), each written as a stream. */
type Dss = RevocationData;

/**
 * The incremental update adding the Document Security Store (B-LT) after `revision`, whose file is
 * `length` bytes: the certificates, OCSP answers and CRLs, as streams, then the store and the catalog.
 */
function dssUpdate(revision: Revision, length: number, dss: Dss): Update {
  let next = revision.largestObjectNumber + 1;
  const objects: IndirectObject[] = [];
  const streams = (items: readonly Uint8Array[]) =>
    items.map((der) => {
      const ref = PDFRef.of(next++);
      objects.push({ ref, body: concat(ascii(`<< /Length ${der.length} >>\nstream\n`), der, ascii("\nendstream")) });
      return ref.toString();
    });
  const entries = [
    ["Certs", streams(dss.certificates)],
    ["OCSPs", streams(dss.ocspResponses)],
    ["CRLs", streams(dss.crls)],
  ] as const;
  const dssRef = PDFRef.of(next++);
  const body = entries.filter(([, refs]) => refs.length > 0).map(([key, refs]) => ` /${key} [${refs.join(" ")}]`);
  objects.push({ ref: dssRef, body: ascii(`<< /Type /DSS${body.join("")} >>`) });
  const catalog = resolveAs(revision, revision.root, PDFDict).clone(revision.context);
  catalog.set(PDFName.of("DSS"), dssRef);
  objects.push({ ref: revision.root, body: ascii(catalog.toString()) });
  return incrementalUpdate(revision, length, objects);
}

/** `pdf` with an incremental update adding the Document Security Store (B-LT): the certificates, OCSP answers and CRLs, as streams. */
export function withDss(pdf: Uint8Array, dss: Dss): Uint8Array {
  const revision = lastRevision(pdf);
  if (!revision) throw new Error("the sealed PDF has no cross-reference table");
  return concat(pdf, dssUpdate(revision, pdf.length, dss).bytes);
}

/**
 * Seals `pdf` (a PDF/A-3) at `at`: PAdES B-LT, by `signer`, timestamped by `timestamps`. The
 * seal and then the Document Security Store are incremental updates after `pdf`, which is never
 * parsed or written again (RP-1006): its byte ranges are hashed where they are, and the sealed
 * file is the one copy made of it.
 */
export async function sealPdf(pdf: Uint8Array, { signer, timestamps, at }: { signer: SealSigner; timestamps: TimestampAuthority; at: Date }): Promise<Uint8Array> {
  const base = await withClassicTable(pdf);
  const update = signatureUpdate(base.revision, base.pdf.length, at);
  const { bytes, contentsStart, contentsEnd, byteRangeAt } = update;
  const signedLength = base.pdf.length + bytes.length;
  const rangeText = `/ByteRange [ ${[0, contentsStart, contentsEnd, signedLength - contentsEnd].join(" ")} ]`.padEnd(BYTE_RANGE_PLACEHOLDER.length, " ");
  if (rangeText.length !== BYTE_RANGE_PLACEHOLDER.length) throw new Error("the seal's byte range does not fit");
  // The update's bytes follow the PDF's: an offset in the file, in them.
  const inUpdate = (offset: number) => offset - base.pdf.length;
  bytes.set(ascii(rangeText), inUpdate(byteRangeAt));
  const digest = digestOf(base.pdf, bytes.subarray(0, inUpdate(contentsStart)), bytes.subarray(inUpdate(contentsEnd)));
  const { cms, token } = await cadesSignature(digest, signer, timestamps);
  if (cms.length > CONTENTS_BYTES) throw new Error("the seal's signature is larger than its room");
  bytes.set(ascii(Buffer.from(cms).toString("hex")), inUpdate(contentsStart) + 1);
  // Fetched after the timestamp, so a validator finds it fresher than the time it trusts.
  const [sealing, timestamping] = await Promise.all([signer.revocation(), timestamps.revocation(token)]);
  const dss = dssUpdate(update.revision, signedLength, mergeRevocationData({ certificates: certificatesOf(cms), crls: [], ocspResponses: [] }, sealing, timestamping));
  return concat(base.pdf, bytes, dss.bytes);
}

/**
 * Where a sealed PDF is most likely to be changed unnoticed, by offset: its start, the
 * middle of what was signed, the last byte before the signature, the signature itself, its
 * zero padding, the first byte after it, and the Document Security Store update after the
 * signed revision (its start, middle and end). For the tests that change one byte at each.
 */
export function sealTamperOffsets(pdf: Uint8Array): Record<string, number> {
  const range = byteRangeOf(pdf);
  if (!range) throw new Error("no seal");
  const [, contentsStart, afterContents, rest] = range;
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
  /** The Document Security Store's certificates. */
  readonly dssCertificates: number;
  /** Its OCSP answers and CRLs. */
  readonly dssRevocation: number;
  /**
   * PAdES B-LT: for every certificate of the seal's and the timestamp's chains but a root, the
   * store holds signed revocation data saying it was not revoked. False only for a record sealed
   * before RP-669, whose store holds the certificates alone; any other store that falls short is invalid.
   */
  readonly longTerm: boolean;
}

const invalid = (problem: string, rest: Partial<SealCheck> = {}): SealCheck => ({
  valid: false,
  problem,
  signer: null,
  timestampedAt: null,
  subFilter: null,
  dssCertificates: 0,
  dssRevocation: 0,
  longTerm: false,
  ...rest,
});

/** The seal's /ByteRange: its four numbers, the first found that reads. */
function byteRangeOf(pdf: Uint8Array): [number, number, number, number] | null {
  const m = lastMatch(pdf, "/ByteRange", /^\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  return m ? (m.slice(1).map(Number) as [number, number, number, number]) : null;
}

/** The Document Security Store's streams in the PDF's last revision, in its order, or null when it has none. */
function dssOf(pdf: Uint8Array): Dss | null {
  const revision = lastRevision(pdf);
  if (!revision) return null;
  const store = resolveAs(revision, revision.root, PDFDict).get(PDFName.of("DSS"));
  if (!store) return null;
  const dss = resolveAs(revision, store, PDFDict);
  const streams = (key: string) => {
    const array = dss.get(PDFName.of(key));
    return array ? resolveAs(revision, array, PDFArray).asArray().map((ref) => resolveAs(revision, ref, PDFRawStream).contents) : [];
  };
  return { certificates: streams("Certs"), ocspResponses: streams("OCSPs"), crls: streams("CRLs") };
}

/** The sealed PDF's Document Security Store, and the length of the revision it was signed in (before the store's update). */
export function documentSecurityStore(pdf: Uint8Array): { store: Dss | null; signedLength: number } {
  const range = byteRangeOf(pdf);
  if (!range || range[0] !== 0) throw new Error("no seal");
  return { store: dssOf(pdf), signedLength: range[2] + range[3] };
}

/** The signer's certificate among the CMS's, by the issuer and serial number its signer info names. */
function signerCertificateOf(signed: pkijs.SignedData, signerInfo: pkijs.SignerInfo): pkijs.Certificate | null {
  const sid = signerInfo.sid as pkijs.IssuerAndSerialNumber;
  if (!(sid instanceof pkijs.IssuerAndSerialNumber)) return null;
  const certificates = (signed.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
  return certificates.find((c) => c.issuer.isEqual(sid.issuer) && c.serialNumber.isEqual(sid.serialNumber)) ?? null;
}

/**
 * Whether the CMS signs `digest` (SHA-256 of what the byte range covers): its message-digest
 * attribute is the digest, and the signer's key signs its signed attributes. What pkijs's
 * SignedData.verify checks, without a copy of the whole file to hash.
 */
async function signsDigest(signed: pkijs.SignedData, digest: Uint8Array): Promise<{ matches: boolean; signer: pkijs.Certificate | null }> {
  const signerInfo = signed.signerInfos[0];
  if (!signerInfo?.signedAttrs) throw new Error("the signature has no signed attributes");
  const signer = signerCertificateOf(signed, signerInfo);
  const attribute = (type: string) => signerInfo.signedAttrs!.attributes.find((a) => a.type === type);
  const messageDigest = attribute(OID.messageDigest)?.values[0];
  const contentType = attribute(OID.contentType)?.values[0];
  const isData = contentType instanceof asn1js.ObjectIdentifier && contentType.getValue() === OID.data;
  if (!isData || !(messageDigest instanceof asn1js.OctetString)) throw new Error("the signature's attributes are not a detached CMS's");
  if (signerInfo.digestAlgorithm.algorithmId !== OID.sha256) throw new Error("the signature is not over SHA-256");
  if (Buffer.compare(Buffer.from(messageDigest.valueBlock.valueHexView), Buffer.from(digest)) !== 0) return { matches: false, signer };
  if (!signer) throw new Error("the signer's certificate is not in the signature");
  const matches = await pkijs
    .getCrypto(true)
    .verifyWithPublicKey(signerInfo.signedAttrs.encodedValue, signerInfo.signature, signer.subjectPublicKeyInfo, signerInfo.signatureAlgorithm, "SHA-256");
  return { matches, signer };
}

const sameList = (a: readonly Uint8Array[], b: readonly Uint8Array[]) =>
  a.length === b.length && a.every((x, i) => Buffer.compare(Buffer.from(x), Buffer.from(b[i]!)) === 0);

/** Checks the PDF's seal: what a reader such as Adobe Reader checks, but trusting the certificate it carries. */
export async function verifySeal(pdf: Uint8Array): Promise<SealCheck> {
  const range = byteRangeOf(pdf);
  if (!range) return invalid("no seal");
  const [a, b, c, d] = range;
  if (a !== 0 || c <= b || c + d > pdf.length || pdf[b] !== 0x3c || pdf[c - 1] !== 0x3e) return invalid("the seal does not cover the file");
  const subFilter = lastMatch(pdf, "/SubFilter", /^\/SubFilter\s*\/([A-Za-z.]+)/)?.[1] ?? null;
  // /Contents is exactly the CMS's DER, then zeros: a byte changed in its padding breaks the seal too.
  const contentsHex = latin1.decode(pdf.subarray(b + 1, c - 1));
  if (contentsHex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(contentsHex)) return invalid("the seal's signature is not hexadecimal", { subFilter });
  const contents = new Uint8Array(Buffer.from(contentsHex, "hex"));
  const read = asn1js.fromBER(toArrayBuffer(contents));
  if (read.offset === -1) return invalid("the seal does not read", { subFilter });
  if (contents.subarray(read.offset).some((x) => x !== 0)) return invalid("the seal's signature has bytes after it", { subFilter });
  const cms = contents.slice(0, read.offset);
  let dss: Dss | null;
  try {
    dss = dssOf(pdf);
  } catch {
    return invalid("the PDF does not open", { subFilter });
  }
  const dssCertificates = dss?.certificates.length ?? 0;
  const dssRevocation = (dss?.crls.length ?? 0) + (dss?.ocspResponses.length ?? 0);
  try {
    const signed = new pkijs.SignedData({ schema: pkijs.ContentInfo.fromBER(toArrayBuffer(cms)).content });
    // Hashed where it is: no copy of what was signed.
    const signature = await signsDigest(signed, digestOf(pdf.subarray(0, b), pdf.subarray(c, c + d)));
    const name = signature.signer ? commonNameOf(signature.signer) : null;
    if (!signature.matches) return invalid("the signature does not match the file", { signer: name, subFilter, dssCertificates });
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
    // After what was signed comes only a Document Security Store update as the seal writes it, byte
    // for byte, holding the seal's certificates: any other change, or another revision, breaks the seal.
    const counts = { signer: name, subFilter, dssCertificates, dssRevocation };
    const chains = certificatesOf(cms);
    let longTerm = false;
    if (c + d < pdf.length) {
      const signedRevision = dss ? lastRevision(pdf.subarray(0, c + d)) : null;
      const expectedUpdate = dss && signedRevision ? dssUpdate(signedRevision, c + d, dss).bytes : null;
      if (!dss || !expectedUpdate || Buffer.compare(bufferOf(expectedUpdate), bufferOf(pdf.subarray(c + d))) !== 0) {
        return invalid("the file was changed after it was sealed", counts);
      }
      // The revocation data must hold, so a byte changed inside it breaks the seal too. Chains of
      // self-signed certificates alone need none (a trust anchor has no revocation data), and are B-LT.
      // Short of it only when sealed before RP-669: the seal's certificates alone, still valid.
      const problems = await longTermProblems(chains, dss);
      const beforeRp669 = dssRevocation === 0 && sameList(dss.certificates, chains);
      if (problems.length > 0 && !beforeRp669) return invalid(`the seal's revocation data does not hold: ${problems.join("; ")}`, counts);
      longTerm = problems.length === 0;
    }
    return { valid: true, problem: null, signer: name, timestampedAt: info.genTime, subFilter, dssCertificates, dssRevocation, longTerm };
  } catch (error) {
    return invalid(`the seal does not read: ${error instanceof Error ? error.message : String(error)}`, { subFilter, dssCertificates, dssRevocation });
  }
}
