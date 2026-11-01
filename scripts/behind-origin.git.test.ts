import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBehindOrigin } from "./behind-origin.ts";

// A bare origin, a clone of it left at its first commit (the stale checkout), and four commits
// pushed to origin from a second clone, so the stale checkout is 4 behind once it fetches.
let root: string;
let stale: string;
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const MAX = 2;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rabaed-behind-origin-"));
  git(root, "init", "-q", "--bare", "-b", "main", "origin.git");
  const origin = pathToFileURL(join(root, "origin.git")).href;
  git(root, "clone", "-q", origin, "stale");
  stale = join(root, "stale");
  writeFileSync(join(stale, "a.txt"), "0\n");
  git(stale, "add", "-A");
  git(stale, "commit", "-q", "-m", "start");
  git(stale, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, "other");
  const other = join(root, "other");
  for (let i = 1; i <= 4; i++) {
    writeFileSync(join(other, "a.txt"), `${i}\n`);
    git(other, "commit", "-q", "-am", `change ${i}`);
  }
  git(other, "push", "-q", "origin", "main");
}, 30_000);

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("checkBehindOrigin, on real repositories", () => {
  it("fetches, stops past the limit and names the worktree of this clone that has origin/main", () => {
    git(stale, "fetch", "-q", "origin");
    git(stale, "worktree", "add", "-q", "--detach", join(root, "fresh"), "origin/main");
    const verdict = checkBehindOrigin("pnpm lanes", { cwd: stale, max: MAX });
    expect(verdict.stop).toBe(true);
    expect(verdict.lines[0]).toBe("pnpm lanes stopped: HEAD is 4 commits behind origin/main: this checkout's scripts are older than main's.");
    expect(verdict.lines[2]).toMatch(/^ {2}cd ".*fresh" {3}\(up to date with origin\/main\)$/);
    expect(verdict.lines.at(-1)).toBe("  pnpm lanes");
  });

  it("with no closer worktree, a clean checkout on main is told to fast-forward", () => {
    const verdict = checkBehindOrigin("pnpm lanes", { cwd: stale, max: MAX });
    expect(verdict.stop).toBe(true);
    expect(verdict.lines).toContain("  git merge --ff-only origin/main");
  });

  it("an untracked file does not stop the fast-forward; a change to a tracked file does", () => {
    writeFileSync(join(stale, "design-notes.md"), "untracked\n");
    expect(checkBehindOrigin("pnpm lanes", { cwd: stale, max: MAX }).lines).toContain("  git merge --ff-only origin/main");
    writeFileSync(join(stale, "a.txt"), "changed\n");
    expect(checkBehindOrigin("pnpm lanes", { cwd: stale, max: MAX }).lines).not.toContain("  git merge --ff-only origin/main");
  });

  it("suggests a fresh worktree named for the day, with -2 when that folder already exists", () => {
    git(stale, "switch", "-q", "-c", "RP-1-x");
    const now = new Date(2026, 10, 1, 9, 0);
    expect(checkBehindOrigin("pnpm lanes", { cwd: stale, max: MAX, now }).lines).toContainEqual(expect.stringMatching(/^ {2}git worktree add --detach ".*\/\.claude\/worktrees\/origin-main-20261101" origin\/main$/));
    mkdirSync(join(stale, ".claude", "worktrees", "origin-main-20261101"), { recursive: true });
    expect(checkBehindOrigin("pnpm lanes", { cwd: stale, max: MAX, now }).lines).toContainEqual(expect.stringMatching(/^ {2}git worktree add --detach ".*\/\.claude\/worktrees\/origin-main-20261101-2" origin\/main$/));
  });

  it("says nothing from a worktree that has origin/main", () => {
    git(stale, "fetch", "-q", "origin");
    git(stale, "worktree", "add", "-q", "--detach", join(root, "fresh"), "origin/main");
    expect(checkBehindOrigin("pnpm lanes", { cwd: join(root, "fresh"), max: MAX })).toEqual({ stop: false, lines: [] });
  });

  it("when the fetch fails, says so and judges against origin/main as last fetched", () => {
    git(stale, "fetch", "-q", "origin");
    git(stale, "remote", "set-url", "origin", pathToFileURL(join(root, "gone.git")).href);
    const verdict = checkBehindOrigin("pnpm lanes", { cwd: stale, max: MAX });
    expect(verdict.stop).toBe(true);
    expect(verdict.lines[0]).toMatch(/^pnpm lanes: `git fetch origin main` failed \(.+\), so it is judged against origin\/main as last fetched\.$/);
    expect(verdict.lines[1]).toMatch(/HEAD is 4 commits behind/);
  });
}, 30_000);
