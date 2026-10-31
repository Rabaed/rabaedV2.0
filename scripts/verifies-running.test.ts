import { describe, expect, it } from "vitest";
import { describeRuns, runningVerifies, verifyLockFiles, volumesKeptReason } from "./verifies-running.ts";
import type { LockHolder } from "./verify-lock.ts";

// RP-1170, rule 4: bulk `docker volume rm` while lanes ran `pnpm verify` hung Docker's volume API twice
// (2026-10-31: 361 of 372 stories volumes failed with ETIMEDOUT). Volumes are removed only when no
// verify runs anywhere on the machine, judged by the verify locks.

const run = (pid: number, command = "pnpm verify"): LockHolder => ({ pid, started: new Date(2026, 9, 31, 10, 2), command });

describe("verifyLockFiles", () => {
  it("names each worktree's .verify.lock and every Main's verify slot in the common git folder", () => {
    const files = verifyLockFiles(["G:/r", "G:/r/.claude/worktrees/rp-1"], "G:/r/.git", ["rabaed-verify-main4.lock", "HEAD", "rabaed-verify-main-folder.lock", "rabaed-verify-main4.lock.123"]);
    expect(files.map((f) => f.file.replace(/\\/g, "/"))).toEqual([
      "G:/r/.verify.lock",
      "G:/r/.claude/worktrees/rp-1/.verify.lock",
      "G:/r/.git/rabaed-verify-main4.lock",
      "G:/r/.git/rabaed-verify-main-folder.lock",
    ]);
    expect(files.map((f) => f.where)).toEqual(["G:/r", "G:/r/.claude/worktrees/rp-1", "the verify slot rabaed-verify-main4.lock", "the verify slot rabaed-verify-main-folder.lock"]);
  });
});

describe("runningVerifies", () => {
  it("lists the live holders, one per pid", () => {
    const holders: Record<string, LockHolder> = { a: run(11), b: run(11), c: run(12) };
    const runs = runningVerifies(
      [
        { where: "G:/a", file: "a" },
        { where: "slot", file: "b" },
        { where: "G:/c", file: "c" },
        { where: "G:/d", file: "d" },
      ],
      (file) => holders[file],
    );
    expect(runs.map((r) => [r.where, r.holder.pid])).toEqual([
      ["G:/a", 11],
      ["G:/c", 12],
    ]);
  });
});

describe("volumesKeptReason", () => {
  it("is undefined when no verify runs", () => expect(volumesKeptReason({ runs: [] })).toBeUndefined());

  it("names the runs", () => {
    expect(volumesKeptReason({ runs: [{ where: "G:/a", holder: run(11) }] })).toBe("a verify runs (pid 11, started 10:02, `pnpm verify`, in G:/a)");
    expect(describeRuns([{ where: "G:/a", holder: run(11) }, { where: "G:/b", holder: run(12) }])).toBe("2 verifies run (pid 11, started 10:02, `pnpm verify`, in G:/a; pid 12, started 10:02, `pnpm verify`, in G:/b)");
  });

  it("keeps the volumes when the locks could not be read", () => {
    expect(volumesKeptReason({ unknown: "git failed" })).toBe("whether a verify runs could not be checked (git failed)");
  });
});
