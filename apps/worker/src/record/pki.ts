import { webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

// The ASN.1 and X.509 groundwork of the seal (ADR 0023): pkijs on Node's Web
// Crypto. Nothing here holds a real key: in AWS the sealing key stays in KMS
// (signer.ts) and the timestamp comes from a public service (timestamp.ts);
// locally both are issued by an in-memory test authority (local-ca.ts).

const crypto = webcrypto;
// pkijs is typed for the DOM's Crypto, which Node's Web Crypto implements.
pkijs.setEngine("node", new pkijs.CryptoEngine({ name: "node", crypto: crypto as never }));

export { asn1js, pkijs };

/** The Web Crypto the seal uses. */
export const subtle = crypto.subtle;

export const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  signatureTimeStampToken: "1.2.840.113549.1.9.16.2.14",
  tstInfo: "1.2.840.113549.1.9.16.1.4",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
  sha256WithRsa: "1.2.840.113549.1.1.11",
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  keyUsage: "2.5.29.15",
  extendedKeyUsage: "2.5.29.37",
  basicConstraints: "2.5.29.19",
  timeStamping: "1.3.6.1.5.5.7.3.8",
  ocspSigning: "1.3.6.1.5.5.7.3.9",
  crlDistributionPoints: "2.5.29.31",
  authorityInfoAccess: "1.3.6.1.5.5.7.1.1",
  ocsp: "1.3.6.1.5.5.7.48.1",
  caIssuers: "1.3.6.1.5.5.7.48.2",
  ocspBasic: "1.3.6.1.5.5.7.48.1.1",
} as const;

export const toBytes = (buffer: ArrayBuffer | ArrayBufferView): Uint8Array =>
  buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

/** A copy as a plain ArrayBuffer, which pkijs and Web Crypto take. */
/** Exactly `bytes`' own bytes as an ArrayBuffer: never the rest of a pooled Buffer's pool. */
export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return toBytes(await subtle.digest("SHA-256", toArrayBuffer(bytes)));
}

export function parseCertificate(der: Uint8Array): pkijs.Certificate {
  return pkijs.Certificate.fromBER(toArrayBuffer(der));
}

/** The DER of a PEM certificate (the sealing certificate kept beside the KMS key). */
export function pemToDer(pem: string): Uint8Array {
  const body = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem)?.[1];
  if (!body) throw new Error("not a PEM certificate");
  return new Uint8Array(Buffer.from(body.replace(/\s+/g, ""), "base64"));
}

/** The certificate's subject common name. */
export function commonNameOf(certificate: pkijs.Certificate): string | null {
  const cn = certificate.subject.typesAndValues.find((t) => t.type === OID.commonName);
  return cn ? String(cn.value.valueBlock.value) : null;
}

export const RSA_SHA256: webcrypto.RsaHashedKeyGenParams = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

/** The certificate's DER. */
export const certificateDer = (certificate: pkijs.Certificate): Uint8Array => toBytes(certificate.toSchema(true).toBER(false));

/** `items` without repeats, by their bytes, in first-seen order. */
export function distinct(items: readonly Uint8Array[]): Uint8Array[] {
  const seen = new Set<string>();
  return items.filter((der) => {
    const key = Buffer.from(der).toString("base64");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every certificate a CMS SignedData (a seal, a timestamp token) carries, as DER. */
export function signedDataCertificates(signed: pkijs.SignedData): Uint8Array[] {
  return (signed.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate).map(certificateDer);
}

/** ESS signing-certificate-v2 (RFC 5035): the SHA-256 of the signer's certificate, which PAdES requires. */
export async function signingCertificateV2(certificate: Uint8Array): Promise<pkijs.Attribute> {
  const essCertId = new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: toArrayBuffer(await sha256(certificate)) })] });
  return new pkijs.Attribute({
    type: OID.signingCertificateV2,
    values: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertId] })] })],
  });
}

/** The DER the signature covers: the signed attributes encoded as a SET (RFC 5652 §5.4). */
export function signedAttributesDer(attributes: pkijs.Attribute[]): Uint8Array {
  const der = toBytes(new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes }).toSchema().toBER(false)).slice();
  der[0] = 0x31;
  return der;
}
