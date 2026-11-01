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
// RP-1197: before any docker call it probes Docker (docker-probe.ts) and stops only if it hangs, with "Docker not answering: wait, don't restart it (RP-1099)"; Docker down keeps the old warning.
// The stack cap's refusal names each running stack with its idle time (stack-idle.ts).
// It also refuses, even with --force, a worktree locked by another live `claude session` (RP-501).
// It also warns (never refuses) when another local branch, worktree or origin branch starts with the
// same RP-nnn- key as this worktree's branch: another session may already have claimed that ticket (RP-499).
// With --force, a lane whose compose project belongs only to worktrees that are gone, or merged into origin/main
// and clean, is taken over instead of refused: their containers are removed, the volumes (the database) kept,
// and the output says which worktree it came from. A worktree with uncommitted changes, not merged, locked by a
// session that still runs, with a running Claude session in its folder (named; RP-956; every holder when the
// running sessions cannot be checked), whose Claude desktop session is open (named; RP-612), or sharing the
// lane through its .env still refuses; so does any --db run (RP-500).
// "Merged" is the finished rule lanes:prune, worktrees:clean and worktrees:prune share (worktrees.ts isFinished,
// RP-585): a branch never committed to whose tip is in origin/main counts once it is clean, carries no live lock and
// no running process holds its folder, and the takeover line says so.
// A lane another worktree's .env names is held, even with its containers stopped or gone (RP-1007), and the refusal
// names that worktree; --free skips it. --force takes it over only from a worktree that is merged into origin/main,
// clean and held by no Claude session, and names it (its .env is left as it is).
// Lane 7 holds Main 7's UAT harness data (RP-1101): --free never offers it, not even as the lane asked for,
// and --force never takes it over from another worktree (lanes.ts protectedLaneReason); ask Main 7.
// A plain `lane:env 7` stays Main 7's own.
// RP-1096: it warns when the lane's stack would leave one running-stack slot or none, and refuses
// when RABAED_MAX_STACKS (default 8, machine-load.ts) stacks already run; `pnpm lanes:prune --stale` lists them.
// One lane:env runs at a time per clone (a lock in the common git folder, lanes-lock.ts), from reading the
// lanes until .env is written, so two runs at once never choose the same lane.
// RP-1169: once .env is written it runs `docker compose -p rabaed-laneNN up -d --wait` (lane-env-start.ts), or says plainly
// that it didn't (Docker down, a --db worktree, a failed start) with the exact command to run.
// `pnpm lanes:prune` removes the compose projects old worktrees left behind;
// `pnpm lanes:drop-dbs` drops the --db databases of worktrees that are gone.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DOCKER_PROBE_TIMEOUT_MS, dockerStop, probeDocker } from "./docker-probe.ts";
import { claimWarnings, currentBranch, realClaimGit } from "./lane-claims.ts";
import {
  chooseTakeover,
  clashesAfterRemoval,
  composeProjectOfEnv,
  envClaims,
  firstFreeLane,
  freeLaneClashes,
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
  readWorktreeEnv,
  releaseContainers,
  takenLanePorts,
  type TakeoverWorktree,
} from "./lanes.ts";
import { startStack, systemCompose } from "./lane-env-start.ts";
import { acquireLaneLock, laneLockFile, systemLockDeps } from "./lanes-lock.ts";
import { maxStacks, stackCap, type CapVerdict } from "./machine-load.ts";
import { idleOfStack } from "./stack-idle.ts";
import { DOCKER_TIMEOUT_MS } from "./verify-health.ts";
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

// RP-1007: one lane:env at a time per clone, from reading the lanes until .env is written, so a second
// run sees this run's .env (two --free runs two seconds apart both chose lane 33 on 2026-10-21).
let lockFile: string | undefined;
try {
  lockFile = laneLockFile();
} catch {
  console.warn("Not a git checkout: another lane:env running at the same time would not be noticed.");
}
if (lockFile !== undefined) {
  const lock = acquireLaneLock(lockFile, systemLockDeps());
  if ("error" in lock) {
    console.error(lock.error);
    process.exit(1);
  }
  process.on("exit", lock.release);
}

const live = systemLiveness();
let allWorktrees: Worktree[] = [];
try {
  allWorktrees = listWorktrees();
} catch {
  // Not a git checkout: no other worktree's .env to read.
}
const mainRoot = allWorktrees[0]?.path ?? ".";
const hasOriginMain = allWorktrees.length > 0 && refExists("origin/main", mainRoot);

/**
 * Whether a worktree is finished against origin/main (worktrees.ts isFinished, the rule lanes:prune,
 * worktrees:clean and worktrees:prune share; RP-585), on a branch or a detached HEAD (RP-601). Never the main checkout or a worktree on main.
 */
const verdictOf = (w: Worktree): Verdict =>
  w.branch === "main" || samePath(w.path, mainRoot) ? NOT_FINISHED : judgeWorktree(w, "origin/main", mainRoot, live);

// RP-1197: a jammed Docker hangs every docker call, so probe it first (24 s at most) and stop with what to do (RP-1099).
// Only a hang stops it; Docker down keeps the old path below (ports checked, .env written, with the warning).
const dockerProbe = probeDocker();
const dockerStopped = dockerStop(dockerProbe, "hang");
if (dockerStopped !== undefined) {
  console.error(dockerStopped);
  process.exit(1);
}
// A healthy probe means Docker answers within the probe's timeout, so the listing waits no longer than that.
const containers = listContainers(dockerProbe.ok ? DOCKER_PROBE_TIMEOUT_MS : DOCKER_TIMEOUT_MS);
if (!containers) console.warn("Docker is not running, so only the ports were checked, not the compose projects.");
const check = {
  containers: containers ?? [],
  takenPorts: await takenLanePorts(),
  cwd: process.cwd(),
  ownDatabase: db !== undefined,
  // RP-1007: another worktree whose .env names a lane holds it, even with its containers stopped; only --force takes it over.
  claims: envClaims(allWorktrees, { cwd: process.cwd(), readEnv: readWorktreeEnv }),
};
const clashesOf = (lane: number) => laneClashes(lane, check);

/** For each worktree holding lane n: whether its branch is merged into origin/main, and how to free the lane. */
function holderStatus(lane: number): string[] {
  const holders = laneHolders(lane, check);
  if (holders.length === 0 || allWorktrees.length === 0) return [];
  // Only the holders and the worktrees whose .env names the lane: lanes:prune --merged keeps the lane for the latter.
  const relevant = allWorktrees
    .map((w) => ({ w, project: composeProjectOfEnv(readWorktreeEnv(w.path) ?? "") }))
    .filter(({ w, project }) => (project !== undefined && laneProjects(lane).includes(project)) || holders.some((dir) => samePath(w.path, dir)))
    .map(({ w, project }) => ({
      path: w.path,
      branch: w.branch,
      merged: hasOriginMain && verdictOf(w).finished,
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
  if (allWorktrees.length === 0) return false;
  const facts = allWorktrees.map((w): TakeoverWorktree => {
    const exists = existsSync(w.path);
    const project = exists ? composeProjectOfEnv(readWorktreeEnv(w.path) ?? "") : undefined;
    const holds = holdsLaneProject(lane, check.containers, w.path);
    const namesLane = project !== undefined && laneProjects(lane).includes(project) && !samePath(w.path, check.cwd);
    // chooseTakeover reads merged only for holders and for worktrees whose .env names the lane.
    const { finished, neverCommitted } = hasOriginMain && (holds || namesLane) ? verdictOf(w) : NOT_FINISHED;
    let dirty = false;
    let statusError: string | undefined;
    // Every worktree with a container of the lane's project, whether or not laneHolders counts it, and every one whose .env names it (RP-1007).
    if (exists && (holds || namesLane)) {
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
    };
  });
  // RP-956, RP-612: a running Claude session in a holder's folder, or its open desktop session, refuses the takeover, and is named.
  const choice = chooseTakeover(lane, { containers: check.containers, worktrees: facts, cwd: check.cwd, exists: existsSync, pidRunning: live.pidLive, holders: live.holders });
  if (choice.refused.length > 0) {
    for (const line of choice.refused) console.error(`  ${line}`);
    return false;
  }
  if (choice.takeOver.length === 0 && choice.released.length === 0) return false;
  if (clashesAfterRemoval(lane, check, choice.takeOver, choice.released).length > 0) return false;
  try {
    // RP-1198: it refuses lane 7's and the main checkout's containers itself, removing none.
    const refused = releaseContainers(choice.takeOver);
    if (refused !== undefined) {
      console.error(`  ${refused.refused}`);
      return false;
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  const taken = [...new Set(choice.takeOver.map((c) => c.project))];
  if (taken.length === 0) {
    // RP-1007: only finished worktrees' .env files named the lane; nothing ran, so nothing is removed.
    console.log(`Took lane ${lane} over from ${choice.from.join(", ")}: no containers to remove.`);
    return true;
  }
  console.log(`Took lane ${lane} over from ${choice.from.join(", ")}: removed its containers, kept the volumes (database) of ${taken.join(", ")}.`);
  // The twin lane's project (legacy m for m0, or m0 for m): its database stays in its volumes, and lane n's project starts a new one (RP-605).
  if (taken.some((p) => p !== laneProject(lane))) console.log(`${laneProject(lane)} starts with a database of its own; \`pnpm lanes:prune\` removes the volumes left behind.`);
  return true;
}

let lane = n;
// RP-1101: --free never hands out lane 7, even when asked for it by number.
let clashes = free ? freeLaneClashes(n, clashesOf(n)) : clashesOf(n);
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

// RP-1096: a cap on running stacks (RABAED_MAX_STACKS, default 8; the owner sets it). Near it a
// warning, at it a refusal. The lane's own stack is not another one. Skipped when Docker is not running.
if (containers) {
  let cap: CapVerdict;
  try {
    cap = stackCap(lane, containers, maxStacks(process.env), idleOfStack());
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  if (cap.level === "refuse") {
    console.error(cap.message);
    process.exit(1);
  }
  if (cap.level === "warn") console.warn(`Warning: ${cap.message}`);
}

const { postgres: pg, api, admin, web, mailpit, files } = lanePorts(lane);

writeFileSync(".env", laneEnv(readFileSync(".env.example", "utf8"), lane, db));
console.log(`Wrote .env for lane ${lane}${db ? `, database rabaed_${db}` : ""}: Postgres ${pg}, api ${api}, Rabaed Admin ${admin}, web ${web}, Mailpit ${mailpit}, file store ${files}, compose project ${laneProject(lane)}.`);
console.log(`Open the web app at http://lane${lane}.localhost:${web}/en (its own host keeps sign-in cookies separate).`);

// RP-1169: start the stack too (verifies started on a stack that was down), or say plainly that it wasn't. Under the
// lane lock still, so the stack cap above counted every stack this run could add. A --db worktree shares its lane's stack.
const started = startStack(
  laneProject(lane),
  { dockerRunning: containers !== undefined, compose: systemCompose },
  db === undefined ? undefined : "this --db worktree shares the lane's stack, which belongs to the lane's own session.",
);
for (const line of started.lines) console.log(line);
