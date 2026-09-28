// Seam 1: requests carry the signed-in Member down to the database, where
// row-level security reads it. (Stub identity until sign-in lands in RP-187.)
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createTestApi } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

describe("GET /v1/me", () => {
  it("refuses a caller who is not signed in", async () => {
    const res = await api.anonymous().get("/v1/me");
    expect(res.statusCode).toBe(401);
  });

  it("acts as the signed-in Member inside the database", async () => {
    const member = randomUUID();
    const res = await api.as(member).get("/v1/me");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ memberId: member });
  });

  it("keeps concurrent Members apart", async () => {
    const members = Array.from({ length: 8 }, () => randomUUID());
    const responses = await Promise.all(members.map((m) => api.as(m).get("/v1/me")));
    expect(responses.map((r) => r.json().memberId)).toEqual(members);
  });
});
