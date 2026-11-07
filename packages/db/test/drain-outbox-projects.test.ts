// Seam 2 for the test helper `drainOutbox(db, handlers, { projects, migrator })` (RP-1236): a test file
// drains only its own Projects' rows of the kinds it gives a handler for. Every item that closes in
// the test database queues a record job, the seeded demo alone 73, and a drain with a record handler
// used to make them all (a Chromium print and a veraPDF run each), so a record file's time hung on
// what ran before it in its shard. Every other Project's rows of those kinds wait while it runs, and
// are given back exactly as they were, also when the run fails.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type OutboxHandler } from "../src/index.ts";
import { buildSeamTwoTower, drainOutbox, testDatabaseUrls, whileOtherProjectsWait, type OwnProjects } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
const worker = createDb(urls.app, { max: 1 });
let towerMigrator: pg.Client;

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
/** Row `id` as the database keeps it. */
const rowOf = async (id: string) =>
  (
    await sql<Waiting & { processed: boolean; last_error: string | null }>`
      select id, available_at::text as available_at, attempts, processed_at is not null as processed, last_error from outbox where id = ${id}::uuid
    `.execute(migrator)
  ).rows[0]!;

let own: OwnProjects;
const added: string[] = [];
/** A due outbox row of `project`'s (or of none), for an item that isn't there: only this test's handler makes it. */
const job = async (kind: string, project: string | null, availableAt: string): Promise<string> => {
  const payload = kind === "documental_record" ? { closed_work_item_id: randomUUID() } : { work_item_id: randomUUID() };
  const { rows } = await sql<{ id: string }>`
    insert into outbox (kind, project_id, payload, available_at)
    values (${kind}, ${project}::uuid, ${JSON.stringify(payload)}::jsonb, ${availableAt}::timestamptz)
    returning id
  `.execute(migrator);
  added.push(rows[0]!.id);
  return rows[0]!.id;
};
const rows = { ours: "", theirs: "", noProject: "", theirsOtherKind: "" };

beforeAll(async () => {
  towerMigrator = new pg.Client({ connectionString: urls.migrator });
  await towerMigrator.connect();
  // Two Projects of this test's own: the tower's, and the one its option `otherProject` makes.
  const tower = await buildSeamTwoTower(worker, towerMigrator, { projectCode: "RDO", otherProject: true });
  own = { projects: [tower.projectId], migrator };
  rows.ours = await job("documental_record", tower.projectId, "2026-01-01 08:00:00.123456+00");
  rows.theirs = await job("documental_record", tower.other.projectId, "2026-01-01 08:00:00.654321+00");
  // A row of no Project, as a daily digest is: no other file's, so taken as before.
  rows.noProject = await job("documental_record", null, "2026-01-01 08:00:00.111111+00");
  // A kind the drain names no handler for: not limited, so taken (and failed, with no handler) as before.
  rows.theirsOtherKind = await job("documental_record_reproduce", tower.other.projectId, "2026-01-01 08:00:00.222222+00");
});

afterAll(async () => {
  await sql`delete from outbox where id = any(${added}::uuid[])`.execute(migrator);
  await towerMigrator.end();
  await Promise.all([migrator.destroy(), worker.destroy()]);
});

describe("drainOutbox with { projects, migrator }", () => {
  it("gives every other Project's rows back as they were when the run fails, after holding them", async () => {
    const before = await othersWaiting(own.projects[0]!);
    expect(before.map((r) => r.id)).toContain(rows.theirs);
    let duringRun = "";
    await expect(
      whileOtherProjectsWait(own, ["documental_record"], async () => {
        duringRun = (await rowOf(rows.theirs)).available_at;
        throw new Error("the run failed");
      }),
    ).rejects.toThrow("the run failed");
    expect(duringRun).toBe("infinity");
    expect(await othersWaiting(own.projects[0]!)).toEqual(before);
  });

  it("runs the handler only for those Projects' rows (and rows of no Project), and gives every other Project's back as it was", async () => {
    const before = await othersWaiting(own.projects[0]!);
    const theirsBefore = await rowOf(rows.theirs);

    const taken: string[] = [];
    const handler: OutboxHandler = async (_trx, row) => {
      taken.push(row.id);
      // A row of no Project another test left behind fails here, as with no handler.
      if (row.id !== rows.ours && row.id !== rows.noProject) throw new Error("not this test's row");
    };
    await drainOutbox(worker, { documental_record: handler }, own);

    expect(taken).toEqual(expect.arrayContaining([rows.ours, rows.noProject]));
    expect(taken).not.toContain(rows.theirs); // not hidden-from: the outbox rows the handler took, ours among them (above)
    expect([(await rowOf(rows.ours)).processed, (await rowOf(rows.noProject)).processed]).toEqual([true, true]);
    // Not taken, not tried: each waits as before, its time to the microsecond.
    expect(await rowOf(rows.theirs)).toEqual(theirsBefore);
    expect(await othersWaiting(own.projects[0]!)).toEqual(before);
    // The kind with no handler of the drain's own was taken, as any drain takes it.
    expect(await rowOf(rows.theirsOtherKind)).toMatchObject({ attempts: 1, processed: false, last_error: expect.stringContaining("no handler") });
  });

  it("refuses a drain with no handler of its own to limit, and a limit to no Project", async () => {
    await expect(drainOutbox(worker, {}, own)).rejects.toThrow(/handler/);
    await expect(drainOutbox(worker, { documental_record: async () => {} }, { projects: [], migrator })).rejects.toThrow(/no Project/);
  });
});
