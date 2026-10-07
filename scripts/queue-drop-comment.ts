import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Comments on a pull request why the merge queue removed it (RP-401). Run by
// .github/workflows/queue-drop-comment.yml on pull_request: dequeued.
//
// A PR that leaves the queue is only visible in its timeline and in the logs of
// the gh-readonly-queue/main/pr-<n>-... CI run; the PR's own checks stay green,
// so Auto-fix never woke the session (PR #149 was removed five times). The
// comment is what wakes it.
//
// A PR a person took out of the queue on purpose (reason manual) gets no comment.
//
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH. Reads run
// metadata and logs; runs no PR code. The log text it quotes is untrusted: it
// goes into a code block that cannot be closed from inside.

export const MARKER = "<!-- queue-drop-comment -->";

export interface FailedJob {
  name: string;
  url: string;
  log: string;
}

export interface QueueRun {
  id: number;
  head_branch: string;
}

export type RemovalKind = "failed" | "conflict" | "merged" | "manual" | "other";

const KINDS: [RemovalKind, string[]][] = [
  ["failed", ["failed_checks", "ci_failure", "ci_timeout"]],
  ["conflict", ["merge_conflict", "queue_conflict"]],
  ["merged", ["merged", "already_merged"]],
  ["manual", ["manual"]],
];

/** What a removal reason means. Case-insensitive: the webhook sends "merge_conflict", the GraphQL enum "MERGE_CONFLICT". */
export function classify(reason: string): RemovalKind {
  const key = reason.trim().toLowerCase();
  return KINDS.find(([, reasons]) => reasons.includes(key))?.[0] ?? "other";
}

const clean = (line: string) =>
  line
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, "")
    .trimEnd();

/**
 * The first ##[error] line of a job log and up to two meaningful lines before it,
 * oldest first (timestamps and colours removed). A script's advice text often sits
 * between the error and the line that names the file, hence two. The lines stop at
 * a ##[group]/##[endgroup] boundary once one is found (before that, an ##[endgroup]
 * is skipped), so a step's env block is not quoted.
 */
export function firstErrorWithContext(log: string): { before: string[]; error: string } | undefined {
  const lines = log.split("\n").map(clean);
  const index = lines.findIndex((line) => line.startsWith("##[error]"));
  if (index < 0) return undefined;
  const before: string[] = [];
  for (let i = index - 1; i >= 0 && before.length < 2; i--) {
    const line = lines[i] ?? "";
    if (line.startsWith("##[group]") || line.startsWith("##[endgroup]")) {
      if (before.length > 0 || line.startsWith("##[group]")) break;
      continue;
    }
    if (line.trim() === "") continue;
    before.unshift(line);
  }
  return { before, error: (lines[index] ?? "").slice("##[error]".length) };
}

/** Keeps a quoted log line to one short line that cannot close the code block. */
const quote = (text: string) => text.replaceAll("```", "'''").slice(0, 400);

export function buildComment(input: { pr: number; reason: string; jobs: FailedJob[] }): string {
  const { pr, reason, jobs } = input;
  const kind = classify(reason);
  const lines = [MARKER, `The merge queue removed this PR (reason: \`${quote(reason).replaceAll("`", "'")}\`).`, ""];
  if (kind === "failed") {
    lines.push("A check failed in the queue's CI run, on this PR merged with the PRs ahead of it. This PR's own checks can still be green.", "");
    if (jobs.length === 0) lines.push("I could not find a failing job of the PR's latest merge_group CI run: open the `gh-readonly-queue/main/pr-" + pr + "-...` run in the Actions tab.", "");
    for (const job of jobs) {
      lines.push(`Failing job: [${quote(job.name).replaceAll("]", "")}](${job.url})`);
      const found = firstErrorWithContext(job.log);
      if (!found) {
        lines.push("", "The log has no ##[error] line: open the job for the output.", "");
        continue;
      }
      lines.push("", "```");
      for (const before of found.before) lines.push(quote(before));
      lines.push(quote(`##[error]${found.error}`), "```", "");
    }
  } else if (kind === "conflict") {
    lines.push("This PR conflicts with `main` or with a PR ahead of it in the queue. The queue does not resolve text conflicts.", "");
  } else {
    lines.push("Open the PR timeline for the details.", "");
  }
  lines.push(`Fix: merge \`main\` into the branch, fix it, push, then \`pnpm queue ${pr}\` (RP-400).`);
  return lines.join("\n");
}

/** The newest run on this PR's queue branch (the list is newest first). */
export function latestQueueRun(runs: QueueRun[], pr: number): QueueRun | undefined {
  return runs.find((run) => run.head_branch.startsWith(`gh-readonly-queue/main/pr-${pr}-`));
}

export interface QueueDropGitHub {
  /** Recent merge_group runs of CI, newest first. */
  mergeGroupRuns(): Promise<QueueRun[]>;
  failedJobs(runId: number): Promise<{ id: number; name: string; url: string }[]>;
  jobLog(jobId: number): Promise<string>;
  /** The latest RemovedFromMergeQueueEvent reason in the PR timeline (an enum, e.g. MERGE_CONFLICT); undefined when there is none. */
  removalReason(pr: number): Promise<string | undefined>;
  postComment(pr: number, body: string): Promise<void>;
}

export async function commentOnRemoval(event: { pr: number; reason: string | undefined; merged: boolean }, github: QueueDropGitHub): Promise<string | undefined> {
  if (event.merged) return undefined;
  // The timeline's reason has a known format; the webhook payload's is the fallback.
  const reason = (await github.removalReason(event.pr).catch(() => undefined)) ?? event.reason ?? "unknown";
  const kind = classify(reason);
  // Merged: nothing to fix. Manual: a person took it out on purpose, so waking Auto-fix would only re-queue it.
  if (kind === "merged" || kind === "manual") return undefined;
  const jobs: FailedJob[] = [];
  if (kind === "failed") {
    try {
      const run = latestQueueRun(await github.mergeGroupRuns(), event.pr);
      if (run) {
        for (const job of (await github.failedJobs(run.id)).slice(0, 5)) {
          jobs.push({ name: job.name, url: job.url, log: await github.jobLog(job.id).catch(() => "") });
        }
      }
    } catch {
      // The reason is still worth posting without the jobs.
    }
  }
  const body = buildComment({ pr: event.pr, reason, jobs });
  await github.postComment(event.pr, body);
  return body;
}

function overHttp(repository: string, token: string): QueueDropGitHub {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const api = async (path: string, init?: RequestInit) => {
    const response = await fetch(`https://api.github.com/${path}`, { ...init, headers: { ...headers, ...init?.headers } });
    if (!response.ok) throw new Error(`GitHub ${init?.method ?? "GET"} ${path} answered ${response.status}`);
    return response;
  };
  return {
    async mergeGroupRuns() {
      const body = (await (await api(`repos/${repository}/actions/workflows/ci.yml/runs?event=merge_group&per_page=100`)).json()) as { workflow_runs: QueueRun[] };
      return body.workflow_runs;
    },
    async failedJobs(runId) {
      const body = (await (await api(`repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`)).json()) as { jobs: { id: number; name: string; html_url: string; conclusion: string | null }[] };
      return body.jobs.filter((job) => job.conclusion === "failure").map((job) => ({ id: job.id, name: job.name, url: job.html_url }));
    },
    // The log is a redirect to storage; fetch drops the token on the cross-origin hop.
    async jobLog(jobId) {
      return (await api(`repos/${repository}/actions/jobs/${jobId}/logs`)).text();
    },
    async removalReason(pr) {
      const [owner = "", name = ""] = repository.split("/");
      const query = "query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){timelineItems(last:1,itemTypes:[REMOVED_FROM_MERGE_QUEUE_EVENT]){nodes{... on RemovedFromMergeQueueEvent{reason}}}}}}";
      const response = await api("graphql", { method: "POST", body: JSON.stringify({ query, variables: { owner, name, pr } }) });
      const body = (await response.json()) as { data?: { repository?: { pullRequest?: { timelineItems?: { nodes?: { reason?: string }[] } } } } };
      return body.data?.repository?.pullRequest?.timelineItems?.nodes?.[0]?.reason;
    },
    async postComment(pr, body) {
      await api(`repos/${repository}/issues/${pr}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    },
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as { pull_request: { number: number; merged?: boolean }; reason?: string };
  const body = await commentOnRemoval({ pr: event.pull_request.number, reason: event.reason, merged: event.pull_request.merged === true }, overHttp(repository, token));
  const summary = body ?? "Nothing to post: the PR merged, or a person removed it from the queue on purpose.";
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
