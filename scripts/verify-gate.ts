/* eslint-disable rabaed/no-avoid-terms -- GitHub's merge queue, its required checks and git's names, by their own names, as in reviewed-required.ts */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ciOverHttp, ciOwnChanges, ciRunningLine, ciVerdict, ratchetGains, readCiEvidence, type CiEvidence, type CiReads, type RatchetGain } from "./ci-green.ts";
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
// The ratchet lists (RP-1194): a stamped line does not let a PR add or loosen an entry in a hidden-asserts or
// untested-seams list. The PR's lists are compared with those at its merge base with origin/main, which this check
// reads from main's own copy of the script; `baselineRefusals` says when an entry may still pass. The CI unit run of
// check-hidden-asserts and check-scenario-seams keeps reading the PR's own lists: it runs the PR's own copy of those
// checks, in a shallow checkout without origin/main, so a compare there would prove nothing.
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

/**
 * False only for a PR with the `docs-only` label that changes only docs: it needs no verify run (as `pnpm queue` has it).
 * The callers also ask for one when `ciOwnChanges` names a change (RP-1196): a ratchet list or a scenario file is a doc,
 * so without that a docs-only PR could drop a scenario row with no verify at all.
 */
export const needsVerify = (labels: string[], changedFiles: string[]): boolean => !(labels.includes(DOCS_ONLY_LABEL) && changedFiles.every(isDoc));

/** GitHub's legacy base role for a user on the repo (`permission` in the collaborator permission answer). */
export type Permission = "admin" | "write" | "read" | "none";

/**
 * GitHub's `permission` values (GET /repos/{o}/{r}/collaborators/{login}/permission) that can push to the repo:
 * `maintain` is reported as `write`, `triage` as `read`. A marker counts only from a user with one of these, the
 * people who could push or label the PR anyway. The lanes post as the owner's account. `author_association` is not
 * used: GitHub reports MEMBER only for a public org membership, so CI's token saw the owner as CONTRIBUTOR (RP-1159).
 * No bot counts: no review bot posts on this repo, and any workflow can comment as github-actions[bot].
 */
export const canPush = (permission: Permission): boolean => permission === "admin" || permission === "write";

/** A comment on a PR's conversation, as the markers are read from it. */
export interface ReviewComment {
  login: string;
  /** GitHub's `user.type`: "User" or "Bot". */
  type: string;
  body: string;
}

/** How the gates read a PR's comments and a commenter's permission (GitHub's REST API, or gh). */
export interface CommentReads {
  /** Every comment on the PR's conversation. */
  comments(pr: number): Promise<ReviewComment[]>;
  /** GitHub's `permission` for `login` on the repo. */
  permission(login: string): Promise<Permission>;
}

/**
 * The marker of Main 6's approval of a baseline entry a PR adds (RP-1194; RP-1148, the owner's approval, is parked). It
 * is a PR comment, never the body: the body is the lane's to write. It names the head Main 6 read, and the comment
 * repeats each `Baseline added:` line it approves, so a line added to the body afterwards is not approved. The lane's
 * own review step cannot write it: scripts/review-post.ts refuses a summary holding it. Every session posts as the
 * owner's GitHub login, so nothing GitHub records tells Main 6's comment from a lane's: the marker is a visible,
 * deliberate step that no lane tool takes, not a signature (RP-1148 option 1 would make it one).
 */
export const BASELINE_MARKER_START = "<!-- main-6-baseline:";
export const baselineMarker = (sha: string) => `${BASELINE_MARKER_START} ${sha} -->`;

const BASELINE_MARKER = /<!-- main-6-baseline: ([0-9a-f]{40}) -->/g;

/** The start of the exception line for one entry, in the PR body and in Main 6's comment alike. */
const exceptionLine = ({ file, entry }: RatchetGain) => `Baseline added: ${file} ${entry}:`;

/** The body's lines, each without its markdown list bullet, quote mark or code span. */
const bareLines = (text: string) => text.split("\n").map((line) => line.trim().replace(/^(?:[-*>]\s+)+/, "").replace(/^`(.*)`$/, "$1").trim());

/** True when `text` has the exception line for `gain` with a reason after it. */
const hasException = (text: string, gain: RatchetGain) => bareLines(text).some((line) => line.startsWith(exceptionLine(gain)) && line.slice(exceptionLine(gain).length).trim() !== "");

const baselineMarked = (comment: ReviewComment) => [...comment.body.matchAll(BASELINE_MARKER)].map(([, sha = ""]) => sha);

/** The users whose comments hold a baseline marker: the logins whose permission the gate reads. */
export const baselineMarkerLogins = (comments: ReviewComment[]): string[] => [
  ...new Set(comments.filter((comment) => comment.type === "User" && baselineMarked(comment).length > 0).map((comment) => comment.login)),
];

/** The users among `baselineMarkerLogins` who can push to the repo. */
export async function baselineWriters(comments: ReviewComment[], permission: (login: string) => Promise<Permission>): Promise<Set<string>> {
  const writers = new Set<string>();
  for (const login of baselineMarkerLogins(comments)) if (canPush(await permission(login))) writers.add(login);
  return writers;
}

/**
 * Why each ratchet list entry the PR adds or loosens (`gains`, against the merge base with origin/main) is refused
 * (RP-1194): the lists only shrink, stamped verify or not. An entry passes only as a visible exception: the body's line
 * `Baseline added: <file> <entry>: <reason>`, and a comment by one of `writers` (never a bot) holding
 * `baselineMarker(<sha>)` for the head, or a commit only clean merges of main led to it from, with the same line.
 */
export function baselineRefusals(gains: RatchetGain[], body: string, comments: ReviewComment[], writers: ReadonlySet<string>, head: string, git: ReviewedGit): string[] {
  const approvals = comments.filter((comment) => comment.type === "User" && writers.has(comment.login) && baselineMarked(comment).some((sha) => onlyCleanCommitsSince(sha, head, git)));
  return gains.flatMap((gain) => {
    if (hasException(body, gain) && approvals.some((comment) => hasException(comment.body, gain))) return [];
    const why = hasException(body, gain)
      ? `no comment holding \`${baselineMarker("<head sha>")}\` for the head ${head} by a user who can push repeats its \`${exceptionLine(gain)}\` line`
      : `its body has no \`${exceptionLine(gain)} <reason>\` line`;
    return [`${gain.file} gains \`${gain.entry}\` against origin/main, and the hidden-asserts and untested-seams lists only shrink (RP-1194): ${why}`];
  });
}

/** The fix both the check and `pnpm queue` print for `baselineRefusals`. */
export const baselineFix = (pr: number) =>
  `Fix: fix the test so the entry is not needed, and drop it from the list; or, for a deliberate entry, put \`Baseline added: <file> <entry>: <reason>\` in PR #${pr}'s body and ask Main 6 to review it and comment \`${baselineMarker("<head sha>")}\` with the same line (then edit the body, or re-run the check)`;

/** The fix both the check and `pnpm queue` print. */
export const verifyFix = (pr: number, head: string) =>
  `Fix: wait for CI to pass on ${head} (a PR that changes CI's own files cannot use it), or run \`pnpm verify\` on ${head} (a clean checkout of it) and put its last line, stamp included, in the PR body: \`pnpm verify --pr ${pr}\` writes it there (or \`gh pr edit ${pr} --body-file <file>\`)`;

export interface GateSeam extends ReviewedGit, CiReads, CommentReads {
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
  let gains: RatchetGain[];
  let changed: string[];
  try {
    seam.fetchPull(pr);
    // Against main (the queue's base_ref), never merge_group.base_sha: that includes the entries ahead.
    changed = seam.changedFiles(head);
    const versions = (file: string) => seam.packageJsonVersions(head, file);
    gains = ratchetGains(changed, versions);
    ownChanges = ciOwnChanges(changed, versions);
  } catch (error) {
    return { ok: false, summary: `PR #${pr}: could not read ${head}'s changes: ${error instanceof Error ? error.message.trim() : String(error)}. Re-run this check.` };
  }
  // Before the docs-only pass and the verify: the lists are docs, and a stamped line does not excuse a new entry.
  if (gains.length > 0) {
    let refusals: string[];
    try {
      const comments = await seam.comments(pr);
      refusals = baselineRefusals(gains, pull.body, comments, await baselineWriters(comments, (login) => seam.permission(login)), head, seam);
    } catch (error) {
      return { ok: false, summary: `PR #${pr}: could not read its comments for the baseline exceptions: ${error instanceof Error ? error.message.trim() : String(error)}. Re-run this check.` };
    }
    if (refusals.length > 0) return { ok: false, summary: `PR #${pr}: ${refusals.join("; ")}. ${baselineFix(pr)}.` };
  }
  if (!needsVerify(pull.labels, changed) && ownChanges.length === 0) return { ok: true, summary: `PR #${pr} has the '${DOCS_ONLY_LABEL}' label and changes only docs: no verify run needed.` };
  const gate = verifiedOrGreen(pull.body, head, pr, seam, ownChanges, await readCiEvidence(head, seam));
  if (gate.ok && gate.via === "ci") return { ok: true, summary: `PR #${pr}: CI passed on its head ${head} (run ${gate.runId}), and it changes none of CI's own files: passes.` };
  if (gate.ok) return { ok: true, summary: `PR #${pr}: \`pnpm verify\` passed on ${gate.commit}${head.startsWith(gate.commit) ? ", its head" : `, which only clean merges of main and screenshot-bot baseline commits led to the head ${head} from`}: passes.` };
  return { ok: false, summary: `PR #${pr}: ${gate.reason}. ${verifyFix(pr, head)}. Editing the body, or CI finishing, runs this check again.` };
}

const get = (repository: string, token: string, fetcher: typeof fetch) => async (path: string, allow404 = false): Promise<unknown> => {
  const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (allow404 && response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub GET ${path} answered ${response.status}`);
  return response.json();
};

const COMMENTS_PER_PAGE = 100;

/** `CommentReads` over GitHub's REST API (reviewed-add reads them the same way); needs only the token's read access. */
export function commentsOverHttp(repository: string, token: string, fetcher: typeof fetch = fetch): CommentReads {
  const read = get(repository, token, fetcher);
  return {
    async comments(pr) {
      const all: ReviewComment[] = [];
      // 30 pages of 100: far more comments than any PR here has.
      for (let page = 1; page <= 30; page++) {
        const batch = (await read(`issues/${pr}/comments?per_page=${COMMENTS_PER_PAGE}&page=${page}`)) as {
          body: string | null;
          user: { login: string; type: string } | null;
        }[];
        all.push(...batch.map((comment) => ({ login: comment.user?.login ?? "", type: comment.user?.type ?? "", body: comment.body ?? "" })));
        if (batch.length < COMMENTS_PER_PAGE) break;
      }
      return all;
    },
    async permission(login) {
      // 404: no such user (a deleted account's ghost), so no access. Needs only the token's metadata read.
      const found = (await read(`collaborators/${encodeURIComponent(login)}/permission`, true)) as { permission: Permission } | undefined;
      return found?.permission ?? "none";
    },
  };
}

export function overHttp(repository: string, token: string, fetcher: typeof fetch = fetch): Pick<GateSeam, "pull" | keyof CommentReads> {
  const read = get(repository, token, fetcher);
  return {
    async pull(pr) {
      const pull = (await read(`pulls/${pr}`)) as { body: string | null; head: { sha: string }; labels: { name: string }[] };
      return { body: pull.body ?? "", headSha: pull.head.sha, labels: pull.labels.map((label) => label.name) };
    },
    ...commentsOverHttp(repository, token, fetcher),
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
