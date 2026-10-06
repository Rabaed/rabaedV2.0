import { stepAgeReportDueAt, stepAgeWeeks, type BilingualText, type Locale, type StepAgeReport } from "@rabaed/domain";
import { sql } from "kysely";
import type { Db } from "./client.ts";
import { failureOf } from "./outbox.ts";

// The weekly Step Age report's job (RP-359; migration 20261215000000): plan the
// week's reports on Sunday at 07:00 Riyadh time, then send them one at a time,
// each in its own transaction, as its recipient may see the items at send time.
// A report is marked sent in the same transaction as the send, so a failed send
// rolls back and is retried later, then dead-lettered. `db` connects as the app
// role, with no Member set.

/** Plans the reports due at `dueAt` (a Sunday 07:00 Riyadh time); planning one twice does nothing. How many were planned. */
export async function planStepAgeReports(db: Db, dueAt: Date): Promise<number> {
  const { rows } = await sql<{ planned: number }>`select app.plan_step_age_reports(${dueAt}::timestamptz) as planned`.execute(db);
  return rows[0]!.planned;
}

/** Sends one report: the worker's mailer. Throws when it could not. */
export type SendStepAgeReport = (report: StepAgeReport) => Promise<void>;

export interface SendStepAgeReportsOptions {
  /** What Step Ages are counted to. */
  now: Date;
  /** Attempts before a report is dead-lettered. */
  maxAttempts?: number;
  /** How long to wait before retrying, after `attempts` failed attempts. */
  retryDelayMs?: (attempts: number) => number;
  /** Reports to take in this run at most. */
  limit?: number;
}

export interface StepAgeReportRun {
  sent: number;
  /** Taken, but with no items: not sent. */
  skipped: number;
  failed: number;
  dead: number;
}

/** 1 min, 2 min, 4 min… up to an hour. */
const backoff = (attempts: number) => Math.min(60_000 * 2 ** (attempts - 1), 3_600_000);

type ItemRow = {
  work_item_id: string;
  document_number: string | null;
  subject: string;
  stage_name: BilingualText;
  held_by_own: boolean;
  step_name: BilingualText;
  holder_name: BilingualText | null;
  entered_at: Date;
};

/** Sends the reports due, as their recipients may see them now. */
export async function sendStepAgeReports(db: Db, send: SendStepAgeReport, options: SendStepAgeReportsOptions): Promise<StepAgeReportRun> {
  const { now, maxAttempts = 5, retryDelayMs = backoff, limit = 100 } = options;
  const run: StepAgeReportRun = { sent: 0, skipped: 0, failed: 0, dead: 0 };
  for (let i = 0; i < limit; i++) {
    let taken: { id: string; attempts: number } | undefined;
    try {
      const result = await db.transaction().execute(async (trx) => {
        const { rows } = await sql<{
          report_id: string;
          attempts: number;
          to_address: string;
          language: Locale;
          project_id: string;
          project_name: BilingualText;
          open_stage_keys: string[];
        }>`select * from app.take_step_age_report()`.execute(trx);
        const head = rows[0];
        if (!head) return "none" as const;
        taken = { id: head.report_id, attempts: head.attempts };
        const { rows: items } = await sql<ItemRow>`select * from app.step_age_report_items(${head.report_id}::uuid)`.execute(trx);
        if (items.length > 0) {
          await send({
            to: head.to_address,
            language: head.language,
            projectId: head.project_id,
            projectName: head.project_name,
            openStageKeys: head.open_stage_keys,
            items: items.map((r) => ({
              workItemId: r.work_item_id,
              documentNumber: r.document_number,
              subject: r.subject,
              stage: r.stage_name,
              with: r.held_by_own
                ? { kind: "own", step: r.step_name }
                : r.holder_name
                  ? { kind: "company", companyName: r.holder_name }
                  : null,
              stepAgeWeeks: stepAgeWeeks(r.entered_at, now),
            })),
          });
        }
        await sql`select app.step_age_report_done(${head.report_id}::uuid, ${items.length}::integer)`.execute(trx);
        return items.length > 0 ? ("sent" as const) : ("skipped" as const);
      });
      if (result === "none") break;
      run[result]++;
    } catch (error) {
      if (!taken) throw error;
      const report = taken;
      const { rows } = await sql<{ outcome: "retry" | "dead" | "gone" }>`
        select app.step_age_report_failed(${report.id}::uuid, ${failureOf(error)}, ${maxAttempts}::integer, ${Math.round(retryDelayMs(report.attempts + 1))}::integer) as outcome
      `.execute(db);
      const outcome = rows[0]!.outcome;
      if (outcome === "retry") run.failed++;
      else if (outcome === "dead") run.dead++;
    }
  }
  return run;
}

/**
 * The worker's run of the job at `now`: on Sunday from 07:00 Riyadh time, plans
 * the week's reports (once), then sends whatever is due.
 */
export async function runStepAgeReports(db: Db, send: SendStepAgeReport, now = new Date()): Promise<StepAgeReportRun & { planned: number }> {
  const dueAt = stepAgeReportDueAt(now);
  const planned = dueAt ? await planStepAgeReports(db, dueAt) : 0;
  return { planned, ...(await sendStepAgeReports(db, send, { now })) };
}
