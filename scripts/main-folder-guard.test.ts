import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gitFallbackRefusal, type GitKind, refusal } from "./main-folder-guard.ts";

describe("the Bash|PowerShell hook entry in .claude/settings.json", () => {
  type Settings = { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } };
  const settings = JSON.parse(readFileSync(resolve(import.meta.dirname, "../.claude/settings.json"), "utf8")) as Settings;
  const command = settings.hooks.PreToolUse.find((e) => e.matcher === "Bash|PowerShell")?.hooks[0]?.command ?? "";
  // Claude Code runs hooks with Git Bash on Windows (bash.exe on PATH there may be WSL's): it sits beside git.
  const gitBash = () => process.env.CLAUDE_CODE_GIT_BASH_PATH ?? resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "../../../bin/bash.exe");
  const runHook = (projectDir: string) =>
    spawnSync(process.platform === "win32" ? gitBash() : "bash", ["-c", command], {
      input: JSON.stringify({ cwd: projectDir, tool_input: { command: "git status" } }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, RABAED_ALLOW_MAIN_FOLDER: "" },
      encoding: "utf8",
    });

  it("refuses every command when the worktree lost the guard's file", () => {
    const empty = mkdtempSync(join(tmpdir(), "guard-lost-"));
    try {
      const run = runHook(empty);
      expect(run.status).toBe(2);
      expect(run.stderr).toContain("this worktree lost its files (scripts/main-folder-guard.ts is missing): stop and ask");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("runs the guard when its file is there", () => {
    expect(runHook(resolve(import.meta.dirname, "..")).status).toBe(0);
  });
});

const main = resolve("/repo");
const worktree = resolve("/repo/.claude/worktrees/rp-1");
const gitKind = (dir: string): GitKind => (dir === main ? "dir" : dir === worktree ? "file" : undefined);

describe("refusal", () => {
  it("refuses a file in the main checkout, by absolute or relative path", () => {
    expect(refusal(resolve("/repo/GLOSSARY.md"), main, gitKind)).toMatch(/main checkout/);
    expect(refusal("docs/adr/0023-new.md", main, gitKind)).toMatch(/EnterWorktree/);
  });

  it("allows a file in a worktree, even a worktree inside the main checkout", () => {
    expect(refusal(resolve("/repo/.claude/worktrees/rp-1/GLOSSARY.md"), main, gitKind)).toBeUndefined();
    expect(refusal("GLOSSARY.md", worktree, gitKind)).toBeUndefined();
  });

  it("allows the main checkout's .claude folder", () => {
    expect(refusal(resolve("/repo/.claude/settings.local.json"), main, gitKind)).toBeUndefined();
  });

  it("refuses a .claude-like name that is not the folder", () => {
    expect(refusal(resolve("/repo/.claude-notes.md"), main, gitKind)).toMatch(/main checkout/);
  });

  it("allows a file outside any checkout", () => {
    expect(refusal(resolve("/elsewhere/notes.md"), main, gitKind)).toBeUndefined();
  });
});

describe("gitFallbackRefusal (RP-956)", () => {
  // rp-1 has its .git file; main-3 lost it (its worktree was removed under the session), so git falls back to /repo.
  const lost = resolve("/repo/.claude/worktrees/main-3-snag-days");

  it("refuses a HEAD- or branch-changing git command run from a worktree folder with no .git file", () => {
    for (const command of [
      "git switch -c orchestrator-prune-fallback",
      "git checkout main",
      "git reset --hard origin/main",
      "git merge origin/main",
      'git commit -m "RP-1: x"',
      "git rebase main",
      "git pull",
      "git stash push -u -m tag",
      "git branch -m RP-2-new",
      "git branch -D RP-2-old",
      "git status && git switch main",
      "git -c core.autocrlf=false checkout -b x",
    ]) {
      expect(gitFallbackRefusal(command, lost, gitKind), command).toMatch(/lost its \.git link/);
    }
    expect(gitFallbackRefusal("git switch main", resolve("/repo/.claude/worktrees/main-3-snag-days/apps/api"), gitKind)).toMatch(/main-3-snag-days/);
  });

  it("allows read-only git commands there, and other commands", () => {
    for (const command of ["git status", "git log --oneline -3", "git branch --list", "git diff main", "pnpm test", "echo git switch", "gitk"]) {
      expect(gitFallbackRefusal(command, lost, gitKind), command).toBeUndefined();
    }
  });

  it("refuses cherry-pick, revert, am and a forced branch move there", () => {
    for (const command of ["git cherry-pick abc123", "git revert HEAD", "git am < x.patch", "git branch -f main HEAD~1", "git branch --force RP-2 origin/main"]) {
      expect(gitFallbackRefusal(command, lost, gitKind), command).toMatch(/lost its \.git link/);
    }
  });

  it("takes git as PowerShell runs it: after the call operator, or by a quoted or unquoted path", () => {
    for (const command of [
      "& git switch x",
      '& "C:\\Program Files\\Git\\cmd\\git.exe" switch x',
      '"C:\\Program Files\\Git\\cmd\\git.exe" checkout main',
      "C:\\Git\\cmd\\git.exe commit -m x",
      "&git reset --hard",
    ]) {
      expect(gitFallbackRefusal(command, lost, gitKind), command).toMatch(/lost its \.git link/);
    }
  });

  it("judges each segment, whatever separates them", () => {
    for (const command of ["git status; git switch x", "git status || git switch x", "git log | head; git commit -m x", "git status\ngit merge main", "echo hi && git switch x"]) {
      expect(gitFallbackRefusal(command, lost, gitKind), command).toMatch(/lost its \.git link/);
    }
  });

  it("follows cd, Set-Location and pushd into a lost worktree, relative to the cwd or absolute", () => {
    for (const command of [
      "cd .claude/worktrees/main-3-snag-days && git commit -m x",
      `cd "${lost}" && git switch x`,
      "Set-Location .claude\\worktrees\\main-3-snag-days; git switch x",
      "Set-Location -Path .claude/worktrees/main-3-snag-days; git switch x",
      "pushd .claude/worktrees/main-3-snag-days && git reset --hard",
      "cd .claude && cd worktrees/main-3-snag-days && git switch x",
    ]) {
      expect(gitFallbackRefusal(command, main, gitKind), command).toMatch(/main-3-snag-days has lost its \.git link/);
    }
    // And out of one: cd into the healthy worktree first.
    expect(gitFallbackRefusal(`cd ${worktree} && git switch x`, lost, gitKind)).toBeUndefined();
  });

  it("follows -C: judges the directory git is pointed at, not the cwd", () => {
    expect(gitFallbackRefusal(`git -C ${lost} switch x`, main, gitKind)).toMatch(/main-3-snag-days has lost its \.git link/);
    expect(gitFallbackRefusal('git -C ".claude/worktrees/main-3-snag-days" commit -m x', main, gitKind)).toMatch(/lost its \.git link/);
    expect(gitFallbackRefusal(`git -C ${worktree} switch x`, lost, gitKind)).toBeUndefined();
  });

  it("allows the same commands in a live worktree, in the main checkout and outside any checkout", () => {
    expect(gitFallbackRefusal("git switch -c x", worktree, gitKind)).toBeUndefined();
    expect(gitFallbackRefusal("git switch -c x", resolve("/repo/.claude/worktrees/rp-1/apps"), gitKind)).toBeUndefined();
    expect(gitFallbackRefusal("git switch main", main, gitKind)).toBeUndefined();
    expect(gitFallbackRefusal("git switch main", resolve("/repo/.claude"), gitKind)).toBeUndefined();
    expect(gitFallbackRefusal("git switch main", resolve("/elsewhere"), gitKind)).toBeUndefined();
  });
});
