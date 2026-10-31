import { describe, expect, it } from "vitest";
import type { Container } from "./lanes.ts";
import { formatAge, formatRows, laneRows, mainOfLane, parseLanesArgs, type RowsInput } from "./lane-rows.ts";

// RP-1170: `pnpm lanes [--main N]` shows every stack with its lane, Main, PR, PR state, whether a verify
// runs, and how long it has been idle, so a Main frees a slot without asking round the other Mains.

const now = Date.parse("2026-10-31T18:00:00Z");
const c = (x: Partial<Container> & Pick<Container, "name" | "project">): Container => ({ state: "running", workingDir: "", ports: [], ...x });

const input = (over: Partial<RowsInput> = {}): RowsInput => ({
  containers: [
    c({ name: "rabaed-lane41-db-1", project: "rabaed-lane41", workingDir: "G:/r/wt/rp-1170" }),
    c({ name: "rabaed-lane41-files-1", project: "rabaed-lane41", workingDir: "G:/r/wt/rp-1170", state: "exited" }),
    c({ name: "rabaed-lane32-db-1", project: "rabaed-lane32", workingDir: "G:/r/wt/rp-922", state: "exited" }),
    c({ name: "rabaed-lane7-db-1", project: "rabaed-lane7", workingDir: "G:/r/wt/uat" }),
    c({ name: "rabaed-lane13-db-1", project: "rabaed-lane13", workingDir: "G:/r/wt/gone" }),
  ],
  volumes: [
    { name: "rabaed-lane41_db-data", project: "rabaed-lane41" },
    { name: "rabaed-lane54_db-data", project: "rabaed-lane54" },
  ],
  worktrees: [
    { path: "G:/r/wt/rp-1170", branch: "RP-1170-lane-done", project: "rabaed-lane41" },
    { path: "G:/r/wt/agent-a", branch: "RP-1170-part", project: "rabaed-lane41" },
    { path: "G:/r/wt/rp-922", branch: "RP-922-uat", project: "rabaed-lane32" },
    { path: "G:/r/wt/uat", branch: "main-7-uat", project: "rabaed-lane7" },
  ],
  prs: [
    { number: 580, headRefName: "RP-1170-lane-done", state: "OPEN", isDraft: false },
    { number: 570, headRefName: "RP-922-uat", state: "MERGED", isDraft: false },
    { number: 560, headRefName: "RP-922-uat", state: "CLOSED", isDraft: false },
  ],
  verifyOf: (path) => (path === "G:/r/wt/agent-a" ? { pid: 4242, started: new Date(now - 20 * 60_000), command: "pnpm verify" } : undefined),
  activityOf: (path) => ({ "G:/r/wt/rp-1170": now - 3 * 3_600_000, "G:/r/wt/agent-a": now - 50 * 60_000, "G:/r/wt/rp-922": now - 2 * 86_400_000 })[path],
  exists: (path) => path !== "G:/r/wt/gone",
  now,
  main: undefined,
  platform: "linux",
  ...over,
});

describe("mainOfLane", () => {
  it("names the Main a lane belongs to", () => {
    expect(mainOfLane(41)).toBe(4);
    expect(mainOfLane(50)).toBe(5);
    expect(mainOfLane(7)).toBe(7);
    expect(mainOfLane(0)).toBeUndefined();
    expect(mainOfLane(undefined)).toBeUndefined();
  });
});

describe("parseLanesArgs", () => {
  it("reads --main N", () => {
    expect(parseLanesArgs([])).toEqual({ main: undefined });
    expect(parseLanesArgs(["--main", "4"])).toEqual({ main: 4 });
  });
  it("refuses anything else", () => {
    for (const args of [["--main"], ["--main", "x"], ["--main", "0"], ["4"], ["--yes"]]) expect(parseLanesArgs(args)).toHaveProperty("error");
  });
});

describe("laneRows", () => {
  it("lists every stack by lane, with its worktrees, PR, verify and idle time", () => {
    const rows = laneRows(input());
    expect(rows.map((r) => r.stack)).toEqual(["rabaed-lane7", "rabaed-lane13", "rabaed-lane32", "rabaed-lane41", "rabaed-lane54"]);
    expect(rows.find((r) => r.stack === "rabaed-lane41")).toEqual({
      stack: "rabaed-lane41",
      lane: "41",
      main: "Main 4, lane A",
      containers: "running 1/2",
      worktrees: "rp-1170 (RP-1170-lane-done), agent-a (RP-1170-part)",
      pr: "#580 OPEN",
      verify: "running (pid 4242, 20 min)",
      idle: "verifying",
    });
  });

  it("shows a merged PR, a stopped stack and its idle time", () => {
    expect(laneRows(input()).find((r) => r.stack === "rabaed-lane32")).toMatchObject({ main: "Main 3, lane B", containers: "stopped", pr: "#570 MERGED", verify: "—", idle: "2 d" });
  });

  it("marks lane 7 as Main 7's harness, a gone worktree, and a stack with only volumes left", () => {
    const rows = laneRows(input());
    expect(rows.find((r) => r.stack === "rabaed-lane7")?.main).toBe("Main 7 (UAT harness: never freed)");
    expect(rows.find((r) => r.stack === "rabaed-lane13")).toMatchObject({ worktrees: "gone (gone)", pr: "—", idle: "—" });
    expect(rows.find((r) => r.stack === "rabaed-lane54")).toMatchObject({ containers: "volumes only", worktrees: "—" });
  });

  it("with --main N, only that Main's stacks", () => {
    expect(laneRows(input({ main: 4 })).map((r) => r.stack)).toEqual(["rabaed-lane41"]);
    expect(laneRows(input({ main: 7 })).map((r) => r.stack)).toEqual(["rabaed-lane7"]);
  });
});

describe("formatAge", () => {
  it("rounds to minutes, hours or days", () => {
    expect(formatAge(30_000)).toBe("0 min");
    expect(formatAge(59 * 60_000)).toBe("59 min");
    expect(formatAge(3 * 3_600_000)).toBe("3 h");
    expect(formatAge(50 * 3_600_000)).toBe("2 d");
  });
});

describe("formatRows", () => {
  it("prints a header and aligned columns", () => {
    const lines = formatRows(laneRows(input({ main: 4 })));
    expect(lines[0]).toMatch(/^Stack\s+Lane\s+Main\s+Containers\s+Worktrees\s+PR\s+Verify\s+Idle$/);
    expect(lines[1]).toMatch(/^rabaed-lane41\s+41\s+Main 4, lane A\s+running 1\/2\s+rp-1170/);
    expect(lines[1]!.indexOf("  41  ") + 2).toBe(lines[0]!.indexOf("Lane"));
  });

  it("says so when there is no stack", () => expect(formatRows([])).toEqual(["No rabaed-* stacks."]));
});
