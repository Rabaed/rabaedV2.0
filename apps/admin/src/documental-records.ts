import { randomUUID } from "node:crypto";
import type { BilingualText } from "@rabaed/domain";
import type { Db } from "@rabaed/db";
import { sql } from "kysely";
import { asEngineer } from "./admin-action.ts";

// The Documental Record from Rabaed Admin (RP-155; ADR 0023; workflow-engine.md §7): the
// alerts a failed check raises, and Re-produce. Both are customer data, so each goes through
// asEngineer with the Engineer's reason (visibility.md V9). A Re-produce only queues the job
// the worker runs (it remakes the PDF from the stored Record Data); it never reads or changes
// the item or its Transitions.

export interface DocumentalRecordAlert {
  readonly workItemId: string;
  readonly projectId: string;
  readonly projectName: BilingualText;
  readonly documentNumber: string | null;
  /** `published` or `failed_checks`: the record's status; `job_failed`: a record job that ran out of attempts. */
  readonly status: "published" | "failed_checks" | "job_failed";
  /** What the checks found, or why the job failed. */
  readonly problems: string[];
  /** When the checks ran, or the job gave up (ISO 8601, UTC). */
  readonly raisedAt: string;
}

/** The records whose latest checks failed, and the record jobs that gave up, oldest first. */
export function listDocumentalRecordAlerts(adminDb: Db, engineerId: string, reason: string): Promise<DocumentalRecordAlert[]> {
  return asEngineer(adminDb, { engineerId, action: "read_documental_record_alerts", reason }, async (trx) => {
    const { rows } = await sql<{
      work_item_id: string;
      project_id: string;
      project_name: BilingualText;
      document_number: string | null;
      status: DocumentalRecordAlert["status"];
      problems: string[];
      raised_at: Date;
    }>`select * from app.documental_record_alerts()`.execute(trx);
    return {
      target: { kind: "documental_record", id: null },
      result: rows.map((r) => ({
        workItemId: r.work_item_id,
        projectId: r.project_id,
        projectName: r.project_name,
        documentNumber: r.document_number,
        status: r.status,
        problems: r.problems,
        raisedAt: r.raised_at.toISOString(),
      })),
    };
  });
}

// The Record Job Monitor (RP-670): the record jobs that are failing or dead, and the retry of a
// dead one. The error is Rabaed's alone; no customer read carries it (visibility.md RP-670-1).

export interface RecordJob {
  readonly outboxId: string;
  /** `record`: the job that makes a closed item's record; `reproduce`: a Re-produce. */
  readonly kind: "record" | "reproduce";
  readonly workItemId: string;
  readonly projectId: string;
  readonly projectName: BilingualText;
  readonly documentNumber: string | null;
  /** `failing`: an attempt failed and more are to come; `dead`: out of attempts, not retried. */
  readonly state: "failing" | "dead";
  /** Why the last attempt failed. */
  readonly error: string;
  /** Attempts so far, the one running included. */
  readonly attempts: number;
  /** When the last attempt failed, or the job gave up (ISO 8601, UTC); null for a job that failed before this was kept. */
  readonly lastRanAt: string | null;
  /** When a failing job is next tried (ISO 8601, UTC); null for a dead one. */
  readonly nextTryAt: string | null;
}

/** The failing and dead record jobs, oldest first. */
export function listRecordJobs(adminDb: Db, engineerId: string, reason: string): Promise<RecordJob[]> {
  return asEngineer(adminDb, { engineerId, action: "read_record_jobs", reason }, async (trx) => {
    const { rows } = await sql<{
      outbox_id: string;
      kind: "documental_record" | "documental_record_reproduce";
      work_item_id: string;
      project_id: string;
      project_name: BilingualText;
      document_number: string | null;
      state: RecordJob["state"];
      error: string | null;
      attempts: number;
      last_ran_at: Date | null;
      next_try_at: Date | null;
    }>`select * from app.record_jobs()`.execute(trx);
    return {
      target: { kind: "documental_record", id: null },
      result: rows.map((r) => ({
        outboxId: r.outbox_id,
        kind: r.kind === "documental_record" ? ("record" as const) : ("reproduce" as const),
        workItemId: r.work_item_id,
        projectId: r.project_id,
        projectName: r.project_name,
        documentNumber: r.document_number,
        state: r.state,
        error: r.error ?? "",
        attempts: r.attempts,
        lastRanAt: r.last_ran_at?.toISOString() ?? null,
        nextTryAt: r.next_try_at?.toISOString() ?? null,
      })),
    };
  });
}

export type RetryResult = "queued" | "already_queued" | "not_found";

/**
 * Retries the dead record job `outboxId`: a fresh job of the same kind and item (the dead one is
 * kept as it was). 'already_queued' while a job of that kind for the item waits or runs;
 * 'not_found' for a row that is not a dead record job, or was already retried. The admin_action
 * names the job's item (else the job) and keeps the reason.
 */
export function retryRecordJob(adminDb: Db, engineerId: string, outboxId: string, reason: string): Promise<RetryResult> {
  const actionId = randomUUID();
  return asEngineer(adminDb, { engineerId, action: "retry_record_job", reason, id: actionId }, async (trx) => {
    const { rows: found } = await sql<{ work_item_id: string }>`
      select coalesce(payload ->> 'closed_work_item_id', payload ->> 'work_item_id') as work_item_id
      from outbox where id = ${outboxId}::uuid and kind in ('documental_record', 'documental_record_reproduce')
    `.execute(trx);
    const { rows } = await sql<{ result: RetryResult }>`
      select app.retry_record_job(${outboxId}::uuid, ${actionId}::uuid) as result
    `.execute(trx);
    const result = rows[0]!.result;
    const target = found[0] ? { kind: "documental_record", id: found[0].work_item_id } : { kind: "outbox", id: outboxId };
    return { target, after: { result }, result };
  });
}

export interface DocumentalRecordHistory {
  /** The record's Re-produce requests, oldest first. */
  readonly requests: {
    readonly requestedAt: string;
    readonly engineerEmail: string;
    readonly reason: string;
    /** `replaced`, `waiting` (its job waits or runs), `job_failed` (its job gave up) or `checks_failed` (the new PDF failed its checks). */
    readonly outcome: "replaced" | "waiting" | "job_failed" | "checks_failed";
    /** Fingerprints (SHA-256, hex) of the PDF a Re-produce replaced and of the one that replaced it. */
    readonly replacedSha256: string | null;
    readonly newSha256: string | null;
  }[];
  /** What each run of the checks found, oldest first. */
  readonly checks: {
    readonly runKind: "closure" | "reproduce";
    readonly passed: boolean;
    readonly problems: string[];
    readonly ranAt: string;
  }[];
}

/** An item's record: its Re-produce requests and its runs of the checks. Empty for an item with no record. */
export function readDocumentalRecordHistory(adminDb: Db, engineerId: string, workItemId: string, reason: string): Promise<DocumentalRecordHistory> {
  return asEngineer(adminDb, { engineerId, action: "read_documental_record_history", reason }, async (trx) => {
    const requests = await sql<{
      requested_at: Date;
      engineer_email: string;
      reason: string;
      outcome: DocumentalRecordHistory["requests"][number]["outcome"];
      replaced_sha256: string | null;
      new_sha256: string | null;
    }>`select * from app.documental_record_history(${workItemId}::uuid)`.execute(trx);
    const checks = await sql<{ run_kind: "closure" | "reproduce"; passed: boolean; problems: string[]; ran_at: Date }>`
      select * from app.documental_record_check_runs(${workItemId}::uuid)
    `.execute(trx);
    return {
      target: { kind: "documental_record", id: workItemId },
      result: {
        requests: requests.rows.map((r) => ({
          requestedAt: r.requested_at.toISOString(),
          engineerEmail: r.engineer_email,
          reason: r.reason,
          outcome: r.outcome,
          replacedSha256: r.replaced_sha256,
          newSha256: r.new_sha256,
        })),
        checks: checks.rows.map((c) => ({ runKind: c.run_kind, passed: c.passed, problems: c.problems, ranAt: c.ran_at.toISOString() })),
      },
    };
  });
}

export type ReproduceResult = "queued" | "already_queued" | "not_found";

/**
 * Asks the worker for the Re-produce of item `workItemId`'s record (published, or one whose
 * checks failed). 'already_queued' while one is waiting; 'not_found' for an item with no
 * record to remake. The admin_action names the item and keeps the reason.
 */
export function reproduceDocumentalRecord(adminDb: Db, engineerId: string, workItemId: string, reason: string): Promise<ReproduceResult> {
  const actionId = randomUUID();
  return asEngineer(adminDb, { engineerId, action: "reproduce_documental_record", reason, id: actionId }, async (trx) => {
    const { rows } = await sql<{ result: ReproduceResult }>`
      select app.request_documental_record_reproduction(${workItemId}::uuid, ${actionId}::uuid) as result
    `.execute(trx);
    const result = rows[0]!.result;
    return { target: { kind: "documental_record", id: workItemId }, after: { result }, result };
  });
}
