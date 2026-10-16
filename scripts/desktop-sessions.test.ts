import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDesktopSessions } from "./desktop-sessions.ts";

// Fixtures in the shape the desktop app keeps: <appDir>/git-worktrees.json names each
// worktree it made with the session leasing it, and <appDir>/claude-code-sessions/<a>/<b>/<id>.json
// holds each session, archived or not. The app keeps the branch it created, not a renamed one.

const main = "G:\\Rabaed Contech";
const brave = `${main}\\.claude\\worktrees\\brave-elion-4e1430`;
let appDir: string;

const record = (name: string, leasedBy: string | null) => ({
  name,
  path: `${main}\\.claude\\worktrees\\${name}`,
  leasedBy,
  baseRepo: main,
  branch: `claude/${name}`,
  sourceBranch: "main",
});
const writeWorktrees = (records: object[]) =>
  writeFileSync(join(appDir, "git-worktrees.json"), JSON.stringify({ worktrees: Object.fromEntries(records.map((r) => [(r as { name: string }).name, r])), schemaVersion: 2 }));
const writeSession = (id: string, s: { title?: string; isArchived: boolean; worktreePath?: string }) => {
  const dir = join(appDir, "claude-code-sessions", "owner", "org");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ sessionId: id, branch: "claude/whatever", ...s }));
};

beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), "rp608-app-"));
});
afterEach(() => rmSync(appDir, { recursive: true, force: true }));

describe("readDesktopSessions", () => {
  it("finds the open session of an app worktree by its path, though its branch was renamed (RP-608)", () => {
    writeWorktrees([record("brave-elion-4e1430", "local_db81")]);
    writeSession("local_db81", { title: "Build RP-602: lane numbers", isArchived: false, worktreePath: brave });
    const sessionAt = readDesktopSessions(appDir, "win32");
    // git lists the worktree with forward slashes, on the renamed branch the app does not know.
    expect(sessionAt("G:/Rabaed Contech/.claude/worktrees/brave-elion-4e1430")).toBe('session "Build RP-602: lane numbers"');
    expect(sessionAt("G:/Rabaed Contech/.claude/worktrees/other")).toBeUndefined();
  });

  it("lets a worktree go once its session is archived or released", () => {
    writeWorktrees([record("archived-a1", "local_arch"), record("released-b2", null)]);
    writeSession("local_arch", { title: "Done", isArchived: true });
    const sessionAt = readDesktopSessions(appDir, "win32");
    expect(sessionAt(`${main}/.claude/worktrees/archived-a1`)).toBeUndefined();
    expect(sessionAt(`${main}/.claude/worktrees/released-b2`)).toBeUndefined();
  });

  it("counts a leased worktree as open when its session record cannot be found", () => {
    writeWorktrees([record("lost-c3", "local_lost")]);
    expect(readDesktopSessions(appDir, "win32")(`${main}/.claude/worktrees/lost-c3`)).toBe("session local_lost");
  });

  it("finds no session when the desktop app keeps no worktree list", () => {
    expect(readDesktopSessions(appDir, "win32")(brave)).toBeUndefined();
  });

  it("holds every worktree when the app's worktree list cannot be read", () => {
    writeFileSync(join(appDir, "git-worktrees.json"), "{ not json");
    expect(readDesktopSessions(appDir, "win32")(brave)).toMatch(/could not be read/);
  });
});
