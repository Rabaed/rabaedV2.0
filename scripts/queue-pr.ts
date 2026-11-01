import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { mergeTreeOid, realMergeChecksSeam, runMergeChecks, type MergeChecksResult } from "./merge-checks.ts";
import { classify, type RemovalKind } from "./queue-drop-comment.ts";
import { cleanWalk, isMergeOfMain, realGit, REVIEWED_LABEL, type ReviewedGit } from "./reviewed-label.ts";
import { DOCS_ONLY_LABEL, REQUIRED_CHECK, reviewGate } from "./reviewed-required.ts";
import { realStopInput, stopAfterEnqueue } from "./queue-stack-stop.ts";
import { sharedFilesMix } from "./shared-files.ts";
import { ciEvidenceOf, ciJobsPath, ciOwnChanges, ciRunFrom, ciRunningLine, ciRunsPath, ratchetGains, runsFrom, type CiEvidence, type CiRun } from "./ci-green.ts";
import {
  baselineFix,
  baselineRefusals,
  errorText,
  fileAtVia,
  hasBaselineMarker,
  markerWriters,
  needsVerify,
  packageJsonVersionsVia,
  VERIFY_CHECK,
  verifiedCommits,
  verifiedOrGreen,
  verifyFix,
  type Permission,
  type ReviewComment,
} from "./verify-gate.ts";
import { isAncestor } from "./worktrees.ts";

// `pnpm queue <pr>` (RP-400, from the PR #149 retro): checks the branch against
// today's origin/main, then queues the PR. A PR whose CI went green hours ago
// can have lost to a newer main (a migration with the same timestamp, a text
// conflict); the queue removes it for that, and every re-queue costs a full run.
//
// Run it from any checkout, as one plain command: `pnpm queue 149 --wait` (RP-454).
// The checks and the queue entry use the PR's own head (refs/pull/<n>/head), not
// HEAD. --wait first waits for the main ruleset's required checks on that head to
// finish (RP-967: right after `gh pr create` GitHub refuses the enqueue with
// "1 expected"), check runs and commit statuses alike, and for the head's reviewed-label
// run when it is still going. It fails when one fails, when one never reports (15 min),
// after 60 min in all (a run stuck queued), when the head moves (a push), or when a gh
// call fails three times in a row, each naming why. Then it polls every 60 s until the
// PR merges (exit 0) or leaves the queue or closes (exit 1, with the reason). GitHub's
// "already in the queue" or "already queued" (an earlier call queued it) counts as queued.
// The PR needs the `reviewed` label (a finished /code-review, RP-584), or the `docs-only` label when
// every file it changes is a doc: the rule of the main ruleset's reviewed-required check (RP-606).
// --no-review only names the docs-only label when it is missing; it no longer skips the rule.
// A PR queued under `reviewed` also needs `pnpm verify passed on <sha>:` in its body, where <sha> is
// its head or a commit only clean merges of main and screenshot-bot baseline commits followed (the
// reviewed-label rule, RP-1017, RP-1103): PR #288's labelled, green old head was queued after verify
// had found a visibility leak on it. The line must
// carry its stamp: the verify gate's rule (scripts/verify-gate.ts, RP-1094), the same as the check's.
// Or, instead of the line, CI green on the exact head (RP-1190, `verifiedOrGreen`, scripts/ci-green.ts), for a
// PR that changes none of CI's own files. While CI runs it refuses with "CI still running on <sha>: N jobs
// left"; --wait waits for CI instead, and for the verify-gate check that re-runs once CI is green.
// A PR whose hidden-asserts or untested-seams list gains an entry against origin/main is refused whatever its
// labels or verify, unless the entry is a visible exception with Main 6's marker (RP-1194, `baselineRefusals`).
// Once the PR is queued (RP-1170), it stops the lane's stack: the containers of the worktree on the PR's branch,
// with `docker stop`, so its volumes stay (queue-stack-stop.ts says when it leaves one running). --keep-stack
// skips that; a stop Docker refuses is a warning, never a failed queue.
// The git and gh calls sit behind QueueSeam so the tests touch no network.

export interface PullStatus {
  state: "OPEN" | "MERGED" | "CLOSED";
  isInMergeQueue: boolean;
}

/** Also the reviewed-label rule's git (`parents`, `onMain`, `tree`, `mergedTree`), for the verify line's walk. */
export interface QueueSeam extends ReviewedGit {
  /** `git fetch origin main`; false when it fails. */
  fetchMain(): boolean;
  /** Fetches `refs/pull/<pr>/head` (the PR's own head, whatever is checked out) and returns its commit. */
  fetchPull(pr: number): string;
  /** The commit HEAD points at. */
  head(): string;
  /** The checked-out branch name; "HEAD" when detached. */
  branch(): string;
  /** True when `ancestor` is an ancestor of `commit` or the same commit (`git merge-base --is-ancestor`). */
  isAncestor(ancestor: string, commit: string): boolean;
  /** `gh pr view <pr> --json id,headRefOid,headRefName` */
  pullRequest(pr: number): { id: string; headRefOid: string; headRefName: string };
  /** `git merge-tree --write-tree origin/main <commit>`: status 0 when it merges cleanly, 1 when it conflicts, anything else is an error. */
  mergeTree(commit: string): { status: number; output: string; stderr: string };
  /** Paths the PR changes against main (`git diff --name-only origin/main...<commit>`). */
  changedFiles(commit: string): string[];
  /** A package.json's text at the merge base of origin/main and `commit` (what the three-dot `changedFiles` diffs against) and at `commit`; undefined where it does not exist. */
  packageJsonVersions(commit: string, file: string): { before: string | undefined; after: string | undefined };
  /** The migration checks of `commit` against origin/main; status 0 when they pass. */
  check(name: "drift" | "immutable", commit: string): { status: number; output: string };
  /** Main's newest checks (scripts/merge-checks.ts) on a checkout of the merge: `mergeOutput` is `mergeTree`'s clean answer, `head` the PR's head. */
  mergeChecks(mergeOutput: string, head: string): MergeChecksResult;
  /** The PR's label names (`gh pr view <pr> --json labels`). */
  labels(pr: number): string[];
  /** The PR's body (`gh pr view <pr> --json body`); "" when it has none. */
  body(pr: number): string;
  /** Every comment on the PR's conversation (`gh api repos/{owner}/{repo}/issues/<pr>/comments`), for Main 6's baseline marker (RP-1194). */
  comments(pr: number): ReviewComment[];
  /** GitHub's `permission` for `login` on the repo (`gh api repos/{owner}/{repo}/collaborators/<login>/permission`). */
  permission(login: string): Permission;
  /** True when `.github/workflows/reviewed-label.yml` exists on origin/main (`git cat-file -e`). */
  labelWorkflowOnMain(): boolean;
  /** The `reviewed-label` workflow's runs for `commit`, newest first (`gh run list --workflow reviewed-label.yml --commit`). */
  labelRuns(commit: string): { status: string; conclusion: string }[];
  /** The `enqueuePullRequest` mutation, pinned by expectedHeadOid. */
  enqueue(id: string, head: string): { position: number; state: string };
  /** The PR's `state` and `isInMergeQueue` (GraphQL; `gh pr view` has no such field). */
  status(id: string): PullStatus;
  /** The reason of the PR's latest RemovedFromMergeQueueEvent created at or after `since` (an enum, e.g. MERGE_CONFLICT); undefined when there is none. */
  removalReason(id: string, since: Date): string | undefined;
  /** The status checks the main ruleset requires (`gh api repos/{owner}/{repo}/rules/branches/main`). */
  requiredChecks(): string[];
  /** The head's ci.yml pull_request runs with their latest jobs (`ciRunsPath`, `ciJobsPath`). */
  ciRuns(commit: string): CiRun[];
  /** The latest check run of each name on `commit` (`gh api repos/{owner}/{repo}/commits/<commit>/check-runs`). */
  checkRuns(commit: string): CheckRun[];
  /** The latest commit status of each context on `commit` (`gh api repos/{owner}/{repo}/commits/<commit>/status`): a required check can be one. */
  commitStatuses(commit: string): CommitStatus[];
}

/** Why a `--wait` ended without queueing, when it is not one of the refusals. */
export type WaitFailure = "checks_timeout" | "gh_failed" | "head_moved";

export interface QueueResult {
  ok: boolean;
  lines: string[];
  reason?: WaitFailure;
}

const fail = (...lines: string[]): QueueResult => ({ ok: false, lines });
const failFor = (reason: WaitFailure, ...lines: string[]): QueueResult => ({ ok: false, lines, reason });

/** Paths in `git merge-tree` output's conflicted-file list ("<mode> <oid> <stage>\t<path>"). */
export function conflictedFiles(output: string): string[] {
  const paths = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^\d+ [0-9a-f]+ [123]\t(.+)$/.exec(line);
    if (match?.[1]) paths.add(match[1]);
  }
  return [...paths];
}

/**
 * What `prepare` decides: `refused` with the refusal to print, or `ready` with the PR's node id,
 * the head to pin, the warnings so far, and whether the head's reviewed-label run is still to
 * finish (only `--wait` lets that through, and waits for it).
 */
type Prepared =
  | { kind: "refused"; result: QueueResult }
  | { kind: "ready"; id: string; head: string; warnings: string[]; first: string[]; labelRunPending: boolean; verify: VerifyInputs | undefined; ciPending: boolean };

/** What the verify gate read in `prepare`, kept for --wait to read CI again: undefined when no verify is needed or the stamped line passed. */
interface VerifyInputs {
  body: string;
  ownChanges: string[];
}

const refused = (result: QueueResult): Prepared => ({ kind: "refused", result });

export function queuePr(pr: number, seam: QueueSeam, options: { noReview?: boolean } = {}): QueueResult {
  const prepared = prepare(pr, seam, options);
  return prepared.kind === "ready" ? enqueueAt(pr, seam, prepared) : prepared.result;
}

/**
 * RP-967: GitHub's answers when the PR is in the queue already (an earlier call queued it): the
 * GraphQL "already in the (merge) queue" / "in a merge queue", and gh's "is already queued to merge".
 */
const ALREADY_QUEUED = /already (queued|in (a|the) (merge )?queue)/i;

/** GitHub's refusal of `expectedHeadOid`: the branch was pushed to after the head was pinned. */
const HEAD_REFUSED = /expected ?head ?oid|head (oid|sha|ref) (has )?(changed|moved|does not match)/i;

const headMoved = (pr: number, pinned: string, now: string | undefined) =>
  failFor(
    "head_moved",
    `PR #${pr}'s head moved while waiting: the checks were for ${pinned}${now ? `, the PR is now at ${now}` : ", and GitHub refused to queue it"}.`,
    `Fix: wait for the new head's checks, then run \`pnpm queue ${pr} --wait\` again.`,
  );

function enqueueAt(pr: number, seam: QueueSeam, { id, head, warnings }: { id: string; head: string; warnings: string[] }): QueueResult {
  try {
    const entry = seam.enqueue(id, head);
    return { ok: true, lines: [...warnings, `Queued PR #${pr} at ${head}: position ${entry.position}, state ${entry.state}.`] };
  } catch (error) {
    if (error instanceof Error && HEAD_REFUSED.test(error.message)) return headMoved(pr, head, undefined);
    if (!(error instanceof Error && ALREADY_QUEUED.test(error.message))) throw error;
    return { ok: true, lines: [...warnings, `PR #${pr} is already in the merge queue (an earlier call queued it); treating it as queued.`] };
  }
}

/** The reviewed-label runs on `head`, read as the queue reads them: still to finish, failed (with the refusal), or passed. */
function labelRunState(pr: number, head: string, runs: { status: string; conclusion: string }[]): { state: "pending"; none: boolean } | { state: "failed"; result: QueueResult } | { state: "passed" } {
  if (runs.length === 0 || runs.some((run) => run.status !== "completed")) return { state: "pending", none: runs.length === 0 };
  const [latest] = runs;
  if (latest?.conclusion === "success" || latest?.conclusion === "skipped") return { state: "passed" };
  return {
    state: "failed",
    result: fail(
      `PR #${pr}: the reviewed-label run on ${head} failed (${latest?.conclusion}), so the '${REVIEWED_LABEL}' label cannot be trusted.`,
      "Fix: open the run in the Actions tab, re-run it, then run `pnpm queue " + pr + "` again.",
    ),
  };
}

/** Since RP-604 a PR's opening makes a run too; a PR opened before that and not pushed to since has none. */
const NO_LABEL_RUN = " A PR opened before RP-604 and not pushed to since never gets one: merge origin/main in cleanly and push (the label stays).";

type VerifyState = { state: "passed"; via: "stamp" | "ci" } | { state: "running"; left: string[]; result: QueueResult } | { state: "refused"; result: QueueResult };

/**
 * The verify gate on `head` (RP-1017, RP-1094, RP-1190): a stamped line for it or a commit only clean merges of main
 * followed, or CI green on it (`verifiedOrGreen`). While CI runs, `running` with the refusal to print without --wait.
 */
function verifyState(pr: number, head: string, seam: QueueSeam, inputs: VerifyInputs, evidence: CiEvidence): VerifyState {
  const gate = verifiedOrGreen(inputs.body, head, pr, seam, inputs.ownChanges, evidence);
  if (gate.ok) return { state: "passed", via: gate.via };
  if (gate.running) {
    return {
      state: "running",
      left: gate.running,
      result: fail(`PR #${pr}: ${ciRunningLine(head, gate.running)}.`, `Fix: wait for CI on ${head}, then run \`pnpm queue ${pr}\` again, or run \`pnpm queue ${pr} --wait\` to wait for it.`),
    };
  }
  return { state: "refused", result: fail(`PR #${pr}: ${gate.reason}.`, `${verifyFix(pr, head)}, then run \`pnpm queue ${pr}\` again.`) };
}

/** `read`'s answer, or the refusal naming the git error that stopped it: a changed file git cannot read refuses (RP-1196). */
function readOrRefuse<T>(pr: number, head: string, read: () => T): { ok: true; value: T } | { ok: false; result: QueueResult } {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    return {
      ok: false,
      result: fail(
        `PR #${pr}: could not read ${head}'s changed files: ${errorText(error)}`,
        "Fix: run `git fetch origin main` and check that this clone has the PR's head and its merge base with origin/main (not shallow), then run `pnpm queue` again.",
      ),
    };
  }
}

/** The ruleset's required checks and the head's CI runs, any gh error as evidence the gate refuses. */
const ciEvidence = (seam: QueueSeam, head: string) => ciEvidenceOf(() => ({ required: seam.requiredChecks(), runs: seam.ciRuns(head) }));

/** The refusals, in order; on success, what to enqueue. `waitForLabelRun` (--wait) lets a reviewed-label run and a CI run still going through. */
function prepare(pr: number, seam: QueueSeam, options: { noReview?: boolean; waitForLabelRun?: boolean }): Prepared {
  // Lines that go before anything else `pnpm queue` prints, a refusal included (RP-1113).
  const first: string[] = [];
  const prepared = refusals(pr, seam, options, first);
  return "lines" in prepared ? refused({ ...prepared, lines: [...first, ...prepared.lines] }) : prepared;
}

/**
 * RP-1113: the merge of main that voids the body's stamped verify lines, which until now showed only as the verify
 * refusal, often hours after the conflict merge. The verify gate's own walk (`cleanWalk`, the one
 * `onlyCleanCommitsSince` takes) from `head` back to each stamped commit (`verifiedCommits`) stops at it, because its
 * tree is not git's clean merge of its parents. Undefined when a line still counts, when there is none, or when the
 * walk stops at anything but a merge of main (an ordinary commit after the run, or past the walk's limit: the verify
 * refusal says that).
 */
export function uncleanMergeSince(body: string, head: string, git: ReviewedGit): { merge: string; verified: string[] } | undefined {
  const verified = verifiedCommits(body);
  const walks = verified.map((commit) => cleanWalk(commit, head, git));
  if (walks.length === 0 || walks.some((walk) => walk.clean)) return undefined;
  // Every walk starts at the head along the same first parents, so each stops at the same commit.
  const [walk] = walks;
  const merge = walk && !walk.clean ? walk.stoppedAt : undefined;
  return merge !== undefined && isMergeOfMain(merge, git) ? { merge, verified } : undefined;
}

function uncleanMergeLine(pr: number, head: string, body: string, git: ReviewedGit): string | undefined {
  const found = uncleanMergeSince(body, head, git);
  if (!found) return undefined;
  const lines = found.verified.length === 1 ? `the stamped verify line (on ${found.verified[0]}) no longer counts` : `no stamped verify line (on ${found.verified.join(", ")}) counts any more`;
  return `Warning: ${found.merge} is a merge of main that is not clean (its tree is not git's own merge of its parents: a conflict resolution or an edit), so ${lines} for the head ${head}. Run \`pnpm verify --pr ${pr}\` again on the head.`;
}

function refusals(pr: number, seam: QueueSeam, options: { noReview?: boolean; waitForLabelRun?: boolean }, first: string[]): QueueResult | Prepared {
  if (!seam.fetchMain()) return fail("git fetch origin main failed; the checks need a current origin/main. Get online and run `pnpm queue` again.");

  // The checks run on the PR's own head, fetched from refs/pull/<n>/head, so any checkout can queue any PR.
  const pull = seam.pullRequest(pr);
  const head = seam.fetchPull(pr);
  if (head !== pull.headRefOid) {
    return fail(
      `PR #${pr}'s head moved while fetching: the API says ${pull.headRefOid}, the fetched ref is ${head}, so these checks would not be about what gets queued.`,
      "Fix: wait a moment for GitHub to settle, then run `pnpm queue` again.",
    );
  }
  let labelRunPending = false;
  const changed = seam.changedFiles(head);
  const labels = seam.labels(pr);
  // Read once: the warning, the baseline exception and the verify gate all judge the same body.
  const body = seam.body(pr);
  // A docs-only PR needs no verify run, so a merge that voids its line is no news (RP-1113).
  const unclean = needsVerify(labels, changed) ? uncleanMergeLine(pr, head, body, seam) : undefined;
  if (unclean) first.push(unclean);
  const warnings: string[] = [...first];
  // The ratchet lists only shrink against main, whatever the labels or the verify (RP-1194): the verify-gate check's rule.
  const versions = (file: string) => seam.packageJsonVersions(head, file);
  const gains = readOrRefuse(pr, head, () => ratchetGains(changed, versions));
  if (!gains.ok) return gains.result;
  if (gains.value.length > 0) {
    const comments = seam.comments(pr);
    const writers = markerWriters(comments, hasBaselineMarker, (login) => seam.permission(login));
    const baseline = baselineRefusals(gains.value, body, comments, writers, head, seam);
    if (baseline.length > 0) return fail(`PR #${pr}: ${baseline.join("; ")}.`, `${baselineFix(pr)}, then run \`pnpm queue ${pr}\` again.`);
  }
  // The same rule as the main ruleset's reviewed-required check (RP-606), so what this queues the queue keeps.
  const gate = reviewGate(labels, changed);
  if (!gate.ok) {
    const docsOnlyFix = `For a PR that changes only docs: \`gh pr edit ${pr} --add-label ${DOCS_ONLY_LABEL}\`, wait for the ${REQUIRED_CHECK} check, then \`pnpm queue ${pr}\` again.`;
    if (options.noReview) {
      return fail(
        `PR #${pr}: --no-review needs the '${DOCS_ONLY_LABEL}' label now: ${gate.reason}. Without it the main ruleset's ${REQUIRED_CHECK} check fails and the queue drops the PR.`,
        `Fix: ${docsOnlyFix} A PR that changes more than docs needs a /code-review and the '${REVIEWED_LABEL}' label.`,
      );
    }
    return fail(
      `PR #${pr}: ${gate.reason}. planning/parallel-sessions.md rule 6 queues a PR only after a finished /code-review.`,
      `Fix: run /code-review, push its fixes, post its summary with \`node scripts/review-post.ts ${pr} <summary-file>\` and put the stamped verify line in the body; CI's reviewed-add then adds '${REVIEWED_LABEL}' (a hand label does not count, RP-1167). Then run \`pnpm queue ${pr}\` again. A new push removes the label. ${docsOnlyFix}`,
    );
  }
  if (gate.via === DOCS_ONLY_LABEL) {
    warnings.push(`Warning: queued under the '${DOCS_ONLY_LABEL}' label (every changed file is a doc); nothing checked that a /code-review finished.`);
  } else if (seam.labelWorkflowOnMain()) {
    // The label alone is not tied to a head: a push whose workflow run has not finished (or never ran, as with a merge conflict) still shows the old label.
    const label = labelRunState(pr, head, seam.labelRuns(head));
    if (label.state === "failed") return label.result;
    if (label.state === "pending") {
      // --wait waits for it with the required checks (right after `gh pr create` it is still going).
      if (options.waitForLabelRun) labelRunPending = true;
      else {
        return fail(
          `PR #${pr}: the reviewed-label workflow has not finished for the head ${head}, so the '${REVIEWED_LABEL}' label may be left over from an earlier head.`,
          `Fix: wait for the reviewed-label run on ${head}, then run \`pnpm queue ${pr}\` again.${label.none ? NO_LABEL_RUN : ""}`,
        );
      }
    }
  } else {
    warnings.push("Warning: .github/workflows/reviewed-label.yml is not on origin/main yet, so the label could not be tied to the head; not checked.");
  }
  // A docs-only PR needs no verify run, whether or not it also carries `reviewed` (reviewGate then answers via reviewed).
  let verify: VerifyInputs | undefined;
  let ciPending = false;
  const own = readOrRefuse(pr, head, () => ciOwnChanges(changed, versions));
  if (!own.ok) return own.result;
  // A docs-only PR that drops a scenario row or grows a list still needs one (RP-1196), as in the verify-gate check.
  if (needsVerify(labels, changed) || own.value.length > 0) {
    const inputs = { body, ownChanges: own.value };
    const state = verifyState(pr, head, seam, inputs, ciEvidence(seam, head));
    if (state.state === "refused") return state.result;
    if (state.state === "running" && !options.waitForLabelRun) return state.result;
    // --wait reads CI again while it waits, and excuses verify-gate's early failure; a stamped line needs neither.
    if (state.state === "running" || state.via === "ci") verify = inputs;
    ciPending = state.state === "running";
  }
  const checkout = seam.head();
  // Only a checkout of the PR's own branch can be behind it; an old main is just another branch.
  if (checkout !== head && seam.branch() === pull.headRefName && seam.isAncestor(checkout, head)) {
    warnings.push(`Warning: HEAD (${checkout}) is behind PR #${pr}'s head (${head}); checked and queued the PR's head. Pull to catch up.`);
  }

  // The same rule as `pnpm verify` and the pre-push hook (RP-993), so a mix shows before the push.
  const mix = readOrRefuse(pr, head, () => sharedFilesMix(changed, versions));
  if (!mix.ok) return mix.result;
  const shared = mix.value;
  if (shared) {
    return fail(`PR #${pr} breaks planning/parallel-sessions.md rule 3: it changes root shared file(s) together with other files.`, ...shared, "Split it out, then run `pnpm queue` again.");
  }

  const merge = seam.mergeTree(head);
  if (merge.status > 1 || merge.status < 0) {
    return fail(
      `git merge-tree failed with exit ${merge.status}; this is not a conflict:`,
      merge.stderr.trimEnd() || "(no stderr)",
      "Fix: check that origin/main was fetched and this worktree is a clean checkout of the PR branch, then run `pnpm queue` again.",
    );
  }
  if (merge.status === 1) {
    const files = conflictedFiles(merge.output);
    return fail(
      `PR #${pr} conflicts with origin/main in ${files.length} file(s):`,
      ...files.map((file) => `  ${file}`),
      "Fix: merge main into the branch, resolve the conflicts, push, wait for CI, then run `pnpm queue` again.",
    );
  }

  const drift = seam.check("drift", head);
  if (drift.status !== 0) {
    return fail(drift.output.trimEnd(), "Fix: merge main, rename the migration so it sorts after main's latest, push, wait for CI, then run `pnpm queue` again.");
  }
  const immutable = seam.check("immutable", head);
  if (immutable.status !== 0) {
    return fail(immutable.output.trimEnd(), "Fix: merge main, rename the migration so it sorts after main's latest (an existing migration is never edited), push, wait for CI, then run `pnpm queue` again.");
  }

  // Main's newest checks on the merge of the PR and main (RP-1171): the queue runs them on that merge, and PR #496
  // dropped from it on checks that landed on main while it was queued.
  // Extension point (RP-1172): the open-PR overlap finder (scripts/check-claims.ts) can be called here, to push a
  // warning on `warnings`; it must not refuse.
  let onMerge: MergeChecksResult;
  try {
    onMerge = seam.mergeChecks(merge.output, head);
  } catch (error) {
    return fail(
      `PR #${pr}: could not run main's checks on the merge of the PR and main: ${errorText(error)}`,
      "Fix: check that git can add a worktree in the temp folder (disk space, long paths: `git config core.longpaths true`), then run `pnpm queue` again.",
    );
  }
  if (!onMerge.ok) {
    return fail(
      `PR #${pr} fails ${onMerge.failures.length === 1 ? "a check" : "checks"} of origin/main on the merge of the PR and main, the merge the queue would test:`,
      ...onMerge.failures.flatMap(({ name, lines }) => [`  ${name}:`, ...lines.map((line) => `    ${line}`)]),
      "Fix: merge main into the branch, fix what the checks name, push, wait for CI, then run `pnpm queue` again.",
    );
  }
  if (onMerge.skipped.length > 0) warnings.push(`Warning: not run on the merge (the file is not there yet): ${onMerge.skipped.join(", ")}.`);

  return { kind: "ready", id: pull.id, head, warnings, first: [...first], labelRunPending, verify, ciPending };
}

const POLL_MS = 60_000;

/** How long a required check may stay unreported on the head (a workflow that never starts) before the wait gives up. */
const UNREPORTED_MS = 15 * 60_000;

/** How long the whole check wait may take: a run stuck queued or in progress ends it, named, rather than looping forever. */
const TOTAL_WAIT_MS = 60 * 60_000;

/** A gh call that fails mid-wait is tried this many times in all, RETRY_MS apart, before the wait fails naming it. */
const TRIES = 3;
const RETRY_MS = 10_000;

/** Conclusions the ruleset counts as passing; a skipped required check passes (see merge-queue.test.ts). */
const PASSING = ["success", "skipped", "neutral"];

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string;
}

export interface CommitStatus {
  context: string;
  /** error, failure, pending or success. */
  state: string;
}

/** A commit status as a check run, so the ruleset's required checks are read one way whichever kind reports them. */
export const statusAsRun = ({ context, state }: CommitStatus): CheckRun =>
  state === "pending" ? { name: context, status: "in_progress", conclusion: "" } : { name: context, status: "completed", conclusion: state };

/**
 * Sorts the ruleset's required checks by the head's check runs (and commit statuses, as runs):
 * `failed` names each failed one with its conclusion; `pending` names each not finished, whether
 * running or not reported at all ("1 expected"); `unreported` is the part of `pending` with no run yet.
 */
export function requiredCheckState(required: string[], runs: CheckRun[]): { failed: string[]; pending: string[]; unreported: string[] } {
  const failed: string[] = [];
  const pending: string[] = [];
  const unreported: string[] = [];
  for (const name of required) {
    const run = runs.find((candidate) => candidate.name === name);
    if (run === undefined) {
      pending.push(name);
      unreported.push(name);
    } else if (run.status !== "completed") pending.push(name);
    else if (!PASSING.includes(run.conclusion)) failed.push(`${name} (${run.conclusion})`);
  }
  return { failed, pending, unreported };
}

/** `call` tried up to TRIES times, RETRY_MS apart: its answer, or the gh_failed result naming `what`. */
async function retried<T>(pr: number, what: string, call: () => T, sleep: (ms: number) => Promise<void>): Promise<{ ok: true; value: T } | { ok: false; result: QueueResult }> {
  for (let tries = 1; ; tries++) {
    try {
      return { ok: true, value: call() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (tries >= TRIES) {
        return {
          ok: false,
          result: failFor("gh_failed", `PR #${pr}: reading ${what} failed ${TRIES} times while waiting: ${message.trim()}`, "Fix: check `gh auth status` and GitHub's status page, then run `pnpm queue " + pr + " --wait` again."),
        };
      }
      await sleep(RETRY_MS);
    }
  }
}

export interface WaitOptions {
  noReview?: boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds; only differences are used. */
  now?: () => number;
  /** Progress lines while waiting. */
  log?: (line: string) => void;
}

const realSleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * `pnpm queue <n> --wait` (RP-967): the same refusals as `queuePr`, then waits for the main ruleset's
 * required checks on the PR's head to finish before enqueueing, so a call made right after
 * `gh pr create` is not refused with "N of N required status checks have not succeeded: 1 expected".
 * Fails only when a required check fails (naming it) or never reports on the head.
 */
export async function queuePrWhenChecksPass(pr: number, seam: QueueSeam, options: WaitOptions = {}): Promise<QueueResult> {
  const prepared = prepare(pr, seam, { ...options, waitForLabelRun: true });
  if (prepared.kind === "refused") return prepared.result;
  // RP-1113: the lines that go first are logged before the wait's progress lines, and lead any refusal while waiting.
  for (const line of prepared.first) options.log?.(line);
  const result = await waitThenEnqueue(pr, seam, { ...prepared, warnings: prepared.warnings.filter((line) => !prepared.first.includes(line)) }, options);
  return result.ok || prepared.first.length === 0 ? result : { ...result, lines: [...prepared.first, ...result.lines] };
}

async function waitThenEnqueue(pr: number, seam: QueueSeam, prepared: Extract<Prepared, { kind: "ready" }>, options: WaitOptions): Promise<QueueResult> {
  const { sleep = realSleep, now = Date.now, log = () => {} } = options;
  const { head } = prepared;
  const required = seam.requiredChecks();
  const started = now();
  let labelPending = prepared.labelRunPending;
  let ciPending = prepared.ciPending;
  // When CI turned green: the verify-gate check ran at the push and is re-run after CI (by reviewed-add), so its early failure is excused for a while.
  let ciGreenAt = ciPending ? undefined : started;
  let last = "";
  let lastCi = "";
  for (;;) {
    // A push while waiting: these checks are no longer about what would be queued.
    const pull = await retried(pr, "the PR's head", () => seam.pullRequest(pr), sleep);
    if (!pull.ok) return pull.result;
    if (pull.value.headRefOid !== head) return headMoved(pr, head, pull.value.headRefOid);

    let labelNone = false;
    if (labelPending) {
      const runs = await retried(pr, "the head's reviewed-label runs", () => seam.labelRuns(head), sleep);
      if (!runs.ok) return runs.result;
      const label = labelRunState(pr, head, runs.value);
      if (label.state === "failed") return label.result;
      labelPending = label.state === "pending";
      labelNone = label.state === "pending" && label.none;
    }
    if (ciPending && prepared.verify) {
      const ciRuns = await retried(pr, "the head's CI runs", () => seam.ciRuns(head), sleep);
      if (!ciRuns.ok) return ciRuns.result;
      const ci = verifyState(pr, head, seam, prepared.verify, { required, runs: ciRuns.value });
      if (ci.state === "refused") return ci.result;
      if (ci.state === "running") {
        const line = `${ciRunningLine(head, ci.left)}.`;
        if (line !== lastCi) log(line);
        lastCi = line;
      } else {
        ciPending = false;
        ciGreenAt = now();
      }
    }
    const runs = await retried(pr, "the head's check runs", () => seam.checkRuns(head), sleep);
    if (!runs.ok) return runs.result;
    const statuses = await retried(pr, "the head's commit statuses", () => seam.commitStatuses(head), sleep);
    if (!statuses.ok) return statuses.result;
    const checks = requiredCheckState(required, [...runs.value, ...statuses.value.map(statusAsRun)]);
    const { unreported } = checks;
    let { failed, pending } = checks;
    // verify-gate failed at the push because CI had not finished: wait for its re-run rather than fail.
    const verifyExcused = prepared.verify !== undefined && (ciPending || (ciGreenAt !== undefined && now() - ciGreenAt < UNREPORTED_MS));
    if (verifyExcused && failed.some((entry) => entry.startsWith(`${VERIFY_CHECK} (`))) {
      failed = failed.filter((entry) => !entry.startsWith(`${VERIFY_CHECK} (`));
      pending = [...pending, VERIFY_CHECK];
    }
    if (failed.length > 0) {
      return fail(`PR #${pr}: required check(s) failed on ${head}: ${failed.join(", ")}.`, `Fix: open the failing run from the PR's Checks tab, fix it and push (or re-run a flaky job), then run \`pnpm queue ${pr} --wait\` again.`);
    }
    if (pending.length === 0 && !labelPending && !ciPending) break;
    const waited = now() - started;
    if (labelNone && waited >= UNREPORTED_MS) {
      return fail(`PR #${pr}: no reviewed-label run reported on ${head} in ${UNREPORTED_MS / 60_000} min, so the '${REVIEWED_LABEL}' label may be left over from an earlier head.${NO_LABEL_RUN}`);
    }
    if (unreported.length > 0 && waited >= UNREPORTED_MS) {
      return fail(
        `PR #${pr}: required check(s) never reported on ${head} in ${UNREPORTED_MS / 60_000} min: ${unreported.join(", ")}.`,
        "Fix: check that the workflow runs on this PR (its Checks tab, a path filter, a merge conflict that stops pull_request runs), then run `pnpm queue " + pr + " --wait` again.",
      );
    }
    if (waited >= TOTAL_WAIT_MS) {
      const all = [...runs.value, ...statuses.value.map(statusAsRun)];
      const stuck = pending.map((name) => `${name} (${all.find((run) => run.name === name)?.status ?? "not reported"})`);
      if (labelPending) stuck.push("the reviewed-label run");
      return failFor(
        "checks_timeout",
        `PR #${pr}: still waiting on ${head} after ${TOTAL_WAIT_MS / 60_000} min: ${stuck.join(", ")}.`,
        "Fix: open the PR's Checks tab; re-run or cancel a stuck run, then run `pnpm queue " + pr + " --wait` again.",
      );
    }
    const line = `Waiting for required checks on ${head}: ${[...pending, ...(labelPending ? ["the reviewed-label run"] : []), ...(ciPending && pending.length === 0 ? ["the CI run"] : [])].join(", ")}.`;
    if (line !== last) log(line);
    last = line;
    await sleep(POLL_MS);
  }
  return enqueueAt(pr, seam, prepared);
}

const REMOVAL_TEXT: Record<RemovalKind, string> = {
  failed: "a check failed in the queue's CI run (the PR's own checks can still be green): read the queue run's failing job, merge main, fix it, push",
  conflict: "it conflicts with main or a PR ahead of it: merge main, resolve the conflicts, push",
  merged: "it was already merged",
  manual: "a person removed it on purpose",
  other: "open the PR timeline for the reason",
};

/** Polls (GraphQL `state`, `isInMergeQueue`) until the PR merges (ok) or leaves the queue or closes (not ok, with the reason). */
export async function waitForMerge(pr: number, seam: QueueSeam, since: Date, sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))): Promise<QueueResult> {
  const { id } = seam.pullRequest(pr);
  let outside = 0;
  for (;;) {
    const read = await retried(pr, "the PR's queue state", () => seam.status(id), sleep);
    if (!read.ok) return read.result;
    const { state, isInMergeQueue } = read.value;
    if (state === "MERGED") return { ok: true, lines: [`PR #${pr} merged.`] };
    if (state === "CLOSED") return fail(`PR #${pr} was closed without merging.`);
    // One poll outside the queue can be the merge landing; two in a row is a removal.
    outside = isInMergeQueue ? 0 : outside + 1;
    if (outside >= 2) {
      const reason = seam.removalReason(id, since) ?? "unknown";
      return fail(`PR #${pr} left the merge queue (reason: ${reason}): ${REMOVAL_TEXT[classify(reason)]}, then run \`pnpm queue ${pr} --wait\` again.`);
    }
    await sleep(POLL_MS);
  }
}

const mutation = "mutation($id: ID!, $head: GitObjectID!) { enqueuePullRequest(input: {pullRequestId: $id, expectedHeadOid: $head}) { mergeQueueEntry { position state } } }";

/** The real git and gh calls. No shell is involved, so the caller needs no quoting tricks. */
export function realSeam(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): QueueSeam {
  const run = (command: string, args: string[]) => {
    const done = spawn(command, args, { cwd, encoding: "utf8" });
    return { status: done.status ?? 128, output: `${done.stdout ?? ""}${done.stderr ?? ""}`, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
  };
  const must = (command: string, args: string[]) => {
    const done = run(command, args);
    if (done.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed:\n${done.output}`);
    return done.stdout;
  };
  const script = (name: string, args: string[]) => run(process.execPath, [join(import.meta.dirname, name), ...args]);
  const graphql = (query: string, variables: Record<string, string>) =>
    JSON.parse(must("gh", ["api", "graphql", "-f", `query=${query}`, ...Object.entries(variables).flatMap(([name, value]) => ["-F", `${name}=${value}`])])) as { data: Record<string, unknown> & { node: Record<string, unknown> } };
  return {
    ...realGit(cwd, spawn),
    fetchMain: () => run("git", ["fetch", "origin", "main"]).status === 0,
    fetchPull: (pr) => {
      must("git", ["fetch", "origin", `refs/pull/${pr}/head`]);
      return must("git", ["rev-parse", "FETCH_HEAD"]).trim();
    },
    head: () => must("git", ["rev-parse", "HEAD"]).trim(),
    branch: () => must("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    isAncestor: (ancestor, commit) => isAncestor(ancestor, commit, cwd, spawn),
    pullRequest: (pr) => JSON.parse(must("gh", ["pr", "view", String(pr), "--json", "id,headRefOid,headRefName"])) as { id: string; headRefOid: string; headRefName: string },
    mergeTree: (commit) => run("git", ["merge-tree", "--write-tree", "origin/main", commit]),
    changedFiles: (commit) =>
      // --no-renames lists a rename's old path too, so code renamed to .md is not a docs-only change (RP-606).
      must("git", ["diff", "--name-only", "--no-renames", `origin/main...${commit}`])
        .split("\n")
        .filter(Boolean),
    // changedFiles diffs against the merge base (three dots), so `before` is read there, not at main's tip.
    packageJsonVersions: packageJsonVersionsVia(cwd, spawn),
    check: (name, commit) => (name === "drift" ? script("check-migration-drift.ts", ["origin/main", commit]) : script("check-migrations-immutable.ts", ["origin/main", commit])),
    mergeChecks: (mergeOutput, head) => {
      const tree = mergeTreeOid(mergeOutput);
      if (tree === undefined) throw new Error(`git merge-tree answered no tree for ${head}:\n${mergeOutput}`);
      return runMergeChecks(tree, head, realMergeChecksSeam(cwd, spawn));
    },
    labels: (pr) => (JSON.parse(must("gh", ["pr", "view", String(pr), "--json", "labels"])) as { labels: { name: string }[] }).labels.map((label) => label.name),
    body: (pr) => (JSON.parse(must("gh", ["pr", "view", String(pr), "--json", "body"])) as { body: string | null }).body ?? "",
    comments: (pr) =>
      must("gh", ["api", "--paginate", `repos/{owner}/{repo}/issues/${pr}/comments?per_page=100`, "--jq", '.[] | {login: (.user.login // ""), type: (.user.type // ""), body: (.body // "")}'])
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as ReviewComment),
    // Any gh error throws: a permission it cannot read never counts as a writer's.
    permission: (login) => must("gh", ["api", `repos/{owner}/{repo}/collaborators/${encodeURIComponent(login)}/permission`, "--jq", ".permission"]).trim() as Permission,
    // Absent only when origin/main lacks it; a git error throws rather than skip the label check (RP-1196).
    labelWorkflowOnMain: () => fileAtVia(cwd, spawn)("origin/main", ".github/workflows/reviewed-label.yml") !== undefined,
    labelRuns: (commit) => JSON.parse(must("gh", ["run", "list", "--workflow", "reviewed-label.yml", "--commit", commit, "--json", "status,conclusion"])) as { status: string; conclusion: string }[],
    status: (id) => graphql("query($id: ID!) { node(id: $id) { ... on PullRequest { state isInMergeQueue } } }", { id }).data.node as unknown as PullStatus,
    removalReason: (id, since) => {
      const node = graphql("query($id: ID!) { node(id: $id) { ... on PullRequest { timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) { nodes { ... on RemovedFromMergeQueueEvent { reason createdAt } } } } } }", { id }).data.node as {
        timelineItems?: { nodes?: { reason?: string; createdAt?: string }[] };
      };
      const latest = node.timelineItems?.nodes?.[0];
      // An older removal (an earlier queue attempt) is not why this wait ended.
      return latest?.createdAt !== undefined && Date.parse(latest.createdAt) >= since.getTime() ? latest.reason : undefined;
    },
    // --jq prints one item per line, so --paginate's pages simply concatenate.
    requiredChecks: () =>
      must("gh", ["api", "--paginate", "repos/{owner}/{repo}/rules/branches/main", "--jq", '.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context'])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ciRuns: (commit) => {
      const api = (path: string) => JSON.parse(must("gh", ["api", `repos/{owner}/{repo}/${path}`])) as unknown;
      return runsFrom(api(ciRunsPath(commit))).map((each) => ciRunFrom(each, api(ciJobsPath(each.id))));
    },
    // The endpoint's default filter is "latest": one run per name, the newest (a re-run replaces a failure).
    checkRuns: (commit) =>
      must("gh", ["api", "--paginate", `repos/{owner}/{repo}/commits/${commit}/check-runs?per_page=100`, "--jq", '.check_runs[] | {name, status, conclusion: (.conclusion // "")}'])
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as CheckRun),
    // The combined status: the latest state of each context.
    commitStatuses: (commit) =>
      must("gh", ["api", "--paginate", `repos/{owner}/{repo}/commits/${commit}/status?per_page=100`, "--jq", ".statuses[] | {context, state}"])
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as CommitStatus),
    enqueue: (id, head) => {
      const answer = graphql(mutation, { id, head }).data as unknown as { enqueuePullRequest: { mergeQueueEntry: { position: number; state: string } } };
      return answer.enqueuePullRequest.mergeQueueEntry;
    },
  };
}

function print(result: QueueResult): QueueResult {
  for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  return result;
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const args = process.argv.slice(2);
  const wait = args.includes("--wait");
  const pr = Number(args.find((arg) => !arg.startsWith("--")));
  if (!Number.isInteger(pr) || pr <= 0) {
    console.error("Usage: pnpm queue <pr number> [--wait] [--no-review] [--keep-stack]");
    process.exit(2);
  }
  try {
    const seam = realSeam();
    const started = new Date();
    const noReview = args.includes("--no-review");
    let result = print(wait ? await queuePrWhenChecksPass(pr, seam, { noReview, log: (line) => console.log(line) }) : queuePr(pr, seam, { noReview }));
    // RP-1170: queued, so the lane's stack is idle; stopping it frees a Docker slot (its volumes stay). Never fails the queue.
    for (const line of stopAfterEnqueue({ ok: result.ok, args, read: () => realStopInput(pr, seam.pullRequest(pr).headRefName) })) console.log(line);
    if (result.ok && wait) {
      console.log(`Waiting for PR #${pr} to merge (polling every ${POLL_MS / 1000} s)...`);
      result = print(await waitForMerge(pr, seam, started));
    }
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
