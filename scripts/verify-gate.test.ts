import { describe, expect, it } from "vitest";
import type { CiRun } from "./ci-green.ts";
import { BASELINE_BOT_EMAIL, type ReviewedGit } from "./reviewed-label.ts";
import { needsVerify, requireVerified, stampLine, verifiedCommits, verifyGate, type GateSeam } from "./verify-gate.ts";
import { finalLine } from "./verify-steps.ts";

const steps = ["lint", "typecheck", "test:unit"];
const line = (sha: string) => finalLine({ sha, dirty: false, steps });

// No merges unless a test gives a graph.
const noMerges: ReviewedGit = {
  parents: () => [],
  onMain: () => false,
  tree: () => "tree1",
  mergedTree: () => "tree1",
  identity: () => ({ author: "dev@example.com", committer: "dev@example.com" }),
  changedPaths: () => ["apps/web/src/page.tsx"],
};

describe("stampLine", () => {
  it("ends the line with a stamp that depends on every character before it", () => {
    const stamped = stampLine("pnpm verify passed on abc1234: lint.");
    expect(stamped).toMatch(/^pnpm verify passed on abc1234: lint\. Stamp [0-9a-f]{16}\.$/);
    expect(stampLine("pnpm verify passed on abc1235: lint.")).not.toBe(stamped.replace("abc1234", "abc1235"));
  });
});

describe("verifiedCommits", () => {
  it("reads back the commit of a full clean run, as pnpm verify prints it", () => {
    expect(verifiedCommits(line("abc1234"))).toEqual(["abc1234"]);
  });

  it("does not count a dirty run, an unknown commit or a run resumed with --from (RP-1019)", () => {
    expect(verifiedCommits(finalLine({ sha: "abc1234", dirty: true, steps }))).toEqual([]);
    expect(verifiedCommits(finalLine({ sha: "", dirty: false, steps }))).toEqual([]);
    expect(verifiedCommits(finalLine({ sha: "abc1234", dirty: false, steps: ["test:seam2"], from: { step: "test:seam2", notRun: ["lint", "test:seam1"] } }))).toEqual([]);
  });

  it("does not count a line without a stamp: written by hand, or by pnpm verify before RP-1094", () => {
    expect(verifiedCommits("pnpm verify passed on abc1234: lint, typecheck, test:unit.")).toEqual([]);
  });

  it("does not count a stamped line edited afterwards: another sha, or a note added to the steps (PR #466)", () => {
    expect(verifiedCommits(line("abc1234").replace("abc1234", "def5678"))).toEqual([]);
    expect(verifiedCommits(line("abc1234").replace("test:unit.", "test:unit (re-ran 6 timed-out files)."))).toEqual([]);
  });

  it("reads every stamped line in a body, inside code spans or blocks too", () => {
    expect(verifiedCommits(`## Verify\n\n\`${line("5356b95")}\`\n\n\`\`\`\n${line("abc1234")}\n\`\`\`\n`)).toEqual(["5356b95", "abc1234"]);
  });

  it("reads a stamped line followed by markdown: bold, a table cell, a closing parenthesis", () => {
    expect(verifiedCommits(`**${line("abc1234")}**`)).toEqual(["abc1234"]);
    expect(verifiedCommits(`| verify | ${line("abc1234")}|`)).toEqual(["abc1234"]);
    expect(verifiedCommits(`(${line("abc1234")})`)).toEqual(["abc1234"]);
  });

  it("does not count a stamp moved from one line onto another", () => {
    const stamp = / Stamp [0-9a-f]{16}\.$/.exec(line("abc1234"))?.[0] ?? "";
    expect(verifiedCommits(`pnpm verify passed on abc1234: lint.${stamp}`)).toEqual([]);
  });

  it("does not count a sha shorter than git's short form", () => {
    expect(verifiedCommits(stampLine("pnpm verify passed on abc123: lint."))).toEqual([]);
  });
});

describe("verifyGate", () => {
  it("passes when a stamped line names the head", () => {
    expect(verifyGate(`Closes RP-1\n\n${line("abc1234")}`, "abc1234ffff", noMerges)).toEqual({ ok: true, commit: "abc1234" });
  });

  it("fails with no line at all, naming the head", () => {
    const gate = verifyGate("## Summary", "abc1234", noMerges);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("its body has no `pnpm verify passed on <sha>:` line, so nothing shows `pnpm verify` passed on its head abc1234");
  });

  it("fails on a line without a valid stamp, saying it does not count", () => {
    const gate = verifyGate("pnpm verify passed on abc1234: lint.", "abc1234", noMerges);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("no valid stamp");
  });

  it("fails on a stamped line for another commit, naming both", () => {
    const gate = verifyGate(line("5356b95"), "abc1234", noMerges);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toContain("5356b95");
      expect(gate.reason).toContain("abc1234");
    }
  });

  it("passes when only clean merges of main follow the verified commit (RP-1017)", () => {
    const graph: Record<string, string[]> = { abc1234: ["n1", "m2"], n1: ["beef999", "m1"] };
    const git: ReviewedGit = { ...noMerges, parents: (commit) => graph[commit] ?? [], onMain: (commit) => commit.startsWith("m") };
    expect(verifyGate(line("beef999"), "abc1234", git)).toEqual({ ok: true, commit: "beef999" });
  });

  it("fails when a commit after the verified one is not a clean merge of main", () => {
    const graph: Record<string, string[]> = { abc1234: ["n1", "m2"], n1: ["beef999"] };
    const git: ReviewedGit = { ...noMerges, parents: (commit) => graph[commit] ?? [], onMain: (commit) => commit.startsWith("m") };
    expect(verifyGate(line("beef999"), "abc1234", git).ok).toBe(false);
  });

  // RP-1103: the screenshot bot's baseline-only commit (#458, #459, #476) no longer voids the line.
  it("passes when the screenshot bot's baseline-only commit follows the verified one, and fails when a person made it", () => {
    const graph: Record<string, string[]> = { abc1234: ["b1", "m2"], b1: ["beef999"] };
    const baselines = (author: string): ReviewedGit => ({
      ...noMerges,
      parents: (commit) => graph[commit] ?? [],
      onMain: (commit) => commit.startsWith("m"),
      identity: (commit) => (commit === "b1" ? { author, committer: author } : { author: "dev@example.com", committer: "dev@example.com" }),
      changedPaths: (commit) => (commit === "b1" ? ["packages/ui/test/__screenshots__/stories.test.tsx/button-en-chromium-linux.png"] : []),
    });
    expect(verifyGate(line("beef999"), "abc1234", baselines(BASELINE_BOT_EMAIL))).toEqual({ ok: true, commit: "beef999" });
    expect(verifyGate(line("beef999"), "abc1234", baselines("dev@example.com")).ok).toBe(false);
  });
});

describe("needsVerify", () => {
  it("skips only a PR with the docs-only label that changes only docs", () => {
    expect(needsVerify(["docs-only"], ["docs/a.md", "README.md"])).toBe(false);
    expect(needsVerify(["docs-only", "reviewed"], ["docs/a.md"])).toBe(false);
    expect(needsVerify(["docs-only"], ["docs/a.md", "scripts/x.ts"])).toBe(true);
    expect(needsVerify(["reviewed"], ["docs/a.md"])).toBe(true);
  });
});

describe("requireVerified", () => {
  function fakeGate(overrides: Partial<GateSeam> = {}) {
    const fetched: number[] = [];
    const seam: GateSeam = {
      ...noMerges,
      pull: async () => ({ body: line("abc1234"), headSha: "abc1234", labels: ["reviewed"] }),
      fetchPull: (pr) => {
        fetched.push(pr);
      },
      changedFiles: () => ["scripts/x.ts"],
      packageJsonVersions: () => ({ before: undefined, after: undefined }),
      requiredChecks: async () => ["lint", "unit", "verify-gate"],
      ciRuns: async () => [],
      ...overrides,
    };
    return { seam, fetched };
  }
  const prEvent = { kind: "pull_request" as const, pr: 7, headSha: "abc1234", sameRepo: true, draft: false };

  describe("CI green on the head (RP-1190)", () => {
    const HEAD = "d".repeat(40);
    const event = { ...prEvent, headSha: HEAD };
    const ciRun = (status: string, conclusion: string | null): CiRun => ({
      id: 77,
      headSha: HEAD,
      event: "pull_request",
      path: ".github/workflows/ci.yml",
      status,
      conclusion,
      repo: "Rabaed/rabaedV2.0",
      headRepo: "Rabaed/rabaedV2.0",
      pulls: [{ number: 7, baseRef: "main" }],
      jobs: ["lint", "unit"].map((name) => ({ name, status, conclusion })),
    });
    const noLine = { pull: async () => ({ body: "", headSha: HEAD, labels: ["reviewed"] }) };

    it("passes with no verify line when CI passed on the head", async () => {
      const { seam } = fakeGate({ ...noLine, ciRuns: async () => [ciRun("completed", "success")] });
      const result = await requireVerified(event, seam);
      expect(result).toEqual({ ok: true, summary: `PR #7: CI passed on its head ${HEAD} (run 77), and it changes none of CI's own files: passes.` });
    });

    it("needs the stamped line when the PR edits ci.yml, however green CI is", async () => {
      const { seam } = fakeGate({ ...noLine, changedFiles: () => [".github/workflows/ci.yml", "scripts/x.ts"], ciRuns: async () => [ciRun("completed", "success")] });
      const result = await requireVerified(event, seam);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain("CI's own files (.github/workflows/ci.yml)");
      expect(result.summary).toContain("pnpm verify --pr 7");
    });

    it("fails while CI runs, saying how many jobs are left", async () => {
      const { seam } = fakeGate({ ...noLine, ciRuns: async () => [ciRun("in_progress", null)] });
      const result = await requireVerified(event, seam);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain(`CI still running on ${HEAD}: 2 jobs left (lint, unit)`);
    });

    it("fails on an API error, naming it", async () => {
      const { seam } = fakeGate({
        ...noLine,
        requiredChecks: async () => {
          throw new Error("GitHub GET rules/branches/main answered 403");
        },
      });
      const result = await requireVerified(event, seam);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain("403");
    });

    it("reads a changed package.json at the merge base and the head", async () => {
      const asked: string[] = [];
      const { seam } = fakeGate({
        ...noLine,
        changedFiles: () => ["package.json"],
        packageJsonVersions: (head, file) => (asked.push(`${head} ${file}`), { before: '{"scripts":{"test:unit":"vitest"}}', after: '{"scripts":{"test:unit":"true"}}' }),
        ciRuns: async () => [ciRun("completed", "success")],
      });
      const result = await requireVerified(event, seam);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain("CI's own files (package.json)");
      expect(asked).toEqual([`${HEAD} package.json`]);
    });

    it("in the merge queue, reads CI on the PR's pinned head", async () => {
      const heads: string[] = [];
      const { seam } = fakeGate({ ...noLine, ciRuns: async (head) => (heads.push(head), [ciRun("completed", "success")]) });
      const result = await requireVerified({ kind: "merge_group", headRef: "refs/heads/gh-readonly-queue/main/pr-7-0123abc" }, seam);
      expect(result.ok).toBe(true);
      expect(heads).toEqual([HEAD]);
    });
  });

  it("passes a PR whose body has a stamped line for the event's head", async () => {
    const { seam, fetched } = fakeGate();
    const result = await requireVerified(prEvent, seam);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("abc1234");
    expect(fetched).toEqual([7]);
  });

  it("checks the event's head on a PR, not a newer one the API already shows", async () => {
    const { seam } = fakeGate({ pull: async () => ({ body: line("abc1234"), headSha: "fff9999", labels: ["reviewed"] }) });
    expect((await requireVerified(prEvent, seam)).ok).toBe(true);
  });

  it("fails a PR without a valid line, saying how to fix it", async () => {
    const { seam } = fakeGate({ pull: async () => ({ body: "pnpm verify passed on abc1234: lint (re-ran 6 timed-out files).", headSha: "abc1234", labels: ["reviewed"] }) });
    const result = await requireVerified(prEvent, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("PR #7");
    expect(result.summary).toContain("gh pr edit 7 --body-file");
  });

  it("passes a draft with a note, as reviewed-required does (RP-1018)", async () => {
    const { seam, fetched } = fakeGate({ pull: async () => ({ body: "", headSha: "abc1234", labels: [] }) });
    const result = await requireVerified({ ...prEvent, draft: true }, seam);
    expect(result).toEqual({ ok: true, summary: "PR #7 is a draft: checked when marked ready." });
    expect(fetched).toEqual([]);
  });

  it("passes a docs-only PR that changes only docs without a line", async () => {
    const { seam } = fakeGate({ pull: async () => ({ body: "", headSha: "abc1234", labels: ["docs-only"] }), changedFiles: () => ["docs/a.md"] });
    const result = await requireVerified(prEvent, seam);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("only docs");
  });

  it("in the merge queue, takes the PR from the queue ref and checks the PR's own head", async () => {
    const { seam, fetched } = fakeGate({ pull: async () => ({ body: line("beef999"), headSha: "beef999", labels: ["reviewed"] }) });
    const result = await requireVerified({ kind: "merge_group", headRef: "refs/heads/gh-readonly-queue/main/pr-12-0123abc" }, seam);
    expect(result.ok).toBe(true);
    expect(fetched).toEqual([12]);
  });

  it("fails a merge queue ref that names no PR", async () => {
    const { seam } = fakeGate();
    expect((await requireVerified({ kind: "merge_group", headRef: "refs/heads/main" }, seam)).ok).toBe(false);
  });

  it("fails, naming why, when git cannot list the changed files", async () => {
    const { seam } = fakeGate({
      changedFiles: () => {
        throw new Error("bad object abc1234");
      },
    });
    const result = await requireVerified(prEvent, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("bad object abc1234");
  });
});
