import type { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { keepsLabel, dropLabelOnPush, realGit, type ReviewedGit } from "./reviewed-label.ts";

// A clean merge of main into the reviewed head: before = R, main commit = M, new head = N.
function git(overrides: Partial<ReviewedGit> = {}): ReviewedGit {
  return {
    parents: () => ["R", "M"],
    onMain: (commit) => commit === "M",
    tree: () => "tree1",
    mergedTree: () => "tree1",
    ...overrides,
  };
}

describe("keepsLabel", () => {
  it("keeps the label for a clean merge of main into the reviewed head", () => {
    expect(keepsLabel("R", "N", git())).toBe(true);
  });

  it("drops it for an ordinary commit (one parent)", () => {
    expect(keepsLabel("R", "N", git({ parents: () => ["R"] }))).toBe(false);
  });

  it("drops it when the first parent is not the reviewed head (a rebase, a force push)", () => {
    expect(keepsLabel("R", "N", git({ parents: () => ["other", "M"] }))).toBe(false);
  });

  it("drops it when the merged commit is not on main (another feature branch)", () => {
    expect(keepsLabel("R", "N", git({ onMain: () => false }))).toBe(false);
  });

  it("drops it when the merge has its own changes (a conflict resolution or an edit)", () => {
    expect(keepsLabel("R", "N", git({ tree: () => "tree-with-edits" }))).toBe(false);
  });

  it("drops it when main cannot be merged cleanly into the reviewed head", () => {
    expect(keepsLabel("R", "N", git({ mergedTree: () => undefined }))).toBe(false);
  });

  it("drops it for an octopus merge", () => {
    expect(keepsLabel("R", "N", git({ parents: () => ["R", "M", "M2"] }))).toBe(false);
  });

  it("drops it when git cannot answer (the old head is gone)", () => {
    expect(
      keepsLabel(
        "R",
        "N",
        git({
          parents: () => {
            throw new Error("bad object");
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("dropLabelOnPush", () => {
  function recorder() {
    const removed: number[] = [];
    return { removed, github: { removeLabel: async (pr: number) => void removed.push(pr) } };
  }

  it("removes the label on a new push", async () => {
    const { removed, github } = recorder();
    const text = await dropLabelOnPush({ pr: 7, labels: ["reviewed", "x"], before: "R", after: "N" }, git({ parents: () => ["R"] }), github);
    expect(removed).toEqual([7]);
    expect(text).toContain("removed");
    expect(text).toContain("--add-label reviewed");
  });

  it("keeps the label when the push only merged main in", async () => {
    const { removed, github } = recorder();
    const text = await dropLabelOnPush({ pr: 7, labels: ["reviewed"], before: "R", after: "N" }, git(), github);
    expect(removed).toEqual([]);
    expect(text).toContain("stays");
  });

  it("does nothing when the PR has no label", async () => {
    const { removed, github } = recorder();
    await dropLabelOnPush({ pr: 7, labels: ["other"], before: "R", after: "N" }, git({ parents: () => ["R"] }), github);
    expect(removed).toEqual([]);
  });
});

describe("realGit", () => {
  function recorded(answer: (args: string[]) => { status: number | null; stdout?: string }) {
    const calls: string[][] = [];
    const spawn = ((_command: string, args: string[]) => {
      calls.push(args);
      return answer(args);
    }) as unknown as typeof spawnSync;
    return { calls, git: realGit("/work", spawn) };
  }

  it("reads parents, the tree, and ancestry on origin/main", () => {
    const { calls, git: real } = recorded((args) => (args[0] === "merge-base" ? { status: 1 } : { status: 0, stdout: args[0] === "rev-list" ? "N R M\n" : "treeid\n" }));
    expect(real.parents("N")).toEqual(["R", "M"]);
    expect(real.tree("N")).toBe("treeid");
    expect(real.onMain("M")).toBe(false);
    expect(calls).toEqual([["rev-list", "--parents", "-n", "1", "N"], ["rev-parse", "N^{tree}"], ["merge-base", "--is-ancestor", "M", "origin/main"]]);
  });

  it("returns the merged tree for a clean merge-tree and undefined for a conflict", () => {
    expect(recorded(() => ({ status: 0, stdout: "treeoid\n" })).git.mergedTree("R", "M")).toBe("treeoid");
    expect(recorded(() => ({ status: 1, stdout: "treeoid\nCONFLICT" })).git.mergedTree("R", "M")).toBeUndefined();
  });
});
