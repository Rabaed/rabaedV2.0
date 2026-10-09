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
// It also refuses, even with --force, a worktree locked by another live `claude session` (RP-501).
// `pnpm lanes:prune` removes the compose projects old worktrees left behind;
// `pnpm lanes:drop-dbs` drops the --db databases of worktrees that are gone.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { firstFreeLane, isValidDbSuffix, laneClashes, laneEnv, laneHolders, lanePorts, laneProject, listContainers, takenLanePorts } from "./lanes.ts";
import { samePath } from "./paths.ts";
import { foreignSessionLock, readProcessList } from "./session-lock.ts";
import { branchMerged, currentRoot, listWorktrees, refExists, type Worktree } from "./worktrees.ts";

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
// A worktree locked by another live Claude session belongs to that session; --force does not override this (RP-501).
try {
  const here = listWorktrees().find((w) => samePath(w.path, currentRoot()));
  const processes = readProcessList();
  const refusal = processes ? foreignSessionLock(here?.locked, process.pid, processes) : undefined;
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
} catch {
  // Not a git checkout, or git is missing: nothing to check.
}
if (existsSync(".env") && !force) {
  console.error(".env already exists. Re-run with --force to overwrite it.");
  process.exit(1);
}

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

let lane = n;
const clashes = clashesOf(n);
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
