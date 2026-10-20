import type { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { keepsLabel, dropLabelOnPush, onlyMainMergedSince, realGit, type ReviewedGit } from "./reviewed-label.ts";

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

// RP-1017: `pnpm queue` takes a verify run on an older head when only clean merges of main followed it.
describe("onlyMainMergedSince", () => {
  // V (verified) <- N1 (merges main M1) <- N2 (merges main M2); E is an ordinary commit on top of N1.
  const graph: Record<string, string[]> = { N2: ["N1", "M2"], N1: ["V", "M1"], E: ["N1"], V: ["P"] };
  const chain = (overrides: Partial<ReviewedGit> = {}) => git({ parents: (commit) => graph[commit] ?? [], onMain: (commit) => commit.startsWith("M"), ...overrides });

  it("accepts the verified commit itself", () => {
    expect(onlyMainMergedSince("V", "V", chain())).toBe(true);
  });

  it("accepts a head reached from it by clean merges of main only, each one as keepsLabel decides", () => {
    expect(onlyMainMergedSince("V", "N1", chain())).toBe(true);
    expect(onlyMainMergedSince("V", "N2", chain())).toBe(true);
  });

  it("accepts an abbreviated verified sha (pnpm verify prints git's short form)", () => {
    expect(onlyMainMergedSince("abc1234", "abc1234def5678", chain())).toBe(true);
  });

  it("refuses when any later commit is not a clean merge of main", () => {
    expect(onlyMainMergedSince("V", "E", chain())).toBe(false);
    expect(onlyMainMergedSince("V", "N2", chain({ tree: (commit) => (commit === "N1" ? "edited" : "tree1") }))).toBe(false);
    expect(onlyMainMergedSince("V", "N2", chain({ onMain: (commit) => commit === "M2" }))).toBe(false);
  });

  it("refuses a commit the head does not descend from, and a newer head than the one verified", () => {
    expect(onlyMainMergedSince("X", "N2", chain())).toBe(false);
    expect(onlyMainMergedSince("N2", "V", chain())).toBe(false);
  });

  it("refuses when git cannot answer", () => {
    const broken = chain({
      parents: () => {
        throw new Error("bad object");
      },
    });
    expect(onlyMainMergedSince("V", "N1", broken)).toBe(false);
  });
});

describe("dropLabelOnPush", () => {
  function recorder() {
    const removed: number[] = [];
    return { removed, github: { removeLabel: async (pr: number) => void removed.push(pr) } };
  }

  it("removes the label on a new push", async () => {
    const { removed, github } = recorder();
    const text = await dropLabelOnPush({ pr: 7, action: "synchronize", labels: ["reviewed", "x"], before: "R", after: "N" }, git({ parents: () => ["R"] }), github);
    expect(removed).toEqual([7]);
    expect(text).toContain("removed");
    expect(text).toContain("--add-label reviewed");
  });

  it("keeps the label when the push only merged main in", async () => {
    const { removed, github } = recorder();
    const text = await dropLabelOnPush({ pr: 7, action: "synchronize", labels: ["reviewed"], before: "R", after: "N" }, git(), github);
    expect(removed).toEqual([]);
    expect(text).toContain("stays");
  });

  it("does nothing when the PR has no label", async () => {
    const { removed, github } = recorder();
    await dropLabelOnPush({ pr: 7, action: "synchronize", labels: ["other"], before: "R", after: "N" }, git({ parents: () => ["R"] }), github);
    expect(removed).toEqual([]);
  });

  it("does nothing when a PR opens without the label: the run only gives the head one for pnpm queue (RP-604)", async () => {
    const { removed, github } = recorder();
    const text = await dropLabelOnPush({ pr: 7, action: "opened", labels: [] }, git(), github);
    expect(removed).toEqual([]);
    expect(text).toContain("nothing to remove");
  });

  it("removes a label already there when a PR opens or reopens, even if git would keep it on a push (RP-604)", async () => {
    for (const action of ["opened", "reopened"]) {
      const { removed, github } = recorder();
      const text = await dropLabelOnPush({ pr: 7, action, labels: ["reviewed"], before: "R", after: "N" }, git(), github);
      expect(removed).toEqual([7]);
      expect(text).toContain(`the ${action} PR's head needs a /code-review`);
    }
  });
});

// The workflow file: every head of a same-repo PR must get a run, or `pnpm queue` waits for one forever (RP-604).
describe("reviewed-label.yml", () => {
  const source = readFileSync(join(dirname(import.meta.filename), "..", ".github", "workflows", "reviewed-label.yml"), "utf8");
  const wf = parse(source) as { on: Record<string, { types?: string[] }>; jobs: Record<string, { steps: { run?: string }[] }> };

  it("runs when a PR opens, reopens or gets a push, and on nothing else", () => {
    expect(wf.on).toEqual({ pull_request: { types: ["opened", "reopened", "synchronize"] } });
  });

  it("fetches the old head only when the event has one", () => {
    const fetch = Object.values(wf.jobs)[0]?.steps.find((s) => s.run?.includes("github.event.before"));
    expect(fetch?.run).toMatch(/if \[ -n "\$\{\{ github\.event\.before \}\}" \]/);
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
