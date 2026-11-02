import { describe, expect, it } from "vitest";
import { prStatus, prStatusMain, type PrGit, type PrStatusSeam } from "./pr-status.ts";
import type { Gh } from "./orch-status.ts";
import { stampLine } from "./verify-gate.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

const repoJson = JSON.stringify({ owner: { login: "Rabaed" }, name: "rabaedV2.0" });
const queueJson = (nodes: { position: number; state: string; pr: number }[]) =>
  JSON.stringify({ data: { repository: { mergeQueue: { entries: { nodes: nodes.map((n) => ({ position: n.position, state: n.state, pullRequest: { number: n.pr } })) } } } } });

const pull = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ number: 7, headRefName: "RP-1-x", headRefOid: HEAD, isDraft: false, state: "OPEN", labels: [], autoMergeRequest: null, body: "", ...over });

/** gh answering by the longest matching start of `args.join(" ")`; an unknown call throws. */
const fakeGh = (answers: Record<string, string>, calls: string[] = []): Gh => (args) => {
  const joined = args.join(" ");
  calls.push(joined);
  const key = Object.keys(answers)
    .filter((k) => joined.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (key === undefined) throw new Error(`unexpected gh ${joined}`);
  return answers[key]!;
};

const baseAnswers = (over: Record<string, string> = {}): Record<string, string> => ({
  "pr view 7": pull(),
  "repo view": repoJson,
  "api graphql": queueJson([]),
  "api repos/{owner}/{repo}/issues/7/events": "[[]]",
  "api repos/{owner}/{repo}/issues/7/comments": "[[]]",
  "api --paginate --slurp repos/{owner}/{repo}/rules/branches/main": JSON.stringify([[{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "unit" }] } }]]),
  "api repos/{owner}/{repo}/actions/workflows": JSON.stringify({ workflow_runs: [] }),
  ...over,
});

/** A git where `OLD` is the head's first parent through a clean merge of main only when `clean`. */
const fakeGit = (over: Partial<PrGit> = {}): PrGit => ({
  parents: () => [],
  onMain: () => false,
  tree: (c) => `tree-${c}`,
  mergedTree: () => undefined,
  identity: () => ({ author: "a@x", committer: "a@x" }),
  changedPaths: () => [],
  fetchPull: () => {},
  fetchMain: () => {},
  changedFiles: () => ["scripts/x.ts"],
  packageJsonVersions: () => ({ before: undefined, after: undefined }),
  ...over,
});

const seam = (answers: Record<string, string> = {}, git: Partial<PrGit> = {}, calls?: string[]): PrStatusSeam => ({ gh: fakeGh(baseAnswers(answers), calls), git: fakeGit(git) });

describe("prStatus", () => {
  it("reads the head, its state, the implement marker and the queue position", () => {
    const report = prStatus(
      seam({
        "pr view 7": pull({ isDraft: true, body: "Does a thing.\n<!-- implement: RP-1195 -->\n" }),
        "api graphql": queueJson([{ position: 2, state: "AWAITING_CHECKS", pr: 7 }, { position: 1, state: "MERGEABLE", pr: 8 }]),
      }),
      7,
    );
    expect(report).toMatchObject({ pr: 7, head: HEAD, branch: "RP-1-x", draft: true, state: "OPEN", implement: "RP-1195", queue: { position: 2, state: "AWAITING_CHECKS" } });
  });

  it("says the implement marker is missing and the PR is not queued", () => {
    const report = prStatus(seam(), 7);
    expect(report.implement).toBeUndefined();
    expect(report.queue).toBeUndefined();
    expect(report.warnings).toEqual([]);
  });

  it("puts every reviewed and auto-merge switch and every queue entry and exit in the timeline, oldest first, telling CI's bot from a person", () => {
    const ev = (event: string, actor: string, at: string, label?: string) => ({ event, actor: { login: actor }, created_at: at, ...(label ? { label: { name: label } } : {}) });
    // Pages of the --paginate --slurp answer, oldest first as GitHub lists them.
    const events = [
      [ev("labeled", "github-actions[bot]", "2026-11-01T09:00:00Z", "reviewed"), ev("labeled", "mmhaleess90", "2026-11-01T10:00:00Z", "reviewed"), ev("unlabeled", "github-actions[bot]", "2026-11-01T10:05:00Z", "reviewed")],
      [ev("labeled", "mmhaleess90", "2026-11-01T10:06:00Z", "docs-only"), ev("auto_merge_enabled", "mmhaleess90", "2026-11-01T11:00:00Z"), ev("added_to_merge_queue", "mmhaleess90", "2026-11-01T11:00:00Z")],
      [ev("removed_from_merge_queue", "github-merge-queue[bot]", "2026-11-01T11:30:00Z"), ev("auto_merge_disabled", "mmhaleess90", "2026-11-01T12:00:00Z"), ev("head_ref_force_pushed", "mmhaleess90", "2026-11-01T12:01:00Z")],
    ];
    const report = prStatus(seam({ "api repos/{owner}/{repo}/issues/7/events": JSON.stringify(events), "pr view 7": pull({ labels: [{ name: "reviewed" }], autoMergeRequest: { enabledBy: { login: "mmhaleess90" }, enabledAt: "2026-11-01T13:00:00Z" } }) }), 7);
    expect(report.timeline).toEqual([
      { at: "2026-11-01T09:00:00Z", actor: "github-actions[bot]", bot: true, event: "added `reviewed`" },
      { at: "2026-11-01T10:00:00Z", actor: "mmhaleess90", bot: false, event: "added `reviewed` by hand (does not count)" },
      { at: "2026-11-01T10:05:00Z", actor: "github-actions[bot]", bot: true, event: "took `reviewed` off" },
      { at: "2026-11-01T11:00:00Z", actor: "mmhaleess90", bot: false, event: "turned auto-merge on" },
      { at: "2026-11-01T11:00:00Z", actor: "mmhaleess90", bot: false, event: "entered the merge queue" },
      { at: "2026-11-01T11:30:00Z", actor: "github-merge-queue[bot]", bot: true, event: "left the merge queue" },
      { at: "2026-11-01T12:00:00Z", actor: "mmhaleess90", bot: false, event: "turned auto-merge off" },
    ]);
    expect(report.autoMerge).toEqual({ on: true, by: "mmhaleess90", at: "2026-11-01T13:00:00Z" });
    expect(report.enteredByAutoMerge).toBe(true);
    expect(report.reviewed).toBe("reviewed (events lagging, does not count yet)");
  });

  const comment = (login: string, type: string, at: string, body: string) => ({ user: { login, type }, created_at: at, body });
  const permission = (p: string) => JSON.stringify({ permission: p });

  it("finds the review marker on the head, by a person who can push, and puts it in the timeline", () => {
    const comments = [[comment("mmhaleess90", "User", "2026-11-01T08:00:00Z", `Review summary.\n<!-- code-review: ${HEAD} -->`), comment("someone", "User", "2026-11-01T08:30:00Z", "Looks fine.")]];
    const report = prStatus(seam({ "api repos/{owner}/{repo}/issues/7/comments": JSON.stringify(comments), "api repos/{owner}/{repo}/collaborators/mmhaleess90/permission": permission("admin") }), 7);
    expect(report.review).toEqual({ ok: true, commit: HEAD });
    expect(report.markers).toEqual([{ sha: HEAD, login: "mmhaleess90", bot: false, at: "2026-11-01T08:00:00Z", counts: true }]);
    expect(report.timeline).toEqual([{ at: "2026-11-01T08:00:00Z", actor: "mmhaleess90", bot: false, event: `posted the review marker for ${HEAD.slice(0, 7)}` }]);
  });

  it("names the older sha a marker is on, and a bot's marker never counts", () => {
    const comments = [[comment("mmhaleess90", "User", "2026-11-01T08:00:00Z", `<!-- code-review: ${OLD} -->`), comment("github-actions[bot]", "Bot", "2026-11-01T08:10:00Z", `<!-- code-review: ${HEAD} -->`)]];
    const report = prStatus(seam({ "api repos/{owner}/{repo}/issues/7/comments": JSON.stringify(comments), "api repos/{owner}/{repo}/collaborators/mmhaleess90/permission": permission("write") }), 7);
    expect(report.review).toMatchObject({ ok: false });
    expect(report.review && !report.review.ok && report.review.reason).toContain(OLD);
    expect(report.markers.map((m) => [m.sha, m.bot, m.counts])).toEqual([
      [OLD, false, false],
      [HEAD, true, false],
    ]);
  });

  it("passes the gate on a stamped verify line for the head, and lists the stamped shas", () => {
    const body = `${stampLine(`pnpm verify passed on ${HEAD}: lint, unit.`)}\n`;
    const report = prStatus(seam({ "pr view 7": pull({ body }) }), 7);
    expect(report.gate).toEqual({ ok: true, by: `\`pnpm verify\` on ${HEAD}` });
    expect(report.stamped).toEqual([HEAD]);
  });

  const ciRun = (status: string, conclusion: string | null) =>
    JSON.stringify({
      workflow_runs: [{ id: 99, head_sha: HEAD, event: "pull_request", path: ".github/workflows/ci.yml", status, conclusion, repository: { full_name: "Rabaed/rabaedV2.0" }, head_repository: { full_name: "Rabaed/rabaedV2.0" }, pull_requests: [{ number: 7, base: { ref: "main" } }] }],
    });
  const jobs = (status: string, conclusion: string | null) => JSON.stringify({ total_count: 1, jobs: [{ name: "unit", status, conclusion }] });

  it("passes the gate on CI green for the head when the body has no line", () => {
    const report = prStatus(seam({ "api repos/{owner}/{repo}/actions/workflows": ciRun("completed", "success"), "api repos/{owner}/{repo}/actions/runs/99/jobs": jobs("completed", "success") }), 7);
    expect(report.gate).toEqual({ ok: true, by: "CI green (run 99)" });
    expect(report.stamped).toEqual([]);
  });

  it("says CI is still running, with the jobs left", () => {
    const report = prStatus(seam({ "api repos/{owner}/{repo}/actions/workflows": ciRun("in_progress", null), "api repos/{owner}/{repo}/actions/runs/99/jobs": jobs("in_progress", null) }), 7);
    expect(report.gate).toMatchObject({ ok: false });
    expect(report.gate && !report.gate.ok && report.gate.reason).toMatch(/^CI still running on a{40}: 1 job left \(unit\)/);
  });

  it("says CI green does not count for a PR that changes CI's own files", () => {
    const report = prStatus(seam({ "api repos/{owner}/{repo}/actions/workflows": ciRun("completed", "success"), "api repos/{owner}/{repo}/actions/runs/99/jobs": jobs("completed", "success") }, { changedFiles: () => ["vitest.config.ts"] }), 7);
    expect(report.gate && !report.gate.ok && report.gate.reason).toContain("it changes CI's own files (vitest.config.ts)");
  });

  it("needs no verify for a docs-only PR that changes only docs", () => {
    const report = prStatus(seam({ "pr view 7": pull({ labels: [{ name: "docs-only" }] }) }, { changedFiles: () => ["docs/a.md"] }), 7);
    expect(report.gate).toEqual({ ok: true, by: "docs-only: no verify run needed" });
  });

  it("gives the reason when the head's changes cannot be read", () => {
    const report = prStatus(
      seam({}, {
        fetchPull: () => {
          throw new Error("git fetch failed: no network");
        },
      }),
      7,
    );
    expect(report.gate).toEqual({ ok: false, reason: "could not read the head's changes (git fetch failed: no network)" });
  });

  it("says when the PR itself cannot be read", () => {
    const report = prStatus(seam({ "pr view 7": "" }), 7);
    expect(report.head).toBeUndefined();
    expect(report.warnings[0]).toMatch(/^gh could not read PR 7/);
  });

  it("warns, and keeps the rest, when the events cannot be read", () => {
    const report = prStatus(seam({ "api repos/{owner}/{repo}/issues/7/events": "not json" }), 7);
    expect(report.timeline).toEqual([]);
    expect(report.warnings[0]).toMatch(/^the PR's events could not be read/);
    expect(report.head).toBe(HEAD);
  });
});

describe("prStatusMain", () => {
  it("refuses no PR numbers or a bad one, with the usage", () => {
    expect(prStatusMain([], seam())).toEqual({ code: 1, lines: ["Usage: node scripts/pr-status.ts <pr number> [<pr number>...]"] });
    expect(prStatusMain(["7", "x"], seam()).code).toBe(1);
  });

  it("reads the merge queue once for several PRs and prints a block each", () => {
    const calls: string[] = [];
    const answers = { "pr view 8": pull({ number: 8, headRefName: "RP-2-y" }), "api repos/{owner}/{repo}/issues/8/events": "[[]]", "api repos/{owner}/{repo}/issues/8/comments": "[[]]" };
    const result = prStatusMain(["7", "8"], seam(answers, {}, calls));
    expect(result.code).toBe(0);
    expect(calls.filter((c) => c.startsWith("api graphql"))).toHaveLength(1);
    expect(result.lines.filter((l) => l.startsWith("PR #"))).toEqual([`PR #7 RP-1-x (open)  head ${HEAD}`, `PR #8 RP-2-y (open)  head ${HEAD}`]);
  });
});
