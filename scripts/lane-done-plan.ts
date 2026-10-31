import { branchKey } from "./lane-claims.ts";
import { isValidLane, laneOfProject, laneProject, protectedLaneReason, type Container, type EnvClaim, type Volume } from "./lanes.ts";
import { samePath } from "./paths.ts";
import { listedChanges } from "./prune-guards.ts";

// `pnpm lane:done <pr>` (RP-1170): one command for what a finished lane took about eight steps
// (archive, a failing `git worktree remove`, a scratch rd, `branch -D`, lanes:prune twice, a hand
// RELEASE). The decisions are here, on facts lane-done.ts gathers, so the safety rules are unit-tested:
//   1. never lane 7 (Main 7's harness data): `--lane 7`, or a worktree whose .env names it, refuses all;
//   2. never a worktree a live Claude session works in, nor a stack another worktree's .env names; and
//      "merged" means the worktree's HEAD is on the PR's merged commits, so a branch with no commits
//      of its own never counts (main-5-panel-days was removed under Main 5's live session that way);
//   3. a subagent worktree goes only when every file its branch changed is as in origin/main (so a
//      cherry-picked result counts); every one kept is listed at once, never refused one at a time;
//   4. the volumes stay while a verify runs anywhere (bulk `docker volume rm` hung Docker twice);
//   6. uncommitted or untracked files, or commits origin/main lacks, keep a worktree unless --force;
//   8. the PR must be merged before anything else, and the last line is the RP-603 RELEASE text.

export type LaneDoneArgs = { pr: number; lane: number | undefined; force: boolean; yes: boolean; dryRun: boolean };

export const LANE_DONE_USAGE = "Usage: pnpm lane:done <pr> [--lane N] [--force] [--yes] [--dry-run]";

/** lane:done's arguments, or why they are refused (`--lane 7` among them). */
export function parseLaneDoneArgs(args: string[]): LaneDoneArgs | { error: string } {
  const parsed: LaneDoneArgs = { pr: 0, lane: undefined, force: false, yes: false, dryRun: false };
  const prs: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--force") parsed.force = true;
    else if (a === "--yes") parsed.yes = true;
    else if (a === "--dry-run") parsed.dryRun = true;
    else if (a === "--lane") {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || !isValidLane(n)) return { error: `--lane needs a lane number.\n${LANE_DONE_USAGE}` };
      const harness = protectedLaneReason(laneProject(n));
      if (harness !== undefined) return { error: `lane:done refused: ${harness}.` };
      parsed.lane = n;
    } else if (/^#?\d+$/.test(a)) prs.push(Number(a.replace(/^#/, "")));
    else return { error: LANE_DONE_USAGE };
  }
  if (prs.length !== 1) return { error: LANE_DONE_USAGE };
  parsed.pr = prs[0]!;
  return parsed;
}

/** What `gh pr view` says about the PR. commits: its commits' oids. */
export type PullRequest = {
  number: number;
  state: string;
  mergedAt: string | undefined;
  headRefName: string;
  headRefOid: string;
  mergeCommit: string | undefined;
  commits: string[];
};

/** Rule 8: why lane:done stops before anything else, or undefined when the PR is merged. */
export const notMergedRefusal = (pr: PullRequest): string | undefined =>
  pr.state === "MERGED" ? undefined : `lane:done refused: PR #${pr.number} is ${pr.state}, not merged. Nothing was touched.`;

/** One worktree lane:done may remove, as lane-done.ts read it. */
export type Candidate = {
  path: string;
  branch: string | undefined;
  head: string;
  /** "lane": on the PR's branch (or a detached HEAD at its head); "agent": a `.claude/worktrees/agent-*` worktree whose .env names the lane. */
  kind: "lane" | "agent";
  exists: boolean;
  isMain: boolean;
  isCurrent: boolean;
  /** Why a running or desktop Claude session holds it (claude-sessions.ts holdReason), or undefined. */
  held: string | undefined;
  /** A running process's command line names its folder, such as its dev server. */
  heldByProcess: boolean;
  /** Its lock names a running Claude session (worktrees.ts Liveness.lockLive): its subagent may still run. */
  lockLive: boolean;
  /** The lock reason ("" when locked without one), or undefined when not locked. */
  locked: string | undefined;
  /** agent: how many paths its branch changed since it left origin/main; undefined when git could not tell. */
  ownChanges: number | undefined;
  /** `git status --porcelain` lines, untracked files included; undefined when git could not read them. */
  changes: string[] | undefined;
  /** COMPOSE_PROJECT_NAME from its .env. */
  project: string | undefined;
  /** lane: its HEAD is one of the PR's commits, or has the PR's head in it. */
  onPr: boolean;
  /** Commits on HEAD that origin/main does not have; undefined when git could not tell. */
  ahead: number | undefined;
  /** agent: the files its branch changed whose content is not as in origin/main; undefined when git could not tell. */
  filesNotInMain: string[] | undefined;
};

export type DecisionInput = {
  pr: PullRequest;
  /** `--lane N`, if given. */
  lane: number | undefined;
  candidates: Candidate[];
  /** The .env claims of every existing worktree other than the candidates (lanes.ts envClaims). */
  claims: EnvClaim[];
  containers: Container[];
  volumes: Volume[];
  /** COMPOSE_PROJECT_NAME of the worktree lane:done runs in. */
  currentProject: string | undefined;
  /** Why no volume may be removed now (a verify runs, or that could not be checked), or undefined. */
  volumesKeptBecause: string | undefined;
  force: boolean;
  exists: (dir: string) => boolean;
  platform?: NodeJS.Platform;
};

/**
 * The lane's stack: "remove" with its volumes, "containers" only (rule 4), "keep" (why says what
 * holds it), or "none" when nothing of it is left.
 */
export type StackDecision = { project: string; action: "remove" | "containers" | "keep" | "none"; containers: string[]; volumes: string[]; why: string[] };

export type Decision = {
  /** lane:done stops: nothing is touched. */
  refusal?: string;
  remove: Candidate[];
  kept: { what: string; reason: string }[];
  /** Undefined when no lane is known. */
  stack: StackDecision | undefined;
  remarks: string[];
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const laneNumber = (project: string | undefined): number | undefined => laneOfProject(project ?? "");
export const describeWorktree = (c: Pick<Candidate, "path" | "branch">) => `${c.path} (${c.branch ?? "detached HEAD"})`;

/** Why the candidate stays, or undefined when it goes. Only rule 6's reasons give way to --force. */
function keepReason(c: Candidate, pr: PullRequest, force: boolean): string | undefined {
  if (c.isMain) return "the main checkout";
  if (c.isCurrent) return "the current worktree: run pnpm lane:done from another worktree (the Main's or the Orchestrator's)";
  if (c.held !== undefined) return `held: ${c.held}`;
  if (c.heldByProcess) return `a running process holds its folder (a dev server?): \`pnpm servers:stop --yes --worktree ${c.path}\`, then re-run`;
  if (c.kind === "lane" && !c.onPr) return `its HEAD ${c.head} is not on PR #${pr.number}'s commits, so its own commits are not known to be merged`;
  if (c.kind === "agent") {
    if (c.lockLive) return "locked by a running session (its subagent may still run)";
    if (c.filesNotInMain === undefined) return "its changes could not be compared with origin/main";
    if (c.filesNotInMain.length > 0) return `${plural(c.filesNotInMain.length, "path")} its branch changed ${c.filesNotInMain.length === 1 ? "is" : "are"} not as in origin/main${listedChanges(c.filesNotInMain)}`;
    // Rule 2: no change of its own is no proof of a merge; only the app's lock naming a stopped session shows it ended.
    if (c.ownChanges === 0 && c.locked === undefined) return "no change of its own yet and no lock to show its subagent has stopped";
  }
  if (force || !c.exists) return undefined;
  const unread = c.changes === undefined || (c.kind === "lane" && c.ahead === undefined);
  const parts = unread
    ? ["git could not read its changes or commits"]
    : [
        ...(c.changes!.length > 0 ? [`uncommitted changes${listedChanges(c.changes)}`] : []),
        ...(c.kind === "lane" && c.ahead! > 0 ? [`${plural(c.ahead!, "commit")} origin/main does not have`] : []),
      ];
  return parts.length === 0 ? undefined : `${parts.join("; ")}; \`--force\` removes it anyway`;
}

/** What lane:done does: which worktrees go, which stay (all listed at once, with why), and the stack. */
export function decideLaneDone({ pr, lane, candidates, claims, containers, volumes, currentProject, volumesKeptBecause, force, exists, platform }: DecisionInput): Decision {
  const refuse = (why: string): Decision => ({ refusal: `lane:done refused: ${why}. Nothing was touched.`, remove: [], kept: [], stack: undefined, remarks: [] });
  for (const c of candidates) {
    const harness = protectedLaneReason(c.project);
    if (harness !== undefined) return { ...refuse(harness), refusal: `lane:done refused: ${harness}.` };
  }
  if (lane !== undefined) {
    const harness = protectedLaneReason(laneProject(lane));
    if (harness !== undefined) return { ...refuse(harness), refusal: `lane:done refused: ${harness}.` };
    const other = candidates.find((c) => c.kind === "lane" && c.project !== undefined && c.project !== laneProject(lane));
    if (other) return refuse(`${other.path} has ${other.project} in its .env, not lane ${lane}`);
  }
  const remarks: string[] = [];
  const own = candidates.filter((c) => c.kind === "lane");
  if (own.length === 0) remarks.push(`No worktree of this clone is on PR #${pr.number}'s branch ${pr.headRefName} (removed already?).`);
  const laneOf = lane ?? own.map((c) => laneNumber(c.project)).find((n) => n !== undefined);

  const remove: Candidate[] = [];
  const kept: Decision["kept"] = [];
  for (const c of candidates) {
    const reason = keepReason(c, pr, force);
    if (reason === undefined) remove.push(c);
    else kept.push({ what: describeWorktree(c), reason });
  }

  if (laneOf === undefined) {
    for (const c of own) remarks.push(`${c.path}'s .env has no lane stack: pass \`--lane N\` to free one.`);
    return { remove, kept, stack: undefined, remarks };
  }
  const project = laneProject(laneOf);
  const goes = (dir: string) => remove.some((c) => samePath(c.path, dir, platform));
  const why: string[] = [];
  if (currentProject === project) why.push("this worktree's .env has it: run pnpm lane:done from another worktree");
  for (const c of candidates) if (c.project === project && !goes(c.path)) why.push(`${c.path} is kept (above)`);
  for (const claim of claims) if (claim.project === project) why.push(`the .env of ${claim.path} (on ${claim.branch ?? "a detached HEAD"}) has it`);
  const mine = containers.filter((c) => c.project === project);
  // A folder already named above for this project; any other folder that stays and holds a container keeps it too.
  const named = (dir: string) =>
    candidates.some((c) => c.project === project && samePath(c.path, dir, platform)) || claims.some((c) => c.project === project && samePath(c.path, dir, platform));
  const seen = new Set<string>();
  for (const c of mine) {
    if (c.workingDir === "" || !exists(c.workingDir) || goes(c.workingDir) || named(c.workingDir) || seen.has(c.workingDir)) continue;
    seen.add(c.workingDir);
    why.push(`${c.name} comes from ${c.workingDir}, which stays`);
  }
  const names = mine.map((c) => c.name);
  const vols = volumes.filter((v) => v.project === project).map((v) => v.name);
  let action: StackDecision["action"];
  if (why.length > 0) action = "keep";
  else if (names.length + vols.length === 0) action = "none";
  else if (volumesKeptBecause !== undefined && vols.length > 0) {
    action = "containers";
    why.push(`its volumes stay: ${volumesKeptBecause}; run \`pnpm lanes:prune --lane ${laneOf}\` once no verify runs`);
  } else action = "remove";
  return { remove, kept, stack: { project, action, containers: names, volumes: vols, why }, remarks };
}

/** "Main 4, lane-4a (lane 41)", "Main 3 (lane 30)", or a legacy "lane 5". */
export function laneLabel(lane: number | undefined): string {
  if (lane === undefined) return "lane unknown";
  if (lane < 10) return `lane ${lane}`;
  const main = Math.floor(lane / 10);
  const l = lane % 10;
  return l === 0 ? `Main ${main} (lane ${lane})` : `Main ${main}, lane-${main}${"abcd"[l - 1]} (lane ${lane})`;
}

/** "2026-10-31 16:54 UTC". */
const utc = (iso: string | undefined) => (iso === undefined ? "at an unknown time" : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`);

/**
 * The RP-603 RELEASE text to paste (lane:done never posts to Jira itself), as its last line. A
 * RELEASE naming a key releases every claim under it (check-claims), so when the key still has open
 * PRs (openSiblings) a line before it says to CLAIM their files again.
 */
export function releaseLines({ pr, lane, openSiblings }: { pr: PullRequest; lane: number | undefined; openSiblings: number[] }): string[] {
  const key = branchKey(pr.headRefName);
  const merged = `merged ${utc(pr.mergedAt)}${pr.mergeCommit ? ` as ${pr.mergeCommit.slice(0, 9)}` : ""}`;
  if (key === undefined) return [`RELEASE <claim comment id> — PR #${pr.number} (branch ${pr.headRefName} has no RP key; ${merged}). ${laneLabel(lane)}.`];
  const release = `RELEASE all ${key} claims — ${key} (PR #${pr.number}, ${merged}). ${laneLabel(lane)}.`;
  if (openSiblings.length === 0) return [release];
  const prs = openSiblings.map((n) => `#${n}`).join(", ");
  return [`${key} still has open PRs ${prs}: a RELEASE with ${key} releases all its claims, so CLAIM them again after posting it.`, release];
}
