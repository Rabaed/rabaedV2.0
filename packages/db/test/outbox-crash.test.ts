// Seam 2 for the outbox (RP-958): an attempt is counted when the worker takes a row,
// in its own committed step, before the handler runs. A worker that dies in the
// handler (out of memory, killed) rolls back only the handler's work: the attempt
// stays counted, the row waits out its backoff, and after the last attempt it is
// dead-lettered instead of being retried forever. While a handler runs, no other
// worker takes its row.
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { afterAll, afterEach, describe, expect, it } from "vitest";
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

/** Worker processes still running: killed when a test ends, however it ends. */
const children = new Set<ChildProcess>();
afterEach(() => {
  for (const child of children) child.kill();
  children.clear();
});

/** Runs a worker process whose handler exits it mid-row; resolves with its exit code. Killed after 30 s. */
function crashingWorker(maxAttempts: number): Promise<number | null> {
  const script = fileURLToPath(new URL("./outbox-crash-worker.ts", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, OUTBOX_CRASH_URL: urls.app, OUTBOX_CRASH_MAX_ATTEMPTS: String(maxAttempts) },
      stdio: ["ignore", "ignore", "inherit"],
      timeout: 30_000,
    });
    children.add(child);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      children.delete(child);
      if (signal) reject(new Error(`the worker process was killed (${signal})`));
      else resolve(code);
    });
  });
}

describe("a worker that dies in the handler", () => {
  it("costs the row an attempt each time, and after the last one the row is dead-lettered", async () => {
    const id = await firstInLine();
    // The first attempt fails as a handler can, and says why.
    const failing = await processOutbox(worker, {
      limit: 1,
      maxAttempts: 3,
      handlers: {
        notification: async () => {
          throw new Error("mail server down");
        },
      },
    });
    expect(failing).toEqual({ processed: 0, failed: 1, dead: 0 });
    expect(await rowOf(id)).toMatchObject({ attempts: 1, due: false, last_error: "mail server down" });
    await makeDue(id);
    // The next two die with their worker.
    for (let attempt = 2; attempt <= 3; attempt++) {
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
    expect(row).toMatchObject({ attempts: 3, processed_at: null, last_error: "the worker stopped while running it; before that: mail server down" });
    expect(row.dead_at).not.toBeNull();
  });
});

describe("a failure recorded late", () => {
  it("leaves alone an attempt another worker has taken since", async () => {
    const id = await firstInLine();
    // Two attempts taken: the second by another worker after the first's backoff.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const taken = await sql<{ id: string; attempts: number }>`select id, attempts from app.take_outbox_row(3, '{60000,60000,60000}')`.execute(worker);
      expect(taken.rows).toEqual([{ id, attempts: attempt }]);
      if (attempt === 1) await makeDue(id);
    }
    // The first attempt's failure comes in late: it records nothing over the second.
    const { rows } = await sql<{ outcome: string }>`select app.outbox_failed(${id}::uuid, 1, 'late', 3, 0) as outcome`.execute(worker);
    expect(rows[0]!.outcome).toBe("gone");
    expect(await rowOf(id)).toMatchObject({ attempts: 2, due: false, last_error: null, dead_at: null });
    // Out of the way of later tests.
    await sql`update outbox set dead_at = now() where id = ${id}::uuid`.execute(migrator);
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
        const { rows } = await sql<{ id: string }>`select id from app.take_outbox_row(8, array_fill(30000, array[8]))`.execute(trx);
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
