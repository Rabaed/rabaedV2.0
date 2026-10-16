import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type GitKind, refusal } from "./main-folder-guard.ts";

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
