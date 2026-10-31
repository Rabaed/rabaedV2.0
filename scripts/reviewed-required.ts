import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
// the script that checks it), on pull_request (opened, reopened, synchronize, labeled, unlabeled,
// ready_for_review, converted_to_draft) and on merge_group, as one job name in both so the merge
// queue runs it too. A draft PR passes with a note and is checked when marked ready (RP-1018: a
// check red until the final review woke Auto-fix about 15 times on one draft; a draft cannot be
// queued, but a queued PR turned back to draft stays in the queue). In the queue the PR number
// comes from the queue ref, gh-readonly-queue/main/pr-<n>-<sha>, and the labels, the draft flag
// and the issue events are read live.
//
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH.

/** The check's name, as the main ruleset requires it (the job's `name:` in reviewed-required.yml). */
export const REQUIRED_CHECK = "reviewed-required";

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
  /** The `reviewed-label` workflow's pull_request runs for `headSha`; undefined when that workflow does not exist. */
  labelRuns(headSha: string): Promise<{ status: string }[] | undefined>;
  sleep(ms: number): Promise<void>;
}

export type RequiredEvent = { kind: "merge_group"; headRef: string } | { kind: "pull_request"; pr: number; headSha: string; sameRepo: boolean; draft: boolean };

export interface RequiredResult {
  ok: boolean;
  summary: string;
}

export async function requireReviewed(event: RequiredEvent, seam: RequiredSeam, options: { pollMs?: number; timeoutMs?: number } = {}): Promise<RequiredResult> {
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
  // GitHub can list a label a few seconds before its event: judge nothing then, and say so.
  if (lagging) {
    return {
      ok: false,
      summary: `PR #${pr} has the '${REVIEWED_LABEL}' label, but GitHub's issue events have not caught up with it (the newest '${REVIEWED_LABEL}' event is not the label being added), so who added it cannot be told yet. Re-run this check in a minute.`,
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

const isSwitch = (event: PrEvent) => event.event === "auto_merge_enabled" || event.event === "auto_merge_disabled";

/**
 * Whether auto-merge was on when the PR last entered the merge queue: the newest `auto_merge_enabled` or
 * `auto_merge_disabled` before its newest `added_to_merge_queue` is an enable. `pnpm queue` never turns auto-merge on,
 * so a PR it queued after auto-merge was turned off again passes. A switch in the same second as the entry counts as
 * before it, whichever GitHub lists first: an enable then caused the entry. While GitHub lists no entry yet, the newest
 * switch of all decides, so a missing event fails closed.
 */
export function enteredQueueByAutoMerge(events: PrEvent[]): boolean {
  const entered = events.findLastIndex((event) => event.event === "added_to_merge_queue");
  if (entered === -1) return events.findLast(isSwitch)?.event === "auto_merge_enabled";
  const second = events[entered]?.createdAt;
  const sameSecond = events.slice(entered + 1).filter((event) => isSwitch(event) && event.createdAt === second);
  return [...events.slice(0, entered), ...sameSecond].findLast(isSwitch)?.event === "auto_merge_enabled";
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
  if (eventName === "pull_request" && event.pull_request) {
    const { number, draft, head } = event.pull_request;
    return { kind: "pull_request", pr: number, headSha: head.sha, sameRepo: head.repo?.full_name === repository, draft: draft === true };
  }
  throw new Error(`reviewed-required runs on pull_request and merge_group, not ${eventName}`);
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
      const runs = (await get(`actions/workflows/reviewed-label.yml/runs?head_sha=${headSha}&event=pull_request`, true)) as { workflow_runs: { status: string }[] } | undefined;
      return runs?.workflow_runs.map((run) => ({ status: run.status }));
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
  const result = await requireReviewed(event, { ...overHttp(repository, token), sleep });
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
