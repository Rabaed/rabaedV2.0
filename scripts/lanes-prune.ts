// Removes the rabaed-* Docker Compose projects old worktrees left behind: those whose
// worktree no longer exists, that are not running, or that only have volumes left.
// With --merged, also those whose worktrees are all merged into origin/main (their branch, or a detached HEAD's commit, RP-601)
// (as of the last fetch), unless a worktree that is not merged names the project in its .env. A merged
// worktree with uncommitted or untracked files is not merged (RP-1101): its project stays, listed with
// the files. A project stays, named with the session, while a running Claude session works in one of its
// existing folders (RP-956; stale projects too since RP-1101) or its Claude desktop session is open
// (RP-612), or when they cannot be checked; that is read again just before each removal.
// Each goes with its containers, volumes (its database) and network. The current
// worktree's project is never removed, nor, in any mode, one that another existing worktree's .env
// names while it is not running or has only volumes left (RP-1007): that worktree is named instead.
// Just before each removal it checks again (RP-1073): a worktree's .env naming it now, a container of
// it started from an existing folder, Docker not answering, or a connection to its Postgres
// keeps it. With --lane N such a keep at listing exits 1.
// RP-1101: lane 7 (Main 7's harness data) is never a candidate and `--lane 7` is refused; a bare
// `--merged --yes` (no --lane N) is refused (RP-1007); --merged refuses on a shallow clone. What
// was kept is printed last, with why, so a `| tail` keeps the reasons.
//
//   pnpm lanes:prune [--merged] [--lane N] [--yes] [--dry-run]     --yes skips the confirmation; --dry-run only lists (RP-500)
//   pnpm lanes:prune --stale     a report for session start (RP-1096): running stacks against the cap, stopped
//                                stacks, dead containers, volume-only projects and stray containers; removes nothing
//
// --lane N limits the candidates (stale, plus merged with --merged) to rabaed-laneN, with the
// same confirmation and the same keep rules, so one lane is freed without touching the others (RP-505).
//
// RP-1122: without --lane N it also removes the veraPDF containers of test runs that were killed or
// timed out (verapdf-containers.ts): those whose test process no longer runs, read again just before
// each removal. One whose process runs, or of a worktree holding lane 7, stays and is named.
import { existsSync } from "node:fs";
import { confirmOrExit } from "./confirm.ts";
import { systemHolders } from "./claude-sessions.ts";
import {
  chooseMerged,
  composeProjectOfEnv,
  envClaims,
  keptByClaims,
  laneKeptByClaim,
  LANE_SCHEME,
  laneProject,
  listContainers,
  listVolumes,
  onlyLane,
  parsePruneArgs,
  projectInUseNow,
  readProjectNow,
  readWorktreeEnv,
  removeProject,
  staleProjects,
  type KeptProject,
  type StaleProject,
  type Volume,
} from "./lanes.ts";
import { maxStacks, staleReport } from "./machine-load.ts";
import { DOCKER_TIMEOUT_MS } from "./verify-health.ts";
import { bareMergedYesRefusal, guardCandidates, keptLast, laneRefusal, mergedLanes, sessionHeldProject, shallowRefusal, type JudgedLane } from "./prune-guards.ts";
import { gitChanges, isShallowRepo, judgeWorktree, listWorktrees, refExists, systemLiveness } from "./worktrees.ts";
import { pidAlive } from "./lanes-lock.ts";
import { chooseVeraPdfContainers, listVeraPdfContainers, protectedHashes, removeVeraPdfContainer, type Orphan } from "./verapdf-containers.ts";

const usage = `Usage: pnpm lanes:prune [--merged] [--lane N] [--yes] [--dry-run], or pnpm lanes:prune --stale   (--lane N: only rabaed-laneN; ${LANE_SCHEME})`;
const argv = process.argv.slice(2);

// RP-1096: --stale only reports, and removes nothing (lane 7 included, marked as Main 7's).
if (argv.includes("--stale")) {
  if (argv.length > 1) {
    console.error(`--stale is a report on its own.\n${usage}`);
    process.exit(1);
  }
  const listed = listContainers(DOCKER_TIMEOUT_MS);
  let volumes: Volume[] | undefined;
  try {
    volumes = listed && listVolumes(DOCKER_TIMEOUT_MS);
  } catch {
    volumes = undefined;
  }
  if (!listed || !volumes) {
    console.error(`Docker is not answering (no answer in ${DOCKER_TIMEOUT_MS / 1000} s): it is stopped or jammed. Tell your Main; do not restart it yourself.`);
    process.exit(1);
  }
  try {
    for (const line of staleReport({ containers: listed, volumes, exists: existsSync, max: maxStacks(process.env) })) console.log(line);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  process.exit(0);
}

const options = parsePruneArgs(argv);
if (!options) {
  console.error(usage);
  process.exit(1);
}
const refused = laneRefusal(options.lane) ?? bareMergedYesRefusal(options);
if (refused !== undefined) {
  console.error(refused);
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
const inScope = (project: string) => lane === undefined || project === laneProject(lane);
/** What was kept, with why: printed last (RP-1101), so it is not cut off. */
const kept: { what: string; reason: string }[] = [];
const keep = (k: KeptProject) => {
  if (inScope(k.project)) kept.push({ what: `${k.project} of ${k.path}`, reason: k.reason });
};
const printKept = () => {
  for (const line of keptLast(kept)) console.log(line);
};

/** Every other worktree's .env claim (RP-1007), read now; a project one names is not pruned as stale. */
const claims = envClaims(listWorktrees().filter((w) => existsSync(w.path)), { cwd: process.cwd(), readEnv: readWorktreeEnv });
const { prune: stale, kept: claimed } = keptByClaims(staleProjects({ containers, volumes, cwd: process.cwd(), currentProject, exists: existsSync }), claims);
/** The projects --merged adds (none without it); a claimed project it adds is not reported as kept. */
let fresh: StaleProject[] = [];
let holders = systemHolders();

if (withMerged) {
  const all = listWorktrees();
  const mainRoot = all[0]!.path;
  const shallow = shallowRefusal(isShallowRepo(mainRoot), "lanes:prune --merged");
  if (shallow !== undefined) {
    console.error(shallow);
    process.exit(1);
  }
  if (!refExists("origin/main", mainRoot)) {
    console.error("origin/main not found: run `git fetch origin main` and re-run.");
    process.exit(1);
  }
  // The main folder, and any worktree on main itself, always keeps its lane. Merged is the finished rule
  // lane:env, worktrees:clean and worktrees:prune share (worktrees.ts isFinished, RP-585), with nothing
  // uncommitted or untracked (RP-1101).
  const live = systemLiveness();
  holders = live.holders;
  const judged: JudgedLane[] = all
    .filter((w) => existsSync(w.path))
    .map((w, i) => {
      const finished = i > 0 && w.branch !== "main" && judgeWorktree(w, "origin/main", mainRoot, live).finished;
      return { path: w.path, branch: w.branch, finished, changes: finished ? changesOf(w.path) : [], project: composeProjectOfEnv(readWorktreeEnv(w.path) ?? "") };
    });
  const { worktrees, kept: dirty } = mergedLanes(judged);
  const known = new Set(stale.map((s) => s.project));
  // RP-956, RP-612: a holder a running or desktop Claude session holds keeps its project; name the session.
  const { merged, kept: held } = chooseMerged({ containers, volumes, worktrees, cwd: process.cwd(), currentProject, holders });
  fresh = merged.filter((m) => !known.has(m.project));
  stale.push(...fresh);
  for (const k of [...dirty, ...held]) if (!known.has(k.project)) keep({ ...k, reason: `not pruned as merged: ${k.reason}` });
}

for (const k of claimed) if (!fresh.some((m) => m.project === k.project)) keep(k);
// --lane N's own project kept for a claim is a refusal: exit 1.
const laneRefused = laneKeptByClaim(lane, claimed, fresh);

// RP-1101: never lane 7, nor a project whose existing folder a Claude session works in.
const guarded = guardCandidates(onlyLane(stale, lane), containers, holders, existsSync);
guarded.kept.forEach(keep);
const candidates = guarded.prune;
// RP-1122: they belong to no lane, so --lane N leaves them.
const veraPdf = lane === undefined ? veraPdfCandidates() : [];
if (candidates.length === 0 && veraPdf.length === 0) {
  console.log(lane === undefined ? "Nothing to prune." : `Nothing to prune for lane ${lane}.`);
  printKept();
  process.exit(laneRefused ? 1 : 0);
}
if (candidates.length > 0) console.log("Compose projects to prune:");
for (const s of candidates) {
  console.log(`  ${s.project}: ${s.reason}; containers: ${s.containers.join(", ") || "none"}; volumes: ${s.volumes.join(", ") || "none"}`);
}
if (veraPdf.length > 0) console.log("veraPDF containers of killed or timed-out test runs to remove:");
for (const c of veraPdf) console.log(`  ${c.name}: its test process (pid ${c.pid}) is gone; ${c.state}, started ${c.age}`);
// The reasons before the prompt, so the choice is made seeing them; again last (RP-1101).
printKept();

if (options.dryRun) {
  console.log("Dry run: nothing removed.");
  process.exit(0);
}

const question =
  candidates.length > 0 ? "Remove them with their volumes? Their databases are lost, including those of stopped worktrees that still exist." : "Remove them? They only sleep; nothing in them is kept.";
await confirmOrExit(question, {
  yes: options.yes,
  verb: "remove",
  done: "removed",
});

let failed = 0;
for (const s of candidates) {
  // Read again just before: a session may have moved into or opened one of its folders since the prompt.
  const held = sessionHeldProject(s, containers, systemHolders(), existsSync, { sinceListed: true });
  if (held !== undefined) {
    kept.push({ what: s.project, reason: `${held.path}: ${held.reason}` });
    continue;
  }
  // RP-1007, RP-1073: and since the prompt a lane:env may have written a .env naming it, or a session started or connected to it.
  const inUse = projectInUseNow(s.project, { listedClaims: claims, listedContainers: containers, now: readProjectNow(s.project, { worktrees: listWorktrees(), cwd: process.cwd() }), exists: existsSync });
  if (inUse !== undefined) {
    kept.push({ what: s.project, reason: inUse });
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
for (const c of veraPdf) {
  // Read again just before: a new test process may have been given its pid since the listing.
  if (pidAlive(c.pid)) {
    kept.push({ what: c.name, reason: `its test process (pid ${c.pid}) runs again` });
    continue;
  }
  try {
    removeVeraPdfContainer(c.name);
    console.log(`Removed ${c.name}.`);
  } catch (error) {
    failed++;
    console.error(`Could not remove ${c.name}: ${(error as { stderr?: string }).stderr?.trim() || String(error)}`);
  }
}
printKept();
if (failed > 0) process.exit(1);

/** RP-1122: the veraPDF containers to remove; those kept go to `kept`, with why. */
function veraPdfCandidates(): Orphan[] {
  const listed = listVeraPdfContainers(DOCKER_TIMEOUT_MS);
  if (!listed) {
    kept.push({ what: "veraPDF containers", reason: "Docker did not list them; none removed" });
    return [];
  }
  const worktrees = listWorktrees()
    .filter((w) => existsSync(w.path))
    .map((w) => ({ path: w.path, project: composeProjectOfEnv(readWorktreeEnv(w.path) ?? "") }));
  const { remove, kept: stays } = chooseVeraPdfContainers({ containers: listed, alive: pidAlive, protectedHashes: protectedHashes(worktrees) });
  kept.push(...stays);
  return remove;
}

/** A worktree's uncommitted changes; one that git cannot read counts as changed, so its project stays. */
function changesOf(path: string): string[] {
  try {
    return gitChanges(path);
  } catch {
    // eslint-disable-next-line rabaed/no-avoid-terms -- the git command, by its own name.
    return ["git status could not be read"];
  }
}
