import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedPaths, snapshotHash, systemFileHash, treeChanged, treeSnapshot, watchTree, type TreeSnapshot } from "./verify-tree.ts";

const status = (...entries: string[]) => entries.map((entry) => `${entry}\0`).join("");
const snapshot = (entries: Record<string, string>): TreeSnapshot => new Map(Object.entries(entries));

describe("changedPaths", () => {
  it("reads modified, untracked and deleted paths", () => {
    expect(changedPaths(status(" M a.ts", "?? b.ts", " D c.ts"))).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("takes both paths of a rename, the second having no status code", () => {
    expect(changedPaths(status("R  new.ts", "old.ts", " M a.ts"))).toEqual(["new.ts", "old.ts", "a.ts"]);
  });

  it("is empty for a clean tree", () => {
    expect(changedPaths("")).toEqual([]);
  });
});

describe("treeSnapshot", () => {
  it("hashes each changed path through the injected reader", () => {
    const calls: string[][] = [];
    const git = (args: string[]) => {
      calls.push(args);
      return status(" M a.ts", "?? b.ts");
    };
    const result = treeSnapshot(git, (path) => `h:${path}`);
    expect(result).toEqual(snapshot({ "a.ts": "h:a.ts", "b.ts": "h:b.ts" }));
    expect(calls[0]).toEqual(["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  });

  it("leaves out the paths it is told to ignore, such as the run's own log", () => {
    const git = () => status("?? out.txt", " M a.ts");
    expect(treeSnapshot(git, (path) => `h:${path}`, ["out.txt"])).toEqual(snapshot({ "a.ts": "h:a.ts" }));
  });

  it("is undefined when git fails", () => {
    expect(treeSnapshot(() => undefined, () => "x")).toBeUndefined();
  });
});

describe("treeChanged", () => {
  const start = snapshot({ "a.ts": "1", "b.ts": "2" });

  it("is undefined while the tree is the same", () => {
    expect(treeChanged(start, snapshot({ "b.ts": "2", "a.ts": "1" }))).toBeUndefined();
  });

  it("names a file edited, one added and one that went back to HEAD", () => {
    const message = treeChanged(start, snapshot({ "a.ts": "9", "c.ts": "3" }));
    expect(message).toContain("(a.ts, b.ts, c.ts)");
    expect(message).toContain("no verify line is printed");
    expect(message).toContain("base-branch sync");
  });

  it("lists five paths and counts the rest", () => {
    const many = snapshot(Object.fromEntries(["a", "b", "c", "d", "e", "f", "g"].map((name) => [`${name}.ts`, "x"])));
    expect(treeChanged(snapshot({}), many)).toContain("(a.ts, b.ts, c.ts, d.ts, e.ts and 2 more)");
  });

  it("does not stop the run when either reading failed", () => {
    expect(treeChanged(undefined, start)).toBeUndefined();
    expect(treeChanged(start, undefined)).toBeUndefined();
  });
});

describe("watchTree", () => {
  const clock = () => {
    let tick: (() => void) | undefined;
    const cleared: unknown[] = [];
    return {
      setTimer: (fn: () => void) => {
        tick = fn;
        return "timer-1";
      },
      clearTimer: (timer: unknown) => cleared.push(timer),
      fire: () => tick?.(),
      cleared,
    };
  };

  it("keeps polling while nothing changes", () => {
    const time = clock();
    const seen: string[] = [];
    watchTree({ check: () => undefined, onChange: (message) => seen.push(message), everyMs: 10_000, ...time });
    time.fire();
    time.fire();
    expect(seen).toEqual([]);
    expect(time.cleared).toEqual([]);
  });

  it("reports the change once and stops polling", () => {
    const time = clock();
    const seen: string[] = [];
    const reasons = [undefined, "the working tree changed"];
    watchTree({ check: () => reasons.shift(), onChange: (message) => seen.push(message), everyMs: 10_000, ...time });
    time.fire();
    time.fire();
    expect(seen).toEqual(["the working tree changed"]);
    expect(time.cleared).toEqual(["timer-1"]);
  });

  it("returns a stop that clears the timer", () => {
    const time = clock();
    const stop = watchTree({ check: () => undefined, onChange: () => undefined, everyMs: 1, ...time });
    stop();
    expect(time.cleared).toEqual(["timer-1"]);
  });
});

describe("snapshotHash", () => {
  it("is 16 hex, the same for the same tree in any order and different when a file differs", () => {
    const a = snapshotHash(snapshot({ "a.ts": "1", "b.ts": "2" }));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(snapshotHash(snapshot({ "b.ts": "2", "a.ts": "1" }))).toBe(a);
    expect(snapshotHash(snapshot({ "a.ts": "1", "b.ts": "3" }))).not.toBe(a);
  });
});

describe("systemFileHash", () => {
  it("hashes content, and says gone or dir for a missing file or a folder (a temp folder only)", () => {
    const root = mkdtempSync(join(tmpdir(), "verify-tree-"));
    try {
      const hash = systemFileHash(root);
      writeFileSync(join(root, "a.txt"), "one");
      const one = hash("a.txt");
      writeFileSync(join(root, "a.txt"), "two");
      expect(hash("a.txt")).not.toBe(one);
      mkdirSync(join(root, "folder"));
      expect(hash("folder")).toBe("dir");
      expect(hash("missing.txt")).toBe("gone");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
