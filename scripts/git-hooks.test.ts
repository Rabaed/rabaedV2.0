import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installHooks } from "./hooks-install.ts";

// The hooks in .githooks (RP-989), run by git itself in a throwaway repository
// that carries copies of them and of the scripts they call.
const here = import.meta.dirname;
let repo: string;
const author = ["-c", "user.name=test", "-c", "user.email=test@example.com"];
/** Runs git in a folder; the result carries the exit status, so a refused commit or push can be checked. */
const gitIn = (cwd: string, ...args: string[]) => spawnSync("git", [...author, ...args], { cwd, encoding: "utf8" });
const tryGit = (...args: string[]) => gitIn(repo, ...args);
const git = (...args: string[]) => execFileSync("git", [...author, ...args], { cwd: repo, encoding: "utf8" });

function write(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "rabaed-hooks-repo-"));
  git("init", "-q", "-b", "main");
  mkdirSync(join(repo, ".githooks"));
  mkdirSync(join(repo, "scripts"));
  copyFileSync(join(here, "..", ".githooks", "pre-commit"), join(repo, ".githooks", "pre-commit"));
  copyFileSync(join(here, "check-no-fonts.ts"), join(repo, "scripts", "check-no-fonts.ts"));
  copyFileSync(join(here, "check-secrets.ts"), join(repo, "scripts", "check-secrets.ts"));
  for (const script of ["check-design-personal-data.ts", "design-personal-data-allow.json"]) copyFileSync(join(here, script), join(repo, "scripts", script));
  write({ "README.md": "# repo\n" });
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "start");
  git("config", "core.hooksPath", ".githooks");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("pre-commit", () => {
  it("refuses a commit that stages a conflict marker", () => {
    write({ "apps/api/src/work-items.ts": "export const a = 1;\n<<<<<<< HEAD\nexport const b = 2;\n=======\nexport const b = 3;\n>>>>>>> origin/main\n" });
    git("add", "-A");
    const commit = tryGit("commit", "-q", "-m", "merge");
    expect(commit.status).not.toBe(0);
    expect(commit.stdout + commit.stderr).toContain("apps/api/src/work-items.ts:2: leftover conflict marker");
    expect(git("log", "--format=%s")).toBe("start\n");
  });

  it("refuses a merge commit that keeps a conflict marker (RP-631's integration branch)", () => {
    git("checkout", "-q", "-b", "feature");
    write({ "README.md": "# feature\n" });
    git("commit", "-q", "-am", "feature");
    git("checkout", "-q", "main");
    write({ "README.md": "# main\n" });
    git("commit", "-q", "-am", "main");
    expect(tryGit("merge", "-q", "feature").status).not.toBe(0);
    git("add", "README.md");
    const commit = tryGit("commit", "-q", "--no-edit");
    expect(commit.status).not.toBe(0);
    expect(commit.stdout + commit.stderr).toContain("README.md:1: leftover conflict marker");
  });

  it("refuses a conflict marker in a worktree too, once pnpm install turned the hooks on", () => {
    git("config", "--unset", "core.hooksPath");
    installHooks(repo, {});
    const worktree = `${repo}-worktree`;
    git("worktree", "add", "-q", "-b", "lane", worktree);
    try {
      writeFileSync(join(worktree, "README.md"), "<<<<<<< HEAD\n");
      gitIn(worktree, "add", "README.md");
      const commit = gitIn(worktree, "commit", "-q", "-m", "x");
      expect(commit.status).not.toBe(0);
      expect(commit.stderr).toContain("README.md:1: leftover conflict marker");
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  // RP-1100: the token is built from parts, so this file holds none.
  it("refuses a commit that stages a token, naming the file and line but not the token", () => {
    const token = ["ATA", "TT3", "aB3dE5gH7k".repeat(18)].join("");
    write({ "scripts/upload.sh": ["#!/bin/sh\ncurl -", `u someone@example.com:${token} https://example.atlassian.net\n`].join("") });
    git("add", "-A");
    const commit = tryGit("commit", "-q", "-m", "upload");
    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain("scripts/upload.sh:2: Atlassian API token");
    expect(commit.stdout + commit.stderr).not.toContain(token.slice(0, 12));
    expect(git("log", "--format=%s")).toBe("start\n");
  });

  // RP-1168: the address is made up.
  it("refuses a commit that stages a real-looking email in design/, naming the file and line but not the address", () => {
    write({ "design/reference/access.html": "<p>Members</p>\n<p>jane.doe@gmail.com</p>\n" });
    git("add", "-A");
    const commit = tryGit("commit", "-q", "-m", "design");
    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain("design/reference/access.html:2: email");
    expect(commit.stdout + commit.stderr).not.toContain("jane.doe");
    expect(git("log", "--format=%s")).toBe("start\n");
  });

  it("lets a design page with placeholder contacts through, and a real-looking email outside design/", () => {
    write({ "design/reference/access.html": "<p>sara@example.com, 050 000 0000</p>\n", "docs/notes.md": "jane.doe@gmail.com\n" });
    git("add", "-A");
    expect(tryGit("commit", "-q", "-m", "design").status).toBe(0);
  });

  it("lets a commit through that reads the token from the environment", () => {
    write({ "scripts/upload.ts": "const token = process.env.JIRA_API_TOKEN;\n" });
    git("add", "-A");
    expect(tryGit("commit", "-q", "-m", "upload").status).toBe(0);
  });

  it("lets a commit through whose lines only have trailing spaces or a blank last line", () => {
    write({ "docs/notes.md": "A line with a hard break  \nnext\n\n" });
    git("add", "-A");
    expect(tryGit("commit", "-q", "-m", "notes").status).toBe(0);
  });
});

// pnpm's first run in a fresh folder can take half a minute (seen on a Windows lane).
describe("pre-push", { timeout: 60_000 }, () => {
  // A stand-in package.json whose lint exits with the given code; typecheck passes.
  function project(lintExit: number) {
    write({ "package.json": JSON.stringify({ name: "hooks-test", private: true, scripts: { lint: `node -e "process.exit(${lintExit})"`, typecheck: "node -e 0" } }) });
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", `lint exits ${lintExit}`);
  }

  beforeEach(() => {
    copyFileSync(join(here, "..", ".githooks", "pre-push"), join(repo, ".githooks", "pre-push"));
    for (const script of ["pre-push.ts", "shared-files.ts", "reviewed-required.ts", "reviewed-label.ts", "check-claims.ts", "claims.ts", "merge-in-progress.ts"]) copyFileSync(join(here, script), join(repo, "scripts", script));
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "hooks");
    git("init", "-q", "--bare", `${repo}-remote`);
    git("remote", "add", "origin", `${repo}-remote`);
  });

  afterEach(() => rmSync(`${repo}-remote`, { recursive: true, force: true }));

  it("refuses a push to a branch while lint fails", () => {
    project(1);
    const push = tryGit("push", "-q", "origin", "main");
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("pnpm lint failed (exit 1)");
    expect(tryGit("ls-remote", "--heads", "origin").stdout).toBe("");
  });

  it("lets the push go once lint and typecheck pass", () => {
    project(0);
    expect(tryGit("push", "-q", "origin", "main").status).toBe(0);
  });
});

describe("installHooks (pnpm install's prepare)", () => {
  const hooksPath = () => tryGit("config", "--get", "core.hooksPath").stdout.trim();

  beforeEach(() => git("config", "--unset", "core.hooksPath"));

  it("turns on the repo's hooks for the clone and every worktree", () => {
    installHooks(repo, {});
    expect(hooksPath()).toBe(".githooks");
  });

  it("leaves CI alone: its bot commits and pushes run no hooks", () => {
    installHooks(repo, { CI: "true" });
    expect(hooksPath()).toBe("");
  });

  it("does nothing outside a git repository (the Docker build has no .git)", () => {
    const folder = mkdtempSync(join(tmpdir(), "rabaed-no-git-"));
    try {
      expect(() => installHooks(folder, {})).not.toThrow();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("keeps a hooks path someone set on purpose, and says so", () => {
    git("config", "core.hooksPath", "/my/hooks");
    expect(installHooks(repo, {})).toContain("/my/hooks");
    expect(hooksPath()).toBe("/my/hooks");
  });
});
