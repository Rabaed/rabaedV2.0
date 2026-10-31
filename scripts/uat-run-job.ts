import { resolve } from "node:path";
import { outboxHandlers } from "../apps/worker/src/jobs.ts";
import { JOBS, runJob, type JobName, type JobRow } from "../packages/db/dev-tools/index.ts";
import { createDb } from "../packages/db/src/client.ts";
import { mailerFromEnv, renderEmail, type Mailer } from "../packages/mailer/src/index.ts";
import { targetOf } from "./uat-age.ts";
import { guardedOrExit, loadToolEnv, type Target } from "./uat-guard.ts";

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
    console.log(`${args.dryRun ? "Would add" : "Added"} ${run.queued.length} outbox row(s)${run.queued.length ? `: ${run.queued.map(who).join(", ")}` : ""}`);
    if (args.memberEmail !== undefined) console.log(`${run.leftOut} row(s) for other Members were not queued`);
    for (const row of run.takenByWorker) console.log(`${who(row)}: already processed by worker`);
    for (const { row, error } of run.failed) console.log(`${who(row)}: not sent (${error}); left queued for the worker's retries`);
    const sent = built?.sent ?? [];
    if (!args.dryRun) console.log(`Sent ${sent.length} email(s)${sent.length ? `: ${sent.map((s) => `${s.to} "${s.subject}"`).join(", ")}` : ""}`);
    return run.failed.length > 0 ? 1 : 0;
  } finally {
    await Promise.all([migrator.destroy(), worker.destroy()]);
  }
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      // A database error by its code only: its text can quote row values.
      const code = typeof error === "object" && error !== null && "code" in error ? ` (database error ${String(error.code)})` : "";
      console.error(`uat:run-job: ${code ? "the database refused" : (error as Error).message}${code}`);
      process.exit(1);
    },
  );
}
