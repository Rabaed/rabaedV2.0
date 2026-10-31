// Seam 1 for Search over the List (RP-347, spec RP-344; visibility.md "Search
// and filters", V1, V3, V19, scenarios 1 and 66). `q` finds items by Document
// Number (in part), Subject (Arabic or English), Type, Trade, Location and the
// raiser's Company name, and never by Form answers or Documents. Its results go
// through the same visibility as the List, and no count reaches beyond the
// page, so a word that matches only another Company's item says nothing at all.
import { randomUUID } from "node:crypto";
import { workItemSearchParams, type WorkItemBoard, type WorkItemList, type WorkItemQueryInput } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, readById, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, draft, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";
import { LEGACY_MAR, expectHiddenFrom } from "@rabaed/db/test-support";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

/** A Company with its own name, and its signed-in Authorized Person, who may create Projects. */
async function namedCompany(en: string, ar: string): Promise<Company> {
  const company = await api.onboardCompany({ legalName: { en, ar } }); // not hidden-from: the Company's name as it is onboarded
  const caller = await api.acceptInvitation(company.invitationToken);
  await ok(caller.patch(`/v1/members/${company.authorizedPerson.id}`, { canCreateProjects: true }), 200);
  return { company, caller };
}

let tower: Tower;
let c2Engineer: Caller;
let c2Pm: Caller;
let k1Engineer: Caller;
let locationB = "";
const item = { lighting: "", arabic: "", mechanical: "", trays: "", c1Draft: "", c2: "" };

async function search(by: Caller, q: string, query: WorkItemQueryInput = {}): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${tower.projectId}/work-items?${workItemSearchParams({ ...query, q })}`), 200)).json();
}

const ids = (l: WorkItemList) => l.items.map((i) => i.id).sort();
const total = (l: WorkItemList) => l.stages.reduce((sum, s) => sum + s.count, 0);
/** The rows `by` finds with `q`, for expectHiddenFrom. */
const found = (q: string) => async (by: Caller) => (await search(by, q)).items;
/** The rows one reader finds with each search, for expectHiddenFrom: the viewers are the searches. */
const foundBy = (by: Caller) => async (q: string) => (await search(by, q)).items;
const whoIs = (by: Caller) =>
  by === tower.c1Engineer ? "C1 engineer" : by === tower.c1Pm ? "C1 PM" : by === tower.k1Manager ? "K1 manager" : by === k1Engineer ? "K1 engineer" : by === c2Engineer ? "C2 engineer" : by === c2Pm ? "C2 PM" : "someone";

beforeAll(async () => {
  const c1 = await namedCompany("Nakheel Contracting", "نخيل للمقاولات");
  const k1 = await namedCompany("Qimma Consultants", "قمة للاستشارات");
  const c2 = await namedCompany("Sahara Builders", "بناة الصحراء");
  tower = await buildTower(api, { c1, k1 }, "SRC");
  const { projectId } = tower;
  locationB = (await ok(c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  const participants = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  const k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  const c2ParticipantId = await api.addParticipant(c1.caller, projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  c2Pm = await projectMember(api, c2, c2ParticipantId, ["project_manager"]);

  const { c1Engineer, c1Pm } = tower;
  item.lighting = await submitted(tower, c1Engineer, c1Pm, "LED lighting fixtures");
  item.arabic = await submitted(tower, c1Engineer, c1Pm, "وحدات إنارة الممرات");
  item.mechanical = await submitted(tower, c1Engineer, c1Pm, "Chilled water pumps", tower.mechanical);
  item.trays = await submitted(tower, c1Engineer, c1Pm, "Cable trays");
  item.c1Draft = await draft(tower, c1Engineer, "Quokka enclosure cabling");
  // C2's own item, Submitted to K1: C1 never sees it (V3).
  const c2Draft = await c2Engineer.post(`/v1/projects/${projectId}/work-items`, {
    type: LEGACY_MAR,
    title: "Xylophonic damper actuators",
    answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: tower.electrical, location: tower.buildingA },
  });
  expect(c2Draft.statusCode, c2Draft.body).toBe(201);
  item.c2 = c2Draft.json().id;
  await attachDatasheet(c2Engineer, item.c2);
  await take(c2Engineer, item.c2, "send_for_review");
  await ok(c2Pm.post(`/v1/work-items/${item.c2}/pick-up`));
  await take(c2Pm, item.c2, "submit");
});

describe("what Search finds", () => {
  it("finds a part of a Document Number, in any case", async () => {
    const numbered = [item.lighting, item.arabic, item.mechanical, item.trays].sort();
    expect(ids(await search(tower.c1Engineer, "MARV-01-00"))).toEqual(numbered);
    expect(ids(await search(tower.c1Engineer, "src-marv-01-000"))).toEqual(numbered);
  });

  it("finds English and Arabic Subjects, by a whole word or a part of one", async () => {
    expect(ids(await search(tower.c1Engineer, "lighting"))).toEqual([item.lighting]);
    expect(ids(await search(tower.c1Engineer, "LIGHT"))).toEqual([item.lighting]);
    expect(ids(await search(tower.c1Engineer, "إنارة"))).toEqual([item.arabic]);
    expect(ids(await search(tower.c1Engineer, "الممر"))).toEqual([item.arabic]);
  });

  it("finds the Type, Trade and Location by name, in Arabic too", async () => {
    // C1's five, by id: never C2's, of the same Type, Trade and Location (V3).
    const c1Items = [item.lighting, item.arabic, item.mechanical, item.trays, item.c1Draft].sort();
    expect(ids(await search(tower.c1Engineer, "Material Approval Request"))).toEqual(c1Items);
    expect(ids(await search(tower.c1Engineer, "طلب اعتماد مواد"))).toEqual(c1Items);
    expect(ids(await search(tower.c1Engineer, "Mechanical"))).toEqual([item.mechanical]);
    expect(ids(await search(tower.c1Engineer, "Building A"))).toEqual(c1Items);
  });

  it("follows a changed Location", async () => {
    // A Location changed on the Draft reaches the index too.
    const answers = (await ok(tower.c1Engineer.get(`/v1/work-items/${item.c1Draft}`), 200)).json().answers;
    await ok(tower.c1Engineer.request("PUT", `/v1/work-items/${item.c1Draft}/answers`, { answers: { ...answers, location: locationB } }));
    expect(ids(await search(tower.c1Engineer, "Building B"))).toEqual([item.c1Draft]);
  });

  it("finds the raiser's Company by its name, in English or Arabic", async () => {
    expect(ids(await search(k1Engineer, "Sahara"))).toEqual([item.c2]);
    expect(ids(await search(k1Engineer, "بناة الصحراء"))).toEqual([item.c2]);
    // C1's four Submitted items, by id, and never its Draft (V1).
    expect(ids(await search(k1Engineer, "Nakheel"))).toEqual([item.lighting, item.arabic, item.mechanical, item.trays].sort());
  });

  it("takes every word, wherever each is", async () => {
    expect(ids(await search(tower.c1Engineer, "LED Electrical"))).toEqual([item.lighting]);
    expect((await search(tower.c1Engineer, "fixtures Mechanical")).items).toEqual([]); // not hidden-from: no item of anyone's has both words; C1 finds each word alone above
  });

  it("combines with the other filters", async () => {
    expect(ids(await search(tower.c1Engineer, "Approval Request", { trade: [tower.mechanical] }))).toEqual([item.mechanical]);
  });

  it("takes a LIKE wildcard as itself", async () => {
    expect((await search(tower.c1Engineer, "%")).items).toEqual([]); // not hidden-from: an escaping test; no item of anyone's has a "%"
    expect((await search(tower.c1Engineer, "_")).items).toEqual([]); // not hidden-from: an escaping test; no item of anyone's has a "_"
  });
});

describe("what Search never finds (V1, V3, V19)", () => {
  it("scenario 66: a Consultant's reply (its Remarks with a Code) is never searched", async () => {
    const id = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Search reply");
    await ok(tower.k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.k1Manager, id, "approve_a", { remarks: "Zanzibarite efficacy checked" });
    for (const by of [tower.c1Engineer, tower.c1Pm, tower.k1Manager]) {
      // The Remarks are there for each to read, and each finds the item by its Subject; never by the Remarks.
      expect((await ok(by.get(`/v1/work-items/${id}/history`), 200)).body, whoIs(by)).toContain("Zanzibarite efficacy checked");
      await expectHiddenFrom({ read: foundBy(by), target: id, seenBy: "Search reply", hiddenFrom: "Zanzibarite", label: whoIs(by) });
      expect(total(await search(by, "Zanzibarite"))).toBe(0);
    }
  });

  it("never searches the raiser's own answers either", async () => {
    // C2's item, whose answers say "ACME Cables" and "Galvanised": its raiser and K1 find it by its Subject, never by them.
    for (const by of [c2Engineer, k1Engineer]) {
      await expectHiddenFrom({ read: foundBy(by), target: item.c2, seenBy: "Xylophonic", hiddenFrom: ["ACME", "Galvanised"], label: whoIs(by) });
    }
  });

  it("a word matching only another Company's hidden item returns nothing and no count", async () => {
    await expectHiddenFrom({ read: found("Xylophonic"), target: item.c2, seenBy: [k1Engineer, c2Engineer], hiddenFrom: [tower.c1Engineer, tower.c1Pm], name: whoIs, label: "C2's item" });
    const result = await search(tower.c1Engineer, "Xylophonic");
    expect(result.nextCursor).toBeNull();
    expect(total(result)).toBe(0);
    expect(result.stages.every((s) => s.count === 0)).toBe(true);
    expect(ids(await search(k1Engineer, "Xylophonic"))).toEqual([item.c2]);
  });

  it("scenario 1: a Draft is found by its raiser only", async () => {
    expect(ids(await search(tower.c1Engineer, "Quokka"))).toEqual([item.c1Draft]);
    const others = [k1Engineer, c2Engineer, tower.k1Manager];
    await expectHiddenFrom({ read: found("Quokka"), target: item.c1Draft, seenBy: tower.c1Engineer, hiddenFrom: others, name: whoIs, label: "C1's Draft" });
    for (const by of others) expect(total(await search(by, "Quokka")), whoIs(by)).toBe(0);
  });

  it("counts no more than the page shows", async () => {
    const result = await search(tower.c1Engineer, "Approval Request");
    expect(total(result)).toBe(result.items.length);
  });

  it("a Project the searcher isn't on is 404", async () => {
    const stranger = (await api.authorizedPerson()).caller;
    const searchOf = async (by: Caller) =>
      (await readById(`/v1/projects/${tower.projectId}/work-items?${workItemSearchParams({ q: "LED" })}`)(by)).map(() => ({ id: tower.projectId }));
    await expectHiddenFrom({ read: searchOf, target: tower.projectId, seenBy: [tower.c1Engineer, k1Engineer, c2Engineer], hiddenFrom: stranger, name: (by) => (by === stranger ? "stranger" : whoIs(by)) });
  });

  it("refuses a search that is too long", async () => {
    const res = await tower.c1Engineer.get(`/v1/projects/${tower.projectId}/work-items?q=${"x".repeat(201)}&r=${randomUUID()}`);
    expect(res.statusCode).toBe(400);
  });
});

describe("Search on the Kanban (RP-349)", () => {
  async function board(by: Caller, q: string): Promise<WorkItemBoard> {
    return (await ok(by.get(`/v1/projects/${tower.projectId}/work-items/kanban?${workItemSearchParams({ q })}`), 200)).json();
  }
  const cardIds = (b: WorkItemBoard) => b.columns.flatMap((c) => c.lanes.flatMap((l) => l.cards.map((card) => card.id))).sort();

  it("finds what the List finds", async () => {
    expect(cardIds(await board(tower.c1Engineer, "lighting"))).toEqual([item.lighting]);
    expect(cardIds(await board(k1Engineer, "Sahara"))).toEqual([item.c2]);
  });

  it("a word matching only another Company's hidden item gives an empty board with zero counts", async () => {
    const cardsFound = async (by: Caller) => (await board(by, "Xylophonic")).columns.flatMap((c) => c.lanes.flatMap((l) => l.cards));
    await expectHiddenFrom({ read: cardsFound, target: item.c2, seenBy: [k1Engineer, c2Engineer], hiddenFrom: [tower.c1Engineer, tower.c1Pm], name: whoIs, label: "C2's card" });
    const result = await board(tower.c1Engineer, "Xylophonic");
    expect(result.stages.every((s) => s.count === 0)).toBe(true);
    expect(result.columns.every((c) => c.shown === 0 && c.lanes.every((l) => l.count === 0))).toBe(true);
    expect(cardIds(await board(k1Engineer, "Xylophonic"))).toEqual([item.c2]);
  });

  it("counts no more than the cards it shows", async () => {
    const result = await board(tower.c1Engineer, "Approval Request");
    expect(cardIds(result).length).toBeGreaterThan(0);
    for (const s of result.stages) expect(s.count, s.key).toBe(result.columns.find((c) => c.stageKey === s.key)!.shown);
  });
});
