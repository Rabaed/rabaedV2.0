import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REVIEWED_LABEL } from "./reviewed-label.ts";

// The `reviewed-required` check (RP-606), a required check on the main ruleset: it fails while a
// PR has neither the `reviewed` label (a finished /code-review at this head, RP-584) nor the
// `docs-only` label on a PR that changes only docs. Without it, a merge started from GitHub skipped
// the rule `pnpm queue` applies (PR #225 and #229 merged unreviewed). Both apply `reviewGate`.
//
// Run by .github/workflows/reviewed-required.yml, from the default branch's copy (a PR cannot edit
// the script that checks it), on pull_request (opened, reopened, synchronize, labeled, unlabeled,
// ready_for_review, converted_to_draft) and on merge_group, as one job name in both so the merge
// queue runs it too. A draft PR passes with a note and is checked when marked ready (RP-1018: a
// check red until the final review woke Auto-fix about 15 times on one draft; a draft cannot enter
// the merge queue). In
// the queue the PR number comes from the queue ref, gh-readonly-queue/main/pr-<n>-<sha>, and the
// labels are read live.
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

export interface RequiredSeam {
  /** The PR's labels now (not the event's copy) and how many files it changes. */
  pull(pr: number): Promise<{ labels: string[]; changedFiles: number }>;
  /** The paths the PR changes, as far as the API lists them. */
  files(pr: number): Promise<string[]>;
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
  const needsFiles = !pull.labels.includes(REVIEWED_LABEL) && pull.labels.includes(DOCS_ONLY_LABEL);
  let files: string[] | undefined;
  if (needsFiles) {
    const listed = await seam.files(pr);
    // The API stops listing at 3000 files; a list shorter than the count cannot confirm docs-only.
    files = listed.length >= pull.changedFiles ? listed : undefined;
  }
  const gate = reviewGate(pull.labels, files);
  if (gate.ok) return { ok: true, summary: `PR #${pr} has the '${gate.via}' label${gate.via === DOCS_ONLY_LABEL ? " and changes only docs" : ""}: passes.` };
  return {
    ok: false,
    summary: `PR #${pr}: ${gate.reason}. Run /code-review, push its fixes, wait for the reviewed-label run, then \`gh pr edit ${pr} --add-label ${REVIEWED_LABEL}\`. A PR that changes only docs takes \`gh pr edit ${pr} --add-label ${DOCS_ONLY_LABEL}\` instead.`,
  };
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
      const pull = (await get(`pulls/${pr}`)) as { labels: { name: string }[]; changed_files: number };
      return { labels: pull.labels.map((label) => label.name), changedFiles: pull.changed_files };
    },
    async files(pr) {
      const files: string[] = [];
      // 30 pages of 100 is the API's 3000-file limit.
      for (let page = 1; page <= 30; page++) {
        const batch = (await get(`pulls/${pr}/files?per_page=100&page=${page}`)) as { filename: string; previous_filename?: string }[];
        // A rename's old path counts too: code renamed to .md is still a code change.
        files.push(...batch.flatMap((file) => (file.previous_filename ? [file.filename, file.previous_filename] : [file.filename])));
        if (batch.length < 100) break;
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
