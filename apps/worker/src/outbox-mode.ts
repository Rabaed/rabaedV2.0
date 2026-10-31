import { z } from "zod";
import { RECORDS_CONTAINER_KINDS } from "./jobs.ts";

// What this worker takes from the outbox (RP-1042, ADR 0026). WORKER_OUTBOX:
// - `all` (the default: AWS and development): every kind, and the scheduled jobs.
// - `records` (the UAT Records container): only the Record job kinds, which need Chromium or
//   the signer; Vercel Cron delivers the rest and runs the scheduled jobs (RP-1039), so this
//   worker spends none of their attempts.

export interface WorkerRun {
  /** The outbox kinds it takes; every kind when undefined. */
  readonly kinds: readonly string[] | undefined;
  /** Whether it runs the scheduled jobs that are due. */
  readonly scheduledJobs: boolean;
}

const env = z.object({ WORKER_OUTBOX: z.enum(["all", "records"]).default("all") });

export function workerRunFromEnv(source: NodeJS.ProcessEnv = process.env): WorkerRun {
  const { WORKER_OUTBOX } = env.parse(source);
  return WORKER_OUTBOX === "records" ? { kinds: RECORDS_CONTAINER_KINDS, scheduledJobs: false } : { kinds: undefined, scheduledJobs: true };
}
