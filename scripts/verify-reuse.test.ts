import { describe, expect, it } from "vitest";
import { stampLine, verifiedCommits } from "./verify-gate.ts";
import type { spawnSync } from "node:child_process";
import { fullRunMessage, projectOf, realReuseGit, reuseLine, reuseMessage, reuseSteps, testsOnlyReuse, type ReuseGit } from "./verify-reuse.ts";

// RP-1195 item 8: `pnpm verify --pr` re-runs only changed test files on top of an earlier stamped run.

const X = "aaaa111";
const fullLine = (sha = X, steps = "lint, typecheck, test:unit, test:seam1, test:seam2") => stampLine(`pnpm verify passed on ${sha}: ${steps}.`);

/** A first-parent chain head → … → X; `commits` maps each commit to its parents and changes. */
function fakeGit(commits: Record<string, { parents: string[]; changes?: { status: string; path: string }[]; tree?: string; bot?: boolean }>, overrides: Partial<ReuseGit> = {}): ReuseGit {
  return {
    parents: (commit) => commits[commit]?.parents ?? [],
    onMain: (commit) => commit.startsWith("m"),
    tree: (commit) => commits[commit]?.tree ?? `tree-${commit}`,
    mergedTree: (base, other) => `tree-merge-${base}-${other}`,
    identity: (commit) => (commits[commit]?.bot ? { author: "41898282+github-actions[bot]@users.noreply.github.com", committer: "41898282+github-actions[bot]@users.noreply.github.com" } : { author: "me@x", committer: "me@x" }),
    changedPaths: (commit) => (commits[commit]?.changes ?? []).map(({ path }) => path),
    changes: (commit) => commits[commit]?.changes ?? [],
    importers: () => [],
    ...overrides,
  };
}

const edit = (path: string) => ({ status: "M", path });

describe("projectOf", () => {
  it("names the vitest project of a test file the full run covers", () => {
    expect(projectOf("scripts/verify.test.ts")).toBe("test:unit");
    expect(projectOf("packages/db/src/x/y.test.ts")).toBe("test:unit");
    expect(projectOf("apps/web/src/a.test.ts")).toBe("test:unit");
    expect(projectOf("apps/api/test/links.test.ts")).toBe("test:seam1");
    expect(projectOf("apps/admin/test/x/y.test.ts")).toBe("test:seam1");
    expect(projectOf("packages/db/test/rls.test.ts")).toBe("test:seam2");
  });

  it("names none for code, helpers, the story tests and the projects verify never runs", () => {
    expect(projectOf("scripts/verify.ts")).toBeUndefined();
    expect(projectOf("apps/api/test/support/seed.ts")).toBeUndefined();
    expect(projectOf("packages/ui/test/stories.test.tsx")).toBeUndefined();
    expect(projectOf("apps/web/src/page.test.tsx")).toBeUndefined();
    expect(projectOf("packages/infra/test/stack.test.ts")).toBeUndefined();
    expect(projectOf("packages/mailer/test/send.test.ts")).toBeUndefined();
    expect(projectOf("docs/visibility/hidden-asserts/apps/api/test/links.test.ts.txt")).toBeUndefined();
  });
});

describe("testsOnlyReuse", () => {
  it("reuses the stamped run when the commits since it change only covered test files", () => {
    const git = fakeGit({ h2: { parents: ["h1"], changes: [edit("apps/api/test/links.test.ts")] }, h1: { parents: [X], changes: [edit("scripts/a.test.ts")] } });
    expect(testsOnlyReuse(`Body\n\n${fullLine()}\n`, "h2", git)).toEqual({
      reuse: true,
      earlier: X,
      earlierSteps: ["lint", "typecheck", "test:unit", "test:seam1", "test:seam2"],
      commits: 2,
      files: [
        { step: "test:seam1", path: "apps/api/test/links.test.ts" },
        { step: "test:unit", path: "scripts/a.test.ts" },
      ],
    });
  });

  it("takes the newest stamped commit on the way down, and steps over clean merges of main and screenshot-bot commits", () => {
    const old = "bbbb222";
    const git = fakeGit({
      h3: { parents: ["h2"], bot: true, changes: [{ status: "M", path: "packages/ui/test/__screenshots__/a.png" }] },
      h2: { parents: ["h1", "m9"], tree: "tree-merge-h1-m9", changes: [edit("apps/api/src/code.ts")] },
      h1: { parents: [X], changes: [edit("packages/db/test/rls.test.ts")] },
      [X]: { parents: [old], changes: [edit("apps/api/src/code.ts")] },
    });
    const reuse = testsOnlyReuse(`${fullLine(old)}\n${fullLine()}`, "h3", git);
    expect(reuse).toMatchObject({ reuse: true, earlier: X, commits: 1, files: [{ step: "test:seam2", path: "packages/db/test/rls.test.ts" }] });
  });

  it("runs the full verify when a commit since the stamp changes anything but a covered test file", () => {
    const cases: [string, { status: string; path: string }, RegExp][] = [
      ["code", edit("apps/api/src/code.ts"), /apps\/api\/src\/code\.ts is not a test file/],
      ["a test helper", edit("apps/api/test/support/seed.ts"), /apps\/api\/test\/support\/seed\.ts is not a test file/],
      ["a fixture", edit("scripts/queue-pr.fixtures.ts"), /is not a test file/],
      ["a repo-wide check's own test", edit("scripts/check-hidden-asserts.test.ts"), /CI's own files/],
      ["a story test", edit("packages/ui/test/stories.test.tsx"), /is not a test file/],
      ["an infra test", edit("packages/infra/test/stack.test.ts"), /is not a test file/],
      ["a deleted test", { status: "D", path: "scripts/a.test.ts" }, /scripts\/a\.test\.ts is deleted/],
    ];
    for (const [, change, why] of cases) {
      const git = fakeGit({ h1: { parents: [X], changes: [edit("scripts/b.test.ts"), change] } });
      const reuse = testsOnlyReuse(fullLine(), "h1", git);
      expect(reuse.reuse).toBe(false);
      expect(reuse.reuse ? "" : reuse.why).toMatch(why);
    }
  });

  // RP-1195 review: a test file another file imports is code that file runs, so changing it can change that file's verdict.
  it("runs the full verify when another file imports a changed test file", () => {
    const asked: string[] = [];
    const git = fakeGit(
      { h1: { parents: [X], changes: [edit("scripts/a.test.ts"), edit("apps/api/test/links.test.ts")] } },
      { importers: (path) => (asked.push(path), path === "apps/api/test/links.test.ts" ? ["apps/api/test/more.test.ts", "apps/api/test/other.test.ts"] : []) },
    );
    expect(testsOnlyReuse(fullLine(), "h1", git)).toEqual({ reuse: false, why: "apps/api/test/links.test.ts is imported by apps/api/test/more.test.ts (and 1 more), so it is not only a test" });
    expect(asked).toEqual(["scripts/a.test.ts", "apps/api/test/links.test.ts"]);
  });

  it("runs the full verify when the body has no stamped line, or only an unstamped one", () => {
    const git = fakeGit({ h1: { parents: [X], changes: [edit("scripts/a.test.ts")] } });
    expect(testsOnlyReuse("no line here", "h1", git)).toEqual({ reuse: false, why: "the PR body has no stamped verify line to build on" });
    expect(testsOnlyReuse(`pnpm verify passed on ${X}: lint, typecheck, test:unit, test:seam1, test:seam2. Stamp 0123456789abcdef.`, "h1", git)).toEqual({ reuse: false, why: "the PR body has no stamped verify line to build on" });
  });

  it("runs the full verify when the stamped commit is not below HEAD", () => {
    const git = fakeGit({ h1: { parents: ["h0"], changes: [edit("scripts/a.test.ts")] }, h0: { parents: [] } });
    const reuse = testsOnlyReuse(fullLine(), "h1", git);
    expect(reuse).toEqual({ reuse: false, why: `no stamped commit in the PR body (${X}) is below HEAD on its first-parent line` });
  });

  it("runs the full verify across a merge that is not a clean merge of main", () => {
    const evil = fakeGit({ h2: { parents: ["h1", "m9"], tree: "edited" }, h1: { parents: [X], changes: [edit("scripts/a.test.ts")] } });
    expect(testsOnlyReuse(fullLine(), "h2", evil)).toEqual({ reuse: false, why: "h2 is a merge, not a clean merge of main" });
    const branch = fakeGit({ h2: { parents: ["h1", "other"], tree: "tree-merge-h1-other" }, h1: { parents: [X] } });
    expect(testsOnlyReuse(fullLine(), "h2", branch)).toEqual({ reuse: false, why: "h2 is a merge, not a clean merge of main" });
  });

  it("runs the full verify when the stamp is on HEAD or only clean commits lead to it", () => {
    const head = "cccc3330";
    const git = fakeGit({ [head]: { parents: [X, "m1"], tree: `tree-merge-${X}-m1` } });
    expect(testsOnlyReuse(fullLine(head), head, git)).toEqual({ reuse: false, why: `the stamped line on ${head} already covers HEAD, so there are no changed test files to re-run` });
    expect(testsOnlyReuse(fullLine(), head, git)).toEqual({ reuse: false, why: `the stamped line on ${X} already covers HEAD, so there are no changed test files to re-run` });
  });

  it("runs the full verify when the stamped run did not run a changed file's project", () => {
    const git = fakeGit({ h1: { parents: [X], changes: [edit("packages/db/test/rls.test.ts")] } });
    const reuse = testsOnlyReuse(fullLine(X, "lint, typecheck, test:unit, test:seam1"), "h1", git);
    expect(reuse).toEqual({ reuse: false, why: `the stamped run on ${X} did not run test:seam2, which packages/db/test/rls.test.ts is in` });
  });

  it("runs the full verify when git cannot be read", () => {
    const git = fakeGit({}, { parents: () => { throw new Error("git rev-list failed"); } });
    expect(testsOnlyReuse(fullLine(), "h1", git)).toEqual({ reuse: false, why: "git could not be read (git rev-list failed)" });
  });
});

describe("reuseSteps", () => {
  it("runs lint, typecheck and the whole unit project, and only the changed files of a seam project", () => {
    const git = fakeGit({ h1: { parents: [X], changes: [edit("scripts/a.test.ts"), edit("packages/db/test/rls.test.ts"), edit("packages/db/test/b.test.ts")] } });
    const reuse = testsOnlyReuse(fullLine(), "h1", git);
    if (!reuse.reuse) throw new Error(reuse.why);
    expect(reuseSteps(reuse)).toEqual([
      { name: "lint", script: "lint" },
      { name: "typecheck", script: "typecheck" },
      { name: "test:unit", script: "test:unit" },
      { name: "test:seam2", script: "test:seam2", files: ["packages/db/test/b.test.ts", "packages/db/test/rls.test.ts"] },
    ]);
  });
});

describe("reuseLine", () => {
  const git = fakeGit({ h1: { parents: [X], changes: [edit("apps/api/test/a.test.ts"), edit("apps/api/test/b.test.ts")] } });
  const reuse = testsOnlyReuse(fullLine(X, "lint, typecheck, test:unit, test:seam1, test:seam2, test:stories"), "h1", git);
  if (!reuse.reuse) throw new Error(reuse.why);

  it("is a stamped line for HEAD naming what it re-ran and what it takes from the earlier run", () => {
    const line = reuseLine({ sha: "dddd444", dirty: false, reuse, passed: ["lint", "typecheck", "test:unit", "test:seam1"] });
    expect(line).toBe(
      stampLine(`pnpm verify passed on dddd444: lint, typecheck, test:unit, test:seam1 (re-ran 2 changed test files on top of ${X}'s run), test:seam2 (${X}'s run), test:stories (${X}'s run).`),
    );
    expect(verifiedCommits(line)).toEqual(["dddd444"]);
  });

  it("keeps a timed-out re-run's note", () => {
    const line = reuseLine({ sha: "dddd444", dirty: false, reuse, passed: ["lint", "typecheck", "test:unit", "test:seam1 (re-ran 1 timed-out file)"] });
    expect(line).toContain(`test:seam1 (re-ran 2 changed test files on top of ${X}'s run; re-ran 1 timed-out file)`);
    expect(verifiedCommits(line)).toEqual(["dddd444"]);
  });

  it("is never stamped on a dirty tree or an unknown commit", () => {
    const passed = ["lint", "typecheck", "test:unit", "test:seam1"];
    expect(verifiedCommits(reuseLine({ sha: "dddd444", dirty: true, reuse, passed }))).toEqual([]);
    expect(reuseLine({ sha: "dddd444", dirty: true, reuse, passed })).toContain("(dirty: uncommitted changes)");
    expect(verifiedCommits(reuseLine({ sha: "", dirty: false, reuse, passed }))).toEqual([]);
  });
});

describe("what verify --pr prints", () => {
  it("names the earlier run, the changed test files and --full when it builds on that run", () => {
    const git = fakeGit({ h1: { parents: [X], changes: [edit("apps/api/test/a.test.ts")] } });
    const reuse = testsOnlyReuse(fullLine(), "h1", git);
    if (!reuse.reuse) throw new Error(reuse.why);
    expect(reuseMessage(12, reuse)).toBe(
      [
        `pnpm verify --pr 12: building on the stamped run on ${X}: the branch's 1 commit since it change only 1 test file:`,
        "  apps/api/test/a.test.ts (test:seam1)",
        "It runs lint, typecheck and the whole test:unit, and of the seam suites only these files. `pnpm verify --pr 12 --full` runs everything.",
      ].join("\n"),
    );
  });

  it("says why it runs everything", () => {
    expect(fullRunMessage(12, "apps/api/src/code.ts is not a test file of the unit or seam projects")).toBe("pnpm verify --pr 12: full run: apps/api/src/code.ts is not a test file of the unit or seam projects.");
  });
});

describe("realReuseGit", () => {
  it("reads each path's status letter from git diff-tree", () => {
    const calls: string[][] = [];
    const spawn = ((command: string, args: string[]) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: "M\tscripts/a.test.ts\nA\tapps/api/test/b.test.ts\nD\tscripts/c.test.ts\n", stderr: "" };
    }) as unknown as typeof spawnSync;
    expect(realReuseGit("/repo", spawn).changes("abc")).toEqual([
      { status: "M", path: "scripts/a.test.ts" },
      { status: "A", path: "apps/api/test/b.test.ts" },
      { status: "D", path: "scripts/c.test.ts" },
    ]);
    expect(calls).toEqual([["git", "diff-tree", "--no-commit-id", "--name-status", "-r", "--no-renames", "abc"]]);
  });

  it("finds the files whose import specifiers name a test file, by its path without the extension", () => {
    const calls: string[][] = [];
    const spawn = ((command: string, args: string[]) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: "apps/api/test/more.test.ts\n", stderr: "" };
    }) as unknown as typeof spawnSync;
    expect(realReuseGit("/repo", spawn).importers("apps/api/test/nowhere.test.ts")).toEqual(["apps/api/test/more.test.ts"]);
    const [, , , , , pattern, , exclude] = calls[0]!;
    expect(calls[0]!.slice(0, 5)).toEqual(["git", "grep", "-l", "-E", "-e"]);
    expect(exclude).toBe(":(exclude)apps/api/test/nowhere.test.ts");
    const specifier = new RegExp(pattern!.replaceAll("[[:space:]]", "\\s"));
    for (const line of ['import { a } from "./nowhere.test.ts";', "import { a } from '../test/nowhere.test';", 'export * from "./nowhere.test.js";', 'const m = await import("./nowhere.test.ts");', 'import "./nowhere.test.ts";']) expect(specifier.test(line), line).toBe(true);
    for (const line of ['import { a } from "./nowhere.ts";', 'import { a } from "./xnowhere.test.ts";', 'const p = "apps/api/test/nowhere.test.ts";']) expect(specifier.test(line), line).toBe(false);
  });

  it("finds none on git grep's no-match exit, and fails on any other", () => {
    const answer = (status: number) => (() => ({ status, stdout: "", stderr: "fatal: bad" })) as unknown as typeof spawnSync;
    expect(realReuseGit("/repo", answer(1)).importers("scripts/a.test.ts")).toEqual([]);
    expect(() => realReuseGit("/repo", answer(128)).importers("scripts/a.test.ts")).toThrow(/git grep failed/);
  });
});
