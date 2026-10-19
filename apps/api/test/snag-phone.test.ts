// Seam 1 for the Snag List on a phone (RP-630, SNAG-10; spec RP-619; glossary Snag, Draft,
// Transition; visibility.md V3, V5 and scenario RP-630-1).
//
// The camera-first New Snag: the Consultant takes the photos, writes the Subject and picks the
// Trade, and the Draft is created then, its photos uploaded to it; the Location is saved to the
// Draft when it is picked. Read again (the page reloaded mid-flow), the Draft has kept all of it.
// The cards' swipe actions are the item's own `actions`: every Transition they list is taken
// without a refusal, and nobody is offered one the API would refuse.
import type { DocumentList, WorkItemDetail } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, only, projectMember, take, tryTake, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let buildingB = "";

const photos = async (by: Caller, id: string) =>
  ((await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json() as DocumentList).documents.filter((d) => d.fieldKey === "photos");

/** The phone flow's Subject step: the Draft, with the Description and Trade, then the photos taken before it. */
async function phoneDraft(title: string, photoCount: number): Promise<string> {
  const id = (
    await ok(at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title, answers: { description: `${title}: see the photos`, trade: at.electrical } }), 201)
  ).json().id as string;
  for (let i = 0; i < photoCount; i++) {
    await uploadDocument(at.k1Manager, id, { fieldKey: "photos", fileName: `camera-${i}.jpg`, contentType: "image/jpeg", body: jpegWithExif() });
  }
  return id;
}

/** The phone flow's Location step: the Draft's answers as read, with the Location picked. */
async function pickLocation(id: string, location: string) {
  const read: WorkItemDetail = await detail(at.k1Manager, id);
  await ok(at.k1Manager.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...read.answers, location } }));
}

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SNP");
  buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  // A second Contractor covering Building B: there, two Contractors cover a Snag (a Visibility Overlap).
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  await projectMember(api, c2, c2Participant, ["engineer"]);
});

describe("the phone's New Snag (seam 1)", () => {
  it("keeps its photos and answers when it is read again mid-flow, after the Subject step and after the Location step", async () => {
    const id = await phoneDraft("Cable tray not bonded", 2);

    // Reloaded at the Location step: the Draft, its photos, its Subject, Description and Trade.
    const atLocation = await detail(at.k1Manager, id);
    expect(atLocation.stage.category).toBe("draft");
    expect(atLocation.title).toBe("Cable tray not bonded");
    expect(atLocation.answers).toMatchObject({ description: "Cable tray not bonded: see the photos", trade: at.electrical });
    expect(atLocation.answers.location).toBeUndefined();
    expect(atLocation.actions.saveAnswers).toBe(true);
    expect(await photos(at.k1Manager, id)).toHaveLength(2);

    await pickLocation(id, at.buildingA);

    // Reloaded at the Raise step: all of it still there, and Raise offered (one Contractor covers it).
    const atRaise = await detail(at.k1Manager, id);
    expect(atRaise.answers).toMatchObject({ description: "Cable tray not bonded: see the photos", trade: at.electrical, location: at.buildingA });
    expect(await photos(at.k1Manager, id)).toHaveLength(2);
    expect(atRaise.actions.transitions.map((t) => t.key)).toEqual(["raise"]);
    await take(at.k1Manager, id, "raise");
    expect((await detail(at.c1Pm, id)).stage.key).toBe("open");
    expect(await photos(at.c1Pm, id)).toHaveLength(2);
  });

  it("offers the Raise with the Participant field where two Contractors cover the Snag (RP-658); without a pick the API refuses it", async () => {
    const id = await phoneDraft("Socket outlet loose", 1);
    await pickLocation(id, buildingB);
    const [raise] = (await detail(at.k1Manager, id)).actions.transitions;
    expect(raise!.key).toBe("raise");
    expect(raise!.participants).toHaveLength(2);
    const refused = await tryTake(at.k1Manager, id, "raise");
    expect({ status: refused.statusCode, body: refused.json() }).toEqual({ status: 422, body: { error: "participant_not_picked" } });
    await take(at.k1Manager, id, "raise", { participant: at.c1ParticipantId });
    expect((await detail(at.c1Pm, id)).stage.key).toBe("open");
  });
});

describe("the cards' swipe actions (scenario RP-630-1, seam 1)", () => {
  /** A Snag K1's manager raised on Building A, Open with C1, picked up by C1's PM. */
  async function openWithC1(title: string): Promise<string> {
    const id = await phoneDraft(title, 0);
    await pickLocation(id, at.buildingA);
    await take(at.k1Manager, id, "raise");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    return id;
  }

  it("RP-630-1: are the Transitions the item offers its holder, and each is taken without a refusal", async () => {
    const offered = (await detail(at.c1Pm, await openWithC1("Missing cable labels"))).actions.transitions;
    expect(offered.map((t) => t.key).sort()).toEqual(["put_on_hold", "resolve", "start_work"]);
    for (const transition of offered) {
      // A fresh Snag for each, so every one is taken from Open, as the card offered it.
      const id = await openWithC1(`Swipe ${transition.key}`);
      const answers = transition.key === "resolve" ? { answers: { resolution_note: "Labelled" } } : {};
      const taken = await tryTake(at.c1Pm, id, transition.key, answers);
      expect(taken.statusCode, `${transition.key}: ${taken.body}`).toBeLessThan(300);
    }
  });

  it("RP-630-1: are none for those who may take none: the Consultant while C1 holds it, and C1's colleague who did not pick it up", async () => {
    const id = await openWithC1("Ceiling tile cracked");
    expect((await detail(at.k1Manager, id)).actions.transitions).toEqual([]);
    expect((await detail(at.c1Engineer, id)).actions.transitions).toEqual([]);
    // And the API refuses them what no card showed.
    expect((await tryTake(at.k1Manager, id, "close")).statusCode).toBeGreaterThanOrEqual(400);
    expect((await tryTake(at.c1Engineer, id, "start_work")).statusCode).toBeGreaterThanOrEqual(400);
  });
});
