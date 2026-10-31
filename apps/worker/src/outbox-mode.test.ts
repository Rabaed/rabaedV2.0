import { describe, expect, it } from "vitest";
import { RECORDS_CONTAINER_KINDS } from "./jobs.ts";
import { workerRunFromEnv } from "./outbox-mode.ts";

// What one worker takes from the outbox (RP-1042, ADR 0026). On AWS and in development, one worker
// does it all. On UAT, Vercel Cron delivers notifications and email and runs the scheduled jobs
// (RP-1039), and the Records container takes only the Record jobs: Chromium and the signer.

describe("WORKER_OUTBOX", () => {
  it("unset or all: every kind, and the scheduled jobs", () => {
    expect(workerRunFromEnv({})).toEqual({ kinds: undefined, scheduledJobs: true });
    expect(workerRunFromEnv({ WORKER_OUTBOX: "all" })).toEqual({ kinds: undefined, scheduledJobs: true });
  });

  it("records: only the Record job kinds, and no scheduled job (the cron pass runs them)", () => {
    expect(workerRunFromEnv({ WORKER_OUTBOX: "records" })).toEqual({ kinds: RECORDS_CONTAINER_KINDS, scheduledJobs: false });
  });

  it("the Record job kinds are the four that need Chromium or the signer", () => {
    expect([...RECORDS_CONTAINER_KINDS].sort()).toEqual(["documental_record", "documental_record_reproduce", "snag_report", "working_copy"]);
  });

  it("refuses any other value, rather than taking every kind", () => {
    expect(() => workerRunFromEnv({ WORKER_OUTBOX: "record" })).toThrow();
  });
});
