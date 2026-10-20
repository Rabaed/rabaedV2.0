// Seam 1 and 2 for the raised-from counts by Type (RP-624, SNAG-7; spec RP-619;
// workflow-engine.md §6; visibility.md "Lists and counts", scenarios RP-624-1 and RP-624-2).
//
// A source item counts the items `raised_from`-linked to it that the viewer sees, never a
// discarded one, open and closed, per Work Item Type: here the raised items are Snags (Type
// SNG) linked to a source Snag by hand. The Comments line of a Code B is covered by
// code-b-comments.test.ts.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, only, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company;
let k1: Company;
let at: Tower;
let buildingB = "";
let c1ElectricalOnly: Caller; // A Member of C1 covering Electrical only.
let c2Engineer: Caller; // Another Contractor of the same Trade, covering Building B only.

const snagLines = async (by: Caller, id: string) => (await detail(by, id)).raisedItems.filter((f) => f.type.code === "SNG").map((f) => ({ open: f.open, closed: f.closed }));

/** K1's manager's Draft Snag. */
async function draftSnag(title: string, trade: string, location: string): Promise<string> {
  return (
    await ok(
      at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title, answers: { description: title, trade, location } }),
      201,
    )
  ).json().id as string;
}

/** A Snag K1's manager raised, Open with the Contractor covering it. */
async function raised(title: string, trade: string, location: string): Promise<string> {
  const id = await draftSnag(title, trade, location);
  await take(at.k1Manager, id, "raise");
  return id;
}

/** Links `from` to `source` as raised from it. */
async function raiseFrom(from: string, source: string): Promise<void> {
  await sql`insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id)
    select project_id, ${from}::uuid, id, 'raised_from', created_by_member_id from work_item where id = ${source}::uuid`.execute(migrator);
}

/** Resolved by `contractor` and closed by K1's manager. */
async function close(id: string, contractor: Caller): Promise<void> {
  await ok(contractor.post(`/v1/work-items/${id}/pick-up`));
  await take(contractor, id, "resolve", { answers: { resolution_note: "Done" } });
  await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await take(at.k1Manager, id, "close");
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "FUC");
  buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  const c1Participant = participants.find((p) => p.isOwnCompany)!.id;
  // C1 covers Building A only, so each Snag has one Contractor covering it: C2 for Building B.
  await ok(c1.caller.request("PUT", `/v1/participants/${c1Participant}/visibility`, { trade: all, location: only(at.buildingA) }));
  c1ElectricalOnly = await projectMember(api, c1, c1Participant, ["engineer"], { trade: { isAll: false, valueIds: [at.electrical] } });
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
});

describe("a source counts the Snags raised from it, open and closed (seam 1)", () => {
  it("shows no Snags line while none is raised from it, then follows the Snags as they close", async () => {
    const source = await raised("Riser room", at.electrical, at.buildingA);
    expect(await snagLines(at.c1Pm, source)).toEqual([]);

    const first = await raised("Riser room: label the trays", at.electrical, at.buildingA);
    const second = await raised("Riser room: seal the openings", at.electrical, at.buildingA);
    await raiseFrom(first, source);
    await raiseFrom(second, source);
    expect(await snagLines(at.c1Pm, source)).toEqual([{ open: 2, closed: 0 }]);
    expect(await snagLines(at.k1Manager, source)).toEqual([{ open: 2, closed: 0 }]);

    await close(first, at.c1Pm);
    expect(await snagLines(at.c1Pm, source)).toEqual([{ open: 1, closed: 1 }]);
    await close(second, at.c1Pm);
    expect(await snagLines(at.c1Pm, source)).toEqual([{ open: 0, closed: 2 }]);
  });

  it("never counts a discarded Snag", async () => {
    const source = await raised("Plant room", at.electrical, at.buildingA);
    const draft = await draftSnag("Plant room: paint", at.electrical, at.buildingA);
    await raiseFrom(draft, source);
    expect(await snagLines(at.k1Manager, source)).toEqual([{ open: 1, closed: 0 }]); // K1's own Draft.
    await ok(at.k1Manager.post(`/v1/work-items/${draft}/discard-draft`));
    expect(await snagLines(at.k1Manager, source)).toEqual([]);
  });
});

describe("the counts follow what the viewer sees (seam 2, scenarios RP-624-1 and RP-624-2)", () => {
  it("RP-624-1: C2 counts none of C1's Snags raised from a source it sees", async () => {
    const source = await raised("Stair B", at.electrical, buildingB);
    const forC1 = await raised("Stair B: C1's side", at.electrical, at.buildingA);
    const forC2 = await raised("Stair B: C2's side", at.electrical, buildingB);
    await raiseFrom(forC1, source);
    await raiseFrom(forC2, source);
    await expectHidden(await c2Engineer.get(`/v1/work-items/${forC1}`));
    // C2 sees the source and counts the one Snag it sees.
    expect(await snagLines(c2Engineer, source)).toEqual([{ open: 1, closed: 0 }]);
  });

  it("RP-624-2: a viewer who sees one of two Snags counts one", async () => {
    const source = await raised("Level 2", at.electrical, at.buildingA);
    const electrical = await raised("Level 2: sockets", at.electrical, at.buildingA);
    const mechanical = await raised("Level 2: ducts", at.mechanical, at.buildingA);
    await raiseFrom(electrical, source);
    await raiseFrom(mechanical, source);
    expect(await snagLines(at.c1Pm, source)).toEqual([{ open: 2, closed: 0 }]);
    await expectHidden(await c1ElectricalOnly.get(`/v1/work-items/${mechanical}`));
    expect(await snagLines(c1ElectricalOnly, source)).toEqual([{ open: 1, closed: 0 }]);
  });
});
