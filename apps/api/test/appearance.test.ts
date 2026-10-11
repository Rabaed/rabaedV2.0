// Seam 1 for a Member's Appearance (owner decision 2026-10-11, spec RP-447): the Theme (Grey or
// Warm) and the Mode (Light, Dark or System) each Member chooses in their menu. It is theirs
// alone: kept by the API for the signed-in Member, given back with who they are (`/v1/me`),
// so every device paints in it from the first byte; nobody else's choice changes it.
import { defaultAppearance, type SignedInMember } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

let a: Caller;
let colleague: Caller;
let other: Caller;

const me = async (by: Caller) => (await by.get("/v1/me")).json() as SignedInMember;
const choose = (by: Caller, body: unknown) => by.request("PUT", "/v1/me/appearance", body);

beforeAll(async () => {
  const company = await api.authorizedPerson();
  a = company.caller;
  colleague = (await api.member(a)).caller;
  other = (await api.authorizedPerson()).caller;
});

describe("a Member's Appearance", () => {
  it("is Warm, following the device, until the Member chooses", async () => {
    expect((await me(a)).appearance).toEqual(defaultAppearance);
  });

  it("is kept for the Member who chose it, and given back with who they are", async () => {
    const res = await choose(a, { theme: "grey", mode: "dark" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ theme: "grey", mode: "dark" });
    expect((await me(a)).appearance).toEqual({ theme: "grey", mode: "dark" });
    expect((await choose(a, { theme: "warm", mode: "light" })).statusCode).toBe(200);
    expect((await me(a)).appearance).toEqual({ theme: "warm", mode: "light" });
  });

  it("is nobody else's: a colleague and another Company's Member keep their own", async () => {
    expect((await me(colleague)).appearance).toEqual(defaultAppearance);
    expect((await me(other)).appearance).toEqual(defaultAppearance);
    expect((await choose(other, { theme: "grey", mode: "system" })).statusCode).toBe(200);
    expect((await me(a)).appearance).toEqual({ theme: "warm", mode: "light" });
  });

  it("refuses a Theme or Mode the app doesn't offer", async () => {
    expect((await choose(a, { theme: "pink", mode: "dark" })).statusCode).toBe(400);
    expect((await choose(a, { theme: "grey", mode: "dusk" })).statusCode).toBe(400);
    expect((await choose(a, { theme: "grey" })).statusCode).toBe(400);
    expect((await me(a)).appearance).toEqual({ theme: "warm", mode: "light" });
  });

  it("needs a signed-in Member", async () => {
    expect((await choose(api.anonymous(), { theme: "grey", mode: "dark" })).statusCode).toBe(401);
  });
});
