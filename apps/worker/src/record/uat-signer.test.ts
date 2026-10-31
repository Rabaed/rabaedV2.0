import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { commonNameOf, parseCertificate, pemToDer } from "./pki.ts";
import { sealPdf, verifySeal } from "./seal.ts";
import { kmsSealSigner, localSealSigner } from "./signer.ts";
import { localTimestampAuthority } from "./timestamp.ts";
import { newUatAuthority, UAT_AUTHORITY_NAME, UAT_SIGNER_NAME, uatSigner, type UatAuthority } from "./uat-signer.ts";

// The UAT signer (RP-1042, ADR 0026): on the UAT Records container the seal is made under a
// test authority whose key is a host secret, never in the repo. Each test makes its own
// authority in memory, as the owner's one-off command does (cli/uat-sealing-authority.ts).

let authority: UatAuthority;
beforeAll(async () => {
  authority = await newUatAuthority();
});

async function plainPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawRectangle({ x: 50, y: 700, width: 200, height: 80 });
  return doc.save();
}

describe("the UAT sealing authority", () => {
  it("is a PEM key and certificate, named as a UAT test authority", () => {
    expect(authority.key).toMatch(/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n$/);
    expect(commonNameOf(parseCertificate(pemToDer(authority.certificate)))).toBe(UAT_AUTHORITY_NAME);
    expect(UAT_AUTHORITY_NAME).toContain("UAT");
  });
});

describe("the UAT signer", () => {
  it("seals under its own certificate, issued by the UAT authority, and the seal verifies (PAdES B-LT)", async () => {
    const signer = await uatSigner(authority);
    expect(signer.test).toBe(true);
    expect(signer.certificates).toHaveLength(2);
    expect(Buffer.from(signer.certificates[1]!)).toEqual(Buffer.from(pemToDer(authority.certificate)));
    const sealed = await sealPdf(await plainPdf(), { signer, timestamps: await localTimestampAuthority(), at: new Date() });
    const check = await verifySeal(sealed);
    expect(check.problem).toBeNull();
    expect(check.valid).toBe(true);
    expect(check.signer).toBe(UAT_SIGNER_NAME);
    expect(check.longTerm).toBe(true);
  });

  it("names its certificate as a UAT test key, never Rabaed's real one", () => {
    expect(UAT_SIGNER_NAME).toContain("UAT");
    expect(UAT_SIGNER_NAME).not.toBe("Rabaed Documental Records");
  });

  it("refuses a certificate that is not a UAT authority's", async () => {
    const other = await newUatAuthority({ commonName: "Rabaed Documental Records" });
    await expect(uatSigner(other)).rejects.toThrow(/UAT/);
  });

  it("refuses a key that is not the certificate's", async () => {
    const other = await newUatAuthority();
    await expect(uatSigner({ key: other.key, certificate: authority.certificate })).rejects.toThrow(/does not match/);
  });

  it("refuses an authority whose certificate has expired", async () => {
    const expired = await newUatAuthority({ notAfter: new Date(Date.now() - 1000) });
    await expect(uatSigner(expired)).rejects.toThrow(/expired/);
  });

  it("refuses a value that is not PEM", async () => {
    await expect(uatSigner({ key: "not a key", certificate: authority.certificate })).rejects.toThrow(/PEM/);
  });
});

describe("which signers are test signers", () => {
  it("the local signer is one; the KMS signer is not", async () => {
    expect((await localSealSigner()).test).toBe(true);
    expect(kmsSealSigner({ keyId: "alias/x", region: "me-central-1", certificates: [] }).test).toBe(false);
  });
});
