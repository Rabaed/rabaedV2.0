// Seam 1 for the List's row menu Download (RP-409; visibility.md V5, V14, V19 and
// scenario RP-409-2). Download is the item's final output: its content as it was
// shared, with its outcome, the same for every viewer who sees it. No internal
// Step, no Internal Note, no person and no in-progress answers, for anyone, the
// raiser's own Company included. Another Contractor and a stranger read nothing;
// a Draft, never shared, has nothing to download.
import type { SharedWorkItem } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, buildTower, ok, projectMember, take, type Tower } from "./support/tower.ts";
import { LEGACY_MAR } from "@rabaed/db/test-support";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let c2Engineer: Caller;
let stranger: Caller;
let open = ""; // Submitted, with K1 checking it.
let closed = ""; // Closed by K1 with Code C.
let draft = "";

const shared = async (by: Caller, id: string): Promise<SharedWorkItem> => (await ok(by.get(`/v1/work-items/${id}/shared`), 200)).json();

/** A MAR of C1's, sent for review and Submitted, with an Internal Note at each internal move. */
async function submitted(title: string) {
  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: LEGACY_MAR,
      title,
      answers: { manufacturer: "ABB", description: "Busbar", trade: at.electrical, location: at.buildingA },
    }),
    201,
  );
  const id = res.json().id as string;
  await attachDatasheet(at.c1Engineer, id);
  await take(at.c1Engineer, id, "send_for_review", { internalNote: "C1 only: price check" });
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit", { internalNote: "C1 only: submitted early" });
  return id;
}

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "DLD");
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  stranger = (await api.authorizedPerson()).caller;

  open = await submitted("Busbar trunking");
  await ok(at.k1Manager.post(`/v1/work-items/${open}/pick-up`));

  closed = await submitted("Cable trays");
  await ok(at.k1Manager.post(`/v1/work-items/${closed}/pick-up`));
  await take(at.k1Manager, closed, "revise_c", { remarks: "Resubmit with the tested trays", internalNote: "K1 only: their price is high" });

  draft = (
    await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: LEGACY_MAR, title: "Draft", answers: { trade: at.electrical } }), 201)
  ).json().id;
});

describe("scenario RP-409-2: Download is the item as shared, the same for every viewer", () => {
  it("gives the raiser's PM exactly what the Consultant gets", async () => {
    for (const id of [open, closed]) expect(await shared(at.c1Pm, id)).toEqual(await shared(at.k1Manager, id));
  });

  it("holds no Internal Note, no internal Step and no person, for the raiser's own Company too", async () => {
    for (const id of [open, closed]) {
      const text = JSON.stringify(await shared(at.c1Pm, id));
      expect(text).not.toMatch(/C1 only|K1 only|price/);
      expect(text).not.toMatch(/Contractor review|Consultant review|Send for Review/);
      expect(text).not.toMatch(/"memberName":\{/);
    }
  });

  it("holds the outcome and the Remarks shared with it, and the shared moves by Company only", async () => {
    const item = await shared(at.c1Pm, closed);
    expect(item.outcome).toBe("C");
    expect(item.outcomeName).not.toBeNull();
    expect(item.history.map((e) => e.remarks)).toContain("Resubmit with the tested trays");
    expect(item.history.every((e) => e.companyName === null || typeof e.companyName.en === "string")).toBe(true);
  });

  it("holds the raiser's answers as Submitted, the same for K1 (K1 answers in its replies, never the Form, ADR 0019)", async () => {
    expect((await shared(at.k1Manager, open)).answers).toEqual((await shared(at.c1Pm, open)).answers);
    expect((await shared(at.c1Pm, closed)).answers).toMatchObject({ manufacturer: "ABB", description: "Busbar" });
  });

  it("has nothing before the first Submit, and nothing for another Contractor or a stranger", async () => {
    await expectHidden(at.c1Engineer.get(`/v1/work-items/${draft}/shared`));
    for (const who of [c2Engineer, stranger]) await expectHidden(who.get(`/v1/work-items/${closed}/shared`));
  });
});
