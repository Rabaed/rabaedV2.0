// Seam 2 for the worker's scheduled jobs (RP-358): a job runs once per run time
// of its schedule, however many workers poll or how often, as the app role with
// no Member set. A job that fails is rolled back with the run's lock, so the next
// poll runs it again. A signed-in Member can't take a run.
import { randomUUID } from "node:crypto";
import type { WeeklySchedule } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, runScheduledJobs, withMember, type ScheduledJob } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(() => Promise.all([worker.destroy(), migrator.destroy()]));

const weekdays: WeeklySchedule = { days: ["sunday", "monday", "tuesday", "wednesday", "thursday"], hour: 7, minute: 0, timeZone: "Asia/Riyadh" };
const riyadh = (iso: string) => new Date(`${iso}:00+03:00`);

/** A job that counts its runs, and fails while `failing` is set. */
function countingJob() {
  const job = {
    runs: [] as Date[],
    failing: false,
    name: `test_${randomUUID()}`,
    schedule: weekdays,
    run: async (trx: Parameters<ScheduledJob["run"]>[0], runAt: Date) => {
      // It runs in the transaction that took the run, as the app role.
      await sql`select 1`.execute(trx);
      if (job.failing) throw new Error("job failed");
      job.runs.push(runAt);
    },
  };
  return job;
}

describe("runScheduledJobs", () => {
  it("runs a due job once per run time, however often it is polled", async () => {
    const job = countingJob();
    expect(await runScheduledJobs(worker, [job], riyadh("2026-10-04T07:00"))).toEqual([{ job: job.name, runAt: riyadh("2026-10-04T07:00"), outcome: "ran" }]);
    expect(await runScheduledJobs(worker, [job], riyadh("2026-10-04T07:05"))).toEqual([{ job: job.name, runAt: riyadh("2026-10-04T07:00"), outcome: "already_ran" }]);
    await runScheduledJobs(worker, [job], riyadh("2026-10-05T07:01"));
    expect(job.runs).toEqual([riyadh("2026-10-04T07:00"), riyadh("2026-10-05T07:00")]);
  });

  it("two workers polling at once run it once", async () => {
    const job = countingJob();
    const now = riyadh("2026-10-06T07:00");
    const other = createDb(urls.app, { max: 1 });
    try {
      await Promise.all([runScheduledJobs(worker, [job], now), runScheduledJobs(other, [job], now)]);
    } finally {
      await other.destroy();
    }
    expect(job.runs).toEqual([now]);
  });

  it("runs nothing when no run is due (a Friday)", async () => {
    const job = countingJob();
    expect(await runScheduledJobs(worker, [job], riyadh("2026-10-09T07:00"))).toEqual([]);
    expect(job.runs).toEqual([]);
  });

  it("runs a failed job again at the next poll: its lock is rolled back with it", async () => {
    const job = countingJob();
    job.failing = true;
    const [failed] = await runScheduledJobs(worker, [job], riyadh("2026-10-07T07:00"));
    expect(failed).toMatchObject({ job: job.name, outcome: "failed" });
    job.failing = false;
    expect(await runScheduledJobs(worker, [job], riyadh("2026-10-07T07:01"))).toMatchObject([{ outcome: "ran" }]);
    expect(job.runs).toEqual([riyadh("2026-10-07T07:00")]);
  });

  it("one failing job does not stop the others", async () => {
    const failing = Object.assign(countingJob(), { failing: true });
    const fine = countingJob();
    const runs = await runScheduledJobs(worker, [failing, fine], riyadh("2026-10-08T07:00"));
    expect(runs.map((r) => r.outcome)).toEqual(["failed", "ran"]);
  });

  it("is the worker's only: a signed-in Member's session can't take a run", async () => {
    const { rows } = await sql<{ id: string }>`select id from member limit 1`.execute(migrator);
    await expect(
      withMember(worker, rows[0]!.id, (trx) => sql`select app.claim_scheduled_run(${`test_${randomUUID()}`}, now())`.execute(trx)),
    ).rejects.toThrow(/only the worker/);
  });

  it("keeps its records out of the app role's reach", async () => {
    await expect(sql`select * from scheduled_job_run`.execute(worker)).rejects.toThrow(/permission denied/);
  });
});
