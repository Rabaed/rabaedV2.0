// Seam 1: the harness's later() moves the clock and keeps every signed-in caller working (RP-385).
import { afterAll, describe, expect, it } from "vitest";
import { createTestApi, DEFAULT_PASSWORD } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

const DAY = 86_400_000;

describe("later()", () => {
  it("keeps callers made before a 14 day move working, whichever way they signed in", async () => {
    const { company, caller: person } = await api.authorizedPerson();
    const { caller: member } = await api.member(person);
    const signedIn = await api.signIn(company.authorizedPerson.email, DEFAULT_PASSWORD, "ar");
    const before = api.now().getTime();

    await api.later(14 * DAY);

    expect(api.now().getTime() - before).toBeGreaterThanOrEqual(14 * DAY);
    for (const caller of [person, member, signedIn]) expect((await caller.get("/v1/me")).statusCode).toBe(200);
  });

  it("is what keeps them working: advanceClock alone ends the sessions", async () => {
    const { caller } = await api.authorizedPerson();
    api.advanceClock(14 * DAY);
    expect((await caller.get("/v1/me")).statusCode).toBe(401);
  });
});
