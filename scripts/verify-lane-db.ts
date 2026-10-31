import { composeProjectOfEnv, envValue } from "./lanes.ts";
import { postgresOfEnv } from "./test-services.ts";
import type { LockHolder } from "./verify-lock.ts";
import { describeHolder } from "./verify-lock.ts";

// One lane database, one verify (RP-1169). RP-996's lock is per worktree, so a second worktree on the same lane
// ran its seam suites against the database a live verify was using, and both failed (an idle session did it to
// lane 11 while RP-1132's lane ran). Two worktrees use one lane database when their .env files name the same
// compose project or the same Postgres port. A `--db <suffix>` worktree (an implementer subagent) shares the
// lane's Postgres on purpose but names a database of its own, so two worktrees that name different databases
// do not clash. The worktree list, the .env files and the locks are passed in, so it is unit-tested.

/** Another worktree: where it is, its .env text if it has one, and the live verify holding its lock if any. */
export type OtherWorktree = { path: string; env: string | undefined; holder: LockHolder | undefined };

/** What a worktree's .env says about its lane database. */
export type LaneDatabase = { project: string | undefined; port: number | undefined; database: string | undefined };

/** The database name the app URL ends in (`rabaed`, or `rabaed_rp322` after `--db`), if any. */
function databaseName(env: string): string | undefined {
  const url = envValue(env, "DATABASE_APP_URL") ?? envValue(env, "DATABASE_MIGRATOR_URL");
  if (url === undefined) return undefined;
  try {
    return new URL(url).pathname.replace(/^\//, "") || undefined;
  } catch {
    return undefined;
  }
}

/** The compose project, Postgres port and database a .env names. */
export function laneDatabaseOf(env: string): LaneDatabase {
  return { project: composeProjectOfEnv(env), port: postgresOfEnv(env)?.port, database: databaseName(env) };
}

/** Whether two .env files name one lane database: one project or one port, unless both name different databases. */
export function sharesLaneDatabase(a: LaneDatabase, b: LaneDatabase): boolean {
  const sameInstance = (a.project !== undefined && a.project === b.project) || (a.port !== undefined && a.port === b.port);
  if (!sameInstance) return false;
  return a.database === undefined || b.database === undefined || a.database === b.database;
}

/** Whether `a` took its lock before `b` did (the lower pid on a tie). */
const startedBefore = (a: LockHolder, b: LockHolder) => a.started.getTime() < b.started.getTime() || (a.started.getTime() === b.started.getTime() && a.pid < b.pid);

/**
 * The message `pnpm verify` stops with when another worktree's live verify holds this worktree's lane database;
 * undefined when none does. `own` is this worktree's .env text, `self` this run.
 */
export function laneDatabaseRefusal(own: string, others: OtherWorktree[], self: LockHolder): string | undefined {
  const mine = laneDatabaseOf(own);
  for (const { path, env, holder } of others) {
    if (holder === undefined || env === undefined) continue;
    // Both runs hold their own worktree lock by now: only the one that took it later gives way, or both would refuse.
    if (!startedBefore(holder, self)) continue;
    const theirs = laneDatabaseOf(env);
    if (!sharesLaneDatabase(mine, theirs)) continue;
    const via = mine.project !== undefined && mine.project === theirs.project ? `compose project ${mine.project}` : `Postgres port ${mine.port}`;
    return [
      `Another worktree's verify is running on this lane's database (${via}): ${path}, ${describeHolder(holder)}.`,
      "Two verifies on one database fail each other. Let it finish, or take a lane of your own (`pnpm lane:env <n> --free --force`, or `--db <suffix>` for an implementer subagent) before running verify again.",
    ].join("\n");
  }
  return undefined;
}
