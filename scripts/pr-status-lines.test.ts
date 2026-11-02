import { describe, expect, it } from "vitest";
import { formatPrStatus, timelineLines } from "./pr-status-lines.ts";
import type { PrReport } from "./pr-status.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

const report = (over: Partial<PrReport> = {}): PrReport => ({
  pr: 7,
  head: HEAD,
  branch: "RP-1-x",
  draft: false,
  state: "OPEN",
  gate: { ok: true, by: "CI green (run 99)" },
  stamped: [],
  markers: [{ sha: HEAD, login: "mmhaleess90", bot: false, at: "2026-11-01T08:00:00Z", counts: true }],
  review: { ok: true, commit: HEAD },
  reviewed: "reviewed by CI bot",
  autoMerge: { on: false },
  timeline: [],
  warnings: [],
  ...over,
});

describe("formatPrStatus", () => {
  it("prints one block per PR with every part the gate reads", () => {
    expect(formatPrStatus(report())).toEqual([
      `PR #7 RP-1-x (open)  head ${HEAD}`,
      "  Verify gate: passes on CI green (run 99). Stamped verify lines: none.",
      `  Review marker: on the head ${HEAD}.`,
      "  Label: reviewed by CI bot.",
      "  Auto-merge: off.",
      "  Implement marker: missing.",
      "  Merge queue: not queued.",
      "  Timeline: nothing yet.",
    ]);
  });

  it("says why the gate and the review marker fail, and prints the queue, auto-merge, marker and timeline", () => {
    const lines = formatPrStatus(
      report({
        draft: true,
        gate: { ok: false, reason: "its body has no line" },
        stamped: [OLD],
        review: { ok: false, reason: `its /code-review comments name ${OLD}` },
        autoMerge: { on: true, by: "mmhaleess90", at: "2026-11-01T13:00:00Z" },
        enteredByAutoMerge: true,
        implement: "RP-1195",
        queue: { position: 2, state: "AWAITING_CHECKS" },
        timeline: [{ at: "2026-11-01T10:00:00Z", actor: "mmhaleess90", bot: false, event: "added `reviewed` by hand (does not count)" }],
        warnings: ["the PR's events could not be read (x)."],
      }),
    );
    expect(lines).toEqual([
      `PR #7 RP-1-x (open, draft)  head ${HEAD}`,
      `  Verify gate: does not pass: its body has no line. Stamped verify lines: ${OLD}.`,
      `  Review marker: none counts: its /code-review comments name ${OLD}.`,
      "  Label: reviewed by CI bot.",
      "  Auto-merge: on, by mmhaleess90 at 2026-11-01T13:00:00Z.",
      "  Implement marker: RP-1195.",
      "  Merge queue: #2 (awaiting_checks); auto-merge did its last entry.",
      "  Timeline:",
      "    2026-11-01T10:00:00Z  mmhaleess90 (person)  added `reviewed` by hand (does not count)",
      "  Warning: the PR's events could not be read (x).",
    ]);
  });

  it("names the older commit a counted marker is on", () => {
    expect(formatPrStatus(report({ review: { ok: true, commit: OLD } }))).toContain(`  Review marker: on ${OLD}, which only clean commits led to the head from.`);
  });

  it("prints only the warning for a PR that could not be read", () => {
    expect(formatPrStatus({ pr: 9, markers: [], timeline: [], warnings: ["gh could not read PR 9 (no such PR)."] })).toEqual(["PR #9: could not be read.", "  Warning: gh could not read PR 9 (no such PR)."]);
  });
});

describe("timelineLines", () => {
  it("marks bots as bots", () => {
    expect(timelineLines([{ at: "t", actor: "github-actions[bot]", bot: true, event: "added `reviewed`" }])).toEqual(["t  github-actions[bot] (bot)  added `reviewed`"]);
  });
});
