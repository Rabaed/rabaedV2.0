import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gitFallbackRefusal, type GitKind, refusal } from "./main-folder-guard.ts";

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

  it("allows the same commands in a live worktree, in the main checkout and outside any checkout", () => {
    expect(gitFallbackRefusal("git switch -c x", worktree, gitKind)).toBeUndefined();
    expect(gitFallbackRefusal("git switch -c x", resolve("/repo/.claude/worktrees/rp-1/apps"), gitKind)).toBeUndefined();
    expect(gitFallbackRefusal("git switch main", main, gitKind)).toBeUndefined();
    expect(gitFallbackRefusal("git switch main", resolve("/repo/.claude"), gitKind)).toBeUndefined();
    expect(gitFallbackRefusal("git switch main", resolve("/elsewhere"), gitKind)).toBeUndefined();
  });
});
