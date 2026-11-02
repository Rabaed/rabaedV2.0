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

// RP-1195 item 7: root package.json may ride with code when it only adds `node scripts/<file>` entries for files the branch adds.
describe("branchMix: root package.json that only adds scripts for new scripts", () => {
  const root = (scripts: Record<string, string>, extra: Record<string, unknown> = {}) => `${JSON.stringify({ name: "rabaed", private: true, scripts, ...extra }, null, 2)}\n`;
  const mainScripts = { lint: "eslint .", "check:x": "node scripts/old.ts" };

  beforeEach(() => {
    git("switch", "-q", "main");
    commit({ "package.json": root(mainScripts), "scripts/old.ts": "export {};\n" });
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("switch", "-q", "-C", "feature");
  });

  const newScript = { "scripts/new.ts": "export {};\n", "scripts/new.test.ts": "export {};\n", "apps/admin/src/a.ts": "export const a = 2;\n" };

  it("passes one added entry `node scripts/new.ts` beside the added scripts/new.ts, its test and other code", () => {
    const head = commit({ ...newScript, "package.json": root({ ...mainScripts, "check:new": "node scripts/new.ts" }) });
    expect(branchMix(repo, head)).toBeUndefined();
  });

  it("passes it in the working tree too, with the new script still untracked", () => {
    write({ ...newScript, "package.json": root({ ...mainScripts, "check:new": "node scripts/new.ts" }) });
    expect(branchMix(repo)).toBeUndefined();
  });

  it("passes two added entries for two added scripts, placed between existing entries", () => {
    const head = commit({ ...newScript, "scripts/two.ts": "export {};\n", "package.json": root({ "check:new": "node scripts/new.ts", lint: "eslint .", two: "node scripts/two.ts", "check:x": "node scripts/old.ts" }) });
    expect(branchMix(repo, head)).toBeUndefined();
  });

  const refused = (packageJson: string, files: Record<string, string> = newScript) => branchMix(repo, commit({ ...files, "package.json": packageJson }))?.join("\n") ?? "";

  it("refuses an added entry naming a script already on main", () => {
    expect(refused(root({ ...mainScripts, again: "node scripts/old.ts" }))).toContain("shared: package.json");
  });

  it("refuses an added entry naming a script that is in neither main nor the branch", () => {
    expect(refused(root({ ...mainScripts, ghost: "node scripts/ghost.ts" }))).toContain("shared: package.json");
  });

  it("refuses an added entry for a new script when an existing entry's command also changes", () => {
    expect(refused(root({ ...mainScripts, lint: "eslint . --fix", "check:new": "node scripts/new.ts" }))).toContain("shared: package.json");
  });

  it("refuses an added entry for a new script when an existing entry is removed", () => {
    expect(refused(root({ lint: "eslint .", "check:new": "node scripts/new.ts" }))).toContain("shared: package.json");
  });

  it("refuses an added entry for a new script when another field changes (devDependencies, name)", () => {
    expect(refused(root({ ...mainScripts, "check:new": "node scripts/new.ts" }, { devDependencies: { vitest: "1.0.0" } }))).toContain("shared: package.json");
    git("reset", "-q", "--hard", "origin/main");
    expect(refused(root({ ...mainScripts, "check:new": "node scripts/new.ts" }).replace('"rabaed"', '"other"'))).toContain("shared: package.json");
  });

  it("refuses an added entry that is not exactly `node scripts/<file>`: extra args, a chain, pnpm, a subfolder", () => {
    for (const command of ["node scripts/new.ts --fix", "node scripts/new.ts && eslint .", "pnpm exec node scripts/new.ts", "node scripts/sub/new.ts"]) {
      git("reset", "-q", "--hard", "origin/main");
      expect(refused(root({ ...mainScripts, "check:new": command }), { ...newScript, "scripts/sub/new.ts": "export {};\n" }), command).toContain("shared: package.json");
    }
  });

  it("refuses an added lifecycle name (postinstall runs on every install) even for an added script", () => {
    expect(refused(root({ ...mainScripts, postinstall: "node scripts/new.ts" }))).toContain("shared: package.json");
  });

  it("refuses an added pre<x> hook for an existing entry (prelint runs before lint) even for an added script", () => {
    expect(refused(root({ ...mainScripts, prelint: "node scripts/new.ts" }))).toContain("shared: package.json");
  });

  it("refuses an added post<x> even with no <x> yet (postfoo), so a later `foo` cannot wake it", () => {
    expect(refused(root({ ...mainScripts, postfoo: "node scripts/new.ts" }))).toContain("shared: package.json");
  });

  it("passes `pr:status`: it starts with pr, not pre, so it is no hook", () => {
    const head = commit({ ...newScript, "package.json": root({ ...mainScripts, "pr:status": "node scripts/new.ts" }) });
    expect(branchMix(repo, head)).toBeUndefined();
  });

  it("refuses a package.json that adds no entry at all (a reformat) beside code", () => {
    expect(refused(JSON.stringify({ name: "rabaed", private: true, scripts: mainScripts }))).toContain("shared: package.json");
  });

  it("refuses an unparsable package.json, failing closed", () => {
    expect(refused(`${root({ ...mainScripts, "check:new": "node scripts/new.ts" })},`)).toContain("shared: package.json");
  });

  it("still names the lockfile when it rides along with an exempt package.json", () => {
    const text = refused(root({ ...mainScripts, "check:new": "node scripts/new.ts" }), { ...newScript, "pnpm-lock.yaml": "lock: 2\n" });
    expect(text).toContain("shared: pnpm-lock.yaml");
    expect(text).not.toContain("shared: package.json");
  });
});
