import { randomBytes } from "node:crypto";
import { documentalRecordFacts, saveDocumentalRecord, type OutboxHandler } from "@rabaed/db";
import type { RecordFiles } from "./files.ts";
import { recordKeys } from "./files.ts";
import type { RecordFonts } from "./fonts.ts";
import { appendixOf, renderWithAppendix } from "./appendix.ts";
import { documentAssets } from "./assets.ts";
import { toPdfA3 } from "./pdfa.ts";
import { sha256 } from "./pki.ts";
import { recordDataOf, recordDataXml } from "./record-data.ts";
import type { PdfRenderer } from "./render.ts";
import { sealPdf } from "./seal.ts";
import type { SealSigner } from "./signer.ts";
import type { TimestampAuthority } from "./timestamp.ts";

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
// The appendix (RP-147, appendix.ts) is appended after the layout's pages and
// before the PDF/A-3: the shared PDFs' and images' pages, the other files
// attached as their source files, the rest listed, held in Rabaed.
//
// Not yet (later tickets of spec RP-632): the checks before publishing and the
// "record ready" event (RP-155).

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
    const appendix = await appendixOf(facts, deps.files, deps.appendixLimitBytes);
    const { data, pdf: rendered } = await renderWithAppendix(
      deps.renderer,
      recordDataOf(facts, { code: verificationCode(), link: `${deps.webUrl.replace(/\/$/, "")}/verify/${token}` }, assets.pageCounts, (key) => assets.images.has(key)),
      await deps.fonts(),
      assets.images,
      appendix,
    );
    const xml = new TextEncoder().encode(recordDataXml(data));
    const sealedAt = now();
    const title = [data.type.code, data.documentNumber ?? data.subject].join(" ");
    const archival = await toPdfA3(rendered, { title, at: sealedAt }, [
      { name: "record-data.xml", mimeType: "application/xml", description: "Record Data", bytes: xml },
      ...appendix.attachments,
    ]);
    const pdf = await sealPdf(archival, { signer: await deps.signer(), timestamps: await deps.timestamps(), at: sealedAt });

    const keys = recordKeys(facts.projectId, facts.workItemId);
    await deps.files.put(keys.recordData, xml, "application/xml");
    await deps.files.put(keys.pdf, pdf, "application/pdf");
    await saveDocumentalRecord(trx, row.id, {
      pdf: { storageKey: keys.pdf, sha256: await sha256(pdf), size: pdf.length },
      recordData: { storageKey: keys.recordData, sha256: await sha256(xml), size: xml.length },
      layoutVersion: data.layoutVersion,
      language: data.language,
      sealedAt,
      verificationTokenHash: await sha256(new TextEncoder().encode(token)),
      verificationCode: data.verification.code,
    });
  };
}
