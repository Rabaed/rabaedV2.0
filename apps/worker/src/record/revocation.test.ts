import type { KMSClient } from "@aws-sdk/client-kms";
import { beforeAll, describe, expect, it } from "vitest";
import { localCertificateAuthority, type LocalCertificateAuthority } from "./local-ca.ts";
import { fetchRevocationData, longTermProblems } from "./revocation.ts";
import { kmsSealSigner } from "./signer.ts";

// The seal's revocation data (RP-669, PAdES B-LT), fetched as in AWS but from the
// in-memory test authority: OCSP first, then the CRL, the issuer from its address
// when the chain lacks it, and never a seal under a revoked certificate. No test
// here reaches the internet.

let ca: LocalCertificateAuthority;
beforeAll(async () => {
  ca = await localCertificateAuthority("Test root");
});

/** `ca.fetch`, but its OCSP responder down. */
const ocspDown: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) =>
  String(input).endsWith("/ocsp") ? new Response(null, { status: 503 }) : ca.fetch(input, init)) as typeof fetch;

describe("fetching the revocation data", () => {
  it("asks the OCSP responder first, for a certificate that names one; the root needs none", async () => {
    const key = await ca.issue("Sealing", { ocsp: true });
    const data = await fetchRevocationData([key.certificate, ca.certificate], ca.fetch);
    expect({ ocsp: data.ocspResponses.length, crls: data.crls.length, certificates: data.certificates.length }).toEqual({ ocsp: 1, crls: 0, certificates: 0 });
  });

  it("takes the CRL when the certificate names no OCSP responder, or its responder is down", async () => {
    const noOcsp = await ca.issue("Timestamps", { timeStamping: true });
    expect(await fetchRevocationData([noOcsp.certificate, ca.certificate], ca.fetch)).toMatchObject({ ocspResponses: [], crls: [expect.any(Uint8Array)] });
    const withOcsp = await ca.issue("Sealing", { ocsp: true });
    expect(await fetchRevocationData([withOcsp.certificate, ca.certificate], ocspDown)).toMatchObject({ ocspResponses: [], crls: [expect.any(Uint8Array)] });
  });

  it("fetches an issuer the chain lacks from the certificate's caIssuers address, and keeps it", async () => {
    const key = await ca.issue("Timestamps", { timeStamping: true });
    const data = await fetchRevocationData([key.certificate], ca.fetch);
    expect(data.certificates).toEqual([ca.certificate]);
    expect(await longTermProblems([key.certificate], data)).toEqual([]);
  });

  it("refuses a revoked certificate, by OCSP and by CRL: nothing is sealed under it", async () => {
    const key = await ca.issue("Revoked", { ocsp: true });
    ca.revoke(key.certificate);
    await expect(fetchRevocationData([key.certificate, ca.certificate], ca.fetch)).rejects.toThrow("Revoked is revoked");
    await expect(fetchRevocationData([key.certificate, ca.certificate], ocspDown)).rejects.toThrow("Revoked is revoked");
  });

  it("fails when no revocation data can be had, never sealing short of B-LT", async () => {
    const key = await ca.issue("Unreachable", { ocsp: true });
    const down = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    await expect(fetchRevocationData([key.certificate, ca.certificate], down)).rejects.toThrow(/no revocation data for Unreachable/);
  });

  it("keeps a delegated OCSP responder's certificate and, unless it is marked nocheck, its own revocation data", async () => {
    const delegating = await localCertificateAuthority("Delegating root", { responder: "delegated" });
    const key = await delegating.issue("Sealing", { ocsp: true });
    const chain = [key.certificate, delegating.certificate];
    const data = await fetchRevocationData(chain, delegating.fetch);
    // The responder's certificate names no OCSP responder, so its own status comes from the CRL.
    expect({ ocsp: data.ocspResponses.length, crls: data.crls.length, certificates: data.certificates.length }).toEqual({ ocsp: 1, crls: 1, certificates: 1 });
    expect(await longTermProblems(chain, { ...data, crls: [] })).toEqual(["no revocation data for Delegating root OCSP responder"]);

    const nocheck = await localCertificateAuthority("Nocheck root", { responder: "delegated-nocheck" });
    const other = await nocheck.issue("Sealing", { ocsp: true });
    expect(await fetchRevocationData([other.certificate, nocheck.certificate], nocheck.fetch)).toMatchObject({ crls: [], certificates: [expect.any(Uint8Array)] });
  });

  it("refuses an answer or a CRL that is no longer current", async () => {
    const stale = await localCertificateAuthority("Stale root", { now: () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });
    const key = await stale.issue("Sealing", { ocsp: true });
    await expect(fetchRevocationData([key.certificate, stale.certificate], stale.fetch)).rejects.toThrow(/no revocation data for Sealing/);
  });

  it("never fetches a local, link-local or non-http address a certificate names", async () => {
    const asked: string[] = [];
    const spy = (async (input: string | URL | Request) => {
      asked.push(String(input));
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const key = await ca.issue("Sealing", { ocsp: true });
    // A certificate whose issuer is missing and whose caIssuers address is the task's metadata endpoint.
    const metadata = Buffer.from(key.certificate).toString("latin1").match(/http:\/\/[0-9a-f]+\.local-ca\.invalid\/ca\.cer/)![0];
    const forged = Buffer.from(Buffer.from(key.certificate).toString("latin1").replace(metadata, "http://169.254.170.2/v4/ca".padEnd(metadata.length, "x")), "latin1");
    await expect(fetchRevocationData([new Uint8Array(forged)], spy)).rejects.toThrow(/a local address/);
    expect(asked).toEqual([]);
  });

  it("the local authority answers only its own addresses: local mode has no internet", async () => {
    await expect(ca.fetch("https://example.com/crl")).rejects.toThrow("local mode has no internet");
  });

  it("the KMS signer fetches its chain's from the addresses its certificates name", async () => {
    const key = await ca.issue("Rabaed", { ocsp: true });
    const signer = kmsSealSigner({ keyId: "alias/test", region: "me-south-1", certificates: [key.certificate, ca.certificate] }, {} as KMSClient, ca.fetch);
    expect((await signer.revocation()).ocspResponses).toHaveLength(1);
  });
});

describe("checking it long-term", () => {
  it("finds data for every certificate but the root, signed by its issuer", async () => {
    const key = await ca.issue("Sealing", { ocsp: true });
    const chain = [key.certificate, ca.certificate];
    const data = await fetchRevocationData(chain, ca.fetch);
    expect(await longTermProblems(chain, data)).toEqual([]);
    expect(await longTermProblems(chain, { certificates: [], crls: [], ocspResponses: [] })).toEqual(["no revocation data for Sealing"]);
  });

  it("ignores an OCSP answer or a CRL that is changed, or signed by another authority", async () => {
    const key = await ca.issue("Sealing", { ocsp: true });
    const chain = [key.certificate, ca.certificate];
    const { ocspResponses } = await fetchRevocationData(chain, ca.fetch);
    const changed = ocspResponses[0]!.slice();
    changed[changed.length - 10]! ^= 0x01;
    expect(await longTermProblems(chain, { certificates: [], crls: [], ocspResponses: [changed] })).toEqual(["no revocation data for Sealing", "revocation data nothing needs"]);

    // Another authority of the same name: its CRL names the issuer but is not signed by it.
    const other = await localCertificateAuthority("Test root");
    const crl = new Uint8Array(await (await other.fetch(await crlUrlOf(other))).arrayBuffer());
    expect(await longTermProblems(chain, { certificates: [], crls: [crl], ocspResponses: [] })).toEqual(["no revocation data for Sealing", "revocation data nothing needs"]);
  });

  it("names anything the store holds that nothing needs, so no byte of it can change unnoticed", async () => {
    const key = await ca.issue("Sealing", { ocsp: true });
    const stranger = await ca.issue("Stranger", { ocsp: true });
    const chain = [key.certificate, ca.certificate];
    const data = await fetchRevocationData(chain, ca.fetch);
    const extra = await fetchRevocationData([stranger.certificate, ca.certificate], ca.fetch);
    expect(await longTermProblems(chain, { ...data, certificates: [stranger.certificate] })).toEqual(["a certificate nothing needs: Stranger"]);
    expect(await longTermProblems(chain, { ...data, ocspResponses: [...data.ocspResponses, ...extra.ocspResponses] })).toEqual([
      "revocation data nothing needs",
    ]);
  });

  it("names a certificate whose issuer is missing", async () => {
    const key = await ca.issue("Orphan");
    expect(await longTermProblems([key.certificate], { certificates: [], crls: [], ocspResponses: [] })).toEqual(["no issuer for Orphan"]);
  });
});

/** An address `authority` answers: the CRL address named in a certificate it issues. */
async function crlUrlOf(authority: LocalCertificateAuthority): Promise<string> {
  const key = await authority.issue("probe");
  const text = Buffer.from(key.certificate).toString("latin1");
  return /http:\/\/[0-9a-f]+\.local-ca\.invalid\/crl/.exec(text)![0];
}
