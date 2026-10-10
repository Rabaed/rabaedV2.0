// Seam 1 for the List's row menu Duplicate (RP-409, the owner's design;
// visibility.md V5, V13, V19 and scenario RP-409-1). A Member of the raiser's
// Company makes a new Draft of the same Type from an item, with only what their
// own Company wrote: its Subject and the answers of the sections the raiser
// fills. Never another Company's answers (the Consultant's verification), nor
// any Internal Note, Document, Link or history: the new Draft starts its own.
// Nobody else may duplicate it, and the row menu offers it only where allowed.
import type { DocumentList, WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { buildTower, detail, ok, projectMember, take, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let c2Engineer: Caller; // Another Contractor on the Project.
let stranger: Caller;
let closed = "";
let copy = "";

const answers = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};
const duplicate = (by: Caller, id: string) => by.post(`/v1/work-items/${id}/duplicate`, {});

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "DUP");
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  stranger = (await api.authorizedPerson()).caller;

  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: "MAR", title: "Fixtures", answers: { ...answers, trade: at.electrical, location: at.buildingA } }),
    201,
  );
  closed = res.json().id;
  await attachDatasheet(at.c1Engineer, closed);
  await take(at.c1Engineer, closed, "send_for_review", { internalNote: "C1 only: check the price" });
  await ok(at.c1Pm.post(`/v1/work-items/${closed}/claim`));
  await take(at.c1Pm, closed, "submit", { internalNote: "C1 only: submitted early" });
  const item = await detail(at.k1Manager, closed);
  await ok(
    at.k1Manager.request("PUT", `/v1/work-items/${closed}/answers`, {
      answers: { ...item.answers, sample_checked: true, matches_specification: false, verification_note: "Below the specified efficacy" },
    }),
  );
  await ok(at.k1Manager.post(`/v1/work-items/${closed}/claim`));
  await take(at.k1Manager, closed, "revise_c", { remarks: "Resubmit", internalNote: "K1 only: their price is high" });
});

describe("scenario RP-409-1: C1 duplicates a MAR K1 verified and closed with Code C", () => {
  it("is offered to the raiser's Company only", async () => {
    expect((await detail(at.c1Engineer, closed)).actions.duplicate).toBe(true);
    expect((await detail(at.k1Manager, closed)).actions.duplicate).toBe(false);
  });

  it("makes a new Draft of the same Type with C1's own Subject and answers", async () => {
    copy = (await ok(duplicate(at.c1Engineer, closed), 201)).json().id;
    const d = await detail(at.c1Engineer, copy);
    expect(d).toMatchObject({
      title: "Fixtures",
      type: { code: "MAR" },
      documentNumber: null,
      revisionNo: 0,
      stage: { key: "draft" },
      outcome: null,
      answers: { ...answers, trade: at.electrical, location: at.buildingA },
    });
  });

  it("never copies K1's answers, an Internal Note, a Document or the history", async () => {
    const d = await detail(at.c1Engineer, copy);
    for (const key of ["sample_checked", "matches_specification", "verification_note"]) expect(d.answers).not.toHaveProperty(key);
    const documents: DocumentList = (await ok(at.c1Engineer.get(`/v1/work-items/${copy}/documents`), 200)).json();
    expect(documents.documents).toEqual([]);
    const history: WorkItemHistory = (await ok(at.c1Engineer.get(`/v1/work-items/${copy}/history`), 200)).json();
    expect(history.events.every((e) => e.internalNote === null && e.remarks === null && e.transition === null)).toBe(true);
    expect(JSON.stringify(history)).not.toMatch(/C1 only|K1 only|Resubmit/);
  });

  it("is C1's Draft: K1, another Contractor and a stranger can't see it", async () => {
    for (const who of [at.k1Manager, c2Engineer, stranger]) await expectHidden(who.get(`/v1/work-items/${copy}`));
  });

  it("is refused to K1, who sees the item but didn't raise it, and to anyone who can't see it", async () => {
    const refused = await duplicate(at.k1Manager, closed);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "duplicate_not_allowed" });
    for (const who of [c2Engineer, stranger]) await expectHidden(duplicate(who, closed));
  });
});
