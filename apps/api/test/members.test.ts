// Seam 1: the Authorized Person manages Members (RP-188; RP-185 stories 5–8, 13).
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createTestApi, DEFAULT_PASSWORD, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

let a: { company: OnboardedCompany; caller: Caller };
let b: { company: OnboardedCompany; caller: Caller };
beforeAll(async () => {
  a = await api.authorizedPerson();
  b = await api.authorizedPerson();
});

const ids = (res: { json(): { members: { id: string }[] } }) => res.json().members.map((m) => m.id);

describe("inviting a Member", () => {
  it("lets the invited Member accept, set a password and sign in", async () => {
    const invited = await api.inviteMember(a.caller, {
      fullName: { en: "Khalid Omar", ar: "خالد عمر" },
      locale: "ar",
    });
    const caller = await api.acceptInvitation(invited.invitationToken);
    const me = await caller.get("/v1/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      member: {
        id: invited.id,
        email: invited.email,
        fullName: { en: "Khalid Omar", ar: "خالد عمر" },
        locale: "ar",
        isAuthorizedPerson: false,
        canCreateProjects: false,
      },
      company: { id: a.company.companyId, legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" } },
    });
    // And signs in again later with that password.
    await api.signIn(invited.email, DEFAULT_PASSWORD);
  });

  it("lists the invited Member as invited until they accept", async () => {
    const invited = await api.inviteMember(a.caller);
    const before = (await a.caller.get("/v1/members")).json().members.find((m: { id: string }) => m.id === invited.id);
    expect(before).toEqual({
      id: invited.id,
      email: invited.email,
      fullName: { en: "Test Member", ar: "عضو الاختبار" },
      locale: "en",
      status: "invited",
      isAuthorizedPerson: false,
      canCreateProjects: false,
    });
    await api.acceptInvitation(invited.invitationToken);
    const after = (await a.caller.get("/v1/members")).json().members.find((m: { id: string }) => m.id === invited.id);
    expect(after.status).toBe("active");
  });

  it("rejects an email that is already a Member, in any Company", async () => {
    const res = await a.caller.post("/v1/members", {
      email: b.company.authorizedPerson.email,
      fullName: { en: "Someone", ar: "شخص" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "duplicate_email" });
  });

  it("rejects a malformed request", async () => {
    expect((await a.caller.post("/v1/members", { email: "not-an-email", fullName: { en: "X", ar: "س" } })).statusCode).toBe(400);
    expect((await a.caller.post("/v1/members", { email: "x@rabaed.test", fullName: { en: "X" } })).statusCode).toBe(400);
  });

  it("is only for the Authorized Person", async () => {
    const { caller: member } = await api.member(a.caller);
    const res = await member.post("/v1/members", { email: "blocked@rabaed.test", fullName: { en: "X", ar: "س" } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden" });
    expect((await api.anonymous().post("/v1/members", { email: "x@rabaed.test", fullName: { en: "X", ar: "س" } })).statusCode).toBe(401);
  });
});

describe("the Members list", () => {
  it("shows every Member of the Company, the Authorized Person included", async () => {
    const { member } = await api.member(a.caller);
    const res = await a.caller.get("/v1/members");
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual(expect.arrayContaining([a.company.authorizedPerson.id, member.id]));
    const ap = res.json().members.find((m: { id: string }) => m.id === a.company.authorizedPerson.id);
    expect(ap).toMatchObject({ isAuthorizedPerson: true, status: "active" });
  });

  it("is readable by any Member of the Company", async () => {
    const { caller } = await api.member(a.caller);
    const res = await caller.get("/v1/members");
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toContain(a.company.authorizedPerson.id);
  });

  it("never shows another Company's Members", async () => {
    const { member: bMember } = await api.member(b.caller);
    const seenByA = ids(await a.caller.get("/v1/members"));
    expect(seenByA).not.toContain(b.company.authorizedPerson.id);
    expect(seenByA).not.toContain(bMember.id);
    const seenByB = ids(await b.caller.get("/v1/members"));
    expect(seenByB).not.toContain(a.company.authorizedPerson.id);
  });

  it("needs a signed-in Member", async () => {
    expect((await api.anonymous().get("/v1/members")).statusCode).toBe(401);
  });
});

describe("the Project Creator flag", () => {
  it("is set and cleared by the Authorized Person", async () => {
    const { member, caller } = await api.member(a.caller);
    const on = await a.caller.patch(`/v1/members/${member.id}`, { canCreateProjects: true });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toMatchObject({ id: member.id, canCreateProjects: true });
    expect((await caller.get("/v1/me")).json().member.canCreateProjects).toBe(true);

    const off = await a.caller.patch(`/v1/members/${member.id}`, { canCreateProjects: false });
    expect(off.json()).toMatchObject({ canCreateProjects: false });
    expect((await caller.get("/v1/me")).json().member.canCreateProjects).toBe(false);
  });

  it("can be set on an invited Member before they accept", async () => {
    const invited = await api.inviteMember(a.caller);
    expect((await a.caller.patch(`/v1/members/${invited.id}`, { canCreateProjects: true })).statusCode).toBe(200);
    const caller = await api.acceptInvitation(invited.invitationToken);
    expect((await caller.get("/v1/me")).json().member.canCreateProjects).toBe(true);
  });

  it("can be set on the Authorized Person themselves", async () => {
    const res = await a.caller.patch(`/v1/members/${a.company.authorizedPerson.id}`, { canCreateProjects: true });
    expect(res.statusCode).toBe(200);
    expect((await a.caller.get("/v1/me")).json().member.canCreateProjects).toBe(true);
  });

  it("cannot be set on a deactivated Member", async () => {
    const { member } = await api.member(a.caller);
    await a.caller.post(`/v1/members/${member.id}/deactivate`);
    const res = await a.caller.patch(`/v1/members/${member.id}`, { canCreateProjects: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "member_deactivated" });
  });

  it("is only for the Authorized Person", async () => {
    const { member, caller } = await api.member(a.caller);
    const res = await caller.patch(`/v1/members/${member.id}`, { canCreateProjects: true });
    expect(res.statusCode).toBe(403);
    expect((await caller.get("/v1/me")).json().member.canCreateProjects).toBe(false);
  });

  it("treats another Company's Member exactly like one that doesn't exist", async () => {
    const { member: bMember, caller: bCaller } = await api.member(b.caller);
    const other = await a.caller.patch(`/v1/members/${bMember.id}`, { canCreateProjects: true });
    const missing = await a.caller.patch(`/v1/members/${randomUUID()}`, { canCreateProjects: true });
    const malformed = await a.caller.patch("/v1/members/not-an-id", { canCreateProjects: true });
    for (const res of [other, missing, malformed]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not_found" });
    }
    expect((await bCaller.get("/v1/me")).json().member.canCreateProjects).toBe(false);
  });
});

describe("deactivating a Member", () => {
  it("ends their session at once and stops them signing in", async () => {
    const { member, caller } = await api.member(a.caller);
    expect((await caller.get("/v1/me")).statusCode).toBe(200);

    const res = await a.caller.post(`/v1/members/${member.id}/deactivate`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: member.id, status: "deactivated" });

    const me = await caller.get("/v1/me");
    expect(me.statusCode).toBe(401);
    expect(me.json()).toEqual({ error: "not_signed_in" });
    const again = await api.anonymous().post("/v1/session", { email: member.email, password: DEFAULT_PASSWORD });
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: "invalid_credentials" });
  });

  it("voids a pending invitation", async () => {
    const invited = await api.inviteMember(a.caller);
    await a.caller.post(`/v1/members/${invited.id}/deactivate`);
    const res = await api.anonymous().post("/v1/invitations/accept", {
      token: invited.invitationToken,
      password: DEFAULT_PASSWORD,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_invitation" });
  });

  it("keeps them on the Members list, as deactivated", async () => {
    const { member } = await api.member(a.caller);
    await a.caller.post(`/v1/members/${member.id}/deactivate`);
    const row = (await a.caller.get("/v1/members")).json().members.find((m: { id: string }) => m.id === member.id);
    expect(row).toMatchObject({ status: "deactivated" });
  });

  it("is idempotent", async () => {
    const { member } = await api.member(a.caller);
    expect((await a.caller.post(`/v1/members/${member.id}/deactivate`)).statusCode).toBe(200);
    expect((await a.caller.post(`/v1/members/${member.id}/deactivate`)).statusCode).toBe(200);
  });

  it("cannot deactivate the Authorized Person", async () => {
    const res = await a.caller.post(`/v1/members/${a.company.authorizedPerson.id}/deactivate`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "authorized_person" });
    expect((await a.caller.get("/v1/me")).statusCode).toBe(200);
  });

  it("is only for the Authorized Person", async () => {
    const { member: target, caller: targetCaller } = await api.member(a.caller);
    const { caller } = await api.member(a.caller);
    const res = await caller.post(`/v1/members/${target.id}/deactivate`);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden" });
    expect((await targetCaller.get("/v1/me")).statusCode).toBe(200);
  });

  it("treats another Company's Member exactly like one that doesn't exist", async () => {
    const { member: bMember, caller: bCaller } = await api.member(b.caller);
    const other = await a.caller.post(`/v1/members/${bMember.id}/deactivate`);
    const missing = await a.caller.post(`/v1/members/${randomUUID()}/deactivate`);
    for (const res of [other, missing]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not_found" });
    }
    expect((await bCaller.get("/v1/me")).statusCode).toBe(200);
  });
});
