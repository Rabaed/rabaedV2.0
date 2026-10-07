import type { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { queuePr, realSeam, type QueueSeam } from "./queue-pr.ts";

// A fake seam for a clean branch; each test overrides what it breaks.
function fakeSeam(overrides: Partial<QueueSeam> = {}) {
  const enqueued: [string, string][] = [];
  const seam: QueueSeam = {
    fetchMain: () => true,
    head: () => "abc123",
    pullRequest: () => ({ id: "PR_node", headRefOid: "abc123" }),
    mergeTree: () => ({ status: 0, output: "treeoid\n", stderr: "" }),
    check: () => ({ status: 0, output: "ok\n" }),
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

  it("refuses when origin/main cannot be fetched", () => {
    const { seam, enqueued } = fakeSeam({ fetchMain: () => false });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("git fetch origin main failed");
    expect(enqueued).toEqual([]);
  });

  it("refuses when HEAD is not the PR head, naming both", () => {
    const { seam, enqueued } = fakeSeam({ head: () => "local1", pullRequest: () => ({ id: "x", headRefOid: "remote2" }) });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("local1");
    expect(text).toContain("remote2");
    expect(text).toContain("push");
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

  it("fetches main, reads HEAD and the PR, and merge-trees origin/main with HEAD, all in the given directory", () => {
    const { calls, seam } = recorded((command, args) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: "abc123\n" };
      if (command === "gh") return { status: 0, stdout: '{"id":"PR_node","headRefOid":"abc123"}' };
      if (args[0] === "fetch") return { status: 0 };
      return { status: 1, stdout: "treeoid\n", stderr: "warn" };
    });
    expect(seam.fetchMain()).toBe(true);
    expect(seam.head()).toBe("abc123");
    expect(seam.pullRequest(149)).toEqual({ id: "PR_node", headRefOid: "abc123" });
    expect(seam.mergeTree()).toMatchObject({ status: 1, output: "treeoid\nwarn", stderr: "warn" });
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["git", "fetch", "origin", "main"],
      ["git", "rev-parse", "HEAD"],
      ["gh", "pr", "view", "149", "--json", "id,headRefOid"],
      ["git", "merge-tree", "--write-tree", "origin/main", "HEAD"],
    ]);
    expect(calls.every((call) => call.cwd === "/work")).toBe(true);
  });

  it("runs the migration checks against origin/main with node", () => {
    const { calls, seam } = recorded(() => ({ status: 0, stdout: "ok" }));
    seam.check("drift");
    seam.check("immutable");
    expect(calls.map((call) => call.command)).toEqual([process.execPath, process.execPath]);
    expect(calls[0]?.args[0]).toMatch(/check-migration-drift\.ts$/);
    expect(calls[0]?.args.slice(1)).toEqual(["origin/main", "HEAD"]);
    expect(calls[1]?.args[0]).toMatch(/check-migrations-immutable\.ts$/);
    expect(calls[1]?.args.slice(1)).toEqual(["origin/main"]);
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
