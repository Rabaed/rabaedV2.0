// Seam 2: the lock that stops two seam runs from resetting one test database
// under each other (prepareTestDatabase). A second connection stands in for a
// second Vitest process.
import { describe, expect, it } from "vitest";
import { withDatabaseName } from "../src/config.ts";
import { lockTestDatabase } from "../test-support/reset-test-database.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();

describe("the test database lock", () => {
  it("is held by this run: another run of the same database is refused, naming it", async () => {
    await expect(lockTestDatabase(urls)).rejects.toThrow(/^Another test run is using \w+_test /);
  });

  it("lets one run at a time hold a database, and the next one after release", async () => {
    const other = { ...urls, migrator: withDatabaseName(urls.migrator, "rabaed_lockcheck_test") };
    const first = await lockTestDatabase(other);
    try {
      await expect(lockTestDatabase(other)).rejects.toThrow(/Another test run is using rabaed_lockcheck_test/);
    } finally {
      await first.release();
    }
    const next = await lockTestDatabase(other);
    await next.release();
  });
});
