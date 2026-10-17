import type { BilingualText } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import type { Database } from "./schema.ts";

// The Documental Record's reads and writes for the worker's record job
// (RP-620; migration 20270514000000_documental_record.sql; workflow-engine.md
// §7). The job itself, which makes and seals the PDF, is the worker's
// (apps/worker/src/record). Both run as the app role with no Member set.

/** One Transition taken on the item, in order: Returns and the work around them included. */
export interface TransitionFact {
  readonly fromStepId: string;
  readonly toStepId: string;
  readonly label: BilingualText;
  /** When it was taken (ISO 8601, UTC). */
  readonly at: string;
  readonly memberName: BilingualText;
  /** The Member's Positions on the Project, in their order. */
  readonly positions: readonly BilingualText[];
  readonly companyName: BilingualText;
  /** The item's content hash as the Transition left it (hex), when it has one. */
  readonly contentSha256: string | null;
}

/** What the record job is told about a closed item (app.documental_record_facts). */
export interface RecordFacts {
  readonly workItemId: string;
  readonly projectId: string;
  readonly projectName: BilingualText;
  readonly type: { readonly code: string; readonly name: BilingualText };
  readonly documentNumber: string | null;
  readonly revisionNo: number;
  readonly subject: string;
  readonly outcome: string;
  /** When it closed (ISO 8601, UTC). */
  readonly closedAt: string;
  readonly transitions: readonly TransitionFact[];
}

/** The closed item of record job `outboxId`, or null when there is nothing to make (it has its record already). */
export async function documentalRecordFacts(trx: Transaction<Database>, outboxId: string): Promise<RecordFacts | null> {
  const { rows } = await sql<{ facts: RecordFacts | null }>`select app.documental_record_facts(${outboxId}::uuid) as facts`.execute(trx);
  return rows[0]?.facts ?? null;
}

/** A stored file of the record: where, its SHA-256 and its size. */
export interface RecordFile {
  readonly storageKey: string;
  readonly sha256: Uint8Array;
  readonly size: number;
}

export interface SealedRecord {
  readonly pdf: RecordFile;
  readonly recordData: RecordFile;
  readonly layoutVersion: string;
  readonly language: "bilingual" | "ar" | "en";
  readonly sealedAt: Date;
  /** The SHA-256 of the verification page's long link. */
  readonly verificationTokenHash: Uint8Array;
  readonly verificationCode: string;
}

/** Saves the sealed record of job `outboxId`; false when the item has one already. */
export async function saveDocumentalRecord(trx: Transaction<Database>, outboxId: string, record: SealedRecord): Promise<boolean> {
  const { rows } = await sql<{ saved: boolean }>`
    select app.save_documental_record(
      ${outboxId}::uuid,
      ${record.pdf.storageKey}, ${Buffer.from(record.pdf.sha256)}, ${record.pdf.size},
      ${record.recordData.storageKey}, ${Buffer.from(record.recordData.sha256)}, ${record.recordData.size},
      ${record.layoutVersion}, ${record.language}, ${record.sealedAt},
      ${Buffer.from(record.verificationTokenHash)}, ${record.verificationCode}
    ) as saved
  `.execute(trx);
  return rows[0]?.saved ?? false;
}
