// Seam 1 for the Owner's review (ADR 0022, RP-593; workflow-engine.md §5.3a; visibility.md V5,
// V14 and scenarios RP-593-1 and RP-593-2). On a 1→1→1 Workflow the Consultant PM's Code is a
// Recommended Code to the Owner: the Contractor sees the item with the Owner and no Code in any
// channel (the List, the Kanban, search, the item, its history, the Activity Feed, notifications,
// the Dashboard) until the Owner confirms it, which issues it and runs its result. A Code the
// Owner Sends Back never reaches the Contractor.
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addOwnerReviewType } from "./support/owner-review.ts";
import { all, bilingual, buildTower, detail, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "CNOWS";
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
let ow: Company;
let at: Tower;
let owPm: Caller; // Holds the Owner's review.

/** The objects in `json` about item `id` (its row, card, entry or notification), at any depth. */
function about(json: unknown, id: string): unknown[] {
  if (Array.isArray(json)) return json.flatMap((x) => about(x, id));
  if (json === null || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  const own = o.id === id || o.workItemId === id || (o.workItem as { id?: string } | undefined)?.id === id ? [o] : [];
  return [...own, ...Object.values(o).flatMap((v) => about(v, id))];
}

/** Every channel C1's `by` reads the item through, each as it reads it. */
async function channels(by: Caller, id: string, title: string) {
  const get = async (path: string) => (await ok(by.get(path), 200)).json();
  const list = `/v1/projects/${at.projectId}/modules/submittals/work-items`;
  return {
    list: about(await get(list), id),
    search: about(await get(`${list}?q=${encodeURIComponent(title)}`), id),
    kanban: about(await get(`${list}/kanban`), id),
    item: await get(`/v1/work-items/${id}`),
    history: (await get(`/v1/work-items/${id}/history`)).events,
    feed: about(await get(`/v1/projects/${at.projectId}/activity`), id),
    bell: about(await get("/v1/notifications"), id),
  };
}

/** A Code (A to D) as any value the channels give. */
const aCode = /"[A-D]"/;
const dashboard = async (by: Caller) => (await ok(by.get(`/v1/projects/${at.projectId}/dashboard`), 200)).json();
const history = async (by: Caller, id: string) => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events as { type: string; recommendedCode: string | null; outcome: string | null }[];

/** A Submitted item, picked up by K1's manager at the Consultant PM's Step. */
async function atConsultant(title: string): Promise<string> {
  const id = (
    await ok(
      at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: title, trade: at.electrical, location: at.buildingA } }),
      201,
    )
  ).json().id as string;
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit");
  await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

const comments = { items_to_create: [{ comment: "Seal the cable entries" }] };

beforeAll(async () => {
  await addOwnerReviewType(migrator, TYPE, schema);
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  ow = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "OWR");
  const owParticipant = await api.addParticipant(c1.caller, at.projectId, ow.company, "owner");
  await ok(c1.caller.request("PUT", `/v1/participants/${owParticipant}/visibility`, { trade: all, location: all }));
  owPm = await projectMember(api, ow, owParticipant, ["project_manager"]);
});

describe("scenario RP-593-1: K1 recommends Code B to the Owner, who confirms it", () => {
  it("C1 sees the item with the Owner and no Code anywhere; the Owner sees B; confirming closes it at B for everyone, with its Comments", async () => {
    const title = "Busbar trunking";
    const id = await atConsultant(title);
    await ok(at.c1Pm.request("PUT", `/v1/work-items/${id}/watch`));
    await drainOutbox(worker);
    const before = { history: await history(at.c1Pm, id), dashboard: await dashboard(at.c1Pm) };

    await take(at.k1Manager, id, "recommend_b", { answers: comments, internalNote: "B, with one comment" });
    await drainOutbox(worker);

    const withOwner = { companyName: (await detail(owPm, id)).heldBy!.companyName, memberName: null, pool: null };
    for (const by of [at.c1Pm, at.c1Engineer]) {
      const read = await channels(by, id, title);
      expect(JSON.stringify(read)).not.toMatch(aCode);
      // It is there, with the Owner: in the List, the search and the Kanban.
      for (const rows of [read.list, read.search, read.kanban]) expect(rows.length).toBeGreaterThan(0);
      expect(read.item.outcome).toBeNull();
      expect(read.item.heldBy).toEqual(withOwner);
    }
    expect(await history(at.c1Pm, id)).toEqual(before.history);
    expect(await dashboard(at.c1Pm)).toEqual(before.dashboard);

    // The Owner reads the Recommended Code and is offered one Confirm, and its Send Back.
    expect((await history(owPm, id)).filter((e) => e.type === "recommend_code").map((e) => e.recommendedCode)).toEqual(["B"]);
    await ok(owPm.post(`/v1/work-items/${id}/pick-up`));
    expect((await detail(owPm, id)).actions.transitions.map((t) => t.label.en).sort()).toEqual(["Confirm", "Send Back"]);

    await take(owPm, id, "confirm_b");
    await drainOutbox(worker);
    for (const by of [at.c1Pm, at.k1Manager, owPm]) {
      const d = await detail(by, id);
      expect([d.outcome, d.stage.category]).toEqual(["B", "closed_positive"]);
    }
    expect((await history(at.c1Pm, id)).at(-1)).toMatchObject({ type: "issue_code", outcome: "B" });
    expect((await detail(at.c1Pm, id)).comments).toEqual({ open: 1, closed: 0 });
  });
});

describe("scenario RP-593-2: the Owner Sends B Back, K1 recommends C, the Owner confirms it", () => {
  it("issues Code C with a Revision offered, and C1 never saw B", async () => {
    const title = "Distribution boards";
    const id = await atConsultant(title);
    await take(at.k1Manager, id, "recommend_b", { answers: comments });
    await ok(owPm.post(`/v1/work-items/${id}/pick-up`));
    await take(owPm, id, "owner_send_back");
    await drainOutbox(worker);
    // Back with K1's manager, who may recommend again; C1 still reads no Code.
    expect((await detail(at.k1Manager, id)).actions.transitions.map((t) => t.key).sort()).toEqual(["recommend_a", "recommend_b", "recommend_c", "recommend_d"]);
    expect(JSON.stringify(await channels(at.c1Pm, id, title))).not.toMatch(aCode);

    await take(at.k1Manager, id, "recommend_c");
    await ok(owPm.post(`/v1/work-items/${id}/pick-up`));
    await take(owPm, id, "confirm_c");
    await drainOutbox(worker);

    const read = await channels(at.c1Pm, id, title);
    expect(read.item.outcome).toBe("C");
    expect(JSON.stringify(read).match(/"[A-D]"/g)?.every((c) => c === '"C"')).toBe(true);
    expect((await detail(at.c1Engineer, id)).actions.createRevision).toBe(true);
    expect((await history(owPm, id)).filter((e) => e.type === "recommend_code").map((e) => e.recommendedCode)).toEqual(["B", "C"]);
  });
});
