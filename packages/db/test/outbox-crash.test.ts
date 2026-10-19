// Seam 2 for the outbox (RP-958): an attempt is counted when the worker takes a row,
// in its own committed step, before the handler runs. A worker that dies in the
// handler (out of memory, killed) rolls back only the handler's work: the attempt
// stays counted, the row waits out its backoff, and after the last attempt it is
// dead-lettered instead of being retried forever. While a handler runs, no other
// worker takes its row.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, processOutbox } from "../src/index.ts";
import { rolledBack, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(() => Promise.all([worker.destroy(), migrator.destroy()]));

/** A second before every row waiting, and before 2000: the next row a worker takes. */
const headOfLine = sql<Date>`(
  select least(min(available_at), '2000-01-01T00:00:00Z'::timestamptz) - interval '1 second'
  from outbox where processed_at is null and dead_at is null
)`;

/** A notification row due before every other row; returns its id. */
async function firstInLine(): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into outbox (kind, project_id, payload, available_at)
    select 'notification', id, '{"test": "RP-958"}', ${headOfLine} from project limit 1
    returning id
  `.execute(migrator);
  return rows[0]!.id;
}

const rowOf = (id: string) =>
  sql<{ attempts: number; due: boolean; processed_at: Date | null; dead_at: Date | null; last_error: string | null }>`
    select attempts, available_at <= now() as due, processed_at, dead_at, last_error from outbox where id = ${id}::uuid
  `
    .execute(migrator)
    .then((r) => r.rows[0]!);

const makeDue = (id: string) => sql`update outbox set available_at = ${headOfLine} where id = ${id}::uuid`.execute(migrator);

/** Runs a worker process whose handler exits it mid-row; resolves with its exit code. */
function crashingWorker(maxAttempts: number): Promise<number | null> {
  const script = fileURLToPath(new URL("./outbox-crash-worker.ts", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, OUTBOX_CRASH_URL: urls.app, OUTBOX_CRASH_MAX_ATTEMPTS: String(maxAttempts) },
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });
}

describe("a worker that dies in the handler", () => {
  it("costs the row an attempt each time, and after the last one the row is dead-lettered", async () => {
    const id = await firstInLine();
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(await crashingWorker(3)).toBe(1);
      // Counted, and not due again at once: it waits out its backoff.
      expect(await rowOf(id)).toMatchObject({ attempts: attempt, due: false, processed_at: null, dead_at: null });
      await makeDue(id);
    }
    // Its last attempt died too: the next worker dead-letters it, without running it again.
    const ran: string[] = [];
    const run = await processOutbox(worker, {
      limit: 1,
      maxAttempts: 3,
      handlers: { notification: async (_trx, row) => void ran.push(row.id) },
    });
    expect(ran).toEqual([]);
    expect(run).toEqual({ processed: 0, failed: 0, dead: 1 });
    const row = await rowOf(id);
    expect(row).toMatchObject({ attempts: 3, processed_at: null, last_error: "the worker stopped while running it" });
    expect(row.dead_at).not.toBeNull();
  });
});

describe("a row being run", () => {
  it("is not taken by another worker, even when its backoff has passed", async () => {
    const id = await firstInLine();
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let started = () => {};
    const running = new Promise<void>((resolve) => (started = resolve));
    const run = processOutbox(worker, {
      limit: 1,
      // No backoff: the row is due again the moment it is taken.
      retryDelayMs: () => 0,
      handlers: {
        notification: async () => {
          started();
          await released;
        },
      },
    });
    await running;
    expect(await rowOf(id)).toMatchObject({ attempts: 1, due: true });
    // Another worker takes every due row it can, and passes this one by.
    await rolledBack(worker, async (trx) => {
      const others: string[] = [];
      for (;;) {
        const { rows } = await sql<{ id: string }>`select id from app.take_outbox_row()`.execute(trx);
        if (!rows[0]) break;
        others.push(rows[0].id);
      }
      expect(others).not.toContain(id);
    });
    release();
    expect(await run).toEqual({ processed: 1, failed: 0, dead: 0 });
    // A run that succeeds counts no failed attempt.
    expect(await rowOf(id)).toMatchObject({ attempts: 0, dead_at: null });
    expect((await rowOf(id)).processed_at).not.toBeNull();
  });
});
