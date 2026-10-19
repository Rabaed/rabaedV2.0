import { randomBytes } from "node:crypto";
import { documentalRecordFacts, saveDocumentalRecord, type OutboxHandler } from "@rabaed/db";
import { finishRecord } from "./checks.ts";
import type { RecordFiles } from "./files.ts";
import { recordKeys } from "./files.ts";
import type { RecordFonts } from "./fonts.ts";
import { documentAssets } from "./assets.ts";
import { makeRecordPdf } from "./make-pdf.ts";
import { sha256 } from "./pki.ts";
import { recordDataOf, recordDataXml } from "./record-data.ts";
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
// The record is saved 'preparing', checked (checks.ts) and then published, or kept as
// failed_checks with Rabaed Admin alerted (RP-155); publishing queues "record ready".
//
// Not yet (later tickets of spec RP-632): the appendix (RP-147), Signatures, Stamps,
// Review Comments and the endings (RP-650).

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
    const data = recordDataOf(
      facts,
      { code: verificationCode(), link: `${deps.webUrl.replace(/\/$/, "")}/verify/${token}` },
      assets.pageCounts,
      assets.fingerprints,
    );
    const xml = new TextEncoder().encode(recordDataXml(data));
    const sealedAt = now();
    const { pdf, layoutPages } = await makeRecordPdf(deps, data, xml, assets.images, sealedAt);

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
    if (saved) await finishRecord(trx, row.id, { pdf, data, layoutPages }, deps.validator);
  };
}
