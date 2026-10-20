import { webcrypto } from "node:crypto";
import { asn1js, certificateDer, OID, parseCertificate, pkijs, RSA_SHA256, subtle, toArrayBuffer, toBytes } from "./pki.ts";

// The local stand-in for a certificate authority (RP-669): in development and
// tests the sealing key and the timestamp stand-in are each issued by one, made
// in memory and never written anywhere, and it answers the OCSP, CRL and issuer
// addresses its certificates name, in this process. So a local seal carries the
// same revocation data as one made in AWS (PAdES B-LT) and nothing needs the
// internet: its addresses are under `.invalid`, which never resolves, and its
// `fetch` refuses every other address.

export interface LocalKey {
  readonly privateKey: webcrypto.CryptoKey;
  readonly certificate: Uint8Array;
}

export interface IssueOptions {
  /** Marks the certificate for RFC 3161 tokens only, as RFC 3161 asks. */
  readonly timeStamping?: boolean;
  /** Names the authority's OCSP responder (AIA); the CRL's address is always named. */
  readonly ocsp?: boolean;
}

export interface LocalCertificateAuthority {
  /** Its own self-signed certificate (DER): the root of what it issues. */
  readonly certificate: Uint8Array;
  /** A fresh key and a certificate for it, issued by this authority. */
  issue(commonName: string, options?: IssueOptions): Promise<LocalKey>;
  /** From now on its OCSP responder and CRL say `certificate` (one it issued) is revoked. */
  revoke(certificate: Uint8Array): void;
  /** Answers its OCSP, CRL and issuer addresses; refuses any other, as local mode has no internet. */
  readonly fetch: typeof fetch;
}

export interface AuthorityOptions {
  /** Its clock: its CRLs' and OCSP answers' times. */
  readonly now?: () => Date;
  /**
   * Who signs its OCSP answers: itself (the default), or a responder it delegates to (RFC 6960
   * §4.2.2.2), whose certificate the answer carries, marked id-pkix-ocsp-nocheck or not.
   */
  readonly responder?: "itself" | "delegated" | "delegated-nocheck";
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function name(commonName: string): pkijs.AttributeTypeAndValue[] {
  return [
    new pkijs.AttributeTypeAndValue({ type: OID.organization, value: new asn1js.Utf8String({ value: "Rabaed" }) }),
    new pkijs.AttributeTypeAndValue({ type: OID.commonName, value: new asn1js.Utf8String({ value: commonName }) }),
  ];
}

function randomCertificateNumber(): asn1js.Integer {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  bytes[0]! &= 0x7f;
  return new asn1js.Integer({ valueHex: toArrayBuffer(bytes) });
}

const uri = (value: string) => new pkijs.GeneralName({ type: 6, value });

const extension = (extnID: string, critical: boolean, value: { toSchema(): asn1js.AsnType } | asn1js.AsnType) =>
  new pkijs.Extension({ extnID, critical, extnValue: ("toSchema" in value ? value.toSchema() : value).toBER(false) });

/** Key usage bits, bit 0 first (RFC 5280 §4.2.1.3). */
function keyUsage(bits: number[]): asn1js.BitString {
  const byte = bits.reduce((b, bit) => b | (0x80 >> bit), 0);
  const last = Math.max(...bits);
  return new asn1js.BitString({ valueHex: new Uint8Array([byte]).buffer, unusedBits: 7 - last });
}

async function newKeys(): Promise<webcrypto.CryptoKeyPair> {
  return (await subtle.generateKey(RSA_SHA256, false, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
}

/** A local certificate authority named `commonName`. */
export async function localCertificateAuthority(
  commonName: string,
  { now = () => new Date(), responder = "itself" }: AuthorityOptions = {},
): Promise<LocalCertificateAuthority> {
  const base = `http://${Buffer.from(webcrypto.getRandomValues(new Uint8Array(6))).toString("hex")}.local-ca.invalid`;
  const keys = await newKeys();
  const created = Date.now();
  const root = new pkijs.Certificate();
  root.version = 2;
  root.serialNumber = randomCertificateNumber();
  root.issuer.typesAndValues.push(...name(commonName));
  root.subject.typesAndValues.push(...name(commonName));
  root.notBefore.value = new Date(created - HOUR);
  root.notAfter.value = new Date(created + 10 * 365 * DAY);
  root.extensions = [
    extension(OID.basicConstraints, true, new pkijs.BasicConstraints({ cA: true })),
    // keyCertSign, cRLSign; digitalSignature for the OCSP answers it signs itself.
    extension(OID.keyUsage, true, keyUsage([0, 5, 6])),
  ];
  await root.subjectPublicKeyInfo.importKey(keys.publicKey);
  await root.sign(keys.privateKey, "SHA-256");
  const rootDer = certificateDer(root);

  const issued = new Set<string>();
  const revoked = new Map<string, Date>();
  const numberHex = (n: asn1js.Integer) => Buffer.from(n.valueBlock.valueHexView).toString("hex");

  async function issueKey(subjectName: string, { timeStamping = false, ocsp: withOcsp = false }: IssueOptions, extra: pkijs.Extension[] = []): Promise<LocalKey> {
    const leafKeys = await newKeys();
    const certificate = new pkijs.Certificate();
    certificate.version = 2;
    certificate.serialNumber = randomCertificateNumber();
    certificate.issuer.typesAndValues.push(...name(commonName));
    certificate.subject.typesAndValues.push(...name(subjectName));
    const issuedAt = Date.now();
    certificate.notBefore.value = new Date(issuedAt - HOUR);
    certificate.notAfter.value = new Date(issuedAt + 365 * DAY);
    const access = [
      ...(withOcsp ? [new pkijs.AccessDescription({ accessMethod: OID.ocsp, accessLocation: uri(`${base}/ocsp`) })] : []),
      new pkijs.AccessDescription({ accessMethod: OID.caIssuers, accessLocation: uri(`${base}/ca.cer`) }),
    ];
    certificate.extensions = [
      extension(OID.basicConstraints, true, new pkijs.BasicConstraints({ cA: false })),
      // digitalSignature and nonRepudiation (contentCommitment).
      extension(OID.keyUsage, true, keyUsage([0, 1])),
      ...(timeStamping ? [extension(OID.extendedKeyUsage, true, new pkijs.ExtKeyUsage({ keyPurposes: [OID.timeStamping] }))] : []),
      extension(OID.authorityInfoAccess, false, new pkijs.InfoAccess({ accessDescriptions: access })),
      extension(
        OID.crlDistributionPoints,
        false,
        new pkijs.CRLDistributionPoints({ distributionPoints: [new pkijs.DistributionPoint({ distributionPoint: [uri(`${base}/crl`)] })] }),
      ),
      ...extra,
    ];
    await certificate.subjectPublicKeyInfo.importKey(leafKeys.publicKey);
    await certificate.sign(keys.privateKey, "SHA-256");
    issued.add(numberHex(certificate.serialNumber));
    return { privateKey: leafKeys.privateKey, certificate: certificateDer(certificate) };
  }

  const responderName = `${commonName} OCSP responder`;
  const delegate =
    responder === "itself"
      ? null
      : await issueKey(responderName, {}, [
          extension(OID.extendedKeyUsage, false, new pkijs.ExtKeyUsage({ keyPurposes: [OID.ocspSigning] })),
          ...(responder === "delegated-nocheck" ? [extension(OID.ocspNoCheck, false, new asn1js.Null())] : []),
        ]);

  async function crl(): Promise<Uint8Array> {
    const at = now();
    const list = new pkijs.CertificateRevocationList();
    list.version = 1;
    list.issuer.typesAndValues.push(...name(commonName));
    list.thisUpdate = new pkijs.Time({ type: 0, value: at });
    list.nextUpdate = new pkijs.Time({ type: 0, value: new Date(at.getTime() + 7 * DAY) });
    if (revoked.size > 0) {
      list.revokedCertificates = [...revoked].map(
        ([numberOf, when]) =>
          new pkijs.RevokedCertificate({
            // eslint-disable-next-line rabaed/no-avoid-terms -- pkijs's name for the field, RFC 5280's userCertificate.
            userCertificate: new asn1js.Integer({ valueHex: toArrayBuffer(Buffer.from(numberOf, "hex")) }),
            revocationDate: new pkijs.Time({ type: 0, value: when }),
          }),
      );
    }
    await list.sign(keys.privateKey, "SHA-256");
    return toBytes(list.toSchema(true).toBER(false));
  }

  async function ocsp(body: Uint8Array): Promise<Uint8Array> {
    const at = now();
    const request = pkijs.OCSPRequest.fromBER(toArrayBuffer(body));
    const responses = request.tbsRequest.requestList.map((r) => {
      const number = numberHex(r.reqCert.serialNumber);
      const when = revoked.get(number);
      // good [0] NULL, revoked [1] RevokedInfo, unknown [2] NULL (RFC 6960 §4.2.1).
      const certStatus = when
        ? new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 1 }, value: [new asn1js.GeneralizedTime({ valueDate: when })] })
        : new asn1js.Primitive({ idBlock: { tagClass: 3, tagNumber: issued.has(number) ? 0 : 2 } });
      return new pkijs.SingleResponse({ certID: r.reqCert, certStatus, thisUpdate: at, nextUpdate: new Date(at.getTime() + 7 * DAY) });
    });
    const responderID = new pkijs.RelativeDistinguishedNames({ typesAndValues: name(delegate ? responderName : commonName) });
    const basic = new pkijs.BasicOCSPResponse({
      tbsResponseData: new pkijs.ResponseData({ responderID, producedAt: at, responses }),
      ...(delegate ? { certs: [parseCertificate(delegate.certificate)] } : {}),
    });
    await basic.sign(delegate?.privateKey ?? keys.privateKey, "SHA-256");
    return toBytes(
      new pkijs.OCSPResponse({
        responseStatus: new asn1js.Enumerated({ value: 0 }),
        responseBytes: new pkijs.ResponseBytes({
          responseType: OID.ocspBasic,
          response: new asn1js.OctetString({ valueHex: basic.toSchema().toBER(false) }),
        }),
      })
        .toSchema()
        .toBER(false),
    );
  }

  const answer = (bytes: Uint8Array, type: string) => new Response(toArrayBuffer(bytes), { status: 200, headers: { "content-type": type } });

  const localFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== base) throw new Error(`local mode has no internet: ${url.href}`);
    if (url.pathname === "/ocsp" && init?.method === "POST") return answer(await ocsp(new Uint8Array(await new Response(init.body).arrayBuffer())), "application/ocsp-response");
    if (url.pathname === "/crl") return answer(await crl(), "application/pkix-crl");
    if (url.pathname === "/ca.cer") return answer(rootDer, "application/pkix-cert");
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  return {
    certificate: rootDer,
    issue: (subjectName, options = {}) => issueKey(subjectName, options),
    revoke(certificate) {
      revoked.set(numberHex(parseCertificate(certificate).serialNumber), now());
    },
    fetch: localFetch,
  };
}
