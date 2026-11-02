/* eslint-disable rabaed/no-avoid-terms -- GitHub's merge queue, by its own name */
// RP-1195 item 2: the pure half of `node scripts/pr-status.ts`: a `prStatus` report as lines. `timelineLines` is
// shared with `review:pr` (item 5), which prints the same timeline.
import type { PrReport, TimelineItem } from "./pr-status.ts";

/** One line per timeline item: time, who (bot or person), what. */
export const timelineLines = (timeline: TimelineItem[]): string[] => timeline.map((t) => `${t.at}  ${t.actor} (${t.bot ? "bot" : "person"})  ${t.event}`);

/** The block for one PR. */
export function formatPrStatus(report: PrReport): string[] {
  const warnings = report.warnings.map((w) => `  Warning: ${w}`);
  if (report.head === undefined) return [`PR #${report.pr}: could not be read.`, ...warnings];
  const head = report.head;
  const state = [(report.state ?? "unknown").toLowerCase(), ...(report.draft ? ["draft"] : [])].join(", ");
  const gate = report.gate === undefined ? "unknown" : report.gate.ok ? `passes on ${report.gate.by}` : `does not pass: ${report.gate.reason}`;
  const stamped = report.stamped && report.stamped.length > 0 ? report.stamped.join(", ") : "none";
  const review =
    report.review === undefined ? "unknown" : !report.review.ok ? `none counts: ${report.review.reason}` : head.startsWith(report.review.commit) ? `on the head ${head}` : `on ${report.review.commit}, which only clean commits led to the head from`;
  const auto = report.autoMerge?.on ? `on${report.autoMerge.by ? `, by ${report.autoMerge.by}` : ""}${report.autoMerge.at ? ` at ${report.autoMerge.at}` : ""}` : "off";
  const queue = report.queue ? `#${report.queue.position} (${report.queue.state.toLowerCase()})` : "not queued";
  const byAuto = report.enteredByAutoMerge ? "; auto-merge did its last entry" : "";
  return [
    `PR #${report.pr} ${report.branch ?? ""} (${state})  head ${head}`,
    `  Verify gate: ${gate}. Stamped verify lines: ${stamped}.`,
    `  Review marker: ${review}.`,
    `  Label: ${report.reviewed ?? "unknown"}.`,
    `  Auto-merge: ${auto}.`,
    `  Implement marker: ${report.implement ?? "missing"}.`,
    `  Merge queue: ${queue}${byAuto}.`,
    ...(report.timeline.length === 0 ? ["  Timeline: nothing yet."] : ["  Timeline:", ...timelineLines(report.timeline).map((l) => `    ${l}`)]),
    ...warnings,
  ];
}
