import { describe, expect, it } from "vitest";
import { gather, orchStatus, type Gh, type LocalSeam } from "./orch-status.ts";
import { ciState, formatOrchStatus, type OpenPr, type OrchData } from "./orch-status-lines.ts";

const pr = (over: Partial<OpenPr> = {}): OpenPr => ({ number: 7, headRefName: "RP-1-x", headRefOid: "abcdef1234567890", labels: [], autoMergeRequest: null, statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }], ...over });
const empty = (): OrchData => ({ prs: [], events: new Map(), queue: [], stacks: [], running: [], waiting: [], warnings: [] });

describe("ciState", () => {
  it("is green, pending, failed or none", () => {
    expect(ciState([{ conclusion: "SUCCESS" }, { conclusion: "SKIPPED" }])).toBe("green");
    expect(ciState([{ conclusion: "SUCCESS" }, { status: "IN_PROGRESS", conclusion: "" }])).toBe("pending");
    expect(ciState([{ state: "PENDING" }])).toBe("pending");
    expect(ciState([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }, { status: "QUEUED" }])).toBe("failed");
    expect(ciState([])).toBe("none");
    expect(ciState(null)).toBe("none");
  });
});

describe("formatOrchStatus", () => {
  it("prints one nothing-to-report line when everything is empty", () => {
    expect(formatOrchStatus(empty())).toEqual(["Nothing to report: no open PRs, empty merge queue, no running stacks, no verifies."]);
  });

  it("is not idle when only a verify waits", () => {
    const lines = formatOrchStatus({ ...empty(), waiting: ["pid 9"] });
    expect(lines.join("\n")).not.toContain("Nothing to report");
    expect(lines.join("\n")).toContain("Verifies waiting (1): pid 9.");
  });

  it("gives one line per PR with head, CI, reviewed actor, auto-merge and queue position", () => {
    const events = new Map([[7, [{ event: "labeled", label: "reviewed", actor: "github-actions[bot]", createdAt: "t" }]]]);
    const lines = formatOrchStatus({
      ...empty(),
      prs: [pr({ labels: [{ name: "reviewed" }], autoMergeRequest: { enabledBy: { login: "me" } } }), pr({ number: 8, headRefName: "RP-2-y", headRefOid: "1111111999" })],
      events,
      queue: [{ position: 1, state: "AWAITING_CHECKS", pr: 7 }],
      stacks: ["rabaed-lane11"],
    });
    expect(lines[1]).toBe("#7 RP-1-x  head abcdef1  CI green  reviewed by CI bot  auto-merge on (me)  queue #1 awaiting_checks");
    expect(lines[2]).toBe("#8 RP-2-y  head 1111111  CI green  not reviewed  auto-merge off  not queued");
    expect(lines).toContain("Merge queue: #1 PR 7 (awaiting_checks).");
    expect(lines).toContain("Running stacks (1): rabaed-lane11.");
  });

  it("names a person who added reviewed by hand, the input most likely to pass for a bot", () => {
    const events = new Map([[7, [{ event: "labeled", label: "reviewed", actor: "mmhaleess90", createdAt: "t" }]]]);
    const text = formatOrchStatus({ ...empty(), prs: [pr({ labels: [{ name: "reviewed" }] })], events }).join("\n");
    expect(text).toContain("reviewed by mmhaleess90 (by hand, does not count)");
  });
});

describe("gather and orchStatus", () => {
  const local = (over: Partial<LocalSeam> = {}): LocalSeam => ({ stacks: () => [], verifies: () => ({ runs: [] }), ...over });
  const fakeGh = (answers: Record<string, string>): Gh => (args) => {
    const key = Object.keys(answers).find((k) => args.join(" ").startsWith(k));
    if (!key) throw new Error(`unexpected gh ${args.join(" ")}`);
    return answers[key]!;
  };
  const queueJson = JSON.stringify({ data: { repository: { mergeQueue: { entries: { nodes: [{ position: 2, state: "QUEUED", pullRequest: { number: 8 } }, { position: 1, state: "MERGEABLE", pullRequest: { number: 7 } }] } } } } });
  const repoJson = JSON.stringify({ owner: { login: "Rabaed" }, name: "rabaedV2.0" });

  it("reports idle on an empty repo and exits through the one line", () => {
    const gh = fakeGh({ "pr list": "[]", "repo view": repoJson, "api graphql": JSON.stringify({ data: { repository: { mergeQueue: null } } }) });
    expect(orchStatus(gh, local())).toEqual(["Nothing to report: no open PRs, empty merge queue, no running stacks, no verifies."]);
  });

  it("reads the PRs once, the queue sorted, and events only for reviewed PRs", () => {
    const calls: string[] = [];
    const base = fakeGh({
      "pr list": JSON.stringify([pr({ labels: [{ name: "reviewed" }] }), pr({ number: 8 })]),
      "repo view": repoJson,
      "api graphql": queueJson,
      "api repos/{owner}/{repo}/issues/7/events": JSON.stringify([[{ event: "labeled", label: { name: "reviewed" }, actor: { login: "github-actions[bot]" }, created_at: "t" }]]),
    });
    const gh: Gh = (args) => (calls.push(args.join(" ")), base(args));
    const data = gather(gh, local({ stacks: () => ["rabaed-lane11"], verifies: () => ({ runs: [{ where: "G:/wt", holder: { pid: 5, started: new Date(2026, 10, 1, 9, 30), command: "pnpm verify" } }] }) }));
    expect(data.queue.map((q) => q.pr)).toEqual([7, 8]);
    expect(calls.filter((c) => c.startsWith("pr list"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("/events"))).toHaveLength(1);
    expect(data.running[0]).toContain("pid 5");
    expect(data.stacks).toEqual(["rabaed-lane11"]);
  });

  it("fills waiting from the verifies check's waiting runs, so they show and make it not idle", () => {
    const gh = fakeGh({ "pr list": "[]", "repo view": repoJson, "api graphql": JSON.stringify({ data: { repository: { mergeQueue: null } } }) });
    const holder = { pid: 9, started: new Date(2026, 10, 1, 9, 30), command: "pnpm verify" };
    const data = gather(gh, local({ verifies: () => ({ runs: [], waiting: [{ where: "the machine-wide verify line", holder }] }) }));
    expect(data.waiting).toHaveLength(1);
    expect(data.waiting[0]).toContain("pid 9");
    expect(formatOrchStatus(data).join("\n")).toContain("Verifies waiting (1)");
  });

  it("keeps going when gh fails, with warnings, and when Docker does not answer", () => {
    const gh: Gh = () => {
      throw new Error("gh: not logged in");
    };
    const data = gather(gh, local({ stacks: () => undefined, verifies: () => ({ unknown: "git failed" }) }));
    expect(data.warnings).toHaveLength(4);
    expect(formatOrchStatus(data)[0]).toContain("Nothing to report");
  });
});
