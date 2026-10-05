import pg from "pg";
import { databaseNameOf, withDatabaseName, type DatabaseUrls } from "../src/config.ts";
import { resetDatabase } from "../src/reset-database.ts";

/** Throws unless the database is a test database: its name ends in `_test`. */
export function assertTestDatabase(urls: DatabaseUrls): void {
  const name = databaseNameOf(urls.migrator);
  if (!name.endsWith("_test")) throw new Error(`Refusing to drop ${name || "(none)"}: a test database's name ends in _test.`);
}

/**
 * Drops `<db>_test` and builds it again (roles, migrations), so a seam run never
 * sees what an earlier run left behind. Other connections to it are closed;
 * no other database is touched.
 */
export async function resetTestDatabase(urls: DatabaseUrls): Promise<void> {
  assertTestDatabase(urls);
  await resetDatabase(urls);
}

/** A lock on one test database, held until released. */
export type TestDatabaseLock = { release(): Promise<void> };

/**
 * Takes the Postgres advisory lock for this test database, on a connection of its
 * own to the `postgres` database (so dropping the test database never closes it),
 * and holds it until released or the process ends. Refuses at once, with a message
 * naming the database, when another run holds it.
 */
export async function lockTestDatabase(urls: DatabaseUrls): Promise<TestDatabaseLock> {
  const name = databaseNameOf(urls.migrator);
  const client = new pg.Client({ connectionString: withDatabaseName(urls.superuser, "postgres") });
  // A lost connection loses the lock too; the run goes on, as it did before the lock.
  client.on("error", () => {});
  await client.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext('rabaed seam run'), hashtext($1)) as locked", [name]);
    if (!rows[0]?.locked) {
      throw new Error(
        `Another test run is using ${name} (a seam suite in this worktree, or in a worktree whose .env names the same database). ` +
          "Let it finish or stop it, then re-run.",
      );
    }
  } catch (error) {
    await client.end();
    throw error;
  }
  return { release: () => client.end() };
}

type Run = { ready: Promise<TestDatabaseLock>; users: number };
type Steps = { lock: (urls: DatabaseUrls) => Promise<TestDatabaseLock>; reset: (urls: DatabaseUrls) => Promise<void> };

// Kept on globalThis: each Vitest project may import this module on its own, but
// all their global setups run in the one Vitest process.
const runsKey = Symbol.for("rabaed.testDatabaseRuns");
const runs = (): Map<string, Run> => ((globalThis as Record<symbol, Map<string, Run>>)[runsKey] ??= new Map());

/**
 * The seam suites' global setup: locks the test database for this Vitest process
 * and resets it, once. Returns the teardown, which releases the lock after the
 * last caller in the process tears down.
 *
 * Why: seam1 and seam2 both list this setup. In one Vitest process (`pnpm test`)
 * Vitest runs each project's global setup in turn before any test file, so the
 * database was reset, and the demo seeded, once per project; now the second
 * project reuses the first one's reset. Two Vitest processes in one worktree (or
 * two worktrees whose .env name the same database) would drop the database under
 * each other; the advisory lock makes the second refuse with a clear message.
 * Chosen over a database per project, which would not stop two runs of one suite
 * and would migrate and seed twice; and refusing over waiting, so a stuck run
 * shows up at once instead of as a silent hang.
 */
export async function prepareTestDatabase(urls: DatabaseUrls, steps: Steps = { lock: lockTestDatabase, reset: resetTestDatabase }): Promise<() => Promise<void>> {
  assertTestDatabase(urls);
  const name = databaseNameOf(urls.migrator);
  let run = runs().get(name);
  if (!run) {
    const ready = (async () => {
      const lock = await steps.lock(urls);
      try {
        await steps.reset(urls);
        return lock;
      } catch (error) {
        await lock.release();
        throw error;
      }
    })();
    run = { ready, users: 0 };
    runs().set(name, run);
    // A failed setup is not reused: a later call (e.g. a watch-mode rerun) tries again.
    ready.catch(() => runs().delete(name));
  }
  const current = run;
  const lock = await current.ready;
  current.users++;
  return async () => {
    if (--current.users > 0) return;
    runs().delete(name);
    await lock.release();
  };
}
