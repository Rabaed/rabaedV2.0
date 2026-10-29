/* eslint-disable rabaed/no-avoid-terms -- GitHub's merge queue, its required checks and git's names, by their own names, as in reviewed-required.ts */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { onlyMainMergedSince, realGit, type ReviewedGit } from "./reviewed-label.ts";
import { DOCS_ONLY_LABEL, isDoc, queuedPrNumber, requiredEvent, type RequiredEvent } from "./reviewed-required.ts";

// The verify gate (RP-1094): a PR merges only when its body shows `pnpm verify` passed on its head,
// or on a commit only clean merges of main followed (`onlyMainMergedSince`, RP-1017). One rule for
// `pnpm queue` (scripts/queue-pr.ts) and for the `verify-gate` check on pull_request and merge_group,
// so a merge started from GitHub's button cannot skip it (14 PRs merged without a valid line, retro
// 2026-10-29).
//
// The stamp: a full, clean run's last line ends `Stamp <16 hex>.`, a hash of the line before it
// (`stampLine`, written by scripts/verify-steps.ts `finalLine`). A line typed or edited by hand (another
// sha, "re-ran 6 timed-out files" added to the steps, PR #466) no longer matches its stamp, so it does not
// count. A dirty run or one resumed with `--from` (RP-1019) is never stamped. The salt is in this public
// file, so the stamp catches hand edits and copied lines; it is not a signature against someone who
// computes one on purpose.
//
// Run by .github/workflows/verify-gate.yml from the default branch's copy (a PR cannot edit the
// script that checks it), in a checkout with main's full history; it fetches the PR's head itself.
// It runs no PR code. Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH.

/** The check's name, as the main ruleset requires it (the job's `name:` in verify-gate.yml). */
export const VERIFY_CHECK = "verify-gate";

/** Changing it voids every stamp written before: only for a change in what the stamp means. */
const SALT = "rabaed verify stamp v1\n";

const stampOf = (line: string) => createHash("sha256").update(SALT + line).digest("hex").slice(0, 16);

/** The line with its stamp: what `pnpm verify` prints after a full, clean pass. */
export const stampLine = (line: string): string => `${line} Stamp ${stampOf(line)}.`;

/** A full run's line (`git rev-parse --short`: 7 characters or more), its steps, and its stamp if any. */
const LINE = /pnpm verify passed on ([0-9a-f]{7,40}): ([^\n`]*?\.)(?: Stamp ([0-9a-f]{16})\.)?(?=[\s`]|$)/g;

function readLines(body: string): { commit: string; stamped: boolean }[] {
  return [...body.matchAll(LINE)].map(([, commit = "", steps = "", stamp]) => ({ commit, stamped: stamp !== undefined && stamp === stampOf(`pnpm verify passed on ${commit}: ${steps}`) }));
}

/** The commits the body's stamped verify lines name; a line without a valid stamp is left out. */
export const verifiedCommits = (body: string): string[] => readLines(body).flatMap(({ commit, stamped }) => (stamped ? [commit] : []));

export type VerifyGate = { ok: true; commit: string } | { ok: false; reason: string };

/** Passes when a stamped line names `head` or a commit only clean merges of main led to it from. */
export function verifyGate(body: string, head: string, git: ReviewedGit): VerifyGate {
  const lines = readLines(body);
  const verified = lines.filter(({ stamped }) => stamped).map(({ commit }) => commit);
  const commit = verified.find((candidate) => onlyMainMergedSince(candidate, head, git));
  if (commit !== undefined) return { ok: true, commit };
  if (lines.length === 0) return { ok: false, reason: `its body has no \`pnpm verify passed on <sha>:\` line, so nothing shows \`pnpm verify\` passed on its head ${head}` };
  const unstamped = lines.filter(({ stamped }) => !stamped).map(({ commit: sha }) => sha);
  const parts = [
    ...(unstamped.length > 0 ? [`its verify line for ${unstamped.join(", ")} has no valid stamp (edited by hand, or printed before RP-1094), so it does not count`] : []),
    ...(verified.length > 0 ? [`its stamped verify line names ${verified.join(", ")}, which is neither the head ${head} nor a commit only clean merges of main led to it from`] : []),
  ];
  return { ok: false, reason: parts.join("; ") };
}

/** False only for a PR with the `docs-only` label that changes only docs: it needs no verify run (as `pnpm queue` has it). */
export const needsVerify = (labels: string[], changedFiles: string[]): boolean => !(labels.includes(DOCS_ONLY_LABEL) && changedFiles.every(isDoc));

/** The fix both the check and `pnpm queue` print. */
export const verifyFix = (pr: number, head: string) => `Fix: run \`pnpm verify\` on ${head} (a clean checkout of it), put its last line, stamp included, in the PR body (\`gh pr edit ${pr} --body-file <file>\`)`;

export interface GateSeam extends ReviewedGit {
  /** The PR now: its body, head and labels. */
  pull(pr: number): Promise<{ body: string; headSha: string; labels: string[] }>;
  /** `git fetch origin refs/pull/<pr>/head`, so the head's commits are there to walk. */
  fetchPull(pr: number): void;
  /** Paths `head` changes against main: `git diff --name-only origin/main...<head>`. */
  changedFiles(head: string): string[];
}

/** The event the workflow ran for: the same shapes as reviewed-required's. */
export const gateEvent = requiredEvent;

export async function requireVerified(event: RequiredEvent, seam: GateSeam): Promise<{ ok: boolean; summary: string }> {
  let pr: number;
  if (event.kind === "merge_group") {
    const queued = queuedPrNumber(event.headRef);
    if (queued === undefined) return { ok: false, summary: `The merge queue ref ${event.headRef} names no PR (expected gh-readonly-queue/<branch>/pr-<n>-<sha>).` };
    pr = queued;
  } else pr = event.pr;
  // A draft passes, as in reviewed-required (RP-1018); ready_for_review runs this check again.
  if (event.kind === "pull_request" && event.draft) return { ok: true, summary: `PR #${pr} is a draft: checked when marked ready.` };
  const pull = await seam.pull(pr);
  // On a PR the check answers for the event's head; in the queue the PR's head is pinned.
  const head = event.kind === "pull_request" ? event.headSha : pull.headSha;
  try {
    seam.fetchPull(pr);
    // Against main (the queue's base_ref), never merge_group.base_sha: that includes the entries ahead.
    if (!needsVerify(pull.labels, seam.changedFiles(head))) return { ok: true, summary: `PR #${pr} has the '${DOCS_ONLY_LABEL}' label and changes only docs: no verify run needed.` };
  } catch (error) {
    return { ok: false, summary: `PR #${pr}: could not read ${head}'s changes: ${error instanceof Error ? error.message.trim() : String(error)}. Re-run this check.` };
  }
  const gate = verifyGate(pull.body, head, seam);
  if (gate.ok) return { ok: true, summary: `PR #${pr}: \`pnpm verify\` passed on ${gate.commit}${head.startsWith(gate.commit) ? ", its head" : `, which only clean merges of main led to the head ${head} from`}: passes.` };
  return { ok: false, summary: `PR #${pr}: ${gate.reason}. ${verifyFix(pr, head)}. Editing the body runs this check again.` };
}

export function overHttp(repository: string, token: string, fetcher: typeof fetch = fetch): Pick<GateSeam, "pull"> {
  return {
    async pull(pr) {
      const response = await fetcher(`https://api.github.com/repos/${repository}/pulls/${pr}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      });
      if (!response.ok) throw new Error(`GitHub GET pulls/${pr} answered ${response.status}`);
      const pull = (await response.json()) as { body: string | null; head: { sha: string }; labels: { name: string }[] };
      return { body: pull.body ?? "", headSha: pull.head.sha, labels: pull.labels.map((label) => label.name) };
    },
  };
}

export function realGateGit(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): Omit<GateSeam, "pull"> {
  const must = (args: string[]) => {
    const done = spawn("git", args, { cwd, encoding: "utf8" });
    if (done.status !== 0) throw new Error(`git ${args.slice(0, 3).join(" ")} failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
    return done.stdout ?? "";
  };
  return {
    ...realGit(cwd, spawn),
    fetchPull: (pr) => void must(["fetch", "--no-tags", "origin", `refs/pull/${pr}/head`]),
    // --no-renames lists a rename's old path too, so code renamed to .md is not a docs-only change (RP-606).
    changedFiles: (head) =>
      must(["diff", "--name-only", "--no-renames", `origin/main...${head}`])
        .split("\n")
        .filter(Boolean),
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!token || !repository || !eventName) throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_NAME must be set");
  const event = gateEvent(eventName, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")), repository);
  const result = await requireVerified(event, { ...realGateGit(), ...overHttp(repository, token) });
  (result.ok ? console.log : console.error)(result.summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.summary}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
