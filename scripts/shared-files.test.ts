import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { branchMix } from "./shared-files.ts";

// branchMix (RP-993) in a throwaway repository whose origin/main is its first commit:
// what `pnpm verify` and the pre-push hook say before `pnpm queue` would refuse the branch.
let repo: string;
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();

const admin = (devDependencies: Record<string, string>, scripts = { dev: "vite" }) => `${JSON.stringify({ name: "admin", scripts, devDependencies }, null, 2)}\n`;

function write(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
}

const commit = (files: Record<string, string>) => {
  write(files);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "change");
  return git("rev-parse", "HEAD");
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "rabaed-shared-files-"));
  git("init", "-q", "-b", "main");
  commit({ "pnpm-lock.yaml": "lock: 1\n", "apps/admin/package.json": admin({ a: "1.0.0" }), "apps/admin/src/a.ts": "export const a = 1;\n" });
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-q", "-c", "feature");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const dependency = { "pnpm-lock.yaml": "lock: 2\n", "apps/admin/package.json": admin({ a: "1.0.0", b: "2.0.0" }) };

describe("branchMix", () => {
  it("names a lockfile and dependency change beside code, and says to put the dependencies in their own PR first", () => {
    const head = commit({ ...dependency, "apps/admin/src/a.ts": "export const a = 2;\n" });
    const text = branchMix(repo, head)?.join("\n") ?? "";
    expect(text).toContain("shared: pnpm-lock.yaml");
    expect(text).toContain("apps/admin/src/a.ts");
    expect(text).toContain("open a dependencies-only PR first");
    expect(text).toContain('docs/agents/issue-tracker.md › "Ticket: workspace dependencies"');
  });

  it("leaves a workflow mix to check:claims (RP-1199): workflows beside code, changed or deleted, get no second warning", () => {
    const changed = commit({ ".github/workflows/ci.yml": "name: ci\n", "apps/admin/src/a.ts": "export const a = 2;\n" });
    expect(branchMix(repo, changed)).toBeUndefined();
    // Now the workflow is on origin/main, and the branch deletes it beside a code change.
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("rm", "-q", ".github/workflows/ci.yml");
    const deleted = commit({ "apps/admin/src/a.ts": "export const a = 3;\n" });
    expect(branchMix(repo, deleted)).toBeUndefined();
  });

  it("still names package.json and the lockfile beside code when workflows are in the branch too, without listing the workflows", () => {
    const head = commit({ "package.json": "{}\n", ".github/workflows/ci.yml": "name: ci\n", "apps/admin/src/a.ts": "export const a = 2;\n" });
    const text = branchMix(repo, head)?.join("\n") ?? "";
    expect(text).toContain("shared: package.json");
    expect(text).toContain("e.g. apps/admin/src/a.ts");
    expect(text).not.toContain(".github/workflows/ci.yml");
  });

  it("passes a dependencies-only branch: the lockfile and the dependency fields of a workspace package.json", () => {
    const head = commit(dependency);
    expect(branchMix(repo, head)).toBeUndefined();
  });

  it("passes a branch that changes only code", () => {
    const head = commit({ "apps/admin/src/a.ts": "export const a = 2;\n" });
    expect(branchMix(repo, head)).toBeUndefined();
  });

  it("names a workspace package.json whose scripts change beside the lockfile", () => {
    const head = commit({ "pnpm-lock.yaml": "lock: 2\n", "apps/admin/package.json": admin({ a: "1.0.0", b: "2.0.0" }, { dev: "vite --host" }) });
    const text = branchMix(repo, head)?.join("\n") ?? "";
    expect(text).toContain("apps/admin/package.json");
    expect(text).toContain("only its dependency fields");
  });

  it("names a deleted workspace package.json beside the lockfile, and a code file renamed to Markdown beside it", () => {
    git("rm", "-q", "apps/admin/package.json");
    const deleted = commit({ "pnpm-lock.yaml": "lock: 2\n" });
    expect(branchMix(repo, deleted)?.join("\n")).toContain("e.g. apps/admin/package.json");
    git("reset", "-q", "--hard", "origin/main");
    git("mv", "apps/admin/src/a.ts", "apps/admin/src/a.md");
    const renamed = commit({ "pnpm-lock.yaml": "lock: 2\n" });
    expect(branchMix(repo, renamed)?.join("\n")).toContain("e.g. apps/admin/src/a.ts");
  });

  it("judges the branch against where it left origin/main, not main's tip: a lockfile change on main is not the branch's", () => {
    const head = commit({ "apps/admin/src/a.ts": "export const a = 2;\n" });
    git("switch", "-q", "main");
    commit({ "pnpm-lock.yaml": "lock: 3\n" });
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("switch", "-q", "feature");
    expect(branchMix(repo, head)).toBeUndefined();
  });

  it("without a commit reads the working tree, uncommitted and untracked files too", () => {
    commit(dependency);
    expect(branchMix(repo)).toBeUndefined();
    write({ "apps/admin/src/new.ts": "export const n = 1;\n" });
    expect(branchMix(repo)?.join("\n")).toContain("apps/admin/src/new.ts");
  });

  it("throws, naming the fix, when there is no origin/main to compare with", () => {
    git("update-ref", "-d", "refs/remotes/origin/main");
    expect(() => branchMix(repo)).toThrow(/git fetch origin main/);
  });
});
