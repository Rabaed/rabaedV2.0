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
// Unlike `pnpm -r`, it keeps going after a failure, to name every failing
// package, and runs packages in no dependency order: they export their source
// and no tsconfig references another, so none needs another built first. A
// passing package's output is dropped, with or without -s (tsc prints nothing
// on success).
//
// Usage (in package.json): node scripts/typecheck.ts

const pnpm = join(import.meta.dirname, "pnpm.ts");
// pnpm's own default workspace-concurrency, as `pnpm -r run` had.
const concurrency = 4;

export interface Workspace {
  name: string;
  /** The package's folder, relative to the workspace root, with forward slashes. */
  dir: string;
  scripts: Record<string, string>;
}

interface Outcome extends Workspace {
  /** The exit code, 1 for a package killed by a signal. */
  status: number;
  signal: NodeJS.Signals | null;
  output: string;
}

/** The workspace packages pnpm-workspace.yaml (under `root`) names, sorted by folder; its `!pattern` entries are left out, as pnpm does. */
export function workspacePackages(root: string): Workspace[] {
  const { packages = [] } = parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")) as { packages?: string[] };
  const included = packages.filter((pattern) => !pattern.startsWith("!"));
  const excluded = packages.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
  return globSync(
    included.map((pattern) => `${pattern}/package.json`),
    { cwd: root, exclude: excluded },
  )
    .map((file) => file.replaceAll("\\", "/"))
    .sort()
    .map((file) => {
      const manifest = JSON.parse(readFileSync(join(root, file), "utf8")) as { name?: string; scripts?: Record<string, string> };
      // Every package has one (pnpm --filter and imports go by it); a missing name is a mistake, not a case to name by folder.
      if (!manifest.name) throw new Error(`${file} has no name.`);
      return { name: manifest.name, dir: dirname(file), scripts: manifest.scripts ?? {} };
    });
}

/** Runs one package's typecheck with pnpm's own lines silenced, its stdout and stderr together. */
function typecheck(root: string, workspace: Workspace): Promise<Outcome> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [pnpm, "-s", "run", "typecheck"], { cwd: join(root, workspace.dir) });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (error) => done({ ...workspace, status: 1, signal: null, output: `${output}${error.message}\n` }));
    child.on("close", (status, signal) => done({ ...workspace, status: status ?? 1, signal, output }));
  });
}

async function main() {
  const root = process.cwd();
  const pending = workspacePackages(root).filter(({ scripts }) => scripts.typecheck);
  const outcomes: Outcome[] = [];
  async function worker() {
    for (let next = pending.shift(); next; next = pending.shift()) {
      const outcome = await typecheck(root, next);
      outcomes.push(outcome);
      if (outcome.status !== 0) {
        process.stderr.write(`\n${outcome.name} (${outcome.dir}) typecheck failed (${outcome.signal ? `killed by ${outcome.signal}` : `exit ${outcome.status}`}):\n${outcome.output.trimEnd()}\n`);
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
}

if (import.meta.main) await main();
