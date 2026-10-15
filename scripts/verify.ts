import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { postgresDown, postgresOfEnv, tcpReachable } from "./test-services.ts";
import { finalLine, selectSteps, tail } from "./verify-steps.ts";

// `pnpm verify` (RP-459): every check an implementer runs before pushing, in one
// command. Stops at the first failing step and names it. Each step is judged by
// its exit code; a failing step prints the tail of its output, so a setup
// failure shows. Needs the lane's .env (`pnpm lane:env`), and stops before the
// first step when its Postgres doesn't answer.

const root = process.cwd();
const pnpm = join(import.meta.dirname, "pnpm.ts");
const tailLines = 40;

// The lane's Postgres first (RP-575): a stopped container otherwise showed only at
// test:seam1, after every step before it had run.
const envFile = join(root, ".env");
const postgres = existsSync(envFile) ? postgresOfEnv(readFileSync(envFile, "utf8")) : undefined;
if (!postgres) {
  console.error("No Postgres in this worktree's .env: run `pnpm lane:env <n>` first.");
  process.exit(1);
}
if (!(await tcpReachable(postgres.host, postgres.port))) {
  console.error(postgresDown(postgres));
  process.exit(1);
}

const diff = spawnSync("git", ["diff", "--name-only", "origin/main"], { cwd: root, encoding: "utf8" });
if (diff.status !== 0) {
  console.error("git diff against origin/main failed; run `git fetch origin main` first.");
  process.exit(diff.status ?? 1);
}
const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
const changed = [...diff.stdout.split("\n"), ...untracked.stdout.split("\n")].filter(Boolean);

const { steps, skipped } = selectSteps(changed);
for (const { name, reason } of skipped) console.log(`skip ${name}: ${reason}`);

for (const { name, script } of steps) {
  const started = Date.now();
  console.log(`run  ${name} ...`);
  const result = spawnSync(process.execPath, [pnpm, script], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status === 0 && !result.error) {
    console.log(`ok   ${name} (${seconds}s)`);
    continue;
  }
  console.error(`FAIL ${name} (${seconds}s, exit ${result.status ?? result.error?.message}). Tail of its output:`);
  console.error(tail(`${result.stdout ?? ""}${result.stderr ?? ""}`, tailLines));
  console.error(`\npnpm verify stopped at ${name}.`);
  process.exit(result.status ?? 1);
}
const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).stdout.trim();
console.log(`\n${finalLine({ sha, dirty: status !== "", steps: steps.map((s) => s.name) })}`);
