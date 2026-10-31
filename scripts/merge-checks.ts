/* eslint-disable rabaed/no-avoid-terms -- git's and the CI checks' names and a text delimiter, by their own names, as in verify-gate.ts */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Main's newest unit checks, run on the merge of a PR and origin/main (RP-1171). `pnpm queue` runs them
// before queueing: the queue's own run is on that merge, and PR #496 dropped from it on checks (#511's)
// that landed on main while it was queued. The checks are the merge's own files, so a check main gained
// after the PR branched runs; one the merge does not have is skipped, and the result says which. They are
// the checks that read the whole repository (the unit project runs them as `expect(repoXProblems(cwd))
// .toEqual([])`), so a PR's own test run, on its own tree, cannot see what main added.

interface ModuleCheck {
  name: string;
  kind: "module";
  file: string;
  /** The export that takes the repository folder and returns the problems found. */
  fn: string;
}
interface ScriptCheck {
  name: string;
  kind: "script";
  file: string;
}
export type MergeCheck = ModuleCheck | ScriptCheck;

export const MERGE_CHECKS: MergeCheck[] = [
  { name: "check-hidden-asserts", kind: "module", file: "scripts/check-hidden-asserts.ts", fn: "repoHiddenAssertProblems" },
  { name: "check-scenario-seams", kind: "module", file: "scripts/check-scenario-seams.ts", fn: "repoSeamProblems" },
  { name: "check:migrations", kind: "script", file: "scripts/check-migrations.ts" },
];

export interface MergeChecksSeam {
  /** A checkout of a commit whose tree is `tree` (parents origin/main and `head`); returns its folder. */
  checkout(tree: string, head: string): string;
  /** Removes that checkout. */
  remove(path: string): void;
  /** True when `file` exists in the checkout. */
  exists(path: string, file: string): boolean;
  /** Calls a check's exported function with the checkout as the repository: the problems it returned. A crash is a non-zero status and its output. */
  runModule(path: string, check: ModuleCheck): { status: number; output: string; problems: string[] };
  /** Runs `node <file>` in the checkout. */
  runScript(path: string, check: ScriptCheck): { status: number; output: string };
}

export type MergeChecksResult = { ok: true; skipped: string[] } | { ok: false; failures: { name: string; lines: string[] }[] };

/** The tree object name in `git merge-tree --write-tree`'s output of a clean merge (its first line); undefined if it is none. */
export function mergeTreeOid(output: string): string | undefined {
  const first = output.split("\n")[0]?.trim() ?? "";
  return /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(first) ? first : undefined;
}

const nonEmptyLines = (text: string) => text.split("\n").map((line) => line.trimEnd()).filter((line) => line !== "");

/** Runs MERGE_CHECKS on a checkout of the merge. A failing check does not stop the others, so one run names every problem. */
export function runMergeChecks(tree: string, head: string, seam: MergeChecksSeam): MergeChecksResult {
  const path = seam.checkout(tree, head);
  const failures: { name: string; lines: string[] }[] = [];
  const skipped: string[] = [];
  try {
    for (const check of MERGE_CHECKS) {
      if (!seam.exists(path, check.file)) {
        skipped.push(check.name);
        continue;
      }
      if (check.kind === "module") {
        const done = seam.runModule(path, check);
        if (done.status !== 0 && done.problems.length === 0) {
          const lines = nonEmptyLines(done.output);
          failures.push({ name: check.name, lines: [`did not run: ${lines.find((line) => /\bError\b/.test(line)) ?? lines.slice(-3).join(" ")}`] });
        }
        else if (done.problems.length > 0) failures.push({ name: check.name, lines: done.problems });
      } else {
        const done = seam.runScript(path, check);
        if (done.status !== 0) failures.push({ name: check.name, lines: nonEmptyLines(done.output).slice(-20) });
      }
    }
  } finally {
    seam.remove(path);
  }
  return failures.length > 0 ? { ok: false, failures } : { ok: true, skipped };
}

const MARKER = "@@PROBLEMS@@";

/** The real git and node calls: a detached worktree of the merge in the temp folder. */
export function realMergeChecksSeam(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): MergeChecksSeam {
  const git = (args: string[], at = cwd) => {
    const done = spawn("git", args, {
      cwd: at,
      encoding: "utf8",
      // commit-tree needs an identity; this one never leaves the temp checkout.
      env: { ...process.env, GIT_AUTHOR_NAME: "merge-checks", GIT_AUTHOR_EMAIL: "merge-checks@localhost", GIT_COMMITTER_NAME: "merge-checks", GIT_COMMITTER_EMAIL: "merge-checks@localhost" },
    });
    if (done.status !== 0) throw new Error(`git ${args.slice(0, 3).join(" ")} failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
    return (done.stdout ?? "").trim();
  };
  const folders = new Map<string, string>();
  return {
    checkout: (tree, head) => {
      const commit = git(["commit-tree", tree, "-p", "origin/main", "-p", head, "-m", "merge for pnpm queue checks"]);
      const dir = mkdtempSync(join(tmpdir(), "merge-checks-"));
      const path = join(dir, "w");
      try {
        git(["worktree", "add", "--detach", path, commit]);
      } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        throw error;
      }
      // The checks import workspace packages (typescript, say); a fresh checkout has no node_modules, so link this repo's.
      const modules = join(git(["rev-parse", "--show-toplevel"]), "node_modules");
      if (existsSync(modules)) symlinkSync(modules, join(path, "node_modules"), "junction");
      folders.set(path, dir);
      return path;
    },
    remove: (path) => {
      // Unlink first: removing the checkout must never follow the link into this repo's node_modules.
      try {
        unlinkSync(join(path, "node_modules"));
      } catch {
        // no link
      }
      spawn("git", ["worktree", "remove", "--force", path], { cwd, encoding: "utf8" });
      const dir = folders.get(path);
      if (dir) rmSync(dir, { recursive: true, force: true });
      spawn("git", ["worktree", "prune"], { cwd, encoding: "utf8" });
    },
    exists: (path, file) => existsSync(join(path, file)),
    runModule: (path, check) => {
      const code = `import { pathToFileURL } from "node:url"; const m = await import(pathToFileURL(${JSON.stringify(join(path, check.file))}).href); process.stdout.write(${JSON.stringify(MARKER)} + JSON.stringify(m[${JSON.stringify(check.fn)}](process.cwd())));`;
      const done = spawn(process.execPath, ["--input-type=module", "-e", code], { cwd: path, encoding: "utf8" });
      const output = `${done.stdout ?? ""}${done.stderr ?? ""}`;
      const at = (done.stdout ?? "").lastIndexOf(MARKER);
      if (done.status !== 0 || at < 0) return { status: done.status || 1, output, problems: [] };
      return { status: 0, output, problems: JSON.parse((done.stdout ?? "").slice(at + MARKER.length)) as string[] };
    },
    runScript: (path, check) => {
      const done = spawn(process.execPath, [join(path, check.file)], { cwd: path, encoding: "utf8" });
      return { status: done.status ?? 1, output: `${done.stdout ?? ""}${done.stderr ?? ""}` };
    },
  };
}
