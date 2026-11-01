import { describe, expect, it } from "vitest";
import { parseLaneResetArgs, projectParts, resetLane, type ResetDeps } from "./lane-reset.ts";
import type { Container, StaleProject, Volume } from "./lanes.ts";

const container = (name: string, project: string, workingDir = "C:\\w\\lane"): Container => ({ name, state: "running", project, workingDir, ports: [] });
const volume = (name: string, project: string): Volume => ({ name, project });

type Fake = { deps: ResetDeps; out: string[]; err: string[]; removed: StaleProject[]; asked: string[] };

function fake(over: Partial<ResetDeps> & { answer?: boolean } = {}): Fake {
  const out: string[] = [];
  const err: string[] = [];
  const removed: StaleProject[] = [];
  const asked: string[] = [];
  const { answer = true, ...rest } = over;
  const deps: ResetDeps = {
    cwd: "C:\\w\\mine",
    listContainers: () => [container("rabaed-lane33-db-1", "rabaed-lane33"), container("rabaed-lane331-db-1", "rabaed-lane331"), container("rabaed-lane3-db-1", "rabaed-lane3")],
    listVolumes: () => [volume("rabaed-lane33_db-data", "rabaed-lane33"), volume("rabaed-lane33_files-data", "rabaed-lane33"), volume("rabaed-lane3_db-data", "rabaed-lane3")],
    worktrees: () => [{ path: "C:\\w\\mine", branch: "RP-1" }],
    readEnv: () => "COMPOSE_PROJECT_NAME=rabaed-lane33\n",
    exists: () => true,
    holders: () => ({ runningSession: () => undefined, desktopSession: () => undefined }),
    verifies: () => ({ runs: [] }),
    remove: (stale) => {
      removed.push(stale);
      return { volumesKept: undefined };
    },
    confirm: async (q) => {
      asked.push(q);
      return answer;
    },
    log: (l) => out.push(l),
    error: (l) => err.push(l),
    platform: "win32",
    ...rest,
  };
  return { deps, out, err, removed, asked };
}

describe("parseLaneResetArgs", () => {
  it("takes a lane and --yes", () => {
    expect(parseLaneResetArgs(["33", "--yes"])).toEqual({ lane: 33, yes: true });
    expect(parseLaneResetArgs(["33"])).toEqual({ lane: 33, yes: false });
  });
  it("rejects a bad lane, no lane, two lanes and unknown flags", () => {
    for (const bad of [["99"], ["abc"], [], ["33", "34"], ["33", "--force"], ["3.5"], ["-1"]]) expect(parseLaneResetArgs(bad)).toHaveProperty("error");
  });
});

describe("projectParts", () => {
  it("matches the exact project: rabaed-lane3 never takes rabaed-lane31's or lane33's", () => {
    const containers = [container("a", "rabaed-lane3"), container("b", "rabaed-lane31"), container("c", "rabaed-lane33"), container("d", "other")];
    const volumes = [volume("v3", "rabaed-lane3"), volume("v31", "rabaed-lane31"), volume("rabaed-lane3_x", "rabaed-lane31")];
    expect(projectParts("rabaed-lane3", containers, volumes)).toMatchObject({ containers: ["a"], volumes: ["v3"] });
    expect(projectParts("rabaed-lane31", containers, volumes)).toMatchObject({ containers: ["b"], volumes: ["v31", "rabaed-lane3_x"] });
  });
});

describe("resetLane", () => {
  it("happy path: lists the volumes, asks, removes only that project, says how to start fresh", async () => {
    const f = fake();
    expect(await resetLane(["33"], f.deps)).toBe(0);
    expect(f.out.join("\n")).toContain("rabaed-lane33_db-data, rabaed-lane33_files-data");
    expect(f.asked).toHaveLength(1);
    expect(f.removed).toEqual([{ project: "rabaed-lane33", reason: "lane:reset", containers: ["rabaed-lane33-db-1"], volumes: ["rabaed-lane33_db-data", "rabaed-lane33_files-data"] }]);
    expect(f.out.join("\n")).toMatch(/Removed rabaed-lane33/);
    expect(f.out.join("\n")).toContain("pnpm lane:env 33 --force");
  });

  it("never touches lane 3 or lane 331 when asked for 33, nor 3 when asked for 3 vs 33", async () => {
    const f = fake();
    await resetLane(["3"], f.deps);
    expect(f.removed).toHaveLength(1);
    expect(f.removed[0]).toMatchObject({ project: "rabaed-lane3", containers: ["rabaed-lane3-db-1"], volumes: ["rabaed-lane3_db-data"] });
  });

  it("an answer of no removes nothing", async () => {
    const f = fake({ answer: false });
    expect(await resetLane(["33"], f.deps)).toBe(0);
    expect(f.removed).toEqual([]);
  });

  it("nothing to remove: no prompt, no removal", async () => {
    const f = fake();
    expect(await resetLane(["34"], f.deps)).toBe(0);
    expect(f.asked).toEqual([]);
    expect(f.removed).toEqual([]);
    expect(f.out.join("\n")).toContain("nothing to remove");
  });

  it("refuses bad arguments with exit 2", async () => {
    const f = fake();
    expect(await resetLane(["99"], f.deps)).toBe(2);
    expect(f.removed).toEqual([]);
  });

  it("refuses the protected lane 7 before reading Docker", async () => {
    let read = false;
    const f = fake({ listContainers: () => ((read = true), []) });
    expect(await resetLane(["7"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toContain("Main 7's UAT harness");
    expect(read).toBe(false);
    expect(f.asked).toEqual([]);
    expect(f.removed).toEqual([]);
  });

  it("refuses when Docker does not answer (containers or volumes)", async () => {
    for (const over of [{ listContainers: () => undefined }, { listVolumes: () => { throw new Error("timed out"); } }]) {
      const f = fake(over);
      expect(await resetLane(["33"], f.deps)).toBe(1);
      expect(f.err.join("\n")).toContain("Docker is not answering");
      expect(f.asked).toEqual([]);
      expect(f.removed).toEqual([]);
    }
  });

  it("refuses while any verify runs, even one for another lane", async () => {
    const holder = { pid: 1, started: new Date(0), command: "pnpm verify" };
    const f = fake({ verifies: () => ({ runs: [{ where: "C:\\w\\other", holder }] }) });
    expect(await resetLane(["33"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toContain("a verify runs");
    expect(f.asked).toEqual([]);
    expect(f.removed).toEqual([]);
  });

  it("refuses when whether a verify runs is unknown", async () => {
    const f = fake({ verifies: () => ({ unknown: "git failed" }) });
    expect(await resetLane(["33"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toContain("could not be checked (git failed)");
    expect(f.removed).toEqual([]);
  });

  it("refuses when a live Claude session holds a container folder", async () => {
    const f = fake({
      listContainers: () => [container("rabaed-lane33-db-1", "rabaed-lane33", "C:\\w\\theirs")],
      holders: () => ({ runningSession: (p) => (p === "C:\\w\\theirs" ? "a Claude session runs there" : undefined), desktopSession: () => undefined }),
    });
    expect(await resetLane(["33"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toContain("a Claude session runs there");
    expect(f.asked).toEqual([]);
    expect(f.removed).toEqual([]);
  });

  it("refuses when an open desktop session holds a folder whose .env names the project", async () => {
    const f = fake({
      worktrees: () => [{ path: "C:\\w\\theirs", branch: "RP-9" }],
      holders: () => ({ runningSession: () => undefined, desktopSession: (p) => (p === "C:\\w\\theirs" ? ({ title: "t", id: "i" } as never) : undefined) }),
    });
    expect(await resetLane(["33"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toContain("held by a Claude session in C:\\w\\theirs");
    expect(f.removed).toEqual([]);
  });

  it("does not count this worktree's own session or .env as a holder", async () => {
    const f = fake({
      listContainers: () => [container("rabaed-lane33-db-1", "rabaed-lane33", "C:\\w\\MINE\\")],
      holders: () => ({ runningSession: () => "this very session", desktopSession: () => undefined }),
    });
    expect(await resetLane(["33"], f.deps)).toBe(0);
    expect(f.removed).toHaveLength(1);
  });

  it("refuses when another worktree's .env names the project", async () => {
    const f = fake({ worktrees: () => [{ path: "C:\\w\\mine", branch: "RP-1" }, { path: "C:\\w\\theirs", branch: "RP-9" }] });
    expect(await resetLane(["33"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toContain("another worktree's .env uses rabaed-lane33: C:\\w\\theirs (RP-9)");
    expect(f.asked).toEqual([]);
    expect(f.removed).toEqual([]);
  });

  it("another worktree's .env naming a lane like it (lane 3 vs 33) is not a claim", async () => {
    const f = fake({
      worktrees: () => [{ path: "C:\\w\\mine", branch: "RP-1" }, { path: "C:\\w\\theirs", branch: "RP-9" }],
      readEnv: (dir) => (dir === "C:\\w\\theirs" ? "COMPOSE_PROJECT_NAME=rabaed-lane331\n" : undefined),
    });
    expect(await resetLane(["33"], f.deps)).toBe(0);
    expect(f.removed).toHaveLength(1);
  });

  it("looks again after the prompt: a verify that started meanwhile stops the removal", async () => {
    let runs = false;
    const holder = { pid: 1, started: new Date(0), command: "pnpm verify" };
    const f = fake({
      verifies: () => (runs ? { runs: [{ where: "C:\\w\\x", holder }] } : { runs: [] }),
      confirm: async () => {
        runs = true;
        return true;
      },
    });
    expect(await resetLane(["33"], f.deps)).toBe(1);
    expect(f.removed).toEqual([]);
  });

  it("reports a failed removal and a kept volume as failures", async () => {
    const boom = fake({ remove: () => { throw new Error("Could not remove container x"); } });
    expect(await resetLane(["33"], boom.deps)).toBe(1);
    expect(boom.err.join("\n")).toContain("Could not remove container x");
    const kept = fake({ remove: () => ({ volumesKept: "a verify runs (x)" }) });
    expect(await resetLane(["33"], kept.deps)).toBe(1);
    expect(kept.out.join("\n")).not.toContain("Removed");
  });
});
