import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Turns on the repo's git hooks in .githooks (RP-989): pre-commit refuses
// conflict markers and fonts, pre-push runs lint and typecheck. Root
// package.json's `prepare` runs this on every `pnpm install`.
//
// core.hooksPath lives in the clone's shared config, so one install turns the
// hooks on for the main folder and every worktree. The path is relative: git
// runs each worktree's own .githooks, from its own branch.
//
// Skipped in CI (the screenshot bot's commits and pushes need no hooks) and
// outside a git repository (the Docker build has no .git).
//
// Usage: node scripts/hooks-install.ts

export const HOOKS_PATH = ".githooks";

/** Sets core.hooksPath unless CI, no repository, or a path someone set on purpose; says what it did. */
export function installHooks(cwd: string, env: NodeJS.ProcessEnv): string {
  if (env.CI) return "CI: git hooks not installed.";
  const git = (...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });
  if (git("rev-parse", "--git-dir").status !== 0) return "Not a git repository: git hooks not installed.";
  const current = git("config", "--get", "core.hooksPath").stdout.trim();
  if (current === HOOKS_PATH) return `Git hooks already on (core.hooksPath ${HOOKS_PATH}).`;
  if (current) return `core.hooksPath is ${current}, kept: the repo's hooks in ${HOOKS_PATH} are off. To turn them on: git config core.hooksPath ${HOOKS_PATH}`;
  git("config", "core.hooksPath", HOOKS_PATH);
  return `Git hooks on for this clone and its worktrees (core.hooksPath ${HOOKS_PATH}).`;
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  console.log(installHooks(process.cwd(), process.env));
}
