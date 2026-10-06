import { stepAgeWeeks, weeklyStepAgeReportSchedule, type BilingualText, type Locale, type StepAgeReport } from "@rabaed/domain";
import { sql } from "kysely";
import type { OutboxHandler } from "./outbox.ts";
import type { ScheduledJob } from "./scheduled-jobs.ts";

// The weekly Step Age report (RP-359; migration 20261215000000): a scheduled job
// on Sunday at 07:00 Riyadh time queues one outbox row per recipient, and the
// outbox handler sends each, as its recipient may see the items at send time.

/** The weekly Step Age report: one outbox row per Member holding Assign on an active Project. */
export const weeklyStepAgeReportJob: ScheduledJob = {
  name: "weekly_step_age_report",
  schedule: weeklyStepAgeReportSchedule,
  run: async (trx) => {
    await sql`select app.enqueue_step_age_reports()`.execute(trx);
  },
};

/** Sends one report: the worker's mailer. Throws when it could not. */
export type SendStepAgeReport = (report: StepAgeReport) => Promise<void>;

type Row = {
  to_address: string;
  language: Locale;
  project_id: string;
  project_name: BilingualText;
  open_stage_keys: string[];
  work_item_id: string;
  document_number: string | null;
  subject: string;
  stage_name: BilingualText;
  held_by_own: boolean;
  step_name: BilingualText;
  holder_name: BilingualText | null;
  entered_at: Date;
};

/**
 * Sends one recipient's weekly report, its Step Ages counted to `now()`: nothing
 * when the Project is closed, they left it or no longer hold Assign, their
 * settings don't email it, or they see no open item (app.take_step_age_report).
 * A failed send throws, so the row is retried, then dead-lettered.
 */
export function stepAgeReportHandler(send: SendStepAgeReport, now: () => Date = () => new Date()): OutboxHandler {
  return async (trx, row) => {
    const { rows } = await sql<Row>`select * from app.take_step_age_report(${row.id}::uuid)`.execute(trx);
    const head = rows[0];
    if (!head) return;
    const at = now();
    await send({
      to: head.to_address,
      language: head.language,
      projectId: head.project_id,
      projectName: head.project_name,
      openStageKeys: head.open_stage_keys,
      items: rows.map((r) => ({
        workItemId: r.work_item_id,
        documentNumber: r.document_number,
        subject: r.subject,
        stage: r.stage_name,
        with: r.held_by_own ? { kind: "own", step: r.step_name } : r.holder_name ? { kind: "company", companyName: r.holder_name } : null,
        stepAgeWeeks: stepAgeWeeks(r.entered_at, at),
      })),
    });
  };
}
