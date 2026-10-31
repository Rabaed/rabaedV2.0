import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { asn1js, certificateDer, commonNameOf, OID, parseCertificate, pemToDer, pkijs, RSA_SHA256, subtle } from "./pki.ts";
import { sealPdf, verifySeal } from "./seal.ts";
import { kmsSealSigner, localSealSigner } from "./signer.ts";
import { localTimestampAuthority } from "./timestamp.ts";
import { KEY_LABEL, newUatAuthority, UAT_AUTHORITY_NAME, UAT_SIGNER_NAME, uatSigner, type UatAuthority } from "./uat-signer.ts";

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
    // KEY_LABEL, not a literal header: the secret scan would take one for a key.
    const lines = authority.key.trimEnd().split("\n");
    expect([lines[0], lines.at(-1)]).toEqual([`-----BEGIN ${KEY_LABEL}-----`, `-----END ${KEY_LABEL}-----`]);
    expect(lines.length).toBeGreaterThan(2);
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

  it("refuses an authority that is not self-signed (an intermediate under another root), even with UAT in its name", async () => {
    // The UAT authority's own certificate and key, made to name another issuer and signed again.
    const certificate = parseCertificate(pemToDer(authority.certificate));
    certificate.issuer = new pkijs.RelativeDistinguishedNames({
      typesAndValues: [new pkijs.AttributeTypeAndValue({ type: OID.commonName, value: new asn1js.Utf8String({ value: "Some other UAT root" }) })],
    });
    const der = Buffer.from(authority.key.replace(/-----[A-Z ]+-----|\s/g, ""), "base64");
    const key = await subtle.importKey("pkcs8", der, RSA_SHA256, false, ["sign"]);
    await certificate.sign(key, "SHA-256");
    const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(certificateDer(certificate)).toString("base64")}\n-----END CERTIFICATE-----\n`;
    await expect(uatSigner({ key: authority.key, certificate: pem })).rejects.toThrow(/self-signed/);
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
