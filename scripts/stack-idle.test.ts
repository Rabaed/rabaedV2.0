import { describe, expect, it } from "vitest";
import type { Container } from "./lanes.ts";
import { stackCap } from "./machine-load.ts";
import { idleOfStack, lastActivity } from "./stack-idle.ts";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const HOUR = 3_600_000;
const container = (project: string, workingDir: string, name = `${project}-db-1`): Container => ({ name, state: "running", project, workingDir, ports: [] });
const lanes = (count: number) => Array.from({ length: count }, (_, i) => 20 + i);
const running = (ns: number[]) => ns.map((n) => container(`rabaed-lane${n}`, `G:/wt/lane${n}`));

describe("lastActivity", () => {
  it("is the newer of the last commit and the newest uncommitted change", () => {
    expect(lastActivity("x", () => ({ lastCommit: 5, newestChange: 9 }))).toBe(9);
    expect(lastActivity("x", () => ({ lastCommit: 5, newestChange: undefined }))).toBe(5);
  });

  it("is undefined for a folder that is gone or has no activity", () => {
    expect(lastActivity("x", () => undefined)).toBeUndefined();
    expect(lastActivity("x", () => ({ lastCommit: undefined, newestChange: undefined }))).toBeUndefined();
  });
});

describe("the stack cap's refusal with idle times", () => {
  const activity: Record<string, number> = { "G:/wt/lane20": NOW - 3 * HOUR, "G:/wt/lane21": NOW - 20 * 60_000, "G:/wt/lane22": NOW - 50 * HOUR };
  const idleOf = idleOfStack((dir) => activity[dir], NOW);

  it("lists each running stack with its idle time when the cap is reached", () => {
    const verdict = stackCap(31, running(lanes(8)), 8, idleOf);
    expect(verdict.level).toBe("refuse");
    const message = verdict.level === "refuse" ? verdict.message : "";
    expect(message).toContain("rabaed-lane20 (G:/wt/lane20; idle 3 h)");
    expect(message).toContain("rabaed-lane21 (G:/wt/lane21; idle 20 min)");
    expect(message).toContain("rabaed-lane22 (G:/wt/lane22; idle 2 d)");
  });

  it("says idle unknown for a stack whose folder has no activity, rather than hiding it", () => {
    const verdict = stackCap(31, running(lanes(8)), 8, idleOf);
    const message = verdict.level === "refuse" ? verdict.message : "";
    expect(message).toContain("rabaed-lane23 (G:/wt/lane23; idle unknown)");
  });

  it("uses the newest activity across a stack's folders", () => {
    const two = idleOfStack((dir) => (dir === "a" ? NOW - 5 * HOUR : NOW - HOUR), NOW);
    expect(two({ project: "rabaed-lane1", dirs: ["a", "b"] })).toBe("idle 1 h");
  });

  it("still flags lane 7 as Main 7's, with its idle time", () => {
    const verdict = stackCap(31, [...running(lanes(7)), container("rabaed-lane7", "G:/wt/lane7")], 8, idleOf);
    const message = verdict.level === "refuse" ? verdict.message : "";
    expect(message).toContain("rabaed-lane7 (G:/wt/lane7; idle unknown; Main 7's, never stop it)");
  });

  it("lists the same stacks with idle times in the warning near the cap", () => {
    const verdict = stackCap(31, running(lanes(6)), 8, idleOf);
    expect(verdict.level).toBe("warn");
    expect(verdict.level === "warn" ? verdict.message : "").toContain("rabaed-lane20 (G:/wt/lane20; idle 3 h)");
  });
});
