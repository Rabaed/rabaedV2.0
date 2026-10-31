import { describe, expect, it } from "vitest";
import type { Container, EnvClaim } from "./lanes.ts";
import {
  laneLabel,
  notMergedRefusal,
  parseLaneDoneArgs,
  decideLaneDone,
  releaseLines,
  type Candidate,
  type Decision,
  type DecisionInput,
  type PullRequest,
} from "./lane-done-plan.ts";

// RP-1170: `pnpm lane:done <pr>` decides here, on facts gathered by lane-done.ts, which of the lane's
// worktrees go and what happens to its stack. The safety rules are the point of the ticket.

const pr: PullRequest = {
  number: 580,
  state: "MERGED",
  mergedAt: "2026-10-31T16:54:12Z",
  headRefName: "RP-1170-lane-done",
  headRefOid: "c3",
  mergeCommit: "254b6aa0e1234567",
  commits: ["c1", "c2", "c3"],
};

const laneWt = (c: Partial<Candidate> = {}): Candidate => ({
  path: "G:/rabaed/.claude/worktrees/rp-1170",
  branch: "RP-1170-lane-done",
  head: "c3",
  kind: "lane",
  exists: true,
  isMain: false,
  isCurrent: false,
  held: undefined,
  heldByProcess: false,
  lockLive: false,
  changes: [],
  project: "rabaed-lane41",
  onPr: true,
  ahead: 0,
  filesNotInMain: undefined,
  ...c,
});

const agentWt = (id: string, c: Partial<Candidate> = {}): Candidate => ({
  ...laneWt(),
  path: `G:/rabaed/.claude/worktrees/agent-${id}`,
  branch: `RP-11${id}-part`,
  head: `a${id}`,
  kind: "agent",
  onPr: false,
  ahead: 2,
  filesNotInMain: [],
  ...c,
});

const db = (c: Partial<Container> = {}): Container => ({
  name: "rabaed-lane41-db-1",
  state: "running",
  project: "rabaed-lane41",
  workingDir: "G:/rabaed/.claude/worktrees/rp-1170",
  ports: [5641],
  ...c,
});

const input = (p: Partial<DecisionInput> = {}): DecisionInput => ({
  pr,
  lane: undefined,
  candidates: [laneWt()],
  claims: [],
  containers: [db()],
  volumes: [{ name: "rabaed-lane41_db-data", project: "rabaed-lane41" }],
  currentProject: "rabaed-lane40",
  volumesKeptBecause: undefined,
  force: false,
  exists: () => true,
  platform: "linux",
  ...p,
});

const reasons = (decision: Decision) => decision.kept.map((k) => `${k.what}: ${k.reason}`);

describe("parseLaneDoneArgs", () => {
  it("takes a PR number and the flags", () => {
    expect(parseLaneDoneArgs(["580"])).toEqual({ pr: 580, lane: undefined, force: false, yes: false, dryRun: false });
    expect(parseLaneDoneArgs(["#580", "--lane", "41", "--force", "--yes", "--dry-run"])).toEqual({ pr: 580, lane: 41, force: true, yes: true, dryRun: true });
  });

  it("refuses no PR, two PRs, an unknown flag, or a lane that is not one", () => {
    for (const args of [[], ["580", "581"], ["580", "--merged"], ["580", "--lane", "15"], ["580", "--lane"], ["abc"]]) expect(parseLaneDoneArgs(args)).toHaveProperty("error");
  });

  it("refuses --lane 7: Main 7's harness data is never freed (rule 1)", () => {
    const parsed = parseLaneDoneArgs(["580", "--lane", "7"]);
    expect(parsed).toHaveProperty("error");
    expect((parsed as { error: string }).error).toMatch(/lane 7 holds Main 7's UAT harness data/);
  });
});

describe("notMergedRefusal (rule 8: the PR is checked before anything else)", () => {
  it("passes a merged PR", () => expect(notMergedRefusal(pr)).toBeUndefined());

  it("refuses an open or closed PR, and says nothing was touched", () => {
    expect(notMergedRefusal({ ...pr, state: "OPEN", mergedAt: undefined })).toBe("lane:done refused: PR #580 is OPEN, not merged. Nothing was touched.");
    expect(notMergedRefusal({ ...pr, state: "CLOSED", mergedAt: undefined })).toMatch(/PR #580 is CLOSED, not merged/);
  });
});

describe("decideLaneDone: the lane's own worktree", () => {
  it("removes a clean worktree whose HEAD is one of the PR's merged commits, and the stack with its volumes", () => {
    const decision = decideLaneDone(input());
    expect(decision.refusal).toBeUndefined();
    expect(decision.remove.map((c) => c.path)).toEqual(["G:/rabaed/.claude/worktrees/rp-1170"]);
    expect(decision.kept).toEqual([]);
    expect(decision.stack).toEqual({ project: "rabaed-lane41", action: "remove", containers: ["rabaed-lane41-db-1"], volumes: ["rabaed-lane41_db-data"], why: [] });
  });

  it("never touches a worktree a live Claude session works in, even with --force, and keeps the stack (rule 2)", () => {
    const decision = decideLaneDone(input({ candidates: [laneWt({ held: "a running Claude session works in it (pid 99)" })], force: true }));
    expect(decision.remove).toEqual([]);
    expect(reasons(decision)).toEqual(["G:/rabaed/.claude/worktrees/rp-1170 (RP-1170-lane-done): held: a running Claude session works in it (pid 99)"]);
    expect(decision.stack?.action).toBe("keep");
    expect(decision.stack?.why).toEqual(["G:/rabaed/.claude/worktrees/rp-1170 is kept (above)"]);
  });

  it("does not count a branch with no commits of its own as merged, even with --force (rule 2: main-5-panel-days)", () => {
    // Its tip is in origin/main, but it is not one of the PR's commits: a session that just branched off main.
    const decision = decideLaneDone(input({ candidates: [laneWt({ head: "m9", onPr: false, ahead: 0 })], force: true }));
    expect(decision.remove).toEqual([]);
    expect(reasons(decision)[0]).toMatch(/HEAD m9 is not on PR #580's commits, so its own commits are not known to be merged/);
    expect(decision.stack?.action).toBe("keep");
  });

  it("lists uncommitted or untracked files and commits origin/main lacks, and keeps them unless --force (rule 6)", () => {
    const dirty = laneWt({ changes: ["M a.ts", "?? notes.md"], ahead: 1 });
    expect(reasons(decideLaneDone(input({ candidates: [dirty] })))).toEqual([
      "G:/rabaed/.claude/worktrees/rp-1170 (RP-1170-lane-done): uncommitted changes: M a.ts, ?? notes.md; 1 commit origin/main does not have; `--force` removes it anyway",
    ]);
    expect(decideLaneDone(input({ candidates: [dirty], force: true })).remove).toHaveLength(1);
  });

  it("keeps one whose state git could not read, unless --force", () => {
    const unread = laneWt({ changes: undefined, ahead: undefined });
    expect(reasons(decideLaneDone(input({ candidates: [unread] })))[0]).toMatch(/git could not read its changes or commits/);
    expect(decideLaneDone(input({ candidates: [unread], force: true })).remove).toHaveLength(1);
  });

  it("keeps a folder a running process holds, such as a dev server, and says how to stop it", () => {
    expect(reasons(decideLaneDone(input({ candidates: [laneWt({ heldByProcess: true })], force: true })))[0]).toMatch(/a running process holds its folder.*pnpm servers:stop --yes --worktree/);
  });

  it("never removes the main checkout or the worktree it runs in", () => {
    const decision = decideLaneDone(input({ candidates: [laneWt({ isMain: true }), laneWt({ path: "G:/x/here", isCurrent: true })], force: true }));
    expect(decision.remove).toEqual([]);
    expect(reasons(decision)).toEqual([
      "G:/rabaed/.claude/worktrees/rp-1170 (RP-1170-lane-done): the main checkout",
      "G:/x/here (RP-1170-lane-done): the current worktree: run pnpm lane:done from another worktree (the Main's or the Orchestrator's)",
    ]);
  });
});

describe("decideLaneDone: lane 7 (rule 1)", () => {
  it("refuses outright when the PR's worktree holds lane 7", () => {
    const decision = decideLaneDone(input({ candidates: [laneWt({ project: "rabaed-lane7" })], containers: [db({ project: "rabaed-lane7" })] }));
    expect(decision.refusal).toMatch(/^lane:done refused: lane 7 holds Main 7's UAT harness data/);
    expect(decision.remove).toEqual([]);
    expect(decision.stack).toBeUndefined();
  });

  it("refuses --lane 7 even with no worktree found", () => {
    expect(decideLaneDone(input({ candidates: [], lane: 7 })).refusal).toMatch(/lane 7 holds Main 7's/);
  });

  it("refuses a --lane that is not the lane the worktree's .env names", () => {
    expect(decideLaneDone(input({ lane: 42 })).refusal).toBe(
      "lane:done refused: G:/rabaed/.claude/worktrees/rp-1170 has rabaed-lane41 in its .env, not lane 42. Nothing was touched.",
    );
  });
});

describe("decideLaneDone: the subagent worktrees (rule 3)", () => {
  it("removes one whose every changed file is in origin/main (a cherry-picked result), though its commits are not", () => {
    const decision = decideLaneDone(input({ candidates: [laneWt(), agentWt("a")] }));
    expect(decision.remove.map((c) => c.path)).toEqual(["G:/rabaed/.claude/worktrees/rp-1170", "G:/rabaed/.claude/worktrees/agent-a"]);
    expect(decision.stack?.action).toBe("remove");
  });

  it("lists every subagent worktree it keeps at once, each with its files, and keeps the stack", () => {
    const decision = decideLaneDone(
      input({
        candidates: [laneWt(), agentWt("a", { filesNotInMain: ["scripts/a.ts"] }), agentWt("b", { filesNotInMain: undefined }), agentWt("c", { lockLive: true }), agentWt("d")],
        force: true,
      }),
    );
    expect(decision.remove.map((c) => c.path)).toEqual(["G:/rabaed/.claude/worktrees/rp-1170", "G:/rabaed/.claude/worktrees/agent-d"]);
    expect(reasons(decision)).toEqual([
      "G:/rabaed/.claude/worktrees/agent-a (RP-11a-part): 1 path its branch changed is not as in origin/main: scripts/a.ts",
      "G:/rabaed/.claude/worktrees/agent-b (RP-11b-part): its changes could not be compared with origin/main",
      "G:/rabaed/.claude/worktrees/agent-c (RP-11c-part): locked by a running session (its subagent may still run)",
    ]);
    expect(decision.stack?.action).toBe("keep");
    expect(decision.stack?.why).toEqual([
      "G:/rabaed/.claude/worktrees/agent-a is kept (above)",
      "G:/rabaed/.claude/worktrees/agent-b is kept (above)",
      "G:/rabaed/.claude/worktrees/agent-c is kept (above)",
    ]);
  });

  it("keeps a dirty subagent worktree unless --force, listing its files", () => {
    const dirty = agentWt("a", { changes: ["?? out.txt"] });
    expect(reasons(decideLaneDone(input({ candidates: [laneWt(), dirty] })))).toEqual([
      "G:/rabaed/.claude/worktrees/agent-a (RP-11a-part): uncommitted changes: ?? out.txt; `--force` removes it anyway",
    ]);
    expect(decideLaneDone(input({ candidates: [laneWt(), dirty], force: true })).remove).toHaveLength(2);
  });
});

describe("decideLaneDone: the stack", () => {
  it("keeps it while any other worktree's .env names it, listing every one at once (rule 2)", () => {
    const claims: EnvClaim[] = [
      { path: "G:/rabaed/.claude/worktrees/rp-1171", branch: "RP-1171-x", project: "rabaed-lane41" },
      { path: "G:/rabaed/.claude/worktrees/rp-1172", branch: undefined, project: "rabaed-lane41" },
      { path: "G:/rabaed/.claude/worktrees/rp-1173", branch: "RP-1173-y", project: "rabaed-lane42" },
    ];
    const decision = decideLaneDone(input({ claims }));
    expect(decision.remove).toHaveLength(1);
    expect(decision.stack?.action).toBe("keep");
    expect(decision.stack?.why).toEqual([
      "the .env of G:/rabaed/.claude/worktrees/rp-1171 (on RP-1171-x) has it",
      "the .env of G:/rabaed/.claude/worktrees/rp-1172 (on a detached HEAD) has it",
    ]);
  });

  it("keeps it when this worktree's own .env names it", () => {
    expect(decideLaneDone(input({ currentProject: "rabaed-lane41" })).stack?.why).toEqual(["this worktree's .env has it: run pnpm lane:done from another worktree"]);
  });

  it("keeps it while a container of it comes from a folder that stays", () => {
    const decision = decideLaneDone(input({ containers: [db(), db({ name: "rabaed-lane41-files-1", workingDir: "G:/elsewhere" })] }));
    expect(decision.stack?.why).toEqual(["rabaed-lane41-files-1 comes from G:/elsewhere, which stays"]);
  });

  it("removes the containers but keeps the volumes while a verify runs anywhere (rule 4)", () => {
    const decision = decideLaneDone(input({ volumesKeptBecause: "a verify runs (pid 7, in G:/rabaed/.claude/worktrees/rp-900)" }));
    expect(decision.stack).toEqual({
      project: "rabaed-lane41",
      action: "containers",
      containers: ["rabaed-lane41-db-1"],
      volumes: ["rabaed-lane41_db-data"],
      why: ["its volumes stay: a verify runs (pid 7, in G:/rabaed/.claude/worktrees/rp-900); run `pnpm lanes:prune --lane 41` once no verify runs"],
    });
  });

  it("frees the lane --lane names when the PR's worktree is already gone", () => {
    const decision = decideLaneDone(input({ candidates: [], lane: 41, containers: [db({ workingDir: "G:/gone" })], exists: (dir) => dir !== "G:/gone" }));
    expect(decision.kept).toEqual([]);
    expect(decision.remarks).toEqual(["No worktree of this clone is on PR #580's branch RP-1170-lane-done (removed already?)."]);
    expect(decision.stack?.action).toBe("remove");
  });

  it("says how to free a stack when it cannot tell the lane", () => {
    const decision = decideLaneDone(input({ candidates: [laneWt({ project: undefined })] }));
    expect(decision.stack).toBeUndefined();
    expect(decision.remarks).toEqual(["G:/rabaed/.claude/worktrees/rp-1170's .env has no lane stack: pass `--lane N` to free one."]);
  });

  it("has nothing to do when the lane has no containers or volumes left", () => {
    expect(decideLaneDone(input({ containers: [], volumes: [] })).stack?.action).toBe("none");
  });
});

describe("laneLabel", () => {
  it("names the Main and lane of a lane number", () => {
    expect(laneLabel(41)).toBe("Main 4, lane-4a (lane 41)");
    expect(laneLabel(54)).toBe("Main 5, lane-5d (lane 54)");
    expect(laneLabel(30)).toBe("Main 3 (lane 30)");
    expect(laneLabel(5)).toBe("lane 5");
    expect(laneLabel(undefined)).toBe("lane unknown");
  });
});

describe("releaseLines (rule 8: the last line is the RP-603 RELEASE text to paste)", () => {
  it("releases every claim under the branch's key, naming the PR, its merge and the lane", () => {
    expect(releaseLines({ pr, lane: 41, openSiblings: [] })).toEqual([
      "RELEASE all RP-1170 claims — RP-1170 (PR #580, merged 2026-10-31 16:54 UTC as 254b6aa0e). Main 4, lane-4a (lane 41).",
    ]);
  });

  it("warns first when the key still has open PRs, since a RELEASE naming the key releases all its claims", () => {
    const lines = releaseLines({ pr, lane: 41, openSiblings: [581, 583] });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("RP-1170 still has open PRs #581, #583: a RELEASE with RP-1170 releases all its claims, so CLAIM them again after posting it.");
    expect(lines[1]).toMatch(/^RELEASE all RP-1170 claims/);
  });

  it("asks for the claim's comment id when the branch names no key", () => {
    expect(releaseLines({ pr: { ...pr, headRefName: "claude/x" }, lane: undefined, openSiblings: [] })).toEqual([
      "RELEASE <claim comment id> — PR #580 (branch claude/x has no RP key; merged 2026-10-31 16:54 UTC as 254b6aa0e). lane unknown.",
    ]);
  });
});
