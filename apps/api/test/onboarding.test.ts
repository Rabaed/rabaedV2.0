// Seam 1: a Rabaed Engineer onboards a Company (RP-187; RP-185 scenario 13).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { afterAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, uniqueCr, uniqueEmail, uniqueVat } from "./support/harness.ts";

const api = await createTestApi();
// Reads the audit trail the way Rabaed Admin would.
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
afterAll(async () => {
  await api.close();
  await adminDb.destroy();
});

const request = (overrides: Record<string, unknown> = {}) => ({
  legalName: { en: "Al Waha PMC", ar: "الواحة لإدارة المشاريع" },
  crNumber: uniqueCr(),
  vatNumber: uniqueVat(),
  authorizedPerson: { email: uniqueEmail("ap"), fullName: { en: "Sara Ahmed", ar: "سارة أحمد" } },
  reason: "Contract signed on 2026-09-28",
  ...overrides,
});

describe("onboarding a Company", () => {
  it("creates the Company and invites its Authorized Person", async () => {
    const engineer = await api.engineer();
    const res = await engineer.post("/admin/v1/companies", request());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({
      companyId: expect.any(String),
      authorizedPersonId: expect.any(String),
      invitation: { token: expect.any(String), expiresAt: expect.any(String) },
    });
  });

  it("records the action and its reason in admin_action", async () => {
    const engineer = await api.engineer();
    const res = await engineer.post("/admin/v1/companies", request({ reason: "Pilot customer, ticket OPS-12" }));
    const { companyId } = res.json();
    const actions = await adminDb
      .selectFrom("admin_action")
      .select(["action", "target_kind", "reason", "after"])
      .where("target_id", "=", companyId)
      .execute();
    expect(actions).toEqual([
      expect.objectContaining({ action: "onboard_company", target_kind: "company", reason: "Pilot customer, ticket OPS-12" }),
    ]);
    // The invitation token is a secret: it must not end up in the audit trail.
    expect(JSON.stringify(actions[0]!.after)).not.toContain(res.json().invitation.token);
  });

  it("is rejected without a reason, and creates nothing", async () => {
    const engineer = await api.engineer();
    const body = request({ reason: "   " });
    expect((await engineer.post("/admin/v1/companies", body)).statusCode).toBe(400);
    const { reason: _omitted, ...withoutReason } = body;
    expect((await engineer.post("/admin/v1/companies", withoutReason)).statusCode).toBe(400);
    // The same CR, VAT and email are still free.
    expect((await engineer.post("/admin/v1/companies", { ...body, reason: "Now with a reason" })).statusCode).toBe(201);
  });

  it("rejects a duplicate CR number", async () => {
    const engineer = await api.engineer();
    const first = request();
    expect((await engineer.post("/admin/v1/companies", first)).statusCode).toBe(201);
    const res = await engineer.post("/admin/v1/companies", request({ crNumber: first.crNumber }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "duplicate_cr_number" });
  });

  it("rejects a duplicate VAT number", async () => {
    const engineer = await api.engineer();
    const first = request();
    expect((await engineer.post("/admin/v1/companies", first)).statusCode).toBe(201);
    const res = await engineer.post("/admin/v1/companies", request({ vatNumber: first.vatNumber }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "duplicate_vat_number" });
  });

  it("rejects an Authorized Person whose email is already a Member", async () => {
    const engineer = await api.engineer();
    const first = request();
    await engineer.post("/admin/v1/companies", first);
    const res = await engineer.post(
      "/admin/v1/companies",
      request({ authorizedPerson: { ...first.authorizedPerson } }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "duplicate_email" });
  });

  it("rejects malformed CR and VAT numbers", async () => {
    const engineer = await api.engineer();
    expect((await engineer.post("/admin/v1/companies", request({ crNumber: "12345" }))).statusCode).toBe(400);
    expect((await engineer.post("/admin/v1/companies", request({ vatNumber: "123456789012345" }))).statusCode).toBe(400);
  });

  it("does not exist for anyone but a Rabaed Engineer", async () => {
    const { caller: member } = await api.authorizedPerson();
    for (const caller of [api.anonymous(), member]) {
      const res = await caller.post("/admin/v1/companies", request());
      await expectHidden(res);
    }
  });
});

