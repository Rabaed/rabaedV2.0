// Seam 1: a Rabaed Engineer onboards a Company in Rabaed Admin and invites its
// Authorized Person, each with a reason written to admin_action (RP-187;
// RP-185 scenario 13; RP-254), and closes onboarding leads (RP-260).
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { MailMessage } from "@rabaed/mailer";
import { afterAll, describe, expect, it } from "vitest";
import { createTestAdmin, uniqueCr, uniqueEmail, uniqueVat } from "./support/harness.ts";

const admin = await createTestAdmin();
// Reads the audit trail directly.
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
afterAll(async () => {
  await admin.close();
  await adminDb.destroy();
});

const request = (overrides: Record<string, unknown> = {}) => ({
  legalName: { en: "Al Waha PMC", ar: "الواحة لإدارة المشاريع" },
  crNumber: uniqueCr(),
  vatNumber: uniqueVat(),
  authorizedPerson: { email: uniqueEmail("ap"), fullName: { en: "Sara Ahmed", ar: "سارة أحمد" }, locale: "ar" },
  reason: "Contract signed on 2026-09-28",
  ...overrides,
});

const invitations = (email: string) => admin.outbox.to(email).filter((m): m is MailMessage<"invitation"> => m.template === "invitation");

describe("onboarding a Company", () => {
  it("creates the Company and emails its Authorized Person an invitation, in their language", async () => {
    const { browser } = await admin.signedInEngineer();
    const body = request();
    const res = await browser.post("/v1/companies", body);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ companyId: expect.any(String), authorizedPersonId: expect.any(String), invitationSentTo: body.authorizedPerson.email });

    const [invitation] = invitations(body.authorizedPerson.email);
    expect(invitation).toMatchObject({ locale: "ar", values: { companyName: "الواحة لإدارة المشاريع" } });
    expect(invitation!.values.link).toMatch(/^https:\/\/web\.rabaed\.test\/ar\/accept-invitation#token=[\w-]+$/);
  });

  it("records the action and its reason in admin_action, without the invitation token", async () => {
    const { id, browser } = await admin.signedInEngineer();
    const body = request({ reason: "Pilot customer, ticket OPS-12" });
    const { companyId } = (await browser.post("/v1/companies", body)).json();
    const actions = await adminDb
      .selectFrom("admin_action")
      .select(["engineer_id", "action", "target_kind", "reason", "after"])
      .where("target_id", "=", companyId)
      .execute();
    expect(actions).toEqual([
      expect.objectContaining({ engineer_id: id, action: "onboard_company", target_kind: "company", reason: "Pilot customer, ticket OPS-12" }),
    ]);
    const token = new URL(invitations(body.authorizedPerson.email)[0]!.values.link).hash.replace("#token=", "");
    expect(JSON.stringify(actions[0]!.after)).not.toContain(token);
  });

  it("is rejected without a reason, and creates nothing", async () => {
    const { browser } = await admin.signedInEngineer();
    const body = request({ reason: "   " });
    expect((await browser.post("/v1/companies", body)).statusCode).toBe(400);
    const { reason: _omitted, ...withoutReason } = body;
    expect((await browser.post("/v1/companies", withoutReason)).statusCode).toBe(400);
    // The same CR, VAT and email are still free.
    expect((await browser.post("/v1/companies", { ...body, reason: "Now with a reason" })).statusCode).toBe(201);
  });

  it("rejects a duplicate CR number, VAT number or Authorized Person email", async () => {
    const { browser } = await admin.signedInEngineer();
    const first = request();
    expect((await browser.post("/v1/companies", first)).statusCode).toBe(201);
    for (const [overrides, error] of [
      [{ crNumber: first.crNumber }, "duplicate_cr_number"],
      [{ vatNumber: first.vatNumber }, "duplicate_vat_number"],
      [{ authorizedPerson: first.authorizedPerson }, "duplicate_email"],
    ] as const) {
      const res = await browser.post("/v1/companies", request(overrides));
      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error } });
    }
  });

  it("rejects malformed CR and VAT numbers", async () => {
    const { browser } = await admin.signedInEngineer();
    expect((await browser.post("/v1/companies", request({ crNumber: "12345" }))).statusCode).toBe(400);
    expect((await browser.post("/v1/companies", request({ vatNumber: "123456789012345" }))).statusCode).toBe(400);
  });

  it("needs a signed-in Engineer: the password alone is not enough", async () => {
    expect((await admin.browser().post("/v1/companies", request())).statusCode).toBe(401);
    const engineer = await admin.newEngineer();
    const halfway = admin.browser();
    await halfway.post("/v1/sign-in", { email: engineer.email, password: "a long enough test password" });
    expect((await halfway.post("/v1/companies", request())).statusCode).toBe(401);
  });
});

describe("inviting an Authorized Person again", () => {
  it("emails a new invitation, with its reason in admin_action", async () => {
    const { browser } = await admin.signedInEngineer();
    const body = request();
    const { companyId } = (await browser.post("/v1/companies", body)).json();

    const res = await browser.post("/v1/invitations", { crNumber: body.crNumber, reason: "The first invitation expired" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ companyId, invitationSentTo: body.authorizedPerson.email });
    const sent = invitations(body.authorizedPerson.email);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.values.link).not.toBe(sent[0]!.values.link);

    const actions = await adminDb.selectFrom("admin_action").select(["action", "reason"]).where("target_id", "=", companyId).orderBy("at").execute();
    expect(actions).toEqual([
      { action: "onboard_company", reason: body.reason },
      { action: "invite_authorized_person", reason: "The first invitation expired" },
    ]);
  });

  it("needs a reason", async () => {
    const { browser } = await admin.signedInEngineer();
    const body = request();
    await browser.post("/v1/companies", body);
    expect((await browser.post("/v1/invitations", { crNumber: body.crNumber, reason: " " })).statusCode).toBe(400);
    expect(invitations(body.authorizedPerson.email)).toHaveLength(1);
  });

  it("answers 404 for a CR number no Company has", async () => {
    const { browser } = await admin.signedInEngineer();
    const res = await browser.post("/v1/invitations", { crNumber: uniqueCr(), reason: "Asked by phone" });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
  });
});

describe("onboarding leads", () => {
  it("are read with a reason, which is logged", async () => {
    const { id, browser } = await admin.signedInEngineer();
    expect((await browser.get("/v1/onboarding-leads")).statusCode).toBe(400);
    const res = await browser.get(`/v1/onboarding-leads?reason=${encodeURIComponent("Weekly onboarding call")}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ leads: expect.any(Array) });
    const logged = await adminDb
      .selectFrom("admin_action")
      .select("reason")
      .where("engineer_id", "=", id)
      .where("action", "=", "read_onboarding_leads")
      .execute();
    expect(logged).toEqual([{ reason: "Weekly onboarding call" }]);
  });

  // The happy path, against a real lead, is in apps/api/test/participant-invitations.test.ts (RP-260).
  it("are closed with a reason, by a signed-in Engineer, and only when open", async () => {
    const { id, browser } = await admin.signedInEngineer();
    const url = `/v1/onboarding-leads/${randomUUID()}/close`;
    expect((await admin.browser().post(url, { reason: "Tidying up" })).statusCode).toBe(401);
    expect((await browser.post(url, { reason: "  " })).statusCode).toBe(400);
    expect((await browser.post("/v1/onboarding-leads/not-a-uuid/close", { reason: "Tidying up" })).statusCode).toBe(400);
    const res = await browser.post(url, { reason: "Tidying up" });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
    const logged = await adminDb.selectFrom("admin_action").select("id").where("engineer_id", "=", id).execute();
    expect(logged).toEqual([]);
  });
});
