import { branchKey } from "./lane-claims.ts";
import { freeableLane, isValidLane, laneOfProject, laneProject, protectedLaneReason, pruneCommand, type Container, type EnvClaim, type Volume } from "./lanes.ts";
import { samePath } from "./paths.ts";
import { listedChanges } from "./prune-guards.ts";

// `pnpm lane:done 580` (RP-1170): one command for what a finished lane took about eight steps
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

/** pr: undefined when none was given, so lane-done.ts finds it from the current branch (RP-1198). */
export type LaneDoneArgs = { pr: number | undefined; lane: number | undefined; force: boolean; yes: boolean; dryRun: boolean };

// RP-1198: no `<…>` placeholder; PowerShell reads `<` as a redirect when the line is copied.
export const LANE_DONE_USAGE = "Usage: pnpm lane:done [pr number] [--lane N] [--force] [--yes] [--dry-run]   (no number: the current branch's merged PR, or a list of the merged PRs left here)";

/** lane:done's arguments, or why they are refused (`--lane 7` among them). */
export function parseLaneDoneArgs(args: string[]): LaneDoneArgs | { error: string } {
  const parsed: LaneDoneArgs = { pr: undefined, lane: undefined, force: false, yes: false, dryRun: false };
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
  if (prs.length > 1) return { error: LANE_DONE_USAGE };
  parsed.pr = prs[0];
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
  /** Under `<mainRoot>/.claude/worktrees/` (worktrees-pruning.ts isAppWorktree): the only worktrees lane:done removes. */
  appWorktree: boolean;
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

/** RP-1198: a hand-off command with its real numbers, ready to paste ("pnpm lane:done 580 --yes"). */
export const laneDoneCommand = (pr: number, ...flags: string[]) => ["pnpm lane:done", String(pr), ...flags].join(" ");

/** Why the candidate stays, or undefined when it goes. Only rule 6's reasons give way to --force. */
function keepReason(c: Candidate, pr: PullRequest, force: boolean): string | undefined {
  if (c.isMain) return "the main checkout";
  if (c.isCurrent) return `the current worktree: run \`${laneDoneCommand(pr.number, "--yes")}\` from another worktree (the Main's or the Orchestrator's)`;
  // A checkout elsewhere on the PR's branch or head (a reviewer's, a hand-made one) is never lane:done's to remove.
  if (!c.appWorktree) return `not under .claude/worktrees: remove it by hand with \`pnpm worktree:remove "${c.path}"\``;
  if (c.held !== undefined) return `held: ${c.held}`;
  if (c.heldByProcess) return `a running process holds its folder (a dev server?): \`pnpm servers:stop --yes --worktree "${c.path}"\`, then re-run`;
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
  return parts.length === 0 ? undefined : `${parts.join("; ")}; \`${laneDoneCommand(pr.number, "--force")}\` removes it anyway`;
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
    for (const c of own) {
      // RP-1198: the lanes whose containers come from its folder, so the command has a real number (never 7's).
      const lanes = [...new Set(containers.filter((x) => samePath(x.workingDir, c.path, platform)).map((x) => laneOfProject(x.project)))]
        .filter(freeableLane)
        .sort((a, b) => a - b);
      remarks.push(
        lanes.length === 0
          ? `${c.path}'s .env has no lane stack and no container comes from its folder, so lane:done frees none; \`pnpm lanes:prune --stale\` lists the stacks.`
          : `${c.path}'s .env has no lane stack, but containers of ${lanes.map((n) => `lane ${n}`).join(", ")} come from its folder: ${lanes.map((n) => `\`${laneDoneCommand(pr.number, "--lane", String(n))}\``).join(", ")} frees ${lanes.length === 1 ? "it" : "one"}.`,
      );
    }
    return { remove, kept, stack: undefined, remarks };
  }
  const project = laneProject(laneOf);
  const goes = (dir: string) => remove.some((c) => samePath(c.path, dir, platform));
  const why: string[] = [];
  if (currentProject === project) why.push(`this worktree's .env has it: run \`${laneDoneCommand(pr.number, "--yes")}\` from another worktree`);
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

/**
 * RP-1198: the last line when lane:done runs in the lane's own worktree, which it keeps with its stack:
 * the exact command for the rest. The RELEASE waits for that run, which prints it.
 */
export const restLine = (pr: Pick<PullRequest, "number">) =>
  `This worktree and its stack stay: for the rest, run \`${laneDoneCommand(pr.number, "--yes")}\` from the Main's worktree, then post the RELEASE it prints.`;

/** lane:done's last lines: run in the lane's own worktree (it keeps it), the command for the rest (restLine); else the RELEASE. */
export const lastLines = ({ pr, candidates, release }: { pr: Pick<PullRequest, "number">; candidates: Pick<Candidate, "isCurrent">[]; release: () => string[] }): string[] =>
  candidates.some((c) => c.isCurrent) ? [restLine(pr)] : release();

/** gh, injected: its stdout; throws (with gh's stderr) when it fails. */
export type GhRunner = (args: string[]) => string;

/** How many merged PRs the no-number list looks at. */
export const MERGED_LIMIT = 200;

/** gh's JSON answer, or lane:done's one-line refusal (gh's first line of stderr) when gh fails or answers no JSON. */
function ghJson<T>(gh: GhRunner, args: string[]): { value: T } | { error: string } {
  try {
    return { value: JSON.parse(gh(args)) as T };
  } catch (error) {
    const why = ((error as { stderr?: string }).stderr?.trim() || (error as Error).message || String(error)).split(/\r?\n/)[0]!.trim();
    return { error: `lane:done refused: \`gh ${args.join(" ")}\` failed (${why}). Nothing was touched.` };
  }
}

/**
 * RP-1198: `pnpm lane:done` with no number (review P3: its wiring, through an injected gh). The current
 * branch's newest merged PR (`gh pr list --head … --state merged`: a merged one by name, so an open or closed
 * PR of a reused branch name is not taken for it), which lane:done then runs as `pnpm lane:done <that number>`;
 * on a detached HEAD, `main` or a branch with none, mergedLeftovers' list; a gh failure, one line.
 * worktrees and stacks are read only for the list.
 */
export function startWithoutNumber({
  currentBranch,
  gh,
  worktrees,
  mainRoot,
  stacks,
  platform,
}: {
  currentBranch: string | undefined;
  gh: GhRunner;
  worktrees: () => CloneWorktree[];
  mainRoot: string;
  stacks: () => LaneStack[] | undefined;
  platform?: NodeJS.Platform;
}): { pr: number } | { list: string[] } | { error: string } {
  if (currentBranch !== undefined && currentBranch !== "main") {
    const own = ghJson<{ number: number }[]>(gh, ["pr", "list", "--head", currentBranch, "--state", "merged", "--limit", "1", "--json", "number"]);
    if ("error" in own) return own;
    const number = own.value[0]?.number;
    if (number !== undefined) return { pr: number };
  }
  const merged = ghJson<MergedPrRef[]>(gh, ["pr", "list", "--state", "merged", "--limit", String(MERGED_LIMIT), "--json", "number,headRefName,headRefOid"]);
  if ("error" in merged) return merged;
  return { list: mergedLeftovers({ worktrees: worktrees(), merged: merged.value, mainRoot, currentBranch, limit: MERGED_LIMIT, stacks: stacks(), platform }) };
}

/** A merged PR as `gh pr list --state merged --json number,headRefName,headRefOid` gives it. */
export type MergedPrRef = Pick<PullRequest, "number" | "headRefName" | "headRefOid">;

/** A worktree of this clone, with COMPOSE_PROJECT_NAME from its .env. */
export type CloneWorktree = { path: string; branch: string | undefined; head: string; project: string | undefined };

/** A lane's Compose project as Docker lists it: the folders its containers were started from (none: volumes only). */
export type LaneStack = { project: string; folders: string[] };

/** The lane stacks among Docker's containers and volumes, each with its containers' folders. */
export function laneStacks(containers: Pick<Container, "project" | "workingDir">[], volumes: Pick<Volume, "project">[]): LaneStack[] {
  const stacks = new Map<string, Set<string>>();
  for (const { project } of [...containers, ...volumes]) if (laneOfProject(project) !== undefined && !stacks.has(project)) stacks.set(project, new Set());
  for (const c of containers) if (c.workingDir !== "") stacks.get(c.project)?.add(c.workingDir);
  return [...stacks].map(([project, folders]) => ({ project, folders: [...folders] }));
}

const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";

/**
 * RP-1198: `pnpm lane:done` with no number where the current branch has no merged PR (the Main's own
 * worktree): every merged PR that still has a worktree or a lane stack in this clone, oldest first, each
 * with its exact command. A worktree is a PR's when it is on its branch, or a detached HEAD at its head.
 * A stack no living worktree's .env or folder holds (its worktree is gone) is the PR's when git still
 * lists a worktree of the PR at its folder, or its folder is named after the PR's branch (or the app's
 * `worktree-<branch>`); one tied to no PR is listed apart with its lanes:prune command (review P1). Never
 * lane 7's. It only lists: lane:done removes nothing then. merged: the last `limit` merged PRs; the main
 * checkout and a `main` branch are never a PR's. stacks: undefined when Docker did not answer.
 */
export function mergedLeftovers({
  worktrees,
  merged,
  mainRoot,
  currentBranch,
  limit,
  stacks,
  platform,
}: {
  worktrees: CloneWorktree[];
  merged: MergedPrRef[];
  mainRoot: string;
  currentBranch: string | undefined;
  limit: number;
  stacks: LaneStack[] | undefined;
  platform?: NodeJS.Platform;
}): string[] {
  const where = currentBranch === undefined ? "The current worktree is on a detached HEAD with no merged PR" : `The current branch ${currentBranch} has no merged PR`;
  type Entry = { pr: MergedPrRef; worktrees: CloneWorktree[]; stacks: { lane: number; text: string }[] };
  const found = new Map<number, Entry>();
  const entryOf = (pr: MergedPrRef) => found.get(pr.number) ?? found.set(pr.number, { pr, worktrees: [], stacks: [] }).get(pr.number)!;
  const prOf = (w: CloneWorktree) =>
    samePath(w.path, mainRoot, platform) || w.branch === "main"
      ? undefined
      : merged.find((p) => p.headRefName !== "main" && (w.branch === undefined ? p.headRefOid === w.head : p.headRefName === w.branch));
  for (const w of worktrees) {
    const pr = prOf(w);
    if (pr !== undefined) entryOf(pr).worktrees.push(w);
  }
  const orphans: string[] = [];
  for (const s of stacks ?? []) {
    const lane = laneOfProject(s.project);
    if (!freeableLane(lane) || worktrees.some((w) => w.project === s.project)) continue;
    const at = worktrees.find((w) => s.folders.some((f) => samePath(f, w.path, platform)));
    if (at !== undefined) {
      // Its folder is a worktree git lists: the PR's (its folder gone or its .env not naming the stack), or a living one's to keep.
      const pr = prOf(at);
      if (pr !== undefined) entryOf(pr).stacks.push({ lane, text: `stack ${s.project}` });
      continue;
    }
    const named = (p: MergedPrRef) => s.folders.some((f) => [p.headRefName, `worktree-${p.headRefName}`].some((n) => samePath(folderName(f), n, platform)));
    const pr = merged.find((p) => p.headRefName !== "main" && named(p));
    const folders = s.folders.map((f) => `"${f}"`).join(", ");
    const from = s.folders.length === 0 ? "volumes only" : `from ${folders}`;
    if (pr !== undefined) entryOf(pr).stacks.push({ lane, text: `stack ${s.project} (its worktree ${folders} is gone)` });
    else orphans.push(`  ${s.project} (${from}): ${pruneCommand(lane, { merged: true })}`);
  }
  const lines =
    found.size === 0
      ? [`${where}, so lane:done removes nothing here. No merged PR (of the last ${limit}) still has a worktree or stack in this clone.`]
      : [`${where}, so lane:done removes nothing here. Merged PRs (of the last ${limit}) that still have a worktree or stack in this clone:`];
  for (const { pr, worktrees: here, stacks: theirs } of [...found.values()].sort((a, b) => a.pr.number - b.pr.number)) {
    const folders = [...here.map((w) => `"${w.path}"${w.project === undefined ? "" : ` with stack ${w.project}`}`), ...theirs.map((s) => s.text)].join(", ");
    const harness = here.map((w) => protectedLaneReason(w.project)).find((r) => r !== undefined);
    const commands = theirs.length === 0 ? laneDoneCommand(pr.number) : theirs.map((s) => laneDoneCommand(pr.number, "--lane", String(s.lane))).join(", ");
    lines.push(`  PR #${pr.number} (${pr.headRefName}): ${folders}: ${harness === undefined ? commands : `not lane:done's: ${harness}`}`);
  }
  if (orphans.length > 0) lines.push("Lane stacks whose worktree is gone, tied to no merged PR here:", ...orphans);
  if (found.size + orphans.length > 0) lines.push("Run each from this worktree; it lists what it would remove and asks first. Nothing was removed.");
  if (stacks === undefined) lines.push("Docker did not answer, so the lane stacks were not checked; `pnpm lanes:prune --stale` lists them.");
  return lines;
}

/** "Main 4, lane-4a (lane 41)", "Main 3 (lane 30)", or a legacy "lane 5". */
export function laneLabel(lane: number | undefined): string {
  if (lane === undefined) return "lane unknown";
  if (lane < 10) return `lane ${lane}`;
  const main = Math.floor(lane / 10);
  const l = lane % 10;
  return l === 0 ? `Main ${main} (lane ${lane})` : `Main ${main}, lane-${main}${"abcd"[l - 1]} (lane ${lane})`;
}

/**
 * RP-1198: the open RP-603 claims (claims.ts readClaims) of a PR whose branch has no RP key: those
 * that name `PR #580` or the branch, whole.
 */
export function claimIdsFor(claims: { id: number; text: string; releasedBy: number | undefined }[], pr: Pick<PullRequest, "number" | "headRefName">): number[] {
  const branch = new RegExp(`(?<![\\w./-])${pr.headRefName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`);
  const number = new RegExp(`#${pr.number}(?!\\d)`);
  return claims.filter((c) => c.releasedBy === undefined && (number.test(c.text) || branch.test(c.text))).map((c) => c.id);
}

/** "2026-10-31 16:54 UTC". */
const utc = (iso: string | undefined) => (iso === undefined ? "at an unknown time" : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`);

/**
 * The RP-603 RELEASE text to paste (lane:done never posts to Jira itself), as its last line. A
 * RELEASE naming a key releases every claim under it (check-claims), so when the key still has open
 * PRs (openSiblings) a line before it says to CLAIM their files again.
 */
export function releaseLines({ pr, lane, openSiblings, claimIds }: { pr: PullRequest; lane: number | undefined; openSiblings: number[]; claimIds?: number[] | undefined }): string[] {
  const key = branchKey(pr.headRefName);
  const merged = `merged ${utc(pr.mergedAt)}${pr.mergeCommit ? ` as ${pr.mergeCommit.slice(0, 9)}` : ""}`;
  if (key === undefined) {
    // RP-1198: the claims' real comment ids (claimIdsFor), or no placeholder at all: `<…>` breaks a PowerShell paste.
    const tail = `PR #${pr.number} (branch ${pr.headRefName} has no RP key; ${merged}). ${laneLabel(lane)}.`;
    if (claimIds !== undefined && claimIds.length > 0) return [`RELEASE ${claimIds.join(", ")} — ${tail}`];
    const why = claimIds === undefined ? "RP-603's claims could not be read (JIRA_EMAIL and JIRA_API_TOKEN not set, or Jira did not answer)" : `No open RP-603 claim mentions PR #${pr.number} or branch ${pr.headRefName}`;
    return [`${why}: after RELEASE, add the number of each claim comment this PR made; \`pnpm claims --open\` lists them.`, `RELEASE — ${tail}`];
  }
  const release = `RELEASE all ${key} claims — ${key} (PR #${pr.number}, ${merged}). ${laneLabel(lane)}.`;
  if (openSiblings.length === 0) return [release];
  const prs = openSiblings.map((n) => `#${n}`).join(", ");
  return [`${key} still has open PRs ${prs}: a RELEASE with ${key} releases all its claims, so CLAIM them again after posting it.`, release];
}
