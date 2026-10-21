import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildComment, classify, commentOnRemoval, firstErrorWithContext, latestQueueRun, mergeTreeConflicts, type QueueDropGitHub } from "./queue-drop-comment.ts";

// RP-401: a PR the merge queue removes gets one comment saying why. The comment
// is what wakes the session's Auto-fix; the removal itself reaches only the PR
// timeline, and the PR's own checks stay green (PR #149 was removed five times).

const stamp = "2026-10-07T12:00:00.0000000Z";
// The drift job of PR #149's queue run (run 37572659419), as the API serves it.
const migrationLog = [
  "2026-10-07T04:41:28.5022950Z   HEAD_SHA: edee29a3d93811baf65f484ef56454abcfdf7d6a",
  "2026-10-07T04:41:28.5022950Z ##[endgroup]",
  "2026-10-07T04:41:28.7903134Z These migrations share a timestamp; rename this branch's (it isn't on main yet) to a new, later one: 20261220000000_counter_for_pattern_in_effect.sql, 20261220000000_random_ids.sql",
  "2026-10-07T04:41:28.7940125Z ##[error]Process completed with exit code 1.",
  "2026-10-07T04:41:28.8068435Z Post job cleanup.",
].join("\n");
// The immutable job of the same run: the file name is two lines above the error.
const immutableLog = [
  "2026-10-07T04:41:29.3870108Z ##[endgroup]",
  "2026-10-07T04:41:29.4657082Z packages/db/migrations/20261220000000_counter_for_pattern_in_effect.sql sorts before 20261220000000_random_ids.sql, the latest migration on the base branch.",
  "2026-10-07T04:41:29.4658739Z   Merge the base branch, then rename the file to sort after that migration, and re-check every function it re-defines against the base's latest definition: a copy made before the base moved on brings back an outdated body or a stale overload.",
  "2026-10-07T04:41:29.4729971Z ##[error]Process completed with exit code 1.",
].join("\n");

describe("firstErrorWithContext", () => {
  it("returns the first ##[error] line and the line before it, without timestamps", () => {
    expect(firstErrorWithContext(migrationLog)).toEqual({
      before: ["These migrations share a timestamp; rename this branch's (it isn't on main yet) to a new, later one: 20261220000000_counter_for_pattern_in_effect.sql, 20261220000000_random_ids.sql"],
      error: "Process completed with exit code 1.",
    });
  });

  it("takes the two lines before the error, so the file name above the advice text is kept", () => {
    const found = firstErrorWithContext(immutableLog);
    expect(found?.before).toHaveLength(2);
    expect(found?.before[0]).toContain("packages/db/migrations/20261220000000_counter_for_pattern_in_effect.sql sorts before");
    expect(found?.before[1]).toContain("Merge the base branch");
  });

  it("strips colour codes and skips ##[endgroup] lines when looking for the line before", () => {
    const log = `${stamp} \u001b[31mexpected 1 to be 2\u001b[0m\n${stamp} ##[endgroup]\n${stamp} ##[error]Process completed with exit code 1.`;
    expect(firstErrorWithContext(log)).toEqual({ before: ["expected 1 to be 2"], error: "Process completed with exit code 1." });
  });

  it("has no line before an error on the first line", () => {
    expect(firstErrorWithContext(`${stamp} ##[error]boom`)).toEqual({ before: [], error: "boom" });
  });

  it("returns undefined when the log has no ##[error] line", () => {
    expect(firstErrorWithContext(`${stamp} all fine`)).toBeUndefined();
  });
});

describe("classify", () => {
  it.each([
    ["failed_checks", "failed"],
    ["CI_FAILURE", "failed"],
    ["ci_timeout", "failed"],
    ["merge_conflict", "conflict"],
    ["MERGE_CONFLICT", "conflict"],
    ["queue_conflict", "conflict"],
    ["merged", "merged"],
    ["MERGED", "merged"],
    ["already_merged", "merged"],
    ["manual", "manual"],
    ["MANUAL", "manual"],
    ["queue_cleared", "other"],
    ["unknown", "other"],
  ] as const)("reads %s as %s", (reason, kind) => {
    expect(classify(reason)).toBe(kind);
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

  // RP-1020: these two bodies stay exactly as they were.
  it("keeps the failed_checks comment as it was", () => {
    expect(buildComment({ pr, reason: "failed_checks", jobs: [{ name: "lint", url: "https://github.com/o/r/actions/runs/1/job/2", log: `${stamp} oops\n${stamp} ##[error]boom` }] })).toBe(
      [
        "<!-- queue-drop-comment -->",
        "The merge queue removed this PR (reason: `failed_checks`).",
        "",
        "A check failed in the queue's CI run, on this PR merged with the PRs ahead of it. This PR's own checks can still be green.",
        "",
        "Failing job: [lint](https://github.com/o/r/actions/runs/1/job/2)",
        "",
        "```",
        "oops",
        "##[error]boom",
        "```",
        "",
        "Fix: merge `main` into the branch, fix it, push, then `pnpm queue 149` (RP-400).",
      ].join("\n"),
    );
  });

  it("keeps the checks_timed_out comment as it was", () => {
    expect(buildComment({ pr, reason: "checks_timed_out", jobs: [] })).toBe(
      [
        "<!-- queue-drop-comment -->",
        "The merge queue removed this PR (reason: `checks_timed_out`).",
        "",
        "Open the PR timeline for the details.",
        "",
        "Fix: merge `main` into the branch, fix it, push, then `pnpm queue 149` (RP-400).",
      ].join("\n"),
    );
  });

  const head = "a".repeat(40);
  const tip = "b".repeat(40);

  it("names the files git merge-tree finds in conflict with main, and the fix", () => {
    const text = buildComment({ pr, reason: "merge_conflict", jobs: [], conflicts: { head, base: "main", tip, files: ["docs/visibility.md", "apps/web/src/lib/session.ts"] } });
    expect(text).toBe(
      [
        "<!-- queue-drop-comment -->",
        "The merge queue removed this PR (reason: `merge_conflict`).",
        "",
        "`git merge-tree` finds these files in conflict between this PR's head (`aaaaaaaaa`) and `main` (`bbbbbbbbb`):",
        "",
        "- `docs/visibility.md`",
        "- `apps/web/src/lib/session.ts`",
        "",
        "Fix: merge `main` into the branch, resolve the conflicts, push, then `pnpm queue 149` (RP-400).",
      ].join("\n"),
    );
  });

  it("says when git merge-tree finds no conflict with main: the clash is with a PR ahead, or the queue dropped it while rebuilding", () => {
    const text = buildComment({ pr, reason: "merge_conflict", jobs: [], conflicts: { head, base: "main", tip, files: [] } });
    expect(text).toContain("`git merge-tree` finds no conflict between this PR's head (`aaaaaaaaa`) and `main` (`bbbbbbbbb`)");
    expect(text).toContain("a PR ahead of it in the queue");
    expect(text).toContain("Fix: merge `main` into the branch, resolve the conflicts, push, then `pnpm queue 149` (RP-400).");
  });

  it("says when the conflicted files could not be read", () => {
    const text = buildComment({ pr, reason: "merge_conflict", jobs: [] });
    expect(text).toContain("could not run `git merge-tree`");
    expect(text).toContain("Fix: merge `main` into the branch, resolve the conflicts, push, then `pnpm queue 149` (RP-400).");
  });

  it("lists at most 30 conflicted files, and says how many more", () => {
    const files = Array.from({ length: 33 }, (_, i) => `f${i}.ts`);
    const text = buildComment({ pr, reason: "merge_conflict", jobs: [], conflicts: { head, base: "main", tip, files } });
    expect(text).toContain("- `f29.ts`");
    expect(text).not.toContain("- `f30.ts`");
    expect(text).toContain("and 3 more");
  });

  it("cannot break out of its inline code with a file name", () => {
    const text = buildComment({ pr, reason: "merge_conflict", jobs: [], conflicts: { head, base: "main", tip, files: ["a`b.md"] } });
    expect(text).toContain("- `a'b.md`");
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
      removalReason: async () => undefined,
      postComment: async (_pr, body) => void posted.push(body),
      ...over,
    };
    return { api, posted };
  };
  const head = "c".repeat(40);
  const event = (reason: string | undefined, merged = false) => ({ pr: 149, reason, merged, head, base: "main" });
  const conflicted = (files: string[]) => async (h: string, base: string) => ({ head: h, base, tip: "d".repeat(40), files });
  const noMergeTree = async () => Promise.reject(new Error("must not be called"));

  it("posts the failing job of the latest queue run for failed checks", async () => {
    const { api, posted } = github();
    await commentOnRemoval(event("failed_checks", false), api, noMergeTree);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("migration-drift");
    expect(posted[0]).toContain("These migrations share a timestamp");
  });

  it("posts one comment naming the files merge-tree finds in conflict between the PR's head and its base, without reading any run", async () => {
    const { api, posted } = github({ mergeGroupRuns: async () => Promise.reject(new Error("must not be called")) });
    const asked: string[][] = [];
    await commentOnRemoval(event("merge_conflict"), api, async (h, base) => {
      asked.push([h, base]);
      return conflicted(["docs/visibility.md"])(h, base);
    });
    expect(asked).toEqual([[head, "main"]]);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("- `docs/visibility.md`");
  });

  it("still posts the conflict comment when merge-tree cannot run", async () => {
    const { api, posted } = github();
    await commentOnRemoval(event("merge_conflict"), api, async () => Promise.reject(new Error("shallow")));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("could not run `git merge-tree`");
  });

  it("does not run merge-tree for a failed check", async () => {
    const { api, posted } = github();
    await commentOnRemoval(event("failed_checks"), api, async () => Promise.reject(new Error("must not be called")));
    expect(posted[0]).not.toContain("merge-tree");
  });

  it("reads the reason from the PR timeline first, and treats its upper-case enum form as the reason", async () => {
    const { api, posted } = github({ removalReason: async () => "MERGE_CONFLICT" });
    await commentOnRemoval(event("failed_checks"), api, conflicted(["a.ts"]));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("- `a.ts`");
  });

  it("falls back to the webhook's reason when the timeline has none or cannot be read", async () => {
    for (const removalReason of [async () => undefined, async () => Promise.reject(new Error("403"))]) {
      const { api, posted } = github({ removalReason });
      await commentOnRemoval(event("merge_conflict"), api, conflicted(["a.ts"]));
      expect(posted[0]).toContain("- `a.ts`");
    }
  });

  it("posts nothing for a PR a person took out of the queue on purpose", async () => {
    const { api, posted } = github({ removalReason: async () => "MANUAL" });
    expect(await commentOnRemoval(event(undefined, false), api, noMergeTree)).toBeUndefined();
    expect(posted).toEqual([]);
  });

  it("posts nothing when the timeline says the PR merged", async () => {
    const { api, posted } = github({ removalReason: async () => "MERGED" });
    await commentOnRemoval(event("failed_checks", false), api, noMergeTree);
    expect(posted).toEqual([]);
  });

  it("still posts the reason when the run's jobs cannot be read", async () => {
    const { api, posted } = github({ failedJobs: async () => Promise.reject(new Error("403")) });
    await commentOnRemoval(event("failed_checks", false), api, noMergeTree);
    expect(posted[0]).toContain("failed_checks");
    expect(posted[0]).toContain("could not find a failing job");
  });

  it("posts nothing for a PR that merged", async () => {
    const { api, posted } = github();
    await commentOnRemoval(event("merged", true), api, noMergeTree);
    expect(posted).toEqual([]);
  });
});

// RP-1020: the real git commands, on throwaway repositories. "origin" plays GitHub;
// the runner's clone is made the way actions/checkout makes it.
describe("mergeTreeConflicts", () => {
  let dir = "";
  const run = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" }).trim();
  const commit = (cwd: string, files: Record<string, string>, message: string) => {
    for (const [file, text] of Object.entries(files)) writeFileSync(join(cwd, file), text);
    run(cwd, "add", "-A");
    run(cwd, "commit", "-q", "-m", message);
    return run(cwd, "rev-parse", "HEAD");
  };
  let conflicting = "";
  let clean = "";
  let origin = "";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rabaed-queue-drop-"));
    origin = join(dir, "origin.git");
    const work = join(dir, "work");
    run(dir, "init", "-q", "--bare", origin);
    run(origin, "config", "uploadpack.allowFilter", "true");
    run(dir, "init", "-q", work);
    commit(work, { "a.md": "one\n", "b.md": "two\n" }, "start");
    run(work, "push", "-q", origin, "HEAD:refs/heads/main");
    run(work, "switch", "-q", "-c", "pr");
    conflicting = commit(work, { "a.md": "the PR's line\n", "c.md": "new\n" }, "the PR");
    run(work, "push", "-q", origin, "pr:refs/heads/pr");
    run(work, "switch", "-q", "-c", "other", "main");
    clean = commit(work, { "d.md": "only the PR touches this\n" }, "a clean PR");
    run(work, "push", "-q", origin, "other:refs/heads/other");
    run(work, "switch", "-q", "main");
    commit(work, { "a.md": "main's line\n" }, "main moves on");
    run(work, "push", "-q", origin, "main:refs/heads/main");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // The runner's clone: full history, no file contents (actions/checkout's fetch-depth: 0, filter: blob:none),
  // cut before main moved, so the function has to fetch main's tip itself.
  const runnerClone = (name: string, ...options: string[]) => {
    const clone = join(dir, name);
    run(dir, "clone", "-q", "--no-checkout", ...options, pathToFileURL(origin).href, clone);
    return clone;
  };

  it("lists the files in conflict between the PR's head and the base branch's tip, in a blobless clone", async () => {
    const clone = runnerClone("blobless", "--filter=blob:none");
    const tip = run(origin, "rev-parse", "main");
    expect(await mergeTreeConflicts(conflicting, "main", clone)).toEqual({ head: conflicting, base: "main", tip, files: ["a.md"] });
  });

  it("lists no file when the head merges cleanly", async () => {
    const clone = runnerClone("clean", "--filter=blob:none");
    expect((await mergeTreeConflicts(clean, "main", clone)).files).toEqual([]);
  });

  it("refuses a shallow clone, whose fetch of the head would download the whole history", async () => {
    const clone = runnerClone("shallow", "--depth=1");
    await expect(mergeTreeConflicts(conflicting, "main", clone)).rejects.toThrow(/shallow/);
  });

  it("refuses a head that is not a full commit id, and a base that could read as an option", async () => {
    const clone = runnerClone("checks", "--filter=blob:none");
    await expect(mergeTreeConflicts("--upload-pack=touch x", "main", clone)).rejects.toThrow(/head/);
    await expect(mergeTreeConflicts(conflicting.toUpperCase(), "main", clone)).rejects.toThrow(/head/);
    await expect(mergeTreeConflicts(conflicting, "-x", clone)).rejects.toThrow(/base/);
    // A colon would turn the refspec into one that writes another ref.
    await expect(mergeTreeConflicts(conflicting, "main:refs/heads/x", clone)).rejects.toThrow(/base/);
    await expect(mergeTreeConflicts(conflicting, "main/../x", clone)).rejects.toThrow(/base/);
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

  // RP-1020: merge-tree needs the merge base, so the checkout takes main's whole history but no file
  // contents (about 4 MB of commits and trees in 2026-10; git fetches the blobs a merge needs). The
  // workflow lands in its own PR after the script (rule 3); until then these wait for it. Either key
  // wakes them, so a workflow change that sets only one of the two fails here instead of skipping.
  const checkout = Object.values(wf.jobs)[0]?.steps.find((s) => s.uses?.startsWith("actions/checkout"));
  describe.skipIf(checkout?.with?.filter === undefined && checkout?.with?.["fetch-depth"] === undefined)("checkout for git merge-tree (RP-1020)", () => {
    it("takes the whole history without file contents", () => {
      expect(checkout?.with?.["fetch-depth"]).toBe(0);
      expect(checkout?.with?.filter).toBe("blob:none");
    });
  });
});
