import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CiRun } from "./ci-green.ts";
import { queuePr, queuePrWhenChecksPass, realSeam, waitForMerge, type PullStatus, type QueueSeam } from "./queue-pr.ts";
import { BASELINE_BOT_EMAIL } from "./reviewed-label.ts";
import { stampLine } from "./verify-gate.ts";

// A fake seam for a clean branch; each test overrides what it breaks.
function fakeSeam(overrides: Partial<QueueSeam> = {}) {
  const enqueued: [string, string][] = [];
  const seam: QueueSeam = {
    fetchMain: () => true,
    fetchPull: () => "abc1234",
    head: () => "abc1234",
    branch: () => "feature",
    isAncestor: () => false,
    pullRequest: () => ({ id: "PR_node", headRefOid: "abc1234", headRefName: "feature" }),
    mergeTree: () => ({ status: 0, output: "treeoid\n", stderr: "" }),
    changedFiles: () => ["apps/api/src/a.ts"],
    packageJsonVersions: () => ({ before: undefined, after: undefined }),
    check: () => ({ status: 0, output: "ok\n" }),
    labels: () => ["reviewed"],
    // Verified at whatever head the test gives the PR, unless a test says otherwise (RP-1017).
    body: (pr) => `## Summary\n\n${stampLine(`pnpm verify passed on ${seam.pullRequest(pr).headRefOid}: lint, typecheck, unit.`)}\n`,
    parents: () => [],
    onMain: () => false,
    tree: () => "tree1",
    mergedTree: () => "tree1",
    identity: () => ({ author: "dev@example.com", committer: "dev@example.com" }),
    changedPaths: () => ["apps/api/src/a.ts"],
    labelWorkflowOnMain: () => true,
    labelRuns: () => [{ status: "completed", conclusion: "success" }],
    status: () => ({ state: "OPEN", isInMergeQueue: true }),
    removalReason: () => undefined,
    requiredChecks: () => [],
    ciRuns: () => [],
    checkRuns: () => [],
    commitStatuses: () => [],
    mergeChecks: () => ({ ok: true, skipped: [] }),
    enqueue: (id, head) => {
      enqueued.push([id, head]);
      return { position: 3, state: "QUEUED" };
    },
    ...overrides,
  };
  return { seam, enqueued };
}

describe("queuePr: main's newest checks on the merge (RP-1171)", () => {
  it("runs them on the merge-tree answer and the PR's head, after the merge is known clean", () => {
    const seen: [string, string][] = [];
    const { seam, enqueued } = fakeSeam({
      mergeTree: () => ({ status: 0, output: "treeoid\n", stderr: "" }),
      mergeChecks: (mergeOutput, head) => (seen.push([mergeOutput, head]), { ok: true, skipped: [] }),
    });
    expect(queuePr(511, seam).ok).toBe(true);
    expect(seen).toEqual([["treeoid\n", "abc1234"]]);
    expect(enqueued).toHaveLength(1);
  });

  it("refuses with each failing check's name and lines, queueing nothing", () => {
    const { seam, enqueued } = fakeSeam({
      mergeChecks: () => ({
        ok: false,
        failures: [
          { name: "check-hidden-asserts", lines: ["apps/api/test/a.test.ts:9: a compare by text"] },
          { name: "check:migrations", lines: ["20271101000000 is shared"] },
        ],
      }),
    });
    const result = queuePr(496, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("PR #496");
    expect(text).toContain("check-hidden-asserts");
    expect(text).toContain("apps/api/test/a.test.ts:9: a compare by text");
    expect(text).toContain("check:migrations");
    expect(text).toContain("merge main");
    expect(enqueued).toEqual([]);
  });

  it("does not run them on a merge that conflicts", () => {
    let ran = false;
    const { seam } = fakeSeam({
      mergeTree: () => ({ status: 1, output: "", stderr: "" }),
      mergeChecks: () => ((ran = true), { ok: true, skipped: [] }),
    });
    expect(queuePr(1, seam).ok).toBe(false);
    expect(ran).toBe(false);
  });

  it("refuses with a fix, not a crash, when the checkout of the merge fails", () => {
    const { seam, enqueued } = fakeSeam({
      mergeChecks: () => {
        throw new Error("git worktree add failed: Filename too long");
      },
    });
    const result = queuePr(7, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("Filename too long");
    expect(result.lines.join("\n")).toContain("core.longpaths");
    expect(enqueued).toEqual([]);
  });

  it("warns, and still queues, when a check is not on the merge", () => {
    const { seam, enqueued } = fakeSeam({ mergeChecks: () => ({ ok: true, skipped: ["check-scenario-seams"] }) });
    const result = queuePr(1, seam);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("check-scenario-seams");
    expect(enqueued).toHaveLength(1);
  });

  it("still refuses a stale or missing verify line first, with the gate's own reason", () => {
    const { seam } = fakeSeam({ body: () => "no line here" });
    const result = queuePr(521, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("pnpm verify --pr 521");
  });
});

describe("queuePr", () => {
  it("queues a clean branch pinned to HEAD and reports position and state", () => {
    const { seam, enqueued } = fakeSeam();
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(enqueued).toEqual([["PR_node", "abc1234"]]);
    expect(result.lines.join("\n")).toContain("position 3");
    expect(result.lines.join("\n")).toContain("QUEUED");
  });

  it("refuses a PR that changes root package.json among code files, naming rule 3 and the shared files", () => {
    const { seam, enqueued } = fakeSeam({ changedFiles: () => ["package.json", "scripts/x.ts", ".github/workflows/ci.yml", "apps/api/src/a.ts"] });
    const result = queuePr(163, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("rule 3");
    expect(text).toContain("package.json");
    expect(text).toContain(".github/workflows/ci.yml");
    expect(text).not.toContain("apps/api/src/a.ts");
    expect(enqueued).toEqual([]);
  });

  it("queues an own PR that touches only root shared files and docs", () => {
    const { seam, enqueued } = fakeSeam({ changedFiles: () => ["package.json", "pnpm-lock.yaml", ".github/workflows/ci.yml", "docs/tech-stack.md"] });
    expect(queuePr(163, seam).ok).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  it("does not treat a nested package.json or lockfile as a root shared file", () => {
    const { seam } = fakeSeam({ changedFiles: () => ["apps/api/package.json", "scripts/x.ts"] });
    expect(queuePr(163, seam).ok).toBe(true);
  });

  it("refuses a PR without the reviewed label, says how to get it, and does not queue", () => {
    const { seam, enqueued } = fakeSeam({ labels: () => ["other"] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("reviewed");
    // CI's reviewed-add adds the label; a hand label does not count (RP-1167).
    expect(text).toContain("node scripts/review-post.ts 149");
    expect(text).not.toContain("--add-label reviewed");
    expect(text).toContain("gh pr edit 149 --add-label docs-only");
    expect(enqueued).toEqual([]);
  });

  it("queues a PR with the reviewed label, without a no-review warning", () => {
    const { seam, enqueued } = fakeSeam({ labels: () => ["other", "reviewed"] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).not.toContain("--no-review");
    expect(enqueued).toHaveLength(1);
  });

  // RP-606: the main ruleset's reviewed-required check would fail a PR with neither label, and the
  // queue would drop it, so --no-review no longer stands in for a label: it names the docs-only one.
  it("--no-review refuses a PR without the docs-only label and says how to add it", () => {
    const { seam, enqueued } = fakeSeam({ labels: () => [], changedFiles: () => ["docs/a.md"] });
    const result = queuePr(149, seam, { noReview: true });
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("gh pr edit 149 --add-label docs-only");
    expect(text).toContain("reviewed-required");
    expect(enqueued).toEqual([]);
  });

  it("queues a docs-only PR with the docs-only label, with or without --no-review, and says no review was checked", () => {
    for (const noReview of [true, false]) {
      const { seam, enqueued } = fakeSeam({ labels: () => ["docs-only"], changedFiles: () => ["docs/a.md", "planning/parallel-sessions.md"] });
      const result = queuePr(149, seam, { noReview });
      expect(result.ok).toBe(true);
      expect(result.lines.join("\n")).toContain("docs-only");
      expect(enqueued).toHaveLength(1);
    }
  });

  it("refuses the docs-only label on a PR that changes code, naming the file", () => {
    const { seam, enqueued } = fakeSeam({ labels: () => ["docs-only"], changedFiles: () => ["docs/a.md", "scripts/x.ts"] });
    const result = queuePr(149, seam, { noReview: true });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("scripts/x.ts");
    expect(enqueued).toEqual([]);
  });

  it("refuses while the reviewed-label run for the head is still going, naming the head", () => {
    const { seam, enqueued } = fakeSeam({ labelRuns: () => [{ status: "in_progress", conclusion: "" }] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("wait for the reviewed-label run on abc1234, then run `pnpm queue 149` again");
    expect(enqueued).toEqual([]);
  });

  it("treats no run for the head yet as still going", () => {
    const { seam, enqueued } = fakeSeam({ labelRuns: () => [] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("wait for the reviewed-label run on abc1234");
    // RP-604: a PR from before opened-runs never gets one by waiting, so the fix says how to make one.
    expect(result.lines.join("\n")).toContain("merge origin/main in cleanly and push");
    expect(enqueued).toEqual([]);
  });

  it("refuses when the reviewed-label run for the head failed", () => {
    const { seam, enqueued } = fakeSeam({ labelRuns: () => [{ status: "completed", conclusion: "failure" }] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("failed");
    expect(enqueued).toEqual([]);
  });

  it("queues when the reviewed-label run for the head was skipped", () => {
    const { seam, enqueued } = fakeSeam({ labelRuns: () => [{ status: "completed", conclusion: "skipped" }] });
    expect(queuePr(149, seam).ok).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  it("skips the run check with a warning while the workflow is not on origin/main yet", () => {
    const { seam, enqueued } = fakeSeam({ labelWorkflowOnMain: () => false, labelRuns: () => [] });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("reviewed-label.yml is not on origin/main yet");
    expect(enqueued).toHaveLength(1);
  });

  it("a docs-only PR skips the reviewed-label run check (there is no review to tie to the head)", () => {
    const { seam, enqueued } = fakeSeam({ labels: () => ["docs-only"], changedFiles: () => ["docs/a.md"], labelRuns: () => [{ status: "queued", conclusion: "" }] });
    expect(queuePr(149, seam, { noReview: true }).ok).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  // RP-1017: PR #288's old head was labelled and green, but `pnpm verify` had found a visibility leak on it.
  describe("verify line (RP-1017)", () => {
    const verifiedOn = (sha: string) => () => `Closes RP-1\n\n${stampLine(`pnpm verify passed on ${sha}: lint, typecheck, unit.`)}`;
    const fix = "or run `pnpm verify` on abc1234";

    it("refuses a PR whose body has no verify line, naming the head that needs a run", () => {
      const { seam, enqueued } = fakeSeam({ body: () => "## Summary\n\nNo verify run yet." });
      const result = queuePr(149, seam);
      expect(result.ok).toBe(false);
      const text = result.lines.join("\n");
      expect(text).toContain("no `pnpm verify passed on <sha>:` line");
      expect(text).toContain(fix);
      expect(text).toContain("gh pr edit 149 --body-file");
      expect(enqueued).toEqual([]);
    });

    it("refuses a verify line that names a different head, naming both", () => {
      const { seam, enqueued } = fakeSeam({ body: verifiedOn("5356b95") });
      const result = queuePr(149, seam);
      expect(result.ok).toBe(false);
      const text = result.lines.join("\n");
      expect(text).toContain("5356b95");
      expect(text).toContain(fix);
      expect(enqueued).toEqual([]);
    });

    it("refuses a dirty verify run on the head", () => {
      const { seam, enqueued } = fakeSeam({ body: () => "pnpm verify passed on abc1234 (dirty: uncommitted changes): lint." });
      const result = queuePr(149, seam);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain(fix);
      expect(enqueued).toEqual([]);
    });

    it("refuses a sha shorter than git's short form, even when it is a prefix of the head", () => {
      const { seam } = fakeSeam({ body: () => "pnpm verify passed on abc123: lint." });
      expect(queuePr(149, seam).ok).toBe(false);
    });

    // Which lines count is scripts/verify-gate.test.ts's; here only that the queue applies the same gate (RP-1094).
    it("refuses a line without the verify gate's stamp, such as one edited by hand (PR #466)", () => {
      const { seam, enqueued } = fakeSeam({ body: () => "pnpm verify passed on abc1234: lint, typecheck, unit (re-ran 6 timed-out files)." });
      const result = queuePr(149, seam);
      expect(result.ok).toBe(false);
      const text = result.lines.join("\n");
      expect(text).toContain("no valid stamp");
      expect(text).toContain(fix);
      expect(enqueued).toEqual([]);
    });

    it("queues when the verified commit is followed only by clean merges of main", () => {
      // abc1234 merges main's m2 into n1, which merged main's m1 into the verified beef999.
      const graph: Record<string, string[]> = { abc1234: ["n1", "m2"], n1: ["beef999", "m1"] };
      const { seam, enqueued } = fakeSeam({ body: verifiedOn("beef999"), parents: (commit) => graph[commit] ?? [], onMain: (commit) => commit.startsWith("m") });
      expect(queuePr(149, seam).ok).toBe(true);
      expect(enqueued).toEqual([["PR_node", "abc1234"]]);
    });

    it("queues when the screenshot bot's baseline-only commit follows the verified one (RP-1103)", () => {
      const graph: Record<string, string[]> = { abc1234: ["beef999"] };
      const bot = { author: BASELINE_BOT_EMAIL, committer: BASELINE_BOT_EMAIL };
      const { seam, enqueued } = fakeSeam({
        body: verifiedOn("beef999"),
        parents: (commit) => graph[commit] ?? [],
        identity: () => bot,
        changedPaths: () => ["packages/ui/test/__screenshots__/stories.test.tsx/button-en-chromium-linux.png"],
      });
      expect(queuePr(149, seam).ok).toBe(true);
      expect(enqueued).toEqual([["PR_node", "abc1234"]]);
    });

    it("refuses when a commit after the verified one is not a clean merge of main", () => {
      const graph: Record<string, string[]> = { abc1234: ["n1", "m2"], n1: ["beef999"] };
      const { seam, enqueued } = fakeSeam({ body: verifiedOn("beef999"), parents: (commit) => graph[commit] ?? [], onMain: (commit) => commit.startsWith("m") });
      const result = queuePr(149, seam);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain(fix);
      expect(enqueued).toEqual([]);
    });

    it("queues when any of several verify lines names the head (a later run after fixes)", () => {
      const { seam } = fakeSeam({ body: () => `${stampLine("pnpm verify passed on 5356b95: lint.")}\n\n\`${stampLine("pnpm verify passed on abc1234: lint, typecheck.")}\`` });
      expect(queuePr(149, seam).ok).toBe(true);
    });

    it("queues a docs-only PR without a verify line, with or without the reviewed label too", () => {
      for (const labels of [["docs-only"], ["docs-only", "reviewed"]]) {
        const { seam, enqueued } = fakeSeam({ labels: () => labels, changedFiles: () => ["docs/a.md"], body: () => "" });
        expect(queuePr(149, seam, { noReview: true }).ok).toBe(true);
        expect(enqueued).toHaveLength(1);
      }
    });

    it("still needs the line on a reviewed PR that changes code, even with the docs-only label", () => {
      const { seam } = fakeSeam({ labels: () => ["docs-only", "reviewed"], changedFiles: () => ["docs/a.md", "scripts/x.ts"], body: () => "" });
      expect(queuePr(149, seam).ok).toBe(false);
    });

    it("--wait refuses before waiting when the verify line is missing", async () => {
      const { seam, enqueued } = fakeSeam({ body: () => "" });
      const result = await queuePrWhenChecksPass(149, seam, { sleep: async () => {} });
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain(fix);
      expect(enqueued).toEqual([]);
    });
  });

  // RP-1190: CI green on the exact head counts as the verify; the rule is scripts/ci-green.ts's, here only that the queue applies it.
  describe("CI green instead of the verify line (RP-1190)", () => {
    const ciRun = (status: string, conclusion: string | null, overrides: Partial<CiRun> = {}): CiRun => ({
      id: 88,
      headSha: "abc1234",
      event: "pull_request",
      path: ".github/workflows/ci.yml",
      status,
      conclusion,
      repo: "Rabaed/rabaedV2.0",
      headRepo: "Rabaed/rabaedV2.0",
      pulls: [{ number: 149, baseRef: "main" }],
      jobs: ["lint", "unit"].map((name) => ({ name, status, conclusion })),
      ...overrides,
    });
    const ci = (...runs: CiRun[]): Partial<QueueSeam> => ({ body: () => "## Summary\n\nNo verify line.", requiredChecks: () => ["lint", "unit", "verify-gate", "reviewed-required"], ciRuns: () => runs });

    it("queues a PR with no verify line when CI passed on its head", () => {
      const { seam, enqueued } = fakeSeam(ci(ciRun("completed", "success")));
      expect(queuePr(149, seam).ok).toBe(true);
      expect(enqueued).toEqual([["PR_node", "abc1234"]]);
    });

    it("refuses a PR that edits ci.yml without the stamped line, however green CI is", () => {
      const { seam, enqueued } = fakeSeam({ ...ci(ciRun("completed", "success")), changedFiles: () => [".github/workflows/ci.yml", "scripts/x.ts"] });
      const result = queuePr(149, seam);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("CI's own files (.github/workflows/ci.yml)");
      expect(result.lines.join("\n")).toContain("pnpm verify --pr 149");
      expect(enqueued).toEqual([]);
    });

    it("says CI is still running and how many jobs are left", () => {
      const { seam, enqueued } = fakeSeam(ci(ciRun("in_progress", null)));
      const result = queuePr(149, seam);
      expect(result.ok).toBe(false);
      expect(result.lines[0]).toBe("PR #149: CI still running on abc1234: 2 jobs left (lint, unit).");
      expect(result.lines.join("\n")).toContain("pnpm queue 149 --wait");
      expect(enqueued).toEqual([]);
    });

    it("refuses when CI failed, or the only run is a fork's, naming why", () => {
      for (const [run, why] of [
        [ciRun("completed", "failure"), "failure"],
        [ciRun("completed", "success", { headRepo: "stranger/rabaedV2.0" }), "fork"],
      ] as const) {
        const { seam, enqueued } = fakeSeam(ci(run));
        const result = queuePr(149, seam);
        expect(result.ok).toBe(false);
        expect(result.lines.join("\n")).toContain(why);
        expect(enqueued).toEqual([]);
      }
    });

    it("refuses on a gh error reading CI, naming it, and still queues on a stamped line then", () => {
      const broken = {
        ciRuns: () => {
          throw new Error("gh api actions/workflows/ci.yml/runs failed: HTTP 502");
        },
      };
      const { seam } = fakeSeam({ ...ci(), ...broken });
      const result = queuePr(149, seam);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("HTTP 502");
      expect(queuePr(149, fakeSeam(broken).seam).ok).toBe(true);
    });

    it("--wait waits for CI, printing how many jobs are left, excuses verify-gate's early failure, then queues", async () => {
      let poll = 0;
      const logged: string[] = [];
      const runs = [ciRun("in_progress", null), ciRun("in_progress", null, { jobs: [{ name: "lint", status: "completed", conclusion: "success" }] }), ciRun("completed", "success")];
      const { seam, enqueued } = fakeSeam({
        ...ci(),
        requiredChecks: () => ["lint", "unit", "verify-gate"],
        ciRuns: () => [runs[Math.min(poll, runs.length - 1)] as CiRun],
        checkRuns: () => {
          const now = runs[Math.min(poll++, runs.length - 1)] as CiRun;
          // verify-gate ran at the push, before CI finished, and failed; once CI is green it is re-run and passes.
          const gate = now.status === "completed" ? { name: "verify-gate", status: "completed", conclusion: "success" } : { name: "verify-gate", status: "completed", conclusion: "failure" };
          return [...now.jobs.map((job) => ({ name: job.name, status: job.status, conclusion: job.conclusion ?? "" })), gate];
        },
      });
      const result = await queuePrWhenChecksPass(149, seam, { sleep: async () => {}, log: (line) => logged.push(line) });
      expect(result.ok).toBe(true);
      expect(logged).toContain("CI still running on abc1234: 2 jobs left (lint, unit).");
      expect(logged).toContain("CI still running on abc1234: 1 job left (unit).");
      expect(enqueued).toEqual([["PR_node", "abc1234"]]);
    });

    it("--wait fails when CI fails while it waits", async () => {
      let poll = 0;
      const runs = [ciRun("in_progress", null), ciRun("completed", "failure")];
      const { seam, enqueued } = fakeSeam({ ...ci(), ciRuns: () => [runs[Math.min(poll++, runs.length - 1)] as CiRun] });
      const result = await queuePrWhenChecksPass(149, seam, { sleep: async () => {} });
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("failure");
      expect(enqueued).toEqual([]);
    });
  });

  describe("dependencies-only PR (RP-573)", () => {
    const admin = (fields: Record<string, unknown>) => JSON.stringify({ name: "admin", scripts: { dev: "vite" }, devDependencies: { a: "1.0.0" }, ...fields });
    const withAdmin = (after: string, files = ["pnpm-lock.yaml", "apps/admin/package.json"]) =>
      fakeSeam({ changedFiles: () => files, packageJsonVersions: () => ({ before: admin({}), after }) });

    it("queues the lockfile with a workspace package.json whose only change is devDependencies", () => {
      const { seam, enqueued } = withAdmin(admin({ devDependencies: { a: "1.0.0", b: "2.0.0" } }));
      expect(queuePr(181, seam).ok).toBe(true);
      expect(enqueued).toHaveLength(1);
    });

    it("refuses when the workspace package.json also changes a script", () => {
      const { seam, enqueued } = withAdmin(admin({ devDependencies: { a: "1.0.0", b: "2.0.0" }, scripts: { dev: "vite --host" } }));
      const result = queuePr(181, seam);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("apps/admin/package.json");
      expect(result.lines.join("\n")).toContain("only its dependency fields");
      expect(enqueued).toEqual([]);
    });

    it("refuses a package.json that does not parse", () => {
      const { seam } = withAdmin("{ not json");
      expect(queuePr(181, seam).ok).toBe(false);
    });

    it("refuses the lockfile with a dependencies-only package.json plus code", () => {
      const { seam } = withAdmin(admin({ devDependencies: { b: "2.0.0" } }), ["pnpm-lock.yaml", "apps/admin/package.json", "apps/admin/src/a.ts"]);
      const result = queuePr(181, seam);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("apps/admin/src/a.ts");
    });

    it("refuses the lockfile with code as today", () => {
      const { seam } = fakeSeam({ changedFiles: () => ["pnpm-lock.yaml", "apps/api/src/a.ts"] });
      expect(queuePr(181, seam).ok).toBe(false);
    });

    it("refuses when the package.json is new or deleted", () => {
      const { seam } = fakeSeam({ changedFiles: () => ["pnpm-lock.yaml", "apps/new/package.json"], packageJsonVersions: () => ({ before: undefined, after: admin({}) }) });
      expect(queuePr(181, seam).ok).toBe(false);
    });
  });

  it("refuses when origin/main cannot be fetched", () => {
    const { seam, enqueued } = fakeSeam({ fetchMain: () => false });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("git fetch origin main failed");
    expect(enqueued).toEqual([]);
  });

  it("queues a PR whose branch is not checked out: checks and pins the PR's own head, not HEAD", () => {
    const checked: string[] = [];
    const { seam, enqueued } = fakeSeam({
      head: () => "unrelated9",
      fetchPull: () => "fed7777",
      pullRequest: () => ({ id: "PR_node", headRefOid: "fed7777", headRefName: "feature" }),
      mergeTree: (sha) => {
        checked.push(`merge-tree ${sha}`);
        return { status: 0, output: "", stderr: "" };
      },
      check: (name, sha) => {
        checked.push(`${name} ${sha}`);
        return { status: 0, output: "" };
      },
    });
    const result = queuePr(157, seam);
    expect(result.ok).toBe(true);
    expect(checked).toEqual(["merge-tree fed7777", "drift fed7777", "immutable fed7777"]);
    expect(enqueued).toEqual([["PR_node", "fed7777"]]);
    expect(result.lines.join("\n")).not.toContain("behind");
  });

  it("warns, and still queues the PR's head, when HEAD is on the PR's branch but behind it", () => {
    const { seam, enqueued } = fakeSeam({ head: () => "old1", fetchPull: () => "ace2222", pullRequest: () => ({ id: "PR_node", headRefOid: "ace2222", headRefName: "feature" }), isAncestor: () => true });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("behind");
    expect(enqueued).toEqual([["PR_node", "ace2222"]]);
  });

  it("does not warn when an old main (another branch) is checked out and is an ancestor of the PR's head", () => {
    const { seam, enqueued } = fakeSeam({ head: () => "oldmain", branch: () => "main", fetchPull: () => "ace2222", pullRequest: () => ({ id: "PR_node", headRefOid: "ace2222", headRefName: "feature" }), isAncestor: () => true });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).not.toContain("behind");
    expect(enqueued).toEqual([["PR_node", "ace2222"]]);
  });

  it("refuses when the PR's head moved between the API answer and the fetch", () => {
    const { seam, enqueued } = fakeSeam({ fetchPull: () => "local1", pullRequest: () => ({ id: "x", headRefOid: "remote2", headRefName: "feature" }) });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("local1");
    expect(text).toContain("remote2");
    expect(enqueued).toEqual([]);
  });

  it("refuses a text conflict with origin/main and lists the conflicted files", () => {
    const output = [
      "9f0e1d2c3b4a",
      "100644 aaaa1111 1\tpackages/ui/src/storybook/numbering.ts",
      "100644 bbbb2222 2\tpackages/ui/src/storybook/numbering.ts",
      "100644 cccc3333 3\tpackages/ui/src/storybook/numbering.ts",
      "100644 dddd4444 2\tdocs/other.md",
      "",
      "CONFLICT (add/add): Merge conflict in packages/ui/src/storybook/numbering.ts",
    ].join("\n");
    const { seam, enqueued } = fakeSeam({ mergeTree: () => ({ status: 1, output, stderr: "" }) });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("packages/ui/src/storybook/numbering.ts");
    expect(text).toContain("docs/other.md");
    expect(text).toContain("merge main");
    expect(enqueued).toEqual([]);
  });

  it("says a merge-tree error is not a conflict, and prints its stderr", () => {
    const { seam, enqueued } = fakeSeam({ mergeTree: () => ({ status: 128, output: "", stderr: "fatal: refusing to merge unrelated histories\n" }) });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("fatal: refusing to merge unrelated histories");
    expect(text).toContain("not a conflict");
    expect(text).not.toContain("conflicts with origin/main");
    expect(enqueued).toEqual([]);
  });

  it("refuses a migration that shares a timestamp with origin/main, with the check's message", () => {
    const message = "These migrations share a timestamp; rename this branch's (it isn't on main yet) to a new, later one: 20261220000000_counter_for_pattern_in_effect.sql, 20261220000000_random_ids.sql\n";
    const { seam, enqueued } = fakeSeam({
      check: (name) => (name === "drift" ? { status: 1, output: message } : { status: 0, output: "" }),
    });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain(message.trimEnd());
    expect(text).toContain("rename the migration");
    expect(enqueued).toEqual([]);
  });

  // RP-967: a first `--wait` call that timed out on the client had in fact queued the PR.
  it("says a PR GitHub reports as already in the queue is queued, and does not fail", () => {
    const { seam } = fakeSeam({
      enqueue: () => {
        throw new Error("gh api graphql -f failed:\nGraphQL: Pull request is already in the queue (enqueuePullRequest)");
      },
    });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("PR #149 is already in the merge queue");
  });

  it("knows GitHub's other wordings for a PR already queued", () => {
    for (const message of [
      "GraphQL: Pull request is already in a merge queue",
      "GraphQL: This pull request is already queued to merge",
      "Pull request Rabaed/rabaedV2.0#149 is already queued to merge",
      "already in the queue",
    ]) {
      const { seam } = fakeSeam({
        enqueue: () => {
          throw new Error(message);
        },
      });
      expect(queuePr(149, seam).ok, message).toBe(true);
    }
  });

  it("still fails on any other enqueue error", () => {
    const { seam } = fakeSeam({
      enqueue: () => {
        throw new Error("GraphQL: 1 of 1 required status checks have not succeeded: 1 expected.");
      },
    });
    expect(() => queuePr(149, seam)).toThrow(/1 expected/);
  });

  it("refuses a migration that sorts before main's latest, with the immutable check's message", () => {
    const { seam, enqueued } = fakeSeam({
      check: (name) => (name === "immutable" ? { status: 1, output: "x.sql sorts before y.sql\n" } : { status: 0, output: "" }),
    });
    const result = queuePr(149, seam);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("x.sql sorts before y.sql");
    expect(enqueued).toEqual([]);
  });
});

// RP-967: right after `gh pr create` the PR's required checks have not finished, and GitHub refuses the enqueue.
describe("queuePrWhenChecksPass", () => {
  type Run = { name: string; status: string; conclusion: string };
  // Plays the given check-run lists in order (the last repeats); records sleeps, and what was enqueued after which poll.
  function checking(polls: Run[][], overrides: Partial<QueueSeam> = {}) {
    let poll = 0;
    let clock = 0;
    const sleeps: number[] = [];
    const order: string[] = [];
    const { seam, enqueued } = fakeSeam({
      requiredChecks: () => ["ci", "reviewed-required"],
      checkRuns: (commit) => {
        order.push(`checks ${commit}`);
        return polls[Math.min(poll++, polls.length - 1)] as Run[];
      },
      enqueue: (id, head) => {
        order.push("enqueue");
        enqueued.push([id, head]);
        return { position: 1, state: "QUEUED" };
      },
      ...overrides,
    });
    const options = {
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
    };
    return { seam, enqueued, sleeps, order, options };
  }
  const done = (name: string, conclusion = "success"): Run => ({ name, status: "completed", conclusion });
  const going = (name: string): Run => ({ name, status: "in_progress", conclusion: "" });

  it("waits while a required check is pending or not reported yet, then queues the PR's head", async () => {
    const c = checking([[], [going("ci")], [done("ci"), going("reviewed-required")], [done("ci"), done("reviewed-required", "skipped"), going("unrequired")]]);
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result.ok).toBe(true);
    expect(c.sleeps).toEqual([60_000, 60_000, 60_000]);
    expect(c.order).toEqual(["checks abc1234", "checks abc1234", "checks abc1234", "checks abc1234", "enqueue"]);
    expect(c.enqueued).toEqual([["PR_node", "abc1234"]]);
  });

  it("fails without queueing when a required check fails, naming it and its conclusion", async () => {
    const c = checking([[going("ci")], [done("ci", "failure"), done("reviewed-required")]]);
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("ci (failure)");
    expect(text).not.toContain("reviewed-required (");
    expect(c.enqueued).toEqual([]);
  });

  it("ignores a failing check the ruleset does not require", async () => {
    const c = checking([[done("ci"), done("reviewed-required"), done("e2e-nightly", "failure")]]);
    expect((await queuePrWhenChecksPass(149, c.seam, c.options)).ok).toBe(true);
    expect(c.sleeps).toEqual([]);
  });

  it("gives up, naming the check, when a required check never reports on the head", async () => {
    const c = checking([[done("ci")]]);
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("reviewed-required");
    expect(result.lines.join("\n")).toContain("never reported");
    expect(c.sleeps.length).toBe(15);
    expect(c.enqueued).toEqual([]);
  });

  it("keeps the refusals: a PR without a label is refused before any check is read", async () => {
    const c = checking([[]], { labels: () => [] });
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result.ok).toBe(false);
    expect(c.order).toEqual([]);
  });

  it("treats an already-queued PR as queued after its checks pass", async () => {
    const c = checking([[done("ci"), done("reviewed-required")]], {
      enqueue: () => {
        throw new Error("GraphQL: Pull request is already in the queue");
      },
    });
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("already in the merge queue");
  });

  // Review fix 1: a run stuck queued or in progress must not loop forever.
  it("gives up after 60 min when a required check stays pending, naming it and its status", async () => {
    const c = checking([[done("ci"), { name: "reviewed-required", status: "queued", conclusion: "" }]]);
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result).toMatchObject({ ok: false, reason: "checks_timeout" });
    expect(result.lines.join("\n")).toContain("reviewed-required (queued)");
    expect(result.lines.join("\n")).toContain("60 min");
    expect(c.sleeps.length).toBe(60);
    expect(c.enqueued).toEqual([]);
  });

  // Review fix 2: a required context can be a commit status, not a check run.
  it("counts a required context reported as a commit status", async () => {
    let poll = 0;
    const c = checking([[done("ci"), done("reviewed-required")]], {
      requiredChecks: () => ["ci", "reviewed-required", "legacy/status"],
      commitStatuses: () => (poll++ === 0 ? [{ context: "legacy/status", state: "pending" }] : [{ context: "legacy/status", state: "success" }]),
    });
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result.ok).toBe(true);
    expect(c.sleeps).toEqual([60_000]);
  });

  it("fails on a required commit status that failed or errored, naming it", async () => {
    const c = checking([[done("ci"), done("reviewed-required")]], {
      requiredChecks: () => ["ci", "legacy/status"],
      commitStatuses: () => [{ context: "legacy/status", state: "error" }],
    });
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("legacy/status (error)");
  });

  // Review fix 3: one flaky gh call mid-wait is not the end of the wait.
  it("retries a gh call that fails mid-wait, and goes on when it answers", async () => {
    let calls = 0;
    const c = checking([[done("ci"), done("reviewed-required")]]);
    const answer = c.seam.checkRuns;
    c.seam.checkRuns = (commit) => {
      if (calls++ < 2) throw new Error("gh: HTTP 502 Bad Gateway");
      return answer(commit);
    };
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result.ok).toBe(true);
    expect(c.sleeps).toEqual([10_000, 10_000]);
  });

  it("fails naming the call after three failed tries", async () => {
    const c = checking([[]], {
      checkRuns: () => {
        throw new Error("gh: HTTP 502 Bad Gateway");
      },
    });
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result).toMatchObject({ ok: false, reason: "gh_failed" });
    const text = result.lines.join("\n");
    expect(text).toContain("the head's check runs");
    expect(text).toContain("3 times");
    expect(text).toContain("HTTP 502");
    expect(c.enqueued).toEqual([]);
  });

  // Review fix 4: right after `gh pr create` the reviewed-label run is still going; --wait waits for it.
  it("waits for a reviewed-label run still going on the head, then queues", async () => {
    let poll = 0;
    const c = checking([[done("ci"), done("reviewed-required")]], {
      labelRuns: () => (poll++ < 2 ? [{ status: "in_progress", conclusion: "" }] : [{ status: "completed", conclusion: "success" }]),
    });
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result.ok).toBe(true);
    expect(c.enqueued).toEqual([["PR_node", "abc1234"]]);
    expect(c.sleeps.length).toBe(1);
  });

  it("still refuses when the reviewed-label run it waited for fails", async () => {
    let poll = 0;
    const c = checking([[done("ci"), done("reviewed-required")]], {
      labelRuns: () => (poll++ < 2 ? [{ status: "queued", conclusion: "" }] : [{ status: "completed", conclusion: "failure" }]),
    });
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("reviewed-label run on abc1234 failed (failure)");
    expect(c.enqueued).toEqual([]);
  });

  // Review fix 5: a push while waiting moves the head; the wait ends with a named result, not a throw.
  it("ends with head_moved when the PR's head moves during the wait", async () => {
    let poll = 0;
    const c = checking([[going("ci")]], {
      pullRequest: () => ({ id: "PR_node", headRefOid: poll++ < 2 ? "abc1234" : "def456", headRefName: "feature" }),
    });
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result).toMatchObject({ ok: false, reason: "head_moved" });
    expect(result.lines.join("\n")).toContain("abc1234");
    expect(result.lines.join("\n")).toContain("def456");
    expect(c.enqueued).toEqual([]);
  });

  it("ends with head_moved when GitHub refuses the pinned head at enqueue", async () => {
    const c = checking([[done("ci"), done("reviewed-required")]], {
      enqueue: () => {
        throw new Error("GraphQL: Expected head OID abc1234 does not match the pull request's head (enqueuePullRequest)");
      },
    });
    const result = await queuePrWhenChecksPass(149, c.seam, c.options);
    expect(result).toMatchObject({ ok: false, reason: "head_moved" });
  });

  it("logs which required checks it is waiting for, once per change", async () => {
    const logged: string[] = [];
    const c = checking([[going("ci")], [going("ci")], [done("ci"), going("reviewed-required")], [done("ci"), done("reviewed-required")]]);
    await queuePrWhenChecksPass(149, c.seam, { ...c.options, log: (line) => logged.push(line) });
    expect(logged).toEqual(["Waiting for required checks on abc1234: ci, reviewed-required.", "Waiting for required checks on abc1234: reviewed-required."]);
  });
});

describe("waitForMerge", () => {
  // Plays the given statuses in order (the last repeats) and records the sleeps.
  const since = new Date("2026-10-09T10:00:00Z");
  function waiting(statuses: PullStatus[], reason?: string) {
    let polls = 0;
    const sleeps: number[] = [];
    const { seam } = fakeSeam({ status: () => statuses[Math.min(polls++, statuses.length - 1)] as PullStatus, removalReason: (_id, from) => (from === since ? reason : undefined) });
    return { seam, sleeps, sleep: async (ms: number) => void sleeps.push(ms), polls: () => polls };
  }

  it("polls every 60 s while queued and succeeds when the PR merges", async () => {
    const w = waiting([
      { state: "OPEN", isInMergeQueue: true },
      { state: "OPEN", isInMergeQueue: true },
      { state: "MERGED", isInMergeQueue: false },
    ]);
    const result = await waitForMerge(149, w.seam, since, w.sleep);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("merged");
    expect(w.sleeps).toEqual([60_000, 60_000]);
  });

  it("fails with the classified reason when the PR leaves the queue", async () => {
    const w = waiting([{ state: "OPEN", isInMergeQueue: true }, { state: "OPEN", isInMergeQueue: false }], "MERGE_CONFLICT");
    const result = await waitForMerge(149, w.seam, since, w.sleep);
    expect(result.ok).toBe(false);
    const text = result.lines.join("\n");
    expect(text).toContain("left the merge queue");
    expect(text).toContain("MERGE_CONFLICT");
    expect(text).toContain("conflict");
  });

  it("does not call a single poll outside the queue a removal (the merge may be landing)", async () => {
    const w = waiting([
      { state: "OPEN", isInMergeQueue: false },
      { state: "MERGED", isInMergeQueue: false },
    ]);
    expect((await waitForMerge(149, w.seam, since, w.sleep)).ok).toBe(true);
  });

  it("passes the wait's start to the seam, so an earlier removal's reason is not reported", async () => {
    const w = waiting([{ state: "OPEN", isInMergeQueue: false }]);
    const result = await waitForMerge(149, w.seam, new Date("2026-10-09T11:00:00Z"), w.sleep);
    expect(result.lines.join("\n")).toContain("reason: unknown");
  });

  it("says a manual removal was manual, and a failed check failed", async () => {
    const manual = waiting([{ state: "OPEN", isInMergeQueue: false }], "MANUAL");
    expect((await waitForMerge(149, manual.seam, since, manual.sleep)).lines.join("\n")).toContain("on purpose");
    const failed = waiting([{ state: "OPEN", isInMergeQueue: false }], "FAILED_CHECKS");
    expect((await waitForMerge(149, failed.seam, since, failed.sleep)).lines.join("\n")).toContain("check failed");
  });

  it("fails when the PR is closed without merging", async () => {
    const w = waiting([{ state: "CLOSED", isInMergeQueue: false }]);
    const result = await waitForMerge(149, w.seam, since, w.sleep);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("closed");
  });
});

// The real seam, with spawnSync injected: it must hand git and gh the right arguments.
describe("realSeam", () => {
  function recorded(answer: (command: string, args: string[]) => { status: number | null; stdout?: string; stderr?: string }) {
    const calls: { command: string; args: string[]; cwd: unknown }[] = [];
    const spawn = ((command: string, args: string[], options: { cwd?: string }) => {
      calls.push({ command, args, cwd: options.cwd });
      return answer(command, args);
    }) as unknown as typeof spawnSync;
    return { calls, seam: realSeam("/work", spawn) };
  }

  it("fetches main and the PR's own head ref, reads HEAD and the PR, and merge-trees origin/main with the PR's commit, all in the given directory", () => {
    const { calls, seam } = recorded((command, args) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: "abc1234\n" };
      if (command === "gh") return { status: 0, stdout: '{"id":"PR_node","headRefOid":"abc1234","headRefName":"feature"}' };
      if (args[0] === "fetch") return { status: 0 };
      if (args[0] === "merge-base") return { status: 0 };
      return { status: 1, stdout: "treeoid\n", stderr: "warn" };
    });
    expect(seam.fetchMain()).toBe(true);
    expect(seam.fetchPull(157)).toBe("abc1234");
    expect(seam.head()).toBe("abc1234");
    expect(seam.isAncestor("old1", "abc1234")).toBe(true);
    expect(seam.pullRequest(149)).toEqual({ id: "PR_node", headRefOid: "abc1234", headRefName: "feature" });
    expect(seam.mergeTree("abc1234")).toMatchObject({ status: 1, output: "treeoid\nwarn", stderr: "warn" });
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["git", "fetch", "origin", "main"],
      ["git", "fetch", "origin", "refs/pull/157/head"],
      ["git", "rev-parse", "FETCH_HEAD"],
      ["git", "rev-parse", "HEAD"],
      ["git", "merge-base", "--is-ancestor", "old1", "abc1234"],
      ["gh", "pr", "view", "149", "--json", "id,headRefOid,headRefName"],
      ["git", "merge-tree", "--write-tree", "origin/main", "abc1234"],
    ]);
    expect(calls.every((call) => call.cwd === "/work")).toBe(true);
  });

  it("reads the PR's state and merge-queue flag, and the latest removal reason made since the given time, through gh api graphql", () => {
    const { calls, seam } = recorded((_command, args) =>
      args.some((arg) => arg.includes("REMOVED_FROM_MERGE_QUEUE_EVENT"))
        ? { status: 0, stdout: '{"data":{"node":{"timelineItems":{"nodes":[{"reason":"MERGE_CONFLICT","createdAt":"2026-10-09T10:30:00Z"}]}}}}' }
        : { status: 0, stdout: '{"data":{"node":{"state":"OPEN","isInMergeQueue":true}}}' },
    );
    expect(seam.status("PR_node")).toEqual({ state: "OPEN", isInMergeQueue: true });
    expect(seam.removalReason("PR_node", new Date("2026-10-09T10:00:00Z"))).toBe("MERGE_CONFLICT");
    expect(seam.removalReason("PR_node", new Date("2026-10-09T11:00:00Z"))).toBeUndefined();
    expect(calls.every((call) => call.command === "gh" && call.args.slice(0, 2).join(" ") === "api graphql" && call.args.includes("id=PR_node"))).toBe(true);
  });

  it("reads a package.json at the merge base with origin/main and at the PR's commit, undefined where git show fails", () => {
    const { calls, seam } = recorded((_command, args) => {
      if (args[0] === "merge-base") return { status: 0, stdout: "base777\n" };
      if (args[1] === "base777:apps/admin/package.json") return { status: 0, stdout: "OLD" };
      return { status: 128, stderr: "fatal: path does not exist" };
    });
    expect(seam.packageJsonVersions("abc1234", "apps/admin/package.json")).toEqual({ before: "OLD", after: undefined });
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ["git", "merge-base", "origin/main", "abc1234"],
      ["git", "show", "base777:apps/admin/package.json"],
      ["git", "show", "abc1234:apps/admin/package.json"],
    ]);
  });

  it("runs the migration checks for the PR's commit against origin/main with node", () => {
    const { calls, seam } = recorded(() => ({ status: 0, stdout: "ok" }));
    seam.check("drift", "abc1234");
    seam.check("immutable", "abc1234");
    expect(calls.map((call) => call.command)).toEqual([process.execPath, process.execPath]);
    expect(calls[0]?.args[0]).toMatch(/check-migration-drift\.ts$/);
    expect(calls[0]?.args.slice(1)).toEqual(["origin/main", "abc1234"]);
    expect(calls[1]?.args[0]).toMatch(/check-migrations-immutable\.ts$/);
    expect(calls[1]?.args.slice(1)).toEqual(["origin/main", "abc1234"]);
  });

  it("lists both paths of a renamed file, so x.ts renamed to x.md is not a docs-only change (RP-606)", () => {
    const dir = mkdtempSync(join(tmpdir(), "queue-rename-"));
    try {
      const git = (...args: string[]) => {
        const done = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
        if (done.status !== 0) throw new Error(done.stderr);
        return done.stdout.trim();
      };
      git("init", "-q");
      writeFileSync(join(dir, "x.ts"), "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
      git("add", ".");
      git("commit", "-q", "-m", "main");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      git("mv", "x.ts", "x.md");
      git("commit", "-q", "-m", "rename");
      const files = realSeam(dir).changedFiles(git("rev-parse", "HEAD"));
      expect(files.sort()).toEqual(["x.md", "x.ts"]);
      expect(queuePr(149, fakeSeam({ labels: () => ["docs-only"], changedFiles: () => files }).seam).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the PR's body through gh pr view, empty when it has none", () => {
    const { calls, seam } = recorded(() => ({ status: 0, stdout: '{"body":"pnpm verify passed on abc1234: lint."}' }));
    expect(seam.body(149)).toBe("pnpm verify passed on abc1234: lint.");
    expect([calls[0]?.command, ...(calls[0]?.args ?? [])]).toEqual(["gh", "pr", "view", "149", "--json", "body"]);
    expect(recorded(() => ({ status: 0, stdout: '{"body":null}' })).seam.body(149)).toBe("");
  });

  it("reads parents through git rev-list, the reviewed-label rule's git", () => {
    const { calls, seam } = recorded(() => ({ status: 0, stdout: "n1 v99 m1\n" }));
    expect(seam.parents("n1")).toEqual(["v99", "m1"]);
    expect(calls[0]?.args).toEqual(["rev-list", "--parents", "-n", "1", "n1"]);
  });

  it("reads the PR's label names through gh pr view", () => {
    const { calls, seam } = recorded(() => ({ status: 0, stdout: '{"labels":[{"name":"reviewed"},{"name":"x"}]}' }));
    expect(seam.labels(149)).toEqual(["reviewed", "x"]);
    expect([calls[0]?.command, ...(calls[0]?.args ?? [])]).toEqual(["gh", "pr", "view", "149", "--json", "labels"]);
  });

  it("lists the reviewed-label runs for a commit through gh run list, and checks the workflow file on origin/main", () => {
    const { calls, seam } = recorded((command) => (command === "gh" ? { status: 0, stdout: '[{"status":"completed","conclusion":"success"}]' } : { status: 0 }));
    expect(seam.labelRuns("abc1234")).toEqual([{ status: "completed", conclusion: "success" }]);
    expect(seam.labelWorkflowOnMain()).toBe(true);
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["gh", "run", "list", "--workflow", "reviewed-label.yml", "--commit", "abc1234", "--json", "status,conclusion"],
      ["git", "cat-file", "-e", "origin/main:.github/workflows/reviewed-label.yml"],
    ]);
  });

  it("enqueues through gh api graphql, passing the PR id and the head to pin", () => {
    const { calls, seam } = recorded(() => ({ status: 0, stdout: '{"data":{"enqueuePullRequest":{"mergeQueueEntry":{"position":2,"state":"QUEUED"}}}}' }));
    expect(seam.enqueue("PR_node", "abc1234")).toEqual({ position: 2, state: "QUEUED" });
    const args = calls[0]?.args ?? [];
    expect(calls[0]?.command).toBe("gh");
    expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(args.find((arg) => arg.startsWith("query="))).toContain("enqueuePullRequest");
    expect(args).toContain("id=PR_node");
    expect(args).toContain("head=abc1234");
  });

  it("reads the main ruleset's required checks and the head's check runs through gh api, one JSON line per item", () => {
    const { calls, seam } = recorded((_command, args) =>
      args.some((arg) => arg.includes("check-runs"))
        ? { status: 0, stdout: '{"name":"lint","status":"completed","conclusion":"success"}\n{"name":"unit","status":"in_progress","conclusion":""}\n' }
        : { status: 0, stdout: "lint\nseam 1 (API as a Member)\n" },
    );
    expect(seam.requiredChecks()).toEqual(["lint", "seam 1 (API as a Member)"]);
    expect(seam.checkRuns("abc1234")).toEqual([
      { name: "lint", status: "completed", conclusion: "success" },
      { name: "unit", status: "in_progress", conclusion: "" },
    ]);
    const [rules, runs] = calls.map(({ command, args }) => [command, ...args]);
    expect(rules?.slice(0, 4)).toEqual(["gh", "api", "--paginate", "repos/{owner}/{repo}/rules/branches/main"]);
    expect(rules?.join(" ")).toContain("required_status_checks");
    expect(runs?.slice(0, 4)).toEqual(["gh", "api", "--paginate", "repos/{owner}/{repo}/commits/abc1234/check-runs?per_page=100"]);
  });

  it("reads the head's ci.yml pull_request runs and each run's latest jobs through gh api (RP-1190)", () => {
    const run = { id: 5, head_sha: "abc1234", event: "pull_request", path: ".github/workflows/ci.yml", status: "completed", conclusion: "success", repository: { full_name: "Rabaed/rabaedV2.0" }, head_repository: { full_name: "Rabaed/rabaedV2.0" } };
    const { calls, seam } = recorded((_command, args) =>
      args.some((arg) => arg.includes("/jobs")) ? { status: 0, stdout: JSON.stringify({ total_count: 1, jobs: [{ name: "lint", status: "completed", conclusion: "success", id: 1 }] }) } : { status: 0, stdout: JSON.stringify({ workflow_runs: [run] }) },
    );
    expect(seam.ciRuns("abc1234")).toEqual([
      { id: 5, headSha: "abc1234", event: "pull_request", path: ".github/workflows/ci.yml", status: "completed", conclusion: "success", repo: "Rabaed/rabaedV2.0", headRepo: "Rabaed/rabaedV2.0", pulls: [], jobs: [{ name: "lint", status: "completed", conclusion: "success" }] },
    ]);
    expect(calls.map(({ args }) => args.join(" "))).toEqual([
      "api repos/{owner}/{repo}/actions/workflows/ci.yml/runs?head_sha=abc1234&event=pull_request&per_page=100",
      "api repos/{owner}/{repo}/actions/runs/5/jobs?filter=latest&per_page=100",
    ]);
  });

  it("reads the head's commit statuses through gh api, one JSON line per context", () => {
    const { calls, seam } = recorded(() => ({ status: 0, stdout: '{"context":"legacy/status","state":"pending"}\n' }));
    expect(seam.commitStatuses("abc1234")).toEqual([{ context: "legacy/status", state: "pending" }]);
    expect(calls[0]?.args.slice(0, 3)).toEqual(["api", "--paginate", "repos/{owner}/{repo}/commits/abc1234/status?per_page=100"]);
  });

  it("throws with the command's output when a required call fails", () => {
    const { seam } = recorded(() => ({ status: 1, stderr: "no auth" }));
    expect(() => seam.head()).toThrow(/no auth/);
  });
});
