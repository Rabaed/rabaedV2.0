import { createHash } from "node:crypto";
import { certificateDer, commonNameOf, distinct, OID, parseCertificate, pkijs, toArrayBuffer, toBytes } from "./pki.ts";

// The seal's revocation data (RP-669): what makes it PAdES B-LT and not only
// B-T. For every certificate of the sealing chain and of the timestamp
// authority's chain but a self-signed root, the Document Security Store keeps
// an OCSP answer or a CRL saying it was not revoked when the record was sealed,
// so a validator in 2035 needs nothing online. Fetched by each adapter just
// after the timestamp (signer.ts, timestamp.ts): OCSP first, then the CRL, as
// the certificate names them; an issuer missing from the chain from the
// certificate's AIA caIssuers address. In AWS that is the internet; locally the
// in-memory test authority answers (local-ca.ts).

export interface RevocationData {
  /** Certificates a validator needs besides the chains themselves: issuers fetched, OCSP responders. */
  readonly certificates: readonly Uint8Array[];
  /** CRLs (DER). */
  readonly crls: readonly Uint8Array[];
  /** OCSPResponses (DER, RFC 6960), each a successful one. */
  readonly ocspResponses: readonly Uint8Array[];
}

export const NO_REVOCATION_DATA: RevocationData = { certificates: [], crls: [], ocspResponses: [] };

/** `parts` as one, each list without repeats. */
export function mergeRevocationData(...parts: RevocationData[]): RevocationData {
  return {
    certificates: distinct(parts.flatMap((p) => p.certificates)),
    crls: distinct(parts.flatMap((p) => p.crls)),
    ocspResponses: distinct(parts.flatMap((p) => p.ocspResponses)),
  };
}

const nameOf = (certificate: pkijs.Certificate) => commonNameOf(certificate) ?? "a certificate";
const sameDer = (a: pkijs.Certificate, b: pkijs.Certificate) => Buffer.compare(Buffer.from(certificateDer(a)), Buffer.from(certificateDer(b))) === 0;

async function signedBy(certificate: pkijs.Certificate, issuer: pkijs.Certificate): Promise<boolean> {
  try {
    return await certificate.verify(issuer);
  } catch {
    return false;
  }
}

/** A root: issued by itself, under its own key. Its trust is the validator's to decide; it needs no revocation data. */
async function selfSigned(certificate: pkijs.Certificate): Promise<boolean> {
  return certificate.subject.isEqual(certificate.issuer) && signedBy(certificate, certificate);
}

async function issuerIn(certificate: pkijs.Certificate, candidates: readonly pkijs.Certificate[]): Promise<pkijs.Certificate | null> {
  for (const candidate of candidates) {
    if (candidate.subject.isEqual(certificate.issuer) && (await signedBy(certificate, candidate))) return candidate;
  }
  return null;
}

/** The URIs `certificate` names in its AIA for `method` (OCSP or caIssuers). */
function accessUrls(certificate: pkijs.Certificate, method: string): string[] {
  const parsed = certificate.extensions?.find((e) => e.extnID === OID.authorityInfoAccess)?.parsedValue as pkijs.InfoAccess | undefined;
  return (parsed?.accessDescriptions ?? []).filter((d) => d.accessMethod === method && d.accessLocation.type === 6).map((d) => String(d.accessLocation.value));
}

/** The URIs of `certificate`'s CRL distribution points. */
function crlUrls(certificate: pkijs.Certificate): string[] {
  const parsed = certificate.extensions?.find((e) => e.extnID === OID.crlDistributionPoints)?.parsedValue as pkijs.CRLDistributionPoints | undefined;
  return (parsed?.distributionPoints ?? []).flatMap((p) =>
    Array.isArray(p.distributionPoint) ? p.distributionPoint.filter((n) => n.type === 6).map((n) => String(n.value)) : [],
  );
}

function hasExtendedKeyUsage(certificate: pkijs.Certificate, purpose: string): boolean {
  const parsed = certificate.extensions?.find((e) => e.extnID === OID.extendedKeyUsage)?.parsedValue as pkijs.ExtKeyUsage | undefined;
  return parsed?.keyPurposes.includes(purpose) ?? false;
}

function basicResponseOf(der: Uint8Array): pkijs.BasicOCSPResponse | null {
  const response = pkijs.OCSPResponse.fromBER(toArrayBuffer(der));
  const bytes = response.responseBytes;
  if (response.responseStatus.valueBlock.valueDec !== 0 || !bytes || bytes.responseType !== OID.ocspBasic) return null;
  return pkijs.BasicOCSPResponse.fromBER(bytes.response.valueBlock.valueHexView);
}

/** Who signed the answer: `issuer` itself, or a responder `issuer` authorised for OCSP signing (RFC 6960 §4.2.2.2); null when neither did. */
async function ocspSignerFor(
  basic: pkijs.BasicOCSPResponse,
  issuer: pkijs.Certificate,
  known: readonly pkijs.Certificate[],
): Promise<pkijs.Certificate | null> {
  const id = basic.tbsResponseData.responderID;
  for (const responder of [issuer, ...(basic.certs ?? []), ...known]) {
    // byName, or byKey: the SHA-1 of the responder's public key (RFC 6960 §4.2.1).
    const named =
      id instanceof pkijs.RelativeDistinguishedNames
        ? id.isEqual(responder.subject)
        : Buffer.compare(
            createHash("sha1").update(responder.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView).digest(),
            Buffer.from(id.valueBlock.valueHexView),
          ) === 0;
    if (!named) continue;
    const authorised = sameDer(responder, issuer) || ((await signedBy(responder, issuer)) && hasExtendedKeyUsage(responder, OID.ocspSigning));
    if (!authorised) continue;
    try {
      const ok = await pkijs
        .getCrypto(true)
        .verifyWithPublicKey(basic.tbsResponseData.tbsView, basic.signature, responder.subjectPublicKeyInfo, basic.signatureAlgorithm);
      if (ok) return responder;
    } catch {
      // Another candidate may be the one.
    }
  }
  return null;
}

type Status = "good" | "revoked";

interface Evidence {
  readonly status: Status;
  /** The OCSP answer or CRL that says so (DER), and the responder that signed an OCSP answer. */
  readonly source: Uint8Array;
  readonly responder: pkijs.Certificate | null;
}

/** What `data` says of `certificate` (issued by `issuer`): only from an OCSP answer or CRL whose signature holds. */
async function evidenceIn(
  certificate: pkijs.Certificate,
  issuer: pkijs.Certificate,
  data: RevocationData,
  known: readonly pkijs.Certificate[],
): Promise<Evidence | null> {
  for (const der of data.ocspResponses) {
    try {
      const basic = basicResponseOf(der);
      if (!basic) continue;
      const { isForCertificate, status } = await basic.getCertificateStatus(certificate, issuer);
      if (!isForCertificate || status === 2) continue;
      const responder = await ocspSignerFor(basic, issuer, known);
      if (!responder) continue;
      return { status: status === 0 ? "good" : "revoked", source: der, responder };
    } catch {
      // Not a readable answer: no evidence either way.
    }
  }
  for (const der of data.crls) {
    try {
      const crl = pkijs.CertificateRevocationList.fromBER(toArrayBuffer(der));
      if (!crl.issuer.isEqual(issuer.subject) || !(await crl.verify({ issuerCertificate: issuer }))) continue;
      return { status: crl.isCertificateRevoked(certificate) ? "revoked" : "good", source: der, responder: null };
    } catch {
      // Not a readable CRL: no evidence either way.
    }
  }
  return null;
}

/**
 * Why `chain` (every certificate a seal carries: the signer's chain and the timestamp
 * authority's) would not validate long-term from `data` alone: for each certificate but a
 * self-signed root, its issuer must be among them, and an OCSP answer or CRL signed for that
 * issuer must say it is not revoked. And `data` holds nothing else: every certificate in it is an
 * issuer or an OCSP responder this needs, and every answer and CRL is one it reads, so no byte
 * of it can change unnoticed. Empty when it would.
 */
export async function longTermProblems(chain: readonly Uint8Array[], data: RevocationData): Promise<string[]> {
  const key = (der: Uint8Array) => Buffer.from(der).toString("base64");
  const known = distinct([...chain, ...data.certificates]).map(parseCertificate);
  const problems: string[] = [];
  const used = new Set(chain.map(key));
  const done = new Set<pkijs.Certificate>();
  const todo = chain.map((der) => known.find((c) => key(certificateDer(c)) === key(der))!);
  for (let certificate = todo.shift(); certificate; certificate = todo.shift()) {
    if (done.has(certificate)) continue;
    done.add(certificate);
    if (await selfSigned(certificate)) continue;
    const issuer = await issuerIn(certificate, known);
    if (!issuer) {
      problems.push(`no issuer for ${nameOf(certificate)}`);
      continue;
    }
    used.add(key(certificateDer(issuer)));
    const evidence = await evidenceIn(certificate, issuer, data, known);
    if (evidence?.status === "revoked") problems.push(`${nameOf(certificate)} is revoked`);
    else if (!evidence) problems.push(`no revocation data for ${nameOf(certificate)}`);
    if (evidence) used.add(key(evidence.source));
    if (evidence?.responder) used.add(key(certificateDer(evidence.responder)));
    todo.push(issuer);
  }
  for (const der of data.certificates) if (!used.has(key(der))) problems.push(`a certificate nothing needs: ${nameOf(parseCertificate(der))}`);
  if ([...data.ocspResponses, ...data.crls].some((der) => !used.has(key(der)))) problems.push("revocation data nothing needs");
  return problems;
}

async function get(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<Uint8Array> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** The certificates at a caIssuers address: one DER certificate, or a certs-only PKCS #7 (.p7c). */
function certificatesAt(der: Uint8Array): pkijs.Certificate[] {
  try {
    return [parseCertificate(der)];
  } catch {
    const signed = new pkijs.SignedData({ schema: pkijs.ContentInfo.fromBER(toArrayBuffer(der)).content });
    return (signed.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
  }
}

async function ocspRequest(certificate: pkijs.Certificate, issuer: pkijs.Certificate): Promise<Uint8Array> {
  const request = new pkijs.OCSPRequest();
  // SHA-1 names the certificate in the request (RFC 6960 §4.1.1), what every responder reads; it signs nothing.
  await request.createForCertificate(certificate, { hashAlgorithm: "SHA-1", issuerCertificate: issuer });
  return toBytes(request.toSchema(true).toBER(false));
}

/**
 * Fetches the revocation data for `chain` (a certificate then its issuers, as a seal or a
 * timestamp token carries them) with `fetchImpl`, now. Throws when a certificate is revoked,
 * or when one has no issuer or no revocation data to be had: a seal is never made short of B-LT.
 */
export async function fetchRevocationData(chain: readonly Uint8Array[], fetchImpl: typeof fetch): Promise<RevocationData> {
  const known = distinct(chain).map(parseCertificate);
  const certificates: Uint8Array[] = [];
  const crls: Uint8Array[] = [];
  const ocspResponses: Uint8Array[] = [];
  const failures: string[] = [];
  const done = new Set<pkijs.Certificate>();
  const todo = [...known];
  for (let certificate = todo.shift(); certificate; certificate = todo.shift()) {
    if (done.has(certificate)) continue;
    done.add(certificate);
    if (await selfSigned(certificate)) continue;
    let issuer = await issuerIn(certificate, known);
    for (const url of issuer ? [] : accessUrls(certificate, OID.caIssuers)) {
      try {
        const found = certificatesAt(await get(fetchImpl, url));
        issuer = await issuerIn(certificate, found);
        if (issuer) {
          known.push(issuer);
          certificates.push(certificateDer(issuer));
          break;
        }
      } catch (error) {
        failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!issuer) throw new Error(`no issuer for ${nameOf(certificate)} (${failures.join("; ") || "its certificate names none"})`);

    let status: Status | null = null;
    for (const url of accessUrls(certificate, OID.ocsp)) {
      try {
        const der = await get(fetchImpl, url, {
          method: "POST",
          headers: { "content-type": "application/ocsp-request" },
          body: toArrayBuffer(await ocspRequest(certificate, issuer)),
        });
        const evidence = await evidenceIn(certificate, issuer, { ...NO_REVOCATION_DATA, ocspResponses: [der] }, known);
        if (evidence) {
          status = evidence.status;
          ocspResponses.push(der);
          // A delegated responder's certificate, which the validator needs to check the answer.
          if (evidence.responder && !known.includes(evidence.responder)) {
            known.push(evidence.responder);
            certificates.push(certificateDer(evidence.responder));
          }
          break;
        }
        failures.push(`${url}: no signed answer for it`);
      } catch (error) {
        failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const url of status ? [] : crlUrls(certificate)) {
      try {
        const der = await get(fetchImpl, url);
        status = (await evidenceIn(certificate, issuer, { ...NO_REVOCATION_DATA, crls: [der] }, known))?.status ?? null;
        if (status) {
          crls.push(der);
          break;
        }
        failures.push(`${url}: not a CRL its issuer signed`);
      } catch (error) {
        failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (status === "revoked") throw new Error(`${nameOf(certificate)} is revoked: nothing is sealed under it`);
    if (!status) throw new Error(`no revocation data for ${nameOf(certificate)} (${failures.join("; ") || "its certificate names no OCSP or CRL address"})`);
    todo.push(issuer);
  }
  const data = { certificates: distinct(certificates), crls: distinct(crls), ocspResponses: distinct(ocspResponses) };
  const problems = await longTermProblems(chain, data);
  if (problems.length > 0) throw new Error(`the revocation data is incomplete: ${problems.join("; ")}`);
  return data;
}

