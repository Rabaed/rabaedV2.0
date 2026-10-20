import { spawn } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";

// `pnpm typecheck` (RP-997): runs every workspace package's own typecheck, a few
// at a time, and prints a failing package's compiler output (file, line, message)
// on stderr, then one last line naming the failing packages. A clean run prints
// nothing under `pnpm -s typecheck`.
//
// It was `pnpm -r run typecheck`, which printed nothing at all under `pnpm -s`:
// the outer pnpm hands `npm_config_reporter=silent` to the script, the inner
// pnpm reads it as its own reporter, and a recursive run over several packages
// sends each package's output through that reporter, which drops it, tsc's
// errors and pnpm's own failure line alike. Only the exit code was left (RP-658).
// Here each package's output is captured and printed by this script itself.
//
// Usage (in package.json): node scripts/typecheck.ts

const root = process.cwd();
const pnpm = join(import.meta.dirname, "pnpm.ts");
// pnpm's own default workspace-concurrency, as `pnpm -r run` had.
const concurrency = 4;

interface Workspace {
  name: string;
  dir: string;
}

interface Outcome extends Workspace {
  status: number;
  output: string;
}

/** The workspace packages (pnpm-workspace.yaml) that have a typecheck script. */
function workspacePackages(): Workspace[] {
  const { packages = [] } = parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")) as { packages?: string[] };
  return packages
    .flatMap((pattern) => globSync(`${pattern}/package.json`, { cwd: root }))
    .map((file) => file.replaceAll("\\", "/"))
    .sort()
    .flatMap((file) => {
      const manifest = JSON.parse(readFileSync(join(root, file), "utf8")) as { name?: string; scripts?: Record<string, string> };
      return manifest.scripts?.typecheck ? [{ name: manifest.name ?? dirname(file), dir: dirname(file) }] : [];
    });
}

/** Runs one package's typecheck with pnpm's own lines silenced, its stdout and stderr together. */
function typecheck(workspace: Workspace): Promise<Outcome> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [pnpm, "-s", "run", "typecheck"], { cwd: join(root, workspace.dir) });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (error) => done({ ...workspace, status: 1, output: `${output}${error.message}\n` }));
    child.on("close", (status) => done({ ...workspace, status: status ?? 1, output }));
  });
}

const pending = workspacePackages();
const outcomes: Outcome[] = [];
async function worker() {
  for (let next = pending.shift(); next; next = pending.shift()) {
    const outcome = await typecheck(next);
    outcomes.push(outcome);
    if (outcome.status !== 0) {
      process.stderr.write(`\n${outcome.name} (${outcome.dir}) typecheck failed (exit ${outcome.status}):\n${outcome.output.trimEnd()}\n`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const failed = outcomes.filter(({ status }) => status !== 0).sort((a, b) => a.dir.localeCompare(b.dir));
if (failed.length > 0) {
  process.stderr.write(`\ntypecheck failed in: ${failed.map(({ name }) => name).join(", ")}\n`);
  process.exit(failed[0]!.status);
}
// `pnpm -s` hands the script npm_config_reporter=silent: say nothing then.
if (process.env.npm_config_reporter !== "silent") console.log(`typecheck passed in ${outcomes.length} packages.`);
