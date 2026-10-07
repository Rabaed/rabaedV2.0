// Seam 1: "Linked from" (RP-292, spec RP-289; form-engine.md part 2b;
// visibility.md E3, the Linked from row, scenarios 77 and 78). Any Member who
// sees a Work Item reads the Submitted items that link to it. A linking item
// they can see comes with its id; one they can't comes as its Document Number
// and Subject only, and everything else about it stays 404. A Draft or an item
// in internal review never appears, whoever asks; it appears once Submitted.
//
// The Tower setup: C1 (Contractor, created the Project) and K1 (the Consultant,
// covering the whole Project, with a second manager covering Mechanical only).
// Only Contractors raise items today, so scenario 77's "item K1 can't see"
// is an Electrical C1 item linking a Mechanical one, read by K1's Mechanical
// manager: the same E3 rule, one viewer who sees the target and not the linker.
import { randomUUID } from "node:crypto";
import type { LinkedFrom } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, only, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let c1: Company;
let k1: Company;
let c2: Company;
let projectId = "";
let electrical = "";
let mechanical = "";
let buildingA = "";
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Manager: Caller; // Covers the whole Project.
let k1Mechanical: Caller; // Covers Mechanical only.
let c2Engineer: Caller; // Another Contractor on the Project, who sees none of C1's items.

/** A Draft MAR of C1's with the Subject `title`. */
async function draft(title: string, trade: string): Promise<string> {
  const res = await c1Engineer.post(`/v1/projects/${projectId}/work-items`, {
    type: "MAR",
    title,
    answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade, location: buildingA },
  });
  expect(res.statusCode, res.body).toBe(201);
  await attachDatasheet(c1Engineer, res.json().id);
  return res.json().id;
}

const sendForReview = (id: string) => take(c1Engineer, id, "send_for_review");
async function submit(id: string) {
  await ok(c1Pm.post(`/v1/work-items/${id}/claim`));
  await take(c1Pm, id, "submit");
}

const linkedFromUrl = (id: string) => `/v1/work-items/${id}/linked-from`;
const linkedFrom = async (by: Caller, id: string): Promise<LinkedFrom> => (await ok(by.get(linkedFromUrl(id)), 200)).json();
const link = (from: string, to: string) => ok(c1Engineer.post(`/v1/work-items/${from}/links`, { workItemId: to }), 201);
const number = async (id: string) => (await c1Engineer.get(`/v1/work-items/${id}`)).json().documentNumber as string;

beforeAll(async () => {
  c1 = await api.projectCreator();
  const onboard = async (legalName: string): Promise<Company> => {
    const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
    return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  };
  k1 = await onboard("Design Consultants LLC");
  c2 = await onboard("Second Contractor Co");
  projectId = (await api.createProject(c1.caller, { code: "LNK" })).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  const c2ParticipantId = await api.addParticipant(c1.caller, projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c1Engineer = await projectMember(api, c1, c1ParticipantId, ["engineer"]);
  c1Pm = await projectMember(api, c1, c1ParticipantId, ["project_manager"]);
  k1Manager = await projectMember(api, k1, k1ParticipantId, ["manager"]);
  k1Mechanical = await projectMember(api, k1, k1ParticipantId, ["manager"], only(mechanical));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
});

describe("Linked from", () => {
  // A Submitted Mechanical MAR, linked to by an Electrical one K1's Mechanical manager can't see.
  let chillers = "";
  let busbars = "";

  beforeAll(async () => {
    chillers = await draft("Chillers", mechanical);
    await sendForReview(chillers);
    await submit(chillers);
    busbars = await draft("Busbars", electrical);
    await link(busbars, chillers);
  });

  it("never lists a Draft or an item in internal review, whoever asks; it appears once Submitted (scenario 78)", async () => {
    for (const who of [c1Engineer, k1Manager, k1Mechanical]) expect(await linkedFrom(who, chillers), "Draft").toEqual({ items: [] });
    await sendForReview(busbars);
    for (const who of [c1Engineer, k1Manager, k1Mechanical]) expect(await linkedFrom(who, chillers), "internal").toEqual({ items: [] });
    await submit(busbars);
    const listed = { items: [{ documentNumber: await number(busbars), subject: "Busbars", workItemId: busbars }] };
    expect(await linkedFrom(c1Engineer, chillers)).toEqual(listed);
    expect(await linkedFrom(k1Manager, chillers)).toEqual(listed);
  });

  it("shows a linking item the reader can't see as its number and Subject only; everything else about it is 404 (E3, scenario 77)", async () => {
    const res = await ok(k1Mechanical.get(linkedFromUrl(chillers)), 200);
    expect(res.json()).toEqual({ items: [{ documentNumber: await number(busbars), subject: "Busbars", workItemId: null }] });
    expect(res.body).not.toContain(busbars);
    for (const path of ["", "/form", "/history", "/documents", "/links", "/linked-from"]) {
      await expectHidden(k1Mechanical.get(`/v1/work-items/${busbars}${path}`), path);
    }
  });

  it("is hidden like the item from whoever can't see it, and for signed-in Members only", async () => {
    for (const r of [
      c2Engineer.get(linkedFromUrl(chillers)),
      k1Mechanical.get(linkedFromUrl(busbars)),
      c1Engineer.get(linkedFromUrl(randomUUID())),
      c1Engineer.get(linkedFromUrl("not-an-id")),
    ]) {
      await expectHidden(r);
    }
    expect((await api.anonymous().get(linkedFromUrl(chillers))).statusCode).toBe(401);
  });

  it("lists every Submitted item that links here, and not the items this one links to", async () => {
    // busbars is frozen now; a new Draft links chillers and is Submitted.
    const trays = await draft("Cable trays", electrical);
    await link(trays, chillers);
    await link(trays, busbars);
    await sendForReview(trays);
    await submit(trays);
    const numbers = [await number(busbars), await number(trays)].sort();
    expect((await linkedFrom(k1Manager, chillers)).items.map((i) => i.documentNumber)).toEqual(numbers);
    expect((await linkedFrom(k1Manager, trays)).items).toEqual([]);
    expect((await linkedFrom(k1Manager, busbars)).items.map((i) => i.workItemId)).toEqual([trays]);
  });
});
