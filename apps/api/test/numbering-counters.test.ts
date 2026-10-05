// Seam 1: starting numbers, and who reads counters (RP-315, spec RP-311;
// workflow-engine.md §8 "Starting numbers", visibility.md scenario 55). A Project
// moving from a paper register continues it: its Project Admin sets a counter's
// starting number before the counter issues anything, and it is locked after
// that. Only Project Admins read counters; anyone else gets a 404 naming nothing.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { buildTower, inInternalReview, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let c1: Company; // Created the Project: its Project Admin.
let k1: Company; // The Consultant.
let tower: Tower;
let counters = "";

const startOf = (by: Caller, body: object, projectId = tower.projectId) =>
  by.request("PUT", `/v1/projects/${projectId}/numbering/counters/start`, body);

const previewOf = (by: Caller, query: string, projectId = tower.projectId) =>
  by.get(`/v1/projects/${projectId}/numbering/counter?${query}`);

const documentNumber = async (id: string) => (await tower.c1Engineer.get(`/v1/work-items/${id}`)).json().documentNumber as string;

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  tower = await buildTower(api, { c1, k1 }, "NUM");
  counters = `/v1/projects/${tower.projectId}/numbering/counters`;
});

describe("a starting number", () => {
  it("is the next number issued: set 144, and the next MAR is 0144", async () => {
    const set = await startOf(c1.caller, { workItemType: "MAR", participantId: tower.c1ParticipantId, startingNumber: 144 });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toEqual({ counterKey: "NUM-MAR-01", nextNumber: "NUM-MAR-01-0144" });

    const first = await inInternalReview(tower, tower.c1Engineer, "Cable trays");
    expect(await documentNumber(first)).toBe("NUM-MAR-01-0144");
    const second = await inInternalReview(tower, tower.c1Engineer, "Busbars");
    expect(await documentNumber(second)).toBe("NUM-MAR-01-0145");
  });

  it("is locked once the counter has issued a number", async () => {
    const res = await startOf(c1.caller, { workItemType: "MAR", participantId: tower.c1ParticipantId, startingNumber: 300 });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "counter_used" } });
  });

  it("asks for the values the pattern counts by, and a whole number from 1", async () => {
    const noParticipant = await startOf(c1.caller, { workItemType: "MAR", startingNumber: 5 });
    expect({ status: noParticipant.statusCode, body: noParticipant.json() }).toEqual({ status: 422, body: { error: "participant_required" } });
    const elsewhere = await startOf(c1.caller, { workItemType: "MAR", participantId: randomUUID(), startingNumber: 5 });
    expect({ status: elsewhere.statusCode, body: elsewhere.json() }).toEqual({ status: 422, body: { error: "value_not_found" } });
    const noType = await startOf(c1.caller, { workItemType: "NOPE", participantId: tower.c1ParticipantId, startingNumber: 5 });
    expect({ status: noType.statusCode, body: noType.json() }).toEqual({ status: 422, body: { error: "type_not_found" } });
    for (const startingNumber of [0, -3, 1.5, 10_000_000]) {
      const res = await startOf(c1.caller, { workItemType: "MAR", participantId: tower.c1ParticipantId, startingNumber });
      expect(res.statusCode, String(startingNumber)).toBe(400);
    }
  });
});

describe("counters", () => {
  it("are listed with their last value for the Project Admin, with the Work Item Types to start one for", async () => {
    const res = await c1.caller.get(counters);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().counters).toEqual([{ counterKey: "NUM-MAR-01", lastValue: 145, startingNumber: 144, issued: true }]);
    expect(res.json().workItemTypes).toContainEqual({ code: "MAR", name: expect.objectContaining({ en: expect.any(String) }) });
  });

  it("show the Project Admin the counter chosen values fall under, for the page's example", async () => {
    const used = await previewOf(c1.caller, `workItemType=MAR&participantId=${tower.c1ParticipantId}`);
    expect(used.statusCode, used.body).toBe(200);
    expect(used.json()).toEqual({ counterKey: "NUM-MAR-01", prefix: "NUM-MAR-01", separator: "-", seqDigits: 4, lastValue: 145, issued: true });

    const k1ParticipantId = (await c1.caller.get(`/v1/projects/${tower.projectId}/participants`))
      .json()
      .participants.find((p: { isOwnCompany: boolean }) => !p.isOwnCompany).id;
    const fresh = await previewOf(c1.caller, `workItemType=MAR&participantId=${k1ParticipantId}`);
    expect(fresh.json()).toEqual({ counterKey: "NUM-MAR-02", prefix: "NUM-MAR-02", separator: "-", seqDigits: 4, lastValue: null, issued: false });
    const refused = await previewOf(c1.caller, "workItemType=MAR");
    expect({ status: refused.statusCode, body: refused.json() }).toEqual({ status: 422, body: { error: "participant_required" } });
  });

  it("are hidden from a C1 member and from K1: a 404 that names nothing (scenario 55)", async () => {
    const k1Ap = k1.caller;
    for (const [label, by] of [
      ["C1 engineer", tower.c1Engineer],
      ["C1 project manager", tower.c1Pm],
      ["K1 manager", tower.k1Manager],
      ["K1 Authorized Person", k1Ap],
    ] as const) {
      await expectHidden(by.get(counters), label);
      await expectHidden(previewOf(by, `workItemType=MAR&participantId=${tower.c1ParticipantId}`), label);
      await expectHidden(startOf(by, { workItemType: "MAR", participantId: tower.c1ParticipantId, startingNumber: 900 }), label);
    }
    // Exactly as a made-up or malformed Project.
    await expectHidden(c1.caller.get(`/v1/projects/${randomUUID()}/numbering/counters`));
    await expectHidden(c1.caller.get("/v1/projects/not-a-uuid/numbering/counters"));
    await expectHidden(startOf(c1.caller, { workItemType: "MAR", participantId: tower.c1ParticipantId, startingNumber: 900 }, randomUUID()));
  });
});
