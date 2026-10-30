// Seam 1 for the follow-up counts of a Revision's previous item (RP-653, INSP-6; spec RP-649; ADR 0025;
// workflow-engine.md §6; visibility.md "Lists and counts", scenario RP-653-1).
//
// A WIR that ends with Code C is re-inspected as a Revision (WIR-007 Rev 1). The Revision's page reads
// the follow-ups of the item before it in its chain, per Type, as its Rev 0 left them: "Snags from Rev 0:
// 1 closed / 1 open". Open Snags never block a code: Rev 1 is issued Code A with one still open. The
// counts follow what the viewer sees (RP-653-1, seam 2: packages/db/test/revision-follow-ups-rls.test.ts).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { ChecklistTemplates, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, memberOnProject, ok, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const FIELD = "inspection_checklist";
const VERIFIED = { sample_checked: true, matches_specification: true };
const items = [
  { key: "formwork", text: bilingual("Formwork tight"), comment: "off", photo: "optional" },
  { key: "cover", text: bilingual("Rebar cover"), comment: "off", photo: "optional" },
];
const TWO_FAILS = { formwork: { answer: "fail" }, cover: { answer: "fail" } };
const ALL_PASS = { formwork: { answer: "pass" }, cover: { answer: "pass" } };

let projectId = "";
let electrical = "";
let buildingA = "";
let template = "";
let hafiz: { id: string; caller: Caller }; // C1 Contractor Engineer: raises the WIR and its Revision.
let ali: { id: string; caller: Caller }; // C1's only Project Manager: Submits, holds C1's Step Pool.
let ahmed: { id: string; caller: Caller }; // K1 Consultant Engineer.
let mohammed: { id: string; caller: Caller }; // K1's only Manager: issues the code.
let yousef: { id: string; caller: Caller }; // C2, another Contractor covering all of Electrical.

const answer = (by: Caller, id: string, answers: object) => by.request("PUT", `/v1/work-items/${id}/reply-checklists/${FIELD}`, { answers });
const snagList = async (by: Caller, query = ""): Promise<WorkItemList["items"]> =>
  (await ok(by.get(`/v1/projects/${projectId}/modules/snag_list/work-items${query}`), 200)).json().items;
/** The Snags `by` sees in the Snag List raised from the item with Document Number `number`. */
const snagsFrom = async (by: Caller, number: string) => (await snagList(by, `?raisedFrom=${encodeURIComponent(number)}`)).filter((i) => i.type.code === "SNG");
const previousSnags = async (by: Caller, id: string) => {
  const previous = (await detail(by, id)).previousRaisedItems;
  const line = previous?.items.find((r) => r.type.code === "SNG");
  return previous && { revisionNo: previous.revisionNo, documentNumber: previous.documentNumber, snags: line ? { open: line.open, closed: line.closed } : null };
};

/** A WIR raised by Hafiz, Submitted by Ali, answered by Ahmed with `answers` and Sent to Mohammed, with `code` recommended. */
async function atManager(id: string, answers: object, code: string) {
  await take(hafiz.caller, id, "send_for_review");
  await take(ali.caller, id, "submit", { answers: { cover_note: "Ready on site from 09:00" } });
  expect((await answer(ahmed.caller, id, answers)).statusCode).toBe(204);
  await take(ahmed.caller, id, "send_to_manager", { recommendedCode: code });
}

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

/** A WIR that ended with Code C and raised two Snags, one of them closed; returns the WIR, then its Revision 1 as a Draft. */
async function codeCWithTwoSnags(title: string): Promise<{ wir: string; closed: string; open: string; revision: string }> {
  const wir = await newWir(title);
  await atManager(wir, TWO_FAILS, "C");
  await take(mohammed.caller, wir, "revise_c", { answers: { ...VERIFIED, remarks: "Seal the formwork" } });
  const number = (await detail(mohammed.caller, wir)).documentNumber!;
  const [closed, open] = (await snagsFrom(hafiz.caller, number)).map((s) => s.id);
  await ok(ali.caller.post(`/v1/work-items/${closed}/pick-up`));
  await take(ali.caller, closed!, "resolve", { answers: { resolution_note: "Sealed" } });
  await ok(mohammed.caller.post(`/v1/work-items/${closed}/pick-up`));
  await take(mohammed.caller, closed!, "close");
  const revision = (await ok(hafiz.caller.post(`/v1/work-items/${wir}/revisions`, { idempotencyKey: crypto.randomUUID() }), 201)).json().id as string;
  return { wir, closed: closed!, open: open!, revision };
}

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "RFC" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const created = await post("checklist-templates", { name: bilingual("Slab pour"), tradeId: electrical, items });
  const list: ChecklistTemplates = (await ok(c1.caller.get(`/v1/projects/${projectId}/checklist-templates`), 200)).json();
  template = list.templates.find((t) => t.id === created)!.versionId;
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  const participant = async (company: Company, role: "consultant" | "contractor") => {
    const id = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
    return id;
  };
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await participant(k1, "consultant");
  const c2ParticipantId = await participant(c2, "contractor");
  hafiz = await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" });
  ali = await memberOnProject(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  ahmed = await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  mohammed = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Mohammed Al Shamsi" });
  yousef = await memberOnProject(api, c2, c2ParticipantId, ["engineer"], { name: "Yousef Karim" });
});

describe("a Revision shows the follow-ups its previous item left (seam 1)", () => {
  let chain: Awaited<ReturnType<typeof codeCWithTwoSnags>>;

  beforeAll(async () => {
    chain = await codeCWithTwoSnags("Slab pour");
  });

  it("Rev 1 reads \"Snags from Rev 0: 1 closed / 1 open\", with Rev 0's Document Number to filter the Snag List by", async () => {
    const rev0 = await detail(hafiz.caller, chain.wir);
    expect(await previousSnags(hafiz.caller, chain.revision)).toEqual({ revisionNo: 0, documentNumber: rev0.documentNumber, snags: { open: 1, closed: 1 } });
    // The Snag List filtered to that number is exactly the two Snags counted.
    expect((await snagsFrom(hafiz.caller, rev0.documentNumber!)).map((s) => s.id).sort()).toEqual([chain.closed, chain.open].sort());
  });

  it("Rev 0 itself, which has no previous item, reads none; its own line is unchanged", async () => {
    const rev0 = await detail(hafiz.caller, chain.wir);
    expect(rev0.previousRaisedItems).toBeNull();
    expect(rev0.raisedItems).toMatchObject([{ type: { code: "SNG" }, open: 1, closed: 1 }]);
  });

  it("follows the Snags as they close", async () => {
    // A third look, once the last one is closed too: both counted closed.
    const fresh = await codeCWithTwoSnags("Slab pour, second");
    await ok(ali.caller.post(`/v1/work-items/${fresh.open}/pick-up`));
    await take(ali.caller, fresh.open, "resolve", { answers: { resolution_note: "Sealed" } });
    await ok(mohammed.caller.post(`/v1/work-items/${fresh.open}/pick-up`));
    await take(mohammed.caller, fresh.open, "close");
    expect((await previousSnags(hafiz.caller, fresh.revision))?.snags).toEqual({ open: 0, closed: 2 });
  });

  it("an open Snag never blocks the code: Rev 1 is issued Code A with one still open", async () => {
    await atManager(chain.revision, ALL_PASS, "A");
    await take(mohammed.caller, chain.revision, "approve_a", { answers: { ...VERIFIED, remarks: "Approved" } });
    const rev1 = await detail(mohammed.caller, chain.revision);
    expect(rev1.outcome).toBe("A");
    expect((await previousSnags(mohammed.caller, chain.revision))?.snags).toEqual({ open: 1, closed: 1 });
  });

  it("C2, who sees neither the WIR nor its Revision, reads nothing", async () => {
    await expectHidden(yousef.caller.get(`/v1/work-items/${chain.revision}`));
  });
});

// RP-655-1 (the Screen Board's "Snags from Rev 0", one row each): Rev 1 lists Rev 0's Snags by number,
// Subject and Open / Closed, only those the viewer sees (seam 2: packages/db/test/revision-follow-ups-rls.test.ts).
describe("a Revision lists each follow-up its previous item left (seam 1)", () => {
  const rows = async (by: Caller, id: string) =>
    ((await detail(by, id)).previousRaisedItems?.raised ?? []).map((r) => ({ id: r.id, type: r.typeCode, closed: r.closed, title: r.title, documentNumber: r.documentNumber }));

  it("Rev 1 lists Rev 0's two Snags, one closed and one open, with their numbers and Subjects; the Consultant reads the same", async () => {
    const chain = await codeCWithTwoSnags("Wall chases");
    const snags = await snagList(hafiz.caller, `?raisedFrom=${encodeURIComponent((await detail(hafiz.caller, chain.wir)).documentNumber!)}`);
    // Submitted, so the Consultant sees Rev 1 too (a Draft is the raiser's alone).
    await take(hafiz.caller, chain.revision, "send_for_review");
    await take(ali.caller, chain.revision, "submit", { answers: { cover_note: "Ready again" } });
    for (const reader of [hafiz.caller, mohammed.caller]) {
      const listed = await rows(reader, chain.revision);
      expect(listed.map((r) => r.id).sort()).toEqual([chain.closed, chain.open].sort());
      expect(listed.find((r) => r.id === chain.closed)).toMatchObject({ type: "SNG", closed: true });
      expect(listed.find((r) => r.id === chain.open)).toMatchObject({ type: "SNG", closed: false });
      for (const r of listed) expect(r).toMatchObject({ title: snags.find((s) => s.id === r.id)!.title, documentNumber: snags.find((s) => s.id === r.id)!.documentNumber });
    }
  });

  it("lists only Rev 0's, never the Revision's own: the same Snags as the Snag List filtered to Rev 0's number", async () => {
    const chain = await codeCWithTwoSnags("Wall chases, second");
    // Rev 1 is inspected and fails too: its own two Snags are raised from it.
    await atManager(chain.revision, TWO_FAILS, "C");
    await take(mohammed.caller, chain.revision, "revise_c", { answers: { ...VERIFIED, remarks: "Still open" } });
    const listed = (await rows(hafiz.caller, chain.revision)).map((r) => r.id).sort();
    expect(listed).toEqual([chain.closed, chain.open].sort());
    // The Snag List by Rev 0's number finds exactly these. Rev 1's own two (its number, " Rev 1", is no filter value) are not listed.
    const rev0 = (await detail(hafiz.caller, chain.wir)).documentNumber!;
    expect((await snagsFrom(hafiz.caller, rev0)).map((s) => s.id).sort()).toEqual(listed);
    const own = (await snagList(hafiz.caller)).filter((s) => s.raisedFrom?.workItemId === chain.revision).map((s) => s.id);
    expect(own).toHaveLength(2);
    expect(own.some((id) => listed.includes(id))).toBe(false);
  });

  it("Rev 0 itself lists none", async () => {
    const chain = await codeCWithTwoSnags("Wall chases, third");
    expect((await detail(hafiz.caller, chain.wir)).previousRaisedItems).toBeNull();
  });
});
