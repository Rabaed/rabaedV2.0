// Seam 1: the API as a caller sees it, against a real Postgres.
import { afterAll, describe, expect, it } from "vitest";
import { createTestApi, testConfig } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

describe("GET /health", () => {
  it("reports the database as ok", async () => {
    const res = await api.anonymous().get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", database: "ok", version: testConfig.version });
  });

  it("reports the database as unavailable when it can't be reached", async () => {
    const broken = await createTestApi({ databaseUrl: "postgres://rabaed_app:x@127.0.0.1:1/nowhere" });
    try {
      const res = await broken.anonymous().get("/health");
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: "degraded", database: "unavailable", version: testConfig.version });
    } finally {
      await broken.close();
    }
  });
});
