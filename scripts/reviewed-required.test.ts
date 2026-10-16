import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { overHttp, queuedPrNumber, REQUIRED_CHECK, requiredEvent, requireReviewed, reviewGate, type RequiredSeam } from "./reviewed-required.ts";

// The workflow the main ruleset requires: the queue must get the same check name as the PR.
describe("reviewed-required.yml", () => {
  const source = readFileSync(join(dirname(import.meta.filename), "..", ".github", "workflows", "reviewed-required.yml"), "utf8");
  const wf = parse(source) as {
    on: Record<string, { types?: string[] } | null>;
    jobs: Record<string, { name?: string; if?: string; permissions?: Record<string, string>; steps: { uses?: string; with?: Record<string, unknown>; run?: string }[] }>;
  };
  const jobs = Object.values(wf.jobs);

  it("runs on every PR event that can change the answer, and on merge_group", () => {
    expect(wf.on).toEqual({ pull_request: { types: ["opened", "reopened", "synchronize", "labeled", "unlabeled"] }, merge_group: null });
  });

  it("is one job, named as the ruleset requires it, with no condition that could skip it", () => {
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe(REQUIRED_CHECK);
    expect(jobs[0]?.if).toBeUndefined();
  });

  it("reads only, and runs the default branch's script, never the PR's", () => {
    expect(Object.values(jobs[0]?.permissions ?? {})).not.toContain("write");
    const checkout = jobs[0]?.steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout?.with?.ref).toBe("${{ github.event.repository.default_branch }}");
    expect(jobs[0]?.steps.some((s) => s.run === "node scripts/reviewed-required.ts")).toBe(true);
  });
});

describe("requiredEvent", () => {
  it("reads a pull_request event: number, head, and whether the head is this repository's", () => {
    const payload = { pull_request: { number: 7, head: { sha: "h", repo: { full_name: "Rabaed/rabaedV2.0" } } } };
    expect(requiredEvent("pull_request", payload, "Rabaed/rabaedV2.0")).toEqual({ kind: "pull_request", pr: 7, headSha: "h", sameRepo: true });
    expect(requiredEvent("pull_request", payload, "Other/repo")).toMatchObject({ sameRepo: false });
  });

  it("reads a merge_group event's head ref", () => {
    expect(requiredEvent("merge_group", { merge_group: { head_ref: "refs/heads/gh-readonly-queue/main/pr-3-ab" } }, "r")).toEqual({ kind: "merge_group", headRef: "refs/heads/gh-readonly-queue/main/pr-3-ab" });
  });

  it("refuses any other event", () => {
    expect(() => requiredEvent("push", {}, "r")).toThrow();
  });
});

describe("overHttp", () => {
  function recorded(answer: (url: string) => { status: number; body?: unknown }) {
    const urls: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      urls.push(String(url));
      const { status, body } = answer(String(url));
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }) as typeof fetch;
    return { urls, github: overHttp("o/r", "t", fetcher) };
  }

  it("reads the PR's labels and changed-file count", async () => {
    const { urls, github } = recorded(() => ({ status: 200, body: { labels: [{ name: "reviewed" }], changed_files: 4 } }));
    expect(await github.pull(9)).toEqual({ labels: ["reviewed"], changedFiles: 4 });
    expect(urls).toEqual(["https://api.github.com/repos/o/r/pulls/9"]);
  });

  it("pages through the changed files until a short page", async () => {
    const { urls, github } = recorded((url) => ({ status: 200, body: url.endsWith("page=1") ? Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}` })) : [{ filename: "last" }] }));
    const files = await github.files(9);
    expect(files).toHaveLength(101);
    expect(files.at(-1)).toBe("last");
    expect(urls).toEqual(["https://api.github.com/repos/o/r/pulls/9/files?per_page=100&page=1", "https://api.github.com/repos/o/r/pulls/9/files?per_page=100&page=2"]);
  });

  it("lists the reviewed-label runs of a head, and undefined when the workflow is not there", async () => {
    const { urls, github } = recorded(() => ({ status: 200, body: { workflow_runs: [{ status: "queued" }] } }));
    expect(await github.labelRuns("abc")).toEqual([{ status: "queued" }]);
    expect(urls).toEqual(["https://api.github.com/repos/o/r/actions/workflows/reviewed-label.yml/runs?head_sha=abc&event=pull_request"]);
    expect(await recorded(() => ({ status: 404 })).github.labelRuns("abc")).toBeUndefined();
  });

  it("throws on any other error answer", async () => {
    await expect(recorded(() => ({ status: 500 })).github.pull(9)).rejects.toThrow("500");
  });
});

function fakeSeam(overrides: Partial<RequiredSeam> = {}) {
  const slept: number[] = [];
  const seam: RequiredSeam = {
    pull: async () => ({ labels: ["reviewed"], changedFiles: 1 }),
    files: async () => ["docs/a.md"],
    labelRuns: async () => [{ status: "completed" }],
    sleep: async (ms) => void slept.push(ms),
    ...overrides,
  };
  return { seam, slept };
}

describe("queuedPrNumber", () => {
  it("reads the PR number from a merge queue ref", () => {
    expect(queuedPrNumber("refs/heads/gh-readonly-queue/main/pr-231-614fce9be660cf64ddedc019f3b4f58733f79644")).toBe(231);
  });

  it("returns undefined for any other ref", () => {
    expect(queuedPrNumber("refs/heads/RP-606-reviewed-required-check")).toBeUndefined();
  });
});

describe("requireReviewed on merge_group", () => {
  const event = { kind: "merge_group" as const, headRef: "refs/heads/gh-readonly-queue/main/pr-12-abc123" };

  it("passes a queued PR with the reviewed label, without waiting", async () => {
    const asked: number[] = [];
    const { seam, slept } = fakeSeam({ pull: async (pr) => (asked.push(pr), { labels: ["reviewed"], changedFiles: 3 }) });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(true);
    expect(asked).toEqual([12]);
    expect(slept).toEqual([]);
  });

  it("fails a queued PR without the label, so the queue drops it", async () => {
    const { seam } = fakeSeam({ pull: async () => ({ labels: [], changedFiles: 3 }) });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("PR #12");
    expect(result.summary).toContain("gh pr edit 12 --add-label reviewed");
  });

  it("fails when the queue ref names no PR", async () => {
    const { seam } = fakeSeam();
    expect((await requireReviewed({ kind: "merge_group", headRef: "refs/heads/elsewhere" }, seam)).ok).toBe(false);
  });

  it("lists the files only for docs-only, and refuses when the list is cut short", async () => {
    let listed = 0;
    const { seam } = fakeSeam({ pull: async () => ({ labels: ["docs-only"], changedFiles: 2 }), files: async () => (listed++, ["docs/a.md"]) });
    expect((await requireReviewed(event, seam)).ok).toBe(false);
    expect(listed).toBe(1);
    const whole = fakeSeam({ pull: async () => ({ labels: ["docs-only"], changedFiles: 1 }) });
    expect((await requireReviewed(event, whole.seam)).ok).toBe(true);
  });
});

describe("requireReviewed on pull_request", () => {
  const event = { kind: "pull_request" as const, pr: 7, headSha: "head1", sameRepo: true };

  it("waits for the head's reviewed-label run, then reads the labels it left: a push that dropped the label fails", async () => {
    // The run removes the label with GITHUB_TOKEN, which starts no `unlabeled` run, so this run must see the result itself.
    const runs = [[], [{ status: "in_progress" }], [{ status: "completed" }]];
    let labels = ["reviewed"];
    const { seam, slept } = fakeSeam({
      labelRuns: async (sha) => {
        expect(sha).toBe("head1");
        const next = runs.shift() ?? [];
        if (next[0]?.status === "completed") labels = [];
        return next;
      },
      pull: async () => ({ labels, changedFiles: 1 }),
    });
    const result = await requireReviewed(event, seam, { pollMs: 5, timeoutMs: 100 });
    expect(slept).toEqual([5, 5]);
    expect(result.ok).toBe(false);
  });

  it("passes once the run finished and the label stayed (a clean merge of main)", async () => {
    const { seam } = fakeSeam();
    expect((await requireReviewed(event, seam)).ok).toBe(true);
  });

  it("fails when the run never finishes, saying how to get one", async () => {
    const { seam } = fakeSeam({ labelRuns: async () => [] });
    const result = await requireReviewed(event, seam, { pollMs: 10, timeoutMs: 30 });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("reviewed-label");
  });

  it("does not wait on a fork's PR (it never gets a reviewed-label run) or before the workflow exists", async () => {
    for (const [sameRepo, runs] of [[false, [] as { status: string }[]], [true, undefined]] as const) {
      const { seam, slept } = fakeSeam({ labelRuns: async () => runs });
      expect((await requireReviewed({ ...event, sameRepo }, seam, { pollMs: 5, timeoutMs: 100 })).ok).toBe(true);
      expect(slept).toEqual([]);
    }
  });
});

describe("reviewGate", () => {
  it("passes a PR with the reviewed label", () => {
    expect(reviewGate(["x", "reviewed"], undefined)).toEqual({ ok: true, via: "reviewed" });
  });

  it("fails a PR with neither label, naming how to get one", () => {
    const gate = reviewGate(["x"], undefined);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("no 'reviewed' label");
  });

  it("passes a docs-only PR whose every changed file is a doc", () => {
    expect(reviewGate(["docs-only"], ["planning/parallel-sessions.md", "docs/agents/x.txt"])).toEqual({ ok: true, via: "docs-only" });
  });

  it("fails a docs-only PR that changes a file that is not a doc, naming it", () => {
    const gate = reviewGate(["docs-only"], ["README.md", "scripts/queue-pr.ts"]);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("scripts/queue-pr.ts");
  });

  it("fails a docs-only PR whose changed files could not be listed", () => {
    expect(reviewGate(["docs-only"], undefined).ok).toBe(false);
  });

  it("prefers reviewed when both labels are there, even with code changes", () => {
    expect(reviewGate(["docs-only", "reviewed"], ["scripts/queue-pr.ts"])).toEqual({ ok: true, via: "reviewed" });
  });
});
