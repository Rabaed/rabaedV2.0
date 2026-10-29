import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { isValidLane, lanePorts } from "./lanes.ts";

// Is a lane's stack up? The api answers GET /health with 200 (it pings the database too), and
// Postgres answers on its port. RP-1099: on 2026-10-29 a Docker Desktop update left lane 7, the
// live UAT stack, at Exited (255) for over 2 hours unnoticed, and the UAT harness wrote Fail
// results against it. Two users:
// - the UAT harness (planning/uat/round-0/harness/run.ts) writes no result while this finds a problem;
// - `node scripts/stack-health.ts --lane 7 --alert`, run every 5 minutes by Windows Task Scheduler,
//   shows the owner a message box while lane 7's api or db is down.
//
// node scripts/stack-health.ts [--lane <n>] [--alert]
// Without --lane it reads API_URL and POSTGRES_PORT from this folder's .env (lane 7's when unset).
// Exit code 0 when the stack is up, 1 when it is down, 2 for a bad argument.

export type StackTarget = { apiUrl: string; dbHost: string; dbPort: number };
export type CheckOptions = { timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 5_000;
const UAT_LANE = 7;

/** Lane n's api and Postgres on this machine. */
export function targetOfLane(n: number): StackTarget {
  const { api, postgres } = lanePorts(n);
  return { apiUrl: `http://127.0.0.1:${api}`, dbHost: "127.0.0.1", dbPort: postgres };
}

/** The stack a worktree's .env names (API_URL, POSTGRES_PORT); lane 7's for what it leaves out. */
export function targetOfEnv(env: Record<string, string | undefined>): StackTarget {
  const uat = targetOfLane(UAT_LANE);
  return {
    apiUrl: (env.API_URL ?? uat.apiUrl).replace(/\/+$/, ""),
    dbHost: uat.dbHost,
    dbPort: env.POSTGRES_PORT ? Number(env.POSTGRES_PORT) : uat.dbPort,
  };
}

const seconds = (ms: number) => `${ms / 1000} s`;

/** Why a request failed, short: the socket error's code ("connect ECONNREFUSED"), else its message. */
function reason(error: unknown): string {
  const cause = (error as { cause?: { code?: string; syscall?: string } }).cause;
  if (cause?.code) return [cause.syscall, cause.code].filter(Boolean).join(" ");
  const e = error as { code?: string; syscall?: string; message?: string };
  if (e.code) return [e.syscall, e.code].filter(Boolean).join(" ");
  return e.message ?? String(error);
}

async function apiProblem(apiUrl: string, timeoutMs: number): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const why = (error as Error).name === "TimeoutError" ? `no answer in ${seconds(timeoutMs)}` : reason(error);
    return `api at ${apiUrl} is not answering (${why})`;
  }
  const body = (await response.json().catch(() => ({}))) as { status?: string; database?: string };
  if (response.ok && body.status === "ok") return undefined;
  const detail = body.database && body.database !== "ok" ? `database ${body.database}` : `status ${body.status ?? "missing"}`;
  return `api at ${apiUrl} answers /health with ${response.status}: ${detail}`;
}

/** Postgres's SSLRequest: length 8, code 80877103. A server answers one byte, "S" or "N". */
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);

function dbProblem(host: string, port: number, timeoutMs: number): Promise<string | undefined> {
  return new Promise((done) => {
    const socket = connect({ host, port });
    const finish = (problem?: string) => {
      clearTimeout(timer);
      socket.destroy();
      done(problem);
    };
    const down = (why: string) => finish(`db at ${host}:${port} is not answering (${why})`);
    const timer = setTimeout(() => down(`no answer in ${seconds(timeoutMs)}`), timeoutMs);
    socket.once("connect", () => socket.write(SSL_REQUEST));
    socket.once("data", (data) => {
      const answer = String.fromCharCode(data[0] ?? 0);
      if (answer === "S" || answer === "N") finish();
      else down(`not Postgres: answered "${answer}"`);
    });
    socket.once("error", (error) => down(reason(error)));
    socket.once("close", () => down("closed the connection"));
  });
}

/** What is down in the stack: one line each for the api and the db, none when both are up. */
export async function stackProblems(target: StackTarget, { timeoutMs = DEFAULT_TIMEOUT_MS }: CheckOptions = {}): Promise<string[]> {
  const found = await Promise.all([apiProblem(target.apiUrl, timeoutMs), dbProblem(target.dbHost, target.dbPort, timeoutMs)]);
  return found.filter((p): p is string => p !== undefined);
}

/** What the UAT harness prints when it stops; `afterCase` is the case whose result it held back. */
export function stoppedMessage(problems: string[], afterCase?: string): string {
  const head = afterCase
    ? `UAT stopped after ${afterCase}: the stack is down, so nothing was written for ${afterCase}. What was written before it is kept.`
    : "UAT stopped: the stack is down, so no Pass or Fail was written.";
  return [
    head,
    ...problems.map((p) => `  - ${p}`),
    "Tell the owner, and do not start or restart Docker yourself; run again once the stack is back.",
  ].join("\n");
}

/**
 * The PowerShell call that shows a Windows message box, on top of every window, until it is clicked.
 * Not a toast: toasts are off on the owner's machine. The call waits for the click, so a scheduled
 * run every 5 minutes shows one box at a time. The text goes in the environment, so nothing in it runs.
 */
export function alertCommand(title: string, body: string): { file: string; args: string[]; env: Record<string, string> } {
  // Popup(text, seconds to wait (0 = until clicked), title, 4096 system modal + 48 warning icon).
  const script = "$ErrorActionPreference = 'Stop'; [void](New-Object -ComObject WScript.Shell).Popup($env:RABAED_ALERT_BODY, 0, $env:RABAED_ALERT_TITLE, 4144)";
  return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script], env: { RABAED_ALERT_TITLE: title, RABAED_ALERT_BODY: body } };
}

export type HealthArgs = { lane: number | undefined; alert: boolean };

export function parseHealthArgs(argv: string[]): HealthArgs {
  const args: HealthArgs = { lane: undefined, alert: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--alert") args.alert = true;
    else if (arg === "--lane") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error("--lane needs a lane number, e.g. --lane 7.");
      const n = Number(value);
      if (!isValidLane(n)) throw new Error(`${value} is not a lane.`);
      args.lane = n;
    } else throw new Error(`Unknown argument ${arg}. Usage: node scripts/stack-health.ts [--lane <n>] [--alert]`);
  }
  return args;
}

async function main(): Promise<void> {
  let args: HealthArgs;
  try {
    args = parseHealthArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
  if (args.lane === undefined) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // No .env: lane 7's ports.
    }
  }
  const target = args.lane === undefined ? targetOfEnv(process.env) : targetOfLane(args.lane);
  const name = args.lane === undefined ? "This worktree's stack" : `Lane ${args.lane}`;
  const problems = await stackProblems(target);
  const stamp = new Date().toISOString();
  if (problems.length === 0) {
    console.log(`${stamp} ${name} is up: api ${target.apiUrl}, db ${target.dbHost}:${target.dbPort}.`);
    return;
  }
  console.error(`${stamp} ${name} is down:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  if (args.alert) {
    if (process.platform !== "win32") console.error("--alert shows a Windows message box; this is not Windows, so none was shown.");
    else {
      const body = `${problems.join("\n")}\n\nChecked at ${stamp}. Bring Docker and the stack back up; this box comes back every 5 minutes while it stays down.`;
      const { file, args: psArgs, env } = alertCommand(`Rabaed: ${name.toLowerCase()} is down`, body);
      execFileSync(file, psArgs, { env: { ...process.env, ...env }, stdio: "inherit", windowsHide: true });
    }
  }
  process.exitCode = 1;
}

if (import.meta.main) await main();
