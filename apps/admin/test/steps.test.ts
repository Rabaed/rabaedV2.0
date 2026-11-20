// Seam: Rabaed Admin as a signed-in Rabaed Engineer (RP-1162, UAT ADM-10; workflow-engine.md
// §5.6, ADR 0018). C1 Submits a MAR to K1, whose two managers share the pool and nobody picks
// it up. The Engineer finds it by Project and Document Number, reads its Step, holding Company
// and pool, and hands it to one K1 manager, then back to K1's pool: each read and each command
// is an admin_action with its reason. Another Company's Member is never accepted. K1's history
// reads "by Rabaed" with no person; C1 reads nothing of it (seam 1 and seam 2 have the rest:
// apps/api/test/admin-reassign-step.test.ts, packages/db/test/admin-reassign-step-rls.test.ts).
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "../../api/test/support/harness.ts";
import { buildTower, detail, draft, inInternalReview, memberOnProject, submitted, type Tower } from "../../api/test/support/tower.ts";
import { createTestAdmin, type Browser } from "./support/harness.ts";

// With the file store: a MAR's Draft attaches its datasheet.
const api = await createTestApi({ files: true });
const admin = await createTestAdmin();
// Reads the audit trail directly.
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
afterAll(async () => {
  await admin.close();
  await api.close();
  await adminDb.destroy();
});

const reason = "K1's manager is on leave and the MAR has waited two weeks, ticket #5310";

type Person = Awaited<ReturnType<typeof memberOnProject>>;
let tower: Tower;
let mar = "";
let documentNumber = "";
let khalid: Person;
let sara: Person;
let c1Engineer: Person;
let engineer: { id: string; email: string; browser: Browser };

const actionsOf = (engineerId: string, action: "read_work_item_step" | "reassign_step") =>
  adminDb
    .selectFrom("admin_action")
    .select(["target_kind", "target_id", "reason", "before", "after"])
    .where("engineer_id", "=", engineerId)
    .where("action", "=", action)
    .orderBy("seq")
    .execute();
const find = (number: string, why = reason) =>
  engineer.browser.get(`/v1/steps?projectId=${tower.projectId}&item=${encodeURIComponent(number)}&reason=${encodeURIComponent(why)}`);
/** The Engineer's reassign of the MAR's Step; `why` null sends no reason at all. */
const reassign = (toMemberId: string | null, why: string | null = reason) =>
  engineer.browser.post(`/v1/work-items/${mar}/step/reassign`, why === null ? { toMemberId } : { toMemberId, reason: why });
const historyTypes = async (person: { caller: Caller }) =>
  ((await person.caller.get(`/v1/work-items/${mar}/history`)).json() as { events: { type: string }[] }).events.map((e) => e.type);

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  tower = await buildTower(api, { c1, k1 }, "ADS");
  khalid = await memberOnProject(api, k1, tower.k1ParticipantId!, ["manager"], { name: "Khalid Manager" });
  sara = await memberOnProject(api, k1, tower.k1ParticipantId!, ["manager"], { name: "Sara Manager" });
  c1Engineer = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"], { name: "Omar Engineer" });
  mar = await submitted(tower, c1Engineer.caller, tower.c1Pm, "Cable tray, galvanised");
  documentNumber = (await detail(tower.c1Pm, mar)).documentNumber!;
  engineer = await admin.signedInEngineer();
});

describe("finding a stuck Step (RP-1162)", () => {
  it("lists the active Projects with a reason, logged", async () => {
    const res = await engineer.browser.get(`/v1/steps/projects?reason=${encodeURIComponent(reason)}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().projects.map((p: { id: string }) => p.id)).toContain(tower.projectId);
    expect(await actionsOf(engineer.id, "read_work_item_step")).toEqual([expect.objectContaining({ target_kind: "project", target_id: null, reason })]);
  });

  it("needs a reason, and is refused to anyone not signed in", async () => {
    expect((await find(documentNumber, "  ")).statusCode).toBe(400);
    expect((await engineer.browser.get(`/v1/steps?projectId=${tower.projectId}&item=${encodeURIComponent(documentNumber)}`)).statusCode).toBe(400);
    expect((await admin.browser().get(`/v1/steps?projectId=${tower.projectId}&item=x&reason=x`)).statusCode).toBe(401);
    expect((await admin.browser().post(`/v1/work-items/${mar}/step/reassign`, { toMemberId: null, reason: "x" })).statusCode).toBe(401);
  });

  it("finds the MAR by Project and Document Number, in any case, with its Step, holding Company and pool, logged with the item", async () => {
    for (const number of [documentNumber, documentNumber.toLowerCase()]) {
      const res = await find(number);
      expect(res.statusCode, res.body).toBe(200);
      const found = res.json();
      expect(found).toMatchObject({ workItemId: mar, documentNumber, title: "Cable tray, galvanised", closed: false });
      expect(found.step).toMatchObject({ status: "pooled", draft: false, holderMemberId: null, participant: { id: tower.k1ParticipantId } });
      expect(found.step.pool.map((m: { memberId: string }) => m.memberId)).toEqual(expect.arrayContaining([khalid.id, sara.id]));
      // The holding Participant's own pool: none of C1's people.
      expect(found.step.pool.map((m: { memberId: string }) => m.memberId)).not.toContain(c1Engineer.id);
    }
    const logged = (await actionsOf(engineer.id, "read_work_item_step")).filter((a) => a.target_kind === "work_item");
    expect(logged).toEqual([
      expect.objectContaining({ target_id: mar, reason, after: { documentNumber, found: true } }),
      expect.objectContaining({ target_id: mar, reason, after: { documentNumber, found: true } }),
    ]);
  });

  it("is the plain 404 for a number the Project never issued, logged against the Project", async () => {
    expect((await find("NOPE-0000")).statusCode).toBe(404);
    expect((await actionsOf(engineer.id, "read_work_item_step")).at(-1)).toEqual(
      expect.objectContaining({ target_kind: "project", target_id: tower.projectId, after: { sought: "NOPE-0000", found: false } }),
    );
  });
});

describe("finding an item before its first Submit, with no number yet (RP-1319, ADR 0030)", () => {
  let inReview = "";
  beforeAll(async () => {
    inReview = await inInternalReview(tower, c1Engineer.caller, "Busbar trunking, no number yet");
    expect((await detail(tower.c1Pm, inReview)).documentNumber).toBeNull();
  });

  it("finds it by its link, as the app links to it, or by its id: no number, C1's own Step and pool", async () => {
    for (const typed of [
      `https://rabaed.test/en/work-items/${inReview}`,
      `https://rabaed.test/ar/work-items/${inReview.toUpperCase()}?tab=history`,
      `  ${inReview}  `,
    ]) {
      const res = await find(typed);
      expect(res.statusCode, typed).toBe(200);
      const found = res.json();
      expect(found).toMatchObject({ workItemId: inReview, documentNumber: null, title: "Busbar trunking, no number yet", closed: false });
      expect(found.step).toMatchObject({ draft: false, participant: { id: tower.c1ParticipantId } });
      expect(found.step.pool.map((m: { memberId: string }) => m.memberId)).not.toContain(khalid.id);
    }
    expect((await actionsOf(engineer.id, "read_work_item_step")).at(-1)).toEqual(
      expect.objectContaining({ target_kind: "work_item", target_id: inReview, reason, after: { documentNumber: null, found: true } }),
    );
  });

  it("is the plain 404 by its Subject, for a made-up item's link, and for a Draft's link: a Draft is its author's alone", async () => {
    const aDraft = await draft(tower, c1Engineer.caller, "Draft busbar");
    for (const typed of ["Busbar trunking, no number yet", `https://rabaed.test/en/work-items/${randomUUID()}`, `https://rabaed.test/en/work-items/${aDraft}`]) {
      expect((await find(typed)).statusCode, typed).toBe(404);
    }
  });
});

describe("reassigning it (RP-1162)", () => {
  it("needs a reason", async () => {
    expect((await reassign(khalid.id, null)).statusCode).toBe(400);
    expect((await reassign(khalid.id, " ")).statusCode).toBe(400);
  });

  it("never hands it to another Company's Member: not_offered, logged, and nothing changes", async () => {
    const res = await reassign(c1Engineer.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "not_offered" });
    expect(await actionsOf(engineer.id, "reassign_step")).toEqual([
      expect.objectContaining({ target_kind: "work_item", target_id: mar, reason, before: { holderMemberId: null }, after: { result: "not_offered", toMemberId: c1Engineer.id } }),
    ]);
    expect((await (await find(documentNumber)).json()).step).toMatchObject({ status: "pooled", holderMemberId: null });
  });

  it("hands it to a K1 manager, logged with the holder before and after; K1 reads it as Rabaed's, C1 reads nothing", async () => {
    const res = await reassign(khalid.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ result: "reassigned" });
    expect((await (await find(documentNumber)).json()).step).toMatchObject({ status: "picked_up", holderMemberId: khalid.id });
    expect((await actionsOf(engineer.id, "reassign_step")).at(-1)).toEqual(
      expect.objectContaining({ reason, before: { holderMemberId: null }, after: { result: "reassigned", toMemberId: khalid.id } }),
    );
    const k1History = (await khalid.caller.get(`/v1/work-items/${mar}/history`)).json() as { events: { type: string; by: unknown; handover: unknown }[] };
    expect(k1History.events.filter((e) => e.type === "admin_reassigned")).toEqual([
      expect.objectContaining({ by: { companyName: null, memberName: null, positions: [] }, handover: { from: null, to: { en: "Khalid Manager", ar: "Khalid Manager" }, because: "reassigned" } }),
    ]);
    expect(await historyTypes(c1Engineer)).not.toContain("admin_reassigned");
    // Positive control: C1 reads the MAR's shared history.
    expect(await historyTypes(c1Engineer)).toContain("transition");
  });

  it("moves it to the other K1 manager, then back to K1's pool; a second return is already_pooled", async () => {
    expect((await reassign(khalid.id)).json()).toEqual({ error: "not_offered" });
    expect((await reassign(sara.id)).json()).toEqual({ result: "reassigned" });
    expect((await reassign(null)).json()).toEqual({ result: "returned_to_pool" });
    const again = await reassign(null);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "already_pooled" });
    expect((await (await find(documentNumber)).json()).step).toMatchObject({ status: "pooled", holderMemberId: null });
    expect((await historyTypes(khalid)).filter((t) => t === "admin_reassigned")).toHaveLength(3);
    expect(await historyTypes(c1Engineer)).not.toContain("admin_reassigned");
  });

  it("is the plain 404 for an item Rabaed does not know", async () => {
    const res = await engineer.browser.post(`/v1/work-items/0198f5c0-0000-7000-8000-000000000000/step/reassign`, { toMemberId: null, reason });
    expect(res.statusCode).toBe(404);
  });
});
