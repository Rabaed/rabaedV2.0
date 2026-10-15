import type { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { queuePr, realSeam, waitForMerge, type PullStatus, type QueueSeam } from "./queue-pr.ts";

// A fake seam for a clean branch; each test overrides what it breaks.
function fakeSeam(overrides: Partial<QueueSeam> = {}) {
  const enqueued: [string, string][] = [];
  const seam: QueueSeam = {
    fetchMain: () => true,
    fetchPull: () => "abc123",
    head: () => "abc123",
    branch: () => "feature",
    isAncestor: () => false,
    pullRequest: () => ({ id: "PR_node", headRefOid: "abc123", headRefName: "feature" }),
    mergeTree: () => ({ status: 0, output: "treeoid\n", stderr: "" }),
    changedFiles: () => ["apps/api/src/a.ts"],
    packageJsonVersions: () => ({ before: undefined, after: undefined }),
    check: () => ({ status: 0, output: "ok\n" }),
    labels: () => ["reviewed"],
    labelWorkflowOnMain: () => true,
    labelRuns: () => [{ status: "completed", conclusion: "success" }],
    status: () => ({ state: "OPEN", isInMergeQueue: true }),
    removalReason: () => undefined,
    enqueue: (id, head) => {
      enqueued.push([id, head]);
      return { position: 3, state: "QUEUED" };
    },
    ...overrides,
  };
  return { seam, enqueued };
}

describe("queuePr", () => {
  it("queues a clean branch pinned to HEAD and reports position and state", () => {
    const { seam, enqueued } = fakeSeam();
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(enqueued).toEqual([["PR_node", "abc123"]]);
    expect(result.lines.join("\n")).toContain("position 3");
    expect(result.lines.join("\n")).toContain("QUEUED");
  });

  it("refuses a PR that changes root package.json among code files, naming rule 3 and the shared files", () => {
    const { seam, enqueued } = fakeSeam({ changedFiles: () => ["package.json", "scripts/x.ts", ".github/workflows/ci.yml", "apps/api/src/a.ts"] });
    const result = queuePr(163, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("rule 3");
    expect(text).toContain("package.json");
    expect(text).toContain(".github/workflows/ci.yml");
    expect(text).not.toContain("apps/api/src/a.ts");
    expect(enqueued).toEqual([]);
  });

  it("queues an own PR that touches only root shared files and docs", () => {
    const { seam, enqueued } = fakeSeam({ changedFiles: () => ["package.json", "pnpm-lock.yaml", ".github/workflows/ci.yml", "docs/tech-stack.md"] });
    expect(queuePr(163, seam).ok).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  it("does not treat a nested package.json or lockfile as a root shared file", () => {
    const { seam } = fakeSeam({ changedFiles: () => ["apps/api/package.json", "scripts/x.ts"] });
    expect(queuePr(163, seam).ok).toBe(true);
  });

  it("refuses a PR without the reviewed label, says how to get it, and does not queue", () => {
    const { seam, enqueued } = fakeSeam({ labels: () => ["other"] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("reviewed");
    expect(text).toContain("gh pr edit 149 --add-label reviewed");
    expect(text).toContain("--no-review");
    expect(enqueued).toEqual([]);
  });

  it("queues a PR with the reviewed label, without a no-review warning", () => {
    const { seam, enqueued } = fakeSeam({ labels: () => ["other", "reviewed"] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).not.toContain("--no-review");
    expect(enqueued).toHaveLength(1);
  });

  it("--no-review queues a PR without the label and says so in the output", () => {
    const { seam, enqueued } = fakeSeam({ labels: () => [] });
    const result = queuePr(149, seam, { noReview: true });
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("--no-review");
    expect(enqueued).toHaveLength(1);
  });

  it("refuses while the reviewed-label run for the head is still going, naming the head", () => {
    const { seam, enqueued } = fakeSeam({ labelRuns: () => [{ status: "in_progress", conclusion: "" }] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("wait for the reviewed-label run on abc123, then run `pnpm queue 149` again");
    expect(enqueued).toEqual([]);
  });

  it("treats no run for the head yet as still going", () => {
    const { seam, enqueued } = fakeSeam({ labelRuns: () => [] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("wait for the reviewed-label run on abc123");
    // RP-604: a PR from before opened-runs never gets one by waiting, so the fix says how to make one.
    expect(result.lines.join("\n")).toContain("merge origin/main in cleanly and push");
    expect(enqueued).toEqual([]);
  });

  it("refuses when the reviewed-label run for the head failed", () => {
    const { seam, enqueued } = fakeSeam({ labelRuns: () => [{ status: "completed", conclusion: "failure" }] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("failed");
    expect(enqueued).toEqual([]);
  });

  it("queues when the reviewed-label run for the head was skipped", () => {
    const { seam, enqueued } = fakeSeam({ labelRuns: () => [{ status: "completed", conclusion: "skipped" }] });
    expect(queuePr(149, seam).ok).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  it("skips the run check with a warning while the workflow is not on origin/main yet", () => {
    const { seam, enqueued } = fakeSeam({ labelWorkflowOnMain: () => false, labelRuns: () => [] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("reviewed-label.yml is not on origin/main yet");
    expect(enqueued).toHaveLength(1);
  });

  it("--no-review skips the run check too", () => {
    const { seam, enqueued } = fakeSeam({ labels: () => [], labelRuns: () => [{ status: "queued", conclusion: "" }] });
    expect(queuePr(149, seam, { noReview: true }).ok).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  describe("dependencies-only PR (RP-573)", () => {
    const admin = (fields: Record<string, unknown>) => JSON.stringify({ name: "admin", scripts: { dev: "vite" }, devDependencies: { a: "1.0.0" }, ...fields });
    const withAdmin = (after: string, files = ["pnpm-lock.yaml", "apps/admin/package.json"]) =>
      fakeSeam({ changedFiles: () => files, packageJsonVersions: () => ({ before: admin({}), after }) });

    it("queues the lockfile with a workspace package.json whose only change is devDependencies", () => {
      const { seam, enqueued } = withAdmin(admin({ devDependencies: { a: "1.0.0", b: "2.0.0" } }));
      expect(queuePr(181, seam).ok).toBe(true);
      expect(enqueued).toHaveLength(1);
    });

    it("refuses when the workspace package.json also changes a script", () => {
      const { seam, enqueued } = withAdmin(admin({ devDependencies: { a: "1.0.0", b: "2.0.0" }, scripts: { dev: "vite --host" } }));
      const result = queuePr(181, seam);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("apps/admin/package.json");
      expect(result.lines.join("\n")).toContain("only its dependency fields");
      expect(enqueued).toEqual([]);
    });

    it("refuses a package.json that does not parse", () => {
      const { seam } = withAdmin("{ not json");
      expect(queuePr(181, seam).ok).toBe(false);
    });

    it("refuses the lockfile with a dependencies-only package.json plus code", () => {
      const { seam } = withAdmin(admin({ devDependencies: { b: "2.0.0" } }), ["pnpm-lock.yaml", "apps/admin/package.json", "apps/admin/src/a.ts"]);
      const result = queuePr(181, seam);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("apps/admin/src/a.ts");
    });

    it("refuses the lockfile with code as today", () => {
      const { seam } = fakeSeam({ changedFiles: () => ["pnpm-lock.yaml", "apps/api/src/a.ts"] });
      expect(queuePr(181, seam).ok).toBe(false);
    });

    it("refuses when the package.json is new or deleted", () => {
      const { seam } = fakeSeam({ changedFiles: () => ["pnpm-lock.yaml", "apps/new/package.json"], packageJsonVersions: () => ({ before: undefined, after: admin({}) }) });
      expect(queuePr(181, seam).ok).toBe(false);
    });
  });

  it("refuses when origin/main cannot be fetched", () => {
    const { seam, enqueued } = fakeSeam({ fetchMain: () => false });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("git fetch origin main failed");
    expect(enqueued).toEqual([]);
  });

  it("queues a PR whose branch is not checked out: checks and pins the PR's own head, not HEAD", () => {
    const checked: string[] = [];
    const { seam, enqueued } = fakeSeam({
      head: () => "unrelated9",
      fetchPull: () => "prhead7",
      pullRequest: () => ({ id: "PR_node", headRefOid: "prhead7", headRefName: "feature" }),
      mergeTree: (sha) => {
        checked.push(`merge-tree ${sha}`);
        return { status: 0, output: "", stderr: "" };
      },
      check: (name, sha) => {
        checked.push(`${name} ${sha}`);
        return { status: 0, output: "" };
      },
    });
    const result = queuePr(157, seam);
    expect(result.ok).toBe(true);
    expect(checked).toEqual(["merge-tree prhead7", "drift prhead7", "immutable prhead7"]);
    expect(enqueued).toEqual([["PR_node", "prhead7"]]);
    expect(result.lines.join("\n")).not.toContain("behind");
  });

  it("warns, and still queues the PR's head, when HEAD is on the PR's branch but behind it", () => {
    const { seam, enqueued } = fakeSeam({ head: () => "old1", fetchPull: () => "new2", pullRequest: () => ({ id: "PR_node", headRefOid: "new2", headRefName: "feature" }), isAncestor: () => true });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("behind");
    expect(enqueued).toEqual([["PR_node", "new2"]]);
  });

  it("does not warn when an old main (another branch) is checked out and is an ancestor of the PR's head", () => {
    const { seam, enqueued } = fakeSeam({ head: () => "oldmain", branch: () => "main", fetchPull: () => "new2", pullRequest: () => ({ id: "PR_node", headRefOid: "new2", headRefName: "feature" }), isAncestor: () => true });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).not.toContain("behind");
    expect(enqueued).toEqual([["PR_node", "new2"]]);
  });

  it("refuses when the PR's head moved between the API answer and the fetch", () => {
    const { seam, enqueued } = fakeSeam({ fetchPull: () => "local1", pullRequest: () => ({ id: "x", headRefOid: "remote2", headRefName: "feature" }) });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("local1");
    expect(text).toContain("remote2");
    expect(enqueued).toEqual([]);
  });

  it("refuses a text conflict with origin/main and lists the conflicted files", () => {
    const output = [
      "9f0e1d2c3b4a",
      "100644 aaaa1111 1\tpackages/ui/src/storybook/numbering.ts",
      "100644 bbbb2222 2\tpackages/ui/src/storybook/numbering.ts",
      "100644 cccc3333 3\tpackages/ui/src/storybook/numbering.ts",
      "100644 dddd4444 2\tdocs/other.md",
      "",
      "CONFLICT (add/add): Merge conflict in packages/ui/src/storybook/numbering.ts",
    ].join("\n");
    const { seam, enqueued } = fakeSeam({ mergeTree: () => ({ status: 1, output, stderr: "" }) });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("packages/ui/src/storybook/numbering.ts");
    expect(text).toContain("docs/other.md");
    expect(text).toContain("merge main");
    expect(enqueued).toEqual([]);
  });

  it("says a merge-tree error is not a conflict, and prints its stderr", () => {
    const { seam, enqueued } = fakeSeam({ mergeTree: () => ({ status: 128, output: "", stderr: "fatal: refusing to merge unrelated histories\n" }) });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("fatal: refusing to merge unrelated histories");
    expect(text).toContain("not a conflict");
    expect(text).not.toContain("conflicts with origin/main");
    expect(enqueued).toEqual([]);
  });

  it("refuses a migration that shares a timestamp with origin/main, with the check's message", () => {
    const message = "These migrations share a timestamp; rename this branch's (it isn't on main yet) to a new, later one: 20261220000000_counter_for_pattern_in_effect.sql, 20261220000000_random_ids.sql\n";
    const { seam, enqueued } = fakeSeam({
      check: (name) => (name === "drift" ? { status: 1, output: message } : { status: 0, output: "" }),
    });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain(message.trimEnd());
    expect(text).toContain("rename the migration");
    expect(enqueued).toEqual([]);
  });

  it("refuses a migration that sorts before main's latest, with the immutable check's message", () => {
    const { seam, enqueued } = fakeSeam({
      check: (name) => (name === "immutable" ? { status: 1, output: "x.sql sorts before y.sql\n" } : { status: 0, output: "" }),
    });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("x.sql sorts before y.sql");
    expect(enqueued).toEqual([]);
  });
});

describe("waitForMerge", () => {
  // Plays the given statuses in order (the last repeats) and records the sleeps.
  const since = new Date("2026-10-09T10:00:00Z");
  function waiting(statuses: PullStatus[], reason?: string) {
    let polls = 0;
    const sleeps: number[] = [];
    const { seam } = fakeSeam({ status: () => statuses[Math.min(polls++, statuses.length - 1)] as PullStatus, removalReason: (_id, from) => (from === since ? reason : undefined) });
    return { seam, sleeps, sleep: async (ms: number) => void sleeps.push(ms), polls: () => polls };
  }

  it("polls every 60 s while queued and succeeds when the PR merges", async () => {
    const w = waiting([
      { state: "OPEN", isInMergeQueue: true },
      { state: "OPEN", isInMergeQueue: true },
      { state: "MERGED", isInMergeQueue: false },
    ]);
    const result = await waitForMerge(149, w.seam, since, w.sleep);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("merged");
    expect(w.sleeps).toEqual([60_000, 60_000]);
  });

  it("fails with the classified reason when the PR leaves the queue", async () => {
    const w = waiting([{ state: "OPEN", isInMergeQueue: true }, { state: "OPEN", isInMergeQueue: false }], "MERGE_CONFLICT");
    const result = await waitForMerge(149, w.seam, since, w.sleep);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("left the merge queue");
    expect(text).toContain("MERGE_CONFLICT");
    expect(text).toContain("conflict");
  });

  it("does not call a single poll outside the queue a removal (the merge may be landing)", async () => {
    const w = waiting([
      { state: "OPEN", isInMergeQueue: false },
      { state: "MERGED", isInMergeQueue: false },
    ]);
    expect((await waitForMerge(149, w.seam, since, w.sleep)).ok).toBe(true);
  });

  it("passes the wait's start to the seam, so an earlier removal's reason is not reported", async () => {
    const w = waiting([{ state: "OPEN", isInMergeQueue: false }]);
    const result = await waitForMerge(149, w.seam, new Date("2026-10-09T11:00:00Z"), w.sleep);
    expect(result.lines.join("\n")).toContain("reason: unknown");
  });

  it("says a manual removal was manual, and a failed check failed", async () => {
    const manual = waiting([{ state: "OPEN", isInMergeQueue: false }], "MANUAL");
    expect((await waitForMerge(149, manual.seam, since, manual.sleep)).lines.join("\n")).toContain("on purpose");
    const failed = waiting([{ state: "OPEN", isInMergeQueue: false }], "FAILED_CHECKS");
    expect((await waitForMerge(149, failed.seam, since, failed.sleep)).lines.join("\n")).toContain("check failed");
  });

  it("fails when the PR is closed without merging", async () => {
    const w = waiting([{ state: "CLOSED", isInMergeQueue: false }]);
    const result = await waitForMerge(149, w.seam, since, w.sleep);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("closed");
  });
});

// The real seam, with spawnSync injected: it must hand git and gh the right arguments.
describe("realSeam", () => {
  function recorded(answer: (command: string, args: string[]) => { status: number | null; stdout?: string; stderr?: string }) {
    const calls: { command: string; args: string[]; cwd: unknown }[] = [];
    const spawn = ((command: string, args: string[], options: { cwd?: string }) => {
      calls.push({ command, args, cwd: options.cwd });
      return answer(command, args);
    }) as unknown as typeof spawnSync;
    return { calls, seam: realSeam("/work", spawn) };
  }

  it("fetches main and the PR's own head ref, reads HEAD and the PR, and merge-trees origin/main with the PR's commit, all in the given directory", () => {
    const { calls, seam } = recorded((command, args) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: "abc123\n" };
      if (command === "gh") return { status: 0, stdout: '{"id":"PR_node","headRefOid":"abc123","headRefName":"feature"}' };
      if (args[0] === "fetch") return { status: 0 };
      if (args[0] === "merge-base") return { status: 0 };
      return { status: 1, stdout: "treeoid\n", stderr: "warn" };
    });
    expect(seam.fetchMain()).toBe(true);
    expect(seam.fetchPull(157)).toBe("abc123");
    expect(seam.head()).toBe("abc123");
    expect(seam.isAncestor("old1", "abc123")).toBe(true);
    expect(seam.pullRequest(149)).toEqual({ id: "PR_node", headRefOid: "abc123", headRefName: "feature" });
    expect(seam.mergeTree("abc123")).toMatchObject({ status: 1, output: "treeoid\nwarn", stderr: "warn" });
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["git", "fetch", "origin", "main"],
      ["git", "fetch", "origin", "refs/pull/157/head"],
      ["git", "rev-parse", "FETCH_HEAD"],
      ["git", "rev-parse", "HEAD"],
      ["git", "merge-base", "--is-ancestor", "old1", "abc123"],
      ["gh", "pr", "view", "149", "--json", "id,headRefOid,headRefName"],
      ["git", "merge-tree", "--write-tree", "origin/main", "abc123"],
    ]);
    expect(calls.every((call) => call.cwd === "/work")).toBe(true);
  });

  it("reads the PR's state and merge-queue flag, and the latest removal reason made since the given time, through gh api graphql", () => {
    const { calls, seam } = recorded((_command, args) =>
      args.some((arg) => arg.includes("REMOVED_FROM_MERGE_QUEUE_EVENT"))
        ? { status: 0, stdout: '{"data":{"node":{"timelineItems":{"nodes":[{"reason":"MERGE_CONFLICT","createdAt":"2026-10-09T10:30:00Z"}]}}}}' }
        : { status: 0, stdout: '{"data":{"node":{"state":"OPEN","isInMergeQueue":true}}}' },
    );
    expect(seam.status("PR_node")).toEqual({ state: "OPEN", isInMergeQueue: true });
    expect(seam.removalReason("PR_node", new Date("2026-10-09T10:00:00Z"))).toBe("MERGE_CONFLICT");
    expect(seam.removalReason("PR_node", new Date("2026-10-09T11:00:00Z"))).toBeUndefined();
    expect(calls.every((call) => call.command === "gh" && call.args.slice(0, 2).join(" ") === "api graphql" && call.args.includes("id=PR_node"))).toBe(true);
  });

  it("reads a package.json at the merge base with origin/main and at the PR's commit, undefined where git show fails", () => {
    const { calls, seam } = recorded((_command, args) => {
      if (args[0] === "merge-base") return { status: 0, stdout: "base777\n" };
      if (args[1] === "base777:apps/admin/package.json") return { status: 0, stdout: "OLD" };
      return { status: 128, stderr: "fatal: path does not exist" };
    });
    expect(seam.packageJsonVersions("abc123", "apps/admin/package.json")).toEqual({ before: "OLD", after: undefined });
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ["git", "merge-base", "origin/main", "abc123"],
      ["git", "show", "base777:apps/admin/package.json"],
      ["git", "show", "abc123:apps/admin/package.json"],
    ]);
  });

  it("runs the migration checks for the PR's commit against origin/main with node", () => {
    const { calls, seam } = recorded(() => ({ status: 0, stdout: "ok" }));
    seam.check("drift", "abc123");
    seam.check("immutable", "abc123");
    expect(calls.map((call) => call.command)).toEqual([process.execPath, process.execPath]);
    expect(calls[0]?.args[0]).toMatch(/check-migration-drift\.ts$/);
    expect(calls[0]?.args.slice(1)).toEqual(["origin/main", "abc123"]);
    expect(calls[1]?.args[0]).toMatch(/check-migrations-immutable\.ts$/);
    expect(calls[1]?.args.slice(1)).toEqual(["origin/main", "abc123"]);
  });

  it("reads the PR's label names through gh pr view", () => {
    const { calls, seam } = recorded(() => ({ status: 0, stdout: '{"labels":[{"name":"reviewed"},{"name":"x"}]}' }));
    expect(seam.labels(149)).toEqual(["reviewed", "x"]);
    expect([calls[0]?.command, ...(calls[0]?.args ?? [])]).toEqual(["gh", "pr", "view", "149", "--json", "labels"]);
  });

  it("lists the reviewed-label runs for a commit through gh run list, and checks the workflow file on origin/main", () => {
    const { calls, seam } = recorded((command) => (command === "gh" ? { status: 0, stdout: '[{"status":"completed","conclusion":"success"}]' } : { status: 0 }));
    expect(seam.labelRuns("abc123")).toEqual([{ status: "completed", conclusion: "success" }]);
    expect(seam.labelWorkflowOnMain()).toBe(true);
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["gh", "run", "list", "--workflow", "reviewed-label.yml", "--commit", "abc123", "--json", "status,conclusion"],
      ["git", "cat-file", "-e", "origin/main:.github/workflows/reviewed-label.yml"],
    ]);
  });

  it("enqueues through gh api graphql, passing the PR id and the head to pin", () => {
    const { calls, seam } = recorded(() => ({ status: 0, stdout: '{"data":{"enqueuePullRequest":{"mergeQueueEntry":{"position":2,"state":"QUEUED"}}}}' }));
    expect(seam.enqueue("PR_node", "abc123")).toEqual({ position: 2, state: "QUEUED" });
    const args = calls[0]?.args ?? [];
    expect(calls[0]?.command).toBe("gh");
    expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(args.find((arg) => arg.startsWith("query="))).toContain("enqueuePullRequest");
    expect(args).toContain("id=PR_node");
    expect(args).toContain("head=abc123");
  });

  it("throws with the command's output when a required call fails", () => {
    const { seam } = recorded(() => ({ status: 1, stderr: "no auth" }));
    expect(() => seam.head()).toThrow(/no auth/);
  });
});
