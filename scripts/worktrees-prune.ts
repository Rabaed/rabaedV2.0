// Removes what merged PRs leave behind (RP-308). After `git fetch --prune origin`:
//   1. every worktree merged into origin/main (or whose upstream is gone; desktop-app
//      worktrees under .claude/worktrees/ only when merged), with its rabaed-* compose
//      project (containers, volumes, network), its folder and its branch;
//   2. every other local branch merged into origin/main and checked out nowhere
//      (merge-base --is-ancestor origin/main, then `git branch -D`), never main;
//   3. the orphaned compose projects lanes:prune finds.
// It never touches the main checkout or the current worktree, and skips, and lists,
// worktrees with uncommitted changes (untracked files outside ignored paths included),
// commits on no origin branch, or nothing merged. A project a kept worktree names in its
// .env stays. It lists everything and asks first.
//
//   pnpm worktrees:prune [--yes]     --yes skips the confirmation
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmOrExit } from "./confirm.ts";
import { composeProjectOfEnv, listContainers, listVolumes, removeProject } from "./lanes.ts";
import { samePath } from "./paths.ts";
import { choosePrune, type PruneWorktree } from "./worktrees-pruning.ts";
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
  unpushedCount,
} from "./worktrees.ts";

const TARGET = "origin/main";
const args = process.argv.slice(2);
if (args.some((a) => a !== "--yes")) {
  console.error("Usage: pnpm worktrees:prune [--yes]");
  process.exit(1);
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
const all = listWorktrees(mainRoot);
const here = currentRoot();
const branches = localBranches(TARGET, mainRoot);
const gone = new Set(branches.filter((b) => b.upstreamGone).map((b) => b.branch));
const worktrees: PruneWorktree[] = gatherFacts(all, TARGET, mainRoot).map((w) => ({
  ...w,
  upstreamGone: w.branch !== undefined && gone.has(w.branch),
  unpushed: unpushedCount(w.head, mainRoot),
  project: composeProjectOfEnv(readEnv(w.path) ?? ""),
}));
const containers = listContainers();
const docker = containers && { containers, volumes: listVolumes(), currentProject: composeProjectOfEnv(readEnv(here) ?? "") };
const chosen = choosePrune({ worktrees, branches, mainRoot, currentPath: here, docker, exists: existsSync });

const name = (w: { path: string; branch: string | undefined }) => `${w.path} (${w.branch ?? "detached HEAD"})`;
const quiet = (reason: string) => reason === "the main checkout" || reason === "this is the current worktree";
const listed = chosen.skipped.filter((s) => !quiet(s.reason));
if (listed.length > 0) {
  console.log("Skipped:");
  for (const s of listed) console.log(`  ${name(s.worktree)}: ${s.reason}`);
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

await confirmOrExit("Remove them? Their databases are lost.", { yes: args.includes("--yes"), verb: "remove", done: "removed" });

let failed = 0;
const attempt = (what: string, action: () => void) => {
  try {
    action();
  } catch (error) {
    failed++;
    console.error(`Could not remove ${what}: ${gitError(error)}`);
  }
};
for (const p of chosen.projects) {
  attempt(p.project, () => {
    removeProject(p);
    console.log(`Removed compose project ${p.project}.`);
  });
}
for (const w of chosen.remove) {
  // Checked again just before: never the main checkout or the current worktree.
  if (samePath(w.path, mainRoot) || samePath(w.path, here)) continue;
  attempt(w.path, () => {
    const { branchKept, folderLeft } = removeLinkedWorktree(w, mainRoot, TARGET);
    if (folderLeft) {
      failed++;
      console.error(`Removed ${w.path} from git, but could not delete its folder (${folderLeft}); delete it by hand.`);
    } else console.log(`Removed ${w.path}.`);
    if (branchKept) console.log(`  Kept branch ${w.branch}: ${branchKept}`);
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
pruneWorktrees(mainRoot);
if (failed > 0) process.exit(1);
