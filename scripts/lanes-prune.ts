// Removes the rabaed-* Docker Compose projects old worktrees left behind: those whose
// worktree no longer exists, that are not running, or that only have volumes left.
// With --merged, also those whose worktrees are all merged into origin/main (their branch, or a detached HEAD's commit, RP-601)
// (as of the last fetch), unless a worktree that is not merged names the project in its .env. A merged
// project stays, named with the session, while a running Claude session works in one of its worktrees
// (RP-956) or its Claude desktop session is open (RP-612), or when they cannot be checked; both are read
// again just before each merged project is removed.
// Each goes with its containers, volumes (its database) and network. The current
// worktree's project is never removed, nor, in any mode, one that another existing worktree's .env
// names while it is not running or has only volumes left (RP-1007): that worktree is named instead,
// and the .env files are read again just before each removal. With --lane N such a keep exits 1.
//
//   pnpm lanes:prune [--merged] [--lane N] [--yes] [--dry-run]     --yes skips the confirmation; --dry-run only lists (RP-500)
//
// --lane N limits the candidates (stale, plus merged with --merged) to rabaed-laneN, with the
// same confirmation and the same keep rules, so one lane is freed without touching the others (RP-505).
import { existsSync } from "node:fs";
import { confirmOrExit } from "./confirm.ts";
import { systemHolders } from "./claude-sessions.ts";
import {
  chooseMerged,
  composeProjectOfEnv,
  envClaims,
  heldSinceListed,
  keptByClaims,
  laneKeptByClaim,
  LANE_SCHEME,
  laneProject,
  listContainers,
  listVolumes,
  newClaimant,
  onlyLane,
  parsePruneArgs,
  readWorktreeEnv,
  removeProject,
  staleProjects,
  type StaleProject,
  type WorktreeLane,
} from "./lanes.ts";
import { judgeWorktree, listWorktrees, refExists, systemLiveness } from "./worktrees.ts";

const options = parsePruneArgs(process.argv.slice(2));
if (!options) {
  console.error(`Usage: pnpm lanes:prune [--merged] [--lane N] [--yes] [--dry-run]   (--lane N: only rabaed-laneN; ${LANE_SCHEME})`);
  process.exit(1);
}
const withMerged = options.merged;
const lane = options.lane;

const containers = listContainers();
if (!containers) {
  console.error("Docker is not running (or not installed); start it and re-run.");
  process.exit(1);
}
const currentProject = composeProjectOfEnv(readWorktreeEnv(".") ?? "");
const volumes = listVolumes();
/** Every other worktree's .env claim (RP-1007), read now; a project one names is not pruned as stale. */
const readClaims = () => envClaims(listWorktrees().filter((w) => existsSync(w.path)), { cwd: process.cwd(), readEnv: readWorktreeEnv });
const claims = readClaims();
const { prune: stale, kept: claimed } = keptByClaims(staleProjects({ containers, volumes, cwd: process.cwd(), currentProject, exists: existsSync }), claims);
const inScope = (project: string) => lane === undefined || project === laneProject(lane);
/** The projects --merged adds (none without it); a claimed project it adds is not reported as kept. */
let fresh: StaleProject[] = [];
/** The candidates chosen as merged (--merged): checked again for sessions just before each removal. */
const mergedOnes = new Set<string>();

if (withMerged) {
  const all = listWorktrees();
  const mainRoot = all[0]!.path;
  if (!refExists("origin/main", mainRoot)) {
    console.error("origin/main not found: run `git fetch origin main` and re-run.");
    process.exit(1);
  }
  // The main folder, and any worktree on main itself, always keeps its lane. Merged is the finished rule
  // lane:env, worktrees:clean and worktrees:prune share (worktrees.ts isFinished, RP-585).
  const live = systemLiveness();
  const worktrees: WorktreeLane[] = all
    .filter((w) => existsSync(w.path))
    .map((w, i) => ({
      path: w.path,
      branch: w.branch,
      merged: i > 0 && w.branch !== "main" && judgeWorktree(w, "origin/main", mainRoot, live).finished,
      project: composeProjectOfEnv(readWorktreeEnv(w.path) ?? ""),
    }));
  const known = new Set(stale.map((s) => s.project));
  // RP-956, RP-612: a holder a running or desktop Claude session holds keeps its project; name the session.
  const { merged, kept } = chooseMerged({ containers, volumes, worktrees, cwd: process.cwd(), currentProject, holders: live.holders });
  fresh = merged.filter((m) => !known.has(m.project));
  stale.push(...fresh);
  for (const m of fresh) mergedOnes.add(m.project);
  for (const k of kept) if (!known.has(k.project) && inScope(k.project)) console.log(`Not pruned as merged: ${k.project} of ${k.path}: ${k.reason}.`);
}

for (const k of claimed) if (inScope(k.project) && !fresh.some((m) => m.project === k.project)) console.log(`Not pruned: ${k.project} of ${k.path}: ${k.reason}.`);
// --lane N's own project kept for a claim is a refusal: exit 1.
const laneRefused = laneKeptByClaim(lane, claimed, fresh);

const candidates = onlyLane(stale, lane);
if (candidates.length === 0) {
  console.log(lane === undefined ? "Nothing to prune." : `Nothing to prune for lane ${lane}.`);
  process.exit(laneRefused ? 1 : 0);
}
console.log("Compose projects to prune:");
for (const s of candidates) {
  console.log(`  ${s.project}: ${s.reason}; containers: ${s.containers.join(", ") || "none"}; volumes: ${s.volumes.join(", ") || "none"}`);
}

if (options.dryRun) {
  console.log("Dry run: nothing removed.");
  process.exit(0);
}

await confirmOrExit("Remove them with their volumes? Their databases are lost, including those of stopped worktrees that still exist.", {
  yes: options.yes,
  verb: "remove",
  done: "removed",
});

let failed = 0;
for (const s of candidates) {
  // Read again just before: a session may have moved into or opened a merged project's worktree since the prompt.
  const held = mergedOnes.has(s.project) ? heldSinceListed(s, containers, systemHolders()) : undefined;
  if (held !== undefined) {
    console.log(`Kept ${s.project}: ${held}.`);
    continue;
  }
  // RP-1007: and a lane:env since the prompt may have written a .env naming it.
  const claimant = newClaimant(s.project, claims, readClaims());
  if (claimant !== undefined) {
    console.log(`Kept ${s.project}: the .env of ${claimant.path} (on ${claimant.branch ?? "a detached HEAD"}) names it now.`);
    continue;
  }
  try {
    removeProject(s);
    console.log(`Removed ${s.project}.`);
  } catch (error) {
    failed++;
    console.error(`Could not remove ${s.project}: ${(error as { stderr?: string }).stderr?.trim() || String(error)}`);
  }
}
if (failed > 0) process.exit(1);
