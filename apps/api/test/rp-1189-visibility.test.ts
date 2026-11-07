// Seam 1 for the people on the viewer's own Steps in the Submittal Panel's Workflow modal (RP-1189;
// visibility.md V14, V15; scenarios RP-1189-1 and RP-1189-2): `GET /v1/work-items/:id/workflow` gives
// `stepPeople`, the names of each Step Pool the viewer's own Participant works, and no other Company's
// Steps: no name and no id. C1's Submittal goes through K1's Recommendation to the Owner's review.
// Seam 2: packages/db/test/rp-1189-visibility-rls.test.ts.
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemWorkflowMap } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addOwnerReviewType } from "./support/owner-review.ts";
import { all, bilingual, buildTower, memberOnProject, ok, only, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const OWNER_TYPE = "RPPPL";
const schema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

let at: Tower;
let id = "";
type Person = { id: string; caller: Caller; name: string };
let c1Engineer: Person;
let c1Pm: Person;
let k1Manager: Person;
let owPm: Person;
let c2Engineer: Person;
const people: Person[] = [];
const named = (by: Caller) => people.find((p) => p.caller === by)?.name ?? "someone";

const map = async (by: Caller): Promise<WorkItemWorkflowMap> => (await ok(by.get(`/v1/work-items/${id}/workflow`), 200)).json();
/** Each name `by` reads on any Step of the map, by its English name; nothing when the item isn't theirs to read. */
const namesRead = async (by: Caller) => {
  const res = await by.get(`/v1/work-items/${id}/workflow`);
  if (res.statusCode !== 200) return [];
  return (res.json() as WorkItemWorkflowMap).stepPeople.flatMap((s) => s.names.map((n) => ({ id: n.en })));
};

beforeAll(async () => {
  await addOwnerReviewType(migrator, OWNER_TYPE, schema);
  const c1 = await api.projectCreator();
  const onboard = async (name: string): Promise<Company> => {
    const onboarded = await api.onboardCompany({ legalName: bilingual(name) }); // not hidden-from: onboards the Company by its name
    return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  };
  const k1 = await onboard("People Consultants LLC");
  const ow = await onboard("People Owner Holding");
  const c2 = await onboard("Second Contractor Co");
  at = await buildTower(api, { c1, k1 }, "RPP");
  const owParticipant = await api.addParticipant(c1.caller, at.projectId, ow.company, "owner");
  await ok(c1.caller.request("PUT", `/v1/participants/${owParticipant}/visibility`, { trade: all, location: all }));
  // C2, a second Contractor, covers Mechanical only: C1's Electrical item is not theirs to see.
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: only(at.mechanical), location: all }));
  const person = async (company: Pick<Company, "caller">, participant: string, positions: string[], name: string): Promise<Person> => {
    const m = await memberOnProject(api, company, participant, positions, { name });
    const p = { id: m.id, caller: m.caller, name };
    people.push(p);
    return p;
  };
  c1Engineer = await person(c1, at.c1ParticipantId, ["engineer"], "Hadi Engineer C1");
  c1Pm = await person(c1, at.c1ParticipantId, ["project_manager"], "Rami Manager C1");
  k1Manager = await person(k1, at.k1ParticipantId!, ["manager"], "Sami Manager K1");
  owPm = await person(ow, owParticipant, ["project_manager"], "Nora Manager OW");
  c2Engineer = await person(c2, c2Participant, ["engineer"], "Omar Engineer C2");

  const answers = { model: "Busbar", trade: at.electrical, location: at.buildingA };
  id = (await ok(c1Engineer.caller.post(`/v1/projects/${at.projectId}/work-items`, { type: OWNER_TYPE, title: "Busbar trunking", answers }), 201)).json().id as string;
  await take(c1Engineer.caller, id, "send_for_review");
  await ok(c1Pm.caller.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm.caller, id, "submit");
  await ok(k1Manager.caller.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Manager.caller, id, "recommend_a");
});

describe("scenario RP-1189-1: each Company reads the people on its own Steps only", () => {
  it("C1 reads its own people on Draft and Contractor review, and no Step of K1's or the Owner's", async () => {
    for (const by of [c1Engineer, c1Pm]) {
      const { stepPeople } = await map(by.caller);
      expect(stepPeople.map((s) => s.stepKey), by.name).toEqual(["draft", "internal_review"]);
      expect(stepPeople.find((s) => s.stepKey === "internal_review")!.names, by.name).toContainEqual(bilingual(c1Pm.name));
    }
  });

  it("K1 reads its people on the Consultant PM review, the Owner on the Owner review", async () => {
    const k1 = (await map(k1Manager.caller)).stepPeople;
    expect(k1.map((s) => s.stepKey)).toEqual(["consultant_pm"]);
    expect(k1[0]!.names).toContainEqual(bilingual(k1Manager.name));
    expect((await map(owPm.caller)).stepPeople).toEqual([{ stepKey: "owner_review", names: [bilingual(owPm.name)] }]);
  });
});

describe("scenario RP-1189-2: outsiders read no other Company's Member", () => {
  it("C1, at the Owner's review, reads no Member of the Owner's or of K1's, by name or id; nor K1 or the Owner another's", async () => {
    const cOne = [c1Engineer.caller, c1Pm.caller];
    for (const [target, seenBy, hiddenFrom] of [
      [owPm, [owPm.caller], [...cOne, k1Manager.caller, c2Engineer.caller]],
      [k1Manager, [k1Manager.caller], [...cOne, owPm.caller, c2Engineer.caller]],
      [c1Pm, cOne, [k1Manager.caller, owPm.caller, c2Engineer.caller]],
    ] as const) {
      await expectHiddenFrom({ read: namesRead, target: target.name, seenBy, hiddenFrom, name: named, label: `${target.name}'s name` });
      // Nor their Member id anywhere in the map.
      for (const by of hiddenFrom) {
        const res = await by.get(`/v1/work-items/${id}/workflow`);
        expect(res.body.includes(target.id), `${named(by)} reads ${target.name}'s id`).toBe(false); // not hidden-from: the names assert above has the positive control
      }
    }
  });

  it("C2, a second Contractor that doesn't see C1's item, gets no map at all", async () => {
    expect((await map(c1Engineer.caller)).stepPeople.length).toBeGreaterThan(0);
    expect((await c2Engineer.caller.get(`/v1/work-items/${id}/workflow`)).statusCode).toBe(404);
  });
});

describe("scenario RP-1189-3: an Owner Representative holds the Owner's review", () => {
  let other: Tower;
  let held = "";
  let orPm: Person;
  let c3Engineer: Person;
  const namesOn = (item: string) => async (by: Caller) => {
    const res = await by.get(`/v1/work-items/${item}/workflow`);
    return res.statusCode === 200 ? (res.json() as WorkItemWorkflowMap).stepPeople.flatMap((s) => s.names.map((n) => ({ id: n.en }))) : [];
  };

  beforeAll(async () => {
    const c1 = await api.projectCreator();
    const k1 = await api.authorizedPerson();
    const or = await api.authorizedPerson();
    const c3 = await api.authorizedPerson();
    other = await buildTower(api, { c1, k1 }, "RPR");
    // The Project's Owner Representative covers the item: it holds the Owner's review (ADR 0022).
    const orParticipant = await api.addParticipant(c1.caller, other.projectId, or.company, "owner_representative");
    await ok(c1.caller.request("PUT", `/v1/participants/${orParticipant}/visibility`, { trade: all, location: all }));
    // C3, a second Contractor covering the whole Project, C1's item's Trade and Location too.
    const c3Participant = await api.addParticipant(c1.caller, other.projectId, c3.company, "contractor");
    await ok(c1.caller.request("PUT", `/v1/participants/${c3Participant}/visibility`, { trade: all, location: all }));
    const m = await memberOnProject(api, or, orParticipant, ["project_manager"], { name: "Layla Representative OR" });
    orPm = { id: m.id, caller: m.caller, name: "Layla Representative OR" };
    const c = await memberOnProject(api, c3, c3Participant, ["engineer", "project_manager"], { name: "Tariq Engineer C3" });
    c3Engineer = { id: c.id, caller: c.caller, name: "Tariq Engineer C3" };
    people.push(orPm, c3Engineer);

    const answers = { model: "Risers", trade: other.electrical, location: other.buildingA };
    held = (await ok(other.c1Engineer.post(`/v1/projects/${other.projectId}/work-items`, { type: OWNER_TYPE, title: "Cable risers", answers }), 201)).json().id as string;
    await take(other.c1Engineer, held, "send_for_review");
    await ok(other.c1Pm.post(`/v1/work-items/${held}/pick-up`));
    await take(other.c1Pm, held, "submit");
    await ok(other.k1Manager.post(`/v1/work-items/${held}/pick-up`));
    await take(other.k1Manager, held, "recommend_a");
  });

  it("the Owner Representative reads its own people on the Owner review it holds; nobody else reads them, by name or id", async () => {
    const own = (await ok(orPm.caller.get(`/v1/work-items/${held}/workflow`), 200)).json() as WorkItemWorkflowMap;
    expect(own.stepPeople).toEqual([{ stepKey: "owner_review", names: [bilingual(orPm.name)] }]);
    const others = [other.c1Engineer, other.c1Pm, other.k1Manager, c3Engineer.caller];
    await expectHiddenFrom({ read: namesOn(held), target: orPm.name, seenBy: orPm.caller, hiddenFrom: others, name: named, label: "the OR's Member" });
    for (const by of others) expect((await by.get(`/v1/work-items/${held}/workflow`)).body.includes(orPm.id), named(by)).toBe(false); // not hidden-from: the names assert above has the positive control
  });

  it("C3, a second Contractor covering the item, reads no Step's people of C1's, K1's or the OR's", async () => {
    // C1's Steps are the raiser's (V3), K1's and the OR's another role's: none is C3's.
    expect(await namesOn(held)(c3Engineer.caller)).toEqual([]); // not hidden-from: the assert above reads the OR's names with the OR first
    expect((await namesOn(held)(other.c1Pm)).length).toBeGreaterThan(0);
  });
});
