import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidLane, lanePorts } from "./lanes.ts";
import { stackProblems, targetOfLane } from "./stack-health.ts";

// RP-1183: lane 7's api and web as a restartable background service, not children of Main 7's Claude session.
// 2026-10-31 retro: `pnpm dev:apps` ran from that session, so a service quit or a session end took both down (3 restarts of
// about 10 min, one harness run lost); RP-1099 made the containers restart themselves, the services did not.
//
//   pnpm lane7:apps [start|stop|status] [--lane <n>]
//
// Run it in the worktree whose .env is lane 7's (Main 7's). `start` (the default) launches one detached supervisor
// that runs the api and the web as `pnpm dev:apps` does (tsx and next dev from this worktree's node_modules, with this
// worktree's .env in their environment) and starts either again when it exits, after 2 s, doubling to 30 s while it keeps crashing at once.
// The supervisor belongs to no terminal or Claude session, so ending one does not stop it. `stop` ends the supervisor
// and both services; `status` says whether the supervisor runs and asks stack-health for the api, web and db.
// Its pid, log (apps.log) and stop file live in the OS temp folder, under rabaed-lane<n>-services.
// It never touches Docker, the database or another lane. `--lane` is for trying it on a lane of your own (54), never on
// lane 7 without Main 7 present. `pnpm servers:stop` ends the services too, but the supervisor then starts them again:
// use `stop`. Not covered: a reboot ends the supervisor; run `pnpm lane7:apps` again.
// Why not the compose `apps` profile or pm2: the worktree's node_modules hold Windows binaries (esbuild, next's SWC) that a
// Linux container cannot run, so a profile needs its own install and image; pm2 is a downloaded daemon (`pnpm dlx` could
// not run its bin, and an unpinned download is a supply-chain step lane 7's harness should not take).

export type Service = {
  name: string;
  cwd: string;
  /** Arguments to node: its flags, the file, the file's arguments. */
  args: string[];
  /** Added to the environment the supervisor was started with (the lane's ports win over the shell's). */
  env: Record<string, string>;
};

/** The api and web of lane `lane`, as `pnpm dev:apps` runs them, from the worktree at `root`. */
export function servicesOf(lane: number, root: string): Service[] {
  const { api, web } = lanePorts(lane);
  const apiDir = join(root, "apps", "api");
  const webDir = join(root, "apps", "web");
  return [
    { name: `lane${lane}-api`, cwd: apiDir, args: [join(apiDir, "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"], env: { API_PORT: String(api) } },
    { name: `lane${lane}-web`, cwd: webDir, args: [join(webDir, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(web)], env: { PORT: String(web) } },
  ];
}

export type AppsArgs = { command: "start" | "stop" | "status" | "run"; lane: number };

// eslint-disable-next-line rabaed/no-avoid-terms -- the pnpm script's name (`lane7:apps`), not copy about an app
const USAGE = "Usage: pnpm lane7:apps [start|stop|status] [--lane <n>]";

export function parseAppsArgs(argv: string[]): AppsArgs {
  const args: AppsArgs = { command: "start", lane: 7 };
  let named = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--lane") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error("--lane needs a lane number, e.g. --lane 54.");
      const n = Number(value);
      if (!isValidLane(n)) throw new Error(`${value} is not a lane.`);
      args.lane = n;
    } else if (!named && (arg === "start" || arg === "stop" || arg === "status" || arg === "run")) {
      args.command = arg;
      named = true;
    } else throw new Error(USAGE);
  }
  return args;
}

/** The wait before a service that has crashed `failures` times in a row starts again: 2 s, doubling, at most 30 s. */
export function restartDelayMs(failures: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, failures - 1));
}

export type StateFiles = { dir: string; pid: string; log: string; stop: string };

/** Where lane `lane`'s supervisor keeps its pid, its log and the stop file `stop` writes. */
export function stateFiles(lane: number, tmp = tmpdir()): StateFiles {
  const dir = join(tmp, `rabaed-lane${lane}-apps`);
  return { dir, pid: join(dir, "supervisor.pid"), log: join(dir, "apps.log"), stop: join(dir, "stop") };
}

/** An service that stays up this long counts as started well: its crash count begins again. */
const STABLE_MS = 60_000;

/** Ends a process and what it started (next dev has workers): a signal does not on Windows. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // Already gone.
    }
  } else child.kill("SIGTERM");
}

export type SuperviseOptions = {
  /** Supervision ends once this file exists. */
  stopFile: string;
  delayMs?: (failures: number) => number;
  pollMs?: number;
  log?: (line: string) => void;
};

/** Runs every service and starts each again when it exits, until `stopFile` appears; then ends them all and resolves. */
export async function supervise(services: Service[], { stopFile, delayMs = restartDelayMs, pollMs = 1_000, log = () => {} }: SuperviseOptions): Promise<void> {
  const children = new Map<string, ChildProcess>();
  let stopping = false;
  const stamp = (line: string) => log(`${new Date().toISOString()} ${line}`);

  const keep = async (service: Service): Promise<void> => {
    let failures = 0;
    while (!stopping) {
      const startedAt = Date.now();
      const child = spawn(process.execPath, service.args, { cwd: service.cwd, env: { ...process.env, ...service.env }, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
      children.set(service.name, child);
      stamp(`${service.name} started (pid ${child.pid}).`);
      const code = await new Promise<number | string>((done) => {
        child.once("error", (error) => done(`error ${error.message}`));
        child.once("exit", (exitCode, signal) => done(exitCode ?? signal ?? "unknown"));
      });
      children.delete(service.name);
      if (stopping) break;
      failures = Date.now() - startedAt >= STABLE_MS ? 1 : failures + 1;
      const wait = delayMs(failures);
      stamp(`${service.name} exited with code ${code}; starting it again in ${wait / 1000} s.`);
      // In slices, so a stop requested while it waits ends it at once (`stop` gives up after 20 s; the wait can be 30).
      for (let waited = 0; waited < wait && !stopping; waited += 250) await new Promise((r) => setTimeout(r, Math.min(250, wait - waited)));
    }
  };

  const watcher = setInterval(() => {
    if (stopping || !existsSync(stopFile)) return;
    stopping = true;
    stamp("stop requested; ending the services.");
    for (const child of children.values()) killTree(child);
  }, pollMs);
  try {
    await Promise.all(services.map(keep));
  } finally {
    clearInterval(watcher);
  }
  stamp("stopped.");
}

/** Whether a process with this pid exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

function runningPid(files: StateFiles): number | undefined {
  if (!existsSync(files.pid)) return undefined;
  const pid = Number(readFileSync(files.pid, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start(lane: number): Promise<number> {
  const files = stateFiles(lane);
  const pid = runningPid(files);
  if (pid !== undefined) {
    console.log(`Lane ${lane}'s services are already supervised (pid ${pid}); left as they are. Log: ${files.log}`);
    return 0;
  }
  mkdirSync(files.dir, { recursive: true });
  rmSync(files.stop, { force: true });
  const log = openSync(files.log, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run", "--lane", String(lane)], { detached: true, stdio: ["ignore", log, log], windowsHide: true });
  child.unref();
  closeSync(log);
  writeFileSync(files.pid, String(child.pid));
  console.log(`Lane ${lane}'s api and web are supervised now (pid ${child.pid}), and keep running when this session ends. Log: ${files.log}`);
  console.log(`They take a minute to come up. Check: pnpm lane7:apps status${lane === 7 ? "" : ` --lane ${lane}`}`);
  return 0;
}

async function stop(lane: number): Promise<number> {
  const files = stateFiles(lane);
  const pid = runningPid(files);
  if (pid === undefined) {
    console.log(`Lane ${lane}'s services are not supervised.`);
    rmSync(files.pid, { force: true });
    return 0;
  }
  writeFileSync(files.stop, "");
  for (let waited = 0; waited < 20_000 && alive(pid); waited += 250) await sleep(250);
  if (alive(pid)) {
    console.error(`Supervisor ${pid} did not stop within 20 s; see ${files.log}.`);
    return 1;
  }
  rmSync(files.pid, { force: true });
  console.log(`Lane ${lane}'s services are stopped.`);
  return 0;
}

async function status(lane: number): Promise<number> {
  const files = stateFiles(lane);
  const pid = runningPid(files);
  console.log(pid === undefined ? `Lane ${lane}'s services are not supervised.` : `Lane ${lane}'s services are supervised (pid ${pid}). Log: ${files.log}`);
  const problems = await stackProblems(targetOfLane(lane));
  for (const p of problems) console.log(`  - ${p}`);
  if (problems.length === 0) console.log("  api, web and db answer.");
  return pid === undefined || problems.length > 0 ? 1 : 0;
}

async function run(lane: number): Promise<number> {
  const files = stateFiles(lane);
  const root = fileURLToPath(new URL("..", import.meta.url));
  writeFileSync(files.pid, String(process.pid));
  // The worktree's .env joins the environment the services inherit, without replacing what is set: not as node's --env-file, which next dev's own workers refuse.
  process.loadEnvFile(join(root, ".env"));
  await supervise(servicesOf(lane, root), { stopFile: files.stop, log: (line) => console.log(line) });
  return 0;
}

async function main(): Promise<number> {
  let args: AppsArgs;
  try {
    args = parseAppsArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  return { start, stop, status, run }[args.command](args.lane);
}

if (import.meta.main) process.exitCode = await main();
