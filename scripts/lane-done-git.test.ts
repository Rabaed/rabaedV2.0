import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aheadOf, filesNotInTarget } from "./lane-done-git.ts";

// RP-1170, rule 3, on a throwaway repository: a subagent worktree goes only when every path its branch
// changed is as in main, so a result cherry-picked onto the integration branch (and merged) counts.
let repo: string;
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();
const commit = (files: Record<string, string>, message: string) => {
  for (const [path, content] of Object.entries(files)) writeFileSync(join(repo, path), content);
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "rabaed-lane-done-"));
  git("init", "-q", "-b", "main");
  commit({ "a.ts": "a1\n", "b.ts": "b1\n" }, "start");
}, 30_000);

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("filesNotInTarget", () => {
  it("is empty for a branch whose change was cherry-picked onto main, though its commit is not there", () => {
    git("switch", "-q", "-c", "agent");
    const agent = commit({ "a.ts": "a2\n" }, "agent's work");
    git("switch", "-q", "main");
    commit({ "b.ts": "b-main\n" }, "main moved first");
    git("cherry-pick", agent);
    commit({ "b.ts": "b2\n" }, "later work on main");
    expect(aheadOf(agent, "main", repo)).toBe(1);
    expect(filesNotInTarget(agent, "main", repo)).toEqual([]);
  });

  it("names the paths whose change is not in main", () => {
    git("switch", "-q", "-c", "agent");
    const agent = commit({ "a.ts": "a2\n", "c.ts": "new\n" }, "agent's work");
    git("switch", "-q", "main");
    expect(filesNotInTarget(agent, "main", repo)).toEqual(["a.ts", "c.ts"]);
  });

  it("still lists a path main changed again after taking the branch's change, so lane:done keeps it rather than guess", () => {
    git("switch", "-q", "-c", "agent");
    const agent = commit({ "a.ts": "a2\n" }, "agent's work");
    git("switch", "-q", "main");
    commit({ "b.ts": "b-main\n" }, "main moved first");
    git("cherry-pick", agent);
    commit({ "a.ts": "a3\n" }, "main moved on in the same file");
    expect(filesNotInTarget(agent, "main", repo)).toEqual(["a.ts"]);
  });

  it("is empty for a branch with no change of its own", () => {
    git("switch", "-q", "-c", "agent");
    expect(filesNotInTarget(git("rev-parse", "HEAD"), "main", repo)).toEqual([]);
  });

  it("throws when git cannot tell", () => {
    expect(() => filesNotInTarget("0".repeat(40), "main", repo)).toThrow();
  });
});
