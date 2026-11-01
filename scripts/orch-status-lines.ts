/* eslint-disable rabaed/no-avoid-terms -- "queue" here is GitHub's merge queue, by its own name. */
// RP-1197 (item 5): the pure half of `node scripts/orch-status.ts`. The Orchestrator's check-in needs one
// glance at the open PRs, the merge queue, the running stacks and the verifies; this turns already-read
// data into a few lines, and says "nothing to report" when all four are empty so idle rounds can be counted.
import { countedLabels, type PrEvent } from "./reviewed-required.ts";
import { REVIEWED_LABEL } from "./reviewed-label.ts";

/** One entry of `statusCheckRollup`: a check run (`status`, `conclusion`) or a commit status (`state`). */
export type RollupItem = { status?: string; conclusion?: string; state?: string };

/** An open PR as `gh pr list --json` returns it. */
export interface OpenPr {
  number: number;
  headRefName: string;
  headRefOid: string;
  isDraft?: boolean;
  labels?: { name: string }[];
  autoMergeRequest?: { enabledBy?: { login?: string } } | null;
  statusCheckRollup?: RollupItem[] | null;
}

/** One merge queue entry. */
export interface QueueEntry {
  position: number;
  state: string;
  pr: number;
}

/** Everything the report shows; each half is `undefined` when it could not be read, with the reason in `warnings`. */
export interface OrchData {
  prs: OpenPr[];
  /** The PR's `reviewed` label events, by PR number (read only for PRs that carry the label). */
  events: Map<number, PrEvent[]>;
  queue: QueueEntry[];
  /** Running stacks: one text per stack. */
  stacks: string[];
  /** Verifies running now: one text each. */
  running: string[];
  /** Verifies waiting for the machine-wide queue: one text each. */
  waiting: string[];
  warnings: string[];
}

/** green, failed or pending from a PR's checks; none when it has no checks. */
export function ciState(rollup: RollupItem[] | null | undefined): "green" | "failed" | "pending" | "none" {
  if (!rollup || rollup.length === 0) return "none";
  const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
  const OK = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
  let pending = false;
  for (const item of rollup) {
    const verdict = (item.conclusion || item.state || "").toUpperCase();
    if (FAILED.has(verdict)) return "failed";
    if (!OK.has(verdict)) pending = true;
  }
  return pending ? "pending" : "green";
}

/** "reviewed by CI", "reviewed by <person> (by hand)", "reviewed (events lagging)" or "not reviewed". */
export function reviewedText(pr: OpenPr, events: PrEvent[] | undefined): string {
  const names = (pr.labels ?? []).map((l) => l.name);
  if (!names.includes(REVIEWED_LABEL)) return "not reviewed";
  if (!events) return "reviewed (who added it unknown)";
  const counted = countedLabels(names, events);
  if (counted.handLabeler) return `reviewed by ${counted.handLabeler} (by hand, does not count)`;
  if (counted.lagging) return "reviewed (events lagging, does not count yet)";
  return "reviewed by CI bot";
}

/** One line per open PR. */
export function prLine(pr: OpenPr, events: PrEvent[] | undefined, queue: QueueEntry[]): string {
  const entry = queue.find((q) => q.pr === pr.number);
  const auto = pr.autoMergeRequest ? `auto-merge on${pr.autoMergeRequest.enabledBy?.login ? ` (${pr.autoMergeRequest.enabledBy.login})` : ""}` : "auto-merge off";
  const where = entry ? `queue #${entry.position} ${entry.state.toLowerCase()}` : "not queued";
  const draft = pr.isDraft ? " draft" : "";
  return `#${pr.number} ${pr.headRefName}${draft}  head ${pr.headRefOid.slice(0, 7)}  CI ${ciState(pr.statusCheckRollup)}  ${reviewedText(pr, events)}  ${auto}  ${where}`;
}

/** The report. When there is nothing at all, one "nothing to report" line (plus any warnings). */
export function formatOrchStatus(data: OrchData): string[] {
  const idle = data.prs.length === 0 && data.queue.length === 0 && data.stacks.length === 0 && data.running.length === 0 && data.waiting.length === 0;
  const lines: string[] = [];
  if (idle) lines.push("Nothing to report: no open PRs, empty merge queue, no running stacks, no verifies.");
  else {
    lines.push(`Open PRs: ${data.prs.length}.`);
    for (const pr of data.prs) lines.push(prLine(pr, data.events.get(pr.number), data.queue));
    lines.push(data.queue.length === 0 ? "Merge queue: empty." : `Merge queue: ${data.queue.map((q) => `#${q.position} PR ${q.pr} (${q.state.toLowerCase()})`).join(", ")}.`);
    lines.push(data.stacks.length === 0 ? "Running stacks: none." : `Running stacks (${data.stacks.length}): ${data.stacks.join("; ")}.`);
    lines.push(data.running.length === 0 ? "Verifies running: none." : `Verifies running (${data.running.length}): ${data.running.join("; ")}.`);
    lines.push(data.waiting.length === 0 ? "Verifies waiting: none." : `Verifies waiting (${data.waiting.length}): ${data.waiting.join("; ")}.`);
  }
  for (const warning of data.warnings) lines.push(`Warning: ${warning}`);
  return lines;
}
