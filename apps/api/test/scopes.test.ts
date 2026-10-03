// Seam 1: Scopes and Sub-scopes (RP-263). A Project Admin defines them under
// the Project's Trades in Project Settings; every Project Member reads them; an
// Authorized Person who isn't a Project Member reads only those of the Trades
// their Participant covers (as V16). Anyone else trying to change them gets a
// 404 that names nothing. Scopes never grant or restrict access.
import { randomUUID } from "node:crypto";
import type { Scope } from "@rabaed/domain";
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
let consultantParticipantId = "";
const trade = { electrical: "", mechanical: "" };

const bilingual = (text: string) => ({ en: text, ar: `${text} ع` });

async function created(res: Promise<{ statusCode: number; json(): { id: string }; body: string }>) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id;
}

const addScope = (by: Caller, tradeId: string, name: string, parentId: string | null = null, project = projectId) =>
  by.post(`/v1/projects/${project}/scopes`, { tradeId, parentId, name: bilingual(name) });

const updateScope = (by: Caller, scopeId: string, change: { name?: { en: string; ar: string }; active?: boolean }) =>
  by.patch(`/v1/scopes/${scopeId}`, change);

const listScopes = async (by: Caller, project = projectId): Promise<Scope[]> => {
  const res = await by.get(`/v1/projects/${project}/scopes`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().scopes;
};

const ids = (scopes: Scope[]) => scopes.map((s) => s.id).sort();

beforeAll(async () => {
  host = await api.projectCreator();
  hostMember = await api.member(host.caller);
  consultant = await api.authorizedPerson();
  engineer = await api.member(consultant.caller);
  other = await api.projectCreator();
  projectId = (await api.createProject(host.caller)).id;
  projectB = (await api.createProject(other.caller)).id;
  consultantParticipantId = await api.addParticipant(host.caller, projectId, consultant.company, "consultant");
  const participants = (await host.caller.get(`/v1/projects/${projectId}/participants`)).json().participants;
  const hostParticipantId = participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await api.addProjectMember(host.caller, hostParticipantId, hostMember.member.id);
  await api.addProjectMember(consultant.caller, consultantParticipantId, engineer.member.id);
  trade.electrical = await created(host.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") }));
  trade.mechanical = await created(host.caller.post(`/v1/projects/${projectId}/trades`, { code: "ME", name: bilingual("Mechanical") }));
});

describe("Scopes and Sub-scopes", () => {
  let lighting = "";
  let indoor = "";
  let hvac = "";

  beforeAll(async () => {
    lighting = await created(addScope(host.caller, trade.electrical, "Lighting"));
    indoor = await created(addScope(host.caller, trade.electrical, "Indoor", lighting));
    hvac = await created(addScope(host.caller, trade.mechanical, "HVAC"));
  });

  it("are listed to every Project Member, under their Trade", async () => {
    for (const caller of [host.caller, hostMember.caller, engineer.caller]) {
      const scopes = await listScopes(caller);
      expect(scopes).toEqual([
        { id: lighting, tradeId: trade.electrical, parentId: null, name: bilingual("Lighting"), active: true },
        { id: indoor, tradeId: trade.electrical, parentId: lighting, name: bilingual("Indoor"), active: true },
        { id: hvac, tradeId: trade.mechanical, parentId: null, name: bilingual("HVAC"), active: true },
      ]);
    }
  });

  it("are renamed and deactivated by a Project Admin, and stay listed", async () => {
    const pumps = await created(addScope(host.caller, trade.mechanical, "Pumps"));
    const renamed = await updateScope(host.caller, pumps, { name: bilingual("Pumps and valves") });
    expect(renamed.statusCode, renamed.body).toBe(204);
    expect((await updateScope(host.caller, pumps, { active: false })).statusCode).toBe(204);
    const listed = (await listScopes(hostMember.caller)).find((s) => s.id === pumps);
    expect(listed).toMatchObject({ name: bilingual("Pumps and valves"), active: false });
    expect((await updateScope(host.caller, pumps, { active: true })).statusCode).toBe(204);
    expect((await listScopes(hostMember.caller)).find((s) => s.id === pumps)?.active).toBe(true);
  });

  it("reject a Trade or Scope that isn't the Project's, or a third level", async () => {
    const wrongTrade = await addScope(host.caller, randomUUID(), "Nowhere");
    expect({ status: wrongTrade.statusCode, body: wrongTrade.json() }).toEqual({ status: 422, body: { error: "trade_not_found" } });
    const tooDeep = await addScope(host.caller, trade.electrical, "Too deep", indoor);
    expect({ status: tooDeep.statusCode, body: tooDeep.json() }).toEqual({ status: 422, body: { error: "parent_not_found" } });
    expect((await addScope(host.caller, trade.mechanical, "Wrong Trade", lighting)).statusCode).toBe(422);
  });

  it("need a name in English and Arabic, and something to change", async () => {
    expect((await host.caller.post(`/v1/projects/${projectId}/scopes`, { tradeId: trade.electrical, name: { en: "Only English" } })).statusCode).toBe(400);
    expect((await updateScope(host.caller, lighting, {})).statusCode).toBe(400);
  });

  it("are changed only by a Project Admin: anyone else gets a 404 that names nothing", async () => {
    for (const [who, caller] of [
      ["host member (not a Project Admin)", hostMember.caller],
      ["consultant's Authorized Person", consultant.caller],
      ["consultant engineer", engineer.caller],
      ["another Project's Project Admin", other.caller],
    ] as const) {
      await expectHidden(addScope(caller, trade.electrical, "Sneaky"), `${who} adds`);
      await expectHidden(addScope(caller, trade.electrical, "Sneaky", lighting), `${who} adds a Sub-scope`);
      for (const scopeId of [lighting, indoor, randomUUID()]) {
        await expectHidden(updateScope(caller, scopeId, { name: bilingual("Sneaky") }), `${who} renames ${scopeId}`);
        await expectHidden(updateScope(caller, scopeId, { active: false }), `${who} deactivates ${scopeId}`);
      }
    }
    expect((await listScopes(host.caller)).find((s) => s.id === lighting)).toMatchObject({ name: bilingual("Lighting"), active: true });
  });

  it("of another Project are never listed or reachable", async () => {
    const otherTrade = await created(other.caller.post(`/v1/projects/${projectB}/trades`, { code: "EL", name: bilingual("Electrical") }));
    const otherScope = await created(addScope(other.caller, otherTrade, "Lighting", null, projectB));
    for (const caller of [host.caller, hostMember.caller, engineer.caller]) {
      expect(ids(await listScopes(caller))).not.toContain(otherScope);
      await expectHidden(caller.get(`/v1/projects/${projectB}/scopes`));
    }
    await expectHidden(updateScope(host.caller, otherScope, { active: false }));
    expect(ids(await listScopes(other.caller, projectB))).toEqual([otherScope]);
  });

  describe("for an Authorized Person who isn't a Project Member", () => {
    beforeAll(async () => {
      const put = await host.caller.request("PUT", `/v1/participants/${consultantParticipantId}/visibility`, {
        trade: { isAll: false, valueIds: [trade.electrical] },
        location: { isAll: false, valueIds: [] },
      });
      expect(put.statusCode, put.body).toBe(204);
    });

    it("are only those of the Trades their Participant covers", async () => {
      await expectHidden(consultant.caller.get(`/v1/projects/${projectId}/scopes`));
      const res = await consultant.caller.get(`/v1/participants/${consultantParticipantId}/scopes`);
      expect(res.statusCode, res.body).toBe(200);
      const scopes: Scope[] = res.json().scopes;
      expect(ids(scopes)).toEqual([lighting, indoor].sort());
      expect(scopes.every((s) => s.tradeId === trade.electrical)).toBe(true);
    });

    it("are read through the Participant only by its own Company and the Project Admins", async () => {
      expect((await host.caller.get(`/v1/participants/${consultantParticipantId}/scopes`)).statusCode).toBe(200);
      await expectHidden(hostMember.caller.get(`/v1/participants/${consultantParticipantId}/scopes`));
      await expectHidden(other.caller.get(`/v1/participants/${consultantParticipantId}/scopes`));
      await expectHidden(consultant.caller.get(`/v1/participants/${randomUUID()}/scopes`));
    });
  });
});
