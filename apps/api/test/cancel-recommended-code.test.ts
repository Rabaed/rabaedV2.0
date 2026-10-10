// Seam 1 for Cancel and the Recommended Code (RP-433, WF-10; spec RP-423;
// workflow-engine.md §5.1, §5.3, §6; visibility.md V5 and scenario RP-433-1).
//
// Cancel (`kind = cancel`) is offered from the raiser's own Steps until the item is
// first Submitted, and closes it in a Cancelled Stage with outcome `cancelled`. A
// Step that Recommends a Code lets its holder propose one of the Type's closing
// outcomes to the next reviewer of the same Participant, with an Internal Note;
// it is Internal Communication: only that Participant ever reads it.
//
// The Type is test-only, on the test Workflow with a Send Back (addSendBackType),
// with a Cancel from Draft and from Contractor review, and Consultant review
// Recommending a Code.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { ActivityFeed, NotificationList, WorkItemDetail, WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { bilingual, buildTower, detail, ok, projectMember, take, tryTake, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "CNREC";
const schema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

let c1: Company;
let k1: Company;
let at: Tower;
let k1Engineer: Caller; // Holds Consultant review, which Recommends a Code.

const actionsOf = async (by: Caller, id: string) => (await detail(by, id)).actions.transitions;
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> =>
  (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
const feed = async (by: Caller): Promise<ActivityFeed["entries"]> =>
  (await ok(by.get(`/v1/projects/${at.projectId}/activity`), 200)).json().entries;
const bell = async (by: Caller, id: string) =>
  ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications.filter((n) => n.workItemId === id);

async function newDraft(title: string): Promise<string> {
  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: TYPE,
      title,
      answers: { model: title, trade: at.electrical, location: at.buildingA },
    }),
    201,
  );
  return res.json().id as string;
}

async function inReview(title: string): Promise<string> {
  const id = await newDraft(title);
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

/** Submitted to K1 and picked up by K1's engineer, at the Step that Recommends a Code. */
async function atConsultantReview(title: string): Promise<string> {
  const id = await inReview(title);
  await take(at.c1Pm, id, "submit");
  await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

const closed = (d: WorkItemDetail) => ({ outcome: d.outcome, stage: d.stage.category, open: d.closedAt === null });

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Cancel and Recommended Code", ar: "الإلغاء والرمز الموصى به" }, schema, {
    withCancel: true,
    recommendCode: true,
  });
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "CNR");
  const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  k1Engineer = await projectMember(api, k1, participants.find((p) => !p.isOwnCompany)!.id, ["engineer"]);
});

describe("Cancel is discard for a Revision (decided 2026-10-09)", () => {
  /** The original, closed at Code C by K1's manager. */
  async function revisedAtC(title: string): Promise<string> {
    const id = await atConsultantReview(title);
    await take(k1Engineer, id, "send_to_manager");
    await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(at.k1Manager, id, "revise_c");
    return id;
  }
  const createRevision = async (id: string): Promise<string> =>
    (await ok(at.c1Engineer.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;

  it("offers a Draft Revision no Cancel; the raiser discards it, and the next Revision reuses its number", async () => {
    const original = await revisedAtC("Valves");
    const rev = await createRevision(original);
    const draft = await detail(at.c1Engineer, rev);
    expect(draft.revisionNo).toBe(1);
    expect(draft.actions.transitions.map((t) => t.kind)).not.toContain("cancel");
    expect(draft.actions.discardRevision).toBe(true);
    const refused = await tryTake(at.c1Engineer, rev, "cancel");
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toEqual({ error: "transition_not_available" });

    await ok(at.c1Engineer.post(`/v1/work-items/${rev}/discard`));
    const again = await createRevision(original);
    expect((await detail(at.c1Engineer, again)).revisionNo).toBe(1);
  });

  it("offers no Cancel at the raiser's own review either, so a chain never ends by Cancel", async () => {
    const rev = await createRevision(await revisedAtC("Gaskets"));
    await take(at.c1Engineer, rev, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${rev}/pick-up`));
    expect((await actionsOf(at.c1Pm, rev)).map((t) => t.kind)).not.toContain("cancel");
    expect((await tryTake(at.c1Pm, rev, "cancel_review")).statusCode).toBe(409);
  });
});

describe("Cancel", () => {
  it("from Draft closes the item in the Cancelled Stage with outcome cancelled, and issues no Document Number", async () => {
    const id = await newDraft("Cables");
    expect((await actionsOf(at.c1Engineer, id)).map((t) => [t.key, t.kind])).toContainEqual(["cancel", "cancel"]);

    await take(at.c1Engineer, id, "cancel");

    const d = await detail(at.c1Engineer, id);
    expect(closed(d)).toEqual({ outcome: "cancelled", stage: "cancelled", open: false });
    expect(d.documentNumber).toBeNull();
    expect(d.actions.transitions).toEqual([]);
    expect((await history(at.c1Engineer, id)).map((e) => [e.type, e.outcome])).toEqual([["transition", "cancelled"]]);
  });

  it("from Internal Review closes it the same way, keeping the number it got leaving Draft", async () => {
    const id = await inReview("Pumps");
    const number = (await detail(at.c1Pm, id)).documentNumber;
    expect(number).not.toBeNull();
    expect((await actionsOf(at.c1Pm, id)).map((t) => t.key)).toContain("cancel_review");

    await take(at.c1Pm, id, "cancel_review");

    const d = await detail(at.c1Pm, id);
    expect(closed(d)).toEqual({ outcome: "cancelled", stage: "cancelled", open: false });
    expect(d.documentNumber).toBe(number);
  });

  it("is not offered after Submit, even back at the raiser's Steps after a Send Back, and taking it is refused like a Transition that isn't there", async () => {
    const id = await inReview("Valves");
    await take(at.c1Pm, id, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    // K1's Steps never offer a Cancel.
    expect((await actionsOf(k1Engineer, id)).map((t) => t.kind)).not.toContain("cancel");
    await take(k1Engineer, id, "send_back");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));

    expect((await actionsOf(at.c1Pm, id)).map((t) => t.kind)).not.toContain("cancel");
    const refused = await tryTake(at.c1Pm, id, "cancel_review");
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "transition_not_available" });
    expect(closed(await detail(at.c1Pm, id)).open).toBe(true);
  });
});

describe("the Recommended Code", () => {
  it("is offered on the forward move of a Step that Recommends a Code: the Type's closing outcomes", async () => {
    const id = await atConsultantReview("Lights");
    const transitions = await actionsOf(k1Engineer, id);
    const toManager = transitions.find((t) => t.key === "send_to_manager")!;
    expect(toManager.recommendCode?.map((o) => o.code)).toEqual(["A", "B", "C", "D"]);
    expect(toManager.recommendCode?.[0]).toMatchObject({ code: "A", name: { en: expect.any(String), ar: expect.any(String) } });
    // A Send Back crosses to C1: nothing to recommend there.
    expect(transitions.find((t) => t.key === "send_back")!.recommendCode).toBeUndefined();
  });

  it("reaches the K1 manager in the history, with the Internal Note written with it", async () => {
    const id = await atConsultantReview("Switches");
    await take(k1Engineer, id, "send_to_manager", { recommendedCode: "A", internalNote: "Matches the specification" });

    const events = await history(at.k1Manager, id);
    const recommended = events.filter((e) => e.type === "recommend_code");
    expect(recommended).toEqual([expect.objectContaining({ audience: "internal", recommendedCode: "A", outcome: null })]);
    expect(events.find((e) => e.type === "internal_note")?.internalNote).toBe("Matches the specification");
  });

  it("is refused where it isn't offered, or isn't one of the Type's closing outcomes, with nothing moved", async () => {
    const id = await atConsultantReview("Sockets");
    for (const code of ["Z", "cancelled"]) {
      const res = await tryTake(k1Engineer, id, "send_to_manager", { recommendedCode: code });
      expect(res.json()).toEqual({ error: "recommended_code_not_offered" });
      expect(res.statusCode).toBe(422);
    }
    // From a Step that doesn't Recommend a Code.
    const other = await inReview("Breakers");
    const res = await tryTake(at.c1Pm, other, "submit", { recommendedCode: "A" });
    expect(res.json()).toEqual({ error: "recommended_code_not_offered" });
    // Nor on a move that leaves K1.
    expect((await tryTake(k1Engineer, id, "send_back", { recommendedCode: "A" })).json()).toEqual({ error: "recommended_code_not_offered" });
    expect((await detail(k1Engineer, id)).heldBy).not.toBeNull();
    expect((await history(k1Engineer, id)).filter((e) => e.type === "recommend_code")).toEqual([]);
  });
});

describe("scenario RP-433-1: K1's engineer recommends Code A to their manager", () => {
  it("C1 never reads the Recommended Code: not in the history, notifications, Activity Feed or any count", async () => {
    const id = await atConsultantReview("Panels");
    // The C1 PM watches it from their Submit; the C1 engineer watches it too.
    await ok(at.c1Engineer.request("PUT", `/v1/work-items/${id}/watch`));
    await drainOutbox(worker);
    const c1Before = {
      pm: { history: await history(at.c1Pm, id), feed: await feed(at.c1Pm), bell: await bell(at.c1Pm, id) },
      engineer: { history: await history(at.c1Engineer, id), feed: await feed(at.c1Engineer), bell: await bell(at.c1Engineer, id) },
    };

    await take(k1Engineer, id, "send_to_manager", { recommendedCode: "A", internalNote: "Recommend A" });
    await drainOutbox(worker);

    // C1 reads exactly what it read before: no event, no entry, no notification, no number moved on.
    for (const [who, by] of [["pm", at.c1Pm], ["engineer", at.c1Engineer]] as const) {
      expect(await history(by, id)).toEqual(c1Before[who].history);
      expect(await feed(by)).toEqual(c1Before[who].feed);
      expect(await bell(by, id)).toEqual(c1Before[who].bell);
    }
    // K1 reads it, in its history and its Activity Feed.
    expect((await history(k1Engineer, id)).some((e) => e.type === "recommend_code" && e.recommendedCode === "A")).toBe(true);
    expect((await feed(at.k1Manager)).some((e) => e.type === "recommend_code" && e.workItem.id === id)).toBe(true);

    // The manager issues Code A: C1 sees the Code, never the Recommended Code, and its history counts on from what it saw.
    await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(at.k1Manager, id, "approve_a");
    await drainOutbox(worker);
    const after = await history(at.c1Pm, id);
    expect(after.map((e) => e.type)).not.toContain("recommend_code");
    expect(after.map((e) => e.seq)).toEqual(after.map((_, i) => i + 1));
    expect(after.at(-1)).toMatchObject({ type: "issue_code", outcome: "A", recommendedCode: null });
    for (const by of [at.c1Pm, at.c1Engineer]) {
      expect((await feed(by)).filter((e) => e.workItem.id === id).map((e) => e.type)).not.toContain("recommend_code");
      expect((await bell(by, id)).map((n) => n.event?.type)).not.toContain("recommend_code");
    }
  });
});
