import { localCertificateAuthority, selfSignedAuthority } from "./local-ca.ts";
import { commonNameOf, OID, parseCertificate, pemToDer, pkijs, RSA_SHA256, subtle, toArrayBuffer, toBytes } from "./pki.ts";
import { fetchRevocationData } from "./revocation.ts";
import type { SealSigner } from "./signer.ts";

// The UAT signer (RP-1042, ADR 0026): the UAT Records container seals with a test key, never
// KMS and never Rabaed's own certificate. Its authority is a self-signed certificate and its
// key, made once by the owner (cli/uat-sealing-authority.ts) and held only as host secrets
// (UAT_SEALING_AUTHORITY_KEY, UAT_SEALING_AUTHORITY_CERTIFICATE), never in the repo. At its
// first record the worker issues itself a fresh sealing key from it, in memory, as the local
// signer does; that authority answers its OCSP and CRL addresses in this process, so the seal
// is PAdES B-LT with nothing to reach on the internet. Every UAT record therefore chains to one
// UAT authority, and its name says it is a test key.

/** The common name of the UAT authority: always holding "UAT", which the signer checks. */
export const UAT_AUTHORITY_NAME = "Rabaed UAT sealing authority (test only, not trusted)";
/** The common name of the UAT seal's certificate: never Rabaed's real one. */
export const UAT_SIGNER_NAME = "Rabaed Documental Records (UAT test key, not valid)";

/** The UAT authority as the host holds it: a PKCS #8 PEM key and its PEM certificate. */
export interface UatAuthority {
  readonly key: string;
  readonly certificate: string;
}

export interface NewUatAuthorityOptions {
  /** Its common name; the tests set another to see it refused. */
  readonly commonName?: string;
  /** When it expires: two years from now unless set (UAT is not meant to last). */
  readonly notAfter?: Date;
}

const YEAR = 365 * 24 * 60 * 60 * 1000;

const pem = (label: string, der: Uint8Array) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

/** A new UAT authority: the owner's one-off command makes it, and the tests make their own. */
export async function newUatAuthority({ commonName = UAT_AUTHORITY_NAME, notAfter = new Date(Date.now() + 2 * YEAR) }: NewUatAuthorityOptions = {}): Promise<UatAuthority> {
  const root = await selfSignedAuthority(commonName, { extractable: true, notAfter });
  const key = toBytes(await subtle.exportKey("pkcs8", root.privateKey));
  return { key: pem("PRIVATE KEY", key), certificate: pem("CERTIFICATE", root.certificate) };
}

function keyDer(value: string): Uint8Array {
  const body = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(value)?.[1];
  if (!body) throw new Error("the UAT sealing authority's key is not a PEM private key (PKCS #8)");
  return new Uint8Array(Buffer.from(body.replace(/\s+/g, ""), "base64"));
}

function certificateOf(value: string): { der: Uint8Array; certificate: pkijs.Certificate } {
  let der: Uint8Array;
  try {
    der = pemToDer(value);
  } catch {
    throw new Error("the UAT sealing authority's certificate is not a PEM certificate");
  }
  return { der, certificate: parseCertificate(der) };
}

const isAuthority = (certificate: pkijs.Certificate) =>
  certificate.extensions?.some((e) => e.extnID === OID.basicConstraints && (e.parsedValue as pkijs.BasicConstraints | undefined)?.cA === true) ?? false;

/**
 * The signer under the UAT authority `authority`. Refuses an authority that is not plainly a UAT
 * one (its name without "UAT", not an authority, expired) and a key that is not its certificate's,
 * so a real certificate can never be put on the UAT host by mistake.
 */
export async function uatSigner(authority: UatAuthority, now: Date = new Date()): Promise<SealSigner> {
  const { der, certificate } = certificateOf(authority.certificate);
  const name = commonNameOf(certificate) ?? "";
  if (!/\bUAT\b/.test(name)) throw new Error(`the UAT sealing authority's certificate is not a UAT one (its name is "${name}")`);
  if (!isAuthority(certificate)) throw new Error("the UAT sealing authority's certificate is not an authority's (cA)");
  if (certificate.notAfter.value.getTime() <= now.getTime()) throw new Error("the UAT sealing authority's certificate has expired");
  const privateKey = await subtle.importKey("pkcs8", toArrayBuffer(keyDer(authority.key)), RSA_SHA256, false, ["sign"]);
  const probe = new TextEncoder().encode("RP-1042 key probe");
  const signature = await subtle.sign("RSASSA-PKCS1-v1_5", privateKey, toArrayBuffer(probe));
  const publicKey = await certificate.getPublicKey();
  if (!(await subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, toArrayBuffer(probe)))) {
    throw new Error("the UAT sealing authority's key does not match its certificate");
  }

  const ca = await localCertificateAuthority(name, { root: { privateKey, certificate: der } });
  const key = await ca.issue(UAT_SIGNER_NAME, { ocsp: true });
  const certificates = [key.certificate, der];
  return {
    certificates,
    sign: async (message) => toBytes(await subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, toArrayBuffer(message))),
    revocation: () => fetchRevocationData(certificates, ca.fetch),
    test: true,
  };
}
