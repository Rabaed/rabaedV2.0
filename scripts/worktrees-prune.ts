// Removes what merged PRs leave behind (RP-308). After `git fetch --prune origin`:
//   1. every worktree merged into origin/main, by the finished rule lane:env, lanes:prune
//      and worktrees:clean share (worktrees.ts isFinished, RP-585: a branch never committed
//      to counts once nothing holds it), or whose upstream is gone (desktop-app
//      worktrees under .claude/worktrees/ only when merged), with its folder and its
//      branch, then its rabaed-* compose project (containers, volumes, network) once
//      the worktree is removed;
//   2. every other local branch merged into origin/main and checked out nowhere
//      (merge-base --is-ancestor origin/main, or merges of it only: worktrees.ts mergedInto, then
//      `git branch -D`), never main;
//   3. the orphaned compose projects lanes:prune finds;
//   4. the rabaed-stories-* volumes of the worktrees it removes and of those git no longer lists (RP-1120).
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
// RP-1120: it also removes the rabaed-stories-* volumes `pnpm test:stories:linux` keeps
// (stories-volumes.ts): those of each worktree it removes, and the orphaned sets, whose hash
// matches no worktree git lists with its folder present. A set whose worktree still exists, the
// main checkout's included, stays; a volume a container uses is skipped and named, never forced.
//
// RP-1170: while a verify runs anywhere on the machine (verifies-running.ts) no volume is removed:
// the compose projects lose their containers and networks only, and the stories volumes stay; the
// stories sets go one at a time with a pause, stopping at the first that times out.
//
// RP-1198: a worktree whose only commits beyond origin/main are merges of it (`git cherry` empty) has
// nothing unpushed or unmerged, so it goes, and its branch with it (worktrees.ts mergesOnly). A merged
// worktree outside .claude/worktrees/ is removed only by `git worktree remove` without --force: one git
// keeps (uncommitted or untracked files) is kept and named, its folder untouched (removal-guard.ts).
//
// Of the skipped worktrees it also lists, read-only, the stale ones: nothing committed
// or changed for --stale-days (default 7), with age, branch and the lock's pid state (RP-506).
//
//   pnpm worktrees:prune [--stale-days <n>] [--yes] [--dry-run]     --yes skips the confirmation; --dry-run only lists
// RP-1198: after its arguments, before the fetch, it stops when this checkout is too far behind origin/main (behind-origin.ts).
import { existsSync } from "node:fs";
import { stopIfBehindOrigin } from "./behind-origin.ts";
import { confirmOrExit } from "./confirm.ts";
import { systemHolders } from "./claude-sessions.ts";
import { listContainers, listVolumes, projectOfFolder, readProjectNow, removeProject } from "./lanes.ts";
import { samePath } from "./paths.ts";
import { keptLast, shallowRefusal } from "./prune-guards.ts";
import { chooseStoriesVolumes, describeCount, inUseLine, listVolumeMounts, removeStoriesVolumesNow, storiesSets, storiesVolumesIn } from "./stories-volumes.ts";
import { STORIES_VOLUME_PREFIX } from "./stories-hash.ts";
import { verifiesRunningNow, volumesKeptReason } from "./verifies-running.ts";
import { DEFAULT_STALE_DAYS, printStale, staleDaysAt } from "./worktrees-stale.ts";
import { changedSinceListed, choosePrune, removeProjectsNow, type PruneWorktree } from "./worktrees-pruning.ts";
import {
  CURRENT_WORKTREE,
  currentRoot,
  deleteBranch,
  fetchPrune,
  gatherFacts,
  gitError,
  isShallowRepo,
  listWorktrees,
  localBranches,
  mergedInto,
  pruneWorktrees,
  refExists,
  removeLinkedWorktree,
  reportRemoval,
  systemLiveness,
  unlessMergesOnly,
  unpushedCount,
  type Worktree,
} from "./worktrees.ts";

const TARGET = "origin/main";
const usage = "Usage: pnpm worktrees:prune [--stale-days <n>] [--yes] [--dry-run]";
const args = process.argv.slice(2);
let yes = false;
let dryRun = false;
let staleDays = DEFAULT_STALE_DAYS;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  const days = staleDaysAt(args, i);
  if (a === "--yes") yes = true;
  else if (a === "--dry-run") dryRun = true;
  else if (days !== undefined) {
    staleDays = days;
    i++;
  } else {
    console.error(usage);
    process.exit(1);
  }
}
stopIfBehindOrigin("pnpm worktrees:prune");

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
    // RP-1198: merges of origin/main only are not unpushed work (gatherFacts' ahead leaves them out too).
    unpushed: unlessMergesOnly(unpushedCount(w.head, mainRoot), w.head, mainRoot, TARGET),
    project: projectOfFolder(w.path),
  }));
const worktrees = pruneFacts(listWorktrees(mainRoot));
const containers = listContainers();
const docker = containers && { containers, volumes: listVolumes(), currentProject: projectOfFolder(here) };
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
// RP-1120: the stories volumes of the worktrees it removes and of those git no longer lists; the
// worktrees it removes do not count as existing here, and are checked again just before.
const toRemove = chosen.remove.map((w) => w.path);
const storiesVolumes = docker && storiesVolumesIn(docker.volumes.map((v) => v.name));
const storiesMounts = storiesVolumes && listVolumeMounts();
const stories =
  storiesVolumes && storiesMounts
    ? chooseStoriesVolumes({
        volumes: storiesVolumes,
        existing: worktrees.map((w) => w.path).filter((p) => existsSync(p) && !toRemove.some((r) => samePath(r, p))),
        mountedBy: storiesMounts,
        orphans: true,
        gone: toRemove,
      })
    : { remove: [], inUse: [] };
kept.push(...stories.inUse.map(inUseLine));
printStale(listed, staleDays);
if (!docker) console.log("Docker is not running: compose projects and stories volumes are not checked (run `pnpm worktrees:prune` later).");
else if (!storiesMounts) console.log("Docker did not list the containers: stories volumes are not checked (run `pnpm worktrees:prune` later).");
if (chosen.remove.length + chosen.branches.length + chosen.projects.length + stories.remove.length === 0) {
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
if (stories.remove.length > 0) {
  console.log(`Stories volumes (test:stories:linux's node_modules) of worktrees that are gone or removed above, to remove: ${describeCount(stories.remove)}:`);
  for (const set of storiesSets(stories.remove)) console.log(`  ${STORIES_VOLUME_PREFIX}${set.hash}-* (${set.volumes.length})`);
}
if (dryRun) {
  console.log("Dry run: nothing removed.");
  process.exit(0);
}

// RP-1170, rule 4: no volume is removed while a verify runs anywhere on the machine (bulk removal during
// verifies hung Docker's volume API twice): the projects' containers go, their volumes and the stories volumes stay.
const volumesStay = chosen.projects.length + stories.remove.length > 0 ? volumesKeptReason(verifiesRunningNow()) : undefined;
if (volumesStay !== undefined) console.log(`Volumes kept: ${volumesStay}. Run \`pnpm worktrees:prune\` again once no verify runs to remove them.`);
await confirmOrExit(
  volumesStay !== undefined ? "Remove them, keeping every volume?" : stories.remove.length > 0 ? "Remove them, the stories volumes included? Their databases are lost." : "Remove them? Their databases are lost.",
  { yes, verb: "remove", done: "removed" },
);

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
    // RP-1198: removeLinkedWorktree refuses on its own (the main checkout, lane 7's, an outside worktree git keeps).
    const removal = removeLinkedWorktree(w, mainRoot, TARGET);
    if ("refused" in removal) {
      logged.push(removal.refused);
      return;
    }
    if (reportRemoval(w.path, removal)) failed++;
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
      // removeProject reads the verifies again just before: one may have started since the prompt.
      const removal = removeProject(p, { keepVolumes: volumesStay !== undefined, volumesKeptBecause: () => volumesKeptReason(verifiesRunningNow()) });
      if ("refused" in removal) logged.push(removal.refused);
      else console.log(removal.volumesKept !== undefined ? `Removed compose project ${p.project}'s containers; its volumes stay (${volumesStay ?? removal.volumesKept}).` : `Removed compose project ${p.project}.`);
    }),
  log: (line) => logged.push(line),
});
// RP-1120: only the stories volumes listed above, judged again on the worktrees git lists now
// (one kept since the prompt keeps its set) and the containers using them now. RP-1170: none when
// the prompt said every volume stays, though the verify may have ended since.
if (stories.remove.length > 0 && volumesStay !== undefined) logged.push(`Stories volumes not removed: ${volumesStay}; run \`pnpm worktrees:prune\` again once no verify runs.`);
else if (stories.remove.length > 0) {
  const existingNow = listWorktrees(mainRoot)
    .map((w) => w.path)
    .filter((p) => existsSync(p));
  const result = removeStoriesVolumesNow({ orphans: true, only: new Set(stories.remove) }, existingNow);
  if (result.removed.length > 0) console.log(`Removed stories volumes: ${describeCount(result.removed)}.`);
  logged.push(...result.kept);
  for (const e of result.errors) console.error(e);
  failed += result.errors.length;
}
for (const b of chosen.branches) {
  attempt(`branch ${b}`, () => {
    // removeLinkedWorktree may have deleted it already (a worktree-agent-* branch).
    if (!refExists(`refs/heads/${b}`, mainRoot)) return;
    // RP-1198 review P2: a branch that only merged origin/main in, with no worktree, goes too (S2's merge-tree check included).
    if (!mergedInto(b, TARGET, mainRoot)) throw new Error(`${b} has commits ${TARGET} does not`);
    const refused = deleteBranch(b, mainRoot);
    if (refused !== undefined) logged.push(refused.refused);
    else console.log(`Removed branch ${b}.`);
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
