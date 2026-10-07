import { describe, expect, it } from "vitest";
import { queuePr, type QueueSeam } from "./queue-pr.ts";

// A fake seam for a clean branch; each test overrides what it breaks.
function fakeSeam(overrides: Partial<QueueSeam> = {}) {
  const enqueued: [string, string][] = [];
  const seam: QueueSeam = {
    fetchMain: () => true,
    head: () => "abc123",
    pullRequest: () => ({ id: "PR_node", headRefOid: "abc123" }),
    mergeTree: () => ({ status: 0, output: "treeoid\n" }),
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
    const { seam, enqueued } = fakeSeam({ mergeTree: () => ({ status: 1, output }) });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("packages/ui/src/storybook/numbering.ts");
    expect(text).toContain("docs/other.md");
    expect(text).toContain("merge main");
    expect(enqueued).toEqual([]);
  });

  it("refuses a migration that shares a timestamp with origin/main, with the check's message", () => {
    const { seam, enqueued } = fakeSeam({
      check: (name) => (name === "drift" ? { status: 1, output: "20261220000000 is used by two migrations\n" } : { status: 0, output: "" }),
    });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("20261220000000 is used by two migrations");
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
