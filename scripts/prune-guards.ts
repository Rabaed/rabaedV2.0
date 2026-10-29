import { spawnSync } from "node:child_process";
import { holdReason, type Holders } from "./claude-sessions.ts";
import type { Container, KeptProject, StaleProject } from "./lanes.ts";

// RP-1101: the guards worktrees:prune and lanes:prune share, after 2026-10-29's prunes removed
// live work. A session working in a stale project's folder keeps it; lane 7 (the live UAT stack
// behind a Cloudflare Tunnel) is never a candidate, nor `--lane 7`; a bare `lanes:prune --merged
// --yes` is refused (RP-1007: it removed other Mains' live stacks); a shallow clone, whose missing
// history makes merged branches look unmerged and the other way round, is refused; and what was
// kept is printed last, so `| tail` does not cut the reasons off.

/** The lanes no prune ever removes: lane 7 is Main 7's live UAT stack behind a Cloudflare Tunnel. */
const PROTECTED: Record<string, string> = {
  "rabaed-lane7": "lane 7 is the live UAT stack behind a Cloudflare Tunnel; no prune touches it (ask the Orchestrator)",
};

/** Why a prune never removes this compose project, or undefined. */
export const protectedLaneReason = (project: string | undefined): string | undefined => (project === undefined ? undefined : PROTECTED[project]);

/** The candidates without the protected lanes, which are kept with their reason and first folder. */
export function splitProtected<P extends StaleProject>(candidates: P[], containers: Container[]): { prune: P[]; kept: KeptProject[] } {
  const prune: P[] = [];
  const kept: KeptProject[] = [];
  for (const c of candidates) {
    const reason = protectedLaneReason(c.project);
    if (reason === undefined) prune.push(c);
    else kept.push({ project: c.project, path: containers.find((x) => x.project === c.project)?.workingDir ?? "no folder", reason });
  }
  return { prune, kept };
}

/** lanes:prune `--lane N` refused for a protected lane, or undefined. */
export const laneRefusal = (lane: number | undefined): string | undefined =>
  lane === undefined ? undefined : PROTECTED[`rabaed-lane${lane}`] && `lanes:prune refused: ${PROTECTED[`rabaed-lane${lane}`]}.`;

/** RP-1007: `lanes:prune --merged --yes` with no `--lane N` (and not a dry run) is refused. */
export const bareMergedYesRefusal = (options: { merged: boolean; yes: boolean; dryRun: boolean; lane?: number }): string | undefined =>
  options.merged && options.yes && !options.dryRun && options.lane === undefined
    ? "lanes:prune refused: `--merged --yes` needs `--lane N` (RP-1007: a bare one removed other Mains' live stacks). Prune your own lane with `--lane N`, or drop `--yes` to see the list and confirm."
    : undefined;

/**
 * A stale project kept because a running or desktop Claude session works in one of its
 * containers' folders that still exists (a gone folder holds no session; skipping those keeps
 * a session check that cannot run from keeping every orphan). Undefined when none holds it.
 */
export function sessionHeldProject(project: StaleProject, containers: Container[], holders: Holders, exists: (dir: string) => boolean, options?: { sinceListed?: boolean }): KeptProject | undefined {
  const dirs = [...new Set(containers.filter((c) => c.project === project.project).map((c) => c.workingDir))].filter(exists);
  for (const path of dirs) {
    const reason = holdReason(path, holders, options);
    if (reason !== undefined) return { project: project.project, path, reason };
  }
  return undefined;
}

/** Whether the clone at cwd is shallow (`git rev-parse --is-shallow-repository`); a git that cannot tell counts as shallow. */
export function isShallowRepo(cwd: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-shallow-repository"], { cwd, encoding: "utf8" });
  return result.status !== 0 || result.stdout.trim() !== "false";
}

/** A prune refused on a shallow clone, or undefined. */
export const shallowRefusal = (shallow: boolean, command: string): string | undefined =>
  shallow
    ? `${command} refused: this clone is shallow, so merged branches can look unmerged and the other way round. Run \`git fetch --unshallow origin\` in the main folder, then re-run.`
    : undefined;

/** The kept items with their reasons, as a prune's last lines (nothing when none was kept). */
export const keptLast = (kept: { what: string; reason: string }[]): string[] =>
  kept.length === 0 ? [] : ["Kept, with why (printed last):", ...kept.map((k) => `  ${k.what}: ${k.reason}`)];
