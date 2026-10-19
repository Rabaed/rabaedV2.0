// Seam 1 for the Snag item page's read (RP-628, SNAG-9; spec RP-619; glossary Snag, Comment,
// Snag List, Link; visibility.md E1, V5, V14, layer 3 "informed").
//
// The item page lays out a Snag List item from the detail read: its Module, the item it was
// raised from (by Document Number and Subject, its id and Review Code only for a viewer who
// sees it, exactly as the viewer's own Snag List row reads it), and only the actions the
// viewer may take. An informed Consultant and the Contractor holding a self-raised Snag read
// different actions on the same item, and the Consultant reads none.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemDetail, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { bilingual, buildTower, detail, ok, take, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const REVIEWED = "SID";
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
const snags = async (by: Caller): Promise<WorkItemList> => (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items`), 200)).json();
const keys =(read: WorkItemDetail) => read.actions.transitions.map((t) => t.key).sort();

/** `by`'s Snag on Building A, Electrical, raised. */
async function raisedSnag(by: Caller, title: string): Promise<string> {
  const answers = { description: title, trade: at.electrical, location: at.buildingA };
  const id = (await ok(by.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title, answers }), 201)).json().id as string;
  await take(by, id, "raise");
  return id;
}

/** `by` holds item `id` if it waits in a pool. */
async function hold(by: Caller, id: string) {
  if ((await detail(by, id)).actions.pickUp) await ok(by.post(`/v1/work-items/${id}/pick-up`));
}

beforeAll(async () => {
  await addSendBackType(migrator, REVIEWED, { en: "Snag item review", ar: "مراجعة عنصر الملاحظات" }, schema, { withApproveB: true });
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SID");
});

describe("the Snag item page's read (seam 1)", () => {
  it("a Comment names its Module and the Code B review it was raised from, with its Code; the review names neither", async () => {
    const source = (
      await ok(
        at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
          type: REVIEWED,
          title: "Lighting fixtures",
          answers: { model: "LX-2", trade: at.electrical, location: at.buildingA },
        }),
        201,
      )
    ).json().id as string;
    await take(at.c1Engineer, source, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${source}/pick-up`));
    await take(at.c1Pm, source, "submit");
    await ok(at.k1Manager.post(`/v1/work-items/${source}/pick-up`));
    await take(at.k1Manager, source, "send_to_manager");
    await ok(at.k1Manager.post(`/v1/work-items/${source}/pick-up`));
    await take(at.k1Manager, source, "approve_b", { answers: { remarks: "Approved with comments", items_to_create: [{ comment: "Provide the IP65 certificate" }] } });

    const review = await detail(at.c1Pm, source);
    expect(review.module).toBe("submittals");
    expect(review.raisedFrom).toBeNull();
    const [comment] = review.raisedItems;
    expect(comment).toMatchObject({ type: { code: "CMT" }, open: 1, closed: 0 });

    const commentRow = async (by: Caller) => (await snags(by)).items.find((i) => i.type.code === "CMT")!;
    const { id: commentId } = await commentRow(at.c1Pm);
    const read = await detail(at.c1Pm, commentId);
    expect(read.module).toBe("snag_list");
    expect(read.raisedFrom).toEqual({
      documentNumber: review.documentNumber,
      subject: "Lighting fixtures",
      workItemId: source,
      outcome: { code: "B", name: expect.objectContaining({ en: expect.any(String) }), look: "b" },
    });
    // Every viewer reads the card its own Snag List row reads: K1 reads no Link of C1's Comment (Link rules).
    for (const by of [at.c1Pm, at.k1Manager]) {
      expect((await detail(by, commentId)).raisedFrom).toEqual((await commentRow(by)).raisedFrom);
    }
  });

  it("a Snag raised by hand names no source", async () => {
    const id = await raisedSnag(at.k1Manager, "Cable tray not bonded");
    const read = await detail(at.k1Manager, id);
    expect(read.module).toBe("snag_list");
    expect(read.raisedFrom).toBeNull();
  });

  it("C1 reads the moves of its self-raised Snag, the informed Consultant none; at Verify C1 closes or returns it, and K1 still reads none", async () => {
    const id = await raisedSnag(at.c1Pm, "Exposed rebar");
    await hold(at.c1Pm, id);
    expect(keys(await detail(at.c1Pm, id))).toEqual(["put_on_hold", "resolve", "start_work"]);
    expect(keys(await detail(at.k1Manager, id))).toEqual([]);

    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Covered and re-poured" } });
    await hold(at.c1Pm, id);
    expect(keys(await detail(at.c1Pm, id))).toEqual(["close", "return_to_open"]);
    const k1 = await detail(at.k1Manager, id);
    expect(keys(k1)).toEqual([]);
    expect(k1.actions.pickUp).toBeFalsy();
  });

  it("on the Consultant's Snag, C1 reads the moves at Open and none at Verify; K1 reads none at Open and verifies", async () => {
    const id = await raisedSnag(at.k1Manager, "Ceiling plasterboard rework");
    await hold(at.c1Pm, id);
    expect(keys(await detail(at.c1Pm, id))).toEqual(["put_on_hold", "resolve", "start_work"]);
    expect(keys(await detail(at.k1Manager, id))).toEqual([]);

    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Boards replaced" } });
    await hold(at.k1Manager, id);
    expect(keys(await detail(at.k1Manager, id))).toEqual(["close", "return_to_open"]);
    expect(keys(await detail(at.c1Pm, id))).toEqual([]);
  });
});
