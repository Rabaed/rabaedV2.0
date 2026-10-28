import { readFileSync } from "node:fs";
import { createDb, type OutboxRun, type ProcessOutboxOptions, type ScheduledJob } from "@rabaed/db";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import { apiConfigFromEnv } from "../config.ts";
import { fileURLToPath } from "node:url";
import { latestKinds, repoMigrations } from "../../../../scripts/check-leak-channels.ts";
import { CRON_OUTBOX_KINDS, CRON_OUTBOX_PATH, outboxCronFromEnv, outboxCronPass, RECORDS_CONTAINER_KINDS, type OutboxCron } from "./outbox-cron.ts";

// RP-1039: on Vercel the outbox is delivered by Vercel Cron calling the api once a
// minute with `Authorization: Bearer <CRON_SECRET>` (Vercel docs, Managing Cron Jobs).
// No database is reached here: a refused call runs nothing, and the pass is a stand-in.
const db = createDb("postgres://nobody@127.0.0.1:1/none", { max: 1 });
const SECRET = "a-cron-secret-of-32-characters!!";

let passes = 0;
const cron = (secret: string | undefined): OutboxCron => ({
  secret,
  pass: async () => {
    passes++;
    return { scheduledJobs: [{ job: "daily_digest", outcome: "ran" }], outbox: { processed: 2, failed: 0, dead: 0 } };
  },
});
const apps = {
  withSecret: await buildApp({ db, config: apiConfigFromEnv({}), logger: false, cron: cron(SECRET) }),
  unset: await buildApp({ db, config: apiConfigFromEnv({}), logger: false, cron: cron(undefined) }),
  noCron: await buildApp({ db, config: apiConfigFromEnv({}), logger: false }),
};
afterAll(async () => {
  await Promise.all(Object.values(apps).map((app) => app.close()));
  await db.destroy();
});

const call = (app: keyof typeof apps, authorization?: string) =>
  apps[app].inject({ method: "GET", url: CRON_OUTBOX_PATH, headers: authorization === undefined ? {} : { authorization } });

describe("the outbox cron route", () => {
  it("runs one pass for Vercel Cron's call and says what it did", async () => {
    const before = passes;
    const res = await call("withSecret", `Bearer ${SECRET}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ scheduledJobs: [{ job: "daily_digest", outcome: "ran" }], outbox: { processed: 2, failed: 0, dead: 0 } });
    expect(passes).toBe(before + 1);
  });

  it.each([
    ["no Authorization header", undefined],
    ["a wrong secret", "Bearer not-the-secret"],
    ["the secret with one character more", `Bearer ${SECRET}x`],
    ["the secret without its Bearer prefix", SECRET],
    ["the secret in another scheme", `Basic ${SECRET}`],
    ["an empty bearer", "Bearer "],
  ])("refuses %s with 401 and runs nothing", async (_name, authorization) => {
    const before = passes;
    const res = await call("withSecret", authorization);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "not_signed_in" });
    expect(passes).toBe(before);
  });

  it.each([
    ["CRON_SECRET is unset", "unset" as const],
    ["the app has no cron pass", "noCron" as const],
  ])("refuses every call when %s", async (_name, app) => {
    const before = passes;
    for (const authorization of [undefined, "Bearer ", "Bearer undefined", `Bearer ${SECRET}`]) {
      expect((await call(app, authorization)).statusCode).toBe(401);
    }
    expect(passes).toBe(before);
  });
});

describe("the cron kinds", () => {
  it("with the Records container's, are every kind the outbox allows, so no new kind goes undelivered on Vercel", () => {
    const repo = fileURLToPath(new URL("../../../../", import.meta.url));
    const allowed = latestKinds(repoMigrations(repo))
      .filter((k) => k.table === "outbox")
      .map((k) => k.kind);
    expect(allowed.length).toBeGreaterThan(0);
    expect([...CRON_OUTBOX_KINDS, ...RECORDS_CONTAINER_KINDS].sort()).toEqual(allowed.sort());
  });
});

describe("the api's vercel.json", () => {
  const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
    crons: { path: string; schedule: string }[];
    functions: Record<string, { maxDuration: number; includeFiles: string }>;
  };

  it("has Vercel Cron call the route every minute", () => {
    expect(vercel.crons).toEqual([{ path: CRON_OUTBOX_PATH, schedule: "* * * * *" }]);
  });

  it("ships the sources the pass loads: the worker's jobs and the mailer", () => {
    const included = vercel.functions["api/index.ts"]!.includeFiles;
    expect(included).toContain("../worker/src/jobs.ts");
    expect(included).toContain("../../packages/mailer/src/**/*.ts");
  });
});

describe("the cron pass from the environment", () => {
  it.each([
    ["unset", {}],
    ["empty", { CRON_SECRET: "" }],
    ["shorter than 16 characters", { CRON_SECRET: "fifteen-chars!!" }],
  ])("has no secret when CRON_SECRET is %s, so the route refuses every call", (_name, env) => {
    expect(outboxCronFromEnv(db, env).secret).toBeUndefined();
  });

  it("takes CRON_SECRET as the secret", () => {
    expect(outboxCronFromEnv(db, { CRON_SECRET: SECRET }).secret).toBe(SECRET);
  });

  it("fails before reaching the database without WEB_URL, which the emails link to", async () => {
    await expect(outboxCronFromEnv(db, { CRON_SECRET: SECRET }).pass()).rejects.toThrow();
  });
});

describe("the cron pass", () => {
  const run: OutboxRun = { processed: 1, failed: 0, dead: 0 };
  const job = { name: "daily_digest" } as ScheduledJob;
  const record = (calls: ProcessOutboxOptions[]) => async (_db: unknown, options: ProcessOutboxOptions = {}) => {
    calls.push(options);
    return run;
  };

  it("runs the scheduled jobs, then one bounded outbox pass of the kinds the api delivers, never a Documental Record's", async () => {
    const order: string[] = [];
    const calls: ProcessOutboxOptions[] = [];
    const pass = outboxCronPass(db, {
      handlers: {},
      scheduledJobs: [job],
      runScheduledJobs: async (_db, jobs) => {
        order.push("jobs");
        expect(jobs).toEqual([job]);
        return [{ job: "daily_digest", runAt: new Date(0), outcome: "ran" }];
      },
      processOutbox: async (d, options) => {
        order.push("outbox");
        return record(calls)(d, options);
      },
    });
    expect(await pass()).toEqual({ scheduledJobs: [{ job: "daily_digest", outcome: "ran" }], outbox: run });
    expect(order).toEqual(["jobs", "outbox"]);
    expect(calls).toHaveLength(1);
    expect([...calls[0]!.kinds!].sort()).toEqual(["digest", "email", "notification", "password_reset", "record_ready", "step_age_report"]);
    for (const kind of ["documental_record", "documental_record_reproduce", "working_copy", "snag_report"]) {
      expect(calls[0]!.kinds).not.toContain(kind);
    }
    // Bounded well inside the api function's 60 s maxDuration (vercel.json).
    expect(calls[0]!.limit).toBeGreaterThan(0);
    expect(calls[0]!.timeBudgetMs).toBeGreaterThan(0);
    expect(calls[0]!.timeBudgetMs).toBeLessThanOrEqual(45_000);
  });

  it("gives the outbox only what the scheduled jobs left of the budget", async () => {
    let clock = 0;
    const calls: ProcessOutboxOptions[] = [];
    const pass = outboxCronPass(db, {
      handlers: {},
      scheduledJobs: [],
      nowMs: () => clock,
      runScheduledJobs: async () => {
        clock += 10_000;
        return [];
      },
      processOutbox: record(calls),
    });
    await pass();
    const full = calls[0]!.timeBudgetMs!;
    clock = 0;
    const quick = outboxCronPass(db, { handlers: {}, scheduledJobs: [], nowMs: () => clock, runScheduledJobs: async () => [], processOutbox: record(calls) });
    await quick();
    expect(calls[1]!.timeBudgetMs! - full).toBe(10_000);
  });
});
