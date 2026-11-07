// Seam 1 for the Snag List's "Raised from" filter at every Revision (RP-1119; scenario RP-1119-1;
// visibility.md "Search and filters", V3).
//
// "Open in Snag List" on an item page filters the Snag List by the item's Document Number, or by its
// previous Revision's. A Revision's number is its first item's with " Rev n", which the filter refused
// until RP-1119, so from Rev 2 on the link opened the Snag List unfiltered. The filter only narrows the
// reader's own rows: it matches the `raised_from` Link's number as app.work_item_links gives it to the
// reader, so C2, who sees none of C1's Snags, finds none by any of the chain's numbers, by row or by count.
import { expectHiddenFrom } from "@rabaed/db/test-support";
import type { ChecklistTemplates, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, memberOnProject, ok, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(async () => {
  await api.close();
});

const FIELD = "inspection_checklist";
const VERIFIED = { sample_checked: true, matches_specification: true };
const items = [
  { key: "formwork", text: bilingual("Formwork tight"), comment: "off", photo: "optional" },
  { key: "cover", text: bilingual("Rebar cover"), comment: "off", photo: "optional" },
];
const TWO_FAILS = { formwork: { answer: "fail" }, cover: { answer: "fail" } };

let projectId = "";
let electrical = "";
let buildingA = "";
let template = "";
let hafiz: { id: string; caller: Caller }; // C1 Contractor Engineer: raises the WIR and its Revisions.
let ali: { id: string; caller: Caller }; // C1's only Project Manager: Submits.
let ahmed: { id: string; caller: Caller }; // K1 Consultant Engineer.
let mohammed: { id: string; caller: Caller }; // K1's only Manager: issues the code.
let yousef: { id: string; caller: Caller }; // C2, another Contractor covering all of Electrical.

const answer = (by: Caller, id: string, answers: object) => by.request("PUT", `/v1/work-items/${id}/reply-checklists/${FIELD}`, { answers });
/** The Snag List as `by` reads it, filtered by `raisedFrom` when given: its rows and its Stage counts. */
const snagList = async (by: Caller, raisedFrom?: string): Promise<WorkItemList> =>
  (await ok(by.get(`/v1/projects/${projectId}/modules/snag_list/work-items${raisedFrom === undefined ? "" : `?raisedFrom=${encodeURIComponent(raisedFrom)}`}`), 200)).json();
const ids = (list: WorkItemList) => list.items.map((i) => i.id).sort();
const counted = (list: WorkItemList) => list.stages.reduce((n, s) => n + s.count, 0);

async function newWir(title: string): Promise<string> {
  return (
    await ok(
      hafiz.caller.post(`/v1/projects/${projectId}/work-items`, {
        type: "WIR",
        title,
        answers: { description: "Slab, Level 2", requested_for: "2026-11-02T05:30:00.000Z", trade: electrical, location: buildingA, checklist_template: template },
      }),
      201,
    )
  ).json().id as string;
}

/** Sends `id` through to Code C with two failed items, so it raises two Snags; returns their ids. */
async function codeC(id: string): Promise<string[]> {
  await take(hafiz.caller, id, "send_for_review");
  await take(ali.caller, id, "submit", { answers: { cover_note: "Ready on site from 09:00" } });
  expect((await answer(ahmed.caller, id, TWO_FAILS)).statusCode).toBe(204);
  await take(ahmed.caller, id, "send_to_manager", { recommendedCode: "C" });
  await take(mohammed.caller, id, "revise_c", { answers: { ...VERIFIED, remarks: "Seal the formwork" } });
  return (await snagList(hafiz.caller)).items.filter((s) => s.raisedFrom?.workItemId === id).map((s) => s.id).sort();
}

const revise = async (id: string) => (await ok(hafiz.caller.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: crypto.randomUUID() }), 201)).json().id as string;

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "RFR" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const created = await post("checklist-templates", { name: bilingual("Slab pour"), tradeId: electrical, items });
  const list: ChecklistTemplates = (await ok(c1.caller.get(`/v1/projects/${projectId}/checklist-templates`), 200)).json();
  template = list.templates.find((t) => t.id === created)!.versionId;
  const c1Participant = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  const participant = async (company: Company, role: "consultant" | "contractor") => {
    const id = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
    return id;
  };
  await ok(c1.caller.request("PUT", `/v1/participants/${c1Participant}/visibility`, { trade: all, location: all }));
  const k1Participant = await participant(k1, "consultant");
  const c2Participant = await participant(c2, "contractor");
  hafiz = await memberOnProject(api, c1, c1Participant, ["engineer"], { name: "Hafiz Hamdan" });
  ali = await memberOnProject(api, c1, c1Participant, ["project_manager"], { name: "Ali Sonour" });
  ahmed = await memberOnProject(api, k1, k1Participant, ["engineer"], { name: "Ahmed bin Said" });
  mohammed = await memberOnProject(api, k1, k1Participant, ["manager"], { name: "Mohammed Al Shamsi" });
  yousef = await memberOnProject(api, c2, c2Participant, ["engineer"], { name: "Yousef Karim" });
});

// RP-1119-1: a WIR re-inspected twice (Rev 0, Rev 1, Rev 2), each ending with Code C and raising its own
// two Snags. The Snag List filtered by each Revision's number lists exactly that Revision's Snags.
describe("RP-1119-1: the Snag List filters by a Revision's Document Number, at every Revision (seam 1)", () => {
  const chain: { id: string; number: string; snags: string[] }[] = [];
  const named = new Map<string, string>();
  const name = (m: { id: string }) => named.get(m.id) ?? m.id;

  beforeAll(async () => {
    let id = await newWir("Slab pour");
    for (let rev = 0; rev <= 2; rev++) {
      if (rev > 0) id = await revise(id);
      const snags = await codeC(id);
      chain.push({ id, number: (await detail(hafiz.caller, id)).documentNumber!, snags });
    }
    for (const [m, label] of [[hafiz, "Hafiz (C1)"], [ali, "Ali (C1)"], [mohammed, "Mohammed (K1)"], [yousef, "Yousef (C2)"]] as const) named.set(m.id, label);
  });

  it("the chain is numbered Rev 0, \" Rev 1\" and \" Rev 2\", each with its own two Snags", () => {
    expect(chain.map((r) => r.number)).toEqual([chain[0]!.number, `${chain[0]!.number} Rev 1`, `${chain[0]!.number} Rev 2`]);
    expect(chain.map((r) => r.snags.length)).toEqual([2, 2, 2]); // not hidden-from: setup, the raiser's own Snags
  });

  it("for C1 and K1, each Revision's number lists exactly its own two Snags, and counts them", async () => {
    for (const reader of [hafiz, ali, mohammed]) {
      for (const r of chain) {
        const list = await snagList(reader.caller, r.number);
        expect(ids(list), `${name(reader)}, ${r.number}`).toEqual(r.snags);
        expect(counted(list), `${name(reader)}, ${r.number}`).toBe(2);
      }
    }
  });

  it("offers each Revision's number in the Raised from filter, as it filters by it", async () => {
    const offered = (await snagList(hafiz.caller)).filters.raisedFrom?.map((s) => s.documentNumber);
    expect(offered).toEqual(expect.arrayContaining(chain.map((r) => r.number)));
  });

  it("only narrows: C2 sees none of C1's Snags, and finds none by any of the chain's numbers, by row or by count (V3)", async () => {
    /** What the filtered list tells `m`, as rows keyed by id: each row, and each Stage and Type that counts one. */
    const told = async (m: { caller: Caller }, number: string) => {
      const list = await snagList(m.caller, number);
      return [
        ...list.items.map((i) => ({ id: i.id })),
        ...list.stages.filter((s) => s.count > 0).map((s) => ({ id: `stage:${s.key}` })),
        ...(list.typeCounts ?? []).map((t) => ({ id: `type:${t.code}` })),
      ];
    };
    // C2 reads through the same filter what is its own: a Snag Yousef raises by hand.
    const own = (
      await ok(yousef.caller.post(`/v1/projects/${projectId}/work-items`, { type: "SNG", title: "Cable tray cover missing", answers: { description: "Level 2 riser", trade: electrical, location: buildingA } }), 201)
    ).json().id as string;
    await take(yousef.caller, own, "raise");
    expect(ids(await snagList(yousef.caller, "manual"))).toContain(own);
    for (const r of chain) {
      const stages = (await snagList(hafiz.caller, r.number)).stages.filter((s) => s.count > 0).map((s) => `stage:${s.key}`);
      for (const target of [...r.snags, ...stages, "type:SNG"])
        await expectHiddenFrom({ read: (m) => told(m, r.number), target, seenBy: hafiz, hiddenFrom: yousef, name, label: `${target} of ${r.number}` });
    }
    // Nor does C2 get the chain's numbers offered as filter values, which Hafiz does.
    const offered = async (m: { caller: Caller }) => ((await snagList(m.caller)).filters.raisedFrom ?? []).map((s) => ({ id: s.documentNumber }));
    for (const r of chain) await expectHiddenFrom({ read: offered, target: r.number, seenBy: hafiz, hiddenFrom: yousef, name, label: `the Raised from value ${r.number}` });
  });

  it("a Revision number nobody issued lists nothing", async () => {
    const list = await snagList(hafiz.caller, `${chain[0]!.number} Rev 9`);
    expect(list.items).toEqual([]); // not hidden-from: no item has this number, for anyone
    expect(counted(list)).toBe(0);
  });
});
