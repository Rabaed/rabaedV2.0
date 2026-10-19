import type { SnagReportContent, SnagReportLanguage } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import type { Database } from "./schema.ts";

// The Snag report's reads and writes (RP-677; migration 20270930000000_snag_report.sql). The api
// asks for a report and later for its state as the Member who asked (withMember); the worker's job
// reads what to print and saves the PDF as the app role with no Member set.

/** Asks for a report of `content` (read as the calling Member); its id, or null for a Project the Member is not on. */
export async function requestSnagReport(
  trx: Transaction<Database>,
  projectId: string,
  language: SnagReportLanguage,
  content: SnagReportContent,
): Promise<string | null> {
  const { rows } = await sql<{ id: string | null }>`
    select app.request_snag_report(${projectId}::uuid, ${language}, ${JSON.stringify(content)}::jsonb) as id
  `.execute(trx);
  return rows[0]?.id ?? null;
}

export interface SnagReportStateRow {
  readonly status: "preparing" | "ready" | "failed";
  readonly storageKey: string | null;
  readonly fileName: string | null;
}

/** Where a report is, for the Member who asked for it; null for anyone else and a made-up id. */
export async function snagReportState(trx: Transaction<Database>, reportId: string): Promise<SnagReportStateRow | null> {
  const { rows } = await sql<{ status: SnagReportStateRow["status"]; storage_key: string | null; file_name: string | null }>`
    select * from app.snag_report_state(${reportId}::uuid)
  `.execute(trx);
  const row = rows[0];
  return row ? { status: row.status, storageKey: row.storage_key, fileName: row.file_name } : null;
}

export interface SnagReportJob {
  readonly reportId: string;
  readonly projectId: string;
  readonly language: SnagReportLanguage;
  readonly content: SnagReportContent;
}

/** What the worker prints for a 'snag_report' outbox row; null when it is none, or made already. */
export async function snagReportJob(trx: Transaction<Database>, outboxId: string): Promise<SnagReportJob | null> {
  const { rows } = await sql<{ report_id: string; project_id: string; language: SnagReportLanguage; content: SnagReportContent }>`
    select * from app.snag_report_job(${outboxId}::uuid)
  `.execute(trx);
  const row = rows[0];
  return row ? { reportId: row.report_id, projectId: row.project_id, language: row.language, content: row.content } : null;
}

/** Saves the made PDF of a 'snag_report' outbox row; false when it is none, or made already. */
export async function saveSnagReport(
  trx: Transaction<Database>,
  outboxId: string,
  file: { storageKey: string; sha256: Uint8Array; size: number },
): Promise<boolean> {
  const { rows } = await sql<{ saved: boolean }>`
    select app.save_snag_report(${outboxId}::uuid, ${file.storageKey}, ${Buffer.from(file.sha256)}, ${file.size}) as saved
  `.execute(trx);
  return rows[0]?.saved ?? false;
}
