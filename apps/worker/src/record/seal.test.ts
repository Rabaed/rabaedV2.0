import type { webcrypto } from "node:crypto";
import type { KMSClient } from "@aws-sdk/client-kms";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { attachedFiles, pdfA3Problems, toPdfA3 } from "./pdfa.ts";
import { asn1js, certificateDer, OID, pkijs, RSA_SHA256, subtle, toArrayBuffer } from "./pki.ts";
import { longTermProblems } from "./revocation.ts";
import { documentSecurityStore, sealPdf, sealTamperOffsets, verifySeal, withByteChanged, withDss } from "./seal.ts";
import { kmsSealSigner, LOCAL_SEAL_NAME, localSealSigner, type SealSigner } from "./signer.ts";
import { LOCAL_TSA_NAME, localTimestampAuthority, type TimestampAuthority } from "./timestamp.ts";

// The seal and PDF/A-3 on a small PDF (ADR 0023). The record's own tests (seam 1,
// apps/api/test/documental-record.test.ts) check the same on real records.

const at = new Date("2026-10-17T09:30:00Z");
const xml = new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?>\n<recordData/>\n');

async function plainPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 50, y: 700, width: 200, height: 80 });
  return doc.save();
}

/** The tamper offsets (sealTamperOffsets) where one changed byte still verifies: none, for a sound seal. */
async function tamperedBytesThatStillVerify(pdf: Uint8Array): Promise<string[]> {
  const kept: string[] = [];
  for (const [where, index] of Object.entries(sealTamperOffsets(pdf))) {
    if ((await verifySeal(withByteChanged(pdf, index))).valid) kept.push(where);
  }
  return kept;
}

/** The sealed PDF's Document Security Store's streams, and where its signed revision ends. */
async function storeOf(pdf: Uint8Array) {
  const { store, signedLength } = await documentSecurityStore(pdf);
  if (!store) throw new Error("no Document Security Store");
  return { ...store, signedLength };
}

/**
 * The KMS signer under a self-signed end-entity certificate (cA false, no OCSP or CRL address),
 * as apps/worker/src/cli/sealing-certificate.ts makes it, with KMS stood in by a key in memory
 * and a `fetch` that refuses everything: nothing may be fetched for a trust anchor.
 */
async function kmsSignerUnderSelfSignedCertificate(commonName: string): Promise<SealSigner> {
  const keys = (await subtle.generateKey(RSA_SHA256, false, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 1 });
  const name = [new pkijs.AttributeTypeAndValue({ type: OID.commonName, value: new asn1js.Utf8String({ value: commonName }) })];
  certificate.issuer.typesAndValues.push(...name);
  certificate.subject.typesAndValues.push(...name);
  certificate.notBefore.value = new Date(Date.now() - 60 * 60 * 1000);
  certificate.notAfter.value = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  certificate.extensions = [
    new pkijs.Extension({ extnID: OID.basicConstraints, critical: true, extnValue: new pkijs.BasicConstraints({ cA: false }).toSchema().toBER(false) }),
  ];
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey);
  await certificate.sign(keys.privateKey, "SHA-256");
  const kms = {
    send: async (command: { input: { Message: Uint8Array } }) => ({
      Signature: new Uint8Array(await subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, toArrayBuffer(command.input.Message))),
    }),
  } as unknown as KMSClient;
  const offline = (() => Promise.reject(new Error("nothing is fetched for a trust anchor"))) as unknown as typeof fetch;
  return kmsSealSigner({ keyId: "alias/test-pdf-sealing", region: "me-south-1", certificates: [certificateDer(certificate)] }, kms, offline);
}

let signer: SealSigner;
let timestamps: TimestampAuthority;
let sealed: Uint8Array;
beforeAll(async () => {
  signer = await localSealSigner();
  timestamps = await localTimestampAuthority(() => at);
  const archival = await toPdfA3(await plainPdf(), { title: "MAR-001", at }, [
    { name: "record-data.xml", mimeType: "application/xml", description: "Record Data", bytes: xml },
  ]);
  sealed = await sealPdf(archival, { signer, timestamps, at });
});

describe("the seal", () => {
  it("verifies, under the signer's certificate, with its timestamp and a Document Security Store", async () => {
    expect(await verifySeal(sealed)).toEqual({
      valid: true,
      problem: null,
      signer: LOCAL_SEAL_NAME,
      timestampedAt: at,
      subFilter: "ETSI.CAdES.detached",
      // The signer's and its authority's, the timestamp authority's and its root (fetched: the token carries only its own).
      dssCertificates: 4,
      // The signer's OCSP answer and the timestamp authority's CRL.
      dssRevocation: 2,
      longTerm: true,
    });
  });

  it("is PAdES B-LT: the store holds revocation data for every certificate of the seal's and the timestamp's chains but the roots", async () => {
    const { certificates, ocspResponses, crls } = await storeOf(sealed);
    expect(await longTermProblems(certificates, { certificates, ocspResponses, crls })).toEqual([]);
    expect(await longTermProblems(certificates, { certificates, ocspResponses: [], crls: [] })).toEqual([
      `no revocation data for ${LOCAL_SEAL_NAME}`,
      `no revocation data for ${LOCAL_TSA_NAME}`,
    ]);
  });

  it("still verifies a record sealed before RP-669, whose store holds the seal's certificates alone, as not long-term", async () => {
    const { certificates, signedLength } = await storeOf(sealed);
    // The CMS's two and the token's one, as RP-620 wrote them.
    const before = await withDss(sealed.slice(0, signedLength), { certificates: certificates.slice(0, 3), ocspResponses: [], crls: [] });
    expect(await verifySeal(before)).toMatchObject({ valid: true, dssCertificates: 3, dssRevocation: 0, longTerm: false });
  });

  it("breaks when the store's revocation data is dropped from a long-term seal", async () => {
    const { certificates, ocspResponses, signedLength } = await storeOf(sealed);
    const without = await withDss(sealed.slice(0, signedLength), { certificates, ocspResponses, crls: [] });
    expect(await verifySeal(without)).toMatchObject({ valid: false, problem: `the seal's revocation data does not hold: no revocation data for ${LOCAL_TSA_NAME}` });
  });

  it("is B-LT under a self-signed sealing certificate, as RP-671 makes from the KMS key: a trust anchor needs no revocation data", async () => {
    const anchor = await kmsSignerUnderSelfSignedCertificate("Rabaed Documental Records");
    const pdf = await sealPdf(await plainPdf(), { signer: anchor, timestamps, at });
    expect(await verifySeal(pdf)).toMatchObject({ valid: true, signer: "Rabaed Documental Records", longTerm: true, dssRevocation: 1 });
    // Only the timestamp authority's chain needed any: its certificate's CRL.
    const { certificates, ocspResponses, crls } = await storeOf(pdf);
    expect({ ocsp: ocspResponses.length, crls: crls.length }).toEqual({ ocsp: 0, crls: 1 });
    expect(await longTermProblems(certificates, { certificates, ocspResponses, crls })).toEqual([]);
  });

  it("is never made under a revoked certificate", async () => {
    const revoked: SealSigner = { ...signer, revocation: () => Promise.reject(new Error(`${LOCAL_SEAL_NAME} is revoked: nothing is sealed under it`)) };
    await expect(sealPdf(await plainPdf(), { signer: revoked, timestamps, at })).rejects.toThrow("is revoked");
  });

  it("breaks when any one byte it covers changes", async () => {
    expect(await tamperedBytesThatStillVerify(sealed)).toEqual([]);
  });

  it("breaks when a byte is added after it, as another revision", async () => {
    const appended = new Uint8Array([...sealed, ...new TextEncoder().encode("\n% another revision\n")]);
    expect((await verifySeal(appended)).valid).toBe(false);
  });

  it("is refused on an unsealed PDF", async () => {
    expect(await verifySeal(await plainPdf())).toMatchObject({ valid: false, problem: "no seal" });
  });
});

describe("PDF/A-3", () => {
  it("the sealed record keeps every rule, with the Record Data attached as data", async () => {
    expect(await pdfA3Problems(sealed)).toEqual([]);
    expect(await attachedFiles(sealed)).toEqual([{ name: "record-data.xml", mimeType: "application/xml", relationship: "Data", bytes: xml }]);
  });

  it("names what a PDF that isn't PDF/A lacks", async () => {
    expect(await pdfA3Problems(await plainPdf())).toEqual(
      expect.arrayContaining(["no file identifier (trailer ID)", "the XMP metadata does not say PDF/A-3", "no PDF/A output intent with an ICC profile"]),
    );
  });
});
