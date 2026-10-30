import { holdReason, type Holders } from "./claude-sessions.ts";
import { laneProject, protectedLaneReason, type Container, type KeptProject, type StaleProject, type WorktreeLane } from "./lanes.ts";

// RP-1101: the guards worktrees:prune and lanes:prune share, after 2026-10-29's prunes removed
// live work. A session working in a stale project's folder keeps it; lane 7 (Main 7's harness
// data, lanes.ts protectedLaneReason) is never a candidate, nor `--lane 7`; a bare `lanes:prune --merged
// --yes` is refused (RP-1007: it removed other Mains' live stacks); a shallow clone, whose missing
// history makes merged branches look unmerged and the other way round, is refused; and what was
// kept is printed last, so `| tail` does not cut the reasons off.

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
export const laneRefusal = (lane: number | undefined): string | undefined => {
  const reason = lane === undefined ? undefined : protectedLaneReason(laneProject(lane));
  return reason === undefined ? undefined : `lanes:prune refused: ${reason}.`;
};

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

/**
 * Both prunes' last word on their candidate projects: never a protected lane (splitProtected), nor
 * one whose existing folder a Claude session works in (sessionHeldProject); those are kept, with why.
 */
export function guardCandidates<P extends StaleProject>(candidates: P[], containers: Container[], holders: Holders, exists: (dir: string) => boolean): { prune: P[]; kept: KeptProject[] } {
  const { prune: unprotected, kept } = splitProtected(candidates, containers);
  const prune = unprotected.filter((p) => {
    const held = sessionHeldProject(p, containers, holders, exists);
    if (held !== undefined) kept.push(held);
    return held === undefined;
  });
  return { prune, kept };
}

/** A prune refused on a shallow clone, or undefined. */
export const shallowRefusal = (shallow: boolean, command: string): string | undefined =>
  shallow
    ? `${command} refused: this clone is shallow, so merged branches can look unmerged and the other way round. Run \`git fetch --unshallow origin\` in the main folder, then re-run.`
    : undefined;

/** A dirty worktree's changes for its reason: ": a, b", or ": a, … e and 2 more"; "" when not known. */
export const listedChanges = (changes: string[] | undefined, most = 5): string => {
  if (changes === undefined || changes.length === 0) return "";
  const more = changes.length - most;
  return `: ${changes.slice(0, most).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
};

/** A worktree as lanes:prune --merged judged it (worktrees.ts judgeWorktree), with its uncommitted changes (gitChanges). */
export type JudgedLane = Omit<WorktreeLane, "merged"> & { finished: boolean; changes: string[] };

/**
 * lanes:prune --merged's worktrees: one is merged when finished with nothing uncommitted or
 * untracked (isFinished judges commits only). A finished one with changes keeps its project,
 * which is listed with the files.
 */
export function mergedLanes(judged: JudgedLane[]): { worktrees: WorktreeLane[]; kept: KeptProject[] } {
  const kept: KeptProject[] = [];
  const worktrees = judged.map(({ finished, changes, ...w }) => {
    const dirty = finished && changes.length > 0;
    if (dirty && w.project !== undefined) kept.push({ project: w.project, path: w.path, reason: `uncommitted changes${listedChanges(changes)}` });
    return { ...w, merged: finished && !dirty };
  });
  return { worktrees, kept };
}

/**
 * The kept items with their reasons, then lines a later step logged (nothing when none was kept).
 * A prune prints it before its prompt and again as its last lines, so a `| tail` keeps the reasons.
 */
export const keptLast = (kept: { what: string; reason: string }[], logged: string[] = []): string[] =>
  kept.length + logged.length === 0 ? [] : ["Kept, with why:", ...kept.map((k) => `  ${k.what}: ${k.reason}`), ...logged.map((line) => `  ${line}`)];
