import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { checkRecord, expectationOf, recordProblems, type RecordExpectation } from "./checks.ts";
import type { RecordData } from "./record-data.ts";
import { sealPdf } from "./seal.ts";
import { localSealSigner } from "./signer.ts";
import { localTimestampAuthority } from "./timestamp.ts";
import type { PdfAValidator } from "./verapdf.ts";

// The record invariants (RP-155) on small PDFs made here, with a stand-in for veraPDF (the
// real one runs at seam 1, on real records).

// A 1 x 1 PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));

const compliant: PdfAValidator = { validate: async () => ({ compliant: true, problems: [] }) };
const expectation = (rest: Partial<RecordExpectation> = {}): RecordExpectation => ({ signatures: 0, layoutPages: 1, appendixPages: 0, ...rest });

async function pdfOf(pages: number, images = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = images > 0 ? await doc.embedPng(PNG) : null;
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage();
    if (image && i === 0) for (let n = 0; n < images; n++) page.drawImage(await doc.embedPng(PNG), { x: 10 * n, y: 10, width: 5, height: 5 });
  }
  return doc.save({ useObjectStreams: false });
}

let seal: { signer: Awaited<ReturnType<typeof localSealSigner>>; timestamps: Awaited<ReturnType<typeof localTimestampAuthority>> };
beforeAll(async () => {
  seal = { signer: await localSealSigner(), timestamps: await localTimestampAuthority() };
});
const sealed = async (pdf: Uint8Array) => sealPdf(pdf, { ...seal, at: new Date() });

describe("recordProblems", () => {
  it("passes a PDF with the pages it should have, sealed and archival", async () => {
    expect(await recordProblems(await sealed(await pdfOf(1)), expectation(), compliant)).toEqual([]);
  });

  it("counts the layout's pages and the appendix's together", async () => {
    const pdf = await sealed(await pdfOf(3));
    expect(await recordProblems(pdf, expectation({ layoutPages: 1, appendixPages: 2 }), compliant)).toEqual([]);
    expect(await recordProblems(pdf, expectation({ layoutPages: 1, appendixPages: 1 }), compliant)).toEqual([
      "the PDF has 3 pages, not 2 (1 of the layout and 1 of the appendix)",
    ]);
    expect(await recordProblems(await sealed(await pdfOf(1)), expectation({ layoutPages: 2 }), compliant)).toHaveLength(1);
  });

  it("wants a Signature image for each Signature the Record Data names", async () => {
    expect(await recordProblems(await sealed(await pdfOf(1, 2)), expectation({ signatures: 2 }), compliant)).toEqual([]);
    expect(await recordProblems(await sealed(await pdfOf(1, 1)), expectation({ signatures: 2 }), compliant)).toEqual(["the PDF shows 1 Signature images, not 2"]);
    expect(await recordProblems(await sealed(await pdfOf(1)), expectation({ signatures: 1 }), compliant)).toHaveLength(1);
  });

  it("fails a PDF that is not sealed, or whose seal was broken", async () => {
    expect(await recordProblems(await pdfOf(1), expectation(), compliant)).toEqual(["the seal does not verify: no seal"]);
    const pdf = await sealed(await pdfOf(1));
    const broken = pdf.slice();
    broken[20] = broken[20]! ^ 1;
    const problems = await recordProblems(broken, expectation(), compliant);
    expect(problems.some((p) => p.startsWith("the seal does not verify"))).toBe(true);
  });

  it("fails a PDF that does not open", async () => {
    const problems = await recordProblems(new TextEncoder().encode("not a pdf"), expectation(), compliant);
    expect(problems).toContain("the PDF does not open");
  });

  it("passes on what the PDF/A validator found", async () => {
    const notArchival: PdfAValidator = { validate: async () => ({ compliant: false, problems: ["PDF/A-3 6.1: one", "PDF/A-3 6.2: two"] }) };
    expect(await recordProblems(await sealed(await pdfOf(1)), expectation(), notArchival)).toEqual(["PDF/A-3 6.1: one", "PDF/A-3 6.2: two"]);
  });

  it("is not judged by a validator that could not run: the job is retried", async () => {
    const down: PdfAValidator = { validate: () => Promise.reject(new Error("docker is not running")) };
    await expect(recordProblems(await sealed(await pdfOf(1)), expectation(), down)).rejects.toThrow("docker is not running");
  });
});

describe("checkRecord", () => {
  it("says passed exactly when nothing is wrong", async () => {
    expect(await checkRecord(await sealed(await pdfOf(1)), expectation(), compliant)).toEqual({ passed: true, problems: [] });
    expect((await checkRecord(await pdfOf(1), expectation(), compliant)).passed).toBe(false);
  });
});

describe("expectationOf", () => {
  const data = (transitions: object[], rest: object = {}) => ({ transitions, ...rest }) as unknown as RecordData;

  it("expects none of what the Record Data does not name yet", () => {
    expect(expectationOf(data([{}, {}]), 2)).toEqual({ signatures: 0, layoutPages: 2, appendixPages: 0 });
  });

  it("expects one Signature image for each distinct Signature on the path, and the appendix's pages", () => {
    const named = data([{ signatureId: "s1" }, { signatureId: "s2" }, { signatureId: "s1" }, { signatureId: null }], {
      documents: [{ appendedPages: 3 }, { appendedPages: 1 }, {}],
    });
    expect(expectationOf(named, 2)).toEqual({ signatures: 2, layoutPages: 2, appendixPages: 4 });
  });
});
