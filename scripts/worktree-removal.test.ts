import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removalRefusal, removeWorktreeFolder, type RemoveTarget } from "./worktree-removal.ts";
import { longPath, rdLongPath } from "./worktrees.ts";

const main = "G:/Rabaed Contech";
const path = `${main}/.claude/worktrees/hopeful-thompson`;

const target = (t: Partial<RemoveTarget> = {}): RemoveTarget => ({
  path,
  mainRoot: main,
  currentRoot: `${main}/.claude/worktrees/jolly-ellis`,
  registered: { path, head: "abc", branch: "RP-9-done", locked: undefined },
  exists: true,
  readable: true,
  changes: [],
  unpushed: 0,
  project: undefined,
  held: undefined,
  ...t,
});

describe("removalRefusal", () => {
  it("lets a clean, pushed worktree nothing holds go", () => {
    expect(removalRefusal(target(), { force: false, platform: "win32" })).toBeUndefined();
  });

  it("never the main checkout or the worktree it runs from, even with --force", () => {
    expect(removalRefusal(target({ path: main }), { force: true, platform: "win32" })).toContain("the main checkout");
    expect(removalRefusal(target({ path: `${main}/.claude/worktrees/JOLLY-ELLIS` }), { force: true, platform: "win32" })).toContain("the current worktree");
  });

  it("never a folder a Claude session works in, nor lane 7's, even with --force", () => {
    const held = 'a running Claude session is in it: session "lane 52" (pid 52)';
    expect(removalRefusal(target({ held }), { force: true, platform: "win32" })).toContain(held);
    expect(removalRefusal(target({ project: "rabaed-lane7" }), { force: true, platform: "win32" })).toContain("live UAT stack");
  });

  it("lists uncommitted and untracked files, and unpushed commits; --force removes it anyway", () => {
    const dirty = target({ changes: ["UU docs/visibility.md", "?? notes.md"] });
    expect(removalRefusal(dirty, { force: false, platform: "win32" })).toContain("uncommitted changes: UU docs/visibility.md, ?? notes.md");
    expect(removalRefusal(target({ unpushed: 2 }), { force: false, platform: "win32" })).toContain("2 commits on no origin branch");
    expect(removalRefusal(dirty, { force: true, platform: "win32" })).toBeUndefined();
  });

  it("takes a folder git no longer reads (its .git gone) only under .claude/worktrees/", () => {
    const lost = target({ registered: undefined, readable: false, changes: undefined, unpushed: undefined });
    expect(removalRefusal(lost, { force: false, platform: "win32" })).toBeUndefined();
    expect(removalRefusal({ ...lost, path: "G:/elsewhere/x" }, { force: false, platform: "win32" })).toContain("not a worktree of this clone");
  });

  it("keeps a worktree git should read but could not, unless --force", () => {
    const unread = target({ changes: undefined });
    expect(removalRefusal(unread, { force: false, platform: "win32" })).toContain("git could not read its changes or commits");
    expect(removalRefusal(target({ unpushed: undefined }), { force: false, platform: "win32" })).toContain("git could not read");
    expect(removalRefusal(unread, { force: true, platform: "win32" })).toBeUndefined();
  });

  it("says when there is nothing to remove", () => {
    expect(removalRefusal(target({ registered: undefined, exists: false }), { force: false, platform: "win32" })).toContain("no such worktree or folder");
  });
});

describe("longPath", () => {
  it("prefixes a Windows path with \\\\?\\ and backslashes, so rd reaches past MAX_PATH", () => {
    expect(longPath("G:/Rabaed Contech/.claude/worktrees/x")).toBe("\\\\?\\G:\\Rabaed Contech\\.claude\\worktrees\\x");
    expect(longPath("\\\\?\\G:\\a")).toBe("\\\\?\\G:\\a");
  });
});

describe("rdLongPath", () => {
  it.runIf(process.platform === "win32")("deletes a real folder with a space in its path, deeper than MAX_PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "rd long "));
    try {
      let deep = join(root, "left behind");
      while (deep.length < 300) deep = join(deep, "node_modules-segment");
      mkdirSync(deep, { recursive: true });
      writeFileSync(join(deep, "file.txt"), "x");
      rdLongPath(join(root, "left behind"));
      expect(existsSync(join(root, "left behind"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("throws with rd's message when it fails", () => {
    expect(() => rdLongPath(join(tmpdir(), "rd-long-no-such-folder-rp1101"))).toThrow();
  });
});

describe("removeWorktreeFolder", () => {
  /** A fake shell: records each command, and the folder is gone only once `goneAfter` has run. */
  const shell = (goneAfter: "worktree" | "rd" | "never", failing: string[] = []) => {
    const ran: string[] = [];
    let gone = false;
    return {
      ran,
      run: (command: string, args: string[]) => {
        const line = [command, ...args].join(" ");
        ran.push(line);
        if (failing.some((f) => line.includes(f))) throw Object.assign(new Error("failed"), { stderr: "error: Filename too long" });
        if ((goneAfter === "worktree" && line.includes("worktree remove")) || (goneAfter === "rd" && command === "rm")) gone = true;
        return "";
      },
      rd: (folder: string) => {
        ran.push(`rd /s /q "${longPath(folder)}"`);
        if (goneAfter === "rd") gone = true;
        else throw Object.assign(new Error("rd failed"), { stderr: "Access is denied." });
      },
      exists: () => !gone,
    };
  };
  const steps = (s: ReturnType<typeof shell>, platform: NodeJS.Platform = "win32") => ({ run: s.run, rd: s.rd, exists: s.exists, platform });

  it("removes with core.longpaths, then prunes git's record", () => {
    const s = shell("worktree");
    const result = removeWorktreeFolder(target(), steps(s));
    expect(s.ran).toEqual([`git -c core.longpaths=true worktree remove --force ${path}`, "git worktree prune"]);
    expect(result).toEqual({ removed: true, steps: ["git worktree remove: done"] });
  });

  it("deletes what git left (Filename too long) with rd /s /q on the \\\\?\\ path, then prunes", () => {
    const s = shell("rd", ["worktree remove"]);
    const result = removeWorktreeFolder(target(), steps(s));
    expect(s.ran).toEqual([
      `git -c core.longpaths=true worktree remove --force ${path}`,
      `rd /s /q "${longPath(path)}"`,
      "git worktree prune",
    ]);
    expect(result.removed).toBe(true);
    expect(result.steps).toEqual(["git worktree remove: error: Filename too long", "rd /s /q: done"]);
  });

  it("unlocks a locked worktree first, and skips git's remove for a folder git no longer reads", () => {
    const locked = shell("worktree");
    removeWorktreeFolder(target({ registered: { path, head: "abc", branch: "x", locked: "claude agent" } }), steps(locked));
    expect(locked.ran[0]).toBe(`git worktree unlock ${path}`);
    const lost = shell("rd");
    removeWorktreeFolder(target({ registered: undefined }), steps(lost));
    expect(lost.ran).toEqual([`rd /s /q "${longPath(path)}"`, "git worktree prune"]);
  });

  it("says the folder is still there when rd could not delete it either", () => {
    const s = shell("never", ["worktree remove"]);
    const result = removeWorktreeFolder(target(), steps(s));
    expect(result.removed).toBe(false);
    expect(result.steps.at(-1)).toBe("rd /s /q: Access is denied.");
    expect(s.ran.at(-1)).toBe("git worktree prune");
  });

  it("removes a real worktree of a throwaway repo and git's record of it", () => {
    const repo = mkdtempSync(join(tmpdir(), "worktree-remove-"));
    try {
      const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      run("git", ["init", "-q", "-b", "main"]);
      run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base"]);
      const linked = join(repo, ".claude", "worktrees", "done");
      run("git", ["worktree", "add", "-q", "-b", "RP-9-done", linked]);
      writeFileSync(join(linked, "left-behind.txt"), "x");
      const result = removeWorktreeFolder(target({ path: linked, mainRoot: repo, registered: { path: linked, head: "", branch: "RP-9-done", locked: undefined } }), { run, exists: existsSync });
      expect(result.removed).toBe(true);
      expect(existsSync(linked)).toBe(false);
      expect(run("git", ["worktree", "list", "--porcelain"])).not.toContain("done");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("uses rm -rf off Windows", () => {
    const s = shell("rd", ["worktree remove"]);
    const result = removeWorktreeFolder(target(), steps(s, "linux"));
    expect(s.ran[1]).toBe(`rm -rf ${path}`);
    expect(result.removed).toBe(true);
  });
});
