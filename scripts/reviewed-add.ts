/* eslint-disable rabaed/no-avoid-terms -- GitHub's required checks, author associations and git's names, by their own names, as in reviewed-required.ts */
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { onlyCleanCommitsSince, REVIEWED_LABEL, type ReviewedGit } from "./reviewed-label.ts";
import { REQUIRED_CHECK } from "./reviewed-required.ts";
import { realGateGit, verifyGate } from "./verify-gate.ts";

// Adds the `reviewed` label to a PR (RP-1118, owner's option b on RP-1098: no session labels its own PR).
// It adds it only when both hold for the PR's current head:
//   1. a /code-review summary comment for that head is on the PR: a comment holding `reviewMarker(<sha>)`, the
//      hidden line `<!-- code-review: <40-hex sha> -->`, posted by a trusted author (`isTrustedAuthor`). The lane
//      posts it with `node scripts/review-post.ts <pr> <summary-file>` after /code-review (the skill lives outside
//      this repo, so the repo's script writes the marker);
//   2. the body's stamped verify line passes the verify gate (`verifyGate`, RP-1094) for that head.
// Either may name an older commit when only clean commits led from it to the head: merges of main and the
// screenshot bot's baseline commits (`onlyCleanCommitsSince`, RP-1017, RP-1103), the one rule the verify gate uses.
//
// The `reviewed-label` workflow still removes the label on any push (scripts/reviewed-label.ts), so this waits for
// that run on the head first, and takes the label off again when a push landed while it was adding it. A label
// added with GITHUB_TOKEN starts no `labeled` run, so it then re-runs the head's failed `reviewed-required` run,
// which reads the labels live. Docs-only PRs are unchanged: `docs-only` still passes without `reviewed`.
//
// Run by .github/workflows/reviewed-add.yml (PR 2) from the default branch's copy, on pull_request (the body's
// verify line, a push, ready for review) and issue_comment (the review comment), in a checkout with main's full
// history; it fetches the PR's head itself and runs none of its code.
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH.

/** The hidden line a /code-review summary comment carries for the commit it reviewed (the full sha). */
export const reviewMarker = (sha: string) => `<!-- code-review: ${sha} -->`;

const MARKER = /<!-- code-review: ([0-9a-f]{40}) -->/g;

/**
 * The repo's own accounts, as GitHub tells a comment's author apart (`author_association`): its owner, the
 * organisation's members and invited collaborators, all of whom can push to it anyway. The lanes post as the owner's
 * account (a MEMBER of Rabaed). No bot counts: no review bot posts on this repo, and any workflow can comment as
 * github-actions[bot].
 */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export interface ReviewComment {
  login: string;
  /** GitHub's `user.type`: "User" or "Bot". */
  type: string;
  /** GitHub's `author_association`. */
  association: string;
  body: string;
}

export const isTrustedAuthor = (comment: ReviewComment) => comment.type === "User" && TRUSTED_ASSOCIATIONS.has(comment.association);

const markedCommits = (comment: ReviewComment) => [...comment.body.matchAll(MARKER)].map(([, sha = ""]) => sha);

export type ReviewFound = { ok: true; commit: string } | { ok: false; reason: string };

/** A trusted review comment for `head`, or for a commit only clean commits led to it from. */
export function reviewAt(comments: ReviewComment[], head: string, git: ReviewedGit): ReviewFound {
  const trusted = comments.filter(isTrustedAuthor).flatMap(markedCommits);
  const commit = trusted.find((candidate) => onlyCleanCommitsSince(candidate, head, git));
  if (commit !== undefined) return { ok: true, commit };
  const untrusted = comments.filter((comment) => !isTrustedAuthor(comment) && markedCommits(comment).length > 0).map((comment) => comment.login);
  const parts = [
    trusted.length > 0
      ? `its /code-review comments name ${[...new Set(trusted)].join(", ")}, which is neither the head ${head} nor a commit only clean commits led to it from`
      : `no /code-review summary comment (\`${reviewMarker("<sha>")}\`) for its head ${head}`,
    ...(untrusted.length > 0 ? [`a marker by ${[...new Set(untrusted)].join(", ")} does not count (not one of the repo's own accounts)`] : []),
  ];
  return { ok: false, reason: parts.join("; ") };
}

export type AddEvent = { pr: number };

/** The PR the workflow ran for; undefined for a comment on a plain issue. */
export function addEvent(eventName: string, payload: unknown): AddEvent | undefined {
  const event = payload as { pull_request?: { number: number }; issue?: { number: number; pull_request?: unknown } };
  if (eventName === "pull_request" && event.pull_request) return { pr: event.pull_request.number };
  if (eventName === "issue_comment" && event.issue) return event.issue.pull_request ? { pr: event.issue.number } : undefined;
  throw new Error(`reviewed-add runs on pull_request and issue_comment, not ${eventName}`);
}

export interface AddSeam extends ReviewedGit {
  /** The PR now. */
  pull(pr: number): Promise<{ body: string; headSha: string; labels: string[]; draft: boolean; sameRepo: boolean; open: boolean }>;
  /** Every comment on the PR's conversation. */
  comments(pr: number): Promise<ReviewComment[]>;
  /** `git fetch origin refs/pull/<pr>/head`, so the head's commits are there to walk. */
  fetchPull(pr: number): void;
  /** The `reviewed-label` workflow's pull_request runs for `headSha`; undefined when that workflow does not exist. */
  labelRuns(headSha: string): Promise<{ status: string }[] | undefined>;
  /** The `reviewed-required` workflow's pull_request runs for `headSha`, newest first. */
  requiredRuns(headSha: string): Promise<{ id: number; status: string; conclusion: string | null }[]>;
  addLabel(pr: number): Promise<void>;
  removeLabel(pr: number): Promise<void>;
  rerun(runId: number): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface AddResult {
  /** False only when it could not decide (a run that never finished); not adding the label is still ok. */
  ok: boolean;
  added: boolean;
  summary: string;
}

/** Polls until `done` answers true; false after `timeoutMs`. */
async function waitFor(done: () => Promise<boolean>, sleep: (ms: number) => Promise<void>, pollMs: number, timeoutMs: number) {
  for (let waited = 0; ; waited += pollMs) {
    if (await done()) return true;
    if (waited >= timeoutMs) return false;
    await sleep(pollMs);
  }
}

export async function addReviewed(event: AddEvent, seam: AddSeam, options: { pollMs?: number; timeoutMs?: number } = {}): Promise<AddResult> {
  // 1500 s per wait, as reviewed-required waits for the same run (RP-984). There are two waits (the reviewed-label
  // run, then the reviewed-required run), so reviewed-add.yml's timeout stays above 3000 s.
  const { pollMs = 10_000, timeoutMs = 1_500_000 } = options;
  const { pr } = event;
  const skip = (why: string): AddResult => ({ ok: true, added: false, summary: `PR #${pr}: ${why}` });
  const first = await seam.pull(pr);
  if (!first.open) return skip("closed: nothing to do.");
  if (!first.sameRepo) return skip("a fork's PR: not labelled here (the reviewed-label job skips forks too).");
  if (first.draft) return skip("a draft: checked again when marked ready.");
  const head = first.headSha;
  // That run may be about to remove a label left from an earlier head, so the labels are read only once it has
  // finished: a label seen before then may be gone a moment later, and adding before it finishes would race it.
  const settled = await waitFor(
    async () => {
      const runs = await seam.labelRuns(head);
      return runs === undefined || (runs.length > 0 && runs.every((run) => run.status === "completed"));
    },
    seam.sleep,
    pollMs,
    timeoutMs,
  );
  if (!settled) return { ok: false, added: false, summary: `PR #${pr}: the reviewed-label run for ${head} did not finish within ${timeoutMs / 1000} s. Re-run this workflow once it has.` };
  const pull = await seam.pull(pr);
  if (pull.headSha !== head) return skip(`its head moved to ${pull.headSha} while this waited; that push's own run decides.`);
  if (pull.labels.includes(REVIEWED_LABEL)) return skip(`already has \`${REVIEWED_LABEL}\`.`);
  seam.fetchPull(pr);
  const review = reviewAt(await seam.comments(pr), head, seam);
  const verify = verifyGate(pull.body, head, seam);
  if (!review.ok || !verify.ok) {
    const reasons = [...(review.ok ? [] : [review.reason]), ...(verify.ok ? [] : [verify.reason])];
    return skip(`no \`${REVIEWED_LABEL}\` label yet: ${reasons.join("; ")}.`);
  }
  await seam.addLabel(pr);
  // A push between the read and the add was answered by a reviewed-label run that saw no label to remove.
  const after = await seam.pull(pr);
  if (after.headSha !== head) {
    await seam.removeLabel(pr);
    return skip(`its head moved to ${after.headSha} while the label was being added, so it was taken off again; that push's own run decides.`);
  }
  // Labels added with GITHUB_TOKEN start no `labeled` run, so the head's reviewed-required check is re-run by hand.
  let latest: { id: number; status: string; conclusion: string | null } | undefined;
  const finished = await waitFor(
    async () => {
      latest = (await seam.requiredRuns(head))[0];
      return latest === undefined || latest.status === "completed";
    },
    seam.sleep,
    pollMs,
    timeoutMs,
  );
  const added = `PR #${pr}: added \`${REVIEWED_LABEL}\`: /code-review at ${review.commit} and \`pnpm verify\` on ${verify.commit}, for the head ${head}`;
  if (!finished) return { ok: false, added: true, summary: `${added}, but its ${REQUIRED_CHECK} run ${latest?.id} did not finish within ${timeoutMs / 1000} s; re-run that check once it has.` };
  const rerun = latest !== undefined && latest.conclusion !== "success";
  if (rerun && latest) await seam.rerun(latest.id);
  return { ok: true, added: true, summary: `${added}${rerun ? `; re-ran ${REQUIRED_CHECK} (run ${latest?.id})` : ""}.` };
}

const PER_PAGE = 100;

export function overHttp(repository: string, token: string, fetcher: typeof fetch = fetch): Omit<AddSeam, keyof ReviewedGit | "fetchPull" | "sleep"> {
  const call = async (method: string, path: string, body?: unknown, allow404 = false): Promise<unknown> => {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allow404 && response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub ${method} ${path} answered ${response.status}`);
    return response.status === 204 || response.status === 201 ? undefined : response.json();
  };
  const runs = async (workflow: string, headSha: string) =>
    (await call("GET", `actions/workflows/${workflow}/runs?head_sha=${headSha}&event=pull_request`, undefined, true)) as
      | { workflow_runs: { id: number; status: string; conclusion: string | null }[] }
      | undefined;
  return {
    async pull(pr) {
      const pull = (await call("GET", `pulls/${pr}`)) as {
        body: string | null;
        state: string;
        draft?: boolean;
        head: { sha: string; repo: { full_name: string } | null };
        labels: { name: string }[];
      };
      return {
        body: pull.body ?? "",
        headSha: pull.head.sha,
        labels: pull.labels.map((label) => label.name),
        draft: pull.draft === true,
        sameRepo: pull.head.repo?.full_name === repository,
        open: pull.state === "open",
      };
    },
    async comments(pr) {
      const all: ReviewComment[] = [];
      // 30 pages of 100: far more comments than any PR here has.
      for (let page = 1; page <= 30; page++) {
        const batch = (await call("GET", `issues/${pr}/comments?per_page=${PER_PAGE}&page=${page}`)) as {
          body: string | null;
          author_association: string;
          user: { login: string; type: string } | null;
        }[];
        all.push(...batch.map((comment) => ({ login: comment.user?.login ?? "", type: comment.user?.type ?? "", association: comment.author_association, body: comment.body ?? "" })));
        if (batch.length < PER_PAGE) break;
      }
      return all;
    },
    async labelRuns(headSha) {
      return (await runs("reviewed-label.yml", headSha))?.workflow_runs.map((run) => ({ status: run.status }));
    },
    async requiredRuns(headSha) {
      // The API lists runs newest first.
      return ((await runs("reviewed-required.yml", headSha))?.workflow_runs ?? []).map(({ id, status, conclusion }) => ({ id, status, conclusion }));
    },
    addLabel: async (pr) => void (await call("POST", `issues/${pr}/labels`, { labels: [REVIEWED_LABEL] })),
    async removeLabel(pr) {
      // 404: the label is already gone, which is the goal.
      await call("DELETE", `issues/${pr}/labels/${REVIEWED_LABEL}`, undefined, true);
    },
    rerun: async (runId) => void (await call("POST", `actions/runs/${runId}/rerun`)),
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!token || !repository || !eventName) throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_NAME must be set");
  const event = addEvent(eventName, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")));
  if (event === undefined) {
    console.log("A comment on an issue, not a PR: nothing to do.");
    return;
  }
  const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  const result = await addReviewed(event, { ...realGateGit(), ...overHttp(repository, token), sleep });
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
