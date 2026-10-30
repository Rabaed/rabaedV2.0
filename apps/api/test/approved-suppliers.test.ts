// Seam 1: the Approved Supplier List (RP-592, V10; scenario RP-592-1). A Project
// Admin adds suppliers per Trade in Project Settings and withdraws them; every
// Project Member of every Participant lists their names, Trade, Scope and
// status, never what put them there. Anyone else trying to change it gets a
// 404 that names nothing, as the other settings commands do.
// Scenarios RP-594-1 and RP-598-2 (seam 2: packages/db/test/sar-adds-supplier-rls.test.ts):
// a SAR closed at Code A adds its supplier, which every Participant lists and a MAR names,
// and nothing leads from the list or the MAR to the SAR.
import { randomUUID } from "node:crypto";
import type { ApprovedSupplier } from "@rabaed/domain";
import { expectHiddenFrom } from "@rabaed/db/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, readById, uploadDocument, type Caller, type InvitedMember, type OnboardedCompany } from "./support/harness.ts";
import { all, buildTower, detail, ok, projectMember, take, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

type Company = { company: OnboardedCompany; caller: Caller };

let host: Company; // Its Authorized Person created the Project and is its Project Admin.
let hostMember: { member: InvitedMember; caller: Caller }; // On the Project, not a Project Admin.
let consultant: Company; // Its Authorized Person is not on the Project.
let engineer: { member: InvitedMember; caller: Caller }; // A consultant engineer on the Project.
let other: Company; // Admin of Project B, which has nothing to do with this one.
let projectId = "";
let projectB = "";
const trade = { electrical: "", mechanical: "" };
let lighting = "";

const bilingual = (text: string) => ({ en: text, ar: `${text} ع` });

async function created(res: Promise<{ statusCode: number; json(): { id: string }; body: string }>) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id;
}

const addSupplier = (by: Caller, tradeId: string, name: string, scopeId: string | null = null, project = projectId) =>
  by.post(`/v1/projects/${project}/approved-suppliers`, { tradeId, scopeId, name: bilingual(name) });

const withdraw = (by: Caller, supplierId: string) => by.post(`/v1/approved-suppliers/${supplierId}/withdraw`, {});

const listSuppliers = async (by: Caller, query = "", project = projectId): Promise<ApprovedSupplier[]> => {
  const res = await by.get(`/v1/projects/${project}/approved-suppliers${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().suppliers;
};

beforeAll(async () => {
  host = await api.projectCreator();
  hostMember = await api.member(host.caller);
  consultant = await api.authorizedPerson();
  engineer = await api.member(consultant.caller);
  other = await api.projectCreator();
  projectId = (await api.createProject(host.caller)).id;
  projectB = (await api.createProject(other.caller)).id;
  const consultantParticipantId = await api.addParticipant(host.caller, projectId, consultant.company, "consultant");
  const participants = (await host.caller.get(`/v1/projects/${projectId}/participants`)).json().participants;
  const hostParticipantId = participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await api.addProjectMember(host.caller, hostParticipantId, hostMember.member.id);
  await api.addProjectMember(consultant.caller, consultantParticipantId, engineer.member.id);
  trade.electrical = await created(host.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") }));
  trade.mechanical = await created(host.caller.post(`/v1/projects/${projectId}/trades`, { code: "ME", name: bilingual("Mechanical") }));
  lighting = await created(host.caller.post(`/v1/projects/${projectId}/scopes`, { tradeId: trade.electrical, name: bilingual("Lighting") }));
});

describe("The Approved Supplier List (RP-592-1)", () => {
  let najd = "";
  let rimal = "";

  beforeAll(async () => {
    rimal = await created(addSupplier(host.caller, trade.mechanical, "Al-Rimal Building Materials"));
    najd = await created(addSupplier(host.caller, trade.electrical, "Najd Electrical Supplies", lighting));
  });

  it("is listed to every Project Member of every Participant, by Trade, with no word of what put a supplier there", async () => {
    for (const caller of [host.caller, hostMember.caller, engineer.caller]) {
      const res = await caller.get(`/v1/projects/${projectId}/approved-suppliers`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({
        suppliers: [
          { id: najd, name: bilingual("Najd Electrical Supplies"), tradeId: trade.electrical, scopeId: lighting, status: "approved" },
          { id: rimal, name: bilingual("Al-Rimal Building Materials"), tradeId: trade.mechanical, scopeId: null, status: "approved" },
        ],
      });
    }
  });

  it("filters by Trade and by status", async () => {
    const gone = await created(addSupplier(host.caller, trade.electrical, "Old Cables Co"));
    const res = await withdraw(host.caller, gone);
    expect(res.statusCode, res.body).toBe(204);
    expect((await listSuppliers(engineer.caller, `?tradeId=${trade.electrical}`)).map((s) => s.id)).toEqual([najd, gone]);
    expect((await listSuppliers(engineer.caller, `?tradeId=${trade.electrical}&status=approved`)).map((s) => s.id)).toEqual([najd]);
    expect(await listSuppliers(engineer.caller, "?status=withdrawn")).toEqual([
      { id: gone, name: bilingual("Old Cables Co"), tradeId: trade.electrical, scopeId: null, status: "withdrawn" },
    ]);
    expect((await engineer.caller.get(`/v1/projects/${projectId}/approved-suppliers?status=gone`)).statusCode).toBe(400);
  });

  it("refuses a Trade or Scope that isn't the Project's, and a supplier the Trade already lists", async () => {
    const wrongTrade = await addSupplier(host.caller, randomUUID(), "Nowhere");
    expect({ status: wrongTrade.statusCode, body: wrongTrade.json() }).toEqual({ status: 422, body: { error: "trade_not_found" } });
    const wrongScope = await addSupplier(host.caller, trade.mechanical, "Wrong Scope", lighting);
    expect({ status: wrongScope.statusCode, body: wrongScope.json() }).toEqual({ status: 422, body: { error: "scope_not_found" } });
    const again = await addSupplier(host.caller, trade.electrical, "Najd Electrical Supplies");
    expect({ status: again.statusCode, body: again.json() }).toEqual({ status: 409, body: { error: "supplier_exists" } });
  });

  it("needs a name in English and Arabic", async () => {
    const res = await host.caller.post(`/v1/projects/${projectId}/approved-suppliers`, { tradeId: trade.electrical, name: { en: "Only English" } });
    expect(res.statusCode).toBe(400);
  });

  it("is changed only by a Project Admin: anyone else gets a 404 that names nothing", async () => {
    for (const [who, caller] of [
      ["host member (not a Project Admin)", hostMember.caller],
      ["consultant's Authorized Person", consultant.caller],
      ["consultant engineer", engineer.caller],
      ["another Project's Project Admin", other.caller],
    ] as const) {
      await expectHidden(addSupplier(caller, trade.electrical, "Sneaky"), `${who} adds`);
      for (const id of [najd, randomUUID()]) await expectHidden(withdraw(caller, id), `${who} withdraws ${id}`);
    }
    await expectHidden(host.caller.post("/v1/approved-suppliers/not-an-id/withdraw", {}));
    expect((await listSuppliers(host.caller)).find((s) => s.id === najd)?.status).toBe("approved");
  });

  it("of another Project is never listed or reachable", async () => {
    const otherTrade = await created(other.caller.post(`/v1/projects/${projectB}/trades`, { code: "EL", name: bilingual("Electrical") }));
    const otherSupplier = await created(addSupplier(other.caller, otherTrade, "Gulf Cables", null, projectB));
    // Every list the caller may read, this Project's and Project B's: Project B's Admin reads the supplier
    // first, so this Project's Members listing neither it nor Project B's list is no empty read (RP-1095).
    const everyList = async (by: Caller) => [...(await suppliersOf(projectId)(by)), ...(await suppliersOf(projectB)(by))];
    await expectHiddenFrom({ read: everyList, target: otherSupplier, seenBy: other.caller, hiddenFrom: [host.caller, hostMember.caller, engineer.caller], name: whoIs });
    await expectHidden(withdraw(host.caller, otherSupplier));
    expect((await suppliersOf(projectB)(other.caller)).find((s) => s.id === otherSupplier)?.status).toBe("approved");
    // An Authorized Person who isn't a Project Member reads nothing of it (layer 2), where its Members read it.
    await expectHiddenFrom({ read: suppliersOf(projectId), target: najd, seenBy: [host.caller, engineer.caller], hiddenFrom: [consultant.caller, other.caller], name: whoIs });
    await expectHidden(host.caller.get(`/v1/projects/${randomUUID()}/approved-suppliers`));
  });
});

/** Project `project`'s suppliers as `by` lists them, or none for the plain 404: for expectHiddenFrom. */
const suppliersOf = (project: string) => async (by: Caller) =>
  (await readById<{ suppliers: ApprovedSupplier[] }>(`/v1/projects/${project}/approved-suppliers`)(by)).flatMap((r) => r.suppliers);

const whoIs = (by: Caller) =>
  by === host.caller
    ? "host's Project Admin"
    : by === hostMember.caller
      ? "host member"
      : by === engineer.caller
        ? "consultant engineer"
        : by === consultant.caller
          ? "consultant's Authorized Person"
          : by === other.caller
            ? "Project B's Admin"
            : (sarPeople.get(by) ?? "someone");
const sarPeople = new Map<Caller, string>();

describe("a SAR closed at Code A adds its supplier (RP-594-1, RP-598-2)", () => {
  let at: Tower;
  let k1Engineer: Caller;
  let c2: Company; // Another Contractor of the Project; its Authorized Person is not on it.
  let c2Engineer: Caller;

  /** C1's SAR for `name`, with its company profile, Submitted and closed by K1's manager with `closing`. */
  async function closedSar(name: { en: string; ar: string }, closing: "approve_a" | "revise_c"): Promise<string> {
    const res = await ok(
      at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
        type: "SAR",
        title: name.en,
        answers: {
          supplier_name_en: name.en,
          supplier_name_ar: name.ar,
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
    const id = res.json().id as string;
    await uploadDocument(at.c1Engineer, id, { fieldKey: "company_profile", fileName: "profile.pdf", contentType: "application/pdf", body: "%PDF-1.7 a profile (test)" });
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit");
    const verification = { sample_checked: true, matches_specification: true };
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Engineer, id, "send_to_manager", { answers: verification, recommendedCode: closing === "approve_a" ? "A" : "C" });
    await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(at.k1Manager, id, closing, { answers: { ...verification, remarks: "Checked" } });
    return id;
  }

  /** The Electrical suppliers named `en`, as C1's engineer lists them. */
  const named = async (en: string) =>
    (await suppliersOf(at.projectId)(at.c1Engineer)).filter((s) => s.tradeId === at.electrical && s.name.en.trim().toLowerCase() === en.toLowerCase()); // not hidden-from: picks the rows to compare by id

  beforeAll(async () => {
    const c1 = await api.projectCreator();
    const k1 = await api.authorizedPerson();
    at = await buildTower(api, { c1, k1 }, "SUP");
    k1Engineer = await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
    c2 = await api.authorizedPerson();
    const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
    await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
    c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
    for (const [by, label] of [
      [at.c1Engineer, "C1 engineer"],
      [at.c1Pm, "C1 PM"],
      [k1Engineer, "K1 engineer"],
      [at.k1Manager, "K1 manager"],
      [c2Engineer, "C2 engineer"],
      [c2.caller, "C2's Authorized Person"],
    ] as const) {
      sarPeople.set(by, label);
    }
  });

  it("RP-594-1: Najd Cables is listed for Electrical, approved, to every Participant's Members, with nothing of the SAR", async () => {
    const sar = await closedSar({ en: "Najd Cables", ar: "كابلات نجد" }, "approve_a");
    const [najdCables] = await named("Najd Cables");
    const row = { id: najdCables!.id, name: { en: "Najd Cables", ar: "كابلات نجد" }, tradeId: at.electrical, scopeId: null, status: "approved" };
    for (const by of [at.c1Engineer, k1Engineer, at.k1Manager, c2Engineer]) {
      // The row as the list gives it: no source, SAR, person or time.
      expect((await suppliersOf(at.projectId)(by)).find((s) => s.id === row.id), whoIs(by)).toEqual(row);
    }
    // C2 reads no SAR, no event of it and no Link of it, where C1 and K1 read each.
    for (const path of [`/v1/work-items/${sar}`, `/v1/work-items/${sar}/history`, `/v1/work-items/${sar}/links`]) {
      await expectHiddenFrom({
        read: (by: Caller) => readById(path)(by).then((rows) => rows.map(() => ({ id: sar }))),
        target: sar,
        seenBy: [at.c1Engineer, k1Engineer],
        hiddenFrom: [c2Engineer, c2.caller],
        name: whoIs,
        label: path,
      });
    }
  });

  it("RP-594-1: Code C adds nothing, and a second SAR for the same supplier, in other letter case and with outer spaces, adds no second entry", async () => {
    await closedSar({ en: "Rejected Wires", ar: "أسلاك مرفوضة" }, "revise_c");
    expect(await named("Rejected Wires")).toEqual([]); // not hidden-from: C1's own list, Code C added no row
    const before = (await named("Najd Cables")).map((s) => s.id);
    await closedSar({ en: "  najd CABLES ", ar: "كابلات نجد" }, "approve_a");
    expect((await named("Najd Cables")).map((s) => s.id)).toEqual(before);
  });

  it("RP-598-2: C2's MAR names Shared Cables by its id, read back as stored, and nothing in it leads to the SAR", async () => {
    const sar = await closedSar({ en: "Shared Cables", ar: "كابلات مشتركة" }, "approve_a");
    const [shared] = await named("Shared Cables");
    const created = await ok(
      c2Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
        type: "MAR",
        title: "Cable drums",
        answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: at.electrical, location: at.buildingA, supplier: shared!.id },
      }),
      201,
    );
    const mar = created.json().id as string;
    const read = await detail(c2Engineer, mar);
    expect(read.answers.supplier).toBe(shared!.id);
    // The list names the id "Shared Cables" for C2, as for C1.
    expect((await suppliersOf(at.projectId)(c2Engineer)).find((s) => s.id === shared!.id)).toEqual({
      id: shared!.id,
      name: { en: "Shared Cables", ar: "كابلات مشتركة" },
      tradeId: at.electrical,
      scopeId: null,
      status: "approved",
    });
    // Nothing C2 reads of its MAR names the SAR, which C2 can't read (V1, V10).
    expect(JSON.stringify(read).includes(sar), "C2's MAR names the SAR").toBe(false);
    await expectHiddenFrom({
      read: (by: Caller) => readById(`/v1/work-items/${sar}`)(by),
      target: sar,
      seenBy: [at.c1Engineer, k1Engineer],
      hiddenFrom: c2Engineer,
      name: whoIs,
      label: "the SAR",
    });
  });
});
