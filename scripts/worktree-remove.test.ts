import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// `pnpm worktree:remove` itself, on a clone of a throwaway origin (RP-1198): main-2-signing-days was refused
// for 2 "unpushed" commits that were only merges of main, so the owner needed --force.
const script = resolve(import.meta.dirname, "worktree-remove.ts");
const slow = 120_000;

let tmp = "";
let clone = "";
const git = (args: string[], cwd = clone) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commit = (cwd: string, file: string) => {
  writeFileSync(join(cwd, file), file);
  git(["add", file], cwd);
  git(["commit", "-m", file], cwd);
};
/** Runs the script from the clone, with a home of its own: no Claude session or desktop record holds the worktree. */
const remove = (path: string) => {
  const home = join(tmp, "home");
  mkdirSync(join(home, ".claude", "sessions"), { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData"), XDG_CONFIG_HOME: join(home, ".config") };
  return spawnSync(process.execPath, [script, path], { cwd: clone, env, encoding: "utf8" });
};
/** A worktree under .claude/worktrees whose branch merges main in (main moved on and was pushed) twice. */
const mergeOnlyWorktree = (name: string) => {
  const dir = join(clone, ".claude", "worktrees", name);
  git(["worktree", "add", "-b", `RP-1-${name}`, dir]);
  for (let i = 0; i < 2; i++) {
    commit(clone, `main-${name}-${i}.txt`);
    git(["push", "origin", "main"]);
    git(["merge", "--no-ff", "-m", `merge main ${i}`, "origin/main"], dir);
  }
  return dir;
};

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "rabaed-worktree-remove-")));
  git(["init", "--bare", "-b", "main", "origin.git"], tmp);
  clone = join(tmp, "my clone");
  git(["clone", join(tmp, "origin.git"), clone], tmp);
  commit(clone, "a.txt");
  git(["push", "origin", "main"]);
}, slow);

afterEach(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

describe("pnpm worktree:remove with merges of main only (RP-1198)", () => {
  it(
    "removes a worktree whose only commits beyond origin/main are merges of it, without --force",
    () => {
      const dir = mergeOnlyWorktree("merges");
      const result = remove(dir);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(existsSync(dir)).toBe(false);
    },
    slow,
  );

  it(
    "still keeps one with a commit of its own beside the merges, and one with an untracked file",
    () => {
      const own = mergeOnlyWorktree("own");
      commit(own, "own.txt");
      const kept = remove(own);
      expect(kept.status).toBe(1);
      expect(kept.stderr).toContain("3 commits on no origin branch");
      expect(existsSync(own)).toBe(true);

      const dirty = mergeOnlyWorktree("dirty");
      writeFileSync(join(dirty, "notes.md"), "wip");
      const refused = remove(dirty);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("uncommitted changes: ?? notes.md");
      expect(existsSync(dirty)).toBe(true);
    },
    slow,
  );
});
