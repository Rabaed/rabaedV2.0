import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDoc } from "./reviewed-required.ts";

// CI's first job (RP-984): whether a pull request or merge-group entry changes only docs, as
// `isDoc` counts one (the same rule as the `docs-only` label, RP-606). The heavy jobs in
// .github/workflows/ci.yml skip on a docs-only change through their own `if:`, so their required
// checks still report success; a workflow skipped by `paths-ignore` would report nothing.
//
// BASE is the PR's base commit, or in the merge queue the branch the group merges into
// (`merge_group.base_ref`, main's tip). Not `merge_group.base_sha`: that is the group's first
// parent, main plus the entries ahead (see check-migration-drift.ts's mergeGroupSides), and a
// green entry merges the entries ahead of it too, so a docs-only PR queued behind a code PR must
// run everything. Empty on push (main) and workflow_dispatch: they run everything.
//
// Writes `docs_only=true|false` to GITHUB_OUTPUT. Environment: BASE (a commit or a ref on origin).

/** Whether a change is docs-only: at least one file, and every one a doc. */
export const docsOnly = (files: readonly string[]) => files.length > 0 && files.every(isDoc);

export type Decision = { docsOnly: false } | { docsOnly: boolean; base: string; files: number };

/** The decision against `base` (none: run everything); `changedSince(base)` lists the paths HEAD changes from it. */
export function decideDocsOnly(base: string | undefined, changedSince: (base: string) => string[]): Decision {
  if (!base) return { docsOnly: false };
  const files = changedSince(base);
  return { docsOnly: docsOnly(files), base, files: files.length };
}

/** The paths that differ between `base` on origin and HEAD. Without rename detection a rename lists its old path too: code renamed to .md is a code change. */
export function changedSince(repo: string, base: string): string[] {
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
    return result.stdout;
  };
  // The checkout holds HEAD alone; a tree diff needs only the base commit beside it, not the history.
  git(["fetch", "--no-tags", "--depth=1", "origin", base]);
  return git(["diff", "--name-only", "--no-renames", "FETCH_HEAD", "HEAD"]).split("\n").filter(Boolean);
}

function main() {
  const decision = decideDocsOnly(process.env.BASE, (base) => changedSince(process.cwd(), base));
  const summary =
    "base" in decision
      ? `${decision.files} path(s) changed since ${decision.base}: ${decision.docsOnly ? "docs only, so the heavy jobs skip" : "not docs only, so every job runs"}.`
      : "No base commit (push or workflow_dispatch): every job runs.";
  console.log(summary);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${decision.docsOnly}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  try {
    main();
  } catch (error: unknown) {
    // A failed decision fails this job; the heavy jobs then run anyway (they skip only on 'true').
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
