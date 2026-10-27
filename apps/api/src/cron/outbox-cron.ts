import { createHash, timingSafeEqual } from "node:crypto";
import {
  processOutbox as processOutboxInDb,
  runScheduledJobs as runScheduledJobsInDb,
  type Db,
  type OutboxHandler,
  type OutboxRun,
  type ScheduledJob,
  type ScheduledRun,
} from "@rabaed/db";
import { mailerFromEnv, type Mailer } from "@rabaed/mailer";
import { outboxHandlers, scheduledJobs } from "@rabaed/worker/jobs";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { notSignedIn } from "../http-error.ts";

// The outbox on Vercel (RP-1039, ADR 0026): with no always-on worker, Vercel Cron calls
// the api once a minute (apps/api/vercel.json `crons`), and each call runs one bounded
// pass: the scheduled jobs that are due (each claimed in the database, so a duplicate
// call runs nothing twice), then the due outbox rows of the kinds the api can deliver.
// The Documental Record kinds stay for the Records container (Chromium, the signer):
// this pass never takes them, so it spends none of their attempts. Two overlapping
// passes never take one row twice (app.take_outbox_row's skip-locked claim).
// Vercel sends `Authorization: Bearer <CRON_SECRET>` (Vercel docs, Managing Cron Jobs:
// Securing cron jobs); without the right one the route answers 401 and runs nothing,
// and without a secret it refuses every call. The secret is never logged.

/** The path Vercel Cron calls (GET). */
export const CRON_OUTBOX_PATH = "/internal/cron/outbox";

/** The kinds the cron pass takes: everything but the Documental Record jobs, which need the Records container. */
export const CRON_OUTBOX_KINDS = ["notification", "email", "digest", "step_age_report", "record_ready", "password_reset"] as const;

/** The kinds left for the Records container (RP-1042): Chromium and the signer. With CRON_OUTBOX_KINDS, every outbox kind (a test checks). */
export const RECORDS_CONTAINER_KINDS = ["documental_record", "documental_record_reproduce", "working_copy", "snag_report"] as const;

/** Rows one pass takes at most; the rest wait for the next minute. */
export const CRON_OUTBOX_LIMIT = 100;

/**
 * How long one pass may take rows for, scheduled jobs included: well inside the api
 * function's 60 s maxDuration (vercel.json), so the row being run when it ends (an
 * email send) still finishes and is recorded.
 */
export const CRON_PASS_BUDGET_MS = 40_000;

/** The shortest CRON_SECRET accepted; a shorter one counts as none (Vercel recommends 16 characters or more). */
const MIN_SECRET_LENGTH = 16;

export interface CronPassResult {
  scheduledJobs: { job: string; outcome: ScheduledRun["outcome"] }[];
  outbox: OutboxRun;
}

/** What the cron route needs: the secret Vercel sends (none refuses every call) and the pass it runs. */
export interface OutboxCron {
  secret: string | undefined;
  /** Runs one pass; `onJobFailed` hears of each scheduled job that failed. */
  pass: (onJobFailed?: (run: ScheduledRun) => void) => Promise<CronPassResult>;
}

export interface OutboxCronPassOptions {
  /** The handlers of the kinds this pass sends (email, digest, step_age_report); in-app delivery is processOutbox's own. */
  handlers: Record<string, OutboxHandler>;
  scheduledJobs: readonly ScheduledJob[];
  /** Tests replace the clock and the database calls. */
  nowMs?: () => number;
  runScheduledJobs?: typeof runScheduledJobsInDb;
  processOutbox?: typeof processOutboxInDb;
}

/** One cron pass: the due scheduled jobs, then one outbox run of CRON_OUTBOX_KINDS within what is left of the budget. `db` is the app role with no Member set. */
export function outboxCronPass(db: Db, options: OutboxCronPassOptions): OutboxCron["pass"] {
  const { handlers, nowMs = Date.now, runScheduledJobs = runScheduledJobsInDb, processOutbox = processOutboxInDb } = options;
  return async (onJobFailed) => {
    const startedAt = nowMs();
    // Not cut short: each job is one transaction that only queues outbox rows. A slow one
    // leaves the outbox less of the budget (none at worst); the next minute's pass sends them.
    const runs = await runScheduledJobs(db, options.scheduledJobs);
    for (const run of runs) if (run.outcome === "failed") onJobFailed?.(run);
    const outbox = await processOutbox(db, {
      handlers,
      kinds: CRON_OUTBOX_KINDS,
      limit: CRON_OUTBOX_LIMIT,
      timeBudgetMs: Math.max(0, CRON_PASS_BUDGET_MS - (nowMs() - startedAt)),
    });
    return { scheduledJobs: runs.map(({ job, outcome }) => ({ job, outcome })), outbox };
  };
}

/**
 * The cron pass as the Vercel entry builds it: CRON_SECRET, and the worker's email
 * handlers with the mailer from the environment (SENDGRID_API_KEY, MAIL_FROM), built at
 * the first send, linking to WEB_URL. Without WEB_URL the pass fails before taking a row.
 */
export function outboxCronFromEnv(db: Db, source: NodeJS.ProcessEnv = process.env): OutboxCron {
  const secret = source.CRON_SECRET && source.CRON_SECRET.length >= MIN_SECRET_LENGTH ? source.CRON_SECRET : undefined;
  let mailer: Mailer | undefined;
  let pass: OutboxCron["pass"] | undefined;
  return {
    secret,
    pass: async (onJobFailed) => {
      pass ??= outboxCronPass(db, {
        handlers: outboxHandlers(() => (mailer ??= mailerFromEnv(source)), z.url().parse(source.WEB_URL)),
        scheduledJobs,
      });
      return pass(onJobFailed);
    },
  };
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Whether `authorization` is exactly `Bearer <secret>`, compared in constant time; never with no secret. */
export function isCronCall(authorization: string | undefined, secret: string | undefined): boolean {
  if (!secret || authorization === undefined) return false;
  // Digests of both: equal lengths, so the comparison says nothing about the secret's length.
  return timingSafeEqual(sha256(authorization), sha256(`Bearer ${secret}`));
}

const cronResponse = z.object({
  scheduledJobs: z.array(z.object({ job: z.string(), outcome: z.enum(["ran", "already_ran", "failed"]) })),
  outbox: z.object({ processed: z.number(), failed: z.number(), dead: z.number() }),
});

/** GET CRON_OUTBOX_PATH, for Vercel Cron. Public to the session check (the caller has no session): its credential is the bearer secret. */
export const outboxCronRoutes =
  (cron: OutboxCron | undefined): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      CRON_OUTBOX_PATH,
      {
        config: { public: true },
        schema: { response: { 200: cronResponse } },
        // Before anything else of the request: a caller without the secret gets the same 401 as a stranger anywhere.
        onRequest: async (request) => {
          if (!cron || !isCronCall(request.headers.authorization, cron.secret)) throw notSignedIn();
        },
      },
      async (request) => {
        const result = await cron!.pass((run) => {
          // Through the err serializer: a database error by its code only.
          const err = run.error instanceof Error ? run.error : new Error(String(run.error));
          request.log.error({ job: run.job, err }, "scheduled job failed");
        });
        // Counts and job names only: never a row's payload.
        request.log.info(result, "cron outbox pass");
        return result;
      },
    );
  };
