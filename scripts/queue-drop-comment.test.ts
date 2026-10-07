import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildComment, commentOnRemoval, firstErrorWithContext, latestQueueRun, type QueueDropGitHub } from "./queue-drop-comment.ts";

// RP-401: a PR the merge queue removes gets one comment saying why. The comment
// is what wakes the session's Auto-fix; the removal itself reaches only the PR
// timeline, and the PR's own checks stay green (PR #149 was removed five times).

const stamp = "2026-10-07T12:00:00.0000000Z";
const migrationLog = [
  `${stamp} ##[group]Run node scripts/check-migrations.ts`,
  `${stamp} These migrations share a timestamp; rename this branch's 20261220000000_counter_for_pattern_in_effect.sql, 20261220000000_random_ids.sql`,
  `${stamp} ##[error]Process completed with exit code 1.`,
  `${stamp} ##[error]A later error`,
].join("\n");

describe("firstErrorWithContext", () => {
  it("returns the first ##[error] line and the line before it, without timestamps", () => {
    expect(firstErrorWithContext(migrationLog)).toEqual({
      before: "These migrations share a timestamp; rename this branch's 20261220000000_counter_for_pattern_in_effect.sql, 20261220000000_random_ids.sql",
      error: "Process completed with exit code 1.",
    });
  });

  it("strips colour codes and skips ##[endgroup] lines when looking for the line before", () => {
    const log = `${stamp} \u001b[31mexpected 1 to be 2\u001b[0m\n${stamp} ##[endgroup]\n${stamp} ##[error]Process completed with exit code 1.`;
    expect(firstErrorWithContext(log)).toEqual({ before: "expected 1 to be 2", error: "Process completed with exit code 1." });
  });

  it("has no line before an error on the first line", () => {
    expect(firstErrorWithContext(`${stamp} ##[error]boom`)).toEqual({ before: undefined, error: "boom" });
  });

  it("returns undefined when the log has no ##[error] line", () => {
    expect(firstErrorWithContext(`${stamp} all fine`)).toBeUndefined();
  });
});

describe("buildComment", () => {
  const pr = 149;
  const fix = "merge `main` into the branch, fix it, push, then `pnpm queue 149` (RP-400)";

  it("names each failing job with its error line and the line before it, for failed checks", () => {
    const text = buildComment({
      pr,
      reason: "failed_checks",
      jobs: [{ name: "migration-drift", url: "https://github.com/o/r/actions/runs/1/job/2", log: migrationLog }],
    });
    expect(text).toContain("failed_checks");
    expect(text).toContain("migration-drift");
    expect(text).toContain("https://github.com/o/r/actions/runs/1/job/2");
    expect(text).toContain("These migrations share a timestamp; rename this branch's");
    expect(text).toContain("##[error]Process completed with exit code 1.");
    expect(text).toContain(fix);
  });

  it("says when a failing job's log has no ##[error] line", () => {
    const text = buildComment({ pr, reason: "failed_checks", jobs: [{ name: "lint", url: "u", log: "nothing" }] });
    expect(text).toContain("lint");
    expect(text).toContain("no ##[error] line");
  });

  it("says when no failing job could be found", () => {
    expect(buildComment({ pr, reason: "failed_checks", jobs: [] })).toContain("could not find a failing job");
  });

  it("says a conflict removed the PR, and that the queue does not resolve it", () => {
    const text = buildComment({ pr, reason: "merge_conflict", jobs: [] });
    expect(text).toContain("conflict");
    expect(text).toContain(fix);
  });

  it("names any other reason as it is", () => {
    const text = buildComment({ pr, reason: "queue_cleared", jobs: [] });
    expect(text).toContain("queue_cleared");
    expect(text).toContain(fix);
  });

  it("cannot break out of its code block with a log line", () => {
    const text = buildComment({ pr, reason: "failed_checks", jobs: [{ name: "x", url: "u", log: `${stamp} \`\`\`\n${stamp} ##[error]\`\`\` @everyone` }] });
    expect(text.match(/```/g)?.length ?? 0).toBe(2);
  });

  it("is marked, so it can be told from other comments", () => {
    expect(buildComment({ pr, reason: "merge_conflict", jobs: [] })).toContain("<!-- queue-drop-comment -->");
  });
});

describe("latestQueueRun", () => {
  const run = (id: number, head_branch: string) => ({ id, head_branch });
  it("takes the newest merge_group run on this PR's queue branch, not another PR's", () => {
    const runs = [run(9, "gh-readonly-queue/main/pr-1490-aaa"), run(8, "gh-readonly-queue/main/pr-149-bbb"), run(7, "gh-readonly-queue/main/pr-149-ccc")];
    expect(latestQueueRun(runs, 149)?.id).toBe(8);
  });
  it("is undefined when the PR has no queue run", () => {
    expect(latestQueueRun([run(1, "gh-readonly-queue/main/pr-2-x")], 149)).toBeUndefined();
  });
});

describe("commentOnRemoval", () => {
  const github = (over: Partial<QueueDropGitHub> = {}) => {
    const posted: string[] = [];
    const api: QueueDropGitHub = {
      mergeGroupRuns: async () => [
        { id: 5, head_branch: "gh-readonly-queue/main/pr-149-new" },
        { id: 4, head_branch: "gh-readonly-queue/main/pr-149-old" },
      ],
      failedJobs: async (id) => (id === 5 ? [{ id: 50, name: "migration-drift", url: "u50" }] : []),
      jobLog: async () => migrationLog,
      removalReason: async () => "merge_conflict",
      postComment: async (_pr, body) => void posted.push(body),
      ...over,
    };
    return { api, posted };
  };

  it("posts the failing job of the latest queue run for failed checks", async () => {
    const { api, posted } = github();
    await commentOnRemoval({ pr: 149, reason: "failed_checks", merged: false }, api);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("migration-drift");
    expect(posted[0]).toContain("These migrations share a timestamp");
  });

  it("posts a conflict comment without reading any run", async () => {
    const { api, posted } = github({ mergeGroupRuns: async () => Promise.reject(new Error("must not be called")) });
    await commentOnRemoval({ pr: 149, reason: "merge_conflict", merged: false }, api);
    expect(posted[0]).toContain("conflict");
  });

  it("asks the PR timeline for the reason when the event carries none", async () => {
    const { api, posted } = github();
    await commentOnRemoval({ pr: 149, reason: undefined, merged: false }, api);
    expect(posted[0]).toContain("conflict");
  });

  it("still posts the reason when the run's jobs cannot be read", async () => {
    const { api, posted } = github({ failedJobs: async () => Promise.reject(new Error("403")) });
    await commentOnRemoval({ pr: 149, reason: "failed_checks", merged: false }, api);
    expect(posted[0]).toContain("failed_checks");
    expect(posted[0]).toContain("could not find a failing job");
  });

  it("posts nothing for a PR that merged", async () => {
    const { api, posted } = github();
    await commentOnRemoval({ pr: 149, reason: "merged", merged: true }, api);
    expect(posted).toEqual([]);
  });
});

// The workflow file: the trigger and permissions are what make the comment
// arrive and keep a fork's PR from holding a write token. These fail if either changes.
describe("queue-drop-comment.yml", () => {
  const repo = join(dirname(import.meta.filename), "..");
  const source = readFileSync(join(repo, ".github", "workflows", "queue-drop-comment.yml"), "utf8");
  const wf = parse(source) as {
    on: Record<string, { types?: string[] }>;
    permissions: Record<string, string>;
    jobs: Record<string, { if?: string; permissions?: Record<string, string>; steps: { uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> }[] }>;
  };

  it("runs on pull_request dequeued, and nothing else", () => {
    expect(wf.on).toEqual({ pull_request: { types: ["dequeued"] } });
  });

  it("holds no permission at workflow level, and only the comment job's: read contents and actions, write pull requests", () => {
    expect(wf.permissions).toEqual({});
    const jobs = Object.values(wf.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.permissions).toEqual({ contents: "read", actions: "read", "pull-requests": "write" });
  });

  it("runs only for this repository's own branches", () => {
    expect(Object.values(wf.jobs)[0]?.if).toMatch(/github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/);
  });

  it("runs the script from the default branch, never the pull request's code", () => {
    const checkout = Object.values(wf.jobs)[0]?.steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout?.with?.ref).toBe("${{ github.event.repository.default_branch }}");
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });

  it("is not a CI job: it never runs on merge_group or push, so it cannot be a required check", () => {
    expect(Object.keys(wf.on)).not.toContain("merge_group");
    expect(Object.keys(wf.on)).not.toContain("push");
  });
});
