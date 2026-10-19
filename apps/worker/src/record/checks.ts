import { finishDocumentalRecord, type OutboxHandler, type RecordCheckVerdict } from "@rabaed/db";
import { PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from "pdf-lib";
import type { RecordData } from "./record-data.ts";
import { verifySeal } from "./seal.ts";
import { veraPdfFromEnv, type PdfAValidator } from "./verapdf.ts";

// The checks before a Documental Record is published (RP-155; ADR 0023; workflow-engine.md
// §7 step 5): the PDF opens, validates as PDF/A-3 (veraPDF), shows every signer's Signature,
// has the pages it should, and its seal verifies. A record that fails any of them is never
// published: it is kept as 'failed_checks' and Rabaed Admin is alerted.
//
// The expectations are worked out from the Record Data, never from the current layout, so
// they are invariants of the record that every ticket's layout (page 1 and the Form, RP-151;
// Signatures, Stamps and cards, RP-650; the appendix, RP-147) must keep. `recordProblems` is
// the one function they all run, in their own tests too.

/** What a record's PDF must hold, from its Record Data. */
export interface RecordExpectation {
  /** The Signature images the pages must show: one for each distinct Signature on the path (none until the Record Data names them, RP-85, RP-650). */
  readonly signatures: number;
  /** The pages the layout rendered from the Record Data. */
  readonly layoutPages: number;
  /** The pages appended from the Documents the Record Data lists (none until RP-147). */
  readonly appendixPages: number;
}

/** A Transition of the path as the Record Data will name its Signature (RP-85, RP-650). */
export interface SignedTransition {
  readonly signatureId?: string | null;
}

/** The Documents the Record Data lists, with the pages each adds to the PDF (RP-147). */
export interface AppendedDocuments {
  readonly documents?: readonly { readonly appendedPages?: number }[];
}

/** The invariants of a record made from `data`, once the layout has rendered `layoutPages` pages. */
export function expectationOf(data: RecordData, layoutPages: number): RecordExpectation {
  const signatures = new Set((data.transitions as readonly SignedTransition[]).flatMap((t) => (t.signatureId ? [t.signatureId] : [])));
  const appended = (data as AppendedDocuments).documents ?? [];
  return { signatures: signatures.size, layoutPages, appendixPages: appended.reduce((sum, d) => sum + (d.appendedPages ?? 0), 0) };
}

/** Every image of the PDF's pages, once each (a soft mask is part of its image), forms included. */
function imageCount(doc: PDFDocument): number {
  const seen = new Set<PDFStream>();
  const isImage = (x: PDFStream) => x.dict.get(PDFName.of("Subtype"))?.toString() === "/Image";
  const visit = (resources: PDFDict | undefined) => {
    const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    for (const [, ref] of xobjects?.entries() ?? []) {
      const x = ref instanceof PDFRef ? doc.context.lookupMaybe(ref, PDFStream) : undefined;
      if (!x || seen.has(x)) continue;
      seen.add(x);
      if (!isImage(x)) visit(x.dict.lookupMaybe(PDFName.of("Resources"), PDFDict));
    }
  };
  for (const page of doc.getPages()) visit(page.node.Resources());
  return [...seen].filter(isImage).length;
}

/** The number of images on the pages of `pdf`, once each; throws when it does not open. */
export async function imageCountOf(pdf: Uint8Array): Promise<number> {
  return imageCount(await PDFDocument.load(pdf, { updateMetadata: false }));
}

/** The number of pages of `pdf`; throws when it does not open. */
export async function pageCountOf(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
}

/**
 * What is wrong with `pdf` as the record `expected` describes, in words for a Rabaed Engineer:
 * nothing when it passes. A validator that cannot run throws instead, so the job is retried
 * and no record is judged by a missing tool.
 */
export async function recordProblems(pdf: Uint8Array, expected: RecordExpectation, validator: PdfAValidator): Promise<string[]> {
  const problems: string[] = [];
  // Opening reads its pages too: a damaged file loads, then fails at its page tree.
  let opened: { pages: number; images: number } | undefined;
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    opened = { pages: doc.getPageCount(), images: imageCount(doc) };
  } catch {
    problems.push("the PDF does not open");
  }
  if (opened) {
    const wanted = expected.layoutPages + expected.appendixPages;
    if (opened.pages !== wanted) {
      problems.push(`the PDF has ${opened.pages} pages, not ${wanted} (${expected.layoutPages} of the layout and ${expected.appendixPages} of the appendix)`);
    }
    if (opened.images < expected.signatures) problems.push(`the PDF shows ${opened.images} Signature images, not ${expected.signatures}`);
  }
  const archival = await validator.validate(pdf);
  if (!archival.compliant) problems.push(...archival.problems);
  const seal = await verifySeal(pdf);
  if (!seal.valid) problems.push(`the seal does not verify: ${seal.problem ?? "unknown"}`);
  return problems;
}

/** The verdict on `pdf`: the checks run, and what they found. */
export async function checkRecord(pdf: Uint8Array, expected: RecordExpectation, validator: PdfAValidator): Promise<RecordCheckVerdict> {
  const problems = await recordProblems(pdf, expected, validator);
  return { passed: problems.length === 0, problems };
}

let fromEnv: PdfAValidator | undefined;
/** The validator the environment names (VERAPDF), made at the first record. */
export function environmentValidator(): PdfAValidator {
  return (fromEnv ??= veraPdfFromEnv());
}

export interface MadeRecord {
  readonly pdf: Uint8Array;
  readonly data: RecordData;
  /** The pages the layout rendered, before anything was appended. */
  readonly layoutPages: number;
}

/**
 * The record job's last step: checks the PDF it made and publishes the saved record, or keeps
 * it as 'failed_checks'. Called once the record is saved as 'preparing'.
 */
export async function finishRecord(
  trx: Parameters<OutboxHandler>[0],
  outboxId: string,
  made: MadeRecord,
  validator: PdfAValidator = environmentValidator(),
): Promise<RecordCheckVerdict> {
  const verdict = await checkRecord(made.pdf, expectationOf(made.data, made.layoutPages), validator);
  await finishDocumentalRecord(trx, outboxId, verdict);
  return verdict;
}
