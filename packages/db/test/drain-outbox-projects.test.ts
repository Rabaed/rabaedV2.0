// Seam 2 for the test helper `drainOutbox(db, handlers, { projects, migrator })` (RP-1236): a test file
// drains only its own Projects' rows of the kinds it gives a handler for. Every item that closes in
// the test database queues a record job, the seeded demo alone 73, and a drain with a record handler
// used to make them all (a Chromium print and a veraPDF run each), so a record file's time hung on
// what ran before it in its shard. Every other Project's rows of those kinds wait while it runs, and
// are given back exactly as they were.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type OutboxHandler } from "../src/index.ts";
import { drainOutbox, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
const worker = createDb(urls.app, { max: 1 });

interface Waiting {
  id: string;
  available_at: string;
  attempts: number;
}
/** The waiting record jobs of every Project but `project`, as the database keeps them. */
const othersWaiting = async (project: string): Promise<Waiting[]> =>
  (
    await sql<Waiting>`
      select id, available_at::text as available_at, attempts from outbox
      where kind = 'documental_record' and processed_at is null and dead_at is null
        and project_id <> ${project}::uuid
      order by id
    `.execute(migrator)
  ).rows;

let ours = "";
let theirs = "";
const added: string[] = [];
/** A due record job of `project`'s (or of none), for an item that isn't there: only the handler below takes it. */
const recordJob = async (project: string | null, availableAt: string): Promise<string> => {
  const { rows } = await sql<{ id: string }>`
    insert into outbox (kind, project_id, payload, available_at)
    values ('documental_record', ${project}::uuid, ${JSON.stringify({ closed_work_item_id: randomUUID() })}::jsonb, ${availableAt}::timestamptz)
    returning id
  `.execute(migrator);
  added.push(rows[0]!.id);
  return rows[0]!.id;
};

beforeAll(async () => {
  // Two of the seeded demo's Projects.
  const projects = (await sql<{ id: string }>`select id from project order by created_at, id limit 2`.execute(migrator)).rows.map((r) => r.id);
  expect(projects).toHaveLength(2); // not hidden-from: setup, two Projects to drain apart
  [ours, theirs] = projects as [string, string];
  await recordJob(ours, "2026-01-01 08:00:00.123456+00");
  await recordJob(theirs, "2026-01-01 08:00:00.654321+00");
  // A row of no Project, as a daily digest is: no other file's, so taken as before.
  await recordJob(null, "2026-01-01 08:00:00.111111+00");
});

afterAll(async () => {
  await sql`delete from outbox where id = any(${added}::uuid[])`.execute(migrator);
  await Promise.all([migrator.destroy(), worker.destroy()]);
});

describe("drainOutbox with { projects, migrator }", () => {
  it("runs the handler only for those Projects' rows, and gives every other Project's back as it was", async () => {
    const before = await othersWaiting(ours);
    expect(before.map((r) => r.id)).toContain(added[1]);

    const taken: string[] = [];
    // Our rows are made; any other row of our Project (the seed's) fails here, as with no handler.
    const handler: OutboxHandler = async (_trx, row) => {
      taken.push(row.id);
      if (row.id !== added[0] && row.id !== added[2]) throw new Error("not this test's row");
    };
    await drainOutbox(worker, { documental_record: handler }, { projects: [ours], migrator });

    expect(taken).toEqual(expect.arrayContaining([added[0], added[2]]));
    const elsewhere = await sql<{ id: string }>`select id from outbox where id = any(${taken}::uuid[]) and project_id <> ${ours}::uuid`.execute(migrator);
    expect(elsewhere.rows).toEqual([]); // not hidden-from: the outbox rows the handler took, our row among them (above)
    const done = await sql<{ id: string }>`select id from outbox where id = any(${[added[0], added[2]]}::uuid[]) and processed_at is not null order by id`.execute(migrator);
    expect(done.rows.map((r) => r.id)).toEqual([added[0]!, added[2]!].sort());
    // Not taken, not tried: each waits as before, its time to the microsecond.
    expect(await othersWaiting(ours)).toEqual(before);
  });

  it("refuses a drain with no handler of its own to limit", async () => {
    await expect(drainOutbox(worker, {}, { projects: [ours], migrator })).rejects.toThrow(/handler/);
  });
});
