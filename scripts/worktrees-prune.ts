// Removes what merged PRs leave behind (RP-308). After `git fetch --prune origin`:
//   1. every worktree merged into origin/main, by the finished rule lane:env, lanes:prune
//      and worktrees:clean share (worktrees.ts isFinished, RP-585: a branch never committed
//      to counts once nothing holds it), or whose upstream is gone (desktop-app
//      worktrees under .claude/worktrees/ only when merged), with its folder and its
//      branch, then its rabaed-* compose project (containers, volumes, network) once
//      the worktree is removed;
//   2. every other local branch merged into origin/main and checked out nowhere
//      (merge-base --is-ancestor origin/main, then `git branch -D`), never main;
//   3. the orphaned compose projects lanes:prune finds.
// It never touches the main checkout or the current worktree, nor one whose Claude
// session is open: a "claude session" lock, or the desktop app's own record of the
// worktree's path (desktop-sessions.ts, RP-608: the app does not lock its worktrees,
// and a session may have renamed the app's branch), nor one a running Claude session works
// in (claude-sessions.ts, RP-956: a session that moved in with EnterWorktree leaves neither;
// when the running sessions cannot be checked, every worktree is kept). It skips, and lists,
// worktrees with uncommitted changes (untracked files outside ignored paths included),
// commits on no origin branch, or nothing merged; it checks the first two again just
// before removing each worktree. A squash-merged worktree whose remote branch was
// deleted is skipped too: its commits are on no origin branch, and a deleted remote
// branch is no proof of a merge. A merged local branch with no commit of its own and
// no upstream is kept: it may be a session just starting. A project a kept worktree
// names in its .env stays, and is listed with that worktree. Just before removing each
// project it checks again (RP-1073: a run can take minutes): a worktree's .env naming it
// now, a container of it started from an existing folder, Docker not answering, or a
// connection to its Postgres keeps it. It lists everything and asks first.
//
// RP-1101: it refuses on a shallow clone (missing history misjudges merged branches), never touches
// lane 7 (Main 7's harness data) or the worktree whose .env names it, lists a dirty worktree's files,
// keeps a stale project whose existing folder a session works in, and prints what it kept, with
// why, last, so a `| tail` keeps the reasons.
//
// Of the skipped worktrees it also lists, read-only, the stale ones: nothing committed
// or changed for --stale-days (default 7), with age, branch and the lock's pid state (RP-506).
//
//   pnpm worktrees:prune [--stale-days <n>] [--yes]     --yes skips the confirmation
import { existsSync } from "node:fs";
import { confirmOrExit } from "./confirm.ts";
import { systemHolders } from "./claude-sessions.ts";
import { composeProjectOfEnv, listContainers, listVolumes, readProjectNow, readWorktreeEnv, removeProject } from "./lanes.ts";
import { samePath } from "./paths.ts";
import { keptLast, shallowRefusal } from "./prune-guards.ts";
import { DEFAULT_STALE_DAYS, printStale, staleDaysAt } from "./worktrees-stale.ts";
import { changedSinceListed, choosePrune, removeProjectsNow, type PruneWorktree } from "./worktrees-pruning.ts";
import {
  CURRENT_WORKTREE,
  currentRoot,
  deleteBranch,
  fetchPrune,
  gatherFacts,
  gitError,
  inTarget,
  isShallowRepo,
  listWorktrees,
  localBranches,
  pruneWorktrees,
  refExists,
  removeLinkedWorktree,
  reportRemoval,
  systemLiveness,
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
  const days = staleDaysAt(args, i);
  if (a === "--yes") yes = true;
  else if (days !== undefined) {
    staleDays = days;
    i++;
  } else {
    console.error(usage);
    process.exit(1);
  }
}

const mainRoot = listWorktrees()[0]!.path;
const shallow = shallowRefusal(isShallowRepo(mainRoot), "worktrees:prune");
if (shallow !== undefined) {
  console.error(shallow);
  process.exit(1);
}
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

const here = currentRoot();
const branches = localBranches(TARGET, mainRoot);
const gone = new Set(branches.filter((b) => b.upstreamGone).map((b) => b.branch));
const live = systemLiveness();
const pruneFacts = (list: Worktree[]): PruneWorktree[] =>
  gatherFacts(list, TARGET, mainRoot, live).map((w) => ({
    ...w,
    upstreamGone: w.branch !== undefined && gone.has(w.branch),
    unpushed: unpushedCount(w.head, mainRoot),
    project: composeProjectOfEnv(readWorktreeEnv(w.path) ?? ""),
  }));
const worktrees = pruneFacts(listWorktrees(mainRoot));
const containers = listContainers();
const docker = containers && { containers, volumes: listVolumes(), currentProject: composeProjectOfEnv(readWorktreeEnv(here) ?? "") };
const chosen = choosePrune({ worktrees, branches, mainRoot, currentPath: here, docker, exists: existsSync, holders: live.holders });

const name = (w: { path: string; branch: string | undefined }) => `${w.path} (${w.branch ?? "detached HEAD"})`;
const goesWithoutSaying = (reason: string) => reason === "the main checkout" || reason === CURRENT_WORKTREE;
const listed = chosen.skipped.filter((s) => !goesWithoutSaying(s.reason));
/** What was kept, with why, and what later steps logged: printed last (RP-1101), so it is not cut off. */
const kept = [...listed.map((s) => ({ what: name(s.worktree), reason: s.reason })), ...chosen.kept.map((k) => ({ what: `${k.project} of ${k.path}`, reason: k.reason }))];
const logged: string[] = [];
const printKept = () => {
  for (const line of keptLast(kept, logged)) console.log(line);
};
printStale(listed, staleDays);
if (!docker) console.log("Docker is not running: compose projects are not checked (run `pnpm lanes:prune` later).");
if (chosen.remove.length + chosen.branches.length + chosen.projects.length === 0) {
  console.log("Nothing to prune.");
  printKept();
  process.exit(0);
}
// The reasons before the prompt, so the choice is made seeing them; again last (RP-1101).
printKept();
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
  // Its uncommitted changes, unpushed commits and sessions too, which may have changed since the
  // prompt: the running and desktop sessions are read again each time (RP-956, RP-608).
  const changed = changedSinceListed(pruneFacts(listWorktrees(mainRoot).filter((x) => samePath(x.path, w.path)))[0], systemHolders());
  if (changed) {
    logged.push(`Kept ${name(w)}: ${changed}.`);
    continue;
  }
  attempt(w.path, () => {
    if (reportRemoval(w.path, removeLinkedWorktree(w, mainRoot, TARGET))) failed++;
    removedPaths.push(w.path);
  });
}
removeProjectsNow({
  projects: chosen.projects,
  removedPaths,
  listed: { worktrees, containers: docker?.containers ?? [] },
  readNow: (project) => readProjectNow(project, { worktrees: listWorktrees(mainRoot), cwd: here }),
  exists: existsSync,
  remove: (p) =>
    attempt(p.project, () => {
      removeProject(p);
      console.log(`Removed compose project ${p.project}.`);
    }),
  log: (line) => logged.push(line),
});
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
printKept();
if (failed > 0) process.exit(1);
