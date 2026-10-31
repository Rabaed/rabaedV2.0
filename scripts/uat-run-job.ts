import { resolve } from "node:path";
import { outboxHandlers } from "../apps/worker/src/jobs.ts";
import { JOBS, runJob, type JobName, type JobRow, type JobRun } from "../packages/db/dev-tools/index.ts";
import { createDb } from "../packages/db/src/client.ts";
import { mailerFromEnv, renderEmail, type Mailer } from "../packages/mailer/src/index.ts";
import { targetOf } from "./uat-age.ts";
import { guardedOrExit, loadToolEnv, printsItemText, runCli, type Target } from "./uat-guard.ts";

// `uat:run-job` (RP-922): the daily digest or the weekly Step Age report now, so UAT need not wait for
// 07:00 Riyadh (digest Sunday to Thursday, report Sunday). Dev and UAT only (scripts/uat-guard.ts):
//
//   pnpm uat:run-job digest|weekly-report [--member <email>] [--lane <n>] [--dry-run]
//   node scripts/uat-run-job.ts ... --uat     UAT's database and SendGrid, from its GitHub job only
//
// It queues what the scheduled job would, without claiming its run (the real schedule still runs),
// and sends each row with the worker's own handlers on the worker's own connection (rabaed_app), so an
// email says exactly what the worker's would (packages/db/dev-tools/jobs.ts). On a lane the mail lands
// in the lane's Mailpit. With --member, nobody else's row is queued.

export interface RunJobArgs {
  job: JobName;
  target: Target;
  memberEmail: string | undefined;
  dryRun: boolean;
}

export const RUN_JOB_USAGE = "usage: pnpm uat:run-job digest|weekly-report [--member <email>] [--lane <n> | --uat] [--dry-run]";

/** The command line, the lane defaulting to the one `env` (the worktree's .env) names. */
export function parseRunJobArgs(argv: string[], env: NodeJS.ProcessEnv): RunJobArgs | { error: string } {
  const [job, ...rest] = argv;
  if (job === undefined || !(job in JOBS)) return { error: "give the job: digest or weekly-report" };
  let memberEmail: string | undefined;
  let lane: string | undefined;
  let uat = false;
  let dryRun = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--member") {
      memberEmail = rest[++i];
      if (memberEmail === undefined || memberEmail.trim() === "") return { error: "--member takes a Member's email" };
    } else if (arg === "--lane") lane = rest[++i];
    else if (arg === "--uat") uat = true;
    else if (arg === "--dry-run") dryRun = true;
    else return { error: arg.startsWith("--") ? `unknown option ${arg}` : `unexpected ${arg}` };
  }
  const target = targetOf({ lane, uat }, env);
  if ("error" in target) return target;
  return { job: job as JobName, target, memberEmail, dryRun };
}

export interface SentEmail {
  to: string;
  subject: string;
}

/** `inner`, recording each email it sent: its recipient and subject, as rendered. */
export function recordingMailer(inner: Mailer): { mailer: Mailer; sent: SentEmail[] } {
  const sent: SentEmail[] = [];
  return {
    sent,
    mailer: {
      async send(message) {
        await inner.send(message);
        sent.push({ to: message.to, subject: renderEmail(message.template, message.locale, message.values).subject });
      },
    },
  };
}

const who = (row: JobRow) => `${row.email}${row.projectId ? ` (Project ${row.projectId})` : ""}`;

/**
 * What a run printed: who got a row and each email sent, by recipient and subject, or (without item
 * text, inside the GitHub job) only how many.
 */
export function describeRun(run: JobRun, sent: SentEmail[], { dryRun, member, itemText }: { dryRun: boolean; member: boolean; itemText: boolean }): string[] {
  const list = <T>(rows: T[], show: (row: T) => string) => (itemText && rows.length > 0 ? `: ${rows.map(show).join(", ")}` : "");
  const lines = [`${dryRun ? "Would add" : "Added"} ${run.queued.length} outbox row(s)${list(run.queued, who)}`];
  if (member) lines.push(`${run.leftOut} row(s) for other Members were not queued`);
  if (run.takenByWorker.length > 0) lines.push(`${run.takenByWorker.length} row(s) already processed by worker${list(run.takenByWorker, who)}`);
  for (const { row, error } of run.failed) lines.push(`${itemText ? who(row) : "a row"}: not sent (${error}); left queued for the worker's retries`);
  if (!dryRun) lines.push(`Sent ${sent.length} email(s)${list(sent, (s) => `${s.to} "${s.subject}"`)}`);
  return lines;
}

async function main(argv: string[]): Promise<number> {
  const env = loadToolEnv();
  const args = parseRunJobArgs(argv, env);
  if ("error" in args) {
    console.error(`uat:run-job: ${args.error}\n${RUN_JOB_USAGE}`);
    return 2;
  }
  const guarded = guardedOrExit("uat:run-job", env, args.target);
  console.log(`uat:run-job ${args.job} on ${guarded.label}${args.dryRun ? " (dry run: nothing is queued or sent)" : ""}; the scheduled run is not claimed`);
  const migrator = createDb(guarded.migratorUrl, { max: 1 });
  const worker = createDb(guarded.appUrl, { max: 1 });
  // Built at the first send, as the worker builds it.
  let built: ReturnType<typeof recordingMailer> | undefined;
  const mail = () => (built ??= recordingMailer(mailerFromEnv(env)));
  try {
    const run = await runJob({ migrator, worker }, args.job, {
      handlers: outboxHandlers(() => mail().mailer, guarded.webUrl),
      memberEmail: args.memberEmail,
      dryRun: args.dryRun,
    });
    const lines = describeRun(run, built?.sent ?? [], { dryRun: args.dryRun, member: args.memberEmail !== undefined, itemText: printsItemText(env) });
    for (const line of lines) console.log(line);
    return run.failed.length > 0 ? 1 : 0;
  } finally {
    await Promise.all([migrator.destroy(), worker.destroy()]);
  }
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) runCli("uat:run-job", main);
