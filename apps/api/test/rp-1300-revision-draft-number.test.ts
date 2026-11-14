// Seam 1 for RP-1300 (UAT SUB-15; owner's decision 2026-11-13; visibility.md V1, "Search and filters";
// docs/visibility/scenarios/RP-1300.md). A Revision Draft keeps its chain's base Document Number from
// the start: the item, its List row and its Kanban card carry `baseNumber`, the List sorts it beside its
// chain, and Search by the base number finds it, for the raiser's own Company only. Its own number
// (base " Rev n") still waits for the Submit, and until then no other Company reads anything of it.
import { randomUUID } from "node:crypto";
import type { RevisionChain, WorkItemBoard, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, readById, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, ok, projectMember, take, type Company } from "./support/tower.ts";
import { expectHiddenFrom, LEGACY_MAR } from "@rabaed/db/test-support";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let c1: Company;
let engineer: Caller; // C1 engineer: raises the MAR and its Revision.
let pm: Caller; // C1 PM: Submits.
let k1Manager: Caller; // K1: issues the Code.
let orEngineer: Caller; // Owner Representative (oversight).
let projectId = "";
let electrical = "";
let buildingA = "";
let closed = ""; // The original, closed at Code C.
let base = ""; // Its Document Number.
let revision = ""; // Rev 1, still a Draft.

const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";

const complete = { manufacturer: "Philips", description: "LED fixtures", items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }] };

async function submit(id: string) {
  await take(engineer, id, "send_for_review");
  await ok(pm.post(`/v1/work-items/${id}/pick-up`));
  await take(pm, id, "submit");
}

const list = async (by: Caller, query = "") => (await ok(by.get(`/v1/projects/${projectId}/work-items${query}`), 200)).json() as WorkItemList;
const board = async (by: Caller, query = "") => (await ok(by.get(`/v1/projects/${projectId}/work-items/kanban${query}`), 200)).json() as WorkItemBoard;
const cards = (b: WorkItemBoard) => b.columns.flatMap((c) => c.lanes.flatMap((l) => l.cards));
const searched = (q: string) => async (by: Caller) => (await list(by, `?q=${encodeURIComponent(q)}`)).items;
const searchedOnBoard = (q: string) => async (by: Caller) => cards(await board(by, `?q=${encodeURIComponent(q)}`));

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })).json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  const otherParticipant = async (role: "consultant" | "owner_representative") => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return { company, participantId };
  };
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  const k1 = await otherParticipant("consultant");
  k1Manager = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const or = await otherParticipant("owner_representative");
  orEngineer = await projectMember(api, or.company, or.participantId, ["engineer"]);
  for (const [by, name] of [[engineer, "C1 engineer"], [pm, "C1 PM"], [k1Manager, "K1 manager"], [orEngineer, "OR engineer"]] as const) names.set(by, name);

  // Two MARs, so the List's number order has something on either side of the chain.
  for (const title of ["Cable trays", "Switchgear"]) {
    const res = await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: LEGACY_MAR, title, answers: { ...complete, trade: electrical, location: buildingA } }), 201);
    const id = res.json().id as string;
    await attachDatasheet(engineer, id);
    await submit(id);
    if (title === "Cable trays") closed = id;
  }
  await ok(k1Manager.post(`/v1/work-items/${closed}/pick-up`));
  await take(k1Manager, closed, "revise_c", { remarks: "Resubmit" });
  base = (await detail(engineer, closed)).documentNumber!;
  revision = (await ok(engineer.post(`/v1/work-items/${closed}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;
});

describe("a Revision Draft's base Document Number (RP-1300-1)", () => {
  it("is on the item for the raiser's Company, while its own number still waits for the Submit", async () => {
    for (const by of [engineer, pm]) {
      expect(await detail(by, revision), named(by)).toMatchObject({ documentNumber: null, baseNumber: base, revisionNo: 1, stage: { category: "draft" } });
    }
  });

  it("is on its List row and Kanban card", async () => {
    const row = (await list(engineer)).items.find((r) => r.id === revision);
    expect(row).toMatchObject({ documentNumber: null, baseNumber: base, revisionNo: 1 });
    const card = cards(await board(engineer)).find((c) => c.id === revision);
    expect(card).toMatchObject({ documentNumber: null, baseNumber: base, revisionNo: 1 });
  });

  it("sorts the Draft where its chain is in the Document Number order, not last", async () => {
    const rows = (await list(engineer, "?sort=documentNumber")).items;
    expect(rows.map((r) => r.documentNumber ?? `${r.baseNumber} Rev ${r.revisionNo}`)).toEqual([`${base} Rev 1`, expect.not.stringContaining(base)]);
    const page = (await list(engineer, "?sort=documentNumber&dir=asc&page=1")).items;
    expect(page[0]!.id).toBe(revision);
  });

  it("is on no other item: the original and an item never revised carry none", async () => {
    const rows = (await list(engineer, "?allRevisions=true")).items;
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([closed, revision]));
    for (const r of rows.filter((x) => x.id !== revision)) expect(r.baseNumber, r.title).toBeUndefined(); // not hidden-from: a field the rows read above leave out
    expect((await detail(engineer, closed)).baseNumber).toBeUndefined(); // not hidden-from: a field of an item C1 reads
  });

  it("is read by nobody outside C1: the Draft stays hidden from K1 and the Owner Representative (V1)", async () => {
    const seenBy = [engineer, pm];
    const hiddenFrom = [k1Manager, orEngineer];
    await expectHiddenFrom({ read: readById(`/v1/work-items/${revision}`), target: revision, seenBy, hiddenFrom, name: named, label: "the Draft Revision" });
    await expectHiddenFrom({ read: async (by) => (await list(by)).items, target: revision, seenBy, hiddenFrom, name: named, label: "the List" });
    await expectHiddenFrom({ read: async (by) => cards(await board(by)), target: revision, seenBy, hiddenFrom, name: named, label: "the Kanban" });
    // They still read the original, Rev 0 at Code C, with its own number and no base number.
    for (const by of hiddenFrom) {
      const rows = (await list(by)).items;
      expect(rows.find((r) => r.id === closed), named(by)).toMatchObject({ documentNumber: base, revisionNo: 0 });
      expect(rows.some((r) => r.baseNumber !== undefined), named(by)).toBe(false);
    }
  });
});

describe("Search by the base Document Number (RP-1300-2)", () => {
  it("finds the Revision Draft for the raiser's Company, on the List and the Kanban", async () => {
    const seenBy = [engineer, pm];
    const hiddenFrom = [k1Manager, orEngineer];
    for (const q of [base, base.slice(-7)]) {
      await expectHiddenFrom({ read: searched(q), target: revision, seenBy, hiddenFrom, name: named, label: `the List's search for ${q}` });
      await expectHiddenFrom({ read: searchedOnBoard(q), target: revision, seenBy, hiddenFrom, name: named, label: `the Kanban's search for ${q}` });
    }
  });

  it("finds the original for the other Companies, as before", async () => {
    for (const by of [k1Manager, orEngineer]) expect((await searched(base)(by)).map((r) => r.id), named(by)).toEqual([closed]);
  });
});

describe("the Revision list of a Revision Draft (RP-1300-3)", () => {
  it("names the original by its number and the Draft by none, to C1", async () => {
    const chain: RevisionChain = (await ok(engineer.get(`/v1/work-items/${revision}/revisions`), 200)).json();
    expect(chain.revisions.map((r) => [r.id, r.revisionNo, r.documentNumber])).toEqual([
      [closed, 0, base],
      [revision, 1, null],
    ]);
  });
});

describe("once Submitted (RP-1300-4)", () => {
  beforeAll(() => submit(revision));

  it("has its own number, base ' Rev 1', and no base number beside it", async () => {
    const d = await detail(engineer, revision);
    expect(d.documentNumber).toBe(`${base} Rev 1`);
    expect(d.baseNumber).toBeUndefined(); // not hidden-from: a field of an item C1 reads, which now has its own number
  });

  it("reaches K1, found by the base number, as any Submitted Revision", async () => {
    expect((await searched(base)(k1Manager)).map((r) => r.id)).toContain(revision);
  });
});
