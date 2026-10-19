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
import { sql } from "kysely";
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
  k1ParticipantId = (await at.k1Manager.get(`/v1/projects/${at.projectId}/participants`))
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
    const before = await detail(at.c1Pm, costed);
    const refused = await refusal(bulk(at.c1Pm, [costed, uncosted], { transition: "submit_costed" }));
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body).toEqual({
      error: "bulk_refused",
      stoppedBy: {
        id: uncosted,
        documentNumber: (await detail(at.c1Pm, uncosted)).documentNumber,
        title: "No cost",
        reason: "validation_failed",
        message: { en: "Enter the cost impact before you submit.", ar: "أدخل الأثر المالي قبل التقديم." },
      },
    });
    // The first was taken, then undone with the rest: still at C1's review, as it was, and K1 reads nothing.
    expect(await detail(at.c1Pm, costed)).toMatchObject({ step: { key: "internal_review" }, documentNumber: before.documentNumber });
    await expectHidden(at.k1Manager.get(`/v1/work-items/${costed}`));
    expect((await history(at.c1Pm, costed)).events.filter((e) => e.type === "transition")).toHaveLength(1);
  });

  it("the same request again applies nothing and answers the same items", async () => {
    const items = [await atK1("Twice A"), await atK1("Twice B")];
    const key = randomUUID();
    const first = (await ok(bulk(at.k1Manager, items, { transition: "approve_a" }, key), 200)).json();
    expect((await ok(bulk(at.k1Manager, items, { transition: "approve_a" }, key), 200)).json()).toEqual(first);
    for (const id of items) expect((await history(at.c1Pm, id)).events.filter((e) => e.outcome === "A")).toHaveLength(1);
    // The key used for other items is refused, and moves nothing.
    const other = await atK1("Twice C");
    const reused = await refusal(bulk(at.k1Manager, [items[0]!, other], { transition: "approve_a" }, key));
    expect(reused).toEqual({ status: 422, body: { error: "idempotency_key_reused" } });
    expect(await whereFor(at.k1Manager, other)).toMatchObject({ offered: expect.arrayContaining(["approve_a"]) });
  });
});

// A submittal Type on the test Workflow with actions (RP-431): K1's engineer sends it
// to K1's manager with "Assign to", and its Code A asks for Remarks in an Action Form
// of its own, unlike the ruled Type's Code A.
const ACTED = "BULKA";

/** A Draft of `type` raised by C1's engineer, Submitted by C1's PM and picked up by K1's engineer. */
async function atK1Engineer(type: string, model: string): Promise<string> {
  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type, title: model, answers: { model, trade: at.electrical, location: at.buildingA } }),
    201,
  );
  const id = res.json().id as string;
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit");
  await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

let k1Engineer: Caller;
let k1EngineerId = "";
let k1Approver: Caller; // A K1 manager "Assign to" picks.
let k1ApproverId = "";

describe('one Action Form and one "Assign to" for all', () => {
  beforeAll(async () => {
    await addActionsType(migrator, ACTED);
    const engineer = await memberOnProject(api, k1, k1ParticipantId, ["engineer"]);
    k1Engineer = engineer.caller;
    k1EngineerId = engineer.id;
    const approver = await memberOnProject(api, k1, k1ParticipantId, ["manager"]);
    k1Approver = approver.caller;
    k1ApproverId = approver.id;
  });

  it('"Assign to" picks one Member for all: each lands with them, waiting on them', async () => {
    const items = [await atK1Engineer(ACTED, "Assigned A"), await atK1Engineer(ACTED, "Assigned B")];
    await ok(bulk(k1Engineer, items, { transition: "send_to_manager", assignTo: k1ApproverId }), 200);
    for (const id of items) expect(await whereFor(k1Approver, id)).toMatchObject({ step: "consultant_approval", offered: expect.arrayContaining(["approve_a"]) });
    // A pick its Transition doesn't offer stops it at the first item, and nothing moves.
    const more = [await atK1Engineer(ACTED, "Assigned C"), await atK1Engineer(ACTED, "Assigned D")];
    const refused = await refusal(bulk(k1Engineer, more, { transition: "send_to_manager", assignTo: k1EngineerId }));
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.stoppedBy).toMatchObject({ id: more[0], reason: "assignee_not_offered" });
    for (const id of more) expect((await detail(k1Engineer, id)).step.key).toBe("consultant_review");
  });

  it("is refused when an item offers the Transition with another Action Form (Screen Version)", async () => {
    const acted = await atK1Engineer(ACTED, "Own Code form");
    await take(k1Engineer, acted, "send_to_manager", { assignTo: k1ApproverId });
    const ruled = await atK1Engineer(RULED, "Ruled Code form");
    await take(k1Engineer, ruled, "send_to_manager");
    await ok(k1Approver.post(`/v1/work-items/${ruled}/pick-up`));
    for (const id of [acted, ruled]) expect((await whereFor(k1Approver, id)).offered).toContain("approve_a");

    const refused = await refusal(bulk(k1Approver, [acted, ruled], { transition: "approve_a", answers: { remarks: "Fine" } }));
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.stoppedBy).toMatchObject({ id: ruled, title: "Ruled Code form", reason: "different_action_form" });
    expect((await detail(k1Approver, acted)).step.key).toBe("consultant_approval");
  });
});

describe("the Package's answer says which Transitions each item offers in bulk", () => {
  it("K1's manager reads Code A on the items waiting on them, with one Action Form; nothing on one still in the pool; C1 nothing on any", async () => {
    const pkg = (await ok(at.c1Pm.post(`/v1/projects/${at.projectId}/packages`, { name: bilingual("Bulk set") }), 201)).json() as { id: string };
    const items: string[] = [];
    for (const title of ["Set A", "Set B", "Set C"]) {
      const id = await inInternalReview(at, at.c1Engineer, title);
      await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
      await ok(at.c1Pm.post(`/v1/packages/${pkg.id}/items`, { workItemId: id }));
      items.push(id);
    }
    await ok(at.c1Pm.post(`/v1/packages/${pkg.id}/submit`, { confirmed: true, idempotencyKey: randomUUID() }), 200);
    const [a, b, pooled] = items as [string, string, string];
    for (const id of [a, b]) await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));

    const read = async (by: Caller) => {
      const p = (await ok(by.get(`/v1/packages/${pkg.id}`), 200)).json() as PackageDetail;
      return new Map(p.items.map((i) => [i.id, i.bulkTransitions]));
    };
    const k1Reads = await read(at.k1Manager);
    const codeA = k1Reads.get(a)!.find((t) => t.key === "approve_a");
    expect(codeA).toMatchObject({ key: "approve_a", label: { en: expect.any(String) } });
    expect(k1Reads.get(b)).toContainEqual(codeA);
    expect(k1Reads.get(pooled)).toEqual([]);
    for (const id of items) expect((await read(at.c1Pm)).get(id)).toEqual([]);

    await ok(bulk(at.k1Manager, [a, b], { transition: "approve_a" }), 200);
    expect((await read(at.k1Manager)).get(a)).toEqual([]);
  });
});

/**
 * Item `id`'s Code A event as the migrator reads the append-only trail: who took it,
 * from which Participant, the hash of the item's content it recorded (ADR 0003,
 * ADR 0017), and that hash worked out again from the item as it is now
 * (app.work_item_content_sha256, the function app.transition_effects records it with).
 */
async function codeSignature(id: string) {
  const { rows } = await sql<{ actor_member_id: string; actor_participant_id: string; content_sha256: string | null; content_now: string }>`
    select e.actor_member_id, e.actor_participant_id, encode(e.content_sha256, 'hex') as content_sha256,
      encode(app.work_item_content_sha256(w.id, w.title, w.data, w.outcome), 'hex') as content_now
    from work_item_event e
    join workflow_transition tr on tr.id = e.transition_id
    join work_item w on w.id = e.work_item_id
    where e.work_item_id = ${id}::uuid and e.type in ('transition', 'issue_code') and tr.key = 'approve_a'
  `.execute(migrator);
  expect(rows, id).toHaveLength(1);
  return rows[0]!;
}

// Spec story 44, as the product owner settled it on 2026-10-19: each submittal in a
// bulk Transition is signed exactly as in a single Transition, so a bulk action never
// bypasses a signature. There is no signing check of the bulk command's own: each
// item goes through takeTransitionIn and app.take_transition.
describe("story 44: each item is signed as a single Transition", () => {
  it("each item's own Code event records its own content hash and signer, as a single Code does: one signature per item, never a shared one", async () => {
    const single = await atK1("Signed alone");
    await take(at.k1Manager, single, "approve_a");
    const control = await codeSignature(single);
    // A single Code records the hash of the item's content as the Code leaves it.
    expect(control.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(control.content_sha256).toBe(control.content_now);
    expect(control.actor_participant_id).toBe(k1ParticipantId);

    // Three items whose content differs (each its own Subject).
    const items = [await atK1("Signed one"), await atK1("Signed two"), await atK1("Signed three")];
    await ok(bulk(at.k1Manager, items, { transition: "approve_a" }), 200);
    const signed = await Promise.all(items.map(codeSignature));
    for (const s of signed) {
      expect(s.content_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.content_sha256).toBe(s.content_now);
      expect(s).toMatchObject({ actor_member_id: control.actor_member_id, actor_participant_id: k1ParticipantId });
    }
    expect(new Set([control.content_sha256, ...signed.map((s) => s.content_sha256)]).size).toBe(4);
  });

  // RP-85 (Main 2, branch RP-632-signature-stamp, not on main yet): app.take_transition
  // refuses a Member without a saved Signature (`no_signature`, ADR 0017: "A Member
  // needs a saved Signature before taking any Transition"). Un-skip once RP-85 lands
  // and fill in the Signature setup below. It checks that a K1 manager without a
  // Signature taking a bulk Code over three items is refused all or nothing: 409
  // `bulk_refused`, `stoppedBy` naming the first item and the Signature refusal, and
  // none of the three moves. Today stopFrom (bulk-transitions.ts) answers any engine
  // refusal it doesn't pass through as `refused`, and commandResult only knows the
  // refusals in transitionRefusals: RP-85 must add `no_signature` to both (and to
  // bulkStopReasons) for `stoppedBy.reason` to name it.
  it.skip("RP-85: a K1 manager without a Signature is refused a bulk Code over three items, and none of them moves", async () => {
    const unsigned = await memberOnProject(api, k1, k1ParticipantId, ["manager"]);
    // RP-85: make sure `unsigned` has no saved Signature here (remove it, or create the Member without one).
    const items: string[] = [];
    for (const title of ["Unsigned one", "Unsigned two", "Unsigned three"]) {
      const id = await submitted(at, at.c1Engineer, at.c1Pm, title);
      await ok(unsigned.caller.post(`/v1/work-items/${id}/pick-up`));
      items.push(id);
    }
    const refused = await refusal(bulk(unsigned.caller, items, { transition: "approve_a" }));
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body).toEqual({
      error: "bulk_refused",
      stoppedBy: { id: items[0], documentNumber: (await detail(unsigned.caller, items[0]!)).documentNumber, title: "Unsigned one", reason: "no_signature" },
    });
    for (const id of items) {
      expect(await whereFor(unsigned.caller, id)).toMatchObject({ offered: expect.arrayContaining(["approve_a"]) });
      expect((await history(at.c1Pm, id)).events.filter((e) => e.outcome === "A")).toEqual([]);
    }
  });
});
