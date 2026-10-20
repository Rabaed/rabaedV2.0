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

/** The parsed value of `certificate`'s (or a CRL's) extension `oid`, if it has one. */
function extensionOf<T>(holder: { extensions?: pkijs.Extension[]; crlExtensions?: pkijs.Extensions }, oid: string): T | undefined {
  const all = holder.extensions ?? holder.crlExtensions?.extensions ?? [];
  return all.find((e) => e.extnID === oid)?.parsedValue as T | undefined;
}

const isCa = (certificate: pkijs.Certificate) => extensionOf<pkijs.BasicConstraints>(certificate, OID.basicConstraints)?.cA === true;

/** Its issuer among `candidates`: a CA of the name it names, whose key signed it. */
async function issuerIn(certificate: pkijs.Certificate, candidates: readonly pkijs.Certificate[]): Promise<pkijs.Certificate | null> {
  for (const candidate of candidates) {
    if (candidate.subject.isEqual(certificate.issuer) && isCa(candidate) && (await signedBy(certificate, candidate))) return candidate;
  }
  return null;
}

/** The URIs `certificate` names in its AIA for `method` (OCSP or caIssuers). */
function accessUrls(certificate: pkijs.Certificate, method: string): string[] {
  const access = extensionOf<pkijs.InfoAccess>(certificate, OID.authorityInfoAccess);
  return (access?.accessDescriptions ?? []).filter((d) => d.accessMethod === method && d.accessLocation.type === 6).map((d) => String(d.accessLocation.value));
}

/** The URIs of `certificate`'s CRL distribution points. */
function crlUrls(certificate: pkijs.Certificate): string[] {
  const points = extensionOf<pkijs.CRLDistributionPoints>(certificate, OID.crlDistributionPoints);
  return (points?.distributionPoints ?? []).flatMap((p) =>
    Array.isArray(p.distributionPoint) ? p.distributionPoint.filter((n) => n.type === 6).map((n) => String(n.value)) : [],
  );
}

function hasExtendedKeyUsage(certificate: pkijs.Certificate, purpose: string): boolean {
  return extensionOf<pkijs.ExtKeyUsage>(certificate, OID.extendedKeyUsage)?.keyPurposes.includes(purpose) ?? false;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** OCSPResponse status successful, and a SingleResponse's certStatus (RFC 6960 §4.2.1). */
const OCSP_SUCCESSFUL = 0;
const CERT_GOOD = 0;
const CERT_UNKNOWN = 2;

function basicResponseOf(der: Uint8Array): pkijs.BasicOCSPResponse | null {
  const response = pkijs.OCSPResponse.fromBER(toArrayBuffer(der));
  const bytes = response.responseBytes;
  if (response.responseStatus.valueBlock.valueDec !== OCSP_SUCCESSFUL || !bytes || bytes.responseType !== OID.ocspBasic) return null;
  return pkijs.BasicOCSPResponse.fromBER(bytes.response.valueBlock.valueHexView);
}

/** Clock difference tolerated between Rabaed and a responder or CRL issuer. */
const SKEW_MS = 5 * 60 * 1000;

/** Current at `at`: issued by then (give or take the skew) and not past its next update. */
function currentAt(at: Date, thisUpdate: Date, nextUpdate: Date | undefined): boolean {
  return thisUpdate.getTime() <= at.getTime() + SKEW_MS && (!nextUpdate || nextUpdate.getTime() >= at.getTime() - SKEW_MS);
}

/** The certificate is valid at `at`. */
const validAt = (certificate: pkijs.Certificate, at: Date) =>
  certificate.notBefore.value.getTime() <= at.getTime() + SKEW_MS && certificate.notAfter.value.getTime() >= at.getTime() - SKEW_MS;

/** The CRL covers `certificate` whole: no delta CRL, and no issuing distribution point narrowing it to other certificates, some reasons or another issuer. */
function crlCovers(crl: pkijs.CertificateRevocationList, certificate: pkijs.Certificate): boolean {
  if (extensionOf(crl, OID.deltaCrlIndicator) !== undefined) return false;
  const point = extensionOf<pkijs.IssuingDistributionPoint>(crl, OID.issuingDistributionPoint);
  if (!point) return true;
  if (point.onlySomeReasons !== undefined || point.indirectCRL || point.onlyContainsAttributeCerts) return false;
  return isCa(certificate) ? !point.onlyContainsUserCerts : !point.onlyContainsCACerts;
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
  /** The OCSP answer or CRL that says so (DER). */
  readonly source: Uint8Array;
  /**
   * A delegated OCSP responder that signed the answer, when its own revocation must be shown
   * too: it lacks id-pkix-ocsp-nocheck (RFC 6960 §4.2.2.2.1). Null for the issuer itself, a CRL,
   * or a responder marked nocheck.
   */
  readonly responderToCheck: pkijs.Certificate | null;
  /** The responder's certificate, whenever the answer is a delegated responder's: the store keeps it. */
  readonly responder: pkijs.Certificate | null;
}

/**
 * What `data` says of `certificate` (issued by `issuer`): only from an OCSP answer or CRL whose
 * signature holds and that covers it. With `freshAt` (when fetching), only one current then.
 */
async function evidenceIn(
  certificate: pkijs.Certificate,
  issuer: pkijs.Certificate,
  data: RevocationData,
  known: readonly pkijs.Certificate[],
  freshAt: Date | null = null,
): Promise<Evidence | null> {
  for (const der of data.ocspResponses) {
    try {
      const basic = basicResponseOf(der);
      if (!basic) continue;
      const { isForCertificate, status } = await basic.getCertificateStatus(certificate, issuer);
      if (!isForCertificate || status === CERT_UNKNOWN) continue;
      if (freshAt && !basic.tbsResponseData.responses.every((r) => currentAt(freshAt, r.thisUpdate, r.nextUpdate))) continue;
      const responder = await ocspSignerFor(basic, issuer, known);
      if (!responder) continue;
      const delegated = sameDer(responder, issuer) ? null : responder;
      if (delegated && freshAt && !validAt(delegated, freshAt)) continue;
      const responderToCheck = delegated && extensionOf(delegated, OID.ocspNoCheck) === undefined ? delegated : null;
      return { status: status === CERT_GOOD ? "good" : "revoked", source: der, responder: delegated, responderToCheck };
    } catch {
      // Not a readable answer: no evidence either way.
    }
  }
  for (const der of data.crls) {
    try {
      const crl = pkijs.CertificateRevocationList.fromBER(toArrayBuffer(der));
      if (!crl.issuer.isEqual(issuer.subject) || !crlCovers(crl, certificate)) continue;
      if (freshAt && !currentAt(freshAt, crl.thisUpdate.value, crl.nextUpdate?.value)) continue;
      if (!(await crl.verify({ issuerCertificate: issuer }))) continue;
      return { status: crl.isCertificateRevoked(certificate) ? "revoked" : "good", source: der, responder: null, responderToCheck: null };
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
    if (evidence?.responderToCheck) todo.push(evidence.responderToCheck);
    todo.push(issuer);
  }
  for (const der of data.certificates) if (!used.has(key(der))) problems.push(`a certificate nothing needs: ${nameOf(parseCertificate(der))}`);
  if ([...data.ocspResponses, ...data.crls].some((der) => !used.has(key(der)))) problems.push("revocation data nothing needs");
  return problems;
}

/** The most a certificate, an OCSP answer or a CRL may be: large public CRLs run to a few MB. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * The bytes at `url`, an address a certificate names: plain http(s) only, never a loopback or
 * link-local host (the task's metadata endpoint), never redirected, and no larger than MAX_BYTES.
 */
async function get(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<Uint8Array> {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("not an http(s) address");
  if (/^(localhost|127\.|169\.254\.|0\.|::1$|fe80:)/i.test(host)) throw new Error("a local address");
  const res = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("answered more than 20 MB");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("answered more than 20 MB");
  return bytes;
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
  const now = new Date();
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
        failures.push(`${url}: ${errorText(error)}`);
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
        const evidence = await evidenceIn(certificate, issuer, { ...NO_REVOCATION_DATA, ocspResponses: [der] }, known, now);
        if (evidence) {
          status = evidence.status;
          ocspResponses.push(der);
          // A delegated responder's certificate, which the validator needs to check the answer,
          // and, unless it is marked nocheck, its own revocation data.
          if (evidence.responder && !known.includes(evidence.responder)) {
            known.push(evidence.responder);
            certificates.push(certificateDer(evidence.responder));
          }
          if (evidence.responderToCheck) todo.push(evidence.responderToCheck);
          break;
        }
        failures.push(`${url}: no current answer for it signed for its issuer`);
      } catch (error) {
        failures.push(`${url}: ${errorText(error)}`);
      }
    }
    for (const url of status ? [] : crlUrls(certificate)) {
      try {
        const der = await get(fetchImpl, url);
        status = (await evidenceIn(certificate, issuer, { ...NO_REVOCATION_DATA, crls: [der] }, known, now))?.status ?? null;
        if (status) {
          crls.push(der);
          break;
        }
        failures.push(`${url}: not a current CRL its issuer signed that covers it`);
      } catch (error) {
        failures.push(`${url}: ${errorText(error)}`);
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

