import type { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BASELINE_BOT_EMAIL, BASELINE_FOLDER, isBaselineBotCommit, keepsLabel, dropLabelOnPush, onlyCleanCommitsSince, realGit, type ReviewedGit } from "./reviewed-label.ts";

const human = { author: "dev@example.com", committer: "dev@example.com" };
const bot = { author: BASELINE_BOT_EMAIL, committer: BASELINE_BOT_EMAIL };
const baseline = "packages/ui/test/__screenshots__/stories.test.tsx/button-primary-en-chromium-linux.png";

// A clean merge of main into the reviewed head: before = R, main commit = M, new head = N.
function git(overrides: Partial<ReviewedGit> = {}): ReviewedGit {
  return {
    parents: () => ["R", "M"],
    onMain: (commit) => commit === "M",
    tree: () => "tree1",
    mergedTree: () => "tree1",
    identity: () => human,
    changedPaths: () => ["apps/web/src/page.tsx"],
    ...overrides,
  };
}

// RP-1103: CI's "Update story screenshot baselines" commit changes no code, so it must not void a verify line.
describe("isBaselineBotCommit", () => {
  const botCommit = (overrides: Partial<ReviewedGit> = {}) => git({ parents: () => ["V"], identity: () => bot, changedPaths: () => [baseline, `${BASELINE_FOLDER}/other-ar-chromium-linux.png`], ...overrides });

  it("counts the screenshot bot's commit that changes only baseline images", () => {
    expect(isBaselineBotCommit("B", botCommit())).toBe(true);
  });

  it("refuses the bot's commit when it changes anything else beside the baselines (a mixed commit)", () => {
    expect(isBaselineBotCommit("B", botCommit({ changedPaths: () => [baseline, "scripts/verify.ts"] }))).toBe(false);
    expect(isBaselineBotCommit("B", botCommit({ changedPaths: () => [baseline, `${BASELINE_FOLDER}/notes.txt`] }))).toBe(false);
    expect(isBaselineBotCommit("B", botCommit({ changedPaths: () => ["packages/ui/test/stories.test.tsx"] }))).toBe(false);
  });

  it("refuses a commit of baselines only when a person made it, as author or as committer", () => {
    expect(isBaselineBotCommit("B", botCommit({ identity: () => human }))).toBe(false);
    expect(isBaselineBotCommit("B", botCommit({ identity: () => ({ author: BASELINE_BOT_EMAIL, committer: "dev@example.com" }) }))).toBe(false);
    expect(isBaselineBotCommit("B", botCommit({ identity: () => ({ author: "dev@example.com", committer: BASELINE_BOT_EMAIL }) }))).toBe(false);
  });

  it("refuses a bot commit that changes nothing, a merge, and a commit git cannot read", () => {
    expect(isBaselineBotCommit("B", botCommit({ changedPaths: () => [] }))).toBe(false);
    expect(isBaselineBotCommit("B", botCommit({ parents: () => ["V", "M"] }))).toBe(false);
    const broken = botCommit({
      changedPaths: () => {
        throw new Error("bad object");
      },
    });
    expect(isBaselineBotCommit("B", broken)).toBe(false);
  });

  // The rule names what .github/workflows/update-screenshots.yml commits, so the two cannot drift apart.
  it("matches the folder and the committer the update-screenshots workflow uses", () => {
    const workflow = readFileSync(join(dirname(import.meta.filename), "..", ".github", "workflows", "update-screenshots.yml"), "utf8");
    expect((parse(workflow) as { env: Record<string, string> }).env.SCREENSHOTS).toBe(BASELINE_FOLDER);
    expect(workflow).toContain(`git config user.email "${BASELINE_BOT_EMAIL}"`);
  });
});

describe("keepsLabel", () => {
  it("keeps the label for a clean merge of main into the reviewed head", () => {
    expect(keepsLabel("R", "N", git())).toBe(true);
  });

  it("drops it for an ordinary commit (one parent)", () => {
    expect(keepsLabel("R", "N", git({ parents: () => ["R"] }))).toBe(false);
  });

  it("drops it when the first parent is not the reviewed head (a rebase, a force push)", () => {
    expect(keepsLabel("R", "N", git({ parents: () => ["other", "M"] }))).toBe(false);
  });

  it("drops it when the merged commit is not on main (another feature branch)", () => {
    expect(keepsLabel("R", "N", git({ onMain: () => false }))).toBe(false);
  });

  it("drops it when the merge has its own changes (a conflict resolution or an edit)", () => {
    expect(keepsLabel("R", "N", git({ tree: () => "tree-with-edits" }))).toBe(false);
  });

  it("drops it when main cannot be merged cleanly into the reviewed head", () => {
    expect(keepsLabel("R", "N", git({ mergedTree: () => undefined }))).toBe(false);
  });

  it("drops it for an octopus merge", () => {
    expect(keepsLabel("R", "N", git({ parents: () => ["R", "M", "M2"] }))).toBe(false);
  });

  it("drops it when git cannot answer (the old head is gone)", () => {
    expect(
      keepsLabel(
        "R",
        "N",
        git({
          parents: () => {
            throw new Error("bad object");
          },
        }),
      ),
    ).toBe(false);
  });
});

// RP-1017: `pnpm queue` takes a verify run on an older head when only clean merges of main followed it.
describe("onlyCleanCommitsSince", () => {
  // V (verified) <- N1 (merges main M1) <- N2 (merges main M2); E is an ordinary commit on top of N1.
  const graph: Record<string, string[]> = { N2: ["N1", "M2"], N1: ["V", "M1"], E: ["N1"], V: ["P"] };
  const chain = (overrides: Partial<ReviewedGit> = {}) => git({ parents: (commit) => graph[commit] ?? [], onMain: (commit) => commit.startsWith("M"), ...overrides });

  it("accepts the verified commit itself", () => {
    expect(onlyCleanCommitsSince("V", "V", chain())).toBe(true);
  });

  it("accepts a head reached from it by clean merges of main only, each one as keepsLabel decides", () => {
    expect(onlyCleanCommitsSince("V", "N1", chain())).toBe(true);
    expect(onlyCleanCommitsSince("V", "N2", chain())).toBe(true);
  });

  it("accepts an abbreviated verified sha (pnpm verify prints git's short form)", () => {
    expect(onlyCleanCommitsSince("abc1234", "abc1234def5678", chain())).toBe(true);
  });

  it("refuses when any later commit is not a clean merge of main", () => {
    expect(onlyCleanCommitsSince("V", "E", chain())).toBe(false);
    expect(onlyCleanCommitsSince("V", "N2", chain({ tree: (commit) => (commit === "N1" ? "edited" : "tree1") }))).toBe(false);
    expect(onlyCleanCommitsSince("V", "N2", chain({ onMain: (commit) => commit === "M2" }))).toBe(false);
  });

  it("refuses a commit the head does not descend from, and a newer head than the one verified", () => {
    expect(onlyCleanCommitsSince("X", "N2", chain())).toBe(false);
    // M1 is an ancestor too, but on main's side: a run there never saw the branch's own commits.
    expect(onlyCleanCommitsSince("M1", "N2", chain())).toBe(false);
    expect(onlyCleanCommitsSince("N2", "V", chain())).toBe(false);
  });

  // RP-1103: V <- B (bot baselines) <- N3 (merges main M3); V <- H (a person's baselines).
  const withBot: Record<string, string[]> = { ...graph, B: ["V"], N3: ["B", "M3"], H: ["V"], B2: ["E"] };
  const botChain = (overrides: Partial<ReviewedGit> = {}) =>
    chain({ parents: (commit) => withBot[commit] ?? [], identity: (commit) => (commit.startsWith("B") ? bot : human), changedPaths: (commit) => (commit === "H" || commit.startsWith("B") ? [baseline] : ["apps/web/src/page.tsx"]), ...overrides });

  it("steps over the screenshot bot's baseline-only commit, alone or followed by a clean merge of main", () => {
    expect(onlyCleanCommitsSince("V", "B", botChain())).toBe(true);
    expect(onlyCleanCommitsSince("V", "N3", botChain())).toBe(true);
  });

  it("refuses a baseline commit a person made, a mixed bot commit, and a bot commit on top of an ordinary one", () => {
    expect(onlyCleanCommitsSince("V", "H", botChain())).toBe(false);
    expect(onlyCleanCommitsSince("V", "N3", botChain({ changedPaths: () => [baseline, "scripts/verify.ts"] }))).toBe(false);
    expect(onlyCleanCommitsSince("V", "B2", botChain())).toBe(false);
  });

  it("refuses when git cannot answer", () => {
    const broken = chain({
      parents: () => {
        throw new Error("bad object");
      },
    });
    expect(onlyCleanCommitsSince("V", "N1", broken)).toBe(false);
  });
});

describe("dropLabelOnPush", () => {
  function recorder() {
    const removed: number[] = [];
    return { removed, github: { removeLabel: async (pr: number) => void removed.push(pr) } };
  }

  it("removes the label on a new push", async () => {
    const { removed, github } = recorder();
    const text = await dropLabelOnPush({ pr: 7, action: "synchronize", labels: ["reviewed", "x"], before: "R", after: "N" }, git({ parents: () => ["R"] }), github);
    expect(removed).toEqual([7]);
    expect(text).toContain("removed");
    // CI's reviewed-add adds it back; a hand label does not count (RP-1167).
    expect(text).toContain("review-post.ts");
    expect(text).not.toContain("--add-label reviewed");
  });

  it("keeps the label when the push only merged main in", async () => {
    const { removed, github } = recorder();
    const text = await dropLabelOnPush({ pr: 7, action: "synchronize", labels: ["reviewed"], before: "R", after: "N" }, git(), github);
    expect(removed).toEqual([]);
    expect(text).toContain("stays");
  });

  // RP-1121: once the bot's push starts workflows, this run sees its baseline commit; the review still holds.
  // R (reviewed) <- B (bot baselines) <- N (merges main M); R <- H (a person's baselines); R <- X <- B2 (bot on an ordinary commit).
  const pushes: Record<string, string[]> = { B: ["R"], N: ["B", "M"], H: ["R"], X: ["R"], B2: ["X"] };
  const pushGit = (overrides: Partial<ReviewedGit> = {}) =>
    git({
      parents: (commit) => pushes[commit] ?? [],
      identity: (commit) => (commit.startsWith("B") ? bot : human),
      changedPaths: (commit) => (commit === "H" || commit.startsWith("B") ? [baseline] : ["apps/web/src/page.tsx"]),
      ...overrides,
    });

  it("keeps the label when a bot pushed only the screenshot bot's baseline commit on the reviewed head", async () => {
    const { removed, github } = recorder();
    const text = await dropLabelOnPush({ pr: 7, action: "synchronize", labels: ["reviewed"], before: "R", after: "B", pushedByBot: true }, pushGit(), github);
    expect(removed).toEqual([]);
    expect(text).toContain("baseline commit");
    expect(text).toContain("stays");
  });

  it("removes the label when a person pushed a commit that only claims the bot's email", async () => {
    for (const pushedByBot of [false, undefined]) {
      const { removed, github } = recorder();
      await dropLabelOnPush({ pr: 7, action: "synchronize", labels: ["reviewed"], before: "R", after: "B", pushedByBot }, pushGit(), github);
      expect(removed).toEqual([7]);
    }
  });

  it("removes the label when the baselines came from a person, the bot's commit also changes code, it sits on a new commit, or the push holds more than it", async () => {
    const cases: [string, Partial<ReviewedGit>][] = [
      ["H", {}],
      ["B", { changedPaths: () => [baseline, "scripts/verify.ts"] }],
      ["B2", {}],
      ["N", {}],
    ];
    for (const [after, overrides] of cases) {
      const { removed, github } = recorder();
      await dropLabelOnPush({ pr: 7, action: "synchronize", labels: ["reviewed"], before: "R", after, pushedByBot: true }, pushGit(overrides), github);
      expect(removed).toEqual([7]);
    }
  });

  it("removes the label when git cannot read the bot's push", async () => {
    const { removed, github } = recorder();
    const broken = pushGit({
      parents: () => {
        throw new Error("bad object");
      },
    });
    await dropLabelOnPush({ pr: 7, action: "synchronize", labels: ["reviewed"], before: "R", after: "B", pushedByBot: true }, broken, github);
    expect(removed).toEqual([7]);
  });

  it("does nothing when the PR has no label", async () => {
    const { removed, github } = recorder();
    await dropLabelOnPush({ pr: 7, action: "synchronize", labels: ["other"], before: "R", after: "N" }, git({ parents: () => ["R"] }), github);
    expect(removed).toEqual([]);
  });

  it("does nothing when a PR opens without the label: the run only gives the head one for pnpm queue (RP-604)", async () => {
    const { removed, github } = recorder();
    const text = await dropLabelOnPush({ pr: 7, action: "opened", labels: [] }, git(), github);
    expect(removed).toEqual([]);
    expect(text).toContain("nothing to remove");
  });

  it("removes a label already there when a PR opens or reopens, even if git would keep it on a push (RP-604)", async () => {
    for (const action of ["opened", "reopened"]) {
      const { removed, github } = recorder();
      const text = await dropLabelOnPush({ pr: 7, action, labels: ["reviewed"], before: "R", after: "N" }, git(), github);
      expect(removed).toEqual([7]);
      expect(text).toContain(`the ${action} PR's head needs a /code-review`);
    }
  });
});

// The workflow file: every head of a same-repo PR must get a run, or `pnpm queue` waits for one forever (RP-604).
describe("reviewed-label.yml", () => {
  const source = readFileSync(join(dirname(import.meta.filename), "..", ".github", "workflows", "reviewed-label.yml"), "utf8");
  const wf = parse(source) as { on: Record<string, { types?: string[] }>; jobs: Record<string, { steps: { run?: string }[] }> };

  it("runs when a PR opens, reopens or gets a push, and on nothing else", () => {
    // RP-1148 part A moves it to pull_request_target (GitHub runs main's copy, so a PR can't keep a stale label) in two
    // steps: both triggers while main's copy listens only to pull_request, then pull_request_target alone.
    const events = Object.keys(wf.on).sort();
    expect([["pull_request"], ["pull_request_target"], ["pull_request", "pull_request_target"]]).toContainEqual(events);
    for (const event of events) expect(wf.on[event], event).toEqual({ types: ["opened", "reopened", "synchronize"] });
  });

  it("fetches the old head only when the event has one", () => {
    const fetch = Object.values(wf.jobs)[0]?.steps.find((s) => s.run?.includes("github.event.before"));
    expect(fetch?.run).toMatch(/if \[ -n "\$\{\{ github\.event\.before \}\}" \]/);
  });
});

describe("realGit", () => {
  function recorded(answer: (args: string[]) => { status: number | null; stdout?: string }) {
    const calls: string[][] = [];
    const spawn = ((_command: string, args: string[]) => {
      calls.push(args);
      return answer(args);
    }) as unknown as typeof spawnSync;
    return { calls, git: realGit("/work", spawn) };
  }

  it("reads parents, the tree, and ancestry on origin/main", () => {
    const { calls, git: real } = recorded((args) => (args[0] === "merge-base" ? { status: 1 } : { status: 0, stdout: args[0] === "rev-list" ? "N R M\n" : "treeid\n" }));
    expect(real.parents("N")).toEqual(["R", "M"]);
    expect(real.tree("N")).toBe("treeid");
    expect(real.onMain("M")).toBe(false);
    expect(calls).toEqual([["rev-list", "--parents", "-n", "1", "N"], ["rev-parse", "N^{tree}"], ["merge-base", "--is-ancestor", "M", "origin/main"]]);
  });

  it("reads a commit's author and committer emails, and both sides of every path it changes", () => {
    const { calls, git: real } = recorded((args) => ({ status: 0, stdout: args[0] === "log" ? "bot@x\ncommitter@x\n" : `${baseline}\nold/name.ts\n` }));
    expect(real.identity("B")).toEqual({ author: "bot@x", committer: "committer@x" });
    expect(real.changedPaths("B")).toEqual([baseline, "old/name.ts"]);
    expect(calls).toEqual([
      ["log", "-1", "--format=%ae%n%ce", "B"],
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", "B"],
    ]);
  });

  it("returns the merged tree for a clean merge-tree and undefined for a conflict", () => {
    expect(recorded(() => ({ status: 0, stdout: "treeoid\n" })).git.mergedTree("R", "M")).toBe("treeoid");
    expect(recorded(() => ({ status: 1, stdout: "treeoid\nCONFLICT" })).git.mergedTree("R", "M")).toBeUndefined();
  });
});
