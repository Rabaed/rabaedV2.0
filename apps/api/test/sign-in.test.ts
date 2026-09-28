// Seam 1: invitations, sign-in and sign-out (RP-187).
import { afterAll, describe, expect, it } from "vitest";
import { createTestApi, DEFAULT_PASSWORD, HOUR, testConfig, uniqueEmail } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

describe("accepting an invitation", () => {
  it("sets the password and signs the Authorized Person in", async () => {
    const company = await api.onboardCompany();
    const caller = await api.acceptInvitation(company.invitationToken);
    const me = await caller.get("/v1/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      member: {
        id: company.authorizedPerson.id,
        email: company.authorizedPerson.email,
        fullName: { en: "Test Person", ar: "شخص الاختبار" },
        locale: "en",
        isAuthorizedPerson: true,
        canCreateProjects: false,
      },
      company: { id: company.companyId, legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" } },
    });
  });

  it("works only once", async () => {
    const company = await api.onboardCompany();
    await api.acceptInvitation(company.invitationToken);
    const again = await api.anonymous().post("/v1/invitations/accept", {
      token: company.invitationToken,
      password: "another long password",
    });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: "invalid_invitation" });
    // The first password still stands.
    expect((await api.anonymous().post("/v1/session", { email: company.authorizedPerson.email, password: DEFAULT_PASSWORD })).statusCode).toBe(204);
  });

  it("expires", async () => {
    const company = await api.onboardCompany();
    api.advanceClock(testConfig.invitationTtlMs + 1);
    const res = await api.anonymous().post("/v1/invitations/accept", {
      token: company.invitationToken,
      password: DEFAULT_PASSWORD,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_invitation" });
  });

  it("gives an unknown token the same answer", async () => {
    const res = await api.anonymous().post("/v1/invitations/accept", { token: "made-up", password: DEFAULT_PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_invitation" });
  });

  it("refuses a short password and leaves the invitation usable", async () => {
    const company = await api.onboardCompany();
    const res = await api.anonymous().post("/v1/invitations/accept", { token: company.invitationToken, password: "short" });
    expect(res.statusCode).toBe(400);
    await api.acceptInvitation(company.invitationToken);
  });
});

describe("signing in", () => {
  it("signs in with the right email and password", async () => {
    const company = await api.onboardCompany();
    await api.acceptInvitation(company.invitationToken);
    const caller = await api.signIn(company.authorizedPerson.email, DEFAULT_PASSWORD);
    expect((await caller.get("/v1/me")).statusCode).toBe(200);
  });

  it("ignores the email's case and surrounding spaces", async () => {
    const company = await api.onboardCompany();
    await api.acceptInvitation(company.invitationToken);
    await api.signIn(`  ${company.authorizedPerson.email.toUpperCase()} `, DEFAULT_PASSWORD);
  });

  it("gives a wrong password, an unknown email and a not-yet-accepted invitation the same answer", async () => {
    const accepted = await api.onboardCompany();
    await api.acceptInvitation(accepted.invitationToken);
    const pending = await api.onboardCompany();

    const attempts = [
      { email: accepted.authorizedPerson.email, password: "the wrong password" },
      { email: uniqueEmail("nobody"), password: DEFAULT_PASSWORD },
      { email: pending.authorizedPerson.email, password: DEFAULT_PASSWORD },
    ];
    const responses = await Promise.all(attempts.map((a) => api.anonymous().post("/v1/session", a)));
    for (const res of responses) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "invalid_credentials" });
      expect(res.cookies).toEqual([]);
    }
  });

  it("uses an HttpOnly, SameSite, Secure session cookie", async () => {
    const company = await api.onboardCompany();
    const res = await api.anonymous().post("/v1/invitations/accept", {
      token: company.invitationToken,
      password: DEFAULT_PASSWORD,
    });
    expect(res.cookies).toEqual([
      expect.objectContaining({ name: "rabaed_session", httpOnly: true, sameSite: "Lax", secure: true, path: "/" }),
    ]);
  });

  it("does not let a Rabaed Engineer act as a Member", async () => {
    const engineer = await api.engineer();
    expect((await engineer.get("/v1/me")).statusCode).toBe(401);
  });

  it("does not let a Member sign in to Rabaed Admin", async () => {
    const company = await api.onboardCompany();
    await api.acceptInvitation(company.invitationToken);
    const res = await api
      .anonymous()
      .post("/admin/v1/session", { email: company.authorizedPerson.email, password: DEFAULT_PASSWORD });
    expect(res.statusCode).toBe(401);
  });
});

describe("sessions", () => {
  it("end on the server at sign-out", async () => {
    const { caller } = await api.authorizedPerson();
    const token = caller.sessionToken;
    expect((await caller.delete("/v1/session")).statusCode).toBe(204);
    expect(caller.sessionToken).toBeUndefined();

    // Replaying the old cookie no longer works.
    caller.useSessionToken(token);
    const res = await caller.get("/v1/me");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "not_signed_in" });
  });

  it("are replaced, not stacked, when signing in again", async () => {
    const { company, caller } = await api.authorizedPerson();
    const first = caller.sessionToken;
    expect((await caller.post("/v1/session", { email: company.authorizedPerson.email, password: DEFAULT_PASSWORD })).statusCode).toBe(204);
    expect(caller.sessionToken).not.toBe(first);
    expect((await caller.get("/v1/me")).statusCode).toBe(200);

    caller.useSessionToken(first);
    expect((await caller.get("/v1/me")).statusCode).toBe(401);
  });

  it("expire", async () => {
    const { caller } = await api.authorizedPerson();
    api.advanceClock(testConfig.sessionTtlMs - HOUR);
    expect((await caller.get("/v1/me")).statusCode).toBe(200);
    api.advanceClock(2 * HOUR);
    expect((await caller.get("/v1/me")).statusCode).toBe(401);
  });

  it("are required", async () => {
    const res = await api.anonymous().get("/v1/me");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "not_signed_in" });
  });
});
