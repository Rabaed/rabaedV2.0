// Removes the rabaed-* Docker Compose projects old worktrees left behind: those whose
// worktree no longer exists, that are not running, or that only have volumes left.
// With --merged, also those whose worktrees are all merged into origin/main (their branch, or a detached HEAD's commit, RP-601)
// (as of the last fetch), unless a worktree that is not merged names the project in its .env. A worktree a
// running Claude session works in is never merged here (RP-956), so its project stays.
// Each goes with its containers, volumes (its database) and network. The current
// worktree's project is never removed.
//
//   pnpm lanes:prune [--merged] [--lane N] [--yes] [--dry-run]     --yes skips the confirmation; --dry-run only lists (RP-500)
//
// --lane N limits the candidates (stale, plus merged with --merged) to rabaed-laneN, with the
// same confirmation and the same keep rules, so one lane is freed without touching the others (RP-505).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmOrExit } from "./confirm.ts";
import { composeProjectOfEnv, LANE_SCHEME, laneProject, listContainers, listVolumes, mergedProjects, onlyLane, parsePruneArgs, removeProject, staleProjects, type WorktreeLane } from "./lanes.ts";
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
const readEnv = (dir: string) => {
  const file = join(dir, ".env");
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
};
const currentProject = composeProjectOfEnv(readEnv(".") ?? "");
const volumes = listVolumes();
const stale = staleProjects({ containers, volumes, cwd: process.cwd(), currentProject, exists: existsSync });

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
      project: composeProjectOfEnv(readEnv(w.path) ?? ""),
    }));
  const known = new Set(stale.map((s) => s.project));
  stale.push(...mergedProjects({ containers, volumes, worktrees, cwd: process.cwd(), currentProject }).filter((m) => !known.has(m.project)));
  // RP-956: judgeWorktree counts these as not finished, so --merged keeps their project; name the session.
  for (const w of worktrees.slice(1)) {
    if (w.project === undefined || (lane !== undefined && w.project !== laneProject(lane)) || stale.some((s) => s.project === w.project)) continue;
    const held = live.heldBySession?.(w.path);
    if (held !== undefined) console.log(`Not pruned as merged: ${w.project} of ${w.path}: ${held}.`);
  }
}

const candidates = onlyLane(stale, lane);
if (candidates.length === 0) {
  console.log(lane === undefined ? "Nothing to prune." : `Nothing to prune for lane ${lane}.`);
  process.exit(0);
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
  try {
    removeProject(s);
    console.log(`Removed ${s.project}.`);
  } catch (error) {
    failed++;
    console.error(`Could not remove ${s.project}: ${(error as { stderr?: string }).stderr?.trim() || String(error)}`);
  }
}
if (failed > 0) process.exit(1);
