import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { overHttp, queuedPrNumber, REQUIRED_CHECK, requiredEvent, requireReviewed, reviewGate, type PrEvent, type RequiredSeam } from "./reviewed-required.ts";

// Each made-up event is one second after the one before, as GitHub lists them, oldest first.
let clock = 0;
const tick = () => new Date(Date.UTC(2026, 9, 31, 10, 0, clock++)).toISOString().replace(".000Z", "Z");
/** The PR's issue events when each login in turn added `reviewed`. */
const labeledBy = (...logins: string[]): PrEvent[] => logins.map((actor) => ({ event: "labeled", label: "reviewed", actor, createdAt: tick() }));
const eventBy = (event: string, createdAt = tick()): PrEvent => ({ event, actor: "mmhaleess90", createdAt });

// The workflow the main ruleset requires: the queue must get the same check name as the PR.
// It lands in its own PR after this script (rule 3, and it runs main's copy of the script), so these wait for it.
const workflowPath = join(dirname(import.meta.filename), "..", ".github", "workflows", "reviewed-required.yml");
describe.skipIf(!existsSync(workflowPath))("reviewed-required.yml", () => {
  // A skipped describe still runs its body, so read only when the file is there.
  const source = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "jobs: {}";
  const wf = parse(source) as {
    on: Record<string, { types?: string[] } | null>;
    jobs: Record<string, { name?: string; if?: string; permissions?: Record<string, string>; steps: { uses?: string; with?: Record<string, unknown>; run?: string }[] }>;
  };
  const jobs = Object.values(wf.jobs);
  const types = wf.on.pull_request?.types ?? [];

  it("runs on every PR event that can change the answer, and on merge_group", () => {
    expect(wf.on).toEqual({ pull_request: { types: expect.arrayContaining(["opened", "reopened", "synchronize", "labeled", "unlabeled"]) }, merge_group: null });
  });

  // The draft events land in the workflow's own PR after this script (rule 3, RP-1018), so this waits for them.
  it.skipIf(!types.includes("ready_for_review"))("re-runs when a draft is marked ready, and when a PR goes back to draft (RP-1018)", () => {
    expect(types).toEqual(["opened", "reopened", "synchronize", "labeled", "unlabeled", "ready_for_review", "converted_to_draft"]);
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
  it("reads a pull_request event: number, head, whether the head is this repository's, and whether it is a draft", () => {
    const payload = { pull_request: { number: 7, draft: false, head: { sha: "h", repo: { full_name: "Rabaed/rabaedV2.0" } } } };
    expect(requiredEvent("pull_request", payload, "Rabaed/rabaedV2.0")).toEqual({ kind: "pull_request", pr: 7, headSha: "h", sameRepo: true, draft: false });
    expect(requiredEvent("pull_request", payload, "Other/repo")).toMatchObject({ sameRepo: false });
    expect(requiredEvent("pull_request", { pull_request: { ...payload.pull_request, draft: true } }, "Rabaed/rabaedV2.0")).toMatchObject({ draft: true });
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
    expect(await github.pull(9)).toEqual({ labels: ["reviewed"], changedFiles: 4, draft: false });
    expect(urls).toEqual(["https://api.github.com/repos/o/r/pulls/9"]);
  });

  it("reads who turned GitHub auto-merge on", async () => {
    const { github } = recorded(() => ({ status: 200, body: { labels: [], changed_files: 1, auto_merge: { enabled_by: { login: "mmhaleess90" }, merge_method: "merge" } } }));
    expect((await github.pull(9)).autoMergeBy).toBe("mmhaleess90");
    const off = recorded(() => ({ status: 200, body: { labels: [], changed_files: 1, auto_merge: null } }));
    expect((await off.github.pull(9)).autoMergeBy).toBeUndefined();
  });

  it("reads whether the PR is a draft now", async () => {
    expect((await recorded(() => ({ status: 200, body: { labels: [], changed_files: 1, draft: true } })).github.pull(9)).draft).toBe(true);
    expect((await recorded(() => ({ status: 200, body: { labels: [], changed_files: 1 } })).github.pull(9)).draft).toBe(false);
  });

  it("lists the PR's issue events, oldest first, with their times, across pages", async () => {
    const at = "2026-10-31T10:03:14Z";
    const labeled = (login: string, name = "reviewed") => ({ event: "labeled", label: { name }, actor: { login }, created_at: at });
    const firstPage = [labeled("mmhaleess90"), { event: "auto_merge_enabled", actor: { login: "mmhaleess90" }, created_at: at }, ...Array.from({ length: 98 }, () => labeled("x", "docs-only"))];
    const { urls, github } = recorded((url) => ({ status: 200, body: url.endsWith("page=1") ? firstPage : [labeled("github-actions[bot]"), { event: "commented", actor: { login: "y" }, created_at: at }] }));
    const events = await github.events(9);
    expect(events).toHaveLength(102);
    expect(events.slice(0, 2)).toEqual([
      { event: "labeled", label: "reviewed", actor: "mmhaleess90", createdAt: at },
      { event: "auto_merge_enabled", actor: "mmhaleess90", createdAt: at },
    ]);
    expect(events.at(-2)).toEqual({ event: "labeled", label: "reviewed", actor: "github-actions[bot]", createdAt: at });
    expect(urls).toEqual(["https://api.github.com/repos/o/r/issues/9/events?per_page=100&page=1", "https://api.github.com/repos/o/r/issues/9/events?per_page=100&page=2"]);
  });

  it("names a deleted user as GitHub's ghost, so their label still counts as a hand label", async () => {
    const { github } = recorded(() => ({ status: 200, body: [{ event: "labeled", label: { name: "reviewed" }, actor: null, created_at: "2026-10-31T10:00:00Z" }] }));
    expect(await github.events(9)).toEqual([{ event: "labeled", label: "reviewed", actor: "ghost", createdAt: "2026-10-31T10:00:00Z" }]);
  });

  it("throws rather than judge a PR whose events run past the last page it reads: the newest could be cut off", async () => {
    const full = Array.from({ length: 100 }, () => ({ event: "commented", actor: { login: "y" } }));
    await expect(recorded(() => ({ status: 200, body: full })).github.events(9)).rejects.toThrow(/3000/);
  });

  it("pages through the changed files until a short page", async () => {
    const { urls, github } = recorded((url) => ({ status: 200, body: url.endsWith("page=1") ? Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}` })) : [{ filename: "last" }] }));
    const files = await github.files(9);
    expect(files).toHaveLength(101);
    expect(files.at(-1)).toBe("last");
    expect(urls).toEqual(["https://api.github.com/repos/o/r/pulls/9/files?per_page=100&page=1", "https://api.github.com/repos/o/r/pulls/9/files?per_page=100&page=2"]);
  });

  it("counts a renamed file's old path too, so x.ts renamed to x.md is not docs-only", async () => {
    const { github } = recorded(() => ({ status: 200, body: [{ filename: "x.md", previous_filename: "x.ts" }, { filename: "docs/a.md" }] }));
    const files = await github.files(9);
    expect(files).toEqual(["x.md", "x.ts", "docs/a.md"]);
    expect(reviewGate(["docs-only"], files).ok).toBe(false);
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
    events: async () => labeledBy("github-actions[bot]"),
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

  it("drops a PR that entered the queue through GitHub auto-merge: only `pnpm queue` enqueues (RP-1167, #531)", async () => {
    const { seam } = fakeSeam({ pull: async () => ({ labels: ["reviewed"], changedFiles: 3, autoMergeBy: "mmhaleess90" }) });
    expect((await requireReviewed(event, seam)).ok).toBe(false);
  });

  it("drops a PR that GitHub auto-merge put in the queue, even with auto-merge off by now (#564)", async () => {
    const events = [...labeledBy("github-actions[bot]"), eventBy("auto_merge_enabled"), eventBy("added_to_merge_queue"), eventBy("auto_merge_disabled")];
    const { seam } = fakeSeam({ events: async () => events });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("auto-merge");
    expect(result.summary).toContain("pnpm queue 12");
  });

  it("keeps a PR queued by `pnpm queue` after auto-merge was turned on and off earlier: only how it entered the queue counts", async () => {
    const events = [eventBy("auto_merge_enabled"), eventBy("auto_merge_disabled"), ...labeledBy("github-actions[bot]"), eventBy("added_to_merge_queue")];
    const { seam } = fakeSeam({ events: async () => events });
    expect((await requireReviewed(event, seam)).ok).toBe(true);
  });

  it("judges the latest time it entered the queue: auto-merge's first entry, then a `pnpm queue` one, passes", async () => {
    const events = [eventBy("auto_merge_enabled"), eventBy("added_to_merge_queue"), eventBy("removed_from_merge_queue"), eventBy("auto_merge_disabled"), ...labeledBy("github-actions[bot]"), eventBy("added_to_merge_queue")];
    const { seam } = fakeSeam({ events: async () => events });
    expect((await requireReviewed(event, seam)).ok).toBe(true);
  });

  it("fails closed when GitHub lists no queue entry yet but auto-merge was last turned on", async () => {
    const onNoEntry = fakeSeam({ events: async () => [...labeledBy("github-actions[bot]"), eventBy("auto_merge_enabled")] });
    expect((await requireReviewed(event, onNoEntry.seam)).ok).toBe(false);
    const offNoEntry = fakeSeam({ events: async () => [eventBy("auto_merge_enabled"), eventBy("auto_merge_disabled"), ...labeledBy("github-actions[bot]")] });
    expect((await requireReviewed(event, offNoEntry.seam)).ok).toBe(true);
  });

  it("counts an auto-merge enable in the same second as the queue entry as coming before it, whatever order GitHub lists them in", async () => {
    const second = "2026-10-31T11:00:00Z";
    const events = [...labeledBy("github-actions[bot]"), eventBy("added_to_merge_queue", second), eventBy("auto_merge_enabled", second)];
    const { seam } = fakeSeam({ events: async () => events });
    expect((await requireReviewed(event, seam)).ok).toBe(false);
  });

  it("tells a queued PR whose events lag the label to queue again, since the queue has dropped it", async () => {
    const { seam } = fakeSeam({ events: async () => [] });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("pnpm queue 12");
  });

  it("keeps #578: a dequeue ends auto-merge with no auto_merge_disabled event, so its later `pnpm queue` entry passes", async () => {
    const events = [
      ...labeledBy("github-actions[bot]"),
      eventBy("auto_merge_enabled", "2026-10-31T15:47:50Z"),
      eventBy("added_to_merge_queue", "2026-10-31T15:52:11Z"),
      eventBy("removed_from_merge_queue", "2026-10-31T15:52:40Z"),
      eventBy("added_to_merge_queue", "2026-10-31T15:53:38Z"),
    ];
    const { seam } = fakeSeam({ events: async () => events });
    expect(await requireReviewed(event, seam)).toMatchObject({ ok: true });
  });

  it("still drops a PR that auto-merge queued again after a dequeue: a new enable after the removal counts", async () => {
    const events = [...labeledBy("github-actions[bot]"), eventBy("auto_merge_enabled"), eventBy("added_to_merge_queue"), eventBy("removed_from_merge_queue"), eventBy("auto_merge_enabled"), eventBy("added_to_merge_queue")];
    const { seam } = fakeSeam({ events: async () => events });
    expect((await requireReviewed(event, seam)).ok).toBe(false);
  });

  it("still drops a PR re-queued while auto-merge stays on after a dequeue: the live auto-merge check catches it", async () => {
    const events = [...labeledBy("github-actions[bot]"), eventBy("auto_merge_enabled"), eventBy("added_to_merge_queue"), eventBy("removed_from_merge_queue"), eventBy("added_to_merge_queue")];
    const { seam } = fakeSeam({ events: async () => events, pull: async () => ({ labels: ["reviewed"], changedFiles: 3, autoMergeBy: "mmhaleess90" }) });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("auto-merge is on");
  });

  it("still drops a PR that auto-merge re-queued after a drop and switched off in the same second: that disable shows auto-merge did the enqueue", async () => {
    const second = "2026-10-31T16:00:00Z";
    const events = [...labeledBy("github-actions[bot]"), eventBy("auto_merge_enabled"), eventBy("added_to_merge_queue"), eventBy("removed_from_merge_queue"), eventBy("added_to_merge_queue", second), eventBy("auto_merge_disabled", second)];
    const { seam } = fakeSeam({ events: async () => events });
    expect((await requireReviewed(event, seam)).ok).toBe(false);
  });

  it("still drops a PR whose auto-merge GitHub turned off in the same second it queued it (#564's shape)", async () => {
    const events = [...labeledBy("github-actions[bot]"), eventBy("auto_merge_enabled", "2026-10-31T10:59:00Z"), eventBy("added_to_merge_queue", "2026-10-31T11:00:00Z"), eventBy("auto_merge_disabled", "2026-10-31T11:00:00Z")];
    const { seam } = fakeSeam({ events: async () => events });
    expect((await requireReviewed(event, seam)).ok).toBe(false);
  });

  it("drops it too when the enable is listed just before the entry in the same second", async () => {
    const second = "2026-10-31T11:00:00Z";
    const events = [...labeledBy("github-actions[bot]"), eventBy("auto_merge_enabled", second), eventBy("added_to_merge_queue", second)];
    const { seam } = fakeSeam({ events: async () => events });
    expect((await requireReviewed(event, seam)).ok).toBe(false);
  });

  it("does not count an enable a second after the entry as the cause of it: auto-merge turned on later is the live check's job", async () => {
    const events = [...labeledBy("github-actions[bot]"), eventBy("added_to_merge_queue", "2026-10-31T11:00:00Z"), eventBy("auto_merge_enabled", "2026-10-31T11:00:01Z")];
    const { seam } = fakeSeam({ events: async () => events });
    expect((await requireReviewed(event, seam)).ok).toBe(true);
  });

  it("reads the PR's events once for both the queue entry and the label", async () => {
    let reads = 0;
    const { seam } = fakeSeam({ events: async () => (reads++, labeledBy("github-actions[bot]")) });
    expect((await requireReviewed(event, seam)).ok).toBe(true);
    expect(reads).toBe(1);
  });

  it("drops a PR turned back to draft while queued: draft does not leave the queue (#564)", async () => {
    const { seam } = fakeSeam({ pull: async () => ({ labels: ["reviewed"], changedFiles: 3, draft: true }) });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("draft");
  });

  it("drops a queued PR whose reviewed label was added by hand (RP-1167)", async () => {
    const { seam } = fakeSeam({ pull: async () => ({ labels: ["reviewed"], changedFiles: 3 }), events: async () => labeledBy("mmhaleess90") });
    expect((await requireReviewed(event, seam)).ok).toBe(false);
  });

  it("fails a queued PR without the label, so the queue drops it", async () => {
    const { seam } = fakeSeam({ pull: async () => ({ labels: [], changedFiles: 3 }) });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("PR #12");
    // CI adds `reviewed` (RP-1118); the fix never says to add it by hand (RP-1167).
    expect(result.summary).toContain("node scripts/review-post.ts 12");
    expect(result.summary).not.toContain("--add-label reviewed");
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
  const event = { kind: "pull_request" as const, pr: 7, headSha: "head1", sameRepo: true, draft: false };

  it("passes a draft with a note, without waiting or reading its labels: it is checked when marked ready (RP-1018)", async () => {
    const { seam, slept } = fakeSeam({
      pull: async () => expect.unreachable("a draft's labels are not read"),
      labelRuns: async () => expect.unreachable("a draft does not wait for the reviewed-label run"),
    });
    const result = await requireReviewed({ ...event, draft: true }, seam);
    expect(result).toEqual({ ok: true, summary: "PR #7 is a draft: checked when marked ready." });
    expect(slept).toEqual([]);
  });

  it("checks a ready PR as before: no label fails (the run for ready_for_review)", async () => {
    const { seam } = fakeSeam({ pull: async () => ({ labels: [], changedFiles: 1 }) });
    expect((await requireReviewed(event, seam)).ok).toBe(false);
  });

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

  it("passes when the reviewed-label run finishes after 12 minutes (a busy CI waits that long for a runner, RP-984)", async () => {
    let polls = 0;
    const { seam, slept } = fakeSeam({ labelRuns: async () => (polls++ * 10 < 12 * 60 ? [{ status: "queued" }] : [{ status: "completed" }]) });
    expect((await requireReviewed(event, seam)).ok).toBe(true);
    expect(slept.reduce((a, b) => a + b, 0)).toBe(12 * 60_000);
  });

  it("gives up after 1500 s by default, naming the wait", async () => {
    const { seam, slept } = fakeSeam({ labelRuns: async () => [{ status: "in_progress" }] });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("within 1500 s");
    expect(slept.reduce((a, b) => a + b, 0)).toBe(1_500_000);
  });

  it("fails a PR whose reviewed label was added by hand, saying who added it and why it does not count (RP-1167)", async () => {
    const { seam } = fakeSeam({ events: async () => labeledBy("mmhaleess90") });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("mmhaleess90");
    expect(result.summary).toContain("github-actions[bot]");
    expect(result.summary).not.toContain("--add-label reviewed");
  });

  it("passes a reviewed label that CI's reviewed-add added (RP-1167)", async () => {
    const { seam } = fakeSeam({ events: async () => labeledBy("github-actions[bot]") });
    expect(await requireReviewed(event, seam)).toMatchObject({ ok: true });
  });

  it("judges the label by whoever added it last: a hand label after CI's fails, CI's after a hand label passes", async () => {
    const handLast = fakeSeam({ events: async () => labeledBy("github-actions[bot]", "mmhaleess90") });
    expect((await requireReviewed(event, handLast.seam)).ok).toBe(false);
    const ciLast = fakeSeam({ events: async () => labeledBy("mmhaleess90", "github-actions[bot]") });
    expect((await requireReviewed(event, ciLast.seam)).ok).toBe(true);
  });

  it("fails closed, saying to re-run, while GitHub's events lag the label: no labeled event yet", async () => {
    const { seam } = fakeSeam({ events: async () => labeledBy() });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/not caught up.*re-run/i);
  });

  it("fails closed, saying to re-run, when the newest reviewed event is an unlabeled though the label is there", async () => {
    const events = [...labeledBy("github-actions[bot]"), { ...eventBy("unlabeled"), label: "reviewed" }];
    const { seam } = fakeSeam({ events: async () => events });
    const result = await requireReviewed(event, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/not caught up.*re-run/i);
  });

  it("counts CI's label when the newest reviewed event is CI's labeled, after an earlier unlabeled", async () => {
    const events = [...labeledBy("github-actions[bot]"), { ...eventBy("unlabeled"), label: "reviewed" }, ...labeledBy("github-actions[bot]")];
    const { seam } = fakeSeam({ events: async () => events });
    expect((await requireReviewed(event, seam)).ok).toBe(true);
  });

  it("ignores other labels' events when judging reviewed", async () => {
    const events = [...labeledBy("github-actions[bot]"), { ...eventBy("unlabeled"), label: "docs-only" }];
    const { seam } = fakeSeam({ events: async () => events });
    expect((await requireReviewed(event, seam)).ok).toBe(true);
  });

  it("still passes a docs-only PR that also has a hand-added reviewed label: docs-only is unchanged", async () => {
    const { seam } = fakeSeam({ pull: async () => ({ labels: ["reviewed", "docs-only"], changedFiles: 1 }), files: async () => ["docs/a.md"], events: async () => labeledBy("mmhaleess90") });
    expect(await requireReviewed(event, seam)).toMatchObject({ ok: true, summary: expect.stringContaining("docs-only") });
  });

  it("fails while GitHub auto-merge is on, even with CI's reviewed label or docs-only, saying how to turn it off (RP-1167)", async () => {
    for (const labels of [["reviewed"], ["docs-only"]]) {
      const { seam } = fakeSeam({ pull: async () => ({ labels, changedFiles: 1, autoMergeBy: "mmhaleess90" }) });
      const result = await requireReviewed(event, seam);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain("auto-merge");
      expect(result.summary).toContain("gh pr merge 7 --disable-auto");
      expect(result.summary).toContain("pnpm queue 7");
      // Turning it off starts no run of this check (reviewed-required.yml has no auto_merge_disabled).
      expect(result.summary).toContain("re-run this check");
    }
  });

  it("tells a fork's PR that only docs-only can pass it: reviewed-add never labels a fork", async () => {
    const { seam } = fakeSeam({ pull: async () => ({ labels: [], changedFiles: 1 }) });
    const result = await requireReviewed({ ...event, sameRepo: false }, seam);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("fork");
    expect(result.summary).not.toContain("review-post.ts");
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
