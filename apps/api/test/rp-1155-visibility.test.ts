// Seam 1 for the Participants pages (RP-1155; visibility.md V15, V16; scenarios RP-1155-1 to
// RP-1155-3). Company Projects and Project Members name no Company but the viewer's own and the
// Host, and count and show only the viewer's own Company's Project Members and their Visibility
// (RP-1155-1); the Visibility Gap goes to the Participant's own Authorized Person only
// (RP-1155-2); a Member added to the Project starts with all of their Participant's Visibility,
// never more (RP-1155-3). Seam 2: packages/db/test/rp-1155-visibility-rls.test.ts.
import type { CompanyParticipations, DimensionValues, ParticipantMembers } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, buildTower, memberOnProject, ok, only, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

let at: Tower;
let c1: Company;
let k1: Company;
let c2: Company; // Another Contractor on the same Project: never named to K1.
let c2ParticipantId = "";
let k1Engineer: { id: string; caller: Caller };

const ids = (values: DimensionValues[keyof DimensionValues]) => values.map((v) => v.id);
const members = async (by: Caller, participantId: string) => {
  const res = await ok(by.get(`/v1/participants/${participantId}/members`), 200);
  return res.json() as ParticipantMembers;
};
/** What would point at C2 (every test Company has the same legal name): its id, its CR number, its Participant's id. */
let c2Names: string[] = [];

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  c2 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "PPG");
  c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  await memberOnProject(api, c2, c2ParticipantId, ["engineer"]);
  c2Names = [c2.company.companyId, c2.company.crNumber, c2ParticipantId];
  // K1's second Project Member, read-only: not its Authorized Person.
  k1Engineer = await memberOnProject(api, k1, at.k1ParticipantId!, ["engineer"]);
});

describe("scenario RP-1155-1: Company Projects and Project Members show only the viewer's own Company and the Host", () => {
  it("counts K1's own Project Members on its Company Projects card, and names no other Participant", async () => {
    for (const by of [k1.caller, k1Engineer.caller]) {
      const res = await ok(by.get("/v1/participants"), 200);
      const { participants } = res.json() as CompanyParticipations;
      expect(participants.map((p) => [p.id, p.memberCount])).toEqual([[at.k1ParticipantId, 2]]);
      for (const hidden of c2Names) expect(res.body).not.toContain(hidden);
    }
  });

  it("shows K1's Project Members and their Visibility to K1 alone, and no other Company's", async () => {
    const read = await members(k1Engineer.caller, at.k1ParticipantId!);
    expect(read.participant.memberCount).toBe(2);
    expect(read.members.map((m) => m.visibility)).toEqual([
      { trade: all, location: all },
      { trade: all, location: all },
    ]);
    const body = JSON.stringify(read);
    for (const hidden of c2Names) expect(body).not.toContain(hidden);
    // Another Company's Project Members, their count and Visibility: as if they didn't exist.
    for (const other of [at.c1ParticipantId, c2ParticipantId]) await expectHidden(k1Engineer.caller.get(`/v1/participants/${other}/members`));
    await expectHidden(c1.caller.get(`/v1/participants/${at.k1ParticipantId}/members`));
  });
});

describe("scenario RP-1155-2: the Visibility Gap goes to the Participant's own Authorized Person only", () => {
  beforeAll(async () => {
    // K1's manager and engineer are both narrowed to no Location: nobody of K1's covers Building A.
    const managerId = (await members(k1.caller, at.k1ParticipantId!)).members.find((m) => m.id !== k1Engineer.id)!.id;
    for (const id of [managerId, k1Engineer.id]) {
      await ok(k1.caller.request("PUT", `/v1/participants/${at.k1ParticipantId}/members/${id}/visibility`, { trade: all, location: only() }));
    }
  });

  it("names Building A to K1's Authorized Person", async () => {
    const { gap } = await members(k1.caller, at.k1ParticipantId!);
    expect(gap && { trade: ids(gap.trade), location: ids(gap.location) }).toEqual({ trade: [], location: [at.buildingA] });
  });

  it("is null for K1's other Project Members", async () => {
    expect((await members(k1Engineer.caller, at.k1ParticipantId!)).gap).toBeNull();
  });

  it("is empty to C1's Authorized Person for its own Participant, whose Members cover all of it", async () => {
    expect((await members(c1.caller, at.c1ParticipantId)).gap).toEqual({ trade: [], location: [] });
  });
});

describe("scenario RP-1155-3: a Member added to the Project starts with all of their Participant's Visibility, never more", () => {
  let added: { id: string; caller: Caller };
  beforeAll(async () => {
    // K1's Participant covers Building A and the Electrical Trade only.
    await ok(c1.caller.request("PUT", `/v1/participants/${at.k1ParticipantId}/visibility`, { trade: only(at.electrical), location: all }));
    const invited = await api.inviteMember(k1.caller);
    added = { id: invited.id, caller: await api.acceptInvitation(invited.invitationToken) };
    await api.addProjectMember(k1.caller, at.k1ParticipantId!, invited.id);
  });

  it("holds all in every dimension", async () => {
    const read = await members(k1.caller, at.k1ParticipantId!);
    expect(read.members.find((m) => m.id === added.id)?.visibility).toEqual({ trade: all, location: all });
  });

  it("covers Electrical and Building A, and not Mechanical", async () => {
    const mine = (await ok(added.caller.get(`/v1/projects/${at.projectId}/visibility`), 200)).json() as DimensionValues;
    expect({ trade: ids(mine.trade), location: ids(mine.location) }).toEqual({ trade: [at.electrical], location: [at.buildingA] });
  });

  it("closes K1's Visibility Gap", async () => {
    expect((await members(k1.caller, at.k1ParticipantId!)).gap).toEqual({ trade: [], location: [] });
  });
});
