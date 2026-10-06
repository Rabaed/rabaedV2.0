import {
  dailyDigestJob,
  notificationDigestHandler,
  notificationEmailHandler,
  stepAgeReportHandler,
  weeklyStepAgeReportJob,
  type OutboxHandler,
  type ScheduledJob,
} from "@rabaed/db";
import { notificationDigestMessage, notificationMessage, stepAgeReportMessage, type Mailer } from "@rabaed/mailer";

// What the worker does besides delivering in-app notifications: its scheduled
// jobs, and the outbox handlers that send what they and delivery queue.
//
// To add a scheduled job: give it a schedule in @rabaed/domain (schedule.ts), a
// ScheduledJob (@rabaed/db scheduled-jobs.ts) whose `run` writes outbox rows of
// its own kind, list it in `scheduledJobs`, and add that kind's handler to
// `outboxHandlers` (and to the outbox kind check).

/** Every scheduled job, run by the worker at each poll when due (once per run time). */
export const scheduledJobs: readonly ScheduledJob[] = [dailyDigestJob, weeklyStepAgeReportJob];

/** The outbox handlers that send email, through `mailer()` (built at the first send), linking to `webUrl`. */
export function outboxHandlers(mailer: () => Mailer, webUrl: string): Record<string, OutboxHandler> {
  return {
    email: notificationEmailHandler((email) => mailer().send(notificationMessage(email, webUrl))),
    digest: notificationDigestHandler((digest) => mailer().send(notificationDigestMessage(digest, webUrl))),
    step_age_report: stepAgeReportHandler((report) => mailer().send(stepAgeReportMessage(report, webUrl))),
  };
}
