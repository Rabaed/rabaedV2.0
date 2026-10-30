import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeRefusal, readMergeState } from "./merge-in-progress.ts";

describe("readMergeState", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "merge-state-"));
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "visibility.md"), "one\n");
    writeFileSync(join(repo, "other.md"), "x\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("switch", "-qc", "side");
    writeFileSync(join(repo, "visibility.md"), "side\n");
    git("commit", "-qam", "side");
    git("switch", "-q", "main");
    writeFileSync(join(repo, "visibility.md"), "main\n");
    git("commit", "-qam", "main");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("says no merge is in progress in a clean repo", () => {
    expect(readMergeState(repo)).toEqual({ inProgress: false });
  });

  it("names the conflicted files while a failed merge leaves MERGE_HEAD", () => {
    try {
      git("merge", "side");
    } catch {
      // The conflict is the point.
    }
    expect(readMergeState(repo)).toEqual({ inProgress: true, conflicted: ["visibility.md"] });
  });

  it("is clear again after `git merge --abort`", () => {
    try {
      git("merge", "side");
    } catch {
      // The conflict is the point.
    }
    git("merge", "--abort");
    expect(readMergeState(repo)).toEqual({ inProgress: false });
  });
});

describe("mergeRefusal", () => {
  it("says nothing when no merge is in progress", () => {
    expect(mergeRefusal({ inProgress: false }, "pnpm verify")).toBeUndefined();
  });

  it("names the conflicted files and both ways out", () => {
    const message = mergeRefusal({ inProgress: true, conflicted: ["docs/visibility.md", "scripts/a.ts"] }, "pnpm verify");
    expect(message).toContain("pnpm verify refused: a merge is in progress (MERGE_HEAD exists)");
    expect(message).toContain("  docs/visibility.md\n  scripts/a.ts");
    expect(message).toContain("git merge --abort");
    expect(message).toContain("git commit");
  });

  it("says so when the merge has no conflicted file left, only an uncommitted merge", () => {
    const message = mergeRefusal({ inProgress: true, conflicted: [] }, "Push");
    expect(message).toContain("Push refused: a merge is in progress (MERGE_HEAD exists)");
    expect(message).toContain("No conflicted file is left");
  });
});
