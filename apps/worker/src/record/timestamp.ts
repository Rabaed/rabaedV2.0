import { webcrypto } from "node:crypto";
import { localCertificateAuthority } from "./local-ca.ts";
import {
  asn1js,
  OID,
  parseCertificate,
  pkijs,
  sha256,
  signedAttributesDer,
  signedDataCertificates,
  signingCertificateV2,
  subtle,
  toArrayBuffer,
  toBytes,
} from "./pki.ts";
import { publicFetch } from "./public-fetch.ts";
import { fetchRevocationData, type RevocationData } from "./revocation.ts";

// The timestamp authority (ADR 0023), the seal's other adapter: in AWS a free
// public RFC 3161 service; locally and in tests a stand-in in this process, so
// no test needs the internet. Either returns an RFC 3161 TimeStampToken (a CMS
// SignedData over a TSTInfo) for a SHA-256 digest: the seal's signature value,
// and fetches the revocation data for the certificates of a token it gave
// (RP-669): the public service's from the addresses they name, the stand-in's
// from its own in-memory authority (local-ca.ts).

export interface TimestampAuthority {
  /** A TimeStampToken (DER) over `digest`, a SHA-256. */
  timestamp(digest: Uint8Array): Promise<Uint8Array>;
  /** Revocation data for the certificates of `token`, one it gave, fetched now (revocation.ts); throws when one is revoked or has none. */
  revocation(token: Uint8Array): Promise<RevocationData>;
}

/** The certificates a TimeStampToken carries (DER): the authority's, and any of its issuers. */
export function tokenCertificates(token: Uint8Array): Uint8Array[] {
  return signedDataCertificates(new pkijs.SignedData({ schema: pkijs.ContentInfo.fromBER(toArrayBuffer(token)).content }));
}

/** The common name of the local stand-in's certificate. */
export const LOCAL_TSA_NAME = "Rabaed local timestamp authority (tests only, not trusted)";
/** The common name of the test authority that issues it. */
export const LOCAL_TSA_CA_NAME = "Rabaed local timestamping root (tests only, not trusted)";

/** The TSA policy the stand-in names: "any policy", it being no real service. */
const LOCAL_POLICY = "2.5.29.32.0";

/**
 * The local stand-in: signs its own TSTInfo with an in-memory key, at `now()`. Like most public
 * services, its token carries its own certificate only, which names its issuer's address and its CRL.
 */
export async function localTimestampAuthority(now: () => Date = () => new Date()): Promise<TimestampAuthority> {
  const ca = await localCertificateAuthority(LOCAL_TSA_CA_NAME);
  const key = await ca.issue(LOCAL_TSA_NAME, { timeStamping: true });
  const certificate = parseCertificate(key.certificate);
  let serial = 0;
  return {
    revocation: (token) => fetchRevocationData(tokenCertificates(token), ca.fetch),
    async timestamp(digest) {
      serial += 1;
      const tstInfo = new pkijs.TSTInfo({
        version: 1,
        policy: LOCAL_POLICY,
        messageImprint: new pkijs.MessageImprint({
          hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
          hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(digest) }),
        }),
        serialNumber: new asn1js.Integer({ value: serial }),
        genTime: now(),
        ordering: false,
      });
      const content = toBytes(tstInfo.toSchema().toBER(false));
      const signedAttrs = [
        new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.tstInfo })] }),
        new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: toArrayBuffer(await sha256(content)) })] }),
        await signingCertificateV2(key.certificate),
      ];
      const signature = toBytes(await subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, toArrayBuffer(signedAttributesDer(signedAttrs))));
      const signedData = new pkijs.SignedData({
        version: 3,
        digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256, algorithmParams: new asn1js.Null() })],
        encapContentInfo: new pkijs.EncapsulatedContentInfo({
          eContentType: OID.tstInfo,
          eContent: new asn1js.OctetString({ valueHex: toArrayBuffer(content) }),
        }),
        certificates: [certificate],
        signerInfos: [
          new pkijs.SignerInfo({
            version: 1,
            sid: new pkijs.IssuerAndSerialNumber({ issuer: certificate.issuer, serialNumber: certificate.serialNumber }),
            digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256, algorithmParams: new asn1js.Null() }),
            signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: signedAttrs }),
            signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256WithRsa, algorithmParams: new asn1js.Null() }),
            signature: new asn1js.OctetString({ valueHex: toArrayBuffer(signature) }),
          }),
        ],
      });
      // pkijs writes eContent as a constructed OCTET STRING; RFC 3161 tokens carry
      // it primitive (DER), as real authorities do and as pkijs reads it back.
      const schema = signedData.toSchema(true) as asn1js.Sequence;
      schema.valueBlock.value[2] = new asn1js.Sequence({
        value: [
          new asn1js.ObjectIdentifier({ value: OID.tstInfo }),
          new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 0 }, value: [new asn1js.OctetString({ valueHex: toArrayBuffer(content) })] }),
        ],
      });
      return toBytes(new pkijs.ContentInfo({ contentType: OID.signedData, content: schema }).toSchema().toBER(false));
    },
  };
}

/**
 * A public RFC 3161 service at `url`, asked over HTTP(S) with a nonce; refuses any answer but a
 * granted token. Its certificates' revocation data comes from the addresses they name, public
 * ones only (`revocationFetch`, `publicFetch` by default, RP-1085): `url` is Rabaed's own setting,
 * those addresses are the CA's.
 */
export function rfc3161TimestampAuthority(url: string, fetchImpl: typeof fetch = fetch, revocationFetch: typeof fetch = publicFetch()): TimestampAuthority {
  return {
    revocation: (token) => fetchRevocationData(tokenCertificates(token), revocationFetch),
    async timestamp(digest) {
      const nonce = webcrypto.getRandomValues(new Uint8Array(8));
      nonce[0]! &= 0x7f;
      const request = new pkijs.TimeStampReq({
        version: 1,
        messageImprint: new pkijs.MessageImprint({
          hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
          hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(digest) }),
        }),
        nonce: new asn1js.Integer({ valueHex: toArrayBuffer(nonce) }),
        certReq: true,
      });
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/timestamp-query" },
        body: toBytes(request.toSchema().toBER(false)),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`the timestamp authority answered ${res.status}`);
      const response = pkijs.TimeStampResp.fromBER(await res.arrayBuffer());
      const status = response.status.status;
      if ((status !== 0 && status !== 1) || !response.timeStampToken) throw new Error(`the timestamp authority refused: status ${status}`);
      const token = response.timeStampToken;
      const info = pkijs.TSTInfo.fromBER((new pkijs.SignedData({ schema: token.content }).encapContentInfo.eContent as asn1js.OctetString).getValue());
      if (!info.nonce || !info.nonce.isEqual(request.nonce!)) throw new Error("the timestamp authority's answer has another nonce");
      return toBytes(token.toSchema().toBER(false));
    },
  };
}
