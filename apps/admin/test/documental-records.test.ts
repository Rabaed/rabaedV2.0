// A Rabaed Engineer reads the Documental Record alerts and asks for a Re-produce in Rabaed
// Admin (RP-155, spec RP-632; ADR 0023): each with a reason, logged in admin_action. The
// record job and the Re-produce itself are checked with the customer api's tests
// (apps/api/test/record-checks.test.ts).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { afterAll, describe, expect, it } from "vitest";
import { createTestAdmin } from "./support/harness.ts";

const admin = await createTestAdmin();
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
afterAll(async () => {
  await admin.close();
  await adminDb.destroy();
});

describe("Documental Record alerts", () => {
  it("are read with a reason, which is logged", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const refused = await browser.get("/v1/documental-record-alerts");
    expect(refused.statusCode).toBe(400);
    const res = await browser.get("/v1/documental-record-alerts?reason=Morning%20check");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().alerts).toBeInstanceOf(Array);
    const logged = await adminDb
      .selectFrom("admin_action")
      .select(["engineer_id", "target_kind", "reason"])
      .where("action", "=", "read_documental_record_alerts")
      .where("engineer_id", "=", engineerId)
      .execute();
    expect(logged).toEqual([expect.objectContaining({ target_kind: "documental_record", reason: "Morning check" })]);
  });
});

describe("Re-produce", () => {
  const itemId = "0198f5c0-0000-7000-8000-000000000000";

  it("needs a reason, and is the plain 404 for an item with no record", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    expect((await browser.post(`/v1/work-items/${itemId}/documental-record/reproduce`, {})).statusCode).toBe(400);
    expect((await browser.post(`/v1/work-items/${itemId}/documental-record/reproduce`, { reason: "   " })).statusCode).toBe(400);
    const res = await browser.post(`/v1/work-items/${itemId}/documental-record/reproduce`, { reason: "Seal date bug" });
    expect(res.statusCode).toBe(404);
    const logged = await adminDb
      .selectFrom("admin_action")
      .select(["target_kind", "reason", "after"])
      .where("action", "=", "reproduce_documental_record")
      .where("engineer_id", "=", engineerId)
      .execute();
    expect(logged).toEqual([expect.objectContaining({ target_kind: "documental_record", reason: "Seal date bug", after: { result: "not_found" } })]);
  });

  it("is refused to anyone not signed in", async () => {
    expect((await admin.browser().post(`/v1/work-items/${itemId}/documental-record/reproduce`, { reason: "x" })).statusCode).toBe(401);
    expect((await admin.browser().get("/v1/documental-record-alerts?reason=x")).statusCode).toBe(401);
  });
});
