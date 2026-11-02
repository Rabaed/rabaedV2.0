import { describe, expect, it } from "vitest";
import { describeRuns, runningVerifies, splitWaiting, verifyLockFiles, volumesKeptReason } from "./verifies-running.ts";
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

describe("verifyLockFiles, machine-wide (RP-1197)", () => {
  it("names the machine-wide verify lock first when its folder is given", () => {
    const files = verifyLockFiles(["G:/r"], "G:/r/.git", [], "T:/rabaed-verify");
    expect(files.map((f) => [f.where, f.file.replace(/\\/g, "/")])).toEqual([
      ["the machine-wide verify line", "T:/rabaed-verify/verify.lock"],
      ["G:/r", "G:/r/.verify.lock"],
    ]);
  });
});

describe("splitWaiting (RP-1197)", () => {
  it("counts a run with a place in the line as waiting, though it holds its worktree's lock; an old-code run with no place stays running", () => {
    const runs = [
      { where: "G:/wt/old", holder: run(32128) },
      { where: "G:/wt/mine", holder: run(25156) },
    ];
    const check = splitWaiting(runs, [run(25156)]);
    expect("runs" in check && check.runs.map((r) => r.holder.pid)).toEqual([32128]);
    expect("runs" in check && check.waiting?.map((r) => [r.where, r.holder.pid])).toEqual([["the machine-wide verify line", 25156]]);
  });

  it("with no place in the line, every run is running and nothing waits", () => {
    expect(splitWaiting([{ where: "G:/a", holder: run(11) }], [])).toEqual({ runs: [{ where: "G:/a", holder: run(11) }] });
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

  it("keeps the volumes while a run waits in the machine-wide line, and names it by lane and PR (RP-1197)", () => {
    const waiting = [{ where: "the machine-wide verify line", holder: { ...run(21), lane: "13", pr: 577 } }];
    expect(volumesKeptReason({ runs: [], waiting })).toBe("1 waiting (lane 13 (#577), in the machine-wide verify line)");
    expect(volumesKeptReason({ runs: [{ where: "G:/a", holder: run(11) }], waiting })).toBe(
      "a verify runs (pid 11, started 10:02, `pnpm verify`, in G:/a); 1 waiting (lane 13 (#577), in the machine-wide verify line)",
    );
  });

  it("keeps the volumes when the locks could not be read", () => {
    expect(volumesKeptReason({ unknown: "git failed" })).toBe("whether a verify runs could not be checked (git failed)");
  });
});
