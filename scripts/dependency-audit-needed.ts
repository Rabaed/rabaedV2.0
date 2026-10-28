import { appendFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { changedSince } from "./docs-only.ts";

// Whether a pull request or merge-group entry needs the package audit (RP-1032). The audit is a
// required check on main, so .github/workflows/dependency-audit.yml runs on every pull request and
// merge-group entry: a workflow skipped by `paths` reports nothing, and its required check would stay
// pending (RP-984). This decides whether the job audits or passes at once. It audits a change that can
// move what `pnpm audit --prod` finds or how it is judged: the lockfile, any package.json, pnpm's
// workspace settings (overrides can live there), .npmrc (it can name another registry), the
// allow-list, the audit's scripts, the code this decision runs on (scripts/docs-only.ts's
// `changedSince`) and its workflow. Other changes skip it, an empty change included, so an advisory
// published against main blocks only the change that touches packages, and the nightly run on main
// reports it.
//
// BASE is the PR's base commit, or in the merge queue the branch the group merges into
// (`merge_group.base_ref`, main's tip), as for scripts/docs-only.ts. Empty on schedule and
// workflow_dispatch: they always audit.
//
// Writes `needed=true|false` to GITHUB_OUTPUT. Environment: BASE (a commit or a ref on origin).

/* eslint-disable rabaed/no-avoid-terms -- the audit's file names: npm's dependencies, not a Work Item relationship */
const AUDIT_INPUTS = [
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".audit-allowlist.json",
  "scripts/dependency-audit.ts",
  "scripts/dependency-audit-needed.ts",
  "scripts/docs-only.ts",
  ".github/workflows/dependency-audit.yml",
];
/* eslint-enable rabaed/no-avoid-terms */

const isAuditInput = (file: string) => AUDIT_INPUTS.includes(file) || basename(file) === "package.json";

/** Whether any of the changed files can move what the audit finds or how it is judged. */
export const auditNeeded = (files: readonly string[]) => files.some(isAuditInput);

export type AuditDecision = { needed: true } | { needed: boolean; base: string; files: number };

/** The decision against `base` (none: audit); `changedSince(base)` lists the paths HEAD changes from it. */
export function decideAudit(base: string | undefined, changedSince: (base: string) => string[]): AuditDecision {
  if (!base) return { needed: true };
  const files = changedSince(base);
  return { needed: auditNeeded(files), base, files: files.length };
}

function main() {
  const decision = decideAudit(process.env.BASE, (base) => changedSince(process.cwd(), base));
  const summary =
    "base" in decision
      ? `${decision.files} path(s) changed since ${decision.base}: ${decision.needed ? "the lockfile, a package.json or another audit input changed, so the audit runs" : "nothing the audit reads changed, so it is skipped"}.`
      : "No base commit (the nightly run, or one started by hand): the audit runs.";
  console.log(summary);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `needed=${decision.needed}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  try {
    main();
  } catch (error: unknown) {
    // A failed decision fails the job: a required check must not pass on a change it never looked at.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
