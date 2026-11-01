import { describe, expect, it } from "vitest";
import type { Container, EnvClaim } from "./lanes.ts";
import {
  claimIdsFor,
  laneLabel,
  laneStacks,
  lastLines,
  mergedLeftovers,
  startWithoutNumber,
  notMergedRefusal,
  parseLaneDoneArgs,
  decideLaneDone,
  releaseLines,
  restLine,
  type Candidate,
  type Decision,
  type DecisionInput,
  type LaneStack,
  type PullRequest,
} from "./lane-done-plan.ts";

// RP-1170: `pnpm lane:done 580` decides here, on facts gathered by lane-done.ts, which of the lane's
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
  appWorktree: true,
  held: undefined,
  heldByProcess: false,
  lockLive: false,
  locked: undefined,
  ownChanges: undefined,
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
  locked: "claude agent agent-x (pid 4242)",
  ownChanges: 1,
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

  it("takes no PR number (RP-1198: it is found from the current branch)", () => {
    expect(parseLaneDoneArgs([])).toEqual({ pr: undefined, lane: undefined, force: false, yes: false, dryRun: false });
    expect(parseLaneDoneArgs(["--dry-run"])).toEqual({ pr: undefined, lane: undefined, force: false, yes: false, dryRun: true });
  });

  it("writes its usage with no angle brackets, which PowerShell reads as a redirect (RP-1198)", () => {
    expect((parseLaneDoneArgs(["abc"]) as { error: string }).error).not.toMatch(/[<>]/);
  });

  it("refuses two PRs, an unknown flag, or a lane that is not one", () => {
    for (const args of [["580", "581"], ["580", "--merged"], ["580", "--lane", "15"], ["580", "--lane"], ["abc"]]) expect(parseLaneDoneArgs(args)).toHaveProperty("error");
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
      "G:/rabaed/.claude/worktrees/rp-1170 (RP-1170-lane-done): uncommitted changes: M a.ts, ?? notes.md; 1 commit origin/main does not have; `pnpm lane:done 580 --force` removes it anyway",
    ]);
    expect(decideLaneDone(input({ candidates: [dirty], force: true })).remove).toHaveLength(1);
  });

  it("keeps one whose state git could not read, unless --force", () => {
    const unread = laneWt({ changes: undefined, ahead: undefined });
    expect(reasons(decideLaneDone(input({ candidates: [unread] })))[0]).toMatch(/git could not read its changes or commits/);
    expect(decideLaneDone(input({ candidates: [unread], force: true })).remove).toHaveLength(1);
  });

  it("keeps a folder a running process holds, such as a dev server, and says how to stop it", () => {
    expect(reasons(decideLaneDone(input({ candidates: [laneWt({ heldByProcess: true })], force: true })))[0]).toMatch(
      /a running process holds its folder.*`pnpm servers:stop --yes --worktree "G:\/rabaed\/\.claude\/worktrees\/rp-1170"`/,
    );
  });

  it("never removes the main checkout or the worktree it runs in", () => {
    const decision = decideLaneDone(input({ candidates: [laneWt({ isMain: true }), laneWt({ path: "G:/x/here", isCurrent: true })], force: true }));
    expect(decision.remove).toEqual([]);
    expect(reasons(decision)).toEqual([
      "G:/rabaed/.claude/worktrees/rp-1170 (RP-1170-lane-done): the main checkout",
      "G:/x/here (RP-1170-lane-done): the current worktree: run `pnpm lane:done 580 --yes` from another worktree (the Main's or the Orchestrator's)",
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
      "G:/rabaed/.claude/worktrees/agent-a (RP-11a-part): uncommitted changes: ?? out.txt; `pnpm lane:done 580 --force` removes it anyway",
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
    expect(decideLaneDone(input({ currentProject: "rabaed-lane41" })).stack?.why).toEqual(["this worktree's .env has it: run `pnpm lane:done 580 --yes` from another worktree"]);
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

  it("names the lane whose containers come from the folder when its .env has none (RP-1198: no `--lane N` placeholder)", () => {
    const decision = decideLaneDone(input({ candidates: [laneWt({ project: undefined })], containers: [db(), db({ name: "rabaed-lane42-db-1", project: "rabaed-lane42" })] }));
    expect(decision.stack).toBeUndefined();
    expect(decision.remarks).toEqual([
      "G:/rabaed/.claude/worktrees/rp-1170's .env has no lane stack, but containers of lane 41, lane 42 come from its folder: `pnpm lane:done 580 --lane 41`, `pnpm lane:done 580 --lane 42` frees one.",
    ]);
  });

  it("says no stack is known when its .env has none and no container comes from its folder", () => {
    const decision = decideLaneDone(input({ candidates: [laneWt({ project: undefined })], containers: [db({ workingDir: "G:/elsewhere" })] }));
    expect(decision.remarks).toEqual([
      "G:/rabaed/.claude/worktrees/rp-1170's .env has no lane stack and no container comes from its folder, so lane:done frees none; `pnpm lanes:prune --stale` lists the stacks.",
    ]);
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

  it("names the claims' comment ids when the branch names no key and RP-603 could be read (RP-1198)", () => {
    expect(releaseLines({ pr: { ...pr, headRefName: "claude/x" }, lane: undefined, openSiblings: [], claimIds: [14324, 14333] })).toEqual([
      "RELEASE 14324, 14333 — PR #580 (branch claude/x has no RP key; merged 2026-10-31 16:54 UTC as 254b6aa0e). lane unknown.",
    ]);
  });

  it("drops the placeholder when the claims could not be read, and says where to find the ids (RP-1198)", () => {
    const lines = releaseLines({ pr: { ...pr, headRefName: "claude/x" }, lane: undefined, openSiblings: [], claimIds: undefined });
    expect(lines).toEqual([
      "RP-603's claims could not be read (JIRA_EMAIL and JIRA_API_TOKEN not set, or Jira did not answer): after RELEASE, add the number of each claim comment this PR made; `pnpm claims --open` lists them.",
      "RELEASE — PR #580 (branch claude/x has no RP key; merged 2026-10-31 16:54 UTC as 254b6aa0e). lane unknown.",
    ]);
    expect(lines.join("\n")).not.toMatch(/[<>]/);
  });

  it("says so when no open claim names the PR or its branch", () => {
    expect(releaseLines({ pr: { ...pr, headRefName: "claude/x" }, lane: undefined, openSiblings: [], claimIds: [] })[0]).toBe(
      "No open RP-603 claim mentions PR #580 or branch claude/x: after RELEASE, add the number of each claim comment this PR made; `pnpm claims --open` lists them.",
    );
  });
});

describe("restLine (RP-1198: run inside the lane, lane:done ends with the exact command for the rest)", () => {
  it("names the PR and the flags to run from the Main's worktree", () => {
    expect(restLine(pr)).toBe("This worktree and its stack stay: for the rest, run `pnpm lane:done 580 --yes` from the Main's worktree, then post the RELEASE it prints.");
  });
});

// RP-1198 review P3: the no-number wiring, through an injected gh, as lane-done.ts runs it.
describe("startWithoutNumber and lastLines (RP-1198: `pnpm lane:done` with no number)", () => {
  const HEAD_QUERY = "pr list --head RP-1190-x --state merged --limit 1 --json number";
  const MERGED_QUERY = "pr list --state merged --limit 200 --json number,headRefName,headRefOid";
  /** A fake gh: answers by its arguments, and records each call. */
  const gh = (answers: Record<string, string | Error>) => {
    const asked: string[] = [];
    const run = (args: string[]) => {
      const line = args.join(" ");
      asked.push(line);
      const answer = answers[line];
      if (answer === undefined) throw new Error(`unexpected gh ${line}`);
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { asked, run };
  };
  const lane = "G:/rabaed/.claude/worktrees/rp-1190";
  const start = (run: (args: string[]) => string, currentBranch: string | undefined = "RP-1190-x") =>
    startWithoutNumber({
      currentBranch,
      gh: run,
      worktrees: () => [
        { path: "G:/rabaed", branch: "main", head: "0".repeat(40), project: undefined },
        { path: lane, branch: "RP-1190-x", head: "a".repeat(40), project: "rabaed-lane41" },
      ],
      mainRoot: "G:/rabaed",
      stacks: () => [],
      platform: "linux",
    });

  it("takes the current branch's merged PR, and run in the lane it keeps the lane and ends with `pnpm lane:done 590 --yes`", () => {
    const fake = gh({ [HEAD_QUERY]: '[{"number":590}]' });
    const started = start(fake.run);
    expect(started).toEqual({ pr: 590 });
    expect(fake.asked).toEqual([HEAD_QUERY]);

    const merged = { ...pr, number: 590, headRefName: "RP-1190-x" };
    const candidates = [laneWt({ path: lane, branch: "RP-1190-x", isCurrent: true })];
    const decision = decideLaneDone(input({ pr: merged, candidates, currentProject: "rabaed-lane41" }));
    expect(decision.remove).toEqual([]);
    expect(reasons(decision)[0]).toContain("the current worktree: run `pnpm lane:done 590 --yes` from another worktree");
    let released = false;
    const lines = lastLines({ pr: merged, candidates, release: () => ((released = true), ["RELEASE"]) });
    expect(lines.at(-1)).toBe("This worktree and its stack stay: for the rest, run `pnpm lane:done 590 --yes` from the Main's worktree, then post the RELEASE it prints.");
    expect(released).toBe(false);
  });

  it("from another worktree ends with the RELEASE", () => {
    expect(lastLines({ pr, candidates: [laneWt()], release: () => ["RELEASE all RP-1170 claims"] })).toEqual(["RELEASE all RP-1170 claims"]);
  });

  it("lists the merged PRs left here when the current branch has none, and never asks for main's", () => {
    const fake = gh({ [HEAD_QUERY]: "[]", [MERGED_QUERY]: '[{"number":590,"headRefName":"RP-1190-x","headRefOid":"' + "a".repeat(40) + '"}]' });
    const started = start(fake.run);
    expect(started).toEqual({
      list: [
        "The current branch RP-1190-x has no merged PR, so lane:done removes nothing here. Merged PRs (of the last 200) that still have a worktree or stack in this clone:",
        `  PR #590 (RP-1190-x): "${lane}" with stack rabaed-lane41: pnpm lane:done 590`,
        "Run each from this worktree; it lists what it would remove and asks first. Nothing was removed.",
      ],
    });
    const onMain = gh({ [MERGED_QUERY]: "[]" });
    expect(start(onMain.run, "main")).toMatchObject({ list: [expect.stringMatching(/^The current branch main has no merged PR/)] });
    expect(onMain.asked).toEqual([MERGED_QUERY]);
  });

  it("stops with one clear line when gh fails", () => {
    const failing = Object.assign(new Error("Command failed: gh"), { stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login\n" });
    const started = start(gh({ [HEAD_QUERY]: failing }).run);
    expect(started).toEqual({ error: `lane:done refused: \`gh ${HEAD_QUERY}\` failed (HTTP 401: Bad credentials (https://api.github.com/graphql)). Nothing was touched.` });
    expect(start(gh({ [HEAD_QUERY]: "[]", [MERGED_QUERY]: "not json" }).run)).toMatchObject({ error: expect.stringMatching(/^lane:done refused: `gh pr list --state merged .*` failed \(.*\)\. Nothing was touched\.$/) });
  });
});

describe("mergedLeftovers (RP-1198:`pnpm lane:done` with no number, outside a lane, lists and removes nothing)", () => {
  const wt = (path: string, branch: string | undefined, head = "0".repeat(40), project?: string) => ({ path, branch, head, project });
  const merged = [
    { number: 590, headRefName: "RP-1190-x", headRefOid: "a".repeat(40) },
    { number: 588, headRefName: "RP-1188-y", headRefOid: "b".repeat(40) },
    { number: 585, headRefName: "RP-1185-z", headRefOid: "c".repeat(40) },
    { number: 570, headRefName: "main", headRefOid: "d".repeat(40) },
  ];
  const base = { mainRoot: "G:/rabaed", currentBranch: "main-4-work" as string | undefined, merged, limit: 200, stacks: [] as LaneStack[] | undefined, platform: "linux" as const };

  // RP-1198 review P1: "every merged PR that still has a worktree or stack in this clone" (comment 15382, point 2).
  describe("lane stacks whose worktree is gone", () => {
    const stack = (lane: number, ...folders: string[]): LaneStack => ({ project: `rabaed-lane${lane}`, folders });

    it("lists a stack under the merged PR its folder is named after, or whose worktree git still lists, with --lane", () => {
      const lines = mergedLeftovers({
        ...base,
        worktrees: [wt("G:/rabaed", "main"), wt("G:/rabaed/.claude/worktrees/rp-1188", "RP-1188-y")],
        stacks: [stack(42, "G:/rabaed/.claude/worktrees/RP-1190-x"), stack(43, "G:/rabaed/.claude/worktrees/rp-1188"), stack(31, "G:/rabaed/.claude/worktrees/worktree-RP-1185-z")],
      });
      expect(lines).toEqual([
        "The current branch main-4-work has no merged PR, so lane:done removes nothing here. Merged PRs (of the last 200) that still have a worktree or stack in this clone:",
        '  PR #585 (RP-1185-z): stack rabaed-lane31 (its worktree "G:/rabaed/.claude/worktrees/worktree-RP-1185-z" is gone): pnpm lane:done 585 --lane 31',
        '  PR #588 (RP-1188-y): "G:/rabaed/.claude/worktrees/rp-1188", stack rabaed-lane43: pnpm lane:done 588 --lane 43',
        '  PR #590 (RP-1190-x): stack rabaed-lane42 (its worktree "G:/rabaed/.claude/worktrees/RP-1190-x" is gone): pnpm lane:done 590 --lane 42',
        "Run each from this worktree; it lists what it would remove and asks first. Nothing was removed.",
      ]);
    });

    it("lists a stack tied to no merged PR as an orphan, with the lanes:prune command; volumes only too", () => {
      const lines = mergedLeftovers({ ...base, worktrees: [wt("G:/rabaed", "main")], stacks: [stack(44, "G:/rabaed/.claude/worktrees/hopeful-x"), stack(32)] });
      expect(lines).toEqual([
        "The current branch main-4-work has no merged PR, so lane:done removes nothing here. No merged PR (of the last 200) still has a worktree or stack in this clone.",
        "Lane stacks whose worktree is gone, tied to no merged PR here:",
        '  rabaed-lane44 (from "G:/rabaed/.claude/worktrees/hopeful-x"): pnpm lanes:prune --merged --lane 44',
        "  rabaed-lane32 (volumes only): pnpm lanes:prune --merged --lane 32",
        "Run each from this worktree; it lists what it would remove and asks first. Nothing was removed.",
      ]);
    });

    it("never lists lane 7's stack, the main checkout's, or one a living worktree's .env or folder holds", () => {
      const lines = mergedLeftovers({
        ...base,
        worktrees: [wt("G:/rabaed", "main"), wt("G:/rabaed/.claude/worktrees/rp-1200", "RP-1200-open", "f".repeat(40), "rabaed-lane47")],
        stacks: [stack(7, "D:/uat/RP-1190-x"), { project: "rabaed", folders: ["G:/rabaed"] }, stack(47, "G:/elsewhere"), stack(48, "G:/rabaed/.claude/worktrees/rp-1200")],
      });
      expect(lines).toEqual(["The current branch main-4-work has no merged PR, so lane:done removes nothing here. No merged PR (of the last 200) still has a worktree or stack in this clone."]);
    });

    it("reads the lane stacks from Docker's containers and volumes, each with its containers' folders", () => {
      const containers = [db(), db({ name: "rabaed-lane41-api-1" }), db({ name: "rabaed-db-1", project: "rabaed", workingDir: "G:/rabaed" }), db({ name: "x", project: "rabaed-lane32", workingDir: "" })];
      expect(laneStacks(containers, [{ project: "rabaed-lane41" }, { project: "rabaed-lane44" }, { project: "other" }])).toEqual([
        { project: "rabaed-lane41", folders: ["G:/rabaed/.claude/worktrees/rp-1170"] },
        { project: "rabaed-lane32", folders: [] },
        { project: "rabaed-lane44", folders: [] },
      ]);
    });

    it("says the stacks were not checked when Docker did not answer", () => {
      expect(mergedLeftovers({ ...base, worktrees: [], stacks: undefined }).at(-1)).toBe("Docker did not answer, so the lane stacks were not checked; `pnpm lanes:prune --stale` lists them.");
    });
  });

  it("lists each merged PR that still has a worktree here, oldest first, each with its command, and the lane stack its .env names", () => {
    const lines = mergedLeftovers({
      ...base,
      worktrees: [
        wt("G:/rabaed", "main"),
        wt("G:/rabaed/.claude/worktrees/main-4", "main-4-work"),
        wt("G:/rabaed/.claude/worktrees/rp-1190 a", "RP-1190-x", "e".repeat(40), "rabaed-lane41"),
        wt("D:/review/rp-1190", undefined, "a".repeat(40)),
        wt("G:/rabaed/.claude/worktrees/rp-1188", "RP-1188-y"),
        wt("G:/rabaed/.claude/worktrees/rp-1200", "RP-1200-open"),
      ],
    });
    expect(lines).toEqual([
      "The current branch main-4-work has no merged PR, so lane:done removes nothing here. Merged PRs (of the last 200) that still have a worktree or stack in this clone:",
      '  PR #588 (RP-1188-y): "G:/rabaed/.claude/worktrees/rp-1188": pnpm lane:done 588',
      '  PR #590 (RP-1190-x): "G:/rabaed/.claude/worktrees/rp-1190 a" with stack rabaed-lane41, "D:/review/rp-1190": pnpm lane:done 590',
      "Run each from this worktree; it lists what it would remove and asks first. Nothing was removed.",
    ]);
  });

  it("names lane 7's PR as never lane:done's (rule 1)", () => {
    const lines = mergedLeftovers({ ...base, worktrees: [wt("D:/uat", "RP-1185-z", "c".repeat(40), "rabaed-lane7")] });
    expect(lines[1]).toMatch(/^ {2}PR #585 \(RP-1185-z\): "D:\/uat" with stack rabaed-lane7: not lane:done's: lane 7 holds Main 7's UAT harness data/);
    expect(lines[1]).not.toContain("pnpm lane:done");
  });

  it("says so when no merged PR has anything left here, on a detached HEAD too", () => {
    expect(mergedLeftovers({ ...base, currentBranch: undefined, worktrees: [wt("G:/rabaed/.claude/worktrees/main-4", undefined)] })).toEqual([
      "The current worktree is on a detached HEAD with no merged PR, so lane:done removes nothing here. No merged PR (of the last 200) still has a worktree or stack in this clone.",
    ]);
  });
});

describe("claimIdsFor (RP-1198:the RELEASE of a branch with no key names its claims)", () => {
  const claim = (id: number, text: string, releasedBy?: number) => ({ id, text, releasedBy });
  it("finds the open claims that name the PR or its branch", () => {
    const claims = [
      claim(14300, "CLAIM scripts/a.ts — Main 4, lane-4a, PR #580"),
      claim(14301, "CLAIM scripts/b.ts — Main 4, lane-4a, branch claude/x"),
      claim(14302, "CLAIM scripts/c.ts — Main 4, PR #5801"),
      claim(14303, "CLAIM scripts/d.ts — Main 4, PR #580", 14310),
      claim(14304, "CLAIM scripts/e.ts — Main 4, branch claude/xy"),
    ];
    expect(claimIdsFor(claims, { number: 580, headRefName: "claude/x" })).toEqual([14300, 14301]);
  });
});

describe("review fixes (RP-1170 /code-review)", () => {
  it("keeps a subagent worktree with no change of its own and no lock: its subagent may be starting (rule 2)", () => {
    const starting = agentWt("e", { ownChanges: 0, locked: undefined, filesNotInMain: [] });
    const decision = decideLaneDone(input({ candidates: [laneWt(), starting], force: true }));
    expect(reasons(decision)).toEqual(["G:/rabaed/.claude/worktrees/agent-e (RP-11e-part): no change of its own yet and no lock to show its subagent has stopped"]);
    // With the app's lock naming a session that has stopped, an empty one goes.
    expect(decideLaneDone(input({ candidates: [laneWt(), { ...starting, locked: "claude agent agent-e (pid 1)" }] })).remove).toHaveLength(2);
  });

  it("keeps the stack while a kept worktree's folder holds a container of it, though its .env no longer has the lane (rule 2)", () => {
    const held = laneWt({ project: undefined, held: "a running Claude session works in it" });
    const decision = decideLaneDone(input({ lane: 41, candidates: [held] }));
    expect(decision.stack?.action).toBe("keep");
    expect(decision.stack?.why).toEqual(["rabaed-lane41-db-1 comes from G:/rabaed/.claude/worktrees/rp-1170, which stays"]);
  });
});

describe("only the app's worktrees are removed (Main 6's review of #583)", () => {
  it("keeps a worktree on the PR's branch outside .claude/worktrees, even with --force, and lists it", () => {
    const outside = laneWt({ path: "D:/review/rp-1170", appWorktree: false });
    const decision = decideLaneDone(input({ candidates: [outside], force: true }));
    expect(decision.remove).toEqual([]);
    expect(reasons(decision)).toEqual(['D:/review/rp-1170 (RP-1170-lane-done): not under .claude/worktrees: remove it by hand with `pnpm worktree:remove "D:/review/rp-1170"`']);
    expect(decision.stack?.action).toBe("keep");
  });

  it("keeps a reviewer's detached checkout at the PR's head outside .claude/worktrees", () => {
    const detached = laneWt({ path: "D:/review/head", branch: undefined, appWorktree: false });
    expect(reasons(decideLaneDone(input({ candidates: [detached], force: true })))[0]).toMatch(/^D:\/review\/head \(detached HEAD\): not under \.claude\/worktrees/);
  });

  it("names the main checkout as such, not as outside the folder", () => {
    expect(reasons(decideLaneDone(input({ candidates: [laneWt({ path: "G:/rabaed", isMain: true, appWorktree: false })], force: true })))).toEqual(["G:/rabaed (RP-1170-lane-done): the main checkout"]);
  });

  it("refuses the whole run for the harness's worktree, even outside .claude/worktrees", () => {
    expect(decideLaneDone(input({ candidates: [laneWt({ path: "D:/uat", project: "rabaed-lane7", appWorktree: false })], force: true })).refusal).toMatch(/lane 7 holds Main 7's UAT harness data/);
  });
});
