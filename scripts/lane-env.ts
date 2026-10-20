// Writes .env for this worktree from .env.example with its own ports, so several
// worktrees (parallel Claude Code sessions) can run `pnpm dev` and the tests at once.
//
//   pnpm lane:env <n> [--force] [--free] [--db <suffix>]     one lane number per worktree
//
// A lane number is mL (RP-602): m the Main session 1–5, L = 0 for the Main itself, 1–4 for its
// lanes A–D; 0 is the main folder's, and the legacy 1–9 still work. Any other number is refused.
// Lane n uses each default port plus 10n (Postgres 5432, api 4000, Rabaed Admin 4050, web 3000,
// Mailpit 8025, the file store 9000; legacy lanes plus 100n, so lane m0 = lane m) and its own
// Docker Compose project (container + volume). Lane 0 keeps the defaults.
//
// It refuses a lane whose ports are taken, or whose compose project another worktree
// already uses, and names the holder, saying whether that worktree's branch (or detached HEAD, RP-601) is already merged
// into origin/main (then `pnpm lanes:prune --merged --lane N` frees just that lane, unless a worktree that is not
// merged names the lane in its .env: prune keeps it, so that worktree is named instead). --free takes the next lane that is free instead,
// preferring the same Main's lanes m1–m4. Legacy lane m and lane m0 clash with each other's containers, as they share ports.
// --db <suffix> (e.g. rp322) names the three database URLs rabaed_<suffix>, so the seam suites
// use rabaed_<suffix>_test: several worktrees of one lane (e.g. /implement-spec's implementer
// subagents) can share its Postgres without migrating the same database. A --db run may share
// a lane with another worktree, but only the lane owner's own implementer subagents use it:
// a session whose lane another session holds takes --free or runs lanes:prune. Without --db
// the .env is as before.
// It also refuses, even with --force, a worktree locked by another live `claude session` (RP-501).
// It also warns (never refuses) when another local branch, worktree or origin branch starts with the
// same RP-nnn- key as this worktree's branch: another session may already have claimed that ticket (RP-499).
// With --force, a lane whose compose project belongs only to worktrees that are gone, or merged into origin/main
// and clean, is taken over instead of refused: their containers are removed, the volumes (the database) kept,
// and the output says which worktree it came from. A worktree with uncommitted changes, not merged, locked by a
// session that still runs, with a running Claude session in its folder (named; RP-956), whose Claude desktop
// session is open (named; RP-612), or sharing the lane
// through its .env still refuses; so does any --db run (RP-500).
// "Merged" is the finished rule lanes:prune, worktrees:clean and worktrees:prune share (worktrees.ts isFinished,
// RP-585): a branch never committed to whose tip is in origin/main counts once it is clean, carries no live lock and
// no running process holds its folder, and the takeover line says so.
// `pnpm lanes:prune` removes the compose projects old worktrees left behind;
// `pnpm lanes:drop-dbs` drops the --db databases of worktrees that are gone.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readDesktopSessions } from "./desktop-sessions.ts";
import { claimWarnings, currentBranch, realClaimGit } from "./lane-claims.ts";
import {
  chooseTakeover,
  clashesAfterRemoval,
  composeProjectOfEnv,
  firstFreeLane,
  holderAdvice,
  holdsLaneProject,
  laneClashes,
  laneEnv,
  laneHolders,
  lanePorts,
  laneProject,
  laneProjects,
  listContainers,
  parseLaneEnvArgs,
  releaseContainers,
  takenLanePorts,
  type TakeoverWorktree,
} from "./lanes.ts";
import { samePath } from "./paths.ts";
import { foreignSessionLock, listeningPid, ownServerHint, parseSessionLock, readProcessList, sessionPidOf } from "./session-lock.ts";
import { currentRoot, gitDirty, gitError, judgeWorktree, listWorktrees, NOT_FINISHED, refExists, systemLiveness, type Verdict, type Worktree } from "./worktrees.ts";

const parsed = parseLaneEnvArgs(process.argv.slice(2));
if ("error" in parsed) {
  console.error(parsed.error);
  process.exit(1);
}
const { lane: n, force, free, db } = parsed;
// A worktree locked by another live Claude session belongs to that session; --force does not override this (RP-501).
let locked: string | undefined;
try {
  locked = listWorktrees().find((w) => samePath(w.path, currentRoot()))?.locked;
} catch {
  // Not a git checkout, or git is missing: nothing to check.
}
if (parseSessionLock(locked)) {
  let refusal: string | undefined;
  try {
    refusal = foreignSessionLock(locked, process.pid, readProcessList(), sessionPidOf(process.env));
  } catch (e) {
    console.warn(`Session-lock check skipped (${e instanceof Error ? e.message.split("\n")[0] : String(e)}), so a live Claude session holding this worktree would not be noticed.`);
  }
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
}
if (existsSync(".env") && !force) {
  console.error(".env already exists. Re-run with --force to overwrite it.");
  process.exit(1);
}

for (const warning of claimWarnings(realClaimGit, process.cwd(), currentBranch())) console.warn(`Warning: ${warning}`);

const containers = listContainers();
if (!containers) console.warn("Docker is not running, so only the ports were checked, not the compose projects.");
const check = { containers: containers ?? [], takenPorts: await takenLanePorts(), cwd: process.cwd(), ownDatabase: db !== undefined };
const clashesOf = (lane: number) => laneClashes(lane, check);

const live = systemLiveness();

/**
 * Whether a worktree is finished against origin/main (worktrees.ts isFinished, the rule lanes:prune,
 * worktrees:clean and worktrees:prune share; RP-585), on a branch or a detached HEAD (RP-601). Never the main checkout or a worktree on main.
 */
const verdictOf = (w: Worktree, mainRoot: string): Verdict =>
  w.branch === "main" || samePath(w.path, mainRoot) ? NOT_FINISHED : judgeWorktree(w, "origin/main", mainRoot, live);

/** For each worktree holding lane n: whether its branch is merged into origin/main, and how to free the lane. */
function holderStatus(lane: number): string[] {
  const holders = laneHolders(lane, check);
  if (holders.length === 0) return [];
  let worktrees: Worktree[];
  try {
    worktrees = listWorktrees();
  } catch {
    return [];
  }
  const mainRoot = worktrees[0]?.path ?? ".";
  const hasOriginMain = refExists("origin/main", mainRoot);
  // Only the holders and the worktrees whose .env names the lane: lanes:prune --merged keeps the lane for the latter.
  const relevant = worktrees
    .map((w) => ({ w, project: existsSync(join(w.path, ".env")) ? composeProjectOfEnv(readFileSync(join(w.path, ".env"), "utf8")) : undefined }))
    .filter(({ w, project }) => (project !== undefined && laneProjects(lane).includes(project)) || holders.some((dir) => samePath(w.path, dir)))
    .map(({ w, project }) => ({
      path: w.path,
      branch: w.branch,
      merged: hasOriginMain && verdictOf(w, mainRoot).finished,
      project,
    }));
  return holderAdvice(lane, holders, { worktrees: relevant, hasOriginMain, cwd: check.cwd, containers: check.containers });
}

/** RP-545: lane n's taken ports held by a process of this session itself (its own pnpm demo / dev), with the command to stop it. */
function ownServerHints(lane: number): string[] {
  const hints: string[] = [];
  try {
    const processes = readProcessList();
    for (const port of Object.values(lanePorts(lane))) {
      if (!check.takenPorts.has(port)) continue;
      const pid = listeningPid(port);
      const hint = pid === undefined ? undefined : ownServerHint(port, pid, process.pid, processes, sessionPidOf(process.env));
      if (hint) hints.push(hint);
    }
  } catch {
    // The process list cannot be read: the plain refusal stands.
  }
  return hints;
}

/**
 * --force (RP-500): when only containers of worktrees that are gone, or merged into origin/main and
 * clean, hold lane n, removes those containers (never the volumes) so this worktree's compose up
 * recreates them in the same project with the database. Returns whether the lane is free now.
 */
function takeOverLane(lane: number): boolean {
  let worktrees: Worktree[];
  try {
    worktrees = listWorktrees();
  } catch {
    return false;
  }
  const mainRoot = worktrees[0]?.path ?? ".";
  const hasOriginMain = refExists("origin/main", mainRoot);
  const readEnv = (dir: string) => {
    const file = join(dir, ".env");
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  };
  const facts = worktrees.map((w): TakeoverWorktree => {
    const exists = existsSync(w.path);
    const project = exists ? composeProjectOfEnv(readEnv(w.path)) : undefined;
    const holds = holdsLaneProject(lane, check.containers, w.path);
    // chooseTakeover reads merged only for holders and for worktrees whose .env names the lane.
    const { finished, neverCommitted } = hasOriginMain && (holds || project === laneProject(lane)) ? verdictOf(w, mainRoot) : NOT_FINISHED;
    let dirty = false;
    let statusError: string | undefined;
    // Every worktree with a container of the lane's project, whether or not laneHolders counts it.
    if (exists && holds) {
      try {
        dirty = gitDirty(w.path);
      } catch (error) {
        dirty = true;
        statusError = gitError(error);
      }
    }
    return {
      path: w.path,
      branch: w.branch,
      exists,
      merged: finished,
      neverCommitted,
      dirty,
      ...(statusError === undefined ? {} : { statusError }),
      locked: w.locked,
      project,
      // RP-956: a running Claude session in a holder's folder refuses the takeover, and is named.
      heldBySession: exists && holds ? live.heldBySession?.(w.path) : undefined,
    };
  });
  // RP-612: an open Claude desktop session in a holder refuses the takeover, and is named.
  const choice = chooseTakeover(lane, { containers: check.containers, worktrees: facts, cwd: check.cwd, exists: existsSync, pidRunning: live.pidLive, openSession: readDesktopSessions() });
  if (choice.refused.length > 0) {
    for (const line of choice.refused) console.error(`  ${line}`);
    return false;
  }
  if (choice.takeOver.length === 0) return false;
  if (clashesAfterRemoval(lane, check, choice.takeOver).length > 0) return false;
  try {
    releaseContainers(choice.takeOver);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  const taken = [...new Set(choice.takeOver.map((c) => c.project))];
  console.log(`Took lane ${lane} over from ${choice.from.join(", ")}: removed its containers, kept the volumes (database) of ${taken.join(", ")}.`);
  // The twin lane's project (legacy m for m0, or m0 for m): its database stays in its volumes, and lane n's project starts a new one (RP-605).
  if (taken.some((p) => p !== laneProject(lane))) console.log(`${laneProject(lane)} starts with a database of its own; \`pnpm lanes:prune\` removes the volumes left behind.`);
  return true;
}

let lane = n;
let clashes = clashesOf(n);
// Not with --db: an implementer subagent shares its session's lane and must not take one.
if (clashes.length > 0 && force && db === undefined && takeOverLane(n)) clashes = [];
if (clashes.length > 0) {
  const next = firstFreeLane(n, clashesOf);
  const prune = "`pnpm lanes:prune` removes rabaed-* compose projects whose worktree is gone or that are not running.";
  const why = `Lane ${n} is not free:\n${clashes.map((c) => `  - ${c}`).join("\n")}`;
  if (!free || next === undefined) {
    console.error(why);
    for (const line of ownServerHints(n)) console.error(line);
    for (const line of holderStatus(n)) console.error(line);
    console.error(next === undefined ? `No lane is free. ${prune}` : `Lane ${next} is free: pnpm lane:env ${next}${force ? " --force" : ""} (or add --free). ${prune}`);
    process.exit(1);
  }
  console.log(`${why}\nUsing lane ${next}, the next free one.`);
  lane = next;
}

const { postgres: pg, api, admin, web, mailpit, files } = lanePorts(lane);

writeFileSync(".env", laneEnv(readFileSync(".env.example", "utf8"), lane, db));
console.log(`Wrote .env for lane ${lane}${db ? `, database rabaed_${db}` : ""}: Postgres ${pg}, api ${api}, Rabaed Admin ${admin}, web ${web}, Mailpit ${mailpit}, file store ${files}, compose project ${laneProject(lane)}.`);
console.log(`Open the web app at http://lane${lane}.localhost:${web}/en (its own host keeps sign-in cookies separate).`);
