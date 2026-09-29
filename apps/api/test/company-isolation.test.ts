// Seam 1: a Member of Company A cannot read Company B's record (RP-187).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

let a: { company: OnboardedCompany; caller: Caller };
let b: { company: OnboardedCompany; caller: Caller };
beforeAll(async () => {
  a = await api.authorizedPerson();
  b = await api.authorizedPerson();
});

describe("a Company's record", () => {
  it("is readable by its own Members", async () => {
    const res = await a.caller.get(`/v1/companies/${a.company.companyId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: a.company.companyId,
      legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" },
      crNumber: a.company.crNumber,
      vatNumber: a.company.vatNumber,
      status: "active",
      authorizedPersonId: a.company.authorizedPerson.id,
    });
  });

  it("is not found for another Company's Member, exactly like an id that doesn't exist", async () => {
    const other = await a.caller.get(`/v1/companies/${b.company.companyId}`);
    const missing = await a.caller.get(`/v1/companies/${randomUUID()}`);
    const malformed = await a.caller.get("/v1/companies/not-an-id");
    for (const res of [other, missing, malformed]) {
      await expectHidden(res);
    }
  });

  it("works the other way round too", async () => {
    await expectHidden(b.caller.get(`/v1/companies/${a.company.companyId}`));
    expect((await b.caller.get(`/v1/companies/${b.company.companyId}`)).statusCode).toBe(200);
  });

  it("needs a signed-in Member", async () => {
    expect((await api.anonymous().get(`/v1/companies/${a.company.companyId}`)).statusCode).toBe(401);
  });
});
