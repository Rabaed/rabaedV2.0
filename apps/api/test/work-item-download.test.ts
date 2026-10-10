// Seam 1 for the List's row menu Download (RP-409; visibility.md V5, V14 and
// scenario RP-409-2). Download prints the item page as the viewer reads it: the
// web's print page makes exactly the item page's reads (the item, its Form, its
// Documents, Links and history), so what reaches each viewer's PDF is what these
// reads give that viewer. C1 and K1 each read their own Company's Internal
// Notes and people only; another Contractor and a stranger read nothing at all.
import type { DocumentList, WorkItemDetail, WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, buildTower, detail, ok, projectMember, take, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let c2Engineer: Caller;
let stranger: Caller;
let item = "";

/** What the print page reads for `id`, as `by`. */
async function printed(by: Caller, id: string) {
  const [d, form, documents, links, history] = await Promise.all(
    ["", "/form", "/documents", "/links", "/history"].map(async (path) => (await ok(by.get(`/v1/work-items/${id}${path}`), 200)).json()),
  );
  return { detail: d as WorkItemDetail, form, documents: documents as DocumentList, links, history: history as WorkItemHistory };
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
  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: "MAR",
      title: "Busbar trunking",
      answers: { manufacturer: "ABB", description: "Busbar", trade: at.electrical, location: at.buildingA },
    }),
    201,
  );
  item = res.json().id;
  await attachDatasheet(at.c1Engineer, item);
  await take(at.c1Engineer, item, "send_for_review", { internalNote: "C1 only: price check" });
  await ok(at.c1Pm.post(`/v1/work-items/${item}/claim`));
  await take(at.c1Pm, item, "submit");
  await ok(at.k1Manager.post(`/v1/work-items/${item}/claim`));
  const d = await detail(at.k1Manager, item);
  await ok(at.k1Manager.request("PUT", `/v1/work-items/${item}/answers`, { answers: { ...d.answers, verification_note: "K1 still checking" } }));
});

describe("scenario RP-409-2: Download prints the item as each viewer reads it", () => {
  it("gives C1 its own Internal Note and the Creation Date, K1 by name only, and the answers as they arrived", async () => {
    const c1 = await printed(at.c1Engineer, item);
    expect(JSON.stringify(c1.history)).toContain("C1 only: price check");
    expect(c1.detail.creationDate).not.toBeNull();
    expect(c1.detail.heldBy).toMatchObject({ memberName: null });
    // K1's in-progress answer stays with K1 until the item leaves it (V19).
    expect(c1.detail.answers).not.toHaveProperty("verification_note");
    expect(c1.documents.documents.map((x) => x.fileName)).toEqual(["datasheet.pdf"]);
  });

  it("gives K1 its own person and answers, never C1's Internal Note or Creation Date", async () => {
    const k1 = await printed(at.k1Manager, item);
    expect(JSON.stringify(k1.history)).not.toContain("C1 only");
    expect(k1.detail.creationDate).toBeNull();
    expect(k1.detail.heldBy?.memberName).not.toBeNull();
    expect(k1.detail.answers).toMatchObject({ verification_note: "K1 still checking" });
  });

  it("gives another Contractor and a stranger nothing: every read is the plain 404", async () => {
    for (const who of [c2Engineer, stranger]) {
      for (const path of ["", "/form", "/documents", "/links", "/history"]) await expectHidden(who.get(`/v1/work-items/${item}${path}`));
    }
  });
});
