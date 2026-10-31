import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MERGE_CHECKS, mergeTreeOid, realMergeChecksSeam, runMergeChecks, type MergeChecksSeam } from "./merge-checks.ts";

/** A throwaway repo with `main` (as origin/main) and a PR commit on top of it; `files` are written on main, `prFiles` on the PR commit. */
function repoWith(files: Record<string, string>, prFiles: Record<string, string>) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "merge-checks-test-")));
  const git = (...args: string[]) => {
    const done = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (done.status !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
    return done.stdout.trim();
  };
  const write = (all: Record<string, string>) => {
    for (const [file, text] of Object.entries(all)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  write(files);
  git("add", "-A");
  git("commit", "-q", "-m", "main");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-q", "-c", "pr");
  write(prFiles);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "pr");
  const head = git("rev-parse", "HEAD");
  const tree = mergeTreeOid(git("merge-tree", "--write-tree", "origin/main", head)) ?? "";
  return { dir, head, tree, git, done: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("realMergeChecksSeam, on a throwaway repo", () => {
  it("runs the merge's own checks on a checkout of the merge, names a failing one, skips a missing one and removes the checkout", () => {
    const repo = repoWith(
      {
        "scripts/check-hidden-asserts.ts": 'export const repoHiddenAssertProblems = (repo: string) => (repo.length > 0 ? ["boom in the merge"] : []);\n',
        "scripts/check-migrations.ts": "process.exit(0);\n",
        "main-only.txt": "from main\n",
      },
      { "pr-only.txt": "from the PR\n" },
    );
    try {
      const before = repo.git("worktree", "list");
      const result = runMergeChecks(repo.tree, repo.head, realMergeChecksSeam(repo.dir));
      expect(result).toEqual({ ok: false, failures: [{ name: "check-hidden-asserts", lines: ["boom in the merge"] }] });
      expect(repo.git("worktree", "list")).toBe(before);
    } finally {
      repo.done();
    }
  });

  it("sees main's files and the PR's together, and passes when the checks do", () => {
    const repo = repoWith(
      {
        "scripts/check-hidden-asserts.ts": 'import { existsSync } from "node:fs";\nexport const repoHiddenAssertProblems = (repo: string) => (existsSync(repo + "/main-only.txt") && existsSync(repo + "/pr-only.txt") ? [] : ["not the merge"]);\n',
        "scripts/check-scenario-seams.ts": "export const repoSeamProblems = () => [];\n",
        "scripts/check-migrations.ts": "console.log('fine');\n",
        "main-only.txt": "from main\n",
      },
      { "pr-only.txt": "from the PR\n" },
    );
    try {
      expect(runMergeChecks(repo.tree, repo.head, realMergeChecksSeam(repo.dir))).toEqual({ ok: true, skipped: [] });
    } finally {
      repo.done();
    }
  });

  it("reports a crashing check as not run, and a failing script check by its output", () => {
    const repo = repoWith(
      {
        "scripts/check-hidden-asserts.ts": 'export const repoHiddenAssertProblems = () => { throw new Error("kaboom"); };\n',
        "scripts/check-migrations.ts": 'console.error("two migrations share a day"); process.exit(1);\n',
      },
      {},
    );
    try {
      const result = runMergeChecks(repo.tree, repo.head, realMergeChecksSeam(repo.dir));
      expect(result.ok).toBe(false);
      const failures = !result.ok ? result.failures : [];
      expect(failures[0]?.lines[0]).toContain("did not run");
      expect(failures[0]?.lines.join(" ")).toContain("kaboom");
      expect(failures[1]).toEqual({ name: "check:migrations", lines: ["two migrations share a day"] });
      expect(existsSync(repo.dir)).toBe(true);
    } finally {
      repo.done();
    }
  });
});

function fakeSeam(overrides: Partial<MergeChecksSeam> = {}) {
  const calls: string[] = [];
  const seam: MergeChecksSeam = {
    checkout: (tree, head) => {
      calls.push(`checkout ${tree} ${head}`);
      return "/tmp/merge";
    },
    remove: (path) => void calls.push(`remove ${path}`),
    exists: () => true,
    runModule: (_path, check) => {
      calls.push(`module ${check.name}`);
      return { status: 0, output: "", problems: [] };
    },
    runScript: (_path, check) => {
      calls.push(`script ${check.name}`);
      return { status: 0, output: "ok\n" };
    },
    ...overrides,
  };
  return { seam, calls };
}

describe("mergeTreeOid", () => {
  it("is the first line of a clean `git merge-tree --write-tree` answer", () => {
    const oid = "0123abcd".repeat(5);
    expect(mergeTreeOid(`${oid}\n`)).toBe(oid);
    expect(mergeTreeOid(`${oid}\nAuto-merging x\n`)).toBe(oid);
  });

  it("is undefined for output that is no object name", () => {
    expect(mergeTreeOid("")).toBeUndefined();
    expect(mergeTreeOid("fatal: nope\n")).toBeUndefined();
  });
});

describe("runMergeChecks", () => {
  it("names the three checks the ticket asks for", () => {
    expect(MERGE_CHECKS.map((check) => check.name)).toEqual(["check-hidden-asserts", "check-scenario-seams", "check:migrations"]);
  });

  it("runs each check on a checkout of the merge, then removes the checkout", () => {
    const { seam, calls } = fakeSeam();
    expect(runMergeChecks("tree1", "head1", seam)).toEqual({ ok: true, skipped: [] });
    expect(calls).toEqual(["checkout tree1 head1", "module check-hidden-asserts", "module check-scenario-seams", "script check:migrations", "remove /tmp/merge"]);
  });

  it("fails naming the check and its problems, and still runs the rest", () => {
    const { seam, calls } = fakeSeam({
      runModule: (_path, check) => ({ status: check.name === "check-hidden-asserts" ? 1 : 0, output: "", problems: check.name === "check-hidden-asserts" ? ["a.test.ts:3: a hidden assert"] : [] }),
    });
    const result = runMergeChecks("tree1", "head1", seam);
    expect(result).toEqual({ ok: false, failures: [{ name: "check-hidden-asserts", lines: ["a.test.ts:3: a hidden assert"] }] });
    expect(calls).toContain("script check:migrations");
    expect(calls.at(-1)).toBe("remove /tmp/merge");
  });

  it("fails on a script check's output when it exits non-zero", () => {
    const { seam } = fakeSeam({ runScript: () => ({ status: 1, output: "two migrations share 20271101000000\n" }) });
    expect(runMergeChecks("t", "h", seam)).toEqual({ ok: false, failures: [{ name: "check:migrations", lines: ["two migrations share 20271101000000"] }] });
  });

  it("fails, never passes, when a check crashes", () => {
    const { seam } = fakeSeam({ runModule: () => ({ status: 1, output: "TypeError: x is not a function\n", problems: [] }) });
    const result = runMergeChecks("t", "h", seam);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failures[0]?.lines).toEqual(["did not run: TypeError: x is not a function"]);
  });

  it("skips, and says so, a check whose file the merge does not have (main from before it existed)", () => {
    const { seam, calls } = fakeSeam({ exists: (_path, file) => file !== "scripts/check-scenario-seams.ts" });
    expect(runMergeChecks("t", "h", seam)).toEqual({ ok: true, skipped: ["check-scenario-seams"] });
    expect(calls).not.toContain("module check-scenario-seams");
  });

  it("removes the checkout when a check throws, and rethrows", () => {
    const { seam, calls } = fakeSeam({
      runModule: () => {
        throw new Error("spawn failed");
      },
    });
    expect(() => runMergeChecks("t", "h", seam)).toThrow("spawn failed");
    expect(calls.at(-1)).toBe("remove /tmp/merge");
  });
});
