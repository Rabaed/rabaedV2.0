// Seam 1 for "an approved supplier links to the SAR that approved it" (RP-1306; visibility.md V10, amended
// 2026-11-16; scenarios RP-1306-1 to RP-1306-5): `GET /v1/projects/:projectId/approved-suppliers` gives an
// entry's `approval` (the SAR's id, Document Number and Subject) only to a Member who sees that SAR now, and
// null to everyone else, exactly as for an entry a Project Admin added by hand. Narrowing a Member's
// Visibility takes it away at the next read. A MAR choosing the supplier holds no Link to the SAR and names
// no SAR in what its reader gets. Seam 2: packages/db/test/approved-supplier-approvals-rls.test.ts.
import { expectHiddenFrom } from "@rabaed/db/test-support";
import type { ApprovedSupplier } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, uploadDocument, type Caller } from "./support/harness.ts";
import { all, buildTower, detail, memberOnProject, ok, only, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let c1: Company;
let c2: Company; // Another Contractor of the Project: never sees C1's SARs (V1).
let k1Engineer: Caller;
let c1Viewer: { id: string; caller: Caller }; // A C1 engineer whose Visibility RP-1306-3 narrows.
let c2Engineer: Caller;
let c2Pm: Caller;

const names = new Map<Caller, string>();
const whoIs = (by: Caller) => names.get(by) ?? "someone";

/** The Project's suppliers as `by` lists them. */
const suppliers = async (by: Caller): Promise<ApprovedSupplier[]> =>
  (await readById<{ suppliers: ApprovedSupplier[] }>(`/v1/projects/${at.projectId}/approved-suppliers`)(by)).flatMap((r) => r.suppliers);
/** Supplier `id`'s entry as `by` lists it. */
const entry = async (by: Caller, id: string) => (await suppliers(by)).find((s) => s.id === id);
/** The SARs `by` reads as approvals, for expectHiddenFrom. */
const approvalSars = async (by: Caller) => (await suppliers(by)).flatMap((s) => (s.approval ? [{ id: s.approval.workItemId }] : []));

/** C1's SAR for `en`, Submitted and closed by K1's manager at Code A; returns the SAR and the supplier it added. */
async function approvedBySar(en: string, ar: string): Promise<{ sar: string; supplier: string }> {
  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: "SAR",
      title: `${en} approval`,
      answers: {
        supplier_name_en: en,
        supplier_name_ar: ar,
        commercial_registration_number: "1010123456",
        country_of_origin: "Saudi Arabia",
        proposed_supply: "Cables and cable trays",
        past_projects: [{ project_name: "Riyadh Metro Station 4", year: 2022 }],
        trade: at.electrical,
        location: at.buildingA,
      },
    }),
    201,
  );
  const sar = res.json().id as string;
  await uploadDocument(at.c1Engineer, sar, { fieldKey: "company_profile", fileName: "profile.pdf", contentType: "application/pdf", body: "%PDF-1.7 a profile (test)" });
  await take(at.c1Engineer, sar, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${sar}/pick-up`));
  await take(at.c1Pm, sar, "submit");
  const verification = { sample_checked: true, matches_specification: true };
  await ok(k1Engineer.post(`/v1/work-items/${sar}/pick-up`));
  await take(k1Engineer, sar, "send_to_manager", { answers: verification, recommendedCode: "A" });
  await ok(at.k1Manager.post(`/v1/work-items/${sar}/pick-up`));
  await take(at.k1Manager, sar, "approve_a", { answers: { ...verification, remarks: "Checked" } });
  // The entry it added, picked by its name among C1's reads, then compared by id.
  const added = (await suppliers(at.c1Engineer)).find((s) => s.name.en === en); // not hidden-from: picks the row to compare by id
  expect(added, `${en} on the list`).toBeDefined(); // not hidden-from: the SAR's entry must exist
  return { sar, supplier: added!.id };
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SAL");
  k1Engineer = await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
  c1Viewer = await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"]);
  c2 = await api.authorizedPerson();
  const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  c2Pm = await projectMember(api, c2, c2ParticipantId, ["project_manager"]);
  for (const [by, label] of [
    [at.c1Engineer, "C1 engineer"],
    [at.c1Pm, "C1 PM"],
    [c1Viewer.caller, "C1 viewer"],
    [k1Engineer, "K1 engineer"],
    [at.k1Manager, "K1 manager"],
    [c2Engineer, "C2 engineer"],
    [c2Pm, "C2 PM"],
    [c2.caller, "C2's Authorized Person"],
  ] as const) {
    names.set(by, label);
  }
});

describe("scenario RP-1306-1: a Member who sees the SAR reads it as the supplier's approval", () => {
  it("C1, which raised it, and K1, which closed it, read the SAR's id, Document Number and Subject on the entry", async () => {
    const { sar, supplier } = await approvedBySar("Linked Cables", "كابلات مرتبطة");
    const { documentNumber, title } = await detail(at.c1Engineer, sar);
    expect(documentNumber).toMatch(/\S/);
    for (const by of [at.c1Engineer, at.c1Pm, c1Viewer.caller, k1Engineer, at.k1Manager]) {
      expect((await entry(by, supplier))?.approval, whoIs(by)).toEqual({ workItemId: sar, documentNumber, subject: title });
    }
  });
});

describe("scenario RP-1306-2: a viewer who can't see the SAR reads the entry exactly as one added by hand", () => {
  it("C2 reads `approval: null` for the SAR it can't see, the same shape as a hand-added entry, where C1 and K1 read the SAR", async () => {
    const { sar, supplier } = await approvedBySar("Hidden Approval Co", "شركة الاعتماد المخفي");
    await expectHiddenFrom({ read: approvalSars, target: sar, seenBy: [at.c1Engineer, k1Engineer], hiddenFrom: [c2Engineer, c2Pm], name: whoIs, label: "the SAR as an approval" });
    const byHand = (
      await ok(c1.caller.post(`/v1/projects/${at.projectId}/approved-suppliers`, { tradeId: at.electrical, scopeId: null, name: { en: "By Hand Supplies", ar: "توريدات يدوية" } }), 201)
    ).json().id as string;
    const seenByC2 = await entry(c2Engineer, supplier);
    expect(seenByC2).toEqual({ id: supplier, name: { en: "Hidden Approval Co", ar: "شركة الاعتماد المخفي" }, tradeId: at.electrical, scopeId: null, status: "approved", approval: null });
    // The hand-added entry reads the same to everyone, its adder included: the same keys, approval null.
    for (const by of [c1.caller, at.c1Engineer, k1Engineer, c2Engineer]) {
      const hand = await entry(by, byHand);
      expect(hand, whoIs(by)).toEqual({ id: byHand, name: { en: "By Hand Supplies", ar: "توريدات يدوية" }, tradeId: at.electrical, scopeId: null, status: "approved", approval: null });
      expect(Object.keys(hand!).sort()).toEqual(Object.keys(seenByC2!).sort());
    }
  });
});

describe("scenario RP-1306-3: narrowing a Member's Visibility takes the approval away at the next read", () => {
  it("C1's viewer reads the SAR, then not once their Trade Visibility leaves Electrical; given back, it returns", async () => {
    const { sar, supplier } = await approvedBySar("Narrowed Cables", "كابلات مضيقة");
    const visibility = (trade: typeof all) =>
      ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/members/${c1Viewer.id}/visibility`, { trade, location: all }));
    await expectHiddenFrom({ read: approvalSars, target: sar, seenBy: c1Viewer.caller, hiddenFrom: c2Engineer, name: whoIs, label: "before narrowing" });
    await visibility(only(at.mechanical));
    await expectHiddenFrom({ read: approvalSars, target: sar, seenBy: [at.c1Engineer, k1Engineer], hiddenFrom: c1Viewer.caller, name: whoIs, label: "after narrowing" });
    // The entry itself stays listed to them, by name, as to C2.
    expect((await entry(c1Viewer.caller, supplier))?.approval).toBeNull();
    await visibility(all);
    expect((await entry(c1Viewer.caller, supplier))?.approval?.workItemId).toBe(sar);
  });
});

describe("scenario RP-1306-4: the MAR's Links and what its reader gets carry no SAR", () => {
  it("C2's MAR choosing the supplier holds no Link to the SAR, and nothing C2 reads of it names the SAR", async () => {
    const { sar, supplier } = await approvedBySar("Record Cables", "كابلات السجل");
    const { documentNumber } = await detail(at.c1Engineer, sar);
    const created = await ok(
      c2Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
        type: "MAR",
        title: "Cable drums",
        answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: at.electrical, location: at.buildingA, supplier },
      }),
      201,
    );
    const mar = created.json().id as string;
    const read = await detail(c2Engineer, mar);
    expect(read.answers.supplier).toBe(supplier);
    const links = (await ok(c2Engineer.get(`/v1/work-items/${mar}/links`), 200)).json();
    expect(links.links).toEqual([]); // not hidden-from: the MAR's own Links, read as its raiser; choosing a supplier makes no Link
    for (const [what, body] of [["the MAR", read], ["its Links", links]] as const) {
      for (const text of [sar, documentNumber!]) expect(JSON.stringify(body).includes(text), `${what} names the SAR (${text})`).toBe(false);
    }
  });
});

describe("scenario RP-1306-5: the list still reads no source of an entry", () => {
  it("every entry, to every reader, holds only its name, Trade, Scope, status and `approval`: no source, person or time", async () => {
    await approvedBySar("Ungranted Source Co", "شركة المصدر");
    for (const by of [at.c1Engineer, k1Engineer, c2Engineer]) {
      const listed = await suppliers(by);
      expect(listed.length, whoIs(by)).toBeGreaterThan(0);
      for (const s of listed) expect(Object.keys(s).sort(), whoIs(by)).toEqual(["approval", "id", "name", "scopeId", "status", "tradeId"]);
    }
  });
});
