import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBehindOrigin, stopIfBehindOrigin } from "./behind-origin.ts";
import type { Holders } from "./claude-sessions.ts";

// A bare origin, a clone of it left at its first commit (the stale checkout), and four commits
// pushed to origin from a second clone, so the stale checkout is 4 behind once it fetches.
let root: string;
let stale: string;
let origin: string;
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const MAX = 2;
const nobodyHolds = (): Holders => ({ runningSession: () => undefined, desktopSession: () => undefined });
const holding = (folder: string) => (): Holders => ({ runningSession: (path) => (path.replace(/\\/g, "/").endsWith(`/${folder}`) ? "a running Claude session is in it" : undefined), desktopSession: () => undefined });
const check = (cwd: string, options: Parameters<typeof checkBehindOrigin>[1] = {}) => checkBehindOrigin("pnpm lanes", { cwd, max: MAX, holders: nobodyHolds, ...options });
const FF = "  git merge --ff-only origin/main";
const addFresh = () => {
  git(stale, "fetch", "-q", "origin");
  git(stale, "worktree", "add", "-q", "--detach", join(root, "fresh"), "origin/main");
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rabaed-behind-origin-"));
  git(root, "init", "-q", "--bare", "-b", "main", "origin.git");
  origin = pathToFileURL(join(root, "origin.git")).href;
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
    addFresh();
    const verdict = check(stale);
    expect(verdict.stop).toBe(true);
    expect(verdict.lines[0]).toMatch(/HEAD is 4 merged PRs behind origin\/main/);
    expect(verdict.lines[2]).toMatch(/^ {2}cd ".*fresh" {3}\(up to date with origin\/main\)$/);
  });

  it("counts a merged PR once, however many commits it brought (first parent only)", () => {
    const other = join(root, "other");
    git(other, "switch", "-q", "-c", "RP-2-pr");
    for (let i = 1; i <= 3; i++) {
      writeFileSync(join(other, `pr${i}.txt`), `${i}\n`);
      git(other, "add", "-A");
      git(other, "commit", "-q", "-m", `pr commit ${i}`);
    }
    git(other, "switch", "-q", "main");
    git(other, "merge", "-q", "--no-ff", "-m", "Merge pull request #2", "RP-2-pr");
    git(other, "push", "-q", "origin", "main");
    expect(check(stale).lines[0]).toMatch(/HEAD is 5 merged PRs behind origin\/main/);
  });

  it("leaves out a worktree a live session holds, and every other worktree when the sessions cannot be read", () => {
    addFresh();
    expect(check(stale, { holders: holding("fresh") }).lines).toContain(FF);
    expect(
      check(stale, {
        holders: () => {
          throw new Error("no process list");
        },
      }).lines,
    ).toContain(FF);
  });

  it("an untracked file doesn't count as uncommitted; a change to a tracked file does", () => {
    writeFileSync(join(stale, "design-notes.md"), "untracked\n");
    expect(check(stale).lines).toContain(FF);
    writeFileSync(join(stale, "a.txt"), "changed\n");
    expect(check(stale).lines).not.toContain(FF);
  });

  it("a main with a commit origin/main lacks cuts a fresh worktree instead of fast-forwarding", () => {
    writeFileSync(join(stale, "b.txt"), "local\n");
    git(stale, "add", "-A");
    git(stale, "commit", "-q", "-m", "local only");
    const verdict = check(stale);
    expect(verdict.stop).toBe(true);
    expect(verdict.lines).not.toContain(FF);
    expect(verdict.lines).toContainEqual(expect.stringMatching(/^ {2}git worktree add --detach ".*origin-main-\d{8}" origin\/main$/));
  });

  it("suggests a fresh worktree named for the day, with -2 when that folder already exists", () => {
    git(stale, "switch", "-q", "-c", "RP-1-x");
    const now = new Date(2026, 10, 1, 9, 0);
    expect(check(stale, { now }).lines).toContainEqual(expect.stringMatching(/^ {2}git worktree add --detach ".*\/\.claude\/worktrees\/origin-main-20261101" origin\/main$/));
    mkdirSync(join(stale, ".claude", "worktrees", "origin-main-20261101"), { recursive: true });
    expect(check(stale, { now }).lines).toContainEqual(expect.stringMatching(/^ {2}git worktree add --detach ".*\/\.claude\/worktrees\/origin-main-20261101-2" origin\/main$/));
  });

  it("in a bare clone, takes the bare folder for the main checkout, never its first linked worktree", () => {
    git(root, "clone", "-q", "--bare", origin, "bare.git");
    const bare = join(root, "bare.git");
    git(bare, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
    git(bare, "fetch", "-q", "origin");
    const first = git(bare, "rev-list", "--max-parents=0", "origin/main");
    git(bare, "worktree", "add", "-q", "--detach", join(root, "b1"), first);
    git(bare, "worktree", "add", "-q", "--detach", join(root, "b2"), first);
    expect(check(join(root, "b2")).lines).toContainEqual(expect.stringMatching(/^ {2}git worktree add --detach ".*bare\.git\/\.claude\/worktrees\/origin-main-\d{8}" origin\/main$/));
  });

  it("says nothing from a worktree that has origin/main", () => {
    addFresh();
    expect(check(join(root, "fresh"))).toEqual({ stop: false, lines: [] });
  });

  it("when the fetch fails, says so and judges against origin/main as last fetched", () => {
    git(stale, "fetch", "-q", "origin");
    git(stale, "remote", "set-url", "origin", pathToFileURL(join(root, "gone.git")).href);
    const verdict = check(stale);
    expect(verdict.stop).toBe(true);
    expect(verdict.lines[0]).toMatch(/^pnpm lanes: `git fetch origin main` failed \(.+\), so it is judged against origin\/main as last fetched\.$/);
    expect(verdict.lines[1]).toMatch(/HEAD is 4 merged PRs behind/);
  });

  it("in a shallow clone, says it cannot count and carries on", () => {
    git(root, "clone", "-q", "--depth=1", origin, "shallow");
    expect(check(join(root, "shallow"))).toEqual({ stop: false, lines: ["pnpm lanes: this clone is shallow, so how far HEAD is behind origin/main cannot be counted; not checked."] });
  });
}, 30_000);

describe("stopIfBehindOrigin", () => {
  const run = (cwd: string, argv: string[] = []) => {
    const written: string[] = [];
    const exits: number[] = [];
    stopIfBehindOrigin("pnpm lane:done", { cwd, argv, max: MAX, holders: nobodyHolds, write: (line) => written.push(line), exit: (code) => exits.push(code) });
    return { written, exits };
  };

  it("prints the stop with the command and its arguments, and exits 1", () => {
    const { written, exits } = run(stale, ["512", "--dry-run"]);
    expect(written[0]).toMatch(/^pnpm lane:done 512 --dry-run stopped: HEAD is 4 merged PRs behind/);
    expect(written.at(-1)).toBe("  pnpm lane:done 512 --dry-run");
    expect(exits).toEqual([1]);
  });

  it("is silent and carries on when up to date", () => {
    addFresh();
    expect(run(join(root, "fresh"), ["512"])).toEqual({ written: [], exits: [] });
  });

  it("outside a checkout, says in one line it was not checked and carries on", () => {
    const { written, exits } = run(root, ["512"]);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^pnpm lane:done 512: whether this checkout is behind origin\/main was not checked \(.+\)\.$/);
    expect(exits).toEqual([]);
  });
}, 30_000);
