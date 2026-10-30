// Seam 1 for scenario RP-593-3 (ADR 0022, RP-593; workflow-engine.md §5.3a; visibility.md V5, V14).
// On a Workflow ending with the Owner's review, an Electrical item that an Owner Representative covers
// has its Owner's review held by OR, not by the Owner: OR's PM reads the Recommended Code and confirms
// it. The Owner, with oversight, reads no Recommended Code, nor does the Contractor, until the Code is
// issued. RP-593-1 and RP-593-2 are in owner-review.test.ts; seam 2 is packages/db/test/owner-review-rls.test.ts.
import { createDb } from "@rabaed/db";
import { drainOutbox, expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addOwnerReviewType } from "./support/owner-review.ts";
import { all, bilingual, buildTower, detail, ok, only, projectMember, take, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "CNORR";
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

let at: Tower;
let owPm: Caller; // The Owner's PM: oversight only, on an item OR covers.
let orPm: Caller; // OR's PM: OR covers Electrical, so holds the Owner's review of an Electrical item.

const names = new Map<Caller, string>();
const nameOf = (by: Caller) => names.get(by) ?? "a caller";

/** The objects in `json` about item `id` (its row, card, entry or notification), at any depth. */
function about(json: unknown, id: string): unknown[] {
  if (Array.isArray(json)) return json.flatMap((x) => about(x, id));
  if (json === null || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  const own = o.id === id || o.workItemId === id || (o.workItem as { id?: string } | undefined)?.id === id ? [o] : [];
  return [...own, ...Object.values(o).flatMap((v) => about(v, id))];
}

/** Every channel `by` reads the item through: the List, search, the Kanban, the item, its history, the Activity Feed, notifications. */
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

/** The Codes (A to D) `by` reads of the item in any channel, each as a row keyed by the Code. */
const codesRead = async (by: Caller, id: string, title: string) =>
  [...new Set(JSON.stringify(await channels(by, id, title)).match(/"[A-D]"/g) ?? [])].map((code) => ({ id: code.slice(1, -1) }));

const history = async (by: Caller, id: string) =>
  (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events as { type: string; recommendedCode: string | null }[];

beforeAll(async () => {
  await addOwnerReviewType(migrator, TYPE, schema);
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "ORR");
  const ow = await api.authorizedPerson();
  const owParticipant = await api.addParticipant(c1.caller, at.projectId, ow.company, "owner");
  await ok(c1.caller.request("PUT", `/v1/participants/${owParticipant}/visibility`, { trade: all, location: all }));
  owPm = await projectMember(api, ow, owParticipant, ["project_manager"]);
  const or = await api.authorizedPerson();
  const orParticipant = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipant}/visibility`, { trade: only(at.electrical), location: all }));
  orPm = await projectMember(api, or, orParticipant, ["project_manager"]);
  for (const [by, name] of [
    [at.c1Engineer, "the C1 engineer"],
    [at.c1Pm, "the C1 PM"],
    [at.k1Manager, "the K1 manager"],
    [owPm, "the Owner's PM"],
    [orPm, "OR's PM"],
  ] as const)
    names.set(by, name);
});

describe("scenario RP-593-3: on an Electrical item OR covers, OR holds the Owner's review", () => {
  it("OR's PM reads the Recommended Code and confirms it; the Owner and C1 read no Recommended Code until it is issued", async () => {
    const title = "Cable ladders";
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
    await take(at.k1Manager, id, "recommend_a", { internalNote: "A, no comments" });
    await drainOutbox(worker);

    // OR holds the Owner's review, not the Owner: the Owner can't pick it up, nor is it offered a Confirm.
    const refused = await owPm.post(`/v1/work-items/${id}/pick-up`);
    expect({ status: refused.statusCode, body: refused.json() }).toEqual({ status: 403, body: { error: "forbidden" } });
    expect((await detail(owPm, id)).actions.transitions.some((t) => t.key.startsWith("confirm"))).toBe(false);
    await ok(orPm.post(`/v1/work-items/${id}/pick-up`));
    expect((await detail(orPm, id)).actions.transitions.map((t) => t.label.en).sort()).toEqual(["Confirm", "Send Back"]);

    // OR reads the Recommended Code; the Owner and C1 read none, in any channel.
    // Each seenBy reader below reads the Recommendation itself, so their "A" is the Recommended Code, not another string.
    for (const by of [orPm, at.k1Manager]) expect((await history(by, id)).filter((e) => e.type === "recommend_code").map((e) => e.recommendedCode), nameOf(by)).toEqual(["A"]);
    await expectHiddenFrom({
      read: (by: Caller) => codesRead(by, id, title),
      target: "A",
      seenBy: [orPm, at.k1Manager],
      hiddenFrom: [owPm, at.c1Pm, at.c1Engineer],
      name: nameOf,
      label: "the Recommended Code",
    });
    for (const by of [owPm, at.c1Pm]) expect((await detail(by, id)).outcome).toBeNull();

    // OR confirms it: Code A is issued, and now everyone reads it.
    await take(orPm, id, "confirm_a");
    await drainOutbox(worker);
    for (const by of [at.c1Pm, owPm, at.k1Manager, orPm]) {
      const d = await detail(by, id);
      expect([d.outcome, d.stage.category]).toEqual(["A", "closed_positive"]);
    }
    for (const by of [owPm, at.c1Pm]) expect((await codesRead(by, id, title)).map((c) => c.id)).toEqual(["A"]);
  });
});
