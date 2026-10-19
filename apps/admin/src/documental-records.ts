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
