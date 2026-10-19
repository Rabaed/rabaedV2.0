// Which rows a command holds when it waits on a Package (RP-616 review fix 5, data-model.md
// "Lock order"): a session holds Package `packageId`'s row, the command starts and blocks on it,
// and another session asks for each item's lock without waiting. An item the command already
// holds refuses it. Deterministic: it waits for Postgres to say the command is blocked by the
// holder (pg_blocking_pids), never for a time.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";

/**
 * Runs `command` while Package `packageId` is locked by another session, and answers, by item
 * of `itemIds`, whether the command held it once it was waiting on the Package. Then lets the
 * command go on and answers its result too.
 */
export async function lockedWhileWaitingOnPackage<T>(
  packageId: string,
  itemIds: string[],
  command: () => PromiseLike<T>,
): Promise<{ held: Record<string, boolean>; result: T }> {
  const holder = createDb(testDatabaseUrls().migrator, { max: 1 });
  const probe = createDb(testDatabaseUrls().migrator, { max: 1 });
  try {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding!: (pid: number) => void;
    const held = new Promise<number>((resolve) => (holding = resolve));
    const holderDone = holder.transaction().execute(async (trx) => {
      await sql`select 1 from package where id = ${packageId}::uuid for update`.execute(trx);
      const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
      holding(rows[0]!.pid);
      await released;
    });
    const pid = await held;
    let settled = false;
    const running = Promise.resolve(command()).finally(() => (settled = true));
    // Until the command waits on the holder's lock (or ends without ever waiting on it).
    while (!settled) {
      const { rows } = await sql<{ n: number }>`
        select count(*)::integer as n from pg_stat_activity where ${pid}::integer = any(pg_blocking_pids(pid))
      `.execute(probe);
      if (rows[0]!.n > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const result: Record<string, boolean> = {};
    for (const id of itemIds) {
      result[id] = await probe
        .transaction()
        .execute(async (trx) => {
          await sql`select 1 from work_item where id = ${id}::uuid for update nowait`.execute(trx);
          return false;
        })
        .catch((e: { code?: string }) => {
          if (e.code === "55P03") return true;
          throw e;
        });
    }
    release();
    await holderDone;
    return { held: result, result: await running };
  } finally {
    await holder.destroy();
    await probe.destroy();
  }
}
