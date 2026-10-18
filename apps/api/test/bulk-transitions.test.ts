// Seam 1: Bulk Transitions (spec RP-616 stories 39–45; RP-646; visibility.md
// scenario RP-588-4). A Member takes one Transition on several items at once, with
// one set of Action Form answers (and one "Assign to" pick): accepted only when every
// item is one they see, waits on them, and offers that Transition with the same
// Action Form. All or nothing, in one transaction; each item goes through the
// single Transition's path, so each gets its own events and Issued Code, read by the
// other side exactly as for a single Code. The command isn't tied to Packages; the
// Package's answer says which Transitions each of its items offers in bulk.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { PackageDetail, WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addActionsType, addRulesType } from "./support/rules.ts";
import { all, bilingual, buildTower, detail, inInternalReview, memberOnProject, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let at: Tower;
let c1: Company;
let k1: Company;
let c2Engineer: Caller;
let k1ParticipantId = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "TWB");
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  k1ParticipantId = (await k1.caller.get(`/v1/projects/${at.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
});

type BulkBody = { transition: string; answers?: Record<string, unknown>; internalNote?: string; assignTo?: string | null; confirmed?: boolean };

/** `by` takes `body.transition` on `ids` in bulk, confirmed in its pop-up (ADR 0017) unless said otherwise. */
const bulk = (by: Caller, ids: string[], body: BulkBody, key: string = randomUUID()) =>
  by.post(`/v1/work-items/bulk-transitions`, { workItemIds: ids, confirmed: true, idempotencyKey: key, ...body });

/** A refused command's status and body. */
const refusal = async (res: ReturnType<Caller["post"]>) => {
  const r = await res;
  return { status: r.statusCode, body: r.json() };
};

/** Item `id`'s history as `by` reads it. */
const history = async (by: Caller, id: string) => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json() as WorkItemHistory;

/** A MAR Submitted by C1 and picked up by K1's manager: waiting on them to Code it. */
async function atK1(title: string): Promise<string> {
  const id = await submitted(at, at.c1Engineer, at.c1Pm, title);
  await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

/** What C1 reads of item `id`'s history, every event but its own time, number and Document Number. */
const asC1Reads = async (id: string) =>
  (await history(at.c1Pm, id)).events.map(({ seq: _seq, at: _at, documentNumber, ...e }) => ({ ...e, numbered: documentNumber !== null }));

describe("scenario RP-588-4: K1's manager codes three items in bulk", () => {
  it("each gets its own Code event and Issued Code, which C1 reads exactly as a single Code: K1's Company and the signer, never K1's internal events", async () => {
    const items = [await atK1("Bulk one"), await atK1("Bulk two"), await atK1("Bulk three")];
    const single = await atK1("Coded alone");
    const code = { transition: "approve_a", answers: { remarks: "Approved as submitted" }, internalNote: "K1 only: checked the datasheets" };
    await take(at.k1Manager, single, code.transition, { remarks: code.answers.remarks, internalNote: code.internalNote });

    const res = await ok(bulk(at.k1Manager, items, code), 200);
    expect((res.json() as { taken: { id: string }[] }).taken.map((i) => i.id).sort()).toEqual([...items].sort());

    const control = await asC1Reads(single);
    const issued = control.filter((e) => e.type === "issue_code" || e.outcome === "A");
    expect(issued).toHaveLength(1);
    expect(issued[0]!.by.companyName).not.toBeNull();
    expect(issued[0]!.by.memberName).not.toBeNull();
    for (const id of items) {
      expect(await asC1Reads(id)).toEqual(control);
      expect(await detail(at.c1Pm, id)).toMatchObject({ outcome: "A" });
      const body = (await at.c1Pm.get(`/v1/work-items/${id}/history`)).body;
      expect(body).not.toContain("K1 only");
      expect((await history(at.c1Pm, id)).events.every((e) => e.audience === "shared" || e.type !== "internal_note")).toBe(true);
    }
    // K1 reads its own Internal Note on each, written with each item's own Code.
    for (const id of items) expect((await history(at.k1Manager, id)).events.filter((e) => e.type === "internal_note")).toHaveLength(1);
  });
});

/** Where item `id` is for K1's manager: its Step and the Transitions offered them. */
const whereFor = async (by: Caller, id: string) => {
  const d = await detail(by, id);
  return { step: d.step.key, offered: d.actions.transitions.map((t) => t.key) };
};

describe("what a bulk Transition refuses: nothing moves, and the answer names the item that stopped it", () => {
  it("an item not picked up yet doesn't offer it; one already coded doesn't wait on them", async () => {
    const ready = [await atK1("Ready A"), await atK1("Ready B")];
    // A second manager: K1's review is a Step Pool of two, picked up rather than held by its only Member.
    await projectMember(api, k1, k1ParticipantId, ["manager"]);
    const pooled = await submitted(at, at.c1Engineer, at.c1Pm, "Still in the pool");
    const coded = await atK1("Coded already");
    await take(at.k1Manager, coded, "approve_a");

    for (const [stopper, reason, title] of [
      [pooled, "transition_not_offered", "Still in the pool"],
      [coded, "not_waiting", "Coded already"],
    ] as const) {
      const refused = await refusal(bulk(at.k1Manager, [...ready, stopper], { transition: "approve_a" }));
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body).toEqual({
        error: "bulk_refused",
        stoppedBy: { id: stopper, documentNumber: (await detail(at.k1Manager, stopper)).documentNumber, title, reason },
      });
    }
    for (const id of ready) expect(await whereFor(at.k1Manager, id)).toMatchObject({ offered: expect.arrayContaining(["approve_a"]) });
  });

  it("an item the Member doesn't see is the plain 404, the same as a made-up id, and names nothing", async () => {
    const ready = await atK1("Ready C");
    const c1Only = await inInternalReview(at, at.c1Engineer, "C1's own review");
    await expectHidden(bulk(at.k1Manager, [ready, c1Only], { transition: "approve_a" }));
    await expectHidden(bulk(at.k1Manager, [ready, randomUUID()], { transition: "approve_a" }));
    await expectHidden(bulk(c2Engineer, [ready], { transition: "approve_a" }));
    expect(await whereFor(at.k1Manager, ready)).toMatchObject({ offered: expect.arrayContaining(["approve_a"]) });
  });

  it("unconfirmed, nothing moves", async () => {
    const ready = await atK1("Ready D");
    const res = await refusal(bulk(at.k1Manager, [ready], { transition: "approve_a", confirmed: false }));
    expect(res).toEqual({ status: 422, body: { error: "not_confirmed" } });
    expect(await whereFor(at.k1Manager, ready)).toMatchObject({ offered: expect.arrayContaining(["approve_a"]) });
  });
});

// A submittal Type on the test Workflow with rules (RP-430), whose "Submit with cost"
// Validates that the Form gives the cost impact: an item's own Transition refuses it.
const RULED = "BULKR";

/** A Draft of the ruled Type at C1's PM's review, picked up by them. */
async function ruledAtPm(model: string, answers: Record<string, unknown> = {}): Promise<string> {
  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: RULED,
      title: model,
      answers: { model, trade: at.electrical, location: at.buildingA, ...answers },
    }),
    201,
  );
  const id = res.json().id as string;
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

describe("a bulk Transition is all or nothing", () => {
  beforeAll(() => addRulesType(migrator, RULED));

  it("an item its own Transition refuses undoes the ones taken before it: nothing is Submitted", async () => {
    const costed = await ruledAtPm("Costed", { cost: 12_000 });
    const uncosted = await ruledAtPm("No cost");
    const refused = await refusal(bulk(at.c1Pm, [costed, uncosted], { transition: "submit_costed" }));
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body).toEqual({
      error: "bulk_refused",
      stoppedBy: {
        id: uncosted,
        documentNumber: null,
        title: "No cost",
        reason: "validation_failed",
        message: { en: "Enter the cost impact before you submit.", ar: "أدخل الأثر المالي قبل التقديم." },
      },
    });
    // The first was taken, then undone with the rest: still at C1's review, unnumbered, K1 reads nothing.
    expect(await detail(at.c1Pm, costed)).toMatchObject({ step: { key: "internal_review" }, documentNumber: null });
    await expectHidden(at.k1Manager.get(`/v1/work-items/${costed}`));
    expect((await history(at.c1Pm, costed)).events.filter((e) => e.type === "transition")).toHaveLength(1);
  });
});
