import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { attachedFiles, pdfA3Problems, toPdfA3 } from "./pdfa.ts";
import { sealPdf, sealTamperOffsets, verifySeal, withByteChanged } from "./seal.ts";
import { LOCAL_SEAL_NAME, localSealSigner, type SealSigner } from "./signer.ts";
import { localTimestampAuthority, type TimestampAuthority } from "./timestamp.ts";

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
      dssCertificates: 2,
    });
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
