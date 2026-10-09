// Removes what merged PRs leave behind (RP-308). After `git fetch --prune origin`:
//   1. every worktree merged into origin/main (or whose upstream is gone; desktop-app
//      worktrees under .claude/worktrees/ only when merged), with its folder and its
//      branch, then its rabaed-* compose project (containers, volumes, network) once
//      the worktree is removed;
//   2. every other local branch merged into origin/main and checked out nowhere
//      (merge-base --is-ancestor origin/main, then `git branch -D`), never main;
//   3. the orphaned compose projects lanes:prune finds.
// It never touches the main checkout or the current worktree, and skips, and lists,
// worktrees with uncommitted changes (untracked files outside ignored paths included),
// commits on no origin branch, or nothing merged; it checks the first two again just
// before removing each worktree. A squash-merged worktree whose remote branch was
// deleted is skipped too: its commits are on no origin branch, and a deleted remote
// branch is no proof of a merge. A merged local branch with no commit of its own and
// no upstream is kept: it may be a session just starting. A project a kept worktree
// names in its .env stays. It lists everything and asks first.
//
// Of the skipped worktrees it also lists, read-only, the stale ones: nothing committed
// or changed for --stale-days (default 7), with age, branch and the lock's pid state (RP-506).
//
//   pnpm worktrees:prune [--stale-days <n>] [--yes]     --yes skips the confirmation
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmOrExit } from "./confirm.ts";
import { composeProjectOfEnv, listContainers, listVolumes, removeProject } from "./lanes.ts";
import { samePath } from "./paths.ts";
import { DEFAULT_STALE_DAYS, parseStaleDays, printStale } from "./worktrees-stale.ts";
import { changedSinceListed, choosePrune, type PruneWorktree } from "./worktrees-pruning.ts";
import {
  currentRoot,
  deleteBranch,
  fetchPrune,
  gatherFacts,
  gitError,
  inTarget,
  listWorktrees,
  localBranches,
  pruneWorktrees,
  refExists,
  removeLinkedWorktree,
  reportRemoval,
  unpushedCount,
  type Worktree,
} from "./worktrees.ts";

const TARGET = "origin/main";
const usage = "Usage: pnpm worktrees:prune [--stale-days <n>] [--yes]";
const args = process.argv.slice(2);
let yes = false;
let staleDays = DEFAULT_STALE_DAYS;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--yes") yes = true;
  else if (a === "--stale-days" && parseStaleDays(args[i + 1]) !== undefined && args[i + 1] !== undefined) staleDays = parseStaleDays(args[++i])!;
  else {
    console.error(usage);
    process.exit(1);
  }
}

const mainRoot = listWorktrees()[0]!.path;
try {
  fetchPrune(mainRoot);
} catch (error) {
  console.error(`git fetch --prune origin failed: ${gitError(error)}`);
  process.exit(1);
}
if (!refExists(TARGET, mainRoot)) {
  console.error(`${TARGET} not found.`);
  process.exit(1);
}

const readEnv = (dir: string) => {
  const file = join(dir, ".env");
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
};
const here = currentRoot();
const branches = localBranches(TARGET, mainRoot);
const gone = new Set(branches.filter((b) => b.upstreamGone).map((b) => b.branch));
const pruneFacts = (list: Worktree[]): PruneWorktree[] =>
  gatherFacts(list, TARGET, mainRoot).map((w) => ({
    ...w,
    upstreamGone: w.branch !== undefined && gone.has(w.branch),
    unpushed: unpushedCount(w.head, mainRoot),
    project: composeProjectOfEnv(readEnv(w.path) ?? ""),
  }));
const worktrees = pruneFacts(listWorktrees(mainRoot));
const containers = listContainers();
const docker = containers && { containers, volumes: listVolumes(), currentProject: composeProjectOfEnv(readEnv(here) ?? "") };
const chosen = choosePrune({ worktrees, branches, mainRoot, currentPath: here, docker, exists: existsSync });

const name = (w: { path: string; branch: string | undefined }) => `${w.path} (${w.branch ?? "detached HEAD"})`;
const goesWithoutSaying = (reason: string) => reason === "the main checkout" || reason === "this is the current worktree";
const listed = chosen.skipped.filter((s) => !goesWithoutSaying(s.reason));
if (listed.length > 0) {
  console.log("Skipped:");
  for (const s of listed) console.log(`  ${name(s.worktree)}: ${s.reason}`);
  printStale(listed, staleDays);
}
if (!docker) console.log("Docker is not running: compose projects are not checked (run `pnpm lanes:prune` later).");
if (chosen.remove.length + chosen.branches.length + chosen.projects.length === 0) {
  console.log("Nothing to prune.");
  process.exit(0);
}
if (chosen.projects.length > 0) {
  console.log("Compose projects to remove, with their volumes:");
  for (const p of chosen.projects) console.log(`  ${p.project}: ${p.reason}`);
}
if (chosen.remove.length > 0) {
  console.log(`Worktrees merged into ${TARGET}, to remove with their folders and branches:`);
  for (const w of chosen.remove) console.log(`  ${name(w)}`);
}
if (chosen.branches.length > 0) {
  console.log(`Other local branches merged into ${TARGET}, to delete:`);
  for (const b of chosen.branches) console.log(`  ${b}`);
}

await confirmOrExit("Remove them? Their databases are lost.", { yes, verb: "remove", done: "removed" });

let failed = 0;
const attempt = (what: string, action: () => void) => {
  try {
    action();
  } catch (error) {
    failed++;
    console.error(`Could not remove ${what}: ${gitError(error)}`);
  }
};
const removedPaths: string[] = [];
for (const w of chosen.remove) {
  // Checked again just before: never the main checkout or the current worktree.
  if (samePath(w.path, mainRoot) || samePath(w.path, here)) continue;
  // Its uncommitted changes and unpushed commits too, which may have changed since the prompt.
  const changed = changedSinceListed(pruneFacts(listWorktrees(mainRoot).filter((x) => samePath(x.path, w.path)))[0]);
  if (changed) {
    console.log(`Kept ${name(w)}: ${changed}.`);
    continue;
  }
  attempt(w.path, () => {
    if (reportRemoval(w.path, removeLinkedWorktree(w, mainRoot, TARGET))) failed++;
    removedPaths.push(w.path);
  });
}
for (const p of chosen.projects) {
  // A worktree's project goes only once that worktree is removed; orphans go regardless.
  const kept = p.waitsFor.filter((path) => !removedPaths.some((r) => samePath(r, path)));
  if (kept.length > 0) {
    console.log(`Kept compose project ${p.project}: ${kept.join(", ")} was not removed.`);
    continue;
  }
  attempt(p.project, () => {
    removeProject(p);
    console.log(`Removed compose project ${p.project}.`);
  });
}
for (const b of chosen.branches) {
  attempt(`branch ${b}`, () => {
    // removeLinkedWorktree may have deleted it already (a worktree-agent-* branch).
    if (!refExists(`refs/heads/${b}`, mainRoot)) return;
    if (!inTarget(b, TARGET, mainRoot)) throw new Error(`${b} has commits ${TARGET} does not`);
    deleteBranch(b, mainRoot);
    console.log(`Removed branch ${b}.`);
  });
}
try {
  pruneWorktrees(mainRoot);
} catch (error) {
  failed++;
  console.error(`git worktree prune failed: ${gitError(error)}`);
}
if (failed > 0) process.exit(1);
