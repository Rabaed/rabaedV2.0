import { describe, expect, it } from "vitest";
import { assertTestDatabase, resetTestDatabase } from "./reset-test-database.ts";
import type { DatabaseUrls } from "./config.ts";

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
    }
  });
});
