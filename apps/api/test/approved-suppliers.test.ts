// Seam 1: the Approved Supplier List (RP-592, V10; scenario RP-592-1). A Project
// Admin adds suppliers per Trade in Project Settings and withdraws them; every
// Project Member of every Participant lists their names, Trade, Scope and
// status, never what put them there. Anyone else trying to change it gets a
// 404 that names nothing, as the other settings commands do.
import { randomUUID } from "node:crypto";
import type { ApprovedSupplier } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller, type InvitedMember, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
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
    for (const caller of [host.caller, hostMember.caller, engineer.caller]) {
      expect((await listSuppliers(caller)).map((s) => s.id)).not.toContain(otherSupplier);
      await expectHidden(caller.get(`/v1/projects/${projectB}/approved-suppliers`));
    }
    await expectHidden(withdraw(host.caller, otherSupplier));
    // An Authorized Person who isn't a Project Member reads nothing of it (layer 2).
    await expectHidden(consultant.caller.get(`/v1/projects/${projectId}/approved-suppliers`));
    await expectHidden(other.caller.get(`/v1/projects/${projectId}/approved-suppliers`));
    await expectHidden(host.caller.get(`/v1/projects/${randomUUID()}/approved-suppliers`));
  });
});
