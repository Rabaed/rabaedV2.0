import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { REVIEWED_LABEL } from "./reviewed-label.ts";

// The `reviewed-required` check (RP-606), a required check on the main ruleset: it fails while a
// PR has neither the `reviewed` label (a finished /code-review at this head, RP-584) nor the
// `docs-only` label on a PR that changes only docs. Without it, a merge started from GitHub skipped
// the rule `pnpm queue` applies (PR #225 and #229 merged unreviewed). Both apply `reviewGate`.
// Since RP-1167 the check also reads the PR's issue events: `reviewed` counts only when CI's
// reviewed-add (github-actions[bot]) added it last, since every session acts as one GitHub
// login and a hand label proves no review. It also fails while GitHub auto-merge is on, so only
// `pnpm queue` enqueues. In the merge queue it also drops a PR that is a draft now, or that
// entered the queue while auto-merge was on (#564: both, and it still merged).
//
// Run by .github/workflows/reviewed-required.yml, from the default branch's copy (a PR cannot edit
// the script that checks it), on pull_request_target (opened, reopened, synchronize, labeled,
// unlabeled, ready_for_review, converted_to_draft; pull_request until RP-1148 part A's workflow PR)
// and on merge_group, as one job name in both so the merge queue runs it too. On pull_request_target
// GitHub runs main's copy of the workflow file as well, so a PR cannot edit what judges it there;
// under merge_group it runs the merge commit's copy. On both it names the gate's own files a PR
// changes (`isGatePath`, RP-1148). A draft PR passes with a note and is checked when marked ready (RP-1018: a
// check red until the final review woke Auto-fix about 15 times on one draft; a draft cannot be
// queued, but a queued PR turned back to draft stays in the queue). In the queue the PR number
// comes from the queue ref, gh-readonly-queue/main/pr-<n>-<sha>, and the labels, the draft flag
// and the issue events are read live.
//
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH.

/** The check's name, as the main ruleset requires it (the job's `name:` in reviewed-required.yml). */
export const REQUIRED_CHECK = "reviewed-required";

// The merge gate's own files (RP-1148 part A): the workflows GitHub runs, and the scripts that decide
// `reviewed-required`, `verify-gate` and the `reviewed` label. A PR that changes one changes what judges
// PRs, so it needs the owner's approval, which RP-1148 part B is to define (a separate GitHub identity
// for sessions, or a marker only the owner can post). Until then this check names such paths in a
// warning and passes. It blocks once GATE_PATHS_BLOCK is true on main: the check runs main's copy of
// this file, so a PR cannot turn it off for itself.

/**
 * Whether the check fails a PR that changes a gate path. Off: blocking before part B is the owner's
 * option 3 (the owner merges such PRs from the GitHub page), which the owner hasn't chosen (RP-1148
 * comment 15414).
 */
export const GATE_PATHS_BLOCK = false;

/** The scripts the gate's workflows run, and review-post.ts; `scripts/reviewed-*.ts` is matched on its own too. */
export const GATE_ENTRY_SCRIPTS: readonly string[] = [
  "scripts/reviewed-required.ts",
  "scripts/reviewed-add.ts",
  "scripts/reviewed-label.ts",
  "scripts/verify-gate.ts",
  "scripts/ci-green.ts",
  "scripts/review-post.ts",
];

/** A relative import: `from "./x.ts"` (on one line or after several), `import "./x.ts"` or `import("./x.ts")`, either quote. */
const LOCAL_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}\/[^"'\n]+)\1/g;

/**
 * The gate's scripts (Main 6 on #617): the entry scripts and every file they import, all the way down, by
 * relative import. `read` gives a file's text, undefined when it is not there. The check reads it from its own
 * checkout, the default branch's, so a PR is judged by main's imports.
 */
export function gateScripts(read: (path: string) => string | undefined, entries: readonly string[] = GATE_ENTRY_SCRIPTS): string[] {
  const found = new Set<string>();
  const queue = [...entries];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (found.has(path)) continue;
    const text = read(path);
    if (text === undefined) continue;
    found.add(path);
    for (const [, , specifier] of text.matchAll(LOCAL_IMPORT)) queue.push(posix.normalize(posix.join(posix.dirname(path), specifier!)));
  }
  return [...found];
}

/** Whether `file` is one of the gate's own files: `.github/workflows/**`, `scripts/reviewed-*.ts`, or one of `scripts` (the gate's scripts, `gateScripts`). */
export function isGatePath(file: string, scripts: ReadonlySet<string> = new Set(GATE_ENTRY_SCRIPTS)): boolean {
  return file.startsWith(".github/workflows/") || /^scripts\/reviewed-[^/]*\.ts$/.test(file) || scripts.has(file);
}

/** The gate paths among `files`, each once, in the order they come. */
export const gatePathsIn = (files: string[], scripts?: ReadonlySet<string>): string[] => [...new Set(files.filter((file) => isGatePath(file, scripts)))];

/** The label that lets a PR changing only docs merge without a /code-review (RP-606). */
export const DOCS_ONLY_LABEL = "docs-only";

/** A doc, as rule 3 of planning/parallel-sessions.md counts one: under docs/ or a Markdown file. */
export const isDoc = (file: string) => file.startsWith("docs/") || file.endsWith(".md");

export type ReviewGate = { ok: true; via: typeof REVIEWED_LABEL | typeof DOCS_ONLY_LABEL } | { ok: false; reason: string };

/**
 * The one rule both the `reviewed-required` check and `pnpm queue` apply (RP-606): a PR merges
 * with the `reviewed` label, or with the `docs-only` label when every file it changes is a doc.
 * `changedFiles` is undefined when the list is not known (it is only needed for `docs-only`).
 */
export function reviewGate(labels: string[], changedFiles: string[] | undefined): ReviewGate {
  if (labels.includes(REVIEWED_LABEL)) return { ok: true, via: REVIEWED_LABEL };
  if (!labels.includes(DOCS_ONLY_LABEL)) return { ok: false, reason: `no '${REVIEWED_LABEL}' label (and no '${DOCS_ONLY_LABEL}' label)` };
  if (changedFiles === undefined) return { ok: false, reason: `the '${DOCS_ONLY_LABEL}' label is there, but the changed files could not be listed to confirm it` };
  const code = changedFiles.filter((file) => !isDoc(file));
  if (code.length > 0) return { ok: false, reason: `the '${DOCS_ONLY_LABEL}' label is there, but the PR changes ${code.length} file(s) that are not docs, e.g. ${code[0]}` };
  return { ok: true, via: DOCS_ONLY_LABEL };
}

/** The PR number a merge queue ref names (`refs/heads/gh-readonly-queue/main/pr-<n>-<sha>`); undefined for any other ref. */
export function queuedPrNumber(headRef: string): number | undefined {
  const match = /(?:^|\/)gh-readonly-queue\/[^/]+\/pr-(\d+)-[0-9a-f]+$/.exec(headRef);
  return match?.[1] ? Number(match[1]) : undefined;
}

/**
 * Who CI's reviewed-add workflow labels as (RP-1118): it adds `reviewed` with GITHUB_TOKEN. Every session acts as one
 * GitHub login, so a `reviewed` that anyone else added last does not count (RP-1167): it was added by hand.
 */
export const REVIEWED_ADD_ACTOR = "github-actions[bot]";

/** One of a PR's issue events: what happened (`labeled`, `auto_merge_enabled`, `added_to_merge_queue`, …), the label's name for a label event, who did it, and when (GitHub's `created_at`, to the second). */
export interface PrEvent {
  event: string;
  label?: string;
  actor: string;
  createdAt: string;
}

export interface RequiredSeam {
  /** The PR now (not the event's copy): its labels, how many files it changes, whether it is a draft, and who turned GitHub auto-merge on (absent when off). */
  pull(pr: number): Promise<{ labels: string[]; changedFiles: number; draft?: boolean; autoMergeBy?: string }>;
  /** The paths the PR changes, as far as the API lists them. */
  files(pr: number): Promise<string[]>;
  /** The PR's issue events, oldest first. */
  events(pr: number): Promise<PrEvent[]>;
  /** The `reviewed-label` workflow's pull_request_target and pull_request runs for `headSha`; undefined when that workflow does not exist. */
  labelRuns(headSha: string): Promise<{ status: string }[] | undefined>;
  sleep(ms: number): Promise<void>;
}

export type RequiredEvent = { kind: "merge_group"; headRef: string } | { kind: "pull_request"; pr: number; headSha: string; sameRepo: boolean; draft: boolean };

export interface RequiredResult {
  ok: boolean;
  summary: string;
  /** What the check reports without failing on it: the gate paths a PR changes, while GATE_PATHS_BLOCK is off (RP-1148). */
  warnings: string[];
}

/** One answer per PR for `pull` and `files`, however many times the check asks. */
function readOnce(seam: RequiredSeam): RequiredSeam {
  const pulls = new Map<number, ReturnType<RequiredSeam["pull"]>>();
  const files = new Map<number, ReturnType<RequiredSeam["files"]>>();
  return {
    ...seam,
    pull: (pr) => pulls.get(pr) ?? (pulls.set(pr, seam.pull(pr)), pulls.get(pr)!),
    files: (pr) => files.get(pr) ?? (files.set(pr, seam.files(pr)), files.get(pr)!),
  };
}

/**
 * The check: the review verdict, then the gate-path rule (RP-1148 part A). A PR that changes one of the
 * gate's own files (`isGatePath`) is named in a warning, or fails when `blockGatePaths` is on
 * (GATE_PATHS_BLOCK on main). A draft passes as before and is checked when marked ready.
 */
export async function requireReviewed(
  event: RequiredEvent,
  seam: RequiredSeam,
  options: { pollMs?: number; timeoutMs?: number; blockGatePaths?: boolean; gateScripts?: ReadonlySet<string> } = {},
): Promise<RequiredResult> {
  const { blockGatePaths = GATE_PATHS_BLOCK, gateScripts: scripts, ...waits } = options;
  const once = readOnce(seam);
  const verdict = await reviewVerdict(event, once, waits);
  if (event.kind === "pull_request" && event.draft) return { ...verdict, warnings: [] };
  const pr = event.kind === "merge_group" ? queuedPrNumber(event.headRef) : event.pr;
  if (pr === undefined) return { ...verdict, warnings: [] };
  let listed: string[];
  try {
    listed = await once.files(pr);
  } catch (error) {
    // While the rule only warns, a list GitHub fails to give must not fail the check for it.
    const why = `PR #${pr}: its files could not be listed (${error instanceof Error ? error.message : String(error)}), so whether it changes the merge gate's own files cannot be told`;
    if (blockGatePaths) return { ok: false, summary: `${why}. Re-run this check.`, warnings: [] };
    return { ...verdict, warnings: [`${why}.`] };
  }
  const found = gatePathFinding(pr, (await once.pull(pr)).changedFiles, gatePathsIn(listed, scripts), listed.length, blockGatePaths);
  if (found === undefined) return { ...verdict, warnings: [] };
  if (blockGatePaths && verdict.ok) return { ok: false, summary: found, warnings: [] };
  return { ...verdict, warnings: [found] };
}

/** What the check says of PR `pr`'s gate paths; undefined when it changes none (and all its files are listed). */
function gatePathFinding(pr: number, changedFiles: number, paths: string[], listedCount: number, blocking: boolean): string | undefined {
  // The API stops listing at 3000 files: a gate path may be among those it left out.
  const unlisted = listedCount < changedFiles;
  if (paths.length === 0 && !unlisted) return undefined;
  const what =
    paths.length > 0
      ? `PR #${pr} changes the merge gate's own files: ${paths.join(", ")}`
      : `PR #${pr} changes ${changedFiles} files, more than GitHub lists (${listedCount}), so whether it changes the merge gate's own files cannot be told`;
  return blocking
    ? `${what}. Only the owner may merge such a PR, by bypassing the main ruleset from the GitHub page (RP-1148).`
    : `${what}. They decide what judges every PR, so a reviewer checks them closely; until RP-1148 part B the check only warns (GATE_PATHS_BLOCK in scripts/reviewed-required.ts).`;
}

async function reviewVerdict(event: RequiredEvent, seam: RequiredSeam, options: { pollMs?: number; timeoutMs?: number }): Promise<Omit<RequiredResult, "warnings">> {
  let pr: number;
  if (event.kind === "merge_group") {
    const queued = queuedPrNumber(event.headRef);
    if (queued === undefined) return { ok: false, summary: `The merge queue ref ${event.headRef} names no PR (expected gh-readonly-queue/<branch>/pr-<n>-<sha>).` };
    pr = queued;
  } else pr = event.pr;
  // A draft passes (RP-1018, see the header); ready_for_review runs this check again.
  if (event.kind === "pull_request" && event.draft) return { ok: true, summary: `PR #${pr} is a draft: checked when marked ready.` };
  // On a PR, the reviewed-label run for this head may still be about to remove the label. It removes
  // it with GITHUB_TOKEN, which starts no `unlabeled` run, so this run waits and reads what it left.
  // A fork's PR gets no such run. In the queue the head cannot change, so there is nothing to wait for.
  if (event.kind === "pull_request" && event.sameRepo) {
    // 1500 s: on a busy CI the run waited past 600 s for a runner (RP-984); reviewed-required.yml's timeout-minutes stays above it (30).
    const { pollMs = 10_000, timeoutMs = 1_500_000 } = options;
    for (let waited = 0; ; waited += pollMs) {
      const runs = await seam.labelRuns(event.headSha);
      if (runs === undefined || (runs.length > 0 && runs.every((run) => run.status === "completed"))) break;
      if (waited >= timeoutMs) {
        return {
          ok: false,
          summary: `PR #${pr}: the reviewed-label run for ${event.headSha} did not finish within ${timeoutMs / 1000} s, so its label cannot be trusted. Re-run this check once it has; a PR with no run at all gets one when origin/main is merged in and pushed.`,
        };
      }
      await seam.sleep(pollMs);
    }
  }
  const pull = await seam.pull(pr);
  let read: PrEvent[] | undefined;
  const events = async () => (read ??= await seam.events(pr));
  if (event.kind === "merge_group") {
    // A draft stays in the queue: #564 was turned back to draft while queued and still merged (2026-10-31).
    if (pull.draft === true) return { ok: false, summary: `PR #${pr} is a draft, so it must not merge: turning a PR back to draft does not take it out of the merge queue. Mark it ready and queue it again with \`pnpm queue ${pr}\`.` };
    // Auto-merge may already be off again once it has queued the PR (#564), so how the PR entered the queue decides.
    if (enteredQueueByAutoMerge(await events())) {
      return {
        ok: false,
        summary: `PR #${pr} entered the merge queue through GitHub auto-merge, not \`pnpm queue\` (RP-1167), so it is out of order. Turn auto-merge off (\`gh pr merge ${pr} --disable-auto\`) if it is still on, then queue it with \`pnpm queue ${pr}\`.`,
      };
    }
  }
  // Auto-merge enqueues the PR the moment it is eligible, in no one's order (#531 went in ahead of #529 on
  // 2026-10-30); only `pnpm queue` enqueues, and it never turns auto-merge on. In the queue this also catches
  // auto-merge turned on after a `pnpm queue` entry, which the entry check above lets through.
  if (pull.autoMergeBy !== undefined) {
    return {
      ok: false,
      summary: `PR #${pr}: GitHub auto-merge is on (turned on by ${pull.autoMergeBy}), so GitHub would enqueue it out of order (RP-1167). Turn it off with \`gh pr merge ${pr} --disable-auto\`, re-run this check (turning it off starts no run of it), then queue it with \`pnpm queue ${pr}\`.`,
    };
  }
  const { labels, handLabeler, lagging } = pull.labels.includes(REVIEWED_LABEL) ? countedLabels(pull.labels, await events()) : { labels: pull.labels };
  const needsFiles = !labels.includes(REVIEWED_LABEL) && labels.includes(DOCS_ONLY_LABEL);
  let files: string[] | undefined;
  if (needsFiles) {
    const listed = await seam.files(pr);
    // The API stops listing at 3000 files; a list shorter than the count cannot confirm docs-only.
    files = listed.length >= pull.changedFiles ? listed : undefined;
  }
  const gate = reviewGate(labels, files);
  if (gate.ok) return { ok: true, summary: `PR #${pr} has the '${gate.via}' label${gate.via === DOCS_ONLY_LABEL ? " and changes only docs" : ""}: passes.` };
  // GitHub can list a label a few seconds before its event: judge nothing then, and say so. (A hand remove-and-re-add
  // not listed yet still reads as CI's older label on the PR run; the queue's run, reading later, sees it.)
  if (lagging) {
    const retry = event.kind === "merge_group" ? `The queue drops the PR: queue it again in a minute with \`pnpm queue ${pr}\`.` : "Re-run this check in a minute.";
    return {
      ok: false,
      summary: `PR #${pr} has the '${REVIEWED_LABEL}' label, but GitHub's issue events have not caught up with it (the newest '${REVIEWED_LABEL}' event is not the label being added), so who added it cannot be told yet. ${retry}`,
    };
  }
  const reason =
    handLabeler === undefined
      ? gate.reason
      : `the '${REVIEWED_LABEL}' label was last added by ${handLabeler}, not by CI's reviewed-add (${REVIEWED_ADD_ACTOR}), so it does not count: no session labels its own PR (RP-1167). Remove it with \`gh pr edit ${pr} --remove-label ${REVIEWED_LABEL}\``;
  const docsOnly = `A PR that changes only docs takes \`gh pr edit ${pr} --add-label ${DOCS_ONLY_LABEL}\``;
  // reviewed-add skips a fork's PR (the reviewed-label job does too), so no review gets one the label.
  if (event.kind === "pull_request" && !event.sameRepo) return { ok: false, summary: `PR #${pr}: ${reason}. CI's reviewed-add never labels a fork's PR, so only ${DOCS_ONLY_LABEL} can pass it. ${docsOnly}.` };
  return {
    ok: false,
    summary: `PR #${pr}: ${reason}. Run /code-review, push its fixes, post its summary with \`node scripts/review-post.ts ${pr} <summary-file>\` and put the stamped \`pnpm verify\` line in the body: CI's reviewed-add then adds '${REVIEWED_LABEL}' (re-run its last run on the PR if both were already there). ${docsOnly} instead.`,
  };
}

// A dequeue cancels auto-merge with no `auto_merge_disabled` event (#578), so leaving the queue, by a person or the
// queue's own drop, counts as a switch-off. If auto-merge stays on after a drop and queues the PR again, the live
// auto-merge check fails it while GitHub still shows it on, and a switch in the entry's second fails it otherwise.
const isSwitch = (event: PrEvent) => event.event === "auto_merge_enabled" || event.event === "auto_merge_disabled" || event.event === "removed_from_merge_queue";

/**
 * Whether auto-merge was on when the PR last entered the merge queue: the newest `auto_merge_enabled`,
 * `auto_merge_disabled` or `removed_from_merge_queue` before its newest `added_to_merge_queue` is an enable. `pnpm queue`
 * never turns auto-merge on, so a PR it queued after auto-merge was turned off, or after a dequeue, passes (#531 and
 * #564 fail; #563, #565 and #578's second entry pass). An enable or disable in the entry's own second means auto-merge
 * did the enqueue: its enable caused it, or GitHub turned it off as it enqueued (#564's shape); `pnpm queue` takes
 * seconds and switches nothing. While GitHub lists no entry yet, the newest switch of all decides, so a missing event
 * fails closed.
 */
export function enteredQueueByAutoMerge(events: PrEvent[]): boolean {
  const entered = events.findLastIndex((event) => event.event === "added_to_merge_queue");
  if (entered === -1) return events.findLast(isSwitch)?.event === "auto_merge_enabled";
  const second = events[entered]?.createdAt;
  // An auto-merge switch in the entry's own second, listed before or after it, means auto-merge did the enqueue:
  // its enable caused it, or GitHub turned it off as it enqueued (#564's shape).
  if (events.some((event) => (event.event === "auto_merge_enabled" || event.event === "auto_merge_disabled") && event.createdAt === second)) return true;
  return events.slice(0, entered).findLast(isSwitch)?.event === "auto_merge_enabled";
}

/**
 * The labels that count (RP-1167). `reviewed` counts only when the newest `labeled` or `unlabeled` event for it is
 * CI's reviewed-add adding it. When someone else added it, it counts as no label and `handLabeler` names them. When
 * the newest is an `unlabeled`, or there is none, though the label is there, GitHub's events have not caught up:
 * `lagging`, and the label counts as no label.
 */
export function countedLabels(labels: string[], events: PrEvent[]): { labels: string[]; handLabeler?: string; lagging?: true } {
  const newest = events.findLast((event) => event.label === REVIEWED_LABEL && (event.event === "labeled" || event.event === "unlabeled"));
  if (newest?.event === "labeled" && newest.actor === REVIEWED_ADD_ACTOR) return { labels };
  const without = labels.filter((label) => label !== REVIEWED_LABEL);
  return newest?.event === "labeled" ? { labels: without, handLabeler: newest.actor } : { labels: without, lagging: true };
}

/** The event the workflow ran for, from its payload (GITHUB_EVENT_PATH). */
export function requiredEvent(eventName: string, payload: unknown, repository: string): RequiredEvent {
  const event = payload as {
    pull_request?: { number: number; draft?: boolean; head: { sha: string; repo: { full_name: string } | null } };
    merge_group?: { head_ref: string };
  };
  if (eventName === "merge_group" && event.merge_group) return { kind: "merge_group", headRef: event.merge_group.head_ref };
  // pull_request_target has the same payload; GitHub runs main's copy of the workflow for it (RP-1148).
  if ((eventName === "pull_request" || eventName === "pull_request_target") && event.pull_request) {
    const { number, draft, head } = event.pull_request;
    return { kind: "pull_request", pr: number, headSha: head.sha, sameRepo: head.repo?.full_name === repository, draft: draft === true };
  }
  throw new Error(`reviewed-required runs on pull_request_target (or pull_request) and merge_group, not ${eventName}`);
}

const PER_PAGE = 100;
const MAX_PAGES = 30;

export function overHttp(repository: string, token: string, fetcher: typeof fetch = fetch): Omit<RequiredSeam, "sleep"> {
  const get = async (path: string, allow404 = false): Promise<unknown> => {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (allow404 && response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub GET ${path} answered ${response.status}`);
    return response.json();
  };
  return {
    async pull(pr) {
      const pull = (await get(`pulls/${pr}`)) as { labels: { name: string }[]; changed_files: number; draft?: boolean; auto_merge?: { enabled_by: { login: string } | null } | null };
      const autoMergeBy = pull.auto_merge ? (pull.auto_merge.enabled_by?.login ?? "a login GitHub does not name") : undefined;
      return { labels: pull.labels.map((label) => label.name), changedFiles: pull.changed_files, draft: pull.draft === true, ...(autoMergeBy === undefined ? {} : { autoMergeBy }) };
    },
    async events(pr) {
      const events: PrEvent[] = [];
      // The API lists events oldest first. A deleted user shows as no actor; GitHub calls them ghost.
      for (let page = 1; page <= MAX_PAGES; page++) {
        const batch = (await get(`issues/${pr}/events?per_page=${PER_PAGE}&page=${page}`)) as { event: string; label?: { name: string }; actor: { login: string } | null; created_at: string }[];
        events.push(...batch.map(({ event, label, actor, created_at }) => ({ event, ...(label ? { label: label.name } : {}), actor: actor?.login ?? "ghost", createdAt: created_at })));
        if (batch.length < PER_PAGE) return events;
      }
      // Past the last page the newest events may be missing, so the last one read proves nothing.
      throw new Error(`PR #${pr} has more than ${MAX_PAGES * PER_PAGE} issue events; reviewed-required cannot read its newest ones`);
    },
    async files(pr) {
      const files: string[] = [];
      // MAX_PAGES of PER_PAGE is the API's 3000-file limit.
      for (let page = 1; page <= MAX_PAGES; page++) {
        const batch = (await get(`pulls/${pr}/files?per_page=${PER_PAGE}&page=${page}`)) as { filename: string; previous_filename?: string }[];
        // A rename's old path counts too: code renamed to .md is still a code change.
        files.push(...batch.flatMap((file) => (file.previous_filename ? [file.filename, file.previous_filename] : [file.filename])));
        if (batch.length < PER_PAGE) break;
      }
      return files;
    },
    async labelRuns(headSha) {
      // reviewed-label runs on pull_request_target from RP-1148 part A's workflow PR (main's copy, so a PR can't make
      // it keep a stale label), on pull_request before it: both count. Undefined only when the workflow is not there.
      const answers = await Promise.all(
        ["pull_request_target", "pull_request"].map(
          async (event) => (await get(`actions/workflows/reviewed-label.yml/runs?head_sha=${headSha}&event=${event}`, true)) as { workflow_runs: { status: string }[] } | undefined,
        ),
      );
      if (answers.every((answer) => answer === undefined)) return undefined;
      return answers.flatMap((answer) => answer?.workflow_runs ?? []).map((run) => ({ status: run.status }));
    },
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!token || !repository || !eventName) throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_NAME must be set");
  const event = requiredEvent(eventName, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")), repository);
  const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  // The gate's scripts as this checkout (the default branch's) imports them.
  const scripts = new Set(gateScripts((path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined)));
  const result = await requireReviewed(event, { ...overHttp(repository, token), sleep }, { gateScripts: scripts });
  (result.ok ? console.log : console.error)(result.summary);
  // An annotation on the run, and a line of its summary, for each warning (RP-1148: the gate paths a PR changes).
  for (const warning of result.warnings) console.log(`::warning title=Merge gate files::${warning.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
  // A blank line after each, so Markdown keeps the warnings apart from the verdict.
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [result.summary, ...result.warnings.map((w) => `**Warning:** ${w}`)].map((line) => `${line}\n\n`).join(""));
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
