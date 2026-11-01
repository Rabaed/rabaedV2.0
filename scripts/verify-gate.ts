/* eslint-disable rabaed/no-avoid-terms -- GitHub's merge queue, its required checks and git's names, by their own names, as in reviewed-required.ts */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ciOverHttp, ciOwnChanges, ciRunningLine, ciVerdict, readCiEvidence, type CiEvidence, type CiReads } from "./ci-green.ts";
import { onlyCleanCommitsSince, realGit, type ReviewedGit } from "./reviewed-label.ts";
import { DOCS_ONLY_LABEL, isDoc, queuedPrNumber, requiredEvent, type RequiredEvent } from "./reviewed-required.ts";

// The verify gate (RP-1094): a PR merges only when its body shows `pnpm verify` passed on its head,
// or on a commit only clean merges of main followed (`onlyCleanCommitsSince`, RP-1017), or the screenshot
// bot's baseline-only commits (`isBaselineBotCommit`, RP-1103: they voided #458, #459, #476). One rule for
// `pnpm queue` (scripts/queue-pr.ts) and for the `verify-gate` check on pull_request and merge_group,
// so a merge started from GitHub's button cannot skip it (14 PRs merged without a valid line, retro
// 2026-10-29).
//
// CI green counts too (RP-1190): GitHub CI's ci.yml pull_request run on the exact head, every required job
// passed, from this repo, for a PR that changes none of CI's own files (scripts/ci-green.ts). `verifiedOrGreen`
// is the one rule; the stamped line still counts and is the only way for a PR that edits ci.yml or a test config.
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

/**
 * A full run's line (`git rev-parse --short`: 7 characters or more), its steps, and its stamp if any. It may end
 * the body's line or be followed by markdown (a code span, bold, a table cell), never by more words.
 */
const LINE = /pnpm verify passed on ([0-9a-f]{7,40}): ([^\n`]*?\.)(?: Stamp ([0-9a-f]{16})\.)?(?=\W|$)/g;

function readLines(body: string): { commit: string; stamped: boolean }[] {
  return [...body.matchAll(LINE)].map(([, commit = "", steps = "", stamp]) => ({ commit, stamped: stamp !== undefined && stamp === stampOf(`pnpm verify passed on ${commit}: ${steps}`) }));
}

const stampedCommits = (lines: { commit: string; stamped: boolean }[]) => lines.flatMap(({ commit, stamped }) => (stamped ? [commit] : []));

/** The commits the body's stamped verify lines name; a line without a valid stamp is left out. */
export const verifiedCommits = (body: string): string[] => stampedCommits(readLines(body));

/**
 * `body` with `line` in place of the verify line(s) it holds (RP-1171, `pnpm verify --pr`): the first is
 * replaced where it stands, the others go, and a line that held only a stale one goes with it. Read by the
 * same pattern as the gate, so what is replaced is what the gate would have read. `replaced` is false when
 * the body had none.
 */
export function replaceVerifyLines(body: string, line: string): { body: string; replaced: boolean } {
  let replaced = false;
  const kept: string[] = [];
  for (const text of body.split("\n")) {
    if (text.search(LINE) < 0) {
      kept.push(text);
      continue;
    }
    const next = text.replace(LINE, () => (replaced ? "" : ((replaced = true), line)));
    if (!/^\s*(?:[-*]\s*)?$/.test(next)) kept.push(next);
  }
  return { body: replaced ? kept.join("\n") : body, replaced };
}

export type VerifyGate = { ok: true; commit: string } | { ok: false; reason: string };

/** Passes when a stamped line names `head` or a commit only clean merges of main (and baseline-only bot commits) led to it from. */
export function verifyGate(body: string, head: string, git: ReviewedGit): VerifyGate {
  const lines = readLines(body);
  const verified = stampedCommits(lines);
  const commit = verified.find((candidate) => onlyCleanCommitsSince(candidate, head, git));
  if (commit !== undefined) return { ok: true, commit };
  if (lines.length === 0) return { ok: false, reason: `its body has no \`pnpm verify passed on <sha>:\` line, so nothing shows \`pnpm verify\` passed on its head ${head}` };
  const unstamped = lines.filter(({ stamped }) => !stamped).map(({ commit: sha }) => sha);
  const parts = [
    ...(unstamped.length > 0 ? [`its verify line for ${unstamped.join(", ")} has no valid stamp (edited by hand, or printed before RP-1094), so it does not count`] : []),
    ...(verified.length > 0 ? [`its stamped verify line names ${verified.join(", ")}, which is neither the head ${head} nor a commit only clean merges of main and screenshot-bot baseline commits led to it from`] : []),
  ];
  return { ok: false, reason: parts.join("; ") };
}

export type Verified = { ok: true; via: "stamp"; commit: string } | { ok: true; via: "ci"; runId: number } | { ok: false; reason: string; running?: string[] };

/**
 * The verify gate's one rule for the check, reviewed-add and `pnpm queue` (RP-1094, RP-1190): the body's stamped
 * line passes `verifyGate` for `head`, or CI is green on that exact head (`ciVerdict`, scripts/ci-green.ts). The
 * line is read first, so an API error never blocks it. `ownChanges` is `ciOwnChanges` of the PR; `running` is set
 * while the head's CI run is still going, with the required jobs left.
 */
export function verifiedOrGreen(body: string, head: string, pr: number, git: ReviewedGit, ownChanges: string[], evidence: CiEvidence): Verified {
  const line = verifyGate(body, head, git);
  if (line.ok) return { ok: true, via: "stamp", commit: line.commit };
  const ci = ciVerdict(head, pr, ownChanges, evidence);
  if (ci.state === "green") return { ok: true, via: "ci", runId: ci.runId };
  if (ci.state === "running") return { ok: false, running: ci.left, reason: `${ciRunningLine(head, ci.left)}, and ${line.reason}` };
  return { ok: false, reason: `${ci.reason}; and ${line.reason}` };
}

/** What a passing `verifiedOrGreen` rests on, for the summaries. */
export const verifiedBy = (verified: Extract<Verified, { ok: true }>) => (verified.via === "stamp" ? `\`pnpm verify\` on ${verified.commit}` : `CI green (run ${verified.runId})`);

/** False only for a PR with the `docs-only` label that changes only docs: it needs no verify run (as `pnpm queue` has it). */
export const needsVerify = (labels: string[], changedFiles: string[]): boolean => !(labels.includes(DOCS_ONLY_LABEL) && changedFiles.every(isDoc));

/** The fix both the check and `pnpm queue` print. */
export const verifyFix = (pr: number, head: string) =>
  `Fix: wait for CI to pass on ${head} (a PR that changes CI's own files cannot use it), or run \`pnpm verify\` on ${head} (a clean checkout of it) and put its last line, stamp included, in the PR body: \`pnpm verify --pr ${pr}\` writes it there (or \`gh pr edit ${pr} --body-file <file>\`)`;

export interface GateSeam extends ReviewedGit, CiReads {
  /** The PR now: its body, head and labels. */
  pull(pr: number): Promise<{ body: string; headSha: string; labels: string[] }>;
  /** `git fetch origin refs/pull/<pr>/head`, so the head's commits are there to walk. */
  fetchPull(pr: number): void;
  /** Paths `head` changes against main: `git diff --name-only origin/main...<head>`. */
  changedFiles(head: string): string[];
  /** A file's text at the merge base of origin/main and `head` and at `head`; undefined where it does not exist. */
  packageJsonVersions(head: string, file: string): { before: string | undefined; after: string | undefined };
}

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
  let ownChanges: string[];
  try {
    seam.fetchPull(pr);
    // Against main (the queue's base_ref), never merge_group.base_sha: that includes the entries ahead.
    const changed = seam.changedFiles(head);
    if (!needsVerify(pull.labels, changed)) return { ok: true, summary: `PR #${pr} has the '${DOCS_ONLY_LABEL}' label and changes only docs: no verify run needed.` };
    ownChanges = ciOwnChanges(changed, (file) => seam.packageJsonVersions(head, file));
  } catch (error) {
    return { ok: false, summary: `PR #${pr}: could not read ${head}'s changes: ${error instanceof Error ? error.message.trim() : String(error)}. Re-run this check.` };
  }
  const gate = verifiedOrGreen(pull.body, head, pr, seam, ownChanges, await readCiEvidence(head, seam));
  if (gate.ok && gate.via === "ci") return { ok: true, summary: `PR #${pr}: CI passed on its head ${head} (run ${gate.runId}), and it changes none of CI's own files: passes.` };
  if (gate.ok) return { ok: true, summary: `PR #${pr}: \`pnpm verify\` passed on ${gate.commit}${head.startsWith(gate.commit) ? ", its head" : `, which only clean merges of main and screenshot-bot baseline commits led to the head ${head} from`}: passes.` };
  return { ok: false, summary: `PR #${pr}: ${gate.reason}. ${verifyFix(pr, head)}. Editing the body, or CI finishing, runs this check again.` };
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

/**
 * A file's text (path from the repo root) at `ref`; undefined only when the path is not a file there (RP-1196: fail
 * closed). Any other git failure throws: a bad ref, a commit a shallow clone lacks, a crash. `git show ref:path`
 * fails the same way (exit 128) for "no such path" and "no such commit", so a reader of its status took a missing
 * commit for a deleted file. `ls-tree` answers "not there" as data instead (exit 0, nothing listed) and fails only
 * when it cannot read the commit; its messages are not parsed (they change with git's version and language).
 */
export function fileAtVia(cwd: string, spawn: typeof spawnSync): (ref: string, file: string) => string | undefined {
  const must = (args: string[]) => {
    const done = spawn("git", args, { cwd, encoding: "utf8" });
    if (done.status !== 0) throw new Error(`git ${args.slice(0, 2).join(" ")} failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
    return done.stdout ?? "";
  };
  return (ref, file) => {
    // -z: the path as is, never quoted; --full-tree: the path and the listing from the root, as `ref:path` reads it.
    const entry = must(["ls-tree", "-z", "--full-tree", ref, "--", file])
      .split("\0")
      .map((line) => /^\d+ (\w+) (\S+)\t(.*)$/s.exec(line))
      .find((match) => match?.[3] === file);
    if (!entry || entry[1] !== "blob") return undefined;
    return must(["cat-file", "blob", entry[2] ?? ""]);
  };
}

/** What `fileVersionsVia` answers: a file's text at the merge base and at the commit, undefined where it is not a file. */
export type FileVersions = (commit: string, file: string) => { before: string | undefined; after: string | undefined };

/**
 * A file's text at the merge base of origin/main and `commit` (what the three-dot diff diffs against) and at
 * `commit`; undefined where it does not exist. Throws on any other git failure, a missing merge base too (`fileAtVia`).
 */
export function fileVersionsVia(cwd: string, spawn: typeof spawnSync): FileVersions {
  const at = fileAtVia(cwd, spawn);
  return (commit, file) => {
    const base = spawn("git", ["merge-base", "origin/main", commit], { cwd, encoding: "utf8" });
    if (base.status !== 0) throw new Error(`git merge-base origin/main ${commit} failed:\n${base.stdout ?? ""}${base.stderr ?? ""}`);
    return { before: at((base.stdout ?? "").trim(), file), after: at(commit, file) };
  };
}

/** The package.json reads of the gates: `fileVersionsVia`, under the name the seams use. */
export const packageJsonVersionsVia = fileVersionsVia;

export function realGateGit(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): Omit<GateSeam, "pull" | keyof CiReads> {
  const must = (args: string[]) => {
    const done = spawn("git", args, { cwd, encoding: "utf8" });
    if (done.status !== 0) throw new Error(`git ${args.slice(0, 3).join(" ")} failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
    return done.stdout ?? "";
  };
  return {
    ...realGit(cwd, spawn),
    packageJsonVersions: packageJsonVersionsVia(cwd, spawn),
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
  // The same event shapes as reviewed-required's.
  const event = requiredEvent(eventName, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")), repository);
  const result = await requireVerified(event, { ...realGateGit(), ...overHttp(repository, token), ...ciOverHttp(repository, token) });
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
