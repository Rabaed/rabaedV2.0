import { sql, type Transaction } from "kysely";
import type { Database } from "./schema.ts";

// The Documental Record's checks, its "record ready" notice and Re-produce, as the
// worker's record job and Rabaed Admin use them (RP-155; migration
// 20270805000000_record_checks.sql; workflow-engine.md §7). The checks themselves
// are the worker's (apps/worker/src/record/checks.ts).

/** What the checks of one made PDF found: none when it passed. */
export interface RecordCheckVerdict {
  readonly passed: boolean;
  /** What failed, in words for a Rabaed Engineer. Empty exactly when `passed`. */
  readonly problems: readonly string[];
}

/** Publishes the 'preparing' record of job `outboxId`, or fails it with what the checks found; false when no record waits for its checks. */
export async function finishDocumentalRecord(trx: Transaction<Database>, outboxId: string, verdict: RecordCheckVerdict): Promise<boolean> {
  const { rows } = await sql<{ finished: boolean }>`
    select app.finish_documental_record(${outboxId}::uuid, ${verdict.passed}, ${JSON.stringify(verdict.problems)}::jsonb) as finished
  `.execute(trx);
  return rows[0]?.finished ?? false;
}

/** Delivers the "record ready" notification of outbox row `outboxId` to the Members who see the item; how many got it. */
export async function deliverRecordReady(trx: Transaction<Database>, outboxId: string): Promise<number> {
  const { rows } = await sql<{ delivered: number }>`select app.deliver_record_ready(${outboxId}::uuid) as delivered`.execute(trx);
  return rows[0]?.delivered ?? 0;
}

/** Where a record's files are and what its PDF is now: what a Re-produce starts from. */
export interface ReproductionSource {
  readonly workItemId: string;
  readonly projectId: string;
  readonly status: "published" | "failed_checks";
  readonly pdfKey: string;
  readonly recordDataKey: string;
  /** The PDF's fingerprint now (hex). */
  readonly pdfSha256: string;
  /** When it was sealed (ISO 8601, UTC). */
  readonly sealedAt: string;
  /** The item's Documents as the record was made, in the order they were added: where a Form photo's image is. */
  readonly documents: readonly {
    readonly fileName: string;
    readonly contentType: string;
    readonly size: number;
    readonly storageKey: string;
    readonly takenAt: string | null;
    /** The file's fingerprint (hex SHA-256, `document.file_sha256`); null for a Document confirmed before RP-618. */
    readonly sha256: string | null;
  }[];
}

/** The record job `outboxId` re-produces, or null when there is nothing to do (it was done already, or the record is gone). */
export async function documentalRecordReproductionSource(trx: Transaction<Database>, outboxId: string): Promise<ReproductionSource | null> {
  const { rows } = await sql<{ source: ReproductionSource | null }>`select app.documental_record_reproduction_source(${outboxId}::uuid) as source`.execute(trx);
  return rows[0]?.source ?? null;
}

/**
 * What a Re-produce found. A PDF that was made (passed or failed its checks) comes with the
 * replaced PDF's storage key and fingerprint and the new one's; a Re-produce that could not
 * make a PDF (a Form photo missing) has only its failed verdict.
 */
export type Reproduction =
  | {
      /** Where the replaced PDF is kept, its fingerprint and size. */
      readonly replaced: { readonly storageKey: string; readonly sha256: Uint8Array; readonly size: number };
      /** The new PDF at the record's own storage key. */
      readonly newPdf: { readonly sha256: Uint8Array; readonly size: number; readonly sealedAt: Date };
      readonly verdict: RecordCheckVerdict;
    }
  | { readonly replaced?: undefined; readonly newPdf?: undefined; readonly verdict: RecordCheckVerdict & { readonly passed: false } };

/** `replaced`: the new PDF is the record's. `checks_failed`: it failed its checks and replaces nothing. */
export type ReproductionResult = "replaced" | "checks_failed" | "not_found";

/** Records the Re-produce of job `outboxId` (see app.reproduce_documental_record). */
export async function reproduceDocumentalRecord(trx: Transaction<Database>, outboxId: string, r: Reproduction): Promise<ReproductionResult> {
  const { rows } = await sql<{ result: ReproductionResult }>`
    select app.reproduce_documental_record(
      ${outboxId}::uuid, ${r.replaced?.storageKey ?? null}, ${r.replaced ? Buffer.from(r.replaced.sha256) : null}, ${r.replaced?.size ?? null},
      ${r.newPdf ? Buffer.from(r.newPdf.sha256) : null}, ${r.newPdf?.size ?? null}, ${r.newPdf?.sealedAt ?? null},
      ${r.verdict.passed}, ${JSON.stringify(r.verdict.problems)}::jsonb
    ) as result
  `.execute(trx);
  return rows[0]?.result ?? "not_found";
}
