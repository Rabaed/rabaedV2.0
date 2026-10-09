// Writes .env for this worktree from .env.example with its own ports, so several
// worktrees (parallel Claude Code sessions) can run `pnpm dev` and the tests at once.
//
//   pnpm lane:env <n> [--force] [--free] [--db <suffix>]     n = 0..9, one number per worktree
//
// Lane n uses Postgres 5432+100n, api 4000+100n, Rabaed Admin 4050+100n, web 3000+100n,
// Mailpit 8025+100n, the file store 9000+100n and its own Docker Compose project (container + volume). Lane 0 keeps the defaults.
//
// It refuses a lane whose ports are taken, or whose compose project another worktree
// already uses, and names the holder, saying whether that worktree's branch is already merged
// into origin/main (then `pnpm lanes:prune --merged` frees it). --free takes the next lane that is free instead.
// --db <suffix> (e.g. rp322) names the three database URLs rabaed_<suffix>, so the seam suites
// use rabaed_<suffix>_test: several worktrees of one lane (e.g. /implement-spec's implementer
// subagents) can share its Postgres without migrating the same database. A --db run may share
// a lane with another worktree, but only the lane owner's own implementer subagents use it:
// a session whose lane another session holds takes --free or runs lanes:prune. Without --db
// the .env is as before.
// It also warns (never refuses) when another local branch, worktree or origin branch starts with the
// same RP-nnn- key as this worktree's branch: another session may already have claimed that ticket (RP-499).
// With --force, a lane whose compose project belongs only to worktrees that are gone, or merged into origin/main
// and clean, is taken over instead of refused: their containers are removed, the volumes (the database) kept,
// and the output says which worktree it came from. A worktree with uncommitted changes, or not merged, still
// refuses (RP-500).
// `pnpm lanes:prune` removes the compose projects old worktrees left behind;
// `pnpm lanes:drop-dbs` drops the --db databases of worktrees that are gone.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { claimWarnings, currentBranch, realClaimGit } from "./lane-claims.ts";
import { firstFreeLane, isValidDbSuffix, laneClashes, laneEnv, laneHolders, lanePorts, laneProject, listContainers, chooseTakeover, releaseContainers, takenLanePorts } from "./lanes.ts";
import { samePath } from "./paths.ts";
import { branchMerged, gitDirty, listWorktrees, refExists, type Worktree } from "./worktrees.ts";

const args = process.argv.slice(2);
const force = args.includes("--force");
const free = args.includes("--free");
const dbAt = args.indexOf("--db");
const db = dbAt === -1 ? undefined : args[dbAt + 1];
const positional = args.filter((a, i) => !a.startsWith("--") && !(dbAt !== -1 && i === dbAt + 1));
const n = positional.length === 0 && free ? 1 : Number(positional[0]);
if (
  !Number.isInteger(n) ||
  n < 0 ||
  n > 9 ||
  positional.length > 1 ||
  args.some((a) => a.startsWith("--") && !["--force", "--free", "--db"].includes(a)) ||
  (dbAt !== -1 && !isValidDbSuffix(db))
) {
  console.error("Usage: pnpm lane:env <n> [--force] [--free] [--db <suffix>]   (n = 0..9, one per worktree; suffix: lowercase letters and digits, e.g. rp322)");
  process.exit(1);
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

/** For each worktree holding lane n: whether its branch is merged into origin/main, and how to free the lane. */
function holderStatus(lane: number): string[] {
  const holders = laneHolders(lane, check);
  if (holders.length === 0) return [];
  let worktrees: Worktree[] = [];
  try {
    worktrees = listWorktrees();
  } catch {
    return [];
  }
  const mainRoot = worktrees[0]?.path ?? ".";
  const hasOriginMain = refExists("origin/main", mainRoot);
  return holders.map((dir) => {
    const w = worktrees.find((x) => samePath(x.path, dir));
    if (!w) return `  ${dir} is not a worktree of this clone (or is gone): \`pnpm lanes:prune\` frees the lane.`;
    if (!w.branch) return `  ${dir} has a detached HEAD.`;
    if (!hasOriginMain) return `  ${dir} is on ${w.branch}; run \`git fetch origin main\` to see whether it is merged.`;
    return branchMerged(w.branch, "origin/main", mainRoot)
      ? `  ${dir} is on ${w.branch}, already merged into origin/main: free the lane with \`pnpm lanes:prune --merged\`, then re-run.`
      : `  ${dir} is on ${w.branch}, not merged into origin/main yet: its session may still need the lane.`;
  });
}

/**
 * --force (RP-500): when only containers of worktrees that are gone, or merged into origin/main and
 * clean, hold lane n, removes those containers (never the volumes) so this worktree's compose up
 * recreates them in the same project with the database. Returns whether the lane is free now.
 */
function takeOverLane(lane: number, clashes: string[]): boolean {
  let worktrees: Worktree[];
  try {
    worktrees = listWorktrees();
  } catch {
    return false;
  }
  const mainRoot = worktrees[0]?.path ?? ".";
  const merged = refExists("origin/main", mainRoot);
  const holders = laneHolders(lane, check);
  const facts = worktrees.map((w) => ({
    path: w.path,
    branch: w.branch,
    exists: existsSync(w.path),
    merged: merged && w.branch !== undefined && w.branch !== "main" && !samePath(w.path, mainRoot) && branchMerged(w.branch, "origin/main", mainRoot),
    dirty: holders.some((h) => samePath(h, w.path)) && existsSync(w.path) && gitDirty(w.path),
  }));
  const choice = chooseTakeover(lane, { containers: check.containers, worktrees: facts, cwd: check.cwd, exists: existsSync });
  if (choice.refused.length > 0) {
    for (const line of choice.refused) console.error(`  ${line}`);
    return false;
  }
  if (choice.takeOver.length === 0) return false;
  // The ports those containers hold are free once they are gone.
  const freed = new Set(choice.takeOver.flatMap((c) => c.ports));
  const after = { ...check, containers: check.containers.filter((c) => !choice.takeOver.includes(c)), takenPorts: new Set([...check.takenPorts].filter((p) => !freed.has(p))) };
  if (laneClashes(lane, after).length > 0) return false;
  releaseContainers(choice.takeOver);
  console.log(`Took lane ${lane} over from ${choice.from.join(", ")}: removed its containers, kept the volumes (database) of ${laneProject(lane)}.`);
  return clashes.length > 0;
}

let lane = n;
let clashes = clashesOf(n);
if (clashes.length > 0 && force && takeOverLane(n, clashes)) clashes = [];
if (clashes.length > 0) {
  const next = firstFreeLane(n, clashesOf);
  const prune = "`pnpm lanes:prune` removes rabaed-* compose projects whose worktree is gone or that are not running.";
  const why = `Lane ${n} is not free:\n${clashes.map((c) => `  - ${c}`).join("\n")}`;
  if (!free || next === undefined) {
    console.error(why);
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
