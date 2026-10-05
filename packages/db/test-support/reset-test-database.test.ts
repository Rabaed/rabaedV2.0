import { describe, expect, it, vi } from "vitest";
import { assertTestDatabase, prepareTestDatabase, resetTestDatabase } from "./reset-test-database.ts";
import type { DatabaseUrls } from "../src/config.ts";

const urlsFor = (name: string): DatabaseUrls => ({
  superuser: "postgres://postgres:pw@localhost:5432/postgres",
  migrator: `postgres://rabaed_migrator:pw@localhost:5432/${name}`,
  app: `postgres://rabaed_app:pw@localhost:5432/${name}`,
  admin: `postgres://rabaed_admin:pw@localhost:5432/${name}`,
});

describe("assertTestDatabase", () => {
  it("accepts a database whose name ends in _test", () => {
    expect(() => assertTestDatabase(urlsFor("rabaed_test"))).not.toThrow();
    expect(() => assertTestDatabase(urlsFor("rabaed_rp323_test"))).not.toThrow();
  });

  it("refuses any other name, before connecting to anything", async () => {
    for (const name of ["rabaed", "rabaed_testing", "test_rabaed", "postgres"]) {
      expect(() => assertTestDatabase(urlsFor(name)), name).toThrow(/ends in _test/);
      await expect(resetTestDatabase(urlsFor(name)), name).rejects.toThrow(/ends in _test/);
      await expect(prepareTestDatabase(urlsFor(name)), name).rejects.toThrow(/ends in _test/);
    }
  });
});

// prepareTestDatabase with the lock and reset recorded instead of run; seam2's
// test-database-lock.test.ts takes the real lock.
describe("prepareTestDatabase", () => {
  const recorder = () => {
    const log: string[] = [];
    const steps = {
      lock: async (urls: DatabaseUrls) => {
        log.push(`lock ${urls.migrator.split("/").pop()}`);
        return { release: async () => void log.push("release") };
      },
      reset: async () => void log.push("reset"),
    };
    return { log, steps };
  };

  it("locks and resets once per process however many projects set up, and releases after the last teardown", async () => {
    const { log, steps } = recorder();
    const urls = urlsFor("rabaed_once_test");
    // Vitest runs seam1's setup, then seam2's; the two calls at once are the harder case.
    const [seam1, seam2] = await Promise.all([prepareTestDatabase(urls, steps), prepareTestDatabase(urls, steps)]);
    expect(log).toEqual(["lock rabaed_once_test", "reset"]);
    await seam1();
    expect(log).toEqual(["lock rabaed_once_test", "reset"]);
    await seam2();
    expect(log).toEqual(["lock rabaed_once_test", "reset", "release"]);
  });

  it("starts afresh after the last teardown, as a new process would", async () => {
    const { log, steps } = recorder();
    const urls = urlsFor("rabaed_again_test");
    await (await prepareTestDatabase(urls, steps))();
    await (await prepareTestDatabase(urls, steps))();
    expect(log).toEqual(["lock rabaed_again_test", "reset", "release", "lock rabaed_again_test", "reset", "release"]);
  });

  it("keeps different test databases apart", async () => {
    const { log, steps } = recorder();
    const teardowns = await Promise.all([prepareTestDatabase(urlsFor("rabaed_a_test"), steps), prepareTestDatabase(urlsFor("rabaed_b_test"), steps)]);
    expect(log.filter((l) => l.startsWith("lock")).sort()).toEqual(["lock rabaed_a_test", "lock rabaed_b_test"]);
    await Promise.all(teardowns.map((t) => t()));
  });

  it("does not reset when the lock is refused, and releases the lock when the reset fails", async () => {
    const urls = urlsFor("rabaed_fail_test");
    const reset = vi.fn(async () => {});
    await expect(prepareTestDatabase(urls, { lock: () => Promise.reject(new Error("Another test run is using rabaed_fail_test")), reset })).rejects.toThrow(/Another test run/);
    expect(reset).not.toHaveBeenCalled();

    const { log, steps } = recorder();
    await expect(prepareTestDatabase(urls, { ...steps, reset: () => Promise.reject(new Error("migration failed")) })).rejects.toThrow("migration failed");
    expect(log).toEqual(["lock rabaed_fail_test", "release"]);
    // The failure is not reused: the next setup tries again.
    await (await prepareTestDatabase(urls, steps))();
    expect(log).toEqual(["lock rabaed_fail_test", "release", "lock rabaed_fail_test", "reset", "release"]);
  });
});
