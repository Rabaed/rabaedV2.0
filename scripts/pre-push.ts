import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDoc } from "./reviewed-required.ts";
import { branchMix } from "./shared-files.ts";

// The pre-push hook (.githooks/pre-push, RP-989): a push to a branch runs
// `pnpm lint` and `pnpm typecheck` and is refused when either exits non-zero.
// RP-631's integration branch got a push out with typecheck failing, because a
// `;`-chained command carried on past the failure; an exit code can't be skipped.
//
// Kept fast so nobody routes around it: the two run side by side (about a
// minute), and a push that changes only docs (rule 3's docs: under docs/ or
// Markdown) runs neither. Deleting a branch or pushing a tag runs nothing.
// A branch that changes root shared files (the lockfile, say) beside code gets a
// warning, not a refusal (RP-993): `pnpm queue` refuses it later, by the same rule.
// The checks read the working tree, which is the pushed commit when you push
// the branch you have checked out with nothing uncommitted.
//
// Usage (from the hook): node scripts/pre-push.ts < git's ref lines

const ZERO = /^0+$/;

/** One line of git's pre-push stdin. */
export interface PushedRef {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

export type Check = "lint" | "typecheck";
const CHECKS: Check[] = ["lint", "typecheck"];

export interface PrePushSeam {
  /** The files a pushed ref changes against what the remote has; undefined when that can't be told. */
  changedFiles(ref: PushedRef): string[] | undefined;
  /** The lines naming a rule-3 mix on the pushed ref against origin/main (scripts/shared-files.ts); undefined when there is none or it can't be told. */
  sharedFilesMix(ref: PushedRef): string[] | undefined;
  /** Runs `pnpm <check>`, its stdout and stderr together. */
  run(check: Check): Promise<{ status: number; output: string }>;
  /** The checked-out commit, and whether tracked files have uncommitted changes. */
  workingTree(): { head: string; dirty: boolean };
}

function parsePushedRefs(stdin: string): PushedRef[] {
  return stdin
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef: localRef!, localSha: localSha!, remoteRef: remoteRef!, remoteSha: remoteSha! }));
}

/** Whether the push may go: lint and typecheck pass, or nothing pushed needs them. */
export async function prePush(stdin: string, seam: PrePushSeam): Promise<{ ok: boolean; message: string }> {
  const branches = parsePushedRefs(stdin).filter((ref) => ref.remoteRef.startsWith("refs/heads/") && !ZERO.test(ref.localSha));
  if (branches.length === 0) return { ok: true, message: "pre-push: no branch pushed, lint and typecheck skipped." };
  const mix = mixWarning(branches, seam);
  const changed = branches.map((ref) => seam.changedFiles(ref));
  if (changed.every((files) => files !== undefined && files.every(isDoc))) return { ok: true, message: `pre-push: only docs changed, lint and typecheck skipped.${mix}` };

  console.log("pre-push: running pnpm lint and pnpm typecheck…");
  const results = await Promise.all(CHECKS.map(async (check) => ({ check, ...(await seam.run(check)) })));
  const failed = results.filter((result) => result.status !== 0);
  const warning = treeWarning(branches, seam.workingTree());
  if (failed.length === 0) return { ok: true, message: `pre-push: pnpm lint and pnpm typecheck pass.${warning}${mix}` };
  const report = failed.map(({ check, status, output }) => `pnpm ${check} failed (exit ${status}):\n${output.trimEnd()}`).join("\n\n");
  return { ok: false, message: `${report}\n\nPush refused (pre-push, RP-989): fix ${failed.map((f) => `pnpm ${f.check}`).join(" and ")}, commit, and push again.${warning}${mix}` };
}

/** A warning for each pushed branch that `pnpm queue` will refuse under rule 3 (RP-993). */
function mixWarning(branches: PushedRef[], seam: PrePushSeam): string {
  return branches
    .map((ref) => {
      const lines = seam.sharedFilesMix(ref);
      const branch = ref.remoteRef.replace("refs/heads/", "");
      return lines ? `\nWarning: ${branch} changes root shared file(s) together with other files, so \`pnpm queue\` will refuse it (rule 3):\n${lines.join("\n")}` : "";
    })
    .join("");
}

/** A warning when the working tree the checks read is not what is pushed. */
function treeWarning(branches: PushedRef[], tree: { head: string; dirty: boolean }): string {
  const short = (sha: string) => sha.slice(0, 8);
  const warnings = branches
    .filter((ref) => ref.localSha !== tree.head)
    .map((ref) => `Warning: pre-push checked the working tree (HEAD ${short(tree.head)}), not ${short(ref.localSha)} pushed to ${ref.remoteRef.replace("refs/heads/", "")}.`);
  if (tree.dirty) warnings.push("Warning: pre-push checked the working tree, which has uncommitted changes; the pushed commit may differ.");
  return warnings.map((line) => `\n${line}`).join("");
}

/** The files a pushed ref changes: since the remote's commit, or since it left origin/main for a new branch. */
export function changedFiles(repo: string, ref: PushedRef): string[] | undefined {
  const git = (...args: string[]) => spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: repo, encoding: "utf8" });
  const remoteKnown = !ZERO.test(ref.remoteSha) && git("cat-file", "-e", `${ref.remoteSha}^{commit}`).status === 0;
  const base = remoteKnown ? ref.remoteSha : git("merge-base", "origin/main", ref.localSha).stdout.trim();
  if (!base) return undefined;
  const diff = git("diff", "--name-only", base, ref.localSha);
  return diff.status === 0 ? diff.stdout.split("\n").filter(Boolean) : undefined;
}

const shell = process.platform === "win32"; // pnpm.cmd and corepack.cmd

/**
 * How to start pnpm. A git hook isn't started by pnpm, so it has no npm_execpath
 * (scripts/pnpm.ts): pnpm comes from PATH, or else through corepack, which is
 * all some agent shells have (RP-298).
 */
function pnpmCommand(repo: string): string[] {
  return spawnSync("pnpm", ["--version"], { cwd: repo, shell, stdio: "ignore" }).status === 0 ? ["pnpm"] : ["corepack", "pnpm"];
}

/** Runs `pnpm <check>` in the repo, output captured so the two side by side don't interleave. */
function runPnpm(repo: string, pnpm: string[], check: Check): Promise<{ status: number; output: string }> {
  return new Promise((done) => {
    const [command, ...args] = [...pnpm, check];
    const child = spawn(command!, args, { cwd: repo, shell });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (error) => done({ status: 1, output: `Could not run pnpm: ${error.message}` }));
    child.on("close", (status) => done({ status: status ?? 1, output }));
  });
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const repo = process.cwd();
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout.trim();
  let pnpm: string[] | undefined;
  const result = await prePush(readFileSync(0, "utf8"), {
    changedFiles: (ref) => changedFiles(repo, ref),
    sharedFilesMix: (ref) => {
      try {
        return branchMix(repo, ref.localSha);
      } catch {
        return undefined; // no origin/main to compare with: `pnpm queue` still checks it
      }
    },
    run: (check) => runPnpm(repo, (pnpm ??= pnpmCommand(repo)), check),
    workingTree: () => ({ head: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain", "--untracked-files=no") !== "" }),
  });
  (result.ok ? console.log : console.error)(result.message);
  // exitCode, not exit(): a long lint report to a piped stderr must finish writing first (Windows).
  process.exitCode = result.ok ? 0 : 1;
}
