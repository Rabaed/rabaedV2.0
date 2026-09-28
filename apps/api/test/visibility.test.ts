// Seam 1: Trades, Locations and Visibility grants (RP-191). A Project Admin
// defines the Project's Trades and Locations and grants each Participant
// Visibility; each Authorized Person narrows it for their own Project Members,
// who never get more than their Participant (visibility.md V4).
import { randomUUID } from "node:crypto";
import type { DimensionValue } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller, type InvitedMember, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

type Company = { company: OnboardedCompany; caller: Caller };

let host: Company; // Its Authorized Person created the Project and is its Project Admin.
let hostMember: { member: InvitedMember; caller: Caller }; // On the Project, not a Project Admin.
let consultant: Company; // Its Authorized Person is not on the Project.
let engineer: { member: InvitedMember; caller: Caller }; // A consultant engineer on the Project.
let projectId: string;
let hostParticipantId: string;
let consultantParticipantId: string;

const bilingual = (text: string) => ({ en: text, ar: text });
const loc = { tower1: "", buildingA: "", floor1: "", buildingB: "", tower2: "" };
const trade = { electrical: "", mechanical: "" };

async function addTrade(by: Caller, code: string) {
  return by.post(`/v1/projects/${projectId}/trades`, { code, name: bilingual(code) });
}

async function addLocation(by: Caller, code: string, parentId: string | null = null) {
  return by.post(`/v1/projects/${projectId}/locations`, { code, name: bilingual(code), parentId });
}

async function created(res: Promise<{ statusCode: number; json(): { id: string }; body: string }>) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id;
}

const setParticipantVisibility = (by: Caller, participantId: string, kind: string, body: unknown) =>
  by.request("PUT", `/v1/participants/${participantId}/visibility/${kind}`, body);

const setMemberVisibility = (by: Caller, memberId: string, kind: string, body: unknown) =>
  by.request("PUT", `/v1/participants/${consultantParticipantId}/members/${memberId}/visibility/${kind}`, body);

const ids = (values: DimensionValue[]) => values.map((v) => v.id).sort();
const sorted = (...values: string[]) => [...values].sort();

beforeAll(async () => {
  host = await api.projectCreator();
  hostMember = await api.member(host.caller);
  consultant = await api.authorizedPerson();
  engineer = await api.member(consultant.caller);
  projectId = (await api.createProject(host.caller)).id;
  consultantParticipantId = await api.addParticipant(host.caller, projectId, consultant.company, "consultant");
  const participants = (await host.caller.get(`/v1/projects/${projectId}/participants`)).json().participants;
  hostParticipantId = participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await api.addProjectMember(host.caller, hostParticipantId, hostMember.member.id);
  await api.addProjectMember(consultant.caller, consultantParticipantId, engineer.member.id);
});

describe("Trades and Locations", () => {
  beforeAll(async () => {
    trade.electrical = await created(addTrade(host.caller, "el"));
    trade.mechanical = await created(addTrade(host.caller, "ME"));
    loc.tower1 = await created(addLocation(host.caller, "T1"));
    loc.buildingA = await created(addLocation(host.caller, "BA", loc.tower1));
    loc.floor1 = await created(addLocation(host.caller, "F1", loc.buildingA));
    loc.buildingB = await created(addLocation(host.caller, "BB", loc.tower1));
    loc.tower2 = await created(addLocation(host.caller, "T2"));
  });

  it("are listed to the Project's Members, Locations as a Zone → Building → Floor tree", async () => {
    const res = await hostMember.caller.get(`/v1/projects/${projectId}/dimensions`);
    expect(res.statusCode).toBe(200);
    const { trade: trades, location } = res.json();
    expect(trades.map((t: DimensionValue) => t.code)).toEqual(["EL", "ME"]);
    expect(trades[0]).toEqual({
      id: trade.electrical,
      parentId: null,
      depth: 1,
      levelName: null,
      code: "EL",
      name: bilingual("el"),
    });
    const floor = location.find((l: DimensionValue) => l.id === loc.floor1);
    expect(floor).toMatchObject({ parentId: loc.buildingA, depth: 3, levelName: { en: "Floor", ar: "الطابق" } });
    expect(location.find((l: DimensionValue) => l.id === loc.tower1).levelName.en).toBe("Zone");
    expect(location.find((l: DimensionValue) => l.id === loc.buildingA).levelName.en).toBe("Building");
  });

  it("stop at three levels and keep codes unique among siblings", async () => {
    expect((await addLocation(host.caller, "R1", loc.floor1)).json()).toEqual({ error: "too_deep" });
    const dup = await addLocation(host.caller, "BA", loc.tower1);
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: "duplicate_code" });
    expect((await addTrade(host.caller, "EL")).statusCode).toBe(409);
    expect((await addLocation(host.caller, "X1", randomUUID())).json()).toEqual({ error: "parent_not_found" });
  });

  it("are changed only by a Project Admin", async () => {
    expect((await addTrade(hostMember.caller, "CV")).statusCode).toBe(403);
    // Not on the Project: exactly like a Project that doesn't exist.
    expect((await addTrade(consultant.caller, "CV")).statusCode).toBe(404);
    expect((await consultant.caller.get(`/v1/projects/${projectId}/dimensions`)).statusCode).toBe(404);
  });

  it("reject a code that isn't 2 to 6 letters or digits", async () => {
    expect((await addTrade(host.caller, "E")).statusCode).toBe(400);
  });
});

describe("a Participant's Visibility", () => {
  it("covers nothing until a Project Admin grants it", async () => {
    const res = await consultant.caller.get(`/v1/participants/${consultantParticipantId}/visibility`);
    expect(res.statusCode).toBe(200);
    expect(res.json().visibility).toEqual({
      trade: { isAll: false, valueIds: [] },
      location: { isAll: false, valueIds: [] },
    });
  });

  it("granting Tower 1 covers all its Buildings and Floors", async () => {
    const put = await setParticipantVisibility(host.caller, consultantParticipantId, "location", {
      isAll: false,
      valueIds: [loc.tower1],
    });
    expect(put.statusCode, put.body).toBe(204);
    const res = await host.caller.get(`/v1/participants/${consultantParticipantId}/visibility`);
    expect(res.json().visibility.location).toEqual({ isAll: false, valueIds: [loc.tower1] });
    expect(ids(res.json().coverage.location)).toEqual(sorted(loc.tower1, loc.buildingA, loc.floor1, loc.buildingB));

    // And so does the engineer given all of their Participant's Locations.
    expect((await setMemberVisibility(consultant.caller, engineer.member.id, "location", { isAll: true, valueIds: [] })).statusCode).toBe(204);
    const mine = (await engineer.caller.get(`/v1/projects/${projectId}/visibility`)).json();
    expect(ids(mine.location)).toEqual(sorted(loc.tower1, loc.buildingA, loc.floor1, loc.buildingB));
    expect(mine.trade).toEqual([]);
  });

  it("is granted only by a Project Admin", async () => {
    const body = { isAll: true, valueIds: [] };
    expect((await setParticipantVisibility(hostMember.caller, consultantParticipantId, "trade", body)).statusCode).toBe(403);
    expect((await setParticipantVisibility(consultant.caller, consultantParticipantId, "trade", body)).statusCode).toBe(404);
    expect((await setParticipantVisibility(engineer.caller, consultantParticipantId, "trade", body)).statusCode).toBe(403);
  });

  it("rejects values that aren't the dimension's", async () => {
    const res = await setParticipantVisibility(host.caller, consultantParticipantId, "trade", {
      isAll: false,
      valueIds: [loc.tower1],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "value_not_found" });
    expect((await setParticipantVisibility(host.caller, consultantParticipantId, "zone", { isAll: true, valueIds: [] })).statusCode).toBe(404);
  });
});

describe("a Member's Visibility", () => {
  beforeAll(async () => {
    const put = await setParticipantVisibility(host.caller, consultantParticipantId, "trade", {
      isAll: false,
      valueIds: [trade.electrical],
    });
    expect(put.statusCode).toBe(204);
  });

  it("can't include a Trade or Location the Participant doesn't have (V4)", async () => {
    for (const [kind, valueIds] of [
      ["trade", [trade.mechanical]],
      ["location", [loc.tower2]],
    ] as const) {
      const res = await setMemberVisibility(consultant.caller, engineer.member.id, kind, { isAll: false, valueIds });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: "exceeds_participant" });
    }
  });

  it("narrows within the Participant's", async () => {
    expect(
      (await setMemberVisibility(consultant.caller, engineer.member.id, "location", { isAll: false, valueIds: [loc.buildingA] })).statusCode,
    ).toBe(204);
    expect(
      (await setMemberVisibility(consultant.caller, engineer.member.id, "trade", { isAll: false, valueIds: [trade.electrical] })).statusCode,
    ).toBe(204);
    const res = await consultant.caller.get(`/v1/participants/${consultantParticipantId}/members/${engineer.member.id}/visibility`);
    expect(res.statusCode).toBe(200);
    expect(res.json().visibility).toEqual({
      trade: { isAll: false, valueIds: [trade.electrical] },
      location: { isAll: false, valueIds: [loc.buildingA] },
    });
    // The Authorized Person, not on the Project, still sees what the Participant covers, to choose from.
    expect(ids(res.json().participant.coverage.trade)).toEqual([trade.electrical]);
    const mine = (await engineer.caller.get(`/v1/projects/${projectId}/visibility`)).json();
    expect(ids(mine.location)).toEqual(sorted(loc.buildingA, loc.floor1));
    expect(ids(mine.trade)).toEqual([trade.electrical]);
  });

  it("is granted only by the Participant's own Authorized Person", async () => {
    const body = { isAll: true, valueIds: [] };
    expect((await setMemberVisibility(engineer.caller, engineer.member.id, "trade", body)).statusCode).toBe(403);
    // The Project Admin of another Company: not theirs, so not found.
    expect((await setMemberVisibility(host.caller, engineer.member.id, "trade", body)).statusCode).toBe(404);
    const notOnProject = await api.inviteMember(consultant.caller);
    const res = await setMemberVisibility(consultant.caller, notOnProject.id, "trade", body);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "member_not_found" });
  });
});

describe("other Participants' grants", () => {
  beforeAll(async () => {
    const put = await setParticipantVisibility(host.caller, hostParticipantId, "trade", { isAll: true, valueIds: [] });
    expect(put.statusCode).toBe(204);
  });

  it("are not visible to a Member of another Participant", async () => {
    expect((await engineer.caller.get(`/v1/participants/${hostParticipantId}/visibility`)).statusCode).toBe(404);
    expect((await hostMember.caller.get(`/v1/participants/${consultantParticipantId}/visibility`)).statusCode).toBe(404);
  });

  it("show another Company's Project Admin the Participant's grant, never its Members'", async () => {
    expect((await host.caller.get(`/v1/participants/${consultantParticipantId}/visibility`)).statusCode).toBe(200);
    const res = await host.caller.get(`/v1/participants/${consultantParticipantId}/members/${engineer.member.id}/visibility`);
    expect(res.statusCode).toBe(404);
  });

  it("leave a Member's own Visibility alone", async () => {
    const mine = (await engineer.caller.get(`/v1/projects/${projectId}/visibility`)).json();
    expect(ids(mine.trade)).toEqual([trade.electrical]);
  });
});

