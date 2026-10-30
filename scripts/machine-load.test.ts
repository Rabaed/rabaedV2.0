import { describe, expect, it } from "vitest";
import type { Container, Volume } from "./lanes.ts";
import { DEFAULT_MAX_STACKS, maxStacks, runningStacks, stackCap, staleReport } from "./machine-load.ts";

const container = (project: string, state = "running", name = `${project}-db-1`, workingDir = `G:/wt/${project}`): Container => ({ name, state, project, workingDir, ports: [] });
/** n running lane stacks, lanes 11, 12, … (skipping none), each with a db and a files container. */
const running = (lanes: number[]): Container[] =>
  lanes.flatMap((n) => [container(`rabaed-lane${n}`), container(`rabaed-lane${n}`, "running", `rabaed-lane${n}-files-1`)]);

describe("maxStacks", () => {
  it("is 8 unless RABAED_MAX_STACKS sets it", () => {
    expect(DEFAULT_MAX_STACKS).toBe(8);
    expect(maxStacks({})).toBe(8);
    expect(maxStacks({ RABAED_MAX_STACKS: "12" })).toBe(12);
    expect(maxStacks({ RABAED_MAX_STACKS: "" })).toBe(8);
  });

  it("refuses a value that is not a whole number from 1", () => {
    for (const value of ["0", "-3", "eight", "2.5"]) {
      expect(() => maxStacks({ RABAED_MAX_STACKS: value })).toThrow(`RABAED_MAX_STACKS "${value}" is not a whole number from 1`);
    }
  });
});

describe("runningStacks", () => {
  it("counts each rabaed compose project with a running container once, the main folder's `rabaed` too", () => {
    const containers = [
      ...running([11, 12]),
      container("rabaed-lane13", "exited"),
      container("rabaed"),
      container("", "running", "optimistic_lalande", ""),
      container("other-app"),
    ];
    expect(runningStacks(containers).map((s) => s.project)).toEqual(["rabaed", "rabaed-lane11", "rabaed-lane12"]);
  });

  it("names the folders each stack was started from", () => {
    expect(runningStacks(running([21]))).toEqual([{ project: "rabaed-lane21", dirs: ["G:/wt/rabaed-lane21"] }]);
  });
});

describe("stackCap", () => {
  const lanes = (count: number) => [11, 12, 13, 14, 21, 22, 23, 24, 32, 33].slice(0, count);

  it("passes well under the cap", () => {
    expect(stackCap(31, running(lanes(5)), 8)).toEqual({ level: "ok" });
  });

  it("warns when this lane's stack would leave one slot or none", () => {
    for (const count of [6, 7]) {
      const verdict = stackCap(31, running(lanes(count)), 8);
      expect(verdict.level).toBe("warn");
      expect(verdict.level !== "ok" && verdict.message).toContain(`lane 31 makes ${count + 1} of 8`);
    }
  });

  it("refuses when the cap is already reached, naming every running stack and what to do", () => {
    const verdict = stackCap(31, running(lanes(8)), 8);
    expect(verdict.level).toBe("refuse");
    const message = verdict.level === "refuse" ? verdict.message : "";
    expect(message).toContain("8 stacks are running, the cap is 8 (RABAED_MAX_STACKS)");
    expect(message).toContain("rabaed-lane24 (G:/wt/rabaed-lane24)");
    expect(message).toContain("pnpm lanes:prune --stale");
    expect(message).toContain("lane 7");
  });

  it("does not count the lane's own stack, or its twin's, as another one", () => {
    // Lane 31 already running (a --force rewrite, or a --db subagent sharing it) adds no stack.
    expect(stackCap(31, running([31, ...lanes(5)]), 8)).toEqual({ level: "ok" });
    // Legacy lane 3 and lane 30 share ports: the same stack slot.
    expect(stackCap(30, running([3, ...lanes(5)]), 8)).toEqual({ level: "ok" });
  });

  it("counts lane 7 like any running stack, and never names it as one to stop", () => {
    const verdict = stackCap(31, running([7, ...lanes(7)]), 8);
    expect(verdict.level).toBe("refuse");
    expect(verdict.level === "refuse" && verdict.message).toContain("rabaed-lane7 (G:/wt/rabaed-lane7; Main 7's, never stop it)");
  });
});

describe("staleReport", () => {
  const exists = (dir: string) => !dir.includes("gone");
  const volumes: Volume[] = [{ name: "rabaed-lane44_db-data", project: "rabaed-lane44" }];

  it("lists stopped stacks, stacks with a dead container, volume-only projects and stray containers; removes nothing", () => {
    const containers = [
      ...running([11]),
      container("rabaed-lane12", "exited", "rabaed-lane12-db-1"),
      container("rabaed-lane13", "exited", "rabaed-lane13-db-1", "G:/wt/gone-13"),
      container("rabaed-lane14"),
      container("rabaed-lane14", "exited", "rabaed-lane14-files-1"),
      container("", "running", "optimistic_lalande", ""),
      container("", "exited", "c3f9a1d2e4b5", ""),
    ];
    const lines = staleReport({ containers, volumes, exists, max: 8 }).join("\n");
    expect(lines).toContain("Running stacks: 2 of the cap 8");
    expect(lines).toContain("rabaed-lane12 (G:/wt/rabaed-lane12): rabaed-lane12-db-1 exited");
    expect(lines).toContain("rabaed-lane13 (G:/wt/gone-13, folder gone): rabaed-lane13-db-1 exited");
    expect(lines).toContain("rabaed-lane14 (G:/wt/rabaed-lane14): rabaed-lane14-files-1 exited");
    expect(lines).toContain("rabaed-lane44: rabaed-lane44_db-data");
    expect(lines).toContain("optimistic_lalande running");
    expect(lines).toContain("c3f9a1d2e4b5 exited");
    expect(lines).toContain("Nothing was removed.");
  });

  it("marks lane 7 as Main 7's in every section it shows up in", () => {
    const containers = [container("rabaed-lane7", "exited", "rabaed-lane7-db-1")];
    const lines = staleReport({ containers, volumes: [], exists, max: 8 }).join("\n");
    expect(lines).toContain("rabaed-lane7 (G:/wt/rabaed-lane7): rabaed-lane7-db-1 exited; Main 7's, never stop or prune it");
  });

  it("says a container with no working folder label has no folder, not that its folder is gone", () => {
    const lines = staleReport({ containers: [container("rabaed-lane22", "exited", "rabaed-lane22-db-1", "")], volumes: [], exists: () => false, max: 8 }).join("\n");
    expect(lines).toContain("rabaed-lane22 (no folder): rabaed-lane22-db-1 exited");
  });

  it("says so when there is nothing stale", () => {
    const lines = staleReport({ containers: running([11]), volumes: [], exists, max: 8 });
    expect(lines.join("\n")).toContain("No stopped stacks, dead containers, volume-only projects or stray containers.");
  });
});
