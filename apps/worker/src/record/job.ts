import { randomBytes } from "node:crypto";
import { documentalRecordFacts, saveDocumentalRecord, saveDocumentalRecordFace, type OutboxHandler } from "@rabaed/db";
import { recordFace } from "./face.ts";
import { finishRecord } from "./checks.ts";
import type { RecordFiles } from "./files.ts";
import { recordKeys } from "./files.ts";
import type { RecordFonts } from "./fonts.ts";
import { appendixOf } from "./appendix.ts";
import { documentAssets } from "./assets.ts";
import { makeRecordPdf } from "./make-pdf.ts";
import { sha256 } from "./pki.ts";
import { recordOf } from "./record-data.ts";
import type { PdfRenderer } from "./render.ts";
import type { SealSigner } from "./signer.ts";
import type { TimestampAuthority } from "./timestamp.ts";
import type { PdfAValidator } from "./verapdf.ts";

// The record job (workflow-engine.md §7; ADR 0023): the outbox handler for kind
// 'documental_record', written when an item closes. It writes the Record Data,
// renders the one layout from it with Chromium, makes it a PDF/A-3 with the
// Record Data inside, seals it (PAdES B-LT), stores both files at the record's
// fixed location and saves the record. A failure anywhere throws, so the outbox
// retries the row, then dead-letters it; the closure is never touched. Until
// the save, nothing is issued: a retry makes the record afresh.
//
// The Project's record language and Hijri setting are read with the facts, when
// the record is made (RP-151), so a change applies to records made afterwards.
//
// The appendix (RP-147, appendix.ts) is drawn after the layout's own pages and
// before the PDF/A-3: the shared PDFs' and images' pages, the other files
// attached as their source files, the rest listed, held in Rabaed. make-pdf.ts
// makes the PDF, as Re-produce does.
//
// The record is saved 'preparing', checked (checks.ts) and then published, or kept as
// failed_checks with Rabaed Admin alerted (RP-155); publishing queues "record ready".

export interface RecordJobDeps {
  readonly files: RecordFiles;
  readonly renderer: PdfRenderer;
  /** The sealing signer and the timestamp authority, made at the first record (from-env.ts). */
  readonly signer: () => Promise<SealSigner>;
  readonly timestamps: () => Promise<TimestampAuthority>;
  /** The fonts, read once (fonts.ts). */
  readonly fonts: () => Promise<RecordFonts>;
  /** The customer web's address: the verification page's link starts there. */
  readonly webUrl: string;
  readonly now?: () => Date;
  /** What the appendix carries in all before it only lists a file (appendix.ts; 100 MB unless a test sets less). */
  readonly appendixLimitBytes?: number;
  /** The PDF/A-3 validator the checks use (veraPDF); the environment's (VERAPDF) when left out. */
  readonly validator?: PdfAValidator;
}

/** Crockford's base 32: no I, L, O or U, so a printed code reads back unambiguously. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A Verification Code, `XXXX-XXXX`. */
export function verificationCode(bytes: Uint8Array = randomBytes(8)): string {
  const chars = [...bytes.subarray(0, 8)].map((b) => CODE_ALPHABET[b % 32]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

export function documentalRecordHandler(deps: RecordJobDeps): OutboxHandler {
  const now = deps.now ?? (() => new Date());
  return async (trx, row) => {
    const facts = await documentalRecordFacts(trx, row.id);
    if (!facts) return;
    const token = randomBytes(32).toString("base64url");
    const assets = await documentAssets(facts, deps.files);
    const record = recordOf(
      facts,
      { code: verificationCode(), link: `${deps.webUrl.replace(/\/$/, "")}/verify/${token}` },
      assets.pageCounts,
      (key) => assets.images.has(key),
      assets.fingerprints,
    );
    const appendix = await appendixOf(facts, deps.files, deps.appendixLimitBytes);
    const sealedAt = now();
    const { pdf, data, xml, layoutPages } = await makeRecordPdf(deps, { data: record.data, marks: record.images, images: assets.images, appendix }, sealedAt);

    const keys = recordKeys(facts.projectId, facts.workItemId);
    await deps.files.put(keys.recordData, xml, "application/xml");
    await deps.files.put(keys.pdf, pdf, "application/pdf");
    const saved = await saveDocumentalRecord(trx, row.id, {
      pdf: { storageKey: keys.pdf, sha256: await sha256(pdf), size: pdf.length },
      recordData: { storageKey: keys.recordData, sha256: await sha256(xml), size: xml.length },
      layoutVersion: data.layoutVersion,
      language: data.language,
      sealedAt,
      verificationTokenHash: await sha256(new TextEncoder().encode(token)),
      verificationCode: data.verification.code,
    });
    if (saved) await saveDocumentalRecordFace(trx, row.id, recordFace(data, (await deps.signer()).test)); // the verification page's (RP-157)
    if (saved) await finishRecord(trx, row.id, { pdf, data, layoutPages }, deps.validator);
  };
}
